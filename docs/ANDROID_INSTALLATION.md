# Installing on Android

Requirements: Android with **Google Chrome**, and the app served over **HTTPS** (Vercel and the other hosts listed in the README do this automatically).

1. Open the app URL in Chrome and sign in once (cloud mode). Wait until the badge shows **Online · synced**. This downloads the inventory to the phone.
2. Install it either way:
   - Settings tab → **Install app** (shown when Chrome offers it), or
   - Chrome ⋮ menu → **Add to Home screen** → **Install**.
3. Launch it from the home-screen icon. It opens full-screen in portrait, with no browser bar.

## Offline use
- After the first sync, the app opens and searches **with no connection**.
- The badge turns **Offline** and every result says "Offline copy as of <time>", so you always know how old the data is.
- Editing and importing are disabled offline in cloud mode. They re-enable automatically when you reconnect, and the app re-syncs right away.

## Updating the app
New versions install automatically in the background and take effect the next time you open the app.

## Troubleshooting
| Problem | Fix |
|---|---|
| No "Install" option | Make sure the URL is `https://` and you're in Chrome, not an in-app browser (WhatsApp/Telegram). Open the link in Chrome. |
| "Could not open the on-device database" | Incognito mode blocks storage. Use a normal tab. |
| Data looks old | Settings → **Refresh data now**. Check the badge isn't stuck on *Sync failed* (the reason is shown in Settings). |
| Lost phone | Supabase → Authentication → remove the user (or delete them from `authorized_users`). Their cached copy can't sync anymore. |
| Storage cleared by Android | Just open the app online. It re-downloads everything. |
