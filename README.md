# Audio App

A small web app (PWA) for playing your own MP3s in any order you like.

- Add MP3 files. They're stored in the browser on your device and are never uploaded anywhere.
- Build a playlist in any order, with duplicates allowed. Songs play one after another.
- Play/pause, previous/next, jump back or forward 10 seconds, and a seek bar.
- Speed slider from 0.5× to 2×. The pitch changes with speed by default; tick "Keep pitch" to keep it.
- Keeps playing with the screen locked or the app in the background, with lock-screen controls (Media Session API).
- Works offline once loaded.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Put it on your phone (GitHub Pages)

1. Push this repo to GitHub.
2. On GitHub, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then pick `main` and `/ (root)`, and save.
3. After about a minute it's live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link on your phone and install it:
   - **Android (Chrome):** ⋮ menu → *Add to Home screen* / *Install app*.
   - **iPhone (Safari):** Share → *Add to Home Screen*.
5. Open it from the home-screen icon and add your MP3s.

Songs are saved per device and per browser, so you add them once on each phone.

## Background playback notes

- **Android:** keeps playing with the screen off, and the notification and lock screen show play/pause, ±10 s and next/previous.
- **iPhone:** keeps playing when locked, with controls on the lock screen. iOS may stop it if Low Power Mode is very aggressive or the app is swiped away.

## Updating

After you change any file, bump `VERSION` in `sw.js` so phones pick up the new version. You may need to open the app twice.
