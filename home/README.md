# Home Dashboard

A wall-tablet dashboard for [Home Assistant](https://www.home-assistant.io/), styled after a dark-navy 10" control panel.
It talks to Home Assistant directly over its WebSocket API: no add-ons, no build step, just static files.

Live at **https://zetsuu123.github.io/home/**. It opens in demo mode with a simulated home until you connect.

## What it shows

- **Home**: a greeting, the clock and date, outdoor weather (first `weather.*` entity), network and Home Assistant status,
  average indoor temperature and humidity, how many lights are on, and a card for each area
  (one bulb per light that you tap to toggle, fan status, temperature and humidity, and an "Offline" badge if every device in the area is unavailable).
  "All Lights Off" and "All Fans Off" buttons stay pinned at the bottom.
- **Area pages**: lights with brightness sliders (tinted to the bulb's colour), fans with speed sliders, switches, covers (open/stop/close),
  locks, thermostats (target temperature and HVAC mode), plus sensor and door/motion readouts.
- **Settings**: connect or disconnect, a name for the greeting, a 24-hour clock, keep-screen-awake, full screen, and which areas to show.

Areas, and the devices in them, come from Home Assistant's area, device and entity registries. Hidden, disabled and diagnostic/config entities are left out.
Controllable devices that aren't in any area appear under "Other". If you set a picture on an area in Home Assistant, the area card uses it as its background.

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
| `js/app.js` | State, rendering, interactions and settings |
| `js/ha.js` | Home Assistant WebSocket client and OAuth/token auth |
| `js/demo.js` | The simulated demo home |
| `js/morph.js` | Small DOM patcher so animations and sliders survive live updates |
| `js/icons.js` | Inline SVG icon set |
