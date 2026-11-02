# Publishing YGO Scanner to Google Play (internal testing)

Internal testing makes the app installable from the Play Store, with automatic updates, for up to
100 testers you choose (for example just yourself). It is not visible in Play search, and it has no
"12 testers for 14 days" requirement.

## What you need (in the `ygo-scanner-play` package)

| File | Used for |
|---|---|
| `app-release.aab` | The app bundle you upload |
| `ygo-scanner-upload.jks` + `upload-key-password.txt` | Your **upload key**. Keep both somewhere safe (not in GitHub). They're needed to sign future updates. |
| `icon-512.png` | App icon |
| `feature-graphic-1024x500.png` | Feature graphic |
| `screenshot-*.png` | Phone screenshots |

## 1. Create a developer account (one time)
1. Go to <https://play.google.com/console> and sign in with your Google account.
2. Choose a **personal** account, pay the one-time **US$25** fee, and complete identity verification
   (this can take a day or two).

## 2. Create the app
1. **Create app**
   - App name: `YGO Scanner`
   - Default language: English
   - App or game: **App**; Free or paid: **Free**
2. Accept the declarations, then **Create app**.

## 3. Upload the first internal test release
1. Left menu: **Test and release → Testing → Internal testing → Create new release**.
2. When asked about app signing, keep **Google-generated key (Play App Signing)**, which is the default.
   Google then holds the real signing key, and your `.jks` file is only the *upload* key.
   If you ever lose the upload key, Google support can reset it.
3. Upload `app-release.aab`.
4. Release name: `1.2 (4)`. Release notes: `First internal test release.`
5. **Next → Save → Go to overview / Publish** (or **Start rollout to Internal testing**).

## 4. Add yourself as a tester and install
1. **Internal testing → Testers** tab → **Create email list**. Add your Gmail address, then save.
2. Copy the **"Join on the web"** link and open it on your phone, signed in with that Gmail account.
   Tap **Accept invite**, then **Download it on Google Play**.
3. **Before installing from Play, uninstall the YGO Scanner APK you installed from the website.**
   The Play version is signed by Google, so Android won't install it over the website APK.
   This clears your scan history.

## 5. App content forms (Policy → App content)
Play may ask for these before or after the first release. These are the answers that fit this app:

- **Privacy policy:** `https://zetsuu123.github.io/ygo-scanner/privacy.html`
- **App access:** All functionality is available without special access (no login).
- **Ads:** No, the app doesn't contain ads.
- **Content rating:**
  - Fill in the questionnaire with your email.
  - Category: **"All other app types"**.
  - Answer **No** to violence, sexuality, language, drugs, gambling and user interaction or sharing questions.
  - Expected result: Everyone / PEGI 3.
- **Target audience:** **18 and over**. This keeps Google's children's-app rules out of scope.
- **Data safety:**
  - Does your app collect or share any of the required user data types? → **Yes**
  - Data type: **App activity → In-app search history**. These are the card codes or names sent to the card database to look up a card.
    - Collected: **Yes**. Shared: **No**.
    - Processed ephemerally: **Yes**.
    - Required (users can't turn it off): **Yes**.
    - Purpose: **App functionality**.
  - Is all data encrypted in transit? → **Yes**.
  - Can users request deletion? → **No**. Nothing is stored on a server; history stays on the phone.
  - Camera images are processed only on the device and are **not** collected. Don't declare photos.
- **Government apps / Financial features / Health / News:** No / None.

## 6. Store listing (Grow users → Store presence → Main store listing)
- **App name:** `YGO Scanner`
- **Short description** (max 80 characters):
  `Scan a card's set code and jump straight to it on Cardmarket, with prices.`
- **Full description:**

  ```
  Point your camera at a trading card and YGO Scanner reads the set code printed
  under the artwork (for example LOB-EN001) or the 8-digit passcode, finds the card
  and takes you straight to it on Cardmarket.

  • Fast scanning with on-device text recognition. Your camera images never leave your phone.
  • Shows the card, set and rarity, plus Cardmarket's price for that printing.
  • Opens the exact Cardmarket product page.
  • "Sellers from" filter: only show offers from sellers in your country.
  • Type a set code, passcode or card name if you prefer.
  • Recent scans list, flashlight toggle, photo upload.

  Card data from YGOPRODeck. Not affiliated with Konami or Cardmarket.
  ```

- **App icon:** `icon-512.png`
- **Feature graphic:** `feature-graphic-1024x500.png`
- **Phone screenshots:** the four `screenshot-*.png` files
- **App category:** Tools (or Shopping). **Contact email:** your email.

## Updating the app later
- **Scanner changes** (almost everything) are published on the website, and the app loads them
  automatically. No new Play release is needed.
- **Changes to the Android app itself** need a new bundle with a higher `versionCode`:
  1. Put `ygo-scanner-upload.jks` somewhere on the build machine.
  2. Create `android/keystore.properties` (it's git-ignored, never commit it):

     ```
     storeFile=/path/to/ygo-scanner-upload.jks
     storePassword=<password>
     keyAlias=upload
     keyPassword=<password>
     ```

  3. Bump `versionCode` in `android/app/build.gradle`.
  4. Run `./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.
  5. Upload it as a new internal testing release.
- The website APK (`ygo-scanner/ygo-scanner.apk`) is built with `./gradlew assembleSideload` and keeps
  the old debug signature, so it still installs over earlier website APKs.

Upload key SHA-256 fingerprint (for reference):
`E4:EC:70:94:DA:CB:C6:6B:C6:5B:76:94:0E:15:D8:E2:CE:E7:76:D7:38:E3:3C:B8:4C:18:A5:6E:AA:9F:12:52`
