/**
 * Lily Hop — local math game for late 1st / early 2nd grade (~age 7).
 * Open this folder’s index.html (or play.html). No server, no login.
 *
 * A target number sits at the top. Tap the lily pad that equals it.
 * The frog hops there. A wrong pad splashes, sinks, and a new one pops.
 * Six hops cross the pond. No timer, no hearts, no number pad.
 */

// ========== TWEAK THESE ==========
var HOPS_TO_CROSS = 6;
var HOP_MS = 500;
var SINK_MS = 420;
var POP_MS = 80;
// =================================

var ROUND_INFO = [
  { id: 1, name: "Addition", symbol: "+", range: "10", kind: "add10" },
  { id: 2, name: "Addition", symbol: "+", range: "20", kind: "add20" },
  { id: 3, name: "Subtraction", symbol: "−", range: "10", kind: "sub10" },
  { id: 4, name: "Mix", symbol: "+ −", range: "20", kind: "mix20" }
];

var state = {
  roundIndex: 0,
  hops: 0,
  splashes: 0,
  current: null,
  locked: false,
  muted: false,
  asked: [],
  reduceMotion: false
};

var audioCtx = null;
var htmlSounds = {};

// ---------- tiny helpers ----------
function $(id) { return document.getElementById(id); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  var a = arr.slice();
  var i, j, t;
  for (i = a.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function uniqueKey(q) { return q.prompt + "=" + q.answer; }
function prefersReduce() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    return false;
  }
}

// ---------- questions (same bands as Zap City; no 0+n, no n−0, no negatives) ----------
function makeAdd(maxSum, minSum) {
  minSum = minSum == null ? 4 : minSum;
  var sum = rand(minSum, maxSum);
  var a = rand(1, Math.max(1, sum - 1));
  var b = sum - a;
  return { prompt: a + " + " + b, answer: sum };
}

function makeSub(maxMinuend, minMinuend) {
  minMinuend = minMinuend == null ? 3 : minMinuend;
  var a = rand(minMinuend, maxMinuend);
  var b = rand(1, a);
  return { prompt: a + " − " + b, answer: a - b };
}

function rawQuestion(kind) {
  if (kind === "add10") return makeAdd(10, 4);
  if (kind === "add20") return makeAdd(20, 10);
  if (kind === "sub10") return makeSub(10, 4);
  return Math.random() < 0.55 ? makeAdd(20, 6) : makeSub(20, 6);
}

function nextQuestion(kind) {
  var q, tries = 0;
  do {
    q = rawQuestion(kind);
    tries++;
  } while (state.asked.indexOf(uniqueKey(q)) !== -1 && tries < 30);
  state.asked.push(uniqueKey(q));
  return q;
}

function makeDistractor(kind, target, usedAnswers, usedTexts) {
  var i, n, q;
  if (Math.random() < 0.38) {
    var near = shuffle([target - 3, target - 2, target - 1, target + 1, target + 2, target + 3, target + 4]);
    for (i = 0; i < near.length; i++) {
      n = near[i];
      if (n >= 0 && n <= 20 && !usedAnswers[n] && !usedTexts[String(n)]) {
        return { text: String(n), value: n, ok: false };
      }
    }
  }
  for (i = 0; i < 24; i++) {
    q = rawQuestion(kind);
    if (q.answer === target) continue;
    if (usedAnswers[q.answer] && Math.random() < 0.7) continue;
    if (usedTexts[q.prompt]) continue;
    return { text: q.prompt, value: q.answer, ok: false, prompt: q.prompt };
  }
  n = target === 0 ? 1 : target - 1;
  if (n < 0) n = target + 1;
  if (!usedTexts[String(n)] && n !== target) {
    return { text: String(n), value: n, ok: false };
  }
  return { text: String(target + 2), value: target + 2, ok: false };
}

