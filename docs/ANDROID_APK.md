# Android APK

**Download (always latest):** https://github.com/sbsopex/container-stock-tracker/releases/download/android/container-stock-tracker.apk
Also linked in the app: **Settings → Android app (APK)**.

## How it works
`android/` is a Capacitor 8 shell that loads the live site (`capacitor.config.ts → server.url`).
- Web deploys reach APK users automatically. **No APK rebuild for app changes.**
- Rebuild only when the shell changes (icon, name, Capacitor upgrade): any push touching `android/**` or `capacitor.config.ts`, or run **Actions → Build Android APK → Run workflow**.
- Each build gets `versionCode = run number`, so it installs over the previous one.

## Signing (one-time, required)
The workflow needs 3 repo secrets (Settings → Secrets and variables → Actions → New repository secret):
| Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `release.jks.base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `stocktracker` |

**Back up the keystore + password somewhere safe (e.g. a password manager).** If it's lost, future APKs can't update the installed app; everyone would have to uninstall and reinstall once.

## Installing
Phone → open the download link → open the file → allow "Install unknown apps" for the browser → Install.
Play Protect may warn ("unknown developer"): tap **More details → Install anyway**. That's expected for apps outside the Play Store.
