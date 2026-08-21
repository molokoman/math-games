# Turn on Google save for Zap City

Kids already play as guests. This finishes the “this app can sign in with Google” step so stars follow James’s class across phones.

Play URL (unchanged, not on the school site):
https://molokoman.github.io/math-games/zap-city/

## What to tap (James)

Use the same Google account the kids already use for school Chromebooks if you can (or your own, then add the kids later).

1. Open https://console.firebase.google.com/
2. Click **Add project** (or **Create a project**).
3. Name it something like `zap-city` or `math-games`.
4. Google Analytics: **off** is fine. Click **Create project**, wait, then **Continue**.
5. On the project overview, click the **Web** icon `</>` (Add app).
6. App nickname: `Zap City`. Do **not** need Firebase Hosting. Click **Register app**.
7. Copy the `firebaseConfig` object (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
8. Paste those six values into `zap-city/js/firebase-config.js` (replace every `PASTE_…` value). Then commit and push.

### Google sign-in

9. Left menu: **Build** → **Authentication**.
10. Click **Get started**.
11. **Sign-in method** → click **Google** → toggle **Enable** → pick a support email → **Save**.

### Authorized domain (required)

12. Authentication → **Settings** → **Authorized domains** → **Add domain**.
13. Type exactly: `molokoman.github.io`
14. Click **Add**. Leave `localhost` there too.

### Firestore (where stars live)

15. Left menu: **Build** → **Firestore Database** (or **Databases & Storage** → **Firestore**).
16. Click **Create database**.
17. Start in **production** mode. Location `us-central1` is fine. Click **Create**.
18. Open the **Rules** tab. Replace the rules with the contents of `zap-city/firestore.rules`, then **Publish**.

That’s it. Reload Zap City, tap **Continue with Google**, and mastery should follow the signed-in kid.

## What the game already does

- Guest play still works with no login (local only).
- Local cache key stays `zapcity-facts-v1`.
- Signed-in: merge local + cloud (union of tries, never wipe) into `users/{uid}/zapcity/facts`.