function buildHop() {
  var kind = ROUND_INFO[state.roundIndex].kind;
  var fact = nextQuestion(kind);
  var target = fact.answer;
  var nPads = Math.random() < 0.42 ? 3 : 4;
  var pads = [];
  if (Math.random() < 0.2) {
    pads.push({ text: String(target), value: target, ok: true, prompt: fact.prompt });
  } else {
    pads.push({ text: fact.prompt, value: target, ok: true, prompt: fact.prompt });
  }
  var usedA = {};
  var usedT = {};
  usedA[target] = true;
  usedT[pads[0].text] = true;
  while (pads.length < nPads) {
    var d = makeDistractor(kind, target, usedA, usedT);
    usedA[d.value] = true;
    usedT[d.text] = true;
    pads.push(d);
  }
  state.current = { target: target, pads: shuffle(pads), fact: fact };
}

// ---------- audio (HTML wav for iPhone + Web Audio backup) ----------
function writeWav(seconds, sampleFn) {
  var rate = 22050;
  var n = Math.floor(rate * seconds);
  var bytes = new Uint8Array(44 + n * 2);
  var v = new DataView(bytes.buffer);
  function str(at, s) { var i; for (i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); }
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  var i, s;
  for (i = 0; i < n; i++) {
    s = sampleFn(i / rate, i, n);
    if (s > 1) s = 1; if (s < -1) s = -1;
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

function makeSound(seconds, sampleFn) {
  var a = new Audio();
  a.preload = "auto";
  a.src = writeWav(seconds, sampleFn);
  a.setAttribute("playsinline", "true");
  return a;
}

function buildSounds() {
  if (htmlSounds.hop) return;
  htmlSounds.hop = makeSound(0.22, function (t) {
    var f = 320 + t * 420;
    var env = Math.exp(-t * 9) * Math.min(1, t / 0.01);
    return Math.sin(t * f * 6.283) * env * 0.38;
  });
  htmlSounds.land = makeSound(0.12, function (t) {
    var env = Math.exp(-t * 28);
    return Math.sin(t * 180 * 6.283) * env * 0.28;
  });
  htmlSounds.splash = makeSound(0.28, function (t, i) {
    var env = Math.exp(-t * 8);
    var n = ((i * 17 + 31) % 17) / 8.5 - 1;
    return (Math.sin(t * (220 - t * 280) * 6.283) * 0.22 + n * 0.18) * env;
  });
  htmlSounds.pop = makeSound(0.08, function (t) {
    var env = Math.exp(-t * 36);
    return Math.sin(t * 740 * 6.283) * env * 0.2;
  });
  htmlSounds.yay = makeSound(0.42, function (t) {
    var step = t < 0.12 ? 523 : t < 0.24 ? 659 : 784;
    var env = Math.exp(-((t % 0.12) * 18)) * (t < 0.4 ? 1 : 0);
    return Math.sin(t * step * 6.283) * env * 0.26;
  });
  htmlSounds.click = makeSound(0.03, function (t) {
    return Math.sin(t * 980 * 6.283) * Math.exp(-t * 90) * 0.12;
  });
}

function playHtml(name) {
  if (state.muted) return;
  buildSounds();
  var a = htmlSounds[name];
  if (!a) return;
  try {
    a.muted = false;
    a.volume = 1;
    a.pause();
    a.currentTime = 0;
    var p = a.play();
    if (p && p.catch) p.catch(function () {});
  } catch (e) {}
}

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

function unlockAudio() {
  buildSounds();
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
    }
  } catch (e) {}
  ["hop", "land", "splash", "pop", "yay", "click"].forEach(function (n) {
    var a = htmlSounds[n];
    if (!a) return;
    try {
      a.muted = true;
      var p = a.play();
      if (p && p.then) {
        p.then(function () {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        }).catch(function () { a.muted = false; });
      } else {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      }
    } catch (err) { a.muted = false; }
  });
}

function playHop() { playHtml("hop"); }
function playLand() { playHtml("land"); }
function playSplash() { playHtml("splash"); }
function playPop() { playHtml("pop"); }
function playYay() { playHtml("yay"); }
function playClick() { playHtml("click"); }

function setMuted(on) {
  state.muted = !!on;
  var btn = $("btn-mute");
  btn.setAttribute("aria-pressed", state.muted ? "true" : "false");
  btn.setAttribute("aria-label", state.muted ? "Sound is off. Tap to unmute." : "Sound is on. Tap to mute.");
  var icon = btn.querySelector(".icon-sound");
  if (icon) icon.textContent = state.muted ? "🔇" : "🔊";
  try { localStorage.setItem("lilyhop-muted", state.muted ? "1" : "0"); } catch (e) {}
}

