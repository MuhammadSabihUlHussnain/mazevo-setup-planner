# Mazevo Setup Planner

A Chrome extension for event operations teams who use **Mazévo**. It compares the setup left in each room today with the setup each room needs tomorrow and tells you what to change. For example, "Classroom (30) → Theater (60)", "Remove 20 seats", or "room is empty today, set up any time".

- **No AI and no extra login.** It reads the booking data your signed-in Mazévo tab already loads.
- **Read only.** It never changes anything in Mazévo and sends nothing anywhere. All processing happens in your browser.

> Unofficial tool. Not affiliated with or endorsed by Mazévo / Gomazevo.

## Install

Chrome (or Edge, Brave, or any Chromium browser):

1. **Download the code.** On this page click the green **Code** button, then **Download ZIP**. Unzip it somewhere you'll keep it, such as `Documents\mazevo-setup-planner`.
   *Or with git:* `git clone https://github.com/MuhammadSabihUlHussnain/mazevo-setup-planner.git`
2. Open **`chrome://extensions`** (Edge: `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder. It's the one that contains `manifest.json`.
5. Click the puzzle-piece icon in the toolbar and **pin** "Mazevo Setup Planner".

Don't delete or move the folder afterwards, because Chrome loads the extension from it. To update, download the new version over the old folder and click the reload ↻ icon on the extension's card in `chrome://extensions`.

## Use

1. Sign in to Mazévo in Chrome (e.g. `https://east.mymazevo.com`). You need access to **Manage Operations**.
2. Click the **Mazevo Setup Planner** toolbar button.
3. A report tab opens. The extension briefly steps Mazévo to today and tomorrow to read the bookings, then puts Mazévo back on the date it was showing.

The report groups rooms into:

| Section | Meaning |
|---|---|
| **Flip after today's event** | Used today and needs a different layout or count tomorrow. Shows the current setup, when the room frees up, what it needs and when setup starts. Sorted by when the room frees up. |
| **Not used today** | Can be set up any time. |
| **Check with the requester** | Booked tomorrow but no room setup was ordered. |
| **Already set** | Today's setup already matches tomorrow's. |
| **Not booked tomorrow / no setup either day** | Nothing to do. |

It also flags bookings that aren't confirmed (e.g. on **Hold**) and seat counts of 1 that look like typos.

- **Today is …** lets you plan from another date. It always plans for the day after.
- **Copy for Excel** copies the whole table (paste into Excel or Sheets).
- **Print** gives a clean printout for the setup crew.

## How it decides

- **Current setup** = the *Room Setup* service on the **last** booking in that room today (by teardown end).
- **Needed setup** = the *Room Setup* service on the **first** booking in that room tomorrow (by setup start). Later bookings in the same room are listed as notes.
- Same layout, different number → "Add N seats" / "Remove N seats" (tables for tabling).
- Different layout → "Old (n) → New (n)".
- Other services such as Equipment are shown next to the needed setup.

It only sees what your Manage Operations view shows, so your saved Operations filters (buildings, service providers) apply.

## How it works

Mazévo signs its API requests, so the extension does **not** call the API itself. `hook.js` runs inside the Mazévo page and copies the `GetBookings` responses the page already receives. `content.js` clicks the day arrows to load the two days. `planner.js` holds the comparison rules, and `report.html` / `report.js` show the result.

| File | Purpose |
|---|---|
| `manifest.json` | Extension settings (Manifest V3, only needs access to `*.mymazevo.com`) |
| `hook.js` | Copies booking responses inside the Mazévo page |
| `content.js` | Steps the date and collects bookings |
| `planner.js` | Comparison rules (no DOM; runs under Node for testing) |
| `report.html`, `report.js` | The report page |
| `background.js` | Toolbar button |

## Troubleshooting

- **"Sign in to Mazevo"**: sign in in the Mazévo tab, then click **Refresh from Mazevo** in the report.
- **"Open Manage Operations in day view"**: the planner reads the day view. Switch back to it if you changed the view.
- **Mazévo tab was open before you installed the extension**: the planner reloads it automatically once.
- If your Mazévo is not on `east.mymazevo.com`, just open your own Mazévo site first. The planner uses whichever `*.mymazevo.com` tab is open.

## License

MIT
