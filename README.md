# Pickora

*by Shenu*

A prize draw application for **any** event: a **public draw board** for the room,
and a password-protected **organiser console** for data, settings and results.

Nothing about the event is baked in. The columns in your entry file become the
fields the board can show, and you choose what appears at each moment of a draw.

There is no database and no internet connection required. Everything lives in
JSON files next to the application, and every font and script is bundled.

---

## The two interfaces

### 1. Public draw board — `/`

The screen the audience sees.

- Large-format reel animation over the event backdrop
- **Start** / **Stop** — Stop asks the server to draw, so the result is recorded once
- Winner reveal with confetti, cycling through five reveal animations
- Optional winners panel and prize counters
- A guest welcome with a photo carousel, for greeting a chief guest
- **New draw** sits beside Start and Stop: clears the results and starts over
  without leaving the board. Offered to a signed-in organiser, or to anyone
  once `draw.allowResetFromBoard` is on; otherwise it explains what is needed
- Keyboard: `Space` / `Enter` start and stop, `W` winners panel, `G` guest
  welcome, `N` new draw, `F` fullscreen
- Survives a refresh — the draw state lives on the server, not in the tab

The board holds **no participant data beyond what it is configured to show**.
It receives only the fields placed in a display slot; everything else in the
record stays on the server.

### 2. Organiser console — `/admin`

Behind a sign-in.

| Section | What it does |
|---|---|
| **Overview** | Live counters, data-health warnings, results table, CSV export, undo last draw, reset draw |
| **Participants** | Download a template, upload the entry list with a column preview, export it, or delete it |
| **Fields** | Rename columns, mark sensitive ones, choose the identifier and what appears in the export |
| **Display** | Choose exactly which fields appear while spinning, on the announcement, on the winner card and in the winners list |
| **Branding** | Upload the logo and backdrop, with size and resolution validated on the server |
| **Welcome** | Greet a chief guest with a message and a carousel of photos |
| **Settings** | Prize count, draw behaviour, colours, alignment, language, animation timings |
| **Wording** | Every string on the draw board |
| **Account** | Change the username and password |

---

## Installing on Windows

Copy the Pickora folder to the PC and double-click:

```
windows\Install-Pickora.bat
```

It checks for a runtime, verifies the files, picks a free port, creates Desktop
and Start Menu shortcuts, and starts the board. After that, day-to-day use is
the **Pickora** shortcut on the Desktop; close its window to stop it.

`windows\Uninstall-Pickora.bat` removes the shortcuts and leaves your data alone.

### Installing with no internet

Pickora needs no downloads of its own — it has **zero package dependencies** and
its fonts are bundled. The only thing a bare PC might lack is **Node.js**.

To cover that, before copying the folder across, put a Node.js Windows installer
into `windows\vendor\`:

1. On any PC with internet, download the **LTS 64-bit .msi** from
   <https://nodejs.org/en/download>
2. Drop it into `windows\vendor\` (keep its filename).
3. Copy the whole Pickora folder to the event PC and run the installer.

Setup finds it there and installs Node.js silently, offline. A portable build
extracted to `windows\vendor\node\node.exe` works too, and installs nothing
system-wide. If Node.js is already on the PC, you need none of this — the
installer checks the machine first.

## Running it anywhere else

Two interchangeable servers ship with the project; they share the same data
files and the same credential format, so you can deploy either.

### Node — no dependencies

```bash
npm start                 # http://localhost:3000
# or simply
node server.js
```

There is nothing to `npm install`. The HTTP layer is a small shim over Node's
built-in `http` module (`server/micro.js`), so a bare Node install is enough.

### Python (Flask)

```bash
pip install -r requirements.txt
python app.py             # http://localhost:5000
gunicorn app:app          # production
```

The Flask path does need its packages installed, so for a fully offline machine
prefer the Node path — or `pip download` the wheels in advance and install with
`pip install --no-index --find-links <folder> -r requirements.txt`.

Set `PORT` to change the port.

## Hosting it on Vercel

Vercel's filesystem is read-only and its functions are ephemeral, so the JSON
files cannot be written there. Point Pickora at a key-value store instead and
everything works unchanged:

1. In the Vercel dashboard, add a **KV / Upstash Redis** store to the project
   (Storage → Create). Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   automatically.
2. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` as environment variables — on a
   read-only host the in-console password change cannot write to the settings
   file, so these are the only way to set your own credentials.
3. Deploy. `vercel.json` routes every request to `api/index.js`, which mounts
   the same application the local server runs.

