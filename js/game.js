/**
 * Star Quest — local math game for late 1st / early 2nd grade (~age 7).
 * Open ../index.html by double-clicking. No server, no login, no network.
 *
 * A kid taps one of 3–4 big answers. Pip the star walks a path of 8 stars.
 * Wrong answer: lose a heart and try once more. Still wrong: we show the
 * answer kindly and move on. No timer unless they turn it on (default OFF).
 */

// ========== TWEAK THESE ==========
var QUESTIONS_PER_ROUND = 8;
var STARTING_HEARTS = 3;
var ANSWER_CHOICES = 4;          // use 3 or 4
var SPEECH_MS = 1100;            // pause after a correct answer
var REVEAL_MS = 2000;            // pause after we show the right answer
var TIMER_SECONDS = 20;          // only used if the start-screen toggle is on
var TIMER_DEFAULT_ON = false;
// =================================

var ROUND_INFO = [
  { id: 1, name: "Plus to 10",   blurb: "Add up to 10",          kind: "add10" },
  { id: 2, name: "Plus to 20",   blurb: "Add up to 20",          kind: "add20" },
  { id: 3, name: "Take Away",    blurb: "Subtract from 10",      kind: "sub10" },
  { id: 4, name: "Mix It Up",    blurb: "Plus and minus to 20",  kind: "mix20" },
  { id: 5, name: "Fill the Blank", blurb: "3 + ? = 8",           kind: "missing10" }
];

var NICE = ["Nice!", "You got it!", "Super star!", "Yes!", "Wow!", "Great job!"];
var TRY_AGAIN = ["Try that one again.", "So close — one more try!", "Almost! Pick another."];
var REVEAL = ["The answer is {n}. You’ve got this!", "It’s {n}. On to the next star!", "Nice try — {n} was the one."];

var state = {
  roundIndex: 0,
  qIndex: 0,
  hearts: STARTING_HEARTS,
  stars: 0,
  firstTry: true,
  current: null,
  locked: false,
  muted: false,
  timerOn: TIMER_DEFAULT_ON,
  timerId: null,
  asked: []
};

var audioCtx = null;

// ---------- tiny helpers ----------
function $(id) { return document.getElementById(id); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function uniqueKey(q) { return q.prompt + "=" + q.answer; }

// ---------- questions (all numbers are easy to change above) ----------
function makeAdd(maxSum, minSum) {
  // both addends at least 1 — no "0 + 7" (too easy for this age)
  minSum = minSum == null ? 4 : minSum;
  var sum = rand(minSum, maxSum);
  var a = rand(1, Math.max(1, sum - 1));
  var b = sum - a;
  return { prompt: a + " + " + b, answer: sum, html: null };
}

function makeSub(maxMinuend, minMinuend) {
  // no "n − 0"; minuend at least 3 so take-away feels real
  minMinuend = minMinuend == null ? 3 : minMinuend;
  var a = rand(minMinuend, maxMinuend);
  var b = rand(1, a);
  return { prompt: a + " − " + b, answer: a - b, html: null };
}

function makeMissing(maxTotal) {
  // e.g. 3 + __ = 8  (totals 4–10, blanks 1–9)
  var total = rand(4, maxTotal);
  var a = rand(1, total - 1);
  var missing = total - a;
  // 3 + __ = 8  (sometimes __ + 3 = 8 so the blank moves)
  var blankFirst = Math.random() < 0.35;
  var html, prompt;
  if (blankFirst) {
    html = '<span class="blank">?</span> + ' + a + ' = ' + total;
    prompt = "? + " + a + " = " + total;
  } else {
    html = a + ' + <span class="blank">?</span> = ' + total;
    prompt = a + " + ? = " + total;
  }
  return { prompt: prompt, answer: missing, html: html };
}

function nextQuestion(kind) {
  var q, tries = 0;
  do {
    if (kind === "add10") q = makeAdd(10, 4);
    else if (kind === "add20") q = makeAdd(20, 10);     // lean into teens
    else if (kind === "sub10") q = makeSub(10, 4);
    else if (kind === "mix20") q = Math.random() < 0.55 ? makeAdd(20, 6) : makeSub(20, 6);
    else q = makeMissing(10);
    tries++;
  } while (state.asked.indexOf(uniqueKey(q)) !== -1 && tries < 30);
  state.asked.push(uniqueKey(q));
  q.choices = makeChoices(q.answer, kind);
  return q;
}

function makeChoices(correct, kind) {
  var high = (kind === "add20" || kind === "mix20") ? 20 : 10;
  var set = {};
  set[correct] = true;
  var nearby = [correct - 1, correct + 1, correct - 2, correct + 2, correct + 3, Math.abs(correct - 4)];
  var i, n;
  for (i = 0; i < nearby.length; i++) {
    n = nearby[i];
    if (n >= 0 && n <= high && !set[n]) set[n] = true;
    if (Object.keys(set).length >= ANSWER_CHOICES) break;
  }
  while (Object.keys(set).length < ANSWER_CHOICES) {
    n = rand(0, high);
    set[n] = true;
  }
  var list = Object.keys(set).map(Number);
  // keep exactly ANSWER_CHOICES, always including correct
  if (list.length > ANSWER_CHOICES) {
    list = [correct].concat(shuffle(list.filter(function (x) { return x !== correct; }))).slice(0, ANSWER_CHOICES);
  }
  return shuffle(list);
}

// ---------- audio (Web Audio beeps — no files; safe if autoplay is blocked) ----------
function ensureAudio() {
  if (state.muted) return null;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  } catch (e) {
    return null;
  }
}

