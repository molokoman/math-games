/**
 * Zap City — local math game for late 1st / early 2nd grade (~age 7).
 * Open this folder’s index.html (or Star Quest at ../). No server, no login.
 *
 * A math problem falls toward the city. Tap the answer. A laser zaps it.
 * A miss blows up the nearest building. When every building is gone, the wave ends.
 */

// ========== TWEAK THESE ==========
var QUESTIONS_PER_ROUND = 8;
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
  { id: 4, name: "Mix", symbol: "+ −", range: "20", kind: "mix20", fall: "norm" }
];

var NICE = ["⚡", "★", "✓"];
var HIT = ["💥"];

var state = {
  roundIndex: 0,
  qIndex: 0,
  zaps: 0,
  results: [],
  current: null,
  typed: "",
  locked: false,
  inputLock: false,
  muted: false,
  asked: [],
  waveFacts: [],
  card: null,
  fallTimer: null,
  shakeTimer: null,
  reduceMotion: false
};

var audioCtx = null;
var cityBuildings = [];

var CITY_PLAN = [
  { h: 62, hue: "violet" },
  { h: 80, hue: "teal" },
  { h: 54, hue: "blue" },
  { h: 88, hue: "gold" },
  { h: 68, hue: "teal" },
  { h: 76, hue: "violet" },
  { h: 58, hue: "blue" }
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
    total: bandTotal(kind),
    ready: mastered >= 5 && struggle <= 1
  };
}