### Checking it worked

Open `https://your-app.vercel.app/api/health`:

```json
{ "ok": true, "storage": "key-value store", "writable": true }
```

`"storage": "filesystem"` or `"writable": false` means the variables did not
reach the running deployment — redeploy after adding them. The response also
lists which variables it can see, without revealing their values.

Storage is chosen at startup and reported in the log:

```
💾 Storage: filesystem        ← no KV variables set
💾 Storage: key-value store   ← KV_REST_API_URL + KV_REST_API_TOKEN set
```

A fresh deployment starts from the `tickets.json` and `appsettings.json`
committed to the repository, then keeps every later change in the store. The
seed is read-only: once you save anything — including an empty entry list —
the stored copy takes over.

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` work too, so any Upstash
instance is fine, on Vercel or anywhere else.

**Uploads are capped at 2 MB on this path** (against 8 MB on a filesystem),
because images travel base64-encoded inside the store request.

Any host with a writable disk — Render, Railway, Fly.io, a VPS — needs none of
this: leave the variables unset and it uses the filesystem.

---

## Online and offline

Run locally, Pickora works entirely on the event PC and never calls out to the
internet:

- **Fonts are bundled** (`fonts/`, ~230 KB, all SIL OFL) — nothing is fetched
  from a CDN, so the board looks identical with the network unplugged.
- **No package dependencies** on the Node path — nothing to download at install.
- **All data is local** — participants, settings, uploads and draw results are
  files in the application folder.

The server listens on all network interfaces, so other devices on the same
network — a second screen, a phone, a laptop on a router with no internet — can
open the board at `http://<the PC's IP>:3000/`. That works over an offline
router or a phone hotspot with mobile data switched off.

---

## First sign-in

On first start the server creates an admin account and prints it:

```
🔐 Admin account created: admin / pickora
⚠️  The admin console is still using the default password. Change it at /admin.
```

**Change it immediately** under **Account**. The console shows a warning banner
until you do.

Credentials are stored in `appsettings.json` as a salted **PBKDF2-HMAC-SHA256**
hash (120,000 iterations) — the password itself is never written anywhere. That
file is blocked from static serving, so a browser cannot fetch it.

### Preferred for deployment: environment variables

```bash
export ADMIN_USERNAME=organiser
export ADMIN_PASSWORD='a-long-passphrase'
export SESSION_SECRET='a-random-64-char-string'
```

When both admin variables are set they take precedence over the file, and no
credential material is committed to the repository. `SESSION_SECRET` keeps
sign-ins valid across restarts; without it a random secret is generated per
process and everyone is signed out on redeploy.

---

## Data files

| File | Contents | Committed? |
|---|---|---|
| `tickets.json` | Entry list | Yes |
| `appsettings.json` | Board settings + hashed credentials | Yes — see note below |
| `winners.json` | Draw state, written as winners are picked | No (gitignored) |
| key-value store | The same three documents plus uploads, when hosted | n/a |
| `appsettings.sample.json` | Reference configuration | Yes |

> **Note on `appsettings.json`:** it stays tracked so existing deployments keep
> working, which means a password hash can land in git history. Use the
> environment variables above if the repository is shared.

### Entry file format

**Nothing about the participant shape is fixed.** Whatever columns your file
contains become the fields the board can display.

CSV — the first row names the columns:

```csv
Badge ID,Guest Name,Company,Table,Membership Tier,Mobile Number
GALA-001,Layla Hassan,Emirates NBD,Table 4,Platinum,+971501110001
```

JSON — an array, or an object with a `tickets` array:

```json
{ "tickets": [ { "Badge ID": "GALA-001", "Guest Name": "Layla Hassan", "Company": "Emirates NBD" } ] }
```

On upload the console shows the detected columns and proposes:

- **an identifier** — the column the draw is performed on, which must be unique.
  Columns named like a ticket, badge, booking or reference are preferred, and a
  column that looks like contact detail is never chosen automatically.
- **a label** for each field, taken from your heading exactly as written.
- **a sensitivity flag** for columns that look like contact details
  (mobile, phone, email, passport, Emirates ID, address).

You can change any of these under **Fields** before or after importing.

**Download template CSV** gives you a starting file whose columns are this
event's own fields, so an import lands without renaming anything.

**Current list** shows what is loaded, with **Export CSV** to take a copy and
**Delete all entries** to empty it. Deleting is refused while a draw is in
progress unless you confirm.

Rows with no identifier, and rows repeating one already in the list, are
skipped and reported in **Overview → Data health**. Under **Fields → Duplicate
handling** you can instead keep every row, giving repeated entries
proportionally more chances.

