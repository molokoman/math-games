/**
 * Zap City Firebase web config.
 *
 * Firebase web config objects are public-by-design (they identify the app).
 * THIS FILE IS A PLACEHOLDER until a real Firebase project exists.
 *
 * James: create the project in Firebase Console, then paste the web app
 * config object below (Project settings > Your apps > Firebase SDK snippet).
 * Do not invent keys. Sign-in will show a setup message until real values
 * are pasted (it will not fail silently).
 *
 * Exact taps: see zap-city/FIREBASE-SETUP.md
 */
window.ZAPCITY_FIREBASE = {
  apiKey: "PASTE_FROM_FIREBASE_CONSOLE",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

window.ZAPCITY_FIREBASE_READY = (function () {
  var c = window.ZAPCITY_FIREBASE || {};
  function real(v) {
    return typeof v === "string" && v.length > 8 && v.indexOf("PASTE_") !== 0;
  }
  return !!(real(c.apiKey) && real(c.projectId) && real(c.appId));
})();
