/**
 * Zap City — local math game for late 1st / early 2nd grade (~age 7).
 * Open this folder’s index.html (or Star Quest at ../). No server, no login.
 *
 * A math problem falls toward the city. The kid types the answer on a
 * number pad. Correct: Zip the turret zaps it. If it lands, the city
 * loses a heart (kind voice) and we keep going. 8 problems per round.
 */

// ========== TWEAK THESE ==========
var QUESTIONS_PER_ROUND = 8;
var STARTING_HEARTS = 3;
var FALL_MS = 3000;         // default fall
var SLOW_FALL_MS = 3600;    // round 1
var SPEED_FALL_MS = 2000;   // speed wave
var LASER_TRAVEL_MS = 520;  // long zap, then blast
var POP_MS = 340;           // problem burst after the beam arrives
var WRONG_CLEAR_MS = 300;   // shake, then clear typed digits
var HIT_PAUSE_MS = 1050;    // kind pause after a rooftop boom
var NEXT_PAUSE_MS = 420;    // breath after a zap before the next fall
// =================================

var ROUND_INFO = [
  { id: 1, name: "Addition", symbol: "+", range: "10", kind: "add10", fall: "slow" },
  { id: 2, name: "Addition", symbol: "+", range: "20", kind: "add20", fall: "norm" },
  { id: 3, name: "Subtraction", symbol: "−", range: "10", kind: "sub10", fall: "norm" },
  { id: 4, name: "+ −", symbol: "+ −", range: "20", kind: "mix20", fall: "norm" },
  { id: 5, name: "+ −", symbol: "⚡", range: "+ −", kind: "mix20", fall: "fast" }
];

var NICE = ["⚡", "★", "✓"];
var HIT = ["💥"];

var state = {
  roundIndex: 0,
  qIndex: 0,
  hearts: STARTING_HEARTS,
  zaps: 0,
  results: [],
  current: null,
  typed: "",
  locked: false,
  inputLock: false,
  muted: false,
  asked: [],
  card: null,
  fallTimer: null,
  shakeTimer: null,
  reduceMotion: false
};

var audioCtx = null;
var cityBuildings = [];

var CITY_PLAN = [
  { h: 52, hue: "violet" },
  { h: 70, hue: "teal" },
  { h: 44, hue: "blue" },
  { h: 78, hue: "gold" },
  { h: 58, hue: "teal" },
  { h: 66, hue: "violet" },
  { h: 48, hue: "blue" }
];

// ---------- tiny helpers ----------
function $(id) { return document.getElementById(id); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function uniqueKey(q) { return q.prompt + "=" + q.answer; }

function prefersReduce() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    return false;
  }
}

function fallDuration() {
  var mode = ROUND_INFO[state.roundIndex].fall;
  if (mode === "slow") return SLOW_FALL_MS;
  if (mode === "fast") return SPEED_FALL_MS;
  return FALL_MS;
}


// ---------- mastery (saved on this phone, no login) ----------
var FACTS_KEY = "zapcity-facts-v1";
var MASTER_STREAK = 3;

function loadFacts() {
  try { return JSON.parse(localStorage.getItem(FACTS_KEY) || "{}"); }
  catch (e) { return {}; }
}
function saveFacts(map) {
  try { localStorage.setItem(FACTS_KEY, JSON.stringify(map)); } catch (e) {}
}
function factStatus(row) {
  var t = (row && row.tries) || [];
  if (!t.length) return "new";
  var last2 = t.slice(-2);
  if (last2.length >= 2 && !last2[0] && !last2[1]) return "struggle";
  for (var i = 0; i <= t.length - MASTER_STREAK; i++) {
    if (t[i] && t[i + 1] && t[i + 2]) return "mastered";
  }
  return "learning";
}
function recordFact(prompt, kind, ok) {
  if (!prompt) return "new";
  var map = loadFacts();
  var row = map[prompt] || { kind: kind, tries: [] };
  row.kind = kind;
  row.tries.push(ok ? 1 : 0);
  if (row.tries.length > 8) row.tries = row.tries.slice(-8);
  map[prompt] = row;
  saveFacts(map);
  return factStatus(row);
}
function currentKind() {
  return ROUND_INFO[state.roundIndex] ? ROUND_INFO[state.roundIndex].kind : "add10";
}
function bandStats(kind) {
  var map = loadFacts();
  var mastered = 0, struggle = 0, seen = 0;
  Object.keys(map).forEach(function (k) {
    if (map[k].kind !== kind) return;
    seen += 1;
    var s = factStatus(map[k]);
    if (s === "mastered") mastered += 1;
    if (s === "struggle") struggle += 1;
  });
  return {
    seen: seen,
    mastered: mastered,
    struggle: struggle,
    ready: mastered >= 5 && struggle <= 1
  };
}
function strugglePool(kind) {
  var map = loadFacts();
  var out = [];
  Object.keys(map).forEach(function (k) {
    if (map[k].kind === kind && factStatus(map[k]) === "struggle") out.push(k);
  });
  return out;
}
function parsePrompt(prompt) {
  var m = String(prompt).match(/^(\d+)\s*([+\u2212\-])\s*(\d+)$/);
  if (!m) return null;
  var a = Number(m[1]), b = Number(m[3]);
  var add = m[2] === "+";
  return { prompt: prompt, answer: add ? a + b : a - b };
}