---

## What appears on screen

Four **display slots** decide what the audience sees. Each holds up to six
lines, and each line names a field and an emphasis level:

| Slot | When it shows |
|---|---|
| **While spinning** | The reel, cycling through remaining entries |
| **Winner announcement** | The first reveal, held for the announcement delay |
| **Winner card** | The full result |
| **Winners list row** | One row per winner in the side panel |

| Emphasis | Appearance |
|---|---|
| `primary` | Largest, in the accent colour |
| `secondary` | Bold supporting line |
| `meta` | Smaller detail line |
| `eyebrow` | Small uppercase label |

Each line can optionally show the field's label before the value
("Table: 4" rather than "4").

**This is also the privacy boundary.** The board is only ever sent the fields
that appear in a slot — everything else stays on the server. Put a field on the
spinning reel and it is sent for *every* entry, not just the winner; the console
warns when a field marked sensitive is placed on any slot.

A line whose value is empty for a given winner is dropped, so a partly-filled
column never leaves a stray label on screen.

---

## Branding

Under **Branding** you can upload a **logo** and a **background**.

- Recommended sizes are stated beside each upload in the console, along with
  the maximum this deployment accepts:

  | Asset | Recommended | Minimum |
  |---|---|---|
  | Logo | 600 × 300 px, transparent PNG | 200 × 100 px |
  | Background | 1920 × 1080 px (2560 × 1440 or 3840 × 2160 for large screens) | 1280 × 720 px |
  | Guest photo | 800 × 1000 px portrait (4:5) | 400 × 500 px |

- Accepted: PNG, JPEG, GIF, WebP, SVG. Between 16px and 8000px a side, and up
  to 8 MB on a filesystem or 2 MB on a key-value deployment.
- Dimensions are read from the file header on the server and shown back to you,
  so you can check them against the screen you are projecting onto. For a 1080p
  projector, 1920×1080 or larger is recommended for the backdrop.
- Files are stored under `assets/` with a content hash in the name; replacing or
  removing an image deletes the file it no longer needs.
- The logo sits in any of six places — the four corners plus top centre and
  bottom centre — with an on-screen height; the background has a
  fit mode (cover, contain, fill, tile) and a darkening overlay that keeps large
  text readable over busy artwork.

If no background is uploaded the board falls back to `Background.png`, so an
existing deployment looks unchanged.

---

## Guest welcome

To greet a chief guest or celebrity, **Welcome** puts a message and a rotating
set of photos on the board.

- **Photos** — 800 × 1000 px portrait suits the layout; upload up to 20, drag-and-drop or file
  picker, each with an optional caption. Reorder them with the arrows; the list
  order is the carousel order. Portrait crops suit the layout best.
- **Carousel interval** — how long each photo holds, 1.5–60 seconds.
- **Placement** — `overlay` centres it over the board, `panel` docks it in a
  corner so the stage stays visible behind.
- **Open automatically** — show it as soon as the board loads, or leave it for
  the operator to bring up at the right moment.

On the board the operator controls it with the **Welcome** button or the
<kbd>G</kbd> key; <kbd>Esc</kbd> closes it, and starting a draw closes an
overlay automatically so the stage is never covered mid-draw.

Photos are validated exactly like the branding images and stored under
`assets/` by content hash. The same photo cannot be added twice.

---

## Settings reference