function beep(freq, dur, type, when, vol) {
  var ctx = ensureAudio();
  if (!ctx) return;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(vol || 0.16, ctx.currentTime + when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + when);
  osc.stop(ctx.currentTime + when + dur + 0.02);
}

function playCorrect() {
  beep(523.25, 0.12, "triangle", 0, 0.14);
  beep(659.25, 0.12, "triangle", 0.1, 0.14);
  beep(783.99, 0.22, "triangle", 0.2, 0.16);
}
function playWrong() {
  beep(196, 0.18, "sine", 0, 0.1);
  beep(165, 0.22, "sine", 0.12, 0.08);
}

function setMuted(on) {
  state.muted = !!on;
  var btn = $("btn-mute");
  btn.setAttribute("aria-pressed", state.muted ? "true" : "false");
  btn.setAttribute("aria-label", state.muted ? "Sound is off. Tap to unmute." : "Sound is on. Tap to mute.");
  btn.querySelector(".icon-sound").textContent = state.muted ? "🔇" : "🔊";
  try { localStorage.setItem("starquest-muted", state.muted ? "1" : "0"); } catch (e) {}
}

// ---------- screens ----------
function showScreen(id) {
  ["screen-start", "screen-game", "screen-end"].forEach(function (sid) {
    var el = $(sid);
    var on = sid === id;
    el.classList.toggle("active", on);
    if (on) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  });
}

function say(which, text) {
  var el = $("speech-" + which);
  if (el) el.textContent = text;
}

function setHeroMood(mood) {
  document.querySelectorAll("[data-hero]").forEach(function (h) {
    h.classList.remove("mood-wave", "mood-think", "mood-yay", "mood-oops", "mood-idle");
    h.classList.add("mood-" + mood);
  });
}

// ---------- start screen ----------
function buildRoundPicks(intoId, onPick) {
  var box = $(intoId);
  box.innerHTML = "";
  ROUND_INFO.forEach(function (r, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "round-card";
    b.innerHTML = "<strong>Round " + r.id + "</strong><span>" + r.name + "</span>";
    b.addEventListener("click", function () { onPick(i); });
    box.appendChild(b);
  });
}

function paintSky() {
  var sky = $("sky");
  sky.innerHTML = "";
  for (var i = 0; i < 48; i++) {
    var d = document.createElement("div");
    d.className = "sky-dot";
    d.style.left = Math.random() * 100 + "%";
    d.style.top = Math.random() * 100 + "%";
    d.style.animationDelay = (Math.random() * 2.8) + "s";
    d.style.width = d.style.height = (Math.random() * 3 + 2) + "px";
    sky.appendChild(d);
  }
}

// ---------- game UI ----------
function renderHearts() {
  var html = "";
  for (var i = 0; i < STARTING_HEARTS; i++) {
    html += '<span class="heart' + (i < state.hearts ? "" : " lost") + '" aria-hidden="true">♥</span>';
  }
  $("hearts").innerHTML = html;
  $("hearts").setAttribute("aria-label", state.hearts + " hearts left");
}

function renderProgress() {
  var html = "";
  for (var i = 0; i < QUESTIONS_PER_ROUND; i++) {
    var cls = "pip";
    if (i < state.qIndex) cls += " done";
    else if (i === state.qIndex) cls += " now";
    html += '<span class="' + cls + '"></span>';
  }
  $("progress-stars").innerHTML = html;
}