function setFrogMood(mood) {
  document.querySelectorAll("[data-frog]").forEach(function (h) {
    h.classList.remove("mood-idle", "mood-yay", "mood-oops", "mood-think");
    h.classList.add("mood-" + mood);
  });
}

// ---------- screens ----------
function showScreen(id) {
  ["screen-start", "screen-picks", "screen-game", "screen-end"].forEach(function (sid) {
    var el = $(sid);
    var on = sid === id;
    el.classList.toggle("active", on);
    if (on) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  });
}

function buildRoundPicks(intoId, onPick) {
  var box = $(intoId);
  box.innerHTML = "";
  ROUND_INFO.forEach(function (r, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "round-card";
    b.setAttribute("aria-label", r.name + (r.range ? " " + r.range : ""));
    b.innerHTML = '<span class="round-sym">' + r.symbol + "</span>" +
      '<span class="round-word">' + r.name + "</span>" +
      '<span class="round-num">' + (r.range || "") + "</span>";
    b.addEventListener("click", function () { onPick(i); });
    box.appendChild(b);
  });
}

function renderPips() {
  var html = "";
  var i;
  for (i = 0; i < HOPS_TO_CROSS; i++) {
    var cls = "pip";
    if (i < state.hops) cls += " done";
    else if (i === state.hops) cls += " now";
    html += '<span class="' + cls + '"></span>';
  }
  $("hop-pips").innerHTML = html;
  $("hop-pips").setAttribute("aria-label", "Hop " + Math.min(state.hops + 1, HOPS_TO_CROSS) + " of " + HOPS_TO_CROSS);
}

function placeFrogHome() {
  var frog = $("frog");
  if (!frog) return;
  frog.classList.remove("hopping");
  frog.style.left = "50%";
  frog.style.top = (84 - state.hops * 5) + "%";
  frog.style.transform = "translate(-50%, -50%)";
}

function renderHop() {
  var hop = state.current;
  $("target").textContent = String(hop.target);
  $("target").parentNode.setAttribute("aria-label", "Hop to " + hop.target);
  var info = ROUND_INFO[state.roundIndex];
  $("wave-chip").textContent = info.name + (info.range ? " " + info.range : "");
  var box = $("pads");
  box.innerHTML = "";
  box.className = "pads n" + hop.pads.length;
  hop.pads.forEach(function (p, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pad";
    b.dataset.i = String(i);
    b.innerHTML = '<span class="pad-leaf" aria-hidden="true"></span><span class="pad-text">' + p.text + "</span>";
    b.setAttribute("aria-label", p.text);
    b.addEventListener("click", function () { onPad(i, b); });
    box.appendChild(b);
  });
  renderPips();
  placeFrogHome();
  $("pond").style.setProperty("--hop", String(state.hops));
  state.locked = false;
  setFrogMood("idle");
}

function splashAt(el) {
  var pond = $("pond");
  var fx = $("fx");
  if (!pond || !fx || !el) return;
  var r = el.getBoundingClientRect();
  var p = pond.getBoundingClientRect();
  var s = document.createElement("div");
  s.className = "splash";
  s.style.left = (r.left + r.width / 2 - p.left) + "px";
  s.style.top = (r.top + r.height / 2 - p.top) + "px";
  fx.appendChild(s);
  window.setTimeout(function () { s.remove(); }, 600);
}

function hopFrogTo(padEl, done) {
  var frog = $("frog");
  var pond = $("pond");
  if (!frog || !pond || !padEl) {
    done();
    return;
  }
  if (state.reduceMotion) {
    done();
    return;
  }
  var pr = pond.getBoundingClientRect();
  var to = padEl.getBoundingClientRect();
  var x = ((to.left + to.width / 2 - pr.left) / pr.width) * 100;
  var y = ((to.top + to.height / 2 - pr.top) / pr.height) * 100;
  frog.classList.add("hopping");
  frog.style.left = x + "%";
  frog.style.top = y + "%";
  window.setTimeout(function () {
    frog.classList.remove("hopping");
    playLand();
    done();
  }, HOP_MS);
}