| Setting | Effect |
|---|---|
| `totalPrizes` | Draw stops after this many winners |
| `eventName`, `organizationName` | Board heading and subtitle |
| `locale`, `direction` | Page language and left-to-right / right-to-left layout |
| `data.identifier` | The field the draw is performed on |
| `data.fields[]` | Key, display label, sensitivity and export inclusion per column |
| `data.duplicatePolicy` | `skip` a repeated identifier, or `allow` it to stay in the pool |
| `display.reel` / `.call` / `.card` / `.panel` | Which fields appear at each moment, with emphasis and optional labels |
| `display.panel.maxEntries` | How many winners the side panel shows |
| `display.autoStopWhenPrizesExhausted` | Stop once every prize is awarded |
| `draw.publicDrawEnabled` | Turn off to freeze the public board between rounds |
| `draw.requireAuthForDraw` | Only a signed-in browser may draw |
| `draw.minimumRollMs` | Stop is held until the reel has run this long |
| `animation.rollingSpeed` | Milliseconds per entry on the reel |
| `animation.winnerAnnouncementDelay` | Pause between the announcement and the winner card |
| `animation.confettiStartDelay`, `confettiDuration`, `confettiCount` | Confetti timing and density |
| `animation.confettiPalette` | Up to 12 hex colours for the confetti |
| `branding.logo` | Uploaded file, corner position, on-screen height |
| `branding.background` | Uploaded file, fit mode, darkening overlay |
| `welcome.enabled`, `showOnLoad`, `placement` | Whether the guest welcome shows, when, and where |
| `welcome.title`, `message` | Heading and message; line breaks are preserved |
| `welcome.images[]` | Photo path, caption and dimensions, in carousel order |
| `welcome.intervalMs` | How long each photo holds (1500–60000) |
| `welcome.showCaptions` | Show the caption under the carousel |
| `copy.*` | Every string on the board — headings, buttons, empty states, footer |
| `ui.primaryColor` | Accent colour across the board |
| `ui.backgroundColor` | CSS painted behind the backdrop image |
| `ui.boardAlignment` | `left` / `center` / `right` — moves the stage clear of artwork |
| `branding.logo.position` | `top-left` / `top-center` / `top-right` / `bottom-left` / `bottom-center` / `bottom-right` / `hidden` |
| `draw.allowResetFromBoard` | Let anyone use **New draw** on the board; otherwise it is offered only to a signed-in organiser |
| `ui.showWinnersPanel`, `ui.showStats`, `ui.showOrganizationName` | Board furniture |

Every value is validated and clamped server-side, so a bad entry cannot break
the board mid-event. Unknown fields referenced by a display slot are dropped,
and an emptied slot falls back to the identifier rather than showing nothing.

---

## API

Public:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Storage driver and whether it can be written to |
| `GET` | `/api/settings` | Board configuration (never credentials) |
| `GET` | `/api/pool` | Remaining ticket numbers + counters |
| `GET` | `/api/state` | Winners so far + counters |
| `POST` | `/api/draw` | Draw one winner |
| `POST` | `/api/draw/reset` | Clear the draw from the board (organiser, or when allowed) |

Session:

| Method | Path |
|---|---|
| `GET` | `/api/auth/session` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/logout` |

Organiser (signed-in only):

| Method | Path |
|---|---|
| `GET` | `/api/admin/overview` |
| `PUT` | `/api/admin/settings` |
| `POST` | `/api/admin/password` |
| `POST` | `/api/admin/tickets/preview` |
| `POST` | `/api/admin/tickets` |
| `DELETE` | `/api/admin/tickets` |
| `GET` | `/api/admin/export/tickets.csv` |
| `GET` | `/api/admin/export/template.csv` |
| `POST` | `/api/admin/assets/:kind` |
| `DELETE` | `/api/admin/assets/:kind` |
| `POST` | `/api/admin/welcome/images` |
| `DELETE` | `/api/admin/welcome/images` |
| `POST` | `/api/admin/draw/undo` |
| `POST` | `/api/admin/draw/reset` |
| `GET` | `/api/admin/export/winners.csv` |

---

## How the draw works

Selection happens **on the server**, using `crypto.randomInt` (Node) or
`secrets.randbelow` (Python) — both uniform and cryptographically sound. Each
winner is appended to `winners.json` before the response is sent, so a refresh,
a crashed browser or a second screen can never lose or duplicate a result.

Failed sign-ins are throttled to 8 attempts per 15 minutes per address. Session
cookies are HttpOnly, SameSite=Lax, and marked Secure behind HTTPS.

---

## Project structure

```
pickora/
├── index.html / styles.css / script.js   # public draw board
├── admin.html / admin.css                # organiser console
│   ├── admin.js                          # console shell, data, draw supervision
│   └── admin-config.js                   # fields, display slots, branding, wording
├── api.js                                # shared API client
├── confetti.js                           # confetti animation
├── welcome.js                            # guest welcome carousel
├── fonts/                                # bundled webfonts (no CDN)
├── server.js                             # local entry point (no dependencies)
├── api/index.js                          # serverless entry point (Vercel)
├── vercel.json                           # routes every request to the function
│   └── server/                           # app, micro (http shim), paths, store,
│                                         # auth, schema, settings, tickets,
│                                         # draw, images, routes
├── app.py                                # Flask entry point
│   └── pyserver/                         # the same modules in Python
├── tickets.json / appsettings.json       # data
├── assets/                               # uploaded logo, backdrop, guest photos
├── windows/                              # one-click installer and shortcuts
└── Background.png / logo.jpg             # bundled artwork
```

## License

MIT.