function renderPath() {
  var path = $("path");
  path.innerHTML = "";
  for (var i = 0; i < QUESTIONS_PER_ROUND; i++) {
    var node = document.createElement("div");
    node.className = "path-node" + (i < state.qIndex ? " done" : i === state.qIndex ? " now" : "");
    node.textContent = i < state.qIndex ? "★" : String(i + 1);
    node.style.left = (6 + (i * (88 / (QUESTIONS_PER_ROUND - 1)))) + "%";
    path.appendChild(node);
  }
  var hero = document.querySelector("#screen-game [data-hero]");
  var left = 6 + (state.qIndex * (88 / (QUESTIONS_PER_ROUND - 1)));
  hero.style.left = "calc(" + left + "% - 39px)";
}

function renderQuestion() {
  var q = state.current;
  var info = ROUND_INFO[state.roundIndex];
  $("q-label").textContent = "Question " + (state.qIndex + 1) + " of " + QUESTIONS_PER_ROUND;
  $("round-chip").textContent = "Round " + info.id + " · " + info.name;
  $("question").innerHTML = q.html || q.prompt;
  var box = $("answers");
  box.innerHTML = "";
  q.choices.forEach(function (n, i) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "answer";
    btn.dataset.value = String(n);
    btn.innerHTML = '<span class="key-hint">' + (i + 1) + "</span>" + n;
    btn.addEventListener("click", function () { onAnswer(n, btn); });
    box.appendChild(btn);
  });
  renderHearts();
  renderProgress();
  renderPath();
  startTimerIfNeeded();
}

function startRound(index) {
  state.roundIndex = index;
  state.qIndex = 0;
  state.hearts = STARTING_HEARTS;
  state.stars = 0;
  state.firstTry = true;
  state.locked = false;
  state.asked = [];
  state.current = nextQuestion(ROUND_INFO[index].kind);
  showScreen("screen-game");
  setHeroMood("think");
  say("game", "What is the answer?");
  renderQuestion();
}

function startTimerIfNeeded() {
  clearTimer();
  var wrap = $("timer");
  var bar = $("timer-bar");
  if (!state.timerOn) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  bar.style.transition = "none";
  bar.style.transform = "scaleX(1)";
  // force layout so the next transition runs
  void bar.offsetWidth;
  bar.style.transition = "transform " + TIMER_SECONDS + "s linear";
  bar.style.transform = "scaleX(0)";
  state.timerId = setTimeout(function () {
    if (state.locked) return;
    // time’s up counts as a wrong try
    onAnswer(null, null, true);
  }, TIMER_SECONDS * 1000);
}

function clearTimer() {
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
}

function burstConfetti() {
  var layer = $("confetti");
  var bits = ["✦", "★", "✶", "💛", "✨"];
  for (var i = 0; i < 18; i++) {
    var el = document.createElement("div");
    el.className = "confetti-bit";
    el.textContent = pick(bits);
    el.style.left = Math.random() * 100 + "%";
    el.style.animationDelay = (Math.random() * 0.15) + "s";
    el.style.fontSize = (16 + Math.random() * 18) + "px";
    layer.appendChild(el);
    window.setTimeout(function (node) { return function () { node.remove(); }; }(el), 1500);
  }
}

function onAnswer(value, btn, timedOut) {
  if (state.locked) return;
  var q = state.current;
  var correct = value === q.answer;

  if (correct) {
    state.locked = true;
    clearTimer();
    if (btn) btn.classList.add("correct");
    disableAnswers();
    state.stars += 1;
    playCorrect();
    burstConfetti();
    setHeroMood("yay");
    say("game", pick(NICE));
    window.setTimeout(advance, SPEECH_MS);
    return;
  }

  // wrong (or timed out)
  playWrong();
  setHeroMood("oops");
  if (btn) {
    btn.classList.add("wrong", "used-wrong");
    btn.disabled = true;
  }
  $("question").classList.remove("shake");
  void $("question").offsetWidth;
  $("question").classList.add("shake");

  if (state.firstTry) {
    state.firstTry = false;
    if (state.hearts > 0) state.hearts -= 1;
    renderHearts();
    say("game", timedOut ? "Time’s up — try once more!" : pick(TRY_AGAIN));
    if (state.hearts === 0) {
      // last heart gone: still allow the retry on this question, then we finish
    }
    return;
  }

  // second miss: show the answer kindly and move on
  state.locked = true;
  clearTimer();
  highlightCorrect();
  disableAnswers();
  say("game", pick(REVEAL).replace("{n}", q.answer));
  window.setTimeout(advance, REVEAL_MS);
}

