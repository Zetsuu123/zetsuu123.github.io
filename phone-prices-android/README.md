# Phone Prices – Android app

Native Android wrapper around the web app in [`../phone-prices`](../phone-prices).

- The screen is the web app, loaded live from https://zetsuu123.github.io/phone-prices/ so fixes arrive
  without reinstalling. If the site can't be reached (offline, or not published yet), it uses the copy
  bundled in the APK (`assets/www`, served from `https://appassets.androidplatform.net/`).
- For each store it searches, the web app calls the `PPBridge` JavaScript interface
  (`MainActivity.Bridge`) to open the store's search page in a hidden *worker* WebView and run the product
  extractor (`extract.js`) in it. Results and page events go back through `window.PPNative.on(...)`.
- Worker WebViews sit behind the app's WebView so they render like a normal page. They have no
  JavaScript interface, block pop-ups, permission prompts and other-app links, and don't download images
  (product image URLs are read from the page). **Show page** brings one to the front, e.g. to pass a
  store's "are you human" check.
- Product links open in the browser or the store's app.

## Install
Download `phone-prices.apk` (https://zetsuu123.github.io/phone-prices/phone-prices.apk), open it on the
phone and allow *Install unknown apps* when asked.

## Build
Requires JDK 17+ and the Android SDK (platform 36, build-tools 36).

```sh
cd phone-prices-android
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

The release build is signed with the local debug key so it can be sideloaded without extra setup
(or with the key in `keystore.properties`, never committed, if present). APKs built on a different
machine have a different signature: uninstall the old app before installing one.
