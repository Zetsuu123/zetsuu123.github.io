# YGO Card Scanner

A mobile web app (installable PWA) that scans Yu-Gi-Oh! cards with the phone camera,
reads the **set code** (e.g. `LOB-EN001`) or the 8-digit **passcode**, and opens the card on
[Cardmarket](https://www.cardmarket.com/en/YuGiOh).

Live at: **https://zetsuu123.github.io/ygo-scanner/**

## Install on your phone
- **Android (Chrome):** open the link → menu ⋮ → *Install app* / *Add to Home screen*.
- **iPhone (Safari):** open the link → Share → *Add to Home Screen*.

## How to use
1. Tap **Start camera** and allow camera access.
2. Fit the card inside the frame (good light, avoid glare on foils).
3. Tap **Scan card**, or turn on **Auto** to scan continuously until a card is found.
4. Tap **Open on Cardmarket** (search by card name) or **This printing on Cardmarket**
   (direct link to the printing for the scanned set).

You can also take a **Photo**, or type a set code, passcode or card name into the search box.
The **EN/DE/FR/IT/ES** selector picks the Cardmarket site language.

## How it works
- OCR runs on the phone with [Tesseract.js](https://github.com/naptha/tesseract.js); no images are uploaded.
- The app finds short lines of text in the lower part of the card (where set codes and passcodes are printed)
  and reads each one, fixing common OCR mix-ups (`O`/`0`, `I`/`1`, …).
- Codes are checked against the [YGOPRODeck API](https://ygoprodeck.com/api-guide/). Non-English codes
  (e.g. `LOB-DE001`) are mapped to the English printing.
- Scan history is stored only in your browser.

Files: `index.html`, `style.css`, `app.js` (all logic), `sw.js` (offline cache), `manifest.webmanifest`.
