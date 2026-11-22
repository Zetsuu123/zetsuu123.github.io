# Home Dashboard

A wall-tablet dashboard for [Home Assistant](https://www.home-assistant.io/), styled after a dark-navy 10" control panel.
It talks to Home Assistant directly over its WebSocket API: no add-ons, no build step, just static files.

Live at **https://zetsuu123.github.io/home/**. It opens in demo mode with a simulated home until you connect.

## What it shows

Everything on the dashboard is defined in **`js/config.js`**, which is set up for this home:

- **Home**: a greeting, the clock, the weather (`weather.forecast_home`), status chips (lights, front door, washer, printer, water heater),
  alerts when the water valve is open or the freezer is warm, indoor and outdoor temperature and humidity, current power use with today's and this month's kWh,
  a card for each room with one button per light, temperature and humidity graphs, the main devices, and the **ΚΛΕΙΣΙΜΟ ΦΩΤΩΝ** / **ΚΛΕΙΣΙΜΟ A/C** buttons pinned at the bottom.
- **Rooms**: Σαλόνι, Κουζίνα, Είσοδος & Διάδρομος, Μπάνιο, Τουαλέτα, Δωμάτιο Ντίνου, Δωμάτιο Ιωάννας and Μπαλκόνι, each with its lights
  (brightness and colour for the Govee lights), sensors and devices (A/C, PC, awning, valve and so on).
- **Pages**: Θερμοσίφωνας, Κλιματισμός, Πότισμα, Ψυγείο, K1C (camera, progress, CFS filament slots, temperatures, controls), Σκούπα (map, controls, room cleaning),
  Δίκτυο, Υπολογιστής, Καταναλώσεις, Μπαταρίες, Αισθητήρες, Κινητά, Μετοχές and Κάτοψη (your `/local/floorplan.svg` with tappable lights).
- **Settings**: connect or disconnect, a name for the greeting, a 24-hour clock, keep-screen-awake, full screen, and which rooms to show.

Until Home Assistant is connected, the dashboard runs a demo with made-up values for the same entities.

## Editing

Open `js/config.js` (for example with the **Studio Code Server** add-on) and edit it. Every room, page and card is listed there with its entity ID,
and the top of the file explains the card types and the `h` helper used for conditions and computed text. Save the file and refresh the page.
If the browser keeps showing the old version, force-refresh with Ctrl+F5.

If `config.js` has no `rooms`, the dashboard builds rooms from your Home Assistant areas instead.

## Connecting

Browsers won't let an `https://` page talk to an `http://` server, so pick the option that fits your setup.

### Option A: use the hosted page (Home Assistant reachable over HTTPS)

Use this if you have Nabu Casa, or your own domain with a certificate.

1. Open https://zetsuu123.github.io/home/ and go to **Settings**.
2. Enter your Home Assistant URL, e.g. `https://xxxx.ui.nabu.casa`.
3. Either:
   - **Sign in with Home Assistant.** First allow this site in `configuration.yaml` and restart:
     ```yaml
     http:
       cors_allowed_origins:
         - https://zetsuu123.github.io
     ```
   - **Use a long-lived access token.** No config change needed. In Home Assistant, go to your profile → **Security** → **Long-lived access tokens** → **Create token**, then paste the token.

### Option B: host it inside Home Assistant (works on plain `http://` on your LAN)

1. Copy this `home/` folder to `/config/www/dashboard/` on your Home Assistant machine.
2. Open `http://homeassistant.local:8123/local/dashboard/index.html`. The URL fills itself in, and **Sign in with Home Assistant** works without any CORS setup.
3. Optional: add it to the sidebar via **Settings → Dashboards → Add dashboard → Webpage**.

## Wall-tablet tips

- Add it to the home screen (Android Chrome: *Install app*; iPad Safari: *Share → Add to Home Screen*). It then launches full screen.
- Turn on **Keep screen awake** in Settings.
- Layouts: full sidebar on wide screens, an icon rail around 1024 px, and a bottom tab bar on phones.

## Privacy

Your Home Assistant URL and token stay in your browser's local storage on that device and go only to your Home Assistant.
Anyone with access to the tablet can use the dashboard, so use a dedicated Home Assistant user for a shared wall panel.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page shell and the whole visual design |
| `js/config.js` | **What the dashboard shows: rooms, pages, cards** |
| `js/app.js` | State, home/room/settings views, actions |
| `js/cards.js` | All card types (tile, light, sensor graph, gauge, climate, …) |
| `js/i18n.js` | Greek and English interface text |
| `js/ha.js` | Home Assistant WebSocket client and OAuth/token auth |
| `js/demo.js` | Demo values generated from config.js |
| `js/morph.js` | Small DOM patcher so animations and sliders survive live updates |
| `js/icons.js` | Inline SVG icon set |