// ---------- questions (same bands as Star Quest; no 0+n, no n−0, no negatives) ----------
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

function masteredPool(kind) {
  var map = loadFacts();
  var out = [];
  Object.keys(map).forEach(function (k) {
    if (map[k].kind === kind && factStatus(map[k]) === "mastered") out.push(k);
  });
  return out;
}

function pickUnused(pool) {
  var i, p, unused = [];
  for (i = 0; i < pool.length; i++) {
    p = parsePrompt(pool[i]);
    if (p && state.asked.indexOf(uniqueKey(p)) === -1) unused.push(p);
  }
  return unused.length ? pick(unused) : null;
}

function nextQuestion(kind) {
  var picked;
  if (Math.random() < 0.5) {
    picked = pickUnused(strugglePool(kind));
    if (picked) {
      state.asked.push(uniqueKey(picked));
      return picked;
    }
  }
  if (Math.random() < 0.28) {
    picked = pickUnused(masteredPool(kind));
    if (picked) {
      state.asked.push(uniqueKey(picked));
      return picked;
    }
  }
  var q, tries = 0;
  do {
    if (kind === "add10") q = makeAdd(10, 4);
    else if (kind === "add20") q = makeAdd(20, 10);
    else if (kind === "sub10") q = makeSub(10, 4);
    else q = Math.random() < 0.55 ? makeAdd(20, 6) : makeSub(20, 6);
    tries++;
  } while (
    tries < 40 &&
    (state.asked.indexOf(uniqueKey(q)) !== -1 ||
      isMasteredPrompt(q.prompt, kind))
  );
  state.asked.push(uniqueKey(q));
  return q;
}

function isMasteredPrompt(prompt, kind) {
  var row = loadFacts()[prompt];
  return !!(row && row.kind === kind && factStatus(row) === "mastered");
}

// ---------- audio (Web Audio beeps — no files) ----------
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

