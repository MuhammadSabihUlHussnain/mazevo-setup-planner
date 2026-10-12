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

### Safari (Mac)

Safari only runs extensions that are packaged inside a Mac app, so there's one extra step. Pick one option.

**Option A: quick try, no Xcode** (Safari 18 or newer; the extension is removed when you quit Safari)

1. Download and unzip the code as in step 1 above.
2. In Safari open **Settings → Advanced** and tick **Show features for web developers**.
3. Open **Settings → Developer** and click **Add Temporary Extension…**, then pick the unzipped folder.
4. Continue at "Allow it on Mazévo" below.

**Option B: permanent install with Xcode** (free; Xcode is a large download)

1. Install **Xcode** from the Mac App Store and open it once so it can finish setting up.
2. Download and unzip the code, open **Terminal**, and run:
   ```sh
   cd ~/Downloads/mazevo-setup-planner-main     # wherever you unzipped it
   sh safari/build-safari.sh
   ```
   This creates an Xcode project in your home folder called `Mazevo Setup Planner (Safari)` and opens it.
3. In Xcode, select the project in the left sidebar. Then, for **both** targets (the app and the Extension), open **Signing & Capabilities** and set **Team** to your Apple ID. Choose *Add an Account…* if it's not listed; a free Apple ID works.
4. Press **⌘R** (Product → Run). A small "Mazevo Setup Planner" app opens. You can quit it.
5. In Safari open **Settings → Extensions** and tick **Mazevo Setup Planner**.
   - If it isn't listed: turn on **Settings → Advanced → Show features for web developers**, then tick **Settings → Developer → Allow unsigned extensions**. You may need to do this again each time Safari restarts if you skipped the Team step.

**Allow it on Mazévo** (both options)

Safari asks before an extension can read a site. Open your Mazévo site, click the planner's toolbar button (or the puzzle icon next to the address bar), and choose **Always Allow on This Website**. You can also do this from **Settings → Extensions → Mazevo Setup Planner → Edit Websites** by setting `mymazevo.com` to **Allow**.

Then use it exactly like in Chrome. If the toolbar button isn't visible, right-click the Safari toolbar, choose **Customize Toolbar…**, and drag it in.

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

Mazévo signs its API requests, so the extension does **not** call the API itself. `inject.js` adds `hook.js` to the Mazévo page, where it copies the `GetBookings` responses the page already receives. `content.js` clicks the day arrows to load the two days. `planner.js` holds the comparison rules, and `report.html` / `report.js` show the result.

| File | Purpose |
|---|---|
| `manifest.json` | Extension settings (Manifest V3, only needs access to `*.mymazevo.com`) |
| `inject.js` | Adds `hook.js` to the Mazévo page |
| `hook.js` | Copies booking responses inside the Mazévo page |
| `content.js` | Steps the date and collects bookings |
| `planner.js` | Comparison rules (no DOM; runs under Node for testing) |
| `report.html`, `report.js` | The report page |
| `background.js` | Toolbar button |
| `safari/build-safari.sh` | Wraps the extension in a Mac app for Safari (needs Xcode) |

## Troubleshooting

- **"Sign in to Mazevo"**: sign in in the Mazévo tab, then click **Refresh from Mazevo** in the report.
- **"Open Manage Operations in day view"**: the planner reads the day view. Switch back to it if you changed the view.
- **Mazévo tab was open before you installed the extension**: the planner reloads it automatically once.
- If your Mazévo is not on `east.mymazevo.com`, just open your own Mazévo site first. The planner uses whichever `*.mymazevo.com` tab is open.

## License

MIT