function disableAnswers() {
  $("answers").querySelectorAll("button").forEach(function (b) { b.disabled = true; });
}

function highlightCorrect() {
  $("answers").querySelectorAll("button").forEach(function (b) {
    if (Number(b.dataset.value) === state.current.answer) b.classList.add("correct");
  });
}

function advance() {
  $("question").classList.remove("shake");
  state.qIndex += 1;
  // Always finish all 8 questions so a 7-year-old completes the path.
  // Hearts can hit 0; we still move on (the spec says show the answer and continue).
  if (state.qIndex >= QUESTIONS_PER_ROUND) {
    endRound();
    return;
  }
  state.firstTry = true;
  state.locked = false;
  state.current = nextQuestion(ROUND_INFO[state.roundIndex].kind);
  setHeroMood("think");
  say("game", "What is the answer?");
  renderQuestion();
}

function endRound() {
  clearTimer();
  showScreen("screen-end");
  setHeroMood("yay");
  var total = QUESTIONS_PER_ROUND;
  var earned = state.stars;
  $("end-stars").textContent = earned + " star" + (earned === 1 ? "" : "s") + " out of " + total;
  var msg;
  if (earned === total) msg = "Perfect path! Every star is yours!";
  else if (earned >= total - 2) msg = "Wow! You collected so many stars!";
  else if (earned >= 3) msg = "Great walking. Those stars are yours!";
  else msg = "You showed up and that’s a star move. Try this round again!";
  if (state.hearts <= 0 && earned < total) {
    msg = "Hearts are resting. You still earned " + earned + " star" + (earned === 1 ? "" : "s") + "!";
  }
  say("end", msg);
  var last = state.roundIndex >= ROUND_INFO.length - 1;
  $("btn-next").hidden = last;
  $("btn-next").textContent = last ? "Next round" : "Next round";
}

// ---------- keyboard 1–4 ----------
function onKey(e) {
  if (e.repeat) return;
  if (e.key === "m" || e.key === "M") {
    setMuted(!state.muted);
    return;
  }
  if (!$("screen-game").classList.contains("active") || state.locked) return;
  var n = parseInt(e.key, 10);
  if (n >= 1 && n <= ANSWER_CHOICES) {
    var btns = $("answers").querySelectorAll("button");
    var btn = btns[n - 1];
    if (btn && !btn.disabled) btn.click();
  }
}

function paintTimerLabel() {
  var on = $("toggle-timer").checked;
  $("timer-label").textContent = on
    ? "Timer (on — " + TIMER_SECONDS + " seconds)"
    : "Timer (off — no rush!)";
}

// ---------- boot ----------
function boot() {
  paintSky();
  buildRoundPicks("round-picks", startRound);
  $("btn-start").addEventListener("click", function () { startRound(0); });
  $("btn-again").addEventListener("click", function () { startRound(state.roundIndex); });
  $("btn-next").addEventListener("click", function () {
    startRound(Math.min(state.roundIndex + 1, ROUND_INFO.length - 1));
  });
  $("btn-picks").addEventListener("click", function () {
    showScreen("screen-start");
    setHeroMood("wave");
    say("start", "Pick a round — or tap Let’s Go!");
  });
  $("btn-mute").addEventListener("click", function () { setMuted(!state.muted); });
  $("toggle-timer").checked = TIMER_DEFAULT_ON;
  paintTimerLabel();
  $("toggle-timer").addEventListener("change", function (e) {
    state.timerOn = e.target.checked;
    paintTimerLabel();
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", function () { ensureAudio(); }, { once: true });

  try {
    if (localStorage.getItem("starquest-muted") === "1") setMuted(true);
  } catch (e) {}

  // screenshot / demo helpers: ?shot=game&q=4 jumps to that question
  var params = new URLSearchParams(window.location.search);
  var shot = params.get("shot");
  if (shot === "game") {
    var round = parseInt(params.get("round") || "1", 10) - 1;
    if (isNaN(round) || round < 0 || round >= ROUND_INFO.length) round = 0;
    startRound(round);
    var jump = parseInt(params.get("q") || "1", 10);
    if (jump > 1) {
      state.qIndex = Math.min(jump - 1, QUESTIONS_PER_ROUND - 1);
      state.stars = state.qIndex;
      state.current = nextQuestion(ROUND_INFO[round].kind);
      renderQuestion();
    }
  }
}

document.addEventListener("DOMContentLoaded", boot);
