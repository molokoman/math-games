/**
 * Zap City Google sign-in + cloud mastery save.
 * Guest play stays local (zapcity-facts-v1). Signed-in kids merge local
 * and cloud (union of tries, never wipe) then sync to
 * users/{uid}/zapcity/facts.
 */
(function () {
  var FACTS_KEY = "zapcity-facts-v1";
  var PUSH_WAIT_MS = 900;
  var MAX_TRIES = 8;

  var auth = null;
  var db = null;
  var currentUser = null;
  var pushTimer = null;
  var pushing = false;
  var pendingMap = null;
  var lastStatus = "";

  function $(id) { return document.getElementById(id); }

  function configReady() {
    return !!(window.ZAPCITY_FIREBASE_READY && window.firebase);
  }

  function firebaseLoaded() {
    return !!(window.firebase && firebase.auth && firebase.firestore);
  }

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(FACTS_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  function saveLocal(map) {
    try { localStorage.setItem(FACTS_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function sameTries(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (Number(a[i]) !== Number(b[i])) return false;
    return true;
  }

  function asTries(row) {
    var t = row && row.tries;
    if (!Array.isArray(t)) return [];
    return t.map(function (x) { return x ? 1 : 0; });
  }

  function isPrefix(shortArr, longArr) {
    if (shortArr.length > longArr.length) return false;
    for (var i = 0; i < shortArr.length; i++) {
      if (Number(shortArr[i]) !== Number(longArr[i])) return false;
    }
    return true;
  }

  function mergeTries(a, b) {
    a = Array.isArray(a) ? a.map(function (x) { return x ? 1 : 0; }) : [];
    b = Array.isArray(b) ? b.map(function (x) { return x ? 1 : 0; }) : [];
    if (!a.length) return b.slice(-MAX_TRIES);
    if (!b.length) return a.slice(-MAX_TRIES);
    if (sameTries(a, b)) return a.slice(-MAX_TRIES);
    if (isPrefix(a, b)) return b.slice(-MAX_TRIES);
    if (isPrefix(b, a)) return a.slice(-MAX_TRIES);
    return a.concat(b).slice(-MAX_TRIES);
  }

  function mergeMaps(local, remote) {
    var out = {};
    var seen = {};
    function addKeys(map) {
      Object.keys(map || {}).forEach(function (k) { seen[k] = true; });
    }
    addKeys(local);
    addKeys(remote);
    Object.keys(seen).forEach(function (k) {
      var L = (local && local[k]) || {};
      var R = (remote && remote[k]) || {};
      out[k] = {
        kind: L.kind || R.kind || "add10",
        tries: mergeTries(asTries(L), asTries(R))
      };
    });
    return out;
  }

  function firstName(user) {
    var n = (user && (user.displayName || user.email)) || "friend";
    n = String(n).trim();
    if (!n) return "friend";
    return n.split(/\s+/)[0];
  }

  function setHint(text) {
    var el = $("account-hint");
    if (el) el.textContent = text || "";
  }

  function setStatus(text, kind) {
    lastStatus = text || "";
    var el = $("account-status");
    if (!el) return;
    el.textContent = lastStatus;
    el.className = "account-status" + (kind ? " " + kind : "");
    el.hidden = !lastStatus;
  }

  function paintAccount() {
    var btn = $("btn-google");
    var signed = $("account-in");
    var hello = $("account-hello");
    var hint = $("account-hint");

    if (currentUser) {
      if (btn) btn.hidden = true;
      if (signed) signed.hidden = false;
      if (hello) hello.textContent = "Hi, " + firstName(currentUser);
      if (hint) hint.hidden = true;
      return;
    }

    if (btn) btn.hidden = false;
    if (signed) signed.hidden = true;
    if (hint) hint.hidden = false;
    if (!window.ZAPCITY_FIREBASE_READY) {
      setHint("Play now. Ask a grown-up to turn on Google save.");
    } else if (!firebaseLoaded()) {
      setHint("Play now. Saving needs the internet.");
    } else {
      setHint("Play now. Save with Google so your stars follow you.");
    }
  }

  function factsDoc(uid) {
    return db.doc("users/" + uid + "/zapcity/facts");
  }

  function applyMerged(merged) {
    saveLocal(merged);
    try {
      if (typeof window.saveFacts === "function") {
        // saveFacts also schedules a push; skip re-entry by writing local only here
        // callers that need a push call schedulePush themselves after merge.
      }
    } catch (e) {}
    return merged;
  }

  function pullAndMerge() {
    if (!currentUser || !db) return Promise.resolve(loadLocal());
    var uid = currentUser.uid;
    return factsDoc(uid).get().then(function (snap) {
      var remote = (snap.exists && snap.data() && snap.data().facts) || {};
      var merged = mergeMaps(loadLocal(), remote);
      saveLocal(merged);
      return merged;
    }).then(function (merged) {
      setStatus("Stars saved", "ok");
      return merged;
    }).catch(function (err) {
      console.warn("[Zap City] cloud pull failed", err);
      setStatus("Couldn't reach save. Playing on this device.", "warn");
      return loadLocal();
    });
  }

  function pushNow(map) {
    if (!currentUser || !db) return Promise.resolve();
    if (pushing) {
      pendingMap = map;
      return Promise.resolve();
    }
    pushing = true;
    var uid = currentUser.uid;
    var local = map || loadLocal();
    var ref = factsDoc(uid);
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var remote = (snap.exists && snap.data() && snap.data().facts) || {};
        var merged = mergeMaps(local, remote);
        tx.set(ref, {
          facts: merged,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return merged;
      });
    }).then(function (merged) {
      saveLocal(merged);
      setStatus("Stars saved", "ok");
    }).catch(function (err) {
      console.warn("[Zap City] cloud push failed", err);
      setStatus("Couldn't save stars. They're safe on this device.", "warn");
    }).then(function () {
      pushing = false;
      if (pendingMap) {
        var next = pendingMap;
        pendingMap = null;
        return pushNow(next);
      }
    });
  }

  function schedulePush(map) {
    if (!currentUser || !db) return;
    pendingMap = map || loadLocal();
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      var m = pendingMap;
      pendingMap = null;
      pushNow(m);
    }, PUSH_WAIT_MS);
  }

  function setupErrorMessage() {
    return "Ask a grown-up to finish Google save (Firebase). Play still works.";
  }

  function signIn() {
    if (!window.ZAPCITY_FIREBASE_READY) {
      setStatus(setupErrorMessage(), "warn");
      console.warn("[Zap City] Firebase web config is still a placeholder. See zap-city/FIREBASE-SETUP.md");
      return;
    }
    if (!firebaseLoaded() || !auth) {
      setStatus("Couldn't sign in. Check the internet and try again.", "warn");
      return;
    }
    setStatus("Opening Google…", "");
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    var mobile = false;
    try {
      mobile = window.matchMedia("(pointer: coarse)").matches ||
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
    } catch (e) {}
    var go = mobile ? auth.signInWithRedirect(provider) : auth.signInWithPopup(provider);
    Promise.resolve(go).catch(function (err) {
      if (err && err.code === "auth/popup-blocked") {
        return auth.signInWithRedirect(provider);
      }
      if (err && err.code === "auth/popup-closed-by-user") {
        setStatus("Sign-in closed. Tap Google to try again.", "warn");
        return;
      }
      console.warn("[Zap City] sign-in failed", err);
      setStatus("Couldn't sign in. Try again.", "warn");
    });
  }

  function signOut() {
    if (!auth) {
      currentUser = null;
      paintAccount();
      return;
    }
    auth.signOut().catch(function (err) {
      console.warn("[Zap City] sign-out failed", err);
    });
  }

  function initFirebase() {
    if (!window.ZAPCITY_FIREBASE_READY) {
      console.warn("[Zap City] Google save is not connected yet. Paste a real Firebase web config into js/firebase-config.js (see FIREBASE-SETUP.md). Guest play still works.");
      return false;
    }
    if (!firebaseLoaded()) {
      console.warn("[Zap City] Firebase SDK did not load. Guest play still works.");
      setStatus("Saving needs the internet.", "warn");
      return false;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(window.ZAPCITY_FIREBASE);
      }
      auth = firebase.auth();
      db = firebase.firestore();
      return true;
    } catch (err) {
      console.warn("[Zap City] Firebase init failed", err);
      setStatus("Couldn't start Google save. Play still works.", "warn");
      return false;
    }
  }

  function onAuth(user) {
    currentUser = user || null;
    paintAccount();
    if (!currentUser) {
      setStatus("");
      return;
    }
    pullAndMerge().then(function (merged) {
      schedulePush(merged);
    });
  }

  function bindUi() {
    var btn = $("btn-google");
    if (btn && !btn.getAttribute("data-bound")) {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        signIn();
      });
    }
    var out = $("btn-signout");
    if (out && !out.getAttribute("data-bound")) {
      out.setAttribute("data-bound", "1");
      out.addEventListener("click", function (e) {
        e.preventDefault();
        signOut();
      });
    }
  }

  function boot() {
    bindUi();
    paintAccount();
    if (!initFirebase()) return;
    auth.getRedirectResult().catch(function (err) {
      if (err && err.code !== "auth/popup-closed-by-user") {
        console.warn("[Zap City] redirect sign-in failed", err);
        setStatus("Couldn't sign in. Try again.", "warn");
      }
    });
    auth.onAuthStateChanged(onAuth);
  }

  window.ZapCloud = {
    boot: boot,
    schedulePush: schedulePush,
    mergeMaps: mergeMaps,
    user: function () { return currentUser; }
  };
})();
