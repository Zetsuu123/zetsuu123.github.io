# YGO Scanner – Android app

A small native Android wrapper (WebView) around the web app in [`../ygo-scanner`](../ygo-scanner).
The web files are bundled into the APK at build time and served from
`https://appassets.androidplatform.net/assets/www/` (via `WebViewAssetLoader`) so the camera works.

- Camera permission is requested the first time you tap **Start camera**.
- **Photo** opens the gallery / file picker.
- Cardmarket links open in your browser or the Cardmarket app.
- Needs internet for the card database and (first run only) the OCR engine download.

## Install
Download `ygo-scanner.apk` (also at https://zetsuu123.github.io/ygo-scanner/ygo-scanner.apk),
open it on the phone and allow *Install unknown apps* for your browser/file manager when asked.

## Build
Requires JDK 17+ and the Android SDK (platform 36, build-tools 36).

```sh
cd android
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

The release build is signed with the local debug key so it can be sideloaded without extra setup.
APKs built on a different machine have a different signature: uninstall the old app before installing one
(this clears the scan history).