function bandTotal(kind) {
  var n = 0, s, a, b;
  function addPairs(minSum, maxSum) {
    for (s = minSum; s <= maxSum; s++) n += s - 1;
  }
  function subPairs(minA, maxA) {
    for (a = minA; a <= maxA; a++) n += a;
  }
  if (kind === "add10") addPairs(4, 10);
  else if (kind === "add20") addPairs(10, 20);
  else if (kind === "sub10") subPairs(4, 10);
  else { addPairs(6, 20); subPairs(6, 20); }
  return n;
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

// ---------- audio: HTML wav (iPhone) + Web Audio backup ----------
var htmlSounds = {};

function writeWav(seconds, sampleFn) {
  var rate = 22050;
  var n = Math.floor(rate * seconds);
  var bytes = new Uint8Array(44 + n * 2);
  var v = new DataView(bytes.buffer);
  function str(at, s) { for (var i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); }
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (var i = 0; i < n; i++) {
    var s = sampleFn(i / rate, i, n);
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

function noise01(i, seed) {
  var x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function atariBoomFn(kind) {
  var reg = 9;
  var hold = 1;
  var left = 0;
  var drop = kind === "hit" ? 1.7 : 1.35;
  var fade = kind === "hit" ? 4.2 : 6.4;
  return function (t, i) {
    var period = 1 + Math.floor(Math.pow(Math.min(1, t * 1.8), drop) * 52);
    if (left <= 0) {
      var bit = (reg ^ (reg >> 1)) & 1;
      reg = ((reg >> 1) | (bit << 3)) & 15;
      if (!reg) reg = 1;
      hold = (reg & 1) ? 1 : -1;
      left = period;
    }
    left--;
    var env = Math.exp(-t * fade);
    var crack = t < 0.012 ? ((i & 2) ? 1 : -1) * (1 - t / 0.012) * 0.85 : 0;
    var thumpF = 120 * Math.pow(36 / 120, Math.min(1, t / 0.2));
    var thump = (Math.sin(t * thumpF * 6.283) >= 0 ? 1 : -1) * Math.exp(-t * 8.5) * 0.38;
    return hold * env * 0.9 + crack + thump;
  };
}

function buildSounds() {
  if (htmlSounds.zap) return;
  htmlSounds.zap = (function () {
    var phase = 0;
    return makeSound(0.15, function (t) {
      var f = 1400 * Math.pow(90 / 1400, Math.min(1, t / 0.14));
      phase += f / 22050;
      var sq = (phase % 1 < 0.5) ? 1 : -1;
      var env = Math.exp(-t * 10) * Math.min(1, t / 0.004);
      return sq * env * 0.72;
    });
  })();
  htmlSounds.blast = makeSound(0.32, atariBoomFn("blast"));
  htmlSounds.hit = makeSound(0.52, atariBoomFn("hit"));
  htmlSounds.wrong = makeSound(0.16, function (t) {
    var env = Math.max(0, 1 - t / 0.16);
    return Math.sin(t * (240 - t * 700) * 6.283) * 0.35 * env;
  });
  htmlSounds.click = makeSound(0.03, function (t) {
    var env = Math.exp(-t * 90);
    var sq = Math.sin(t * 1480 * 6.283) >= 0 ? 1 : -1;
    return sq * env * 0.14;
  });
}

function playClick() {
  playHtml("click");
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
    var ctx = null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      if (!audioCtx) audioCtx = new AC();
      ctx = audioCtx;
      if (ctx.state === "suspended") ctx.resume();
    }
  } catch (e) {}
  ["zap", "blast", "hit", "wrong", "click"].forEach(function (n) {
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

function tone(freq, dur, type, vol) {
  var ctx = ensureAudio();
  if (!ctx) return;
  try {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol || 0.28, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  } catch (e) {}
}

function playWrong() {
  playHtml("wrong");
}

function playHit() {
  playHtml("hit");
}

function playPew(when) {
  var ctx = ensureAudio();
  if (!ctx) return;
  try {
    var t0 = ctx.currentTime + (when || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1400, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.14);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.24, t0 + 0.004);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  } catch (e) {}
}

function playZap() {
  playHtml("zap");
  playPew(0);
  playPew(0.055);
}

function playBlast() {
  playHtml("blast");
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
  ["screen-start", "screen-picks", "screen-game", "screen-end", "screen-facts"].forEach(function (sid) {
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
    b.className = "btn primary huge round-card";
    b.setAttribute("aria-label", r.name + (r.range ? " " + r.range : ""));
    b.innerHTML = '<span class="round-sym">' + r.symbol + '</span>' +
      '<span class="round-word">' + r.name + '</span>' +
      '<span class="round-num">' + (r.range || "") + '</span>';
    b.addEventListener("click", function () { onPick(i); });
    box.appendChild(b);
  });
}


function paintHomeLaser() {
  var hero = document.querySelector(".home-hero");
  var svg = hero && hero.querySelector(".intro-laser");
  var line = svg && svg.querySelector(".beam");
  var title = document.querySelector("#screen-start .title");
  var buildings = document.querySelectorAll("#intro-buildings .building");
  if (!hero || !svg || !line || !title || !buildings.length) return;
  var hr = hero.getBoundingClientRect();
  if (hr.width < 8 || hr.height < 8) return;
  svg.setAttribute("viewBox", "0 0 " + Math.round(hr.width) + " " + Math.round(hr.height));
  svg.setAttribute("width", String(Math.round(hr.width)));
  svg.setAttribute("height", String(Math.round(hr.height)));
  var b = buildings[3] || buildings[Math.floor(buildings.length / 2)];
  var tip = b.querySelector(".b-spire") || b.querySelector(".b-body") || b;
  var tr = tip.getBoundingClientRect();
  var tt = title.getBoundingClientRect();
  var x1 = tr.left + tr.width / 2 - hr.left;
  var y1 = tr.top - hr.top;
  var x2 = tt.left + tt.width * 0.55 - hr.left;
  var y2 = tt.bottom - 6 - hr.top;
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  var len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  line.style.strokeDasharray = String(Math.max(40, len));
  line.style.strokeDashoffset = String(Math.max(40, len));
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
      '<div class="b-spire" aria-hidden="true"></div>' +
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
function standingCount() {
  var n = 0;
  cityBuildings.forEach(function (b) {
    if (!b.classList.contains("wrecked")) n += 1;
  });
  return n;
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
  if ($("round-chip")) $("round-chip").textContent = chipLabel(info);
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
  var tipEl = building.querySelector(".b-spire") || building.querySelector(".b-body") || building;
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
  card.style.animation = "none";
  card.textContent = state.current.prompt;
  box.appendChild(card);
  if (state.current && state.waveFacts.indexOf(state.current.prompt) === -1) {
    state.waveFacts.push(state.current.prompt);
  }
  var skyQ = $("sky-problem");
  if (skyQ) skyQ.textContent = state.current.prompt;

  var field = $("playfield");
  var maxLeft = Math.max(8, field.clientWidth - card.offsetWidth - 8);
  card.style.left = rand(8, maxLeft) + "px";
  var fieldR = field.getBoundingClientRect();
  var cardR = card.getBoundingClientRect();
  var roofB = closestBuilding(cardR.left + cardR.width / 2);
  var body = roofB && roofB.querySelector(".b-body");
  var roofTop = body ? body.getBoundingClientRect().top : ($("city").getBoundingClientRect().bottom - 10);
  var dist = roofTop - cardR.top - card.offsetHeight + 6;
  if (dist < field.clientHeight * 0.55) dist = field.clientHeight - ($("city").offsetHeight || 80) - card.offsetHeight + 18;
  if (dist < 80) dist = 80;
  card.style.setProperty("--fall-distance", dist + "px");
  state.card = card;

  var ms = fallDuration();
  if (state.reduceMotion) {
    card.style.transform = "translate3d(0, " + Math.round(dist) + "px, 0)";
    state.fallTimer = window.setTimeout(function () { onCityHit(); }, ms);
  } else {
    void card.offsetWidth;
    card.style.animation = "";
    card.style.animationDuration = ms + "ms";
    card.addEventListener("animationend", onFallEnd);
  }

  setZipMood("think");
  say("game", "");
}

function startRound(index) {
  unlockAudio();
  stopFalling();
  state.roundIndex = index;
  state.qIndex = 0;
  state.zaps = 0;
  state.results = [];
  state.asked = [];
  state.waveFacts = [];
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
    var box = $("problems").getBoundingClientRect();
    var cardR = card.getBoundingClientRect();
    card.style.animation = "none";
    card.style.top = (cardR.top - box.top) + "px";
    card.style.left = (cardR.left - box.left) + "px";
    card.style.transform = "none";
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
  state.results.push("miss");
  if (state.card) {
    state.card.classList.remove("shake");
    void state.card.offsetWidth;
    state.card.classList.add("shake");
  }
  renderHud();
  var left = standingCount();
  if (doomed && !doomed.classList.contains("wrecked")) left -= 1;
  window.setTimeout(function () {
    if (left <= 0) endRound();
    else advance();
  }, HIT_PAUSE_MS);
}

function advance() {
  stopFalling();
  state.qIndex += 1;
  if (state.qIndex >= QUESTIONS_PER_ROUND || standingCount() <= 0) {
    endRound();
    return;
  }
  state.current = nextQuestion(ROUND_INFO[state.roundIndex].kind);
  spawnProblem();
}

function paintEndCity() {
  fillBuildings($("end-buildings"), false);
  var box = $("end-buildings");
  if (!box) return;
  var kids = box.children;
  cityBuildings.forEach(function (b, i) {
    if (kids[i] && b.classList.contains("wrecked")) kids[i].classList.add("wrecked");
  });
}

function endRound() {
  stopFalling();
  showScreen("screen-end");
  setZipMood(standingCount() <= 0 ? "oops" : "yay");
  var earned = state.zaps;
  $("end-zaps").textContent = "⚡ " + earned;
  paintEndCity();
  paintEndFacts();
}

function factChip(prompt, status, asButton) {
  var el = document.createElement(asButton ? "button" : "span");
  if (asButton) el.type = "button";
  var cls = status === "struggle" ? "struggle" : status === "mastered" ? "mastered" : "learning";
  el.className = "fact-chip " + cls;
  el.textContent = (cls === "mastered" ? "★ " : cls === "struggle" ? "! " : "") + prompt;
  return el;
}

function paintEndFacts() {
  var box = $("end-facts");
  if (!box) return;
  box.innerHTML = "";
  var map = loadFacts();
  (state.waveFacts || []).forEach(function (k) {
    var row = map[k];
    box.appendChild(factChip(k, factStatus(row)));
  });
}

function paintFactBook() {
  var bands = $("facts-bands");
  if (!bands) return;
  bands.innerHTML = "";
  ROUND_INFO.forEach(function (info, i) {
    if (info.kind === "mix20" && i > 0 && ROUND_INFO[i - 1].kind === "mix20") return;
    var wrap = document.createElement("div");
    wrap.className = "fact-band";
    var h = document.createElement("h3");
    var stats = bandStats(info.kind);
    h.textContent = info.name + (info.range ? " " + info.range : "") + "  ·  " + stats.mastered + " / " + stats.total + " mastered";
    wrap.appendChild(h);
    var row = document.createElement("div");
    row.className = "fact-row";
    var map = loadFacts();
    var keys = Object.keys(map).filter(function (k) { return map[k].kind === info.kind; });
    if (keys.length) {
      keys.sort().forEach(function (k) { row.appendChild(factChip(k, factStatus(map[k]))); });
      wrap.appendChild(row);
    }
    bands.appendChild(wrap);
  });
}

function openFacts(from) {
  stopFalling();
  paintFactBook();
  state.factsFrom = from || "screen-start";
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
    playClick();
    onBackspace();
    return;
  }
  if (e.key >= "0" && e.key <= "9") {
    playClick();
    onDigit(e.key);
  }
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
  paintHomeLaser();
  window.addEventListener("resize", paintHomeLaser);
  buildPad();
  buildRoundPicks("round-picks", startRound);
  $("btn-start").addEventListener("click", function () {
    unlockAudio();
    showScreen("screen-picks");
  });
  $("btn-again").addEventListener("click", function () { startRound(state.roundIndex); });
  $("btn-picks").addEventListener("click", function () {
    stopFalling();
    showScreen("screen-picks");
  });
  document.querySelectorAll("[data-back=picks]").forEach(function (b) {
    b.addEventListener("click", function () { showScreen("screen-start"); });
  });
  $("btn-mute").addEventListener("click", function () { setMuted(!state.muted); });
  if ($("btn-facts")) $("btn-facts").addEventListener("click", function () { openFacts("screen-start"); });
  document.querySelectorAll("[data-back=facts]").forEach(function (b) {
    b.addEventListener("click", function () {
      showScreen(state.factsFrom || "screen-start");
      say("start", "");
    });
  });
  if ($("end-mastery")) {
    $("end-mastery").addEventListener("click", function () { openFacts("screen-end"); });
    $("end-mastery").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFacts("screen-end"); }
    });
  }
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", function (e) {
    unlockAudio();
    var btn = e.target.closest("button, .round-card, .pad-key, #end-mastery");
    if (!btn || btn.disabled || (btn.classList && btn.classList.contains("deco"))) return;
    if (btn.classList.contains("pad-key") || (btn.closest && btn.closest("#pad"))) playClick();
    else playZap();
  }, true);
  document.addEventListener("touchstart", unlockAudio, true);
  try { localStorage.removeItem("zapcity-muted"); } catch (e) {}
  setMuted(false);

  var params = new URLSearchParams(window.location.search);
  var shot = params.get("shot");
  if (shot === "game") {
    var round = parseInt(params.get("round") || "1", 10) - 1;
    if (isNaN(round) || round < 0 || round >= ROUND_INFO.length) round = 0;
    startRound(round);
  } else if (shot === "end") {
    state.zaps = 7;
    state.roundIndex = 0;
    endRound();
  }
}

document.addEventListener("DOMContentLoaded", boot);
