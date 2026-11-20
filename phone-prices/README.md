# Phone Prices

Search a smartphone once and see the cheapest price across
**Skroutz, BestPrice, Public, Kotsovolos, Plaisio and Germanos**.

Live at: **https://zetsuu123.github.io/phone-prices/** · Android app: [`phone-prices.apk`](phone-prices.apk)
(source in [`../phone-prices-android`](../phone-prices-android))

## Install
Download `phone-prices.apk` on the phone, open it and allow *Install unknown apps* when asked.

The price search only works in the Android app. In a normal browser the page can only link to each
store's search, because browsers don't let one website read another (and the stores' bot protection
blocks servers, so there's no server doing it either).

## How to use
1. Type a model, e.g. `iPhone 16 128GB`, `Galaxy S25`, `Pixel 9a`, and tap **Search**.
2. The **Cheapest option** card shows the lowest in-stock price and where it is. Tap **Open on …** to buy.
3. Below it, every matching phone (each storage size separately) with each store's price, cheapest first.
4. The store chips show how many products each store returned. Tap one for details:
   - **verify**: the store shows a "are you human" check. Tap **Show page**, complete it, tap **Close**:
     the app searches that store again.
   - **Share debug info** sends what the app saw on that store's page. Useful if a store stops working.
5. **Filters** (top right): show out-of-stock, refurbished or non-phone items; turn stores on/off.

Be specific to narrow the list: `iphone 16 pro 256`, `s25 ultra`, `redmi note 14 pro+`.

## How it works
- The Android app opens each store's own search page in a hidden browser view **on your phone**,
  the same as if you opened it yourself, and reads the products from the page (`extract.js`).
  Nothing goes through a server.
- Prices: the most prominent price on each product card that isn't crossed out, an instalment
  (`/μήνα`, `δόσεις`) or a saving (`όφελος`). Skroutz and BestPrice are price-comparison sites:
  they show the lowest price among their shops.
- Phones are told apart from accessories by their titles (storage size like `128GB`, no words like
  `θήκη`, `case`, `tempered glass`, `φορτιστής`, `watch`, `tablet`).
- The same phone from different stores is matched by model and storage, ignoring colour and words like
  `Dual SIM`, `5G`: `APPLE iPhone 16 Dual 5G 128GB Black` = `Apple iPhone 16 5G (8GB/128GB) Μαύρο`.

## Files
| File | What |
| --- | --- |
| `index.html`, `style.css` | the screen |
| `app.js` | searching, matching phones across stores, picking the cheapest |
| `stores.js` | the six stores: search URL, product-link pattern, store-specific hints |
| `extract.js` | runs inside each store's page and returns the products it shows |
| `sw.js`, `manifest.webmanifest` | installable web version |

## When a store stops working
Store websites change. Each store in `stores.js` has a `search` URL and a `product` link pattern:

- **Search URL**: Germanos (`/search-results/?q=`), Skroutz (`/search?keyphrase=`) and BestPrice
  (`/cat/806/mobile-phones.html?q=`, a search inside its phones category) are verified.
  Public, Kotsovolos and Plaisio are best guesses. If one is wrong, the app types the query into that
  store's own search box, then remembers the address it lands on (Filters → *Reset search URLs*
  forgets them).
- **Product pattern**: if a store returns 0 products but shows results, its product links changed.
  Use **Share debug info** on that store: the report has the page's links and a sample product card.

The app loads these files from this site each time it starts, so fixes here reach the app without
reinstalling it.