function replacePad(i, el) {
  var kind = ROUND_INFO[state.roundIndex].kind;
  var target = state.current.target;
  var usedA = {};
  var usedT = {};
  state.current.pads.forEach(function (p) {
    usedA[p.value] = true;
    usedT[p.text] = true;
  });
  var d = makeDistractor(kind, target, usedA, usedT);
  state.current.pads[i] = d;
  el.classList.remove("sink");
  var text = el.querySelector(".pad-text");
  if (text) text.textContent = d.text;
  el.setAttribute("aria-label", d.text);
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  playPop();
}

function onPad(i, el) {
  if (state.locked) return;
  if (!$("screen-game").classList.contains("active")) return;
  var pad = state.current.pads[i];
  if (!pad) return;
  if (pad.ok) {
    state.locked = true;
    el.classList.add("right");
    playHop();
    setFrogMood("yay");
    hopFrogTo(el, function () {
      state.hops += 1;
      renderPips();
      if (state.hops >= HOPS_TO_CROSS) {
        window.setTimeout(endRound, 280);
      } else {
        window.setTimeout(function () {
          buildHop();
          renderHop();
        }, 220);
      }
    });
    return;
  }
  state.splashes += 1;
  playSplash();
  setFrogMood("oops");
  splashAt(el);
  el.classList.add("sink");
  window.setTimeout(function () {
    replacePad(i, el);
    window.setTimeout(function () { setFrogMood("idle"); }, 240);
  }, SINK_MS);
}

function startRound(index) {
  unlockAudio();
  state.roundIndex = index;
  state.hops = 0;
  state.splashes = 0;
  state.asked = [];
  state.locked = true;
  showScreen("screen-game");
  buildHop();
  renderHop();
}

function endRound() {
  showScreen("screen-end");
  setFrogMood("yay");
  playYay();
  var extra = state.splashes ? " · " + state.splashes + " splash" + (state.splashes === 1 ? "" : "es") : "";
  $("end-line").textContent = HOPS_TO_CROSS + " hops across the pond" + extra;
}

function onKey(e) {
  if (e.repeat) return;
  if (e.key === "m" || e.key === "M") {
    setMuted(!state.muted);
    return;
  }
  if (!$("screen-game").classList.contains("active") || state.locked) return;
  var n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4) {
    var btns = $("pads").querySelectorAll("button.pad");
    var btn = btns[n - 1];
    if (btn && !btn.classList.contains("sink")) {
      onPad(Number(btn.dataset.i), btn);
    }
  }
}

function boot() {
  state.reduceMotion = prefersReduce();
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      var onChange = function (ev) { state.reduceMotion = !!(ev && ev.matches); };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (err) {}
  }

  buildRoundPicks("round-picks", startRound);
  $("btn-start").addEventListener("click", function () {
    unlockAudio();
    showScreen("screen-picks");
  });
  $("btn-again").addEventListener("click", function () { startRound(state.roundIndex); });
  $("btn-picks").addEventListener("click", function () { showScreen("screen-picks"); });
  document.querySelectorAll("[data-back=picks]").forEach(function (b) {
    b.addEventListener("click", function () { showScreen("screen-start"); });
  });
  $("btn-mute").addEventListener("click", function () { setMuted(!state.muted); });
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", function () { unlockAudio(); }, true);
  document.addEventListener("touchstart", unlockAudio, true);

  try {
    if (localStorage.getItem("lilyhop-muted") === "1") setMuted(true);
  } catch (e) {}

  var params = new URLSearchParams(window.location.search);
  var shot = params.get("shot");
  if (shot === "game") {
    var round = parseInt(params.get("round") || "1", 10) - 1;
    if (isNaN(round) || round < 0 || round >= ROUND_INFO.length) round = 0;
    startRound(round);
  } else if (shot === "end") {
    state.hops = HOPS_TO_CROSS;
    state.splashes = 1;
    endRound();
  } else if (shot === "picks") {
    showScreen("screen-picks");
  }
}

document.addEventListener("DOMContentLoaded", boot);
