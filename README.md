# Mazevo Setup Planner

A browser extension for event operations teams who use **Mazévo**. It compares the setup left in each room with the setup each room needs next and tells you what to change, for example "Classroom (30) → Theater (60)", "Remove 20 seats", or "free room, set up any time".

- **No AI and no extra login.** It reads the booking data your signed-in Mazévo tab already loads.
- **Read only.** It never changes anything in Mazévo and sends nothing anywhere. Everything happens in your browser.
- Works in Chrome, Edge, Brave and other Chromium browsers, on Windows and Mac, and in Safari on Mac.

> Unofficial tool. Not affiliated with or endorsed by Mazévo / Gomazevo.

## What it does

- **Flip list.** Every room that needs a different layout or count, what's in it now, when it frees up, what it needs and when setup starts. Sorted in the order rooms free up.
- **Free rooms.** Rooms with nothing in them beforehand, so they can be set up any time.
- **Changeovers during the day.** Rooms with several events that need a flip between them, with a warning when there are less than 30 minutes or none at all.
- **Furniture estimate.** Chairs, 6-ft tables and rounds to bring in or take out, per room and per building. The rules are editable to match how your crew sets rooms.
- **Changed since you last checked.** New, updated and cancelled bookings since the last time you refreshed, highlighted in the list.
- **Checklist.** Tick rooms off as they're done. A progress bar shows how far along you are, and ticks are saved in your browser.
- **Plan ahead.** Tomorrow, or the next 2 or 3 days. On Fridays it offers to plan through Monday, and it carries each room's setup across empty days.
- **Flags.** Bookings on Hold, "Changed in Mazévo" tags, Social Tables room diagram links, headcounts larger than the setup, and counts of 1 that look like typos.
- **Find things fast.** Filter by building, search by room, event or layout, and optionally hide outdoor spaces.
- **Share it.** Copy for Excel or Sheets, download a CSV, or print a crew sheet with tick boxes.
- **One click from Mazévo.** A **Plan setups** button appears on the Manage Operations page, so there's no need to pin the toolbar icon.

## Install

Chrome (or Edge, Brave, or any Chromium browser):

1. **Download the code.** On this page click the green **Code** button, then **Download ZIP**. Unzip it somewhere you'll keep it, such as `Documents\mazevo-setup-planner`.
   *Or with git:* `git clone https://github.com/MuhammadSabihUlHussnain/mazevo-setup-planner.git`
2. Open **`chrome://extensions`** (Edge: `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder. It's the one that contains `manifest.json`.
5. Click the puzzle-piece icon in the toolbar and **pin** "Mazevo Setup Planner".

Don't delete or move the folder afterwards, because Chrome loads the extension from it. To update, replace the folder with the new download and click the reload ↻ icon on the extension's card in `chrome://extensions`. Then reload any open Mazévo tab.

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

1. Sign in to Mazévo (e.g. `https://east.mymazevo.com`). You need access to **Manage Operations**.
2. Click **Plan setups** at the bottom right of Manage Operations, or click the extension's toolbar button.
3. A report tab opens. The extension briefly steps Mazévo through the days it needs, then puts it back on the date it was showing.

At the top of the report:

- **From** is today's date by default, and **Refresh from Mazevo** always moves it to the real date unless you picked one yourself.
- **Plan tomorrow / next 2 days / next 3 days** sets how far ahead to look. Several days show as tabs.
- **Copy**, **CSV** and **Print** export what you see. Copy and CSV include every planned day.
- **⚙ Settings** has the furniture rules and the option to hide outdoor spaces.

## How it decides

- **Setup in the room** = the *Room Setup* service on the **last** booking in that room before the planned day (by teardown end). With several days, a room keeps its setup across days with no events.
- **Needed setup** = the *Room Setup* service on the **first** booking in that room on the planned day (by setup start). Later bookings that need a different setup appear under **Changeovers during the day**.
- Same layout, different number → "Add N seats" / "Remove N seats" (tables for tabling). Different layout → "Old (n) → New (n)".
- **Furniture** per unit of the setup count, by default: Theater 1 chair. Classroom 1 chair and ½ a 6-ft table. Banquet 1 chair and ⅛ of a round. Hollow square / U-shape / conference 1 chair and ½ a table. Tabling 1 table and 2 chairs. Layouts the rules don't match are counted separately.
- **Changed since you last checked** compares with the last refresh in this browser for the same day. Mazévo's own "changed" flag is shown as **Changed in Mazévo**.

It only sees what your Manage Operations view shows, so your saved Operations filters (buildings, service providers) apply. Ticks, settings and the last-seen copy for change tracking are kept in this browser for 3 weeks and never leave it.

## How it works

Mazévo signs its API requests, so the extension does **not** call the API itself. `inject.js` adds `hook.js` to the Mazévo page, where it copies the `GetBookings` responses the page already receives. `content.js` clicks the day arrows to load each day and adds the **Plan setups** button. `planner.js` holds the planning rules, `render.js` builds the report, and `report.js` runs the page.

| File | Purpose |
|---|---|
| `manifest.json` | Extension settings (Manifest V3, only needs access to `*.mymazevo.com`) |
| `inject.js` | Adds `hook.js` to the Mazévo page |
| `hook.js` | Copies booking responses inside the Mazévo page |
| `content.js` | Steps the date, collects bookings, adds the Plan setups button |
| `planner.js` | Planning rules and furniture estimates (no DOM; runs under Node for testing) |
| `report.html`, `render.js`, `report.js` | The report page |
| `background.js` | Opens the report from the toolbar or the Plan setups button |
| `safari/build-safari.sh` | Wraps the extension in a Mac app for Safari (needs Xcode) |

## Troubleshooting

- **"Sign in to Mazevo"**: sign in in the Mazévo tab, then click **Refresh from Mazevo** in the report.
- **"Open Manage Operations in day view"**: the planner reads the day view. Switch back to it if you changed the view.
- **Mazévo tab was open before you installed or updated the extension**: the planner reloads it automatically once.
- **No Plan setups button**: it only shows on Manage Operations in day view. The × hides it until the page reloads.
- **Furniture numbers look off**: open ⚙ Settings and adjust the per-layout numbers.
- If your Mazévo is not on `east.mymazevo.com`, just open your own Mazévo site first. The planner uses whichever `*.mymazevo.com` tab is open.

## License

MIT