function sweep(from, to, dur, type, when, vol) {
  var ctx = ensureAudio();
  if (!ctx) return;
  var t = ctx.currentTime + (when || 0);
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = type || "sawtooth";
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noiseBurst(dur, when, vol, filterType, freq) {
  var ctx = ensureAudio();
  if (!ctx) return;
  var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  var buf = ctx.createBuffer(1, n, ctx.sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  var src = ctx.createBufferSource();
  src.buffer = buf;
  var filter = ctx.createBiquadFilter();
  filter.type = filterType || "lowpass";
  filter.frequency.value = freq || 800;
  var gain = ctx.createGain();
  var t = ctx.currentTime + (when || 0);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function playWrong() {
  try { sweep(280, 90, 0.18, "square", 0, 0.16); } catch (e) {}
}

function playHit() {
  try { beep(90, 0.18, "square", 0, 0.34); } catch (e) {}
  try { beep(48, 0.4, "sine", 0, 0.32); } catch (e) {}
  try { sweep(180, 40, 0.28, "sawtooth", 0, 0.3); } catch (e) {}
  try { noiseBurst(0.28, 0, 0.42, "lowpass", 420); } catch (e) {}
  try { noiseBurst(0.1, 0, 0.22, "lowpass", 700); } catch (e) {}
}

function playZap() {
  var dur = Math.max(0.35, LASER_TRAVEL_MS / 1000);
  try { sweep(1400, 380, dur, "sawtooth", 0, 0.48); } catch (e) {}
  try { sweep(2200, 620, dur, "square", 0, 0.32); } catch (e) {}
  try { beep(980, dur, "sawtooth", 0, 0.26); } catch (e) {}
  try { noiseBurst(dur, 0, 0.4, "bandpass", 2200); } catch (e) {}
  try { noiseBurst(dur * 0.85, 0.03, 0.22, "highpass", 1400); } catch (e) {}
}

function playBlast() {
  try { noiseBurst(0.26, 0, 0.55, "lowpass", 800); } catch (e) {}
  try { noiseBurst(0.12, 0, 0.4, "highpass", 1800); } catch (e) {}
  try { sweep(380, 48, 0.32, "sawtooth", 0, 0.42); } catch (e) {}
  try { beep(62, 0.34, "sine", 0, 0.4); } catch (e) {}
  try { beep(160, 0.1, "square", 0, 0.24); } catch (e) {}
}

function flashField() {
  var field = $("playfield");
  if (!field) return;
  field.classList.remove("flash");
  void field.offsetWidth;
  field.classList.add("flash");
}

function setMuted(on) {
  state.muted = !!on;
  var btn = $("btn-mute");
  btn.setAttribute("aria-pressed", state.muted ? "true" : "false");
  btn.setAttribute("aria-label", state.muted ? "Sound is off. Tap to unmute." : "Sound is on. Tap to mute.");
  btn.querySelector(".icon-sound").textContent = state.muted ? "🔇" : "🔊";
  try { localStorage.setItem("zapcity-muted", state.muted ? "1" : "0"); } catch (e) {}
}

// ---------- screens ----------
function showScreen(id) {
  ["screen-start", "screen-game", "screen-end", "screen-facts"].forEach(function (sid) {
    var el = $(sid);
    var on = sid === id;
    el.classList.toggle("active", on);
    if (on) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  });
}

function say(which, text) {
  var el = $("speech-" + which);
  if (!el) return;
  if (el.classList.contains("pic-how")) return;
  if (!text) {
    el.textContent = "";
    el.setAttribute("hidden", "");
    return;
  }
  el.textContent = text;
  el.removeAttribute("hidden");
}

function setZipMood(mood) {
  document.querySelectorAll("[data-zip]").forEach(function (h) {
    h.classList.remove("mood-wave", "mood-think", "mood-yay", "mood-oops", "mood-idle");
    h.classList.add("mood-" + mood);
  });
}

function chipLabel(r) {
  return (r.symbol || "") + (r.range ? " " + r.range : "");
}

function buildRoundPicks(intoId, onPick) {
  var box = $(intoId);
  box.innerHTML = "";
  ROUND_INFO.forEach(function (r, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "round-card";
    b.setAttribute("aria-label", r.name + (r.range ? " " + r.range : ""));
    b.innerHTML = '<span class="round-sym">' + r.symbol + '</span>' +
      '<span class="round-word">' + r.name + '</span>' +
      '<span class="round-num">' + (r.range || "") + '</span>';
    b.addEventListener("click", function () { onPick(i); });
    box.appendChild(b);
  });
}

function paintSky() {
  var sky = $("sky");
  sky.innerHTML = "";
  for (var i = 0; i < 52; i++) {
    var d = document.createElement("div");
    d.className = "sky-dot";
    d.style.left = Math.random() * 100 + "%";
    d.style.top = Math.random() * 100 + "%";
    d.style.animationDelay = (Math.random() * 2.8) + "s";
    d.style.width = d.style.height = (Math.random() * 3 + 2) + "px";
    sky.appendChild(d);
  }
}

function fillBuildings(box, track) {
  if (!box) return [];
  box.innerHTML = "";
  var list = [];
  CITY_PLAN.forEach(function (plan, i) {
    var b = document.createElement("div");
    b.className = "building hue-" + plan.hue;
    b.dataset.building = String(i);
    b.style.height = plan.h + "%";
    var win = "";
    var rows = 3 + (i % 3);
    for (var r = 0; r < rows * 2; r++) win += '<span class="win"></span>';
    b.innerHTML =
      '<div class="b-tip"></div>' +
      '<div class="b-antenna"></div>' +
      '<div class="b-body"><div class="b-windows">' + win + "</div></div>" +
      '<div class="b-boom" aria-hidden="true"></div>';
    box.appendChild(b);
    list.push(b);
  });
  if (track) cityBuildings = list;
  return list;
}

function buildCity() {
  fillBuildings($("buildings"), true);
  fillBuildings($("intro-buildings"), false);
  fillBuildings($("end-buildings"), false);
}

function closestBuilding(fromX) {
  var best = null;
  var bestD = 1e9;
  var fallback = null;
  var fallD = 1e9;
  cityBuildings.forEach(function (b) {
    var r = b.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var d = Math.abs(cx - fromX);
    if (d < fallD) {
      fallback = b;
      fallD = d;
    }
    if (b.classList.contains("wrecked")) return;
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  });
  return best || fallback;
}

function resetCity() {
  cityBuildings.forEach(function (b) {
    b.classList.remove("firing", "explode", "wrecked");
  });
}

function buildPad() {
  var box = $("pad");
  box.innerHTML = "";
  var keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, "back", 0, "deco"];
  keys.forEach(function (k) {
    if (k === "deco") {
      var s = document.createElement("div");
      s.className = "pad-key deco";
      s.setAttribute("aria-hidden", "true");
      s.textContent = "⚡";
      box.appendChild(s);
      return;
    }
    var b = document.createElement("button");
    b.type = "button";
    if (k === "back") {
      b.className = "pad-key back";
      b.setAttribute("aria-label", "Backspace");
      b.textContent = "⌫";
      b.addEventListener("click", function () { onBackspace(); });
    } else {
      b.className = "pad-key";
      b.textContent = String(k);
      b.addEventListener("click", function () { onDigit(String(k)); });
    }
    box.appendChild(b);
  });
}

function setPadEnabled(on) {
  $("pad").querySelectorAll("button").forEach(function (b) { b.disabled = !on; });
}

// ---------- HUD ----------
function renderHearts() {
  var html = "";
  for (var i = 0; i < STARTING_HEARTS; i++) {
    html += '<span class="heart' + (i < state.hearts ? "" : " lost") + '" aria-hidden="true">♥</span>';
  }
  $("hearts").innerHTML = html;
  $("hearts").setAttribute("aria-label", state.hearts + " city hearts left");
}

function renderProgress() {
  var html = "";
  for (var i = 0; i < QUESTIONS_PER_ROUND; i++) {
    var cls = "pip";
    if (i < state.results.length) cls += state.results[i] === "zap" ? " done" : " miss";
    else if (i === state.qIndex) cls += " now";
    html += '<span class="' + cls + '"></span>';
  }
  $("progress").innerHTML = html;
}

function renderHud() {
  var info = ROUND_INFO[state.roundIndex];
  $("round-chip").textContent = chipLabel(info);
  renderHearts();
  renderProgress();
}

function renderTyped() {
  var el = $("typed");
  if (!state.typed) {
    el.textContent = "?";
    el.classList.add("empty");
  } else {
    el.textContent = state.typed;
    el.classList.remove("empty");
  }
}

// ---------- fall / laser ----------
function clearFallTimer() {
  if (state.fallTimer) {
    clearTimeout(state.fallTimer);
    state.fallTimer = null;
  }
  if (state.card) {
    state.card.removeEventListener("animationend", onFallEnd);
  }
}

function clearLaser() {
  var line = $("laser-beam");
  if (line) {
    line.classList.remove("firing");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "0");
    line.setAttribute("x2", "0");
    line.setAttribute("y2", "0");
  }
  cityBuildings.forEach(function (b) { b.classList.remove("firing"); });
}

function stopFalling() {
  clearFallTimer();
  $("problems").innerHTML = "";
  state.card = null;
  clearLaser();
  $("city").classList.remove("bonk");
}

function onFallEnd(e) {
  if (e && e.animationName && e.animationName !== "problem-fall") return;
  onCityHit();
}

function fireLaser(card, building) {
  if (state.reduceMotion || !card) return;
  building = building || closestBuilding(card.getBoundingClientRect().left + card.offsetWidth / 2);
  if (!building) return;
  var fieldEl = $("playfield");
  var field = fieldEl.getBoundingClientRect();
  var tipEl = building.querySelector(".b-tip") || building;
  var tip = tipEl.getBoundingClientRect();
  var tgt = card.getBoundingClientRect();
  var layer = $("laser-layer");
  layer.setAttribute("viewBox", "0 0 " + Math.max(1, field.width) + " " + Math.max(1, field.height));
  var x1 = tip.left + tip.width / 2 - field.left;
  var y1 = tip.top + tip.height / 2 - field.top;
  var x2 = tgt.left + tgt.width / 2 - field.left;
  var y2 = tgt.top + tgt.height / 2 - field.top;
  var line = $("laser-beam");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  var len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  line.style.strokeDasharray = String(Math.max(40, len));
  line.style.strokeDashoffset = String(Math.max(40, len));
  line.style.animationDuration = LASER_TRAVEL_MS + "ms";
  line.classList.remove("firing");
  void line.getBoundingClientRect();
  line.classList.add("firing");
  cityBuildings.forEach(function (b) { b.classList.remove("firing"); });
  building.classList.add("firing");
}

function spawnProblem() {
  state.typed = "";
  state.locked = false;
  state.inputLock = false;
  renderTyped();
  renderHud();
  setPadEnabled(true);
  clearLaser();
  $("city").classList.remove("bonk");

  var box = $("problems");
  box.innerHTML = "";
  var card = document.createElement("div");
  card.className = "falling-problem";
  card.textContent = state.current.prompt;
  box.appendChild(card);
  var skyQ = $("sky-problem");
  if (skyQ) skyQ.textContent = state.current.prompt;

  var field = $("playfield");
  var cityH = $("city").offsetHeight || 72;
  var maxLeft = Math.max(8, field.clientWidth - card.offsetWidth - 8);
  card.style.left = rand(8, maxLeft) + "px";
  var dist = field.clientHeight - cityH - card.offsetHeight - 10;
  if (dist < 36) dist = 36;
  card.style.setProperty("--fall-distance", dist + "px");
  state.card = card;

  var ms = fallDuration();
  if (state.reduceMotion) {
    card.style.transform = "translate3d(0, " + Math.round(dist * 0.22) + "px, 0)";
    state.fallTimer = window.setTimeout(function () { onCityHit(); }, ms);
  } else {
    card.style.animationDuration = ms + "ms";
    card.addEventListener("animationend", onFallEnd);
  }

  setZipMood("think");
  say("game", "");
}

function startRound(index) {
  stopFalling();
  state.roundIndex = index;
  state.qIndex = 0;
  state.hearts = STARTING_HEARTS;
  state.zaps = 0;
  state.results = [];
  state.asked = [];
  state.typed = "";
  state.locked = true;
  state.current = nextQuestion(ROUND_INFO[index].kind);
  resetCity();
  showScreen("screen-game");
  setZipMood("think");
  renderHud();
  renderTyped();
  // two frames so the playfield has a real height before we measure the fall
  requestAnimationFrame(function () {
    requestAnimationFrame(spawnProblem);
  });
}

function burstConfetti() {
  var layer = $("confetti");
  var bits = ["✦", "⚡", "★", "✶", "✨"];
  for (var i = 0; i < 16; i++) {
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

function zapCorrect() {
  if (state.locked) return;
  state.locked = true;
  setPadEnabled(false);
  clearFallTimer();
  state.zaps += 1;
  state.results.push("zap");
  if (state.current) recordFact(state.current.prompt, currentKind(), true);
  playZap();
  flashField();
  burstConfetti();
  setZipMood("yay");
  say("game", "");
  renderHud();

  var card = state.card;
  var travel = state.reduceMotion ? 80 : LASER_TRAVEL_MS;
  if (card && !state.reduceMotion) {
    card.style.animationPlayState = "paused";
    var field = $("playfield").getBoundingClientRect();
    var cardR = card.getBoundingClientRect();
    card.style.setProperty("--hold-y", (cardR.top - field.top - 8) + "px");
    var shooter = closestBuilding(cardR.left + cardR.width / 2);
    fireLaser(card, shooter);
    window.setTimeout(function () {
      playBlast();
      if (state.card === card) card.classList.add("pop");
      clearLaser();
    }, travel);
  } else if (card) {
    playBlast();
    card.classList.add("pop");
  }

  window.setTimeout(advance, travel + POP_MS + NEXT_PAUSE_MS);
}


function boomBits(building) {
  var field = $("playfield");
  if (!field || !building) return;
  flashField();
  var r = building.getBoundingClientRect();
  var f = field.getBoundingClientRect();
  var colors = ["#ffe14a", "#ff6b5a", "#2a1848", "#ff3d8a", "#7ad7ff", "#fff"];
  for (var i = 0; i < 18; i++) {
    var el = document.createElement("div");
    el.className = "boom-bit" + (i % 3 === 0 ? " fat" : "");
    el.style.left = (r.left + r.width / 2 - f.left) + "px";
    el.style.top = (r.top + 8 - f.top) + "px";
    el.style.background = colors[i % colors.length];
    el.style.width = rand(10, 22) + "px";
    el.style.height = rand(8, 18) + "px";
    el.style.setProperty("--dx", rand(-90, 90) + "px");
    el.style.setProperty("--dy", rand(-110, 20) + "px");
    el.style.setProperty("--spin", rand(-280, 280) + "deg");
    field.appendChild(el);
    window.setTimeout(function (n) { return function () { n.remove(); }; }(el), 820);
  }
}

function onCityHit() {
  if (state.locked) return;
  state.locked = true;
  setPadEnabled(false);
  clearFallTimer();
  playHit();
  setZipMood("oops");
  var city = $("city");
  city.classList.remove("bonk");
  void city.offsetWidth;
  city.classList.add("bonk");
  var hitX = state.card ? (state.card.getBoundingClientRect().left + state.card.offsetWidth / 2) : 0;
  var doomed = closestBuilding(hitX);
  if (doomed) {
    doomed.classList.remove("explode");
    void doomed.offsetWidth;
    doomed.classList.add("explode");
    boomBits(doomed);
    window.setTimeout(function (b) {
      return function () {
        b.classList.remove("explode", "firing");
        b.classList.add("wrecked");
      };
    }(doomed), 720);
  }
  if (state.current) recordFact(state.current.prompt, currentKind(), false);
  if (state.hearts > 0) state.hearts -= 1;
  state.results.push("miss");
  if (state.card) {
    state.card.classList.remove("shake");
    void state.card.offsetWidth;
    state.card.classList.add("shake");
  }
  renderHud();
  say("game", "");
  window.setTimeout(advance, HIT_PAUSE_MS);
}

function advance() {
  stopFalling();
  state.qIndex += 1;
  if (state.qIndex >= QUESTIONS_PER_ROUND) {
    endRound();
    return;
  }
  state.current = nextQuestion(ROUND_INFO[state.roundIndex].kind);
  spawnProblem();
}

function endRound() {
  stopFalling();
  showScreen("screen-end");
  setZipMood("yay");
  var total = QUESTIONS_PER_ROUND;
  var earned = state.zaps;
  $("end-zaps").textContent = "⚡ " + earned + " / " + total;
  say("end", "");
  $("btn-next").hidden = state.roundIndex >= ROUND_INFO.length - 1;
  paintEndFacts();
}

function factChip(prompt, status) {
  var el = document.createElement("span");
  el.className = "fact-chip " + status;
  el.textContent = (status === "mastered" ? "★ " : status === "struggle" ? "! " : "") + prompt;
  return el;
}

function paintEndFacts() {
  var box = $("end-facts");
  var banner = $("end-ready");
  if (!box) return;
  box.innerHTML = "";
  var kind = currentKind();
  var map = loadFacts();
  var keys = Object.keys(map).filter(function (k) { return map[k].kind === kind; }).slice(-8);
  keys.forEach(function (k) { box.appendChild(factChip(k, factStatus(map[k]))); });
  var stats = bandStats(kind);
  var info = ROUND_INFO[state.roundIndex];
  var nxt = ROUND_INFO[state.roundIndex + 1];
  if (banner) {
    if (stats.ready && nxt) {
      banner.hidden = false;
      banner.textContent = "★ × " + stats.mastered + "  →  " + chipLabel(nxt);
    } else if (stats.mastered) {
      banner.hidden = false;
      banner.textContent = "★ × " + stats.mastered;
    } else {
      banner.hidden = true;
    }
  }
}

function paintFactBook() {
  var bands = $("facts-bands");
  var banner = $("facts-ready");
  if (!bands) return;
  bands.innerHTML = "";
  var readyBits = [];
  ROUND_INFO.forEach(function (info, i) {
    if (info.kind === "mix20" && i > 0 && ROUND_INFO[i - 1].kind === "mix20") return;
    var wrap = document.createElement("div");
    wrap.className = "fact-band";
    var h = document.createElement("h3");
    var stats = bandStats(info.kind);
    h.textContent = chipLabel(info) + "   ★ × " + stats.mastered;
    wrap.appendChild(h);
    var row = document.createElement("div");
    row.className = "fact-row";
    var map = loadFacts();
    var keys = Object.keys(map).filter(function (k) { return map[k].kind === info.kind; });
    if (!keys.length) {
      var empty = document.createElement("p");
      empty.className = "fact-empty";
      empty.textContent = "▶";
      wrap.appendChild(empty);
    } else {
      keys.sort().forEach(function (k) { row.appendChild(factChip(k, factStatus(map[k]))); });
      wrap.appendChild(row);
    }
    if (stats.ready) {
      var next = ROUND_INFO[i + 1];
      readyBits.push(chipLabel(info) + (next ? (" → " + chipLabel(next)) : " ★"));
    }
    bands.appendChild(wrap);
  });
  if (banner) {
    if (readyBits.length) {
      banner.hidden = false;
      banner.textContent = readyBits.join("   ");
    } else {
      banner.hidden = true;
    }
  }
}

function openFacts() {
  stopFalling();
  paintFactBook();
  showScreen("screen-facts");
}

// ---------- pad input ----------
function onDigit(d) {
  if (state.locked || state.inputLock || !state.current) return;
  if (!$("screen-game").classList.contains("active")) return;
  var next = state.typed + d;
  var target = String(state.current.answer);
  state.typed = next;
  renderTyped();
  if (next === target) {
    zapCorrect();
    return;
  }
  // cannot be the start of the right answer (also covers same-length wrong)
  if (target.indexOf(next) !== 0) {
    if (next.length >= target.length && state.current) {
      recordFact(state.current.prompt, currentKind(), false);
    }
    shakeWrong();
  }
}

function onBackspace() {
  if (state.locked || state.inputLock) return;
  if (!state.typed) return;
  state.typed = state.typed.slice(0, -1);
  renderTyped();
}

function shakeWrong() {
  playWrong();
  var el = $("typed");
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  state.inputLock = true;
  if (state.shakeTimer) clearTimeout(state.shakeTimer);
  state.shakeTimer = window.setTimeout(function () {
    state.typed = "";
    renderTyped();
    el.classList.remove("shake");
    state.inputLock = false;
  }, WRONG_CLEAR_MS);
}

function onKey(e) {
  if (e.repeat) return;
  if (e.key === "m" || e.key === "M") {
    setMuted(!state.muted);
    return;
  }
  if (!$("screen-game").classList.contains("active")) return;
  if (e.key === "Backspace") {
    e.preventDefault();
    onBackspace();
    return;
  }
  if (e.key >= "0" && e.key <= "9") onDigit(e.key);
}

// ---------- boot ----------
function boot() {
  state.reduceMotion = prefersReduce();
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      var onChange = function (e) { state.reduceMotion = !!(e && e.matches); };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (err) {}
  }

  paintSky();
  buildCity();
  buildPad();
  buildRoundPicks("round-picks", startRound);
  $("btn-start").addEventListener("click", function () { startRound(0); });
  $("btn-again").addEventListener("click", function () { startRound(state.roundIndex); });
  $("btn-next").addEventListener("click", function () {
    startRound(Math.min(state.roundIndex + 1, ROUND_INFO.length - 1));
  });
  $("btn-picks").addEventListener("click", function () {
    stopFalling();
    showScreen("screen-start");
    setZipMood("wave");
    say("start", "");
  });
  $("btn-mute").addEventListener("click", function () { setMuted(!state.muted); });
  if ($("btn-facts")) $("btn-facts").addEventListener("click", openFacts);
  if ($("btn-facts-end")) $("btn-facts-end").addEventListener("click", openFacts);
  if ($("btn-facts-back")) $("btn-facts-back").addEventListener("click", function () {
    showScreen("screen-start");
    say("start", "");
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", function () { ensureAudio(); }, { once: true });

  try {
    if (localStorage.getItem("zapcity-muted") === "1") setMuted(true);
  } catch (e) {}

  var params = new URLSearchParams(window.location.search);
  var shot = params.get("shot");
  if (shot === "game") {
    var round = parseInt(params.get("round") || "1", 10) - 1;
    if (isNaN(round) || round < 0 || round >= ROUND_INFO.length) round = 0;
    startRound(round);
  } else if (shot === "end") {
    state.zaps = 7;
    state.hearts = 2;
    state.roundIndex = 0;
    endRound();
  }
}

document.addEventListener("DOMContentLoaded", boot);
