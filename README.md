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
- Winner reveal with a choice of celebration — classic confetti, streamers,
  stars, balloons, snowfall, money rain, or a mix of all of them — cycling
  through five reveal animations
- Social channels with QR codes on every public screen, placed where you want
  them
- Optional winners panel and prize counters
- Links to the welcome screen and the prize screen, which are pages of their own
- Prizes announced ahead of each draw, in the order the organiser chose
- **New draw** sits beside Start and Stop: clears the results and starts over
  without leaving the board. Offered to a signed-in organiser, or to anyone
  once `draw.allowResetFromBoard` is on; otherwise it explains what is needed.
  It can also be switched off altogether, for a board nobody should be able to
  reset from the floor
- **Sound** for every moment of the draw — background music, the spin, the
  landing, the reveal, a winner not present, the countdown — from built-in
  sounds or the organiser's own tracks, with a speaker button to mute a screen
- **Countdown** to the start of the draw, full screen or as a banner, holding
  the draw until zero if the organiser wants
- **Not present** on the winner card: strike off a winner who does not come
  forward and draw their prize again, when the organiser allows it
- **Sponsors** credited beside the prizes they stand behind, and a strip of
  sponsor logos along the screen
- **Spin-the-wheel** as an alternative to the reel
- **Live sync**: every screen in the room spins and reveals together, and a
  **phone remote** runs the draw from the stage
- Keyboard: `Space` / `Enter` start and stop, `W` winners panel, `G` guest
  welcome, `N` new draw, `A` not present, `S` sound on/off, `F` fullscreen.
  With the phone remote, the same from a phone
- Survives a refresh — the draw state lives on the server, not in the tab

The board holds **no participant data beyond what it is configured to show**.
It receives only the fields placed in a display slot; everything else in the
record stays on the server.

### 2. Organiser console — `/admin`

Behind a sign-in.

Sections are grouped in the sidebar as **Entries**, **Content**, **Look**, **The draw** and **Setup**, in the order an event is prepared.

| Section | What it does |
|---|---|
| **Overview** | Live counters, data-health warnings, results table, CSV export, undo last draw, reset draw, strike off a winner as not present and restore one |
| **Participants** | Upload the entry list or link a Google Sheet, with a column preview; download a template, export, or delete |
| **Fields** | Rename columns, mark sensitive ones, choose the identifier and what appears in the export |
| **Display** | Choose exactly which fields appear while spinning, on the announcement, on the winner card and in the winners list, and how long the announcement is held before the card — with a rehearsal of the reveal |
| **Prizes** | Build the prize list, each with its own photo carousel |
| **Sponsors** | The sponsor list with logos, links and taglines; who sponsors which prize; where sponsors are credited; the logo strip |
| **Welcome** | Greet a chief guest with a message and a carousel of photos |
| **Channels** | Social links and their QR codes: style, position, size, display mode, with a live preview |
| **Branding** | Upload the logo and backdrop, with size and resolution validated on the server |
| **Board layout** | How big the reel and the buttons are, and how far the backdrop is darkened — judged against a live preview of the board |
| **Draw style** | Reel or wheel, and every setting of the wheel, with a test spin |
| **Text & media** | How the words are set on each screen — face, size, weight, colour, opacity, alignment, line height, letter spacing — and how a prize's photographs are shown on the board, with a live preview |
| **Wording** | Every string on the draw board |
| **Sound** | Every sound cue — source, volume, delay, fades, length, start point, looping — your own uploaded tracks, sound packs, previews |
| **Countdown** | When the draw starts, the words, full screen or banner, units, which screens, and whether the draw waits for zero |
| **Live sync** | Keep every screen together: which board runs the draw, what followers mirror, how often they check, screen addresses |
| **Remote** | What the phone remote may do, and pairing a phone with a QR code |
| **Certificate** | The printable draw certificate: wording, what it includes, columns, signatures, paper — with a live preview |
| **Templates** | Save the configuration, apply a saved one in whole or in part, export and import as a file |
| **Settings** | Prize count, draw behaviour, the "winner not present" redraw, colours, alignment, language, animation timings |
| **Reset event** | Clear the results, entries and anything else chosen for the next event — after typing the event name and the password |
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

## Running several events at once

Each event — each *tenant* — runs as its own instance of Pickora with its own
storage, its own organiser password and its own domain. Nothing is shared
between them: one event's entries, winners, uploads and sign-ins are invisible
to every other. There are two ways to host this, and they can be mixed.

| | Docker containers | Vercel projects |
|---|---|---|
| Where it runs | Any container host: a VPS, Railway, Fly.io, Render, AWS ECS / Lightsail, Google Cloud Run (with a volume) | Vercel |
| One tenant is | A container plus a volume | A Vercel project |
| Data lives in | The tenant's `/data` volume | One shared Upstash store, kept apart by `PICKORA_TENANT` |
| Uploads up to | 10 MB | 2 MB |
| Domains | Any domain, including ones bought on Vercel, pointed at the host | Added per project in Vercel |

> **Vercel does not run Docker containers.** A domain registered or managed in
> Vercel can still serve a container: point its DNS at the container host
> (see below). The app itself then runs on that host, not on Vercel.

### Tenant settings

| Variable | Purpose |
|---|---|
| `PICKORA_TENANT` | Short name for the event — lower-case letters, digits and hyphens. Namespaces the key-value store and is reported by `/api/health`, so you can check a domain reaches the right event. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | The tenant's organiser sign-in. **Required in Docker**: a container without both refuses to start rather than serve the default `admin` / `pickora`. On Vercel, always set both. |
| `SESSION_SECRET` | Recommended: a different random value per tenant (`openssl rand -hex 32`), so tenants never share a cookie-signing key even if they share a password. |
| `PICKORA_DATA_DIR` | Where the filesystem driver keeps the event's documents and uploads. Defaults to the application directory; the Docker image sets it to `/data`. |

A new tenant starts from `appsettings.sample.json` with no entries. The
`appsettings.json` and `tickets.json` in this repository are never copied into
the image, so one event's settings and its hashed password never reach another.

### Docker: one container per event

```bash
docker build -t pickora .

docker run -d --name pickora-alpha -p 3001:3000 \
  -v pickora-alpha:/data \
  -e PICKORA_TENANT=alpha -e ADMIN_USERNAME=organiser -e ADMIN_PASSWORD='…' \
  pickora

docker run -d --name pickora-beta -p 3002:3000 \
  -v pickora-beta:/data \
  -e PICKORA_TENANT=beta -e ADMIN_USERNAME=organiser -e ADMIN_PASSWORD='…' \
  pickora
```

The image runs as an unprivileged user and cannot write to its own code: the
only writable place is `/data`. Keep each tenant's volume for as long as you
want its results; `docker volume rm` archives nothing, so export the winners
CSV first.

#### Several events behind one host, each on its own domain

`docker-compose.yml` runs two sample tenants, `alpha` and `beta`, behind
[Caddy](https://caddyserver.com), which routes by domain and obtains an HTTPS
certificate for each one automatically.

1. Point each event's domain at the host's public IP — an `A` record, or a
   `CNAME` for a subdomain. For a domain managed in Vercel, add the record under
   **Domains → *your domain* → DNS Records**.
2. Create the environment files (they are git-ignored):

   ```bash
   cp deploy/proxy.env.example deploy/proxy.env              # domains + certificate email
   cp deploy/tenants/example.env deploy/tenants/alpha.env    # one per tenant
   cp deploy/tenants/example.env deploy/tenants/beta.env
   ```

3. Start everything:

   ```bash
   docker compose up -d --build
   ```

4. Check each domain: `https://<domain>/api/health` should show `"ok": true` and
   that tenant's name.

**Adding a tenant** takes three edits: a service block and a volume in
`docker-compose.yml` (copy `alpha`), a site block in `deploy/Caddyfile`, and its
domain in `deploy/proxy.env`. Then:

```bash
docker compose up -d            # starts the new tenant; running ones are left alone
docker compose restart proxy    # Caddy picks up the new site and fetches its certificate
```

**Removing a tenant:** export its winners, then `docker compose rm -sf <name>`
and `docker volume rm <project>_<name>-data`.

### Vercel: one project per event

Import this repository into Vercel once for each event, so each event is its
own project with its own domain and environment variables:

1. Create one Upstash Redis store and connect it to every project. The projects
   share the store; `PICKORA_TENANT` keeps their keys apart.
2. In each project set `PICKORA_TENANT`, `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
3. Add the event's domain to that project under **Settings → Domains**.

Leave `PICKORA_TENANT` unset on a deployment that already holds an event: unset
means the original key prefix, so the existing data stays where it is. Setting
it later starts that deployment from an empty event.

A push to the repository redeploys every project, so all events always run the
same code.

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
credential material is committed to the repository. The password cannot then be
changed from the console — change the variable and redeploy.

`SESSION_SECRET` is optional. Without it the signing key is derived from the
admin credential, so sign-ins survive restarts and every instance agrees; set it
only if you want to rotate sessions independently of the password.

---

## Data files

| File | Contents | Committed? |
|---|---|---|
| `tickets.json` | Entry list — empty as shipped | Yes |
| `appsettings.json` | Board settings + hashed credentials — the built-in defaults as shipped, with no credentials | Yes — see note below |
| `winners.json` | Draw state, written as winners are picked | No (gitignored) |
| `templates.json` | Saved event templates | No (gitignored) |
| `live.json`, `remote.json` | The feed between screens and the remote's commands | No (gitignored) |
| key-value store | The same documents plus uploads, when hosted | n/a |
| `appsettings.sample.json` | The built-in defaults — where a new Docker tenant starts | Yes |

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

### Linking a Google Sheet

Under **Participants** the entry list can come from a file or straight from a
Google Sheet — **Where the entries come from → Link a Google Sheet**. Paste the
address from the browser while the sheet is open and press **Read sheet**. From
there it is identical to a file: the same column preview, the same identifier
choice, the same **Import entries** button.

- The sheet must be readable by anyone with the link: in Google Sheets,
  **Share → General access → Anyone with the link → Viewer**. A private sheet
  answers with the sign-in page, which the console reports as such.
- **The first row names the columns**, exactly as in a CSV. Every row below it
  is one entry.
- Open the tab you want before copying the address — the link carries it.
- The link is remembered, so pressing **Read sheet** again later picks up
  whatever has changed in the sheet. Importing a file instead clears it.
- It needs a connection. On an offline machine, export the sheet as CSV from
  Google and upload the file; everything downstream is the same.

Only an address Pickora builds itself is ever fetched: what you paste is mined
for the spreadsheet id and then discarded, so the import cannot be pointed at
anything but Google's own CSV export.

### What the console detects

On import the console shows the detected columns and proposes:

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
| **While spinning** | The reel, dealing through the remaining entries |
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
  | Guest photo | 1000 × 1000 px square, shown in a circle | 600 × 600 px |

- Accepted: PNG, JPEG, GIF, WebP, SVG. Between 16px and 8000px a side, and up
  to 10 MB on a filesystem or 2 MB on a key-value deployment.
- **A backdrop may be 10 MB anywhere**, including a serverless deployment that
  would otherwise refuse it. Anything over about 1.5 MB is redrawn at 2560px and
  re-encoded before it leaves the browser, which is no loss — the board never
  draws a backdrop larger than the screen, and darkens it besides. The bytes
  saved are the difference between an upload that works and one the platform
  rejects: images travel base64 inside a JSON request, and a serverless function
  will not accept a body over 4.5 MB, so ~3.3 MB of image is the most that can
  reach the server untouched.
- Dimensions are read from the file header on the server and shown back to you,
  so you can check them against the screen you are projecting onto. For a 1080p
  projector, 1920×1080 or larger is recommended for the backdrop.
- Files are stored under `assets/` with a content hash in the name; replacing or
  removing an image deletes the file it no longer needs.
- The logo sits in any of six places — the four corners plus top centre and
  bottom centre — with an on-screen height; the background has a
  fit mode (cover, contain, fill, tile) and a darkening overlay that keeps large
  text readable over busy artwork.

Until an organiser uploads their own, the board wears the bundled Pickora
placeholders — `pickora-logo.png` and `pickora-background.jpg`, both regenerated
by `tools/make-default-artwork.py`. The event artwork that used to ship as the
default now lives in [`archive/`](archive/README.md), and a settings file that
still names it is remapped to the placeholder when it is read.

---

## Guest welcome and prizes

Both are **pages of their own**, not overlays on the board, so either can be
projected on a second screen, linked to, or left open on a foyer display:

| Screen | Address |
|---|---|
| Draw board | `/` |
| Guest welcome | `/welcome` |
| Prizes | `/prizes` |

All three carry the same navigation in the same place, with the current screen
marked. **Show the welcome screen** and **Show the prize screen** decide which
links appear — both ticked by default, so a new install has all three. Unticking
one is a deliberate choice about what the audience sees, so the link goes; a
screen that is switched on but not filled in yet is dimmed instead, and stays
reachable, so it never looks as though the feature is missing. The screen being
viewed always appears, even when switched off, so a link followed from elsewhere
is never a dead end. On the board, <kbd>G</kbd> opens the welcome and
<kbd>P</kbd> the prizes; the console sidebar opens any of them in a new tab.

### Guest welcome

A heading, a message and a carousel of photos, for greeting a chief guest.

The screen reads top to bottom — a small label, the heading, a rule, the
message, then the photographs as the thing the room is looking at. The heading
is set in the display face, the message as prose held to a readable measure,
and each part arrives just after the one above it. The whole composition is
sized to fit the screen it is on, so a projected welcome never has to be
scrolled.

Photographs are shown in a circle, so square is the shape to aim for —
1000 × 1000 px — up to 20, each with an optional caption, reorderable, and the
carousel interval is yours to set. Anything a different shape is cropped square,
favouring the top of the frame so faces are not cut off.

Nothing is laid over the photographs: no arrows, no buttons. The carousel turns
on its own, and the dots that say how many there are sit below the circle rather
than on the picture.

### Prizes

A list built in the console, in rank order — the first entry is first prize.

- **Rank labels** default to *First prize*, *Second prize* and so on, and
  renumber themselves when you reorder. Type your own — *Grand prize* — and it
  is left alone.
- **Each prize** has a name, a description, and up to 12 photos shown as a
  slider with arrows and dots. 1200 × 900 px landscape suits the layout.
- **Name the prize on the winner card** ties the list to the draw by position,
  so the first winner is announced with first prize.

### Running the prizes

Two settings decide how the evening plays, and both belong to the organiser
before anything is drawn:

| Setting | Choice |
|---|---|
| **Draw order** | *Highest prize first* — 1st, then 2nd, then 3rd<br>*Lowest prize first* — 3rd, then 2nd, then 1st, building to the top prize |
| **Prize announcement** | *Show the prize before each draw*<br>*Hide it until the winner is announced* |

The console prints the **running order** underneath — the actual sequence, in
order, with the prize linked to each position — so the setting is never
guesswork. A position with no prize linked is flagged there rather than
discovered on stage.

With the prize announced beforehand, a draw runs in three beats:

1. **Up next · Third prize** — the position, the prize, its photo and
   description, held on screen while the host builds it up.
2. **Start** rolls the reel for that prize.
3. **Stop** slows it to rest on the winner, who is then named with their prize.

Start then brings up the next prize, so the winner stays on screen for as long
as the room needs. With announcements hidden, Start rolls straight away and the
prize is revealed only with the winner.

Nothing about the list is fixed: add, remove and reorder as many as the event
needs.

---

## The reel

The reel is a tape of entries that spins up, cruises and — the moment Stop is
pressed — slows to rest on a whole entry. Three things follow from that:

- **Stop is felt at once.** The slowdown begins on the keypress, one frame
  later. `draw.minimumRollMs` is spent decelerating rather than holding the reel
  at full speed, so pressing Stop early gives a longer, gentler stop instead of
  a wait with no feedback.
- **It comes to rest on the winner, and only the winner.** The draw is
  requested the instant Stop is pressed, and the reel eases down to a gentle
  roll until the answer is in. Only then does it choose where to stop — a place
  still out of sight below the window — and glide onto it, so the entry the
  room watches come to rest is the one announced. Nothing is swapped in view,
  and the reel never speeds up again. `draw.stopResponseMs` sets the least time
  that gentle roll lasts, for a beat of suspense after Stop.
- **Every entry gets the same time on screen.** Entries are dealt from a
  shuffled deck, so all of them appear once before any of them repeats.
  Sampling at random each frame would let some never appear at all, which looks
  like the board favours the ones it keeps showing.

The winner itself is never chosen in the browser. The server draws it with
`crypto.randomInt` (Node) or `secrets.randbelow` (Flask) — uniform over the
remaining pool, and not something a viewer can influence.

Speed comes from `animation.rollingSpeed`, in milliseconds per entry. With
`prefers-reduced-motion` the tape does not travel at all: the entry in the
window steps on a slow timer instead.

---

## The winner reveal

A draw ends in two beats: the **announcement**, which names the winner and
nothing else, and then the **winner card**, which carries the full result. The
pause between them is the suspense, so it is the organiser's to set.

**Winner announcement delay** lives under **Display**, directly beneath the two
slots it sits between, and runs from 0 to 30 seconds. The clock starts when the
reel has stopped and the winner is known — never during the spin — so the pause
the organiser configured is the pause the room gets, whatever the draw itself
took to arrive.

At **0** there is no announcement at all. Not one shown for no time, which
reads as a flicker: the card takes the stage the moment the reel stops.

The announcement fades out over the last 300ms of the delay rather than after
it, so the hand-over is smooth without quietly lengthening the wait — the card
still appears on the beat. A browser asking for reduced motion gets the swap
with no movement at all.

Because a number of seconds is hard to judge as a length of suspense, the panel
will **rehearse** it: press play and the same sequence runs at the configured
delay, on the organiser's own slots and one of their own entries, with a bar
showing the wait as it happens. Moving the slider stops a rehearsal rather than
letting it finish at a delay the slider no longer says.

Every timer belonging to a reveal is cancelled the moment anything else takes
the stage, so a second draw restarts the sequence cleanly and a card from the
previous round can never land on top of the current one.

---

## Board layout

Under **Board layout** the reel and the buttons can be given their own
measurements, and the backdrop its darkening — all three against a preview of
the board itself, because none of them mean much as a number on their own.

**Darkening** is the one that confuses. Raising it darkens the background so
the ticket numbers and the winner's name stay readable over a busy photograph;
lowering it shows more of the image, and at 0% the photograph is left exactly as
uploaded. The slider says what it is at, the preview shows what it does, and
there is a reset beside it.

**Show the "New draw" button** decides whether the board offers a new draw at
all, and is **off unless it is asked for**. The button clears every winner
drawn so far, and a projected board stands in a room full of people; the safe
default is the one where nobody can do that by walking up to the screen. Off
takes the button out of the layout entirely — the remaining controls close up
around it rather than leaving a gap — and disables its **N** shortcut with it.

This is a setting about the public board and nothing else. An organiser signed
in to the console always has **Reset draw** under Overview, whatever the board
is showing. Who may use the button once it *is* shown is a separate question,
answered by `draw.allowResetFromBoard` under Settings.

**Sizes** are in pixels, with Small / Medium / Large presets that simply fill
the sliders — the numbers are what is stored, so a preset is a quick way to
reach a set of them rather than a fourth thing to keep in step. A slider left
at **Auto** means the board sizes that dimension to the screen, exactly as it
does on a board nobody has configured, so an organiser only sets the one thing
they want to change.

The preview lays the board out at its real width and scales the whole thing
down, so what is shown is proportionally what will be projected rather than a
small design that merely resembles it. It uses the uploaded backdrop at the
chosen darkening, or the gradient the board falls back to when there is none,
and switches between desktop and phone widths. **Save configuration** commits
everything; **Reset to defaults** puts the sizing and the darkening back.

---

## Text and media

Under **Text & media** each screen is styled on its own — the welcome screen,
the prize page, and the prize named on the draw board. They share no setting
with one another, so a serif welcome does not drag a serif prize page along
with it, and the three sit behind tabs rather than one long page for the same
reason.

Per screen: **font family** from the faces the application already ships (no
network call, so it still works offline), **weight** from Light through
Extra-Bold, **alignment**, **colour** with a swatch and a hex field that follow
each other, **opacity**, **size**, **line height** and **letter spacing**.
Small / Medium / Large fill the sliders in one click, exactly as they do under
Board layout. The weight reaches every line the screen puts on stage — heading,
message, prize name, the winner's own details — rather than one of them.

Everything left at **Auto** is left alone: the screen keeps the size, the face
and the colour it has always had, which is why a board nobody has configured is
pixel-for-pixel the board that shipped. A size set here governs the line that
carries the screen — the message on the welcome screen, the prize's name on the
other two — and a prize's description follows it proportionally rather than
matching it, so asking for bigger type does not flatten the two lines into one.

### Text background

A photograph an organiser loves is rarely one that text sits happily on.
Darkening the whole backdrop, under Board layout, is the blunt instrument: it
dims the picture everywhere, including the parts nobody is reading over.
**Text background** is the precise one — a coloured plate behind the words
themselves and nothing else.

Per screen, again independently: **colour** with a swatch and hex field,
**opacity** from 0 to 100%, **corner radius** (none, slight, rounded, pill) and
**padding** (none, small, medium, large), with a reset of its own that leaves
that screen's type settings untouched.

At **0%** there is no plate at all, which is the default, so nothing changes
until it is asked for. Above zero each block of text shrinks to its own content
and carries its own plate — the heading, the message, the prize's name, the
winner's details — so the plate sits on the words rather than spread across the
artwork. The padding is set in `em`, so it stays in proportion whatever size the
text is: a large heading gets a proportionally larger plate, not the same
handful of pixels.

The preview draws the plate on the uploaded backdrop at its current darkening,
which is the whole point — whether something can be read is not a question the
numbers answer, only the picture does.

### Carousel shape and placement

The welcome screen and the prize screen each decide, on their own, what shape
their photographs are cut to and where the carousel sits against the words.

**Shape** is rectangle, rounded rectangle (with a radius of its own to set),
square, oval or circle. Rectangle, rounded and oval also take a set of
proportions — 4:3, 16:9 or 3:2 — while a square and a circle are square
whatever else is chosen, which is why the console stops offering the choice for
them rather than letting it sit there doing nothing. Every shape crops from the
centre with `object-fit: cover`, so a photograph is never stretched to fill one.

**Show carousel dots** decides whether the navigation dots appear under the
photographs. On by default, which is what both screens have always shown.
Turning them off hides them and nothing else: the photographs still turn on
their own, at the same interval, with the same transition.

**Placement** is top, centre, bottom, left or right. Centre means between the
heading and the message — the prize's name and what it is, on a prize card.
Left and right set the carousel beside the words on a wide screen and stack it
above them on a phone, where there is no room to set anything beside anything
else. The element is moved rather than reordered in CSS, so the order a screen
reader hears is the order the room sees.

The defaults are what each screen already looked like, not one value for both:
the welcome photographs have been a circle below the message since that screen
was redesigned, and a prize's a plain 4:3 frame above its name. Neither moves
until an organiser says so, and each has a reset of its own that leaves the
other — and that screen's type settings — alone.

### Prize photographs on the board

**Prize photographs on the board** decides what happens when a prize has more
than one photograph. *Single* shows the first, as before. *Carousel* shows each
in turn, with its own timing, a fade or a slide, dots that say how many there
are, and a shape — rounded rectangle, circle or oval. The preview runs the
board's own carousel on the board's own stylesheet, so what is shown is what
will happen rather than an imitation of it; before any photographs are uploaded
it stands in three plain panels, which is enough to judge the timing and the
shape.

As under Board layout, the preview is drawn at the real screen width and scaled
down, on the uploaded backdrop at its current darkening, with desktop and phone
widths. **Save configuration** commits, **Revert** drops unsaved edits, and
**Reset to defaults** puts every screen and the photographs back.

---

## Social channels and QR codes

Under **Channels** in the console, add as many links as the event needs —
Instagram, Facebook, X, YouTube, TikTok, LinkedIn, WhatsApp, Telegram, Discord,
a website, or anything else under *Custom*. Each one takes a link and, if the
channel's own name is not what you want under it, a display name. Rows reorder,
edit and delete; the order is the order they appear in.

One set of QR settings applies to all of them: the **style** (standard,
coloured to each channel, the channel mark in the centre, or rounded dots), the
**position** on the public pages, the **size**, and whether to show **icons, QR
codes or both**. A live preview beside the settings shows the block as the room
will see it — drawn by the same code the public pages use, so it is the result
rather than an impression of it.

The block appears on the draw board, the welcome screen and the prize screen.
Icons open in a new tab; each code scans straight to its link. With no channels
configured it leaves no trace at all.

### Why the QR codes are built here

They are encoded in [`qr.js`](qr.js) rather than fetched from a service or
pulled from a package: the board has to work with no network, and the project
carries no runtime dependencies. Every code is byte mode at error-correction
level H, which is what allows the centre mark of the icon style without
costing scannability — the mark covers about 5% of the code where H tolerates
roughly 30%.

`tools/verify-qr.py` checks the encoder against a reference implementation,
module for module. It is worth keeping: two of the three bugs found while
writing it — the format bits placed in reverse, and the wrong generator
polynomial for the version information — produced codes that looked perfectly
well formed and scanned as nothing at all.

---

## Sound

Every moment of the draw can have its own sound, configured under **Sound** in
the console. Sound is **off until it is switched on**, so an event set up
before this existed stays silent after an update.

| Cue | When it plays |
|---|---|
| Background music | Between draws, on the screens chosen — and it can step aside for the draw |
| While the reel spins | From Start until the reel lands; loops until then |
| Reel lands | The instant the reel comes to rest on the winner |
| Winner revealed | When the winner card appears; background music returns once it ends |
| Winner not present | When a winner is struck off |
| Countdown tick | Each second of the countdown's final stretch |
| Countdown ends | When the countdown reaches zero |

Each cue has its own **source** (a built-in sound or one of your tracks),
**volume**, **delay**, **fade in** and **fade out**, **length** (0 plays the
whole sound, or until the moment is over), **start point** for an uploaded
track — to skip an intro — and **loop**. A master switch and master volume sit
above them, and **sound packs** set every cue to matching built-in sounds in one
go. **Preview** plays a cue exactly as configured, saved or not.

The built-in sounds are **generated in the browser** with the Web Audio API —
drumrolls, a brass fanfare, bells, a gong, an air horn and more. Nothing is
downloaded and nothing needs licensing, so they work on an offline board.

**Your own tracks** — MP3, M4A, AAC, OGG, WAV, FLAC or WebM — are uploaded once
and can then be chosen for any cue. Each is checked by its content, not its
name, and stored under a name made from its hash. The size limit is the
deployment's: 10 MB on a filesystem, 2 MB on a key-value store. Only upload
music you have the rights to play at the event.

Browsers allow sound only after someone interacts with a page, so **press any
key or click once on each screen** after opening it; until then the speaker
button pulses. The speaker button (or `S`) mutes one screen without changing
the organiser's setting, and can be hidden. Open screens pick up sound changes
from the console within 20 seconds, without a reload.

## Countdown to the draw

Under **Countdown**: switch it on, pick when the draw starts (or use *In 15
min*, *In 1 hour*…), and choose the words, the units, a **full-screen** or
**banner** style, and which screens show it. The time is picked in the
console's own time zone and stored with its offset, and every screen counts
against the **server's** clock, so screens whose clocks disagree still reach
zero together.

With **Hold the draw until the countdown ends**, Start is disabled on the board
and the server refuses draws until zero — a signed-in organiser can still draw
early. The last seconds pulse (and tick, if the tick sound is on), and at zero
the closing message stays up for as long as configured; `0` keeps it until the
first draw starts.

## Winner not present

When a winner is called and does not come forward, they can be struck off and
their prize drawn again. Switch it on under **Settings → Winner not present**.

- The Overview gets a **Not present** button on every result, and a list of
  struck-off entries with **Restore as winner** for a mistake — allowed while
  their prize is still open and they have not won since.
- The board's winner card can show **Not present** too (and `A`), signed-in
  organisers only unless you allow otherwise, with or without a confirmation.
- The prize opens again and is **the next one drawn** — the room redraws the
  prize it was watching. *Spin again straight away* skips waiting for Start.
- A struck-off entry stays **out of later draws** unless *Return the absent
  entry to the pool* is on. *Redraws allowed per prize* caps how often one
  prize can be redrawn (0 is no limit).
- Struck-off entries are kept: in the board's winners panel (tagged), in the
  CSV export (with a Status column) and on the certificate — each optional.

## Draw certificate

**Certificate** in the console configures a printable record of the draw:
title, subtitle, venue, a statement with placeholders (`{event}`,
`{organization}`, `{date}`, `{venue}`, `{winners}`, `{entries}`, `{prizes}`),
how the winners were chosen, a footnote, signature lines with names and roles,
which columns are printed for each winner, paper size and orientation, and an
accent colour. Sensitive columns can be masked to their last four characters.

**Open certificate** shows it at `/certificate`; print it, or save it as PDF
from the print dialog. Only a signed-in organiser can load it.

Each certificate carries:

- a **reference** made of the prefix, the date of the draw and a code from the
  results — a reprint of the same results has the same reference;
- the **entry-list fingerprint**: a SHA-256 of the entry list, recorded the
  moment the first winner is drawn. Records are written as their fields in key
  order and sorted, so the hash does not depend on row order, and anyone with
  the original list can recompute it. If the list has changed since, the
  certificate says so;
- a **results fingerprint**: a SHA-256 of every draw in order — who, which
  prize, when, and whether they were struck off.

## Event templates

**Templates** saves the configuration so the next event can start from it.

- **Save** the current configuration as a template, choosing which parts it
  holds: event details, logo & backdrop, colours & layout, wording, prizes,
  welcome screen, social channels, reel & celebration, draw rules, sound,
  countdown, certificate, fields & display. Templates are made from the
  **saved** configuration, so save any panel you are editing first.
- **Apply** a template in whole or in part. Each part replaces the same part of
  this event and nothing else; the event's own name can be kept. Applying never
  removes your uploaded tracks, and keeps this event's countdown time.
- **Export** a template — or the current configuration directly — as a `.json`
  file. **Export with files** embeds the images and tracks it uses, so it works
  on another Pickora (another tenant, say). **Import** checks every embedded file
  against the hash in its name and its actual type, and leaves out any that do
  not match.
- Four **built-in** templates are starting points: *Gala evening*, *Game show*,
  *Arabic event (RTL)* and *Quiet room*. Review the Arabic wording with a native
  speaker before the event.

Templates are stored per deployment in `templates.json` (or the key-value store),
never served to a browser. An uploaded file is not deleted while any template
still uses it.

## Sponsors

Under **Sponsors**: add each sponsor — name, tier (free text, so "Title
sponsor" or "Official car partner" reads as the contract says), website,
tagline and logo — and choose which prize each one stands behind.

Sponsors can be credited, each switchable:

- when the prize is announced on the board, and on the winner card;
- on the prize screen and on the draw certificate;
- in the results export, as a Sponsor column.

The credit wording ("Sponsored by"), the logo size, and whether the name and
tagline show beside the logo are all configurable.

A **sponsor strip** can run along the top or bottom of the board, welcome and
prize screens: its own heading, logo height, how many logos are visible, how
often it turns, names under the logos, and which tiers appear. Anything on that
edge — the footer, the QR block — moves clear of it.

## Spin-the-wheel

**Draw style** chooses the reel or a wheel. The wheel's segment count,
colours, text and rim colour, size, text size, speed, time to come to rest,
pointer side, centre logo or text, and which field is written on the segments
are all configurable, with a test spin in the console.

The winner is still drawn by the server. While the wheel is still spinning
fast, the winner's name is written on the segment directly opposite the
pointer, the one furthest from anyone's eye; the wheel then slows at a
constant rate so exactly that segment stops under the pointer. Only fields the
board already shows, never sensitive ones, can go on the wheel, because every
remaining entry's label is on screen.

## Live sync between screens

With **Live sync** on, one draw board runs the draw and the others follow:
they spin when it spins, reveal the same winner at the same moment, and go to
the welcome or prize screen when it does. Every screen checks in on the
configured interval; the draw itself is still made once, on the server.

- **Which board runs the draw:** the first one opened, or only one opened as
  the main board at `/?role=main`. A main board takes over from one that was
  merely first. If it closes, another takes over after the configured time.
- **Following boards** hide Start and Stop unless allowed to draw, can play
  sound and celebrate or stay quiet, and carry a small "follows the main board"
  chip if wanted.
- Settings changed in the console reach every open screen on its next check.

The **Live sync** panel lists the address to open on each screen.

## Phone remote

Run the draw from a phone: Start and Stop, Not present, switch screens, mute.
Under **Remote**, switch it on, choose what it may do, and **pair a phone** by
scanning the QR code. The phone opens `/remote`, a page built for one hand.

- The phone **sends commands**; the main draw board carries them out exactly
  as if its own buttons were pressed. "Not present" is done by the server
  straight away, and the board shows it.
- A pairing is a secret link, valid for the configured number of hours (or
  until unpaired). A new pairing replaces the old one, and "Reset event" always
  unpairs. The key is never sent to a public page, never stored in a template,
  and is taken out of the phone's address bar as soon as it is read.
- Wrong keys count towards the same 15-minute lockout as wrong passwords.
  Requiring an organiser sign-in on the phone is an option.
- The board checks for commands on its own interval; "Remote connected" can
  show on it.

## Reset event

**Reset event** gets the same Pickora ready for the next event. Download what
you need first (results, entries, certificate, the configuration with its
files), then choose what to clear — draw results, entries, prizes, welcome,
sponsors, social channels, uploaded images, your sound tracks, all settings,
saved templates — or use a preset: *Results only*, *Next event, same look*,
*Everything but templates*.

To confirm, type the event's name and your console password, and tick that you
have downloaded what you need; a last dialog lists what will go. The server
checks the name and the password again, and wrong passwords count towards the
sign-in lockout. Your sign-in is never touched. Uploaded files are deleted
only once nothing — the event or a saved template — still uses them.

## Getting new code to people

Nobody should have to hard-refresh, clear a cache or clear their history to
pick up a fix. Three things see to that.

**Asset URLs carry the build.** Every script, stylesheet and icon a page pulls
in is requested as `script.js?v=<build>`. A new deployment asks for different
URLs, so no cache anywhere — the browser's, a proxy's, a CDN edge's — can serve
the previous build's file in their place, whatever it believes about freshness.
Because the URL is unique to the build, those files are then cached hard
(`immutable`), which is both faster and safer than revalidating.

**The page itself is never cached.** It is what says which build's assets to
fetch, so it revalidates on every visit against an entity tag that changes with
the build. That costs one small conditional request.

**A page left open notices.** A board projected in a hall may be open for
hours, and will never ask for new code by itself however correct the caching
is. Each page states its build, and checks `/api/build` on a quarter-hour and
whenever someone returns to the tab. If it has been superseded it reloads —
but never mid-spin: losing a draw because a deployment landed would be far
worse than showing yesterday's code for another minute.

### The bug this replaced

The static handler used to send `Last-Modified` from the file's modification
time. Vercel stamps every build's files with the same fixed date, so a browser
revalidated with that date, the edge compared it against an identical one and
answered `304 Not Modified`, and the old file was kept — permanently. Nothing
short of a hard refresh could dislodge it:

```
If-Modified-Since: Sat, 20 Oct 2018 01:46:40 GMT  →  304   (before)
                                                  →  200   (after)
```

Modification times are not trusted anywhere now. The build is the deployment's
commit where there is one, and otherwise a hash of the served files themselves.

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
| `draw.minimumRollMs` | Shortest a roll may last; an early Stop is spent slowing down rather than waiting |
| `draw.stopResponseMs` | Least time, 0–10000ms (default 0), the reel keeps rolling gently after Stop before it settles on the winner. A slower draw is waited for regardless; 0 settles as soon as the draw is made |
| `animation.rollingSpeed` | Milliseconds per entry on the reel |
| `animation.winnerAnnouncementDelay` | How long the announcement is held before the winner card, 0–30000ms (default 5000). Timed from the moment the reel stops; 0 skips the announcement entirely |
| `animation.confettiStartDelay`, `confettiDuration`, `confettiCount` | Confetti timing and density. Two cannons fire from the bottom corners, a softer fall keeps coming from above, and emission stops early so the last pieces drift out of frame rather than being cut off |
| `animation.confettiPalette` | Up to 12 hex colours for the confetti |
| `animation.celebration` | Which celebration fires: `classic`, `streamers`, `stars`, `balloons`, `snow`, `money`, `mix` or `none` |
| `ui.showEventName` | Show the event name on the board. Off gives the header back to the draw |
| `ui.showNewDrawButton` | Offer "New draw" on the board at all. **Off by default**: the button clears every winner drawn so far, and a projected board stands in a room full of people. Off removes the button and its N shortcut; an organiser still has **Reset draw** in the console |
| `ui.reel.width` / `.height` / `.fontSize` | The draw reel's measurements in pixels. Zero means the board sizes that dimension to the screen, as it does unconfigured |
| `ui.controls.minWidth` / `.height` / `.fontSize` / `.paddingX` | The buttons' measurements in pixels; zero is again "leave it to the board" |
| `ui.controls.radius` | Corner radius in pixels. Unlike the rest, zero is a real choice — a square corner — so this defaults to 999 |
| `branding.background.overlayOpacity` | How far the backdrop is darkened, 0–100. Higher darkens it so text stays readable; 0 leaves the photograph untouched |
| `text.welcome` / `.prizes` / `.board` | How the words are set on each screen, one block each and independent of one another |
| `text.*.fontFamily` | `display`, `body`, `mono`, `system`, `sans` or `serif` — faces the application ships, so this still works offline |
| `text.*.fontSize` | Size in pixels, 0–200. Zero means the screen keeps the size it chooses for itself |
| `text.*.fontWeight` | 300, 400, 500, 600, 700 or 800; zero leaves the screen's own weight |
| `text.*.backdrop.color` | The plate behind the words, as hex |
| `text.*.backdrop.opacity` | 0–100. Zero is no plate at all, and is the default |
| `text.*.backdrop.radius` | `none`, `slight`, `rounded` or `pill` |
| `text.*.backdrop.padding` | `none`, `small`, `medium` or `large`, in em so it scales with the text |
| `text.*.color` | Hex, or empty for the screen's own colour |
| `text.*.opacity` | 0–100; 100 is the same as saying nothing |
| `text.*.align` | `auto`, `left`, `center` or `right` |
| `text.*.lineHeight` | Percentage, 0–300; zero leaves the screen's own |
| `text.*.letterSpacing` | Hundredths of an em, −20 to 100; zero leaves it normal |
| `welcome.carousel` / `prizes.carousel` | The frame each screen cuts its photographs to, and where it sits. One block each, independent |
| `*.carousel.shape` | `rectangle`, `rounded`, `square`, `oval` or `circle` |
| `*.carousel.aspect` | `standard` 4:3, `wide` 16:9 or `classic` 3:2. Ignored by the two square shapes |
| `*.carousel.radius` | Corner radius in pixels, 0–80. Used by `rounded` only |
| `*.carousel.placement` | `top`, `center`, `bottom`, `left` or `right`. The last two stack on a phone, picture first |
| `*.carousel.showDots` | Show the navigation dots under the photographs. On by default; off leaves the carousel turning without them |
| `prizes.board.imageMode` | `single` shows the first photograph, `carousel` shows each in turn |
| `prizes.board.autoplay`, `.slideMs` | Whether the carousel advances on its own, and how long each photograph holds (1000–20000) |
| `prizes.board.transition` | `fade` or `slide` |
| `prizes.board.showDots` | Show the dots that say how many photographs there are |
| `prizes.board.shape` | `rounded`, `circle` or `oval` |
| `social.channels[]` | The links, in order: `{ id, type, url, label }` |
| `social.qr.style` | `standard`, `colored`, `logo` or `rounded` |
| `social.qr.position` | `bottom-left`, `bottom-right`, `bottom-center`, `top-right`, `sidebar` or `footer` |
| `social.qr.size` | `small` 48px, `medium` 80px, `large` 128px, `xl` 180px |
| `social.qr.display` | `icons`, `qr` or `both` |
| `branding.logo` | Uploaded file, corner position, on-screen height |
| `branding.background` | Uploaded file, fit mode, darkening overlay |
| `welcome.enabled`, `showOnLoad`, `placement` | Whether the guest welcome shows, when, and where |
| `welcome.title`, `message` | Heading and message; line breaks are preserved |
| `welcome.images[]` | Photo path, caption and dimensions, in carousel order |
| `welcome.intervalMs` | How long each photo holds (1500–60000) |
| `prizes.enabled`, `heading`, `intro` | Whether the prize screen shows, and its wording |
| `prizes.items[]` | Rank label, name, description and photos, in rank order |
| `prizes.intervalMs` | How long each prize photo holds |
| `prizes.showOnWinner` | Name the matching prize on the winner card |
| `prizes.drawOrder` | `highest-first` (1st → 3rd) or `lowest-first` (3rd → 1st) |
| `prizes.announceMode` | `before` names the prize ahead of its draw, `after` holds it back |
| `welcome.showCaptions` | Show the caption under the carousel |
| `copy.*` | Every string on the board — headings, buttons, empty states, footer |
| `ui.primaryColor` | Accent colour across the board |
| `ui.backgroundColor` | CSS painted behind the backdrop image |
| `ui.boardAlignment` | `left` / `center` / `right` — moves the stage clear of artwork |
| `branding.logo.position` | `top-left` / `top-center` / `top-right` / `bottom-left` / `bottom-center` / `bottom-right` / `hidden` |
| `draw.allowResetFromBoard` | Let anyone use **New draw** on the board; otherwise it is offered only to a signed-in organiser |
| `ui.showWinnersPanel`, `ui.showStats`, `ui.showOrganizationName` | Board furniture |
| `sound.enabled`, `sound.volume`, `sound.showMuteButton` | Sound on or off, master volume 0–100, the speaker button on the screens |
| `sound.library[]` | Uploaded tracks — id, name, file, format, size. Managed by uploads, not typed |
| `sound.cues.<cue>` | `ambient`, `spin`, `land`, `reveal`, `absent`, `countdownTick`, `countdownEnd`: `enabled`, `source` (`preset`/`track`), `preset`, `track`, `volume` 0–100, `delayMs`, `durationMs` (0 = natural), `fadeInMs`, `fadeOutMs`, `startAtMs`, `loop` |
| `sound.cues.ambient.screens`, `.pauseDuringDraw` | Which screens play the background music, and whether it steps aside for the draw |
| `redraw.enabled` | Allow striking off a winner who is not present (off by default) |
| `redraw.showOnBoard`, `.requireSignIn`, `.confirmOnBoard` | Whether the board's winner card offers it, who may use it there, and whether it asks first |
| `redraw.autoRedraw`, `.returnToPool`, `.maxPerPrize` | Spin again at once; let the absentee back into later draws; redraws per prize (0 = no limit) |
| `redraw.noticeMs`, `.showInPanel`, `.includeInExport` | How long the board says "not present"; list absentees in the winners panel and the CSV |
| `countdown.enabled`, `.targetAt` | Show the countdown, and the moment it reaches zero (ISO 8601 with offset) |
| `countdown.title`, `.subtitle`, `.completeMessage`, `.labels.*` | Its words |
| `countdown.style`, `.position`, `.units`, `.screens.*` | `overlay` or `banner`, banner `top`/`bottom`, `auto`/`dhms`/`hms`/`ms`, which screens |
| `countdown.lockDraw`, `.finalSeconds`, `.completeHoldSeconds` | Hold the draw until zero; the emphasised final stretch; how long the closing message stays (0 = until the first draw) |
| `sponsors.enabled`, `.label`, `.items[]`, `.prizeSponsors` | Sponsors on or off, the credit wording, the list (id, name, tier, url, tagline, logo), and prize id → sponsor id |
| `sponsors.display.*` | `announcement`, `winnerCard`, `prizeScreen`, `certificate`, `export`, `showName`, `showTagline`, `logoSize` |
| `sponsors.strip.*` | `enabled`, `heading`, `position`, `screens.*`, `intervalMs`, `logoHeight`, `perView`, `showNames`, `tiers[]` |
| `wheel.*` | `style` (`reel`/`wheel`), `segments`, `palette[]`, `textColor`, `borderColor`, `size`, `fontSize`, `speed` (tenths of a turn per second), `settleMs`, `pointer`, `showLabels`, `centerLogo`, `centerText`, `labelField` |
| `liveSync.*` | `enabled`, `pollMs`, `controllerMode` (`auto`/`main-only`), `leaseSeconds`, `mirrorDraws`, `followNavigation`, `followersCanDraw`, `soundOnFollowers`, `celebrateOnFollowers`, `screens.*`, `showStatus` |
| `remote.*` | `enabled`, `requireSignIn`, `actions.{draw,notPresent,screens,sound}`, `confirmNotPresent`, `haptics`, `pollMs`, `showStatusOnBoard`, `expiryHours`; the pairing `key` is managed by the console and never public |
| `certificate.*` | `enabled`, `title`, `subtitle`, `referencePrefix`, `statement`, `methodText`, `venue`, `footerNote`, `show*` toggles, `maskSensitive`, `fields[]`, `signatories[]`, `paper`, `orientation`, `accentColor` |

Every value is validated and clamped server-side, so a bad entry cannot break
the board mid-event. Unknown fields referenced by a display slot are dropped,
and an emptied slot falls back to the identifier rather than showing nothing.

---

## API

Public:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Storage driver, whether it can be written to, and the deployed build |
| `GET` | `/api/build` | The running build, for a page checking whether it is current |
| `GET` | `/api/settings` | Board configuration (never credentials) |
| `GET` | `/api/pool` | Remaining ticket numbers + counters |
| `GET` | `/api/state` | Winners so far + counters |
| `POST` | `/api/draw` | Draw one winner |
| `POST` | `/api/draw/reset` | Clear the draw from the board (organiser, or when allowed) |
| `POST` | `/api/draw/absent` | Strike off the winner on the board as not present (when allowed) |
| `POST` | `/api/live/poll` | A screen checking in: events since its cursor, who is in control, remote commands for the controller |
| `POST` | `/api/live/status` | The controlling board saying what it is doing |
| `GET` | `/api/remote/state` | The phone remote's view (pairing key or sign-in) |
| `POST` | `/api/remote/command` | A command from the phone remote (pairing key or sign-in) |

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
| `POST` | `/api/admin/tickets/sheet` |
| `POST` | `/api/admin/assets/:kind` |
| `DELETE` | `/api/admin/assets/:kind` |
| `POST` | `/api/admin/welcome/images` |
| `DELETE` | `/api/admin/welcome/images` |
| `POST` | `/api/admin/prizes/:id/images` |
| `DELETE` | `/api/admin/prizes/:id/images` |
| `POST` | `/api/admin/draw/undo` |
| `POST` | `/api/admin/draw/reset` |
| `GET` | `/api/admin/export/winners.csv` |
| `POST` | `/api/admin/draw/absent` |
| `POST` | `/api/admin/draw/restore` |
| `POST` | `/api/admin/sound/tracks` |
| `PATCH` | `/api/admin/sound/tracks/:id` |
| `DELETE` | `/api/admin/sound/tracks/:id` |
| `GET` | `/api/admin/certificate` |
| `GET` | `/api/admin/templates` |
| `POST` | `/api/admin/templates` |
| `POST` | `/api/admin/templates/import` |
| `PUT` | `/api/admin/templates/:id` |
| `DELETE` | `/api/admin/templates/:id` |
| `POST` | `/api/admin/templates/:id/apply` |
| `GET` | `/api/admin/templates/:id/export` (`current` for the live configuration, `?embed=1` for files) |
| `POST` | `/api/admin/remote/key` |
| `DELETE` | `/api/admin/remote/key` |
| `POST` | `/api/admin/sponsors/:id/logo` |
| `DELETE` | `/api/admin/sponsors/:id/logo` |
| `POST` | `/api/admin/reset-event` |

---

## How the draw works

Selection happens **on the server**, using `crypto.randomInt` (Node) or
`secrets.randbelow` (Python) — both uniform and cryptographically sound. Each
winner is appended to `winners.json` before the response is sent, so a refresh,
a crashed browser or a second screen can never lose or duplicate a result.

Each draw records how many entries it chose from, and the first one records a
fingerprint of the whole entry list (see *Draw certificate*). A winner struck
off as not present is moved to a separate list rather than deleted; their prize
is the next one drawn, and every draw keeps its own number, so the record of
what happened is never rewritten.

Failed sign-ins are throttled to 8 attempts per 15 minutes per address. Session
cookies are HttpOnly, SameSite=Lax, and marked Secure behind HTTPS, and last
14 days by default — set `SESSION_TTL_HOURS` to change that.

The key that signs them is derived from the stored credential unless
`SESSION_SECRET` is set, so every instance of a scaled deployment agrees
without configuration. Changing the password rotates the key, which signs out
anyone holding an older cookie.

---

## Project structure

```
pickora/
├── index.html / styles.css / script.js   # public draw board
├── admin.html / admin.css                # organiser console
│   ├── admin.js                          # console shell, data, draw supervision
│   └── admin-config.js                   # fields, display slots, branding, wording,
│                                         # board layout, text and media
├── api.js                                # shared API client
├── confetti.js                           # the celebrations, all seven of them
├── sound.js / sound-presets.js           # the sound engine and its built-in sounds
├── countdown.js                          # the countdown, on every public screen
├── certificate.html / certificate.js     # the printable draw certificate
├── admin-features.js                     # console registry for the panels below
│   ├── admin-sound.js / admin-countdown.js
│   └── admin-certificate.js / admin-templates.js
├── template-presets.json                 # the built-in templates
├── sponsors.js / wheel.js / live-sync.js # sponsors, the wheel, the live channel
├── remote.html / remote.js               # the phone remote
│   └── admin-sponsors.js / admin-wheel.js / admin-live.js
│       admin-remote.js / admin-reset.js   # their console panels
├── qr.js                                 # QR encoder, level H, no dependency
├── social.js                             # the channel block on public pages
├── welcome.html / prizes.html            # the two feature screens
├── feature-page.js                       # their shared controller
├── carousel.js                           # the shared image slider, on the board,
│                                         # the feature screens and the console preview
├── theme.js                              # one identity across every page
├── fonts/                                # bundled webfonts (no CDN)
├── server.js                             # local entry point (no dependencies)
├── api/index.js                          # serverless entry point (Vercel)
├── vercel.json                           # routes every request to the function
├── Dockerfile / .dockerignore            # one container per event
├── docker-compose.yml                    # several events behind one proxy
├── deploy/                               # Caddyfile and per-tenant env templates
│   └── server/                           # app, micro (http shim), paths, store,
│                                         # auth, schema, settings, tickets,
│                                         # draw, images, routes — and for the
│                                         # event features: coerce, features,
│                                         # audio, templates, feature-routes,
│                                         # stage-features, live, reset,
│                                         # stage-routes
├── tests/                                # npm test — node:test, no packages
├── app.py                                # Flask entry point
│   └── pyserver/                         # the same modules in Python
├── tickets.json / appsettings.json       # data
├── assets/                               # uploaded logo, backdrop, guest photos
├── windows/                              # one-click installer and shortcuts
├── tools/make-default-artwork.py         # regenerates the placeholder artwork
├── tools/verify-qr.py                    # checks qr.js against a reference
├── archive/                              # the event artwork this replaced
└── pickora-logo.png / -background.jpg    # bundled placeholder identity
```

## Running the tests

```bash
npm test
```

Runs the server suite with Node's own test runner — no packages to install. It
covers the draw (including redraws and the fingerprint), the settings for the
event features, audio checks, templates, and every new endpoint end to end
against a real server with a throwaway data directory.

`PICKORA_TEST_URL=http://127.0.0.1:5000 node --test tests/api.test.js` runs the
endpoint tests against a server already running — the Flask mirror, for
instance — started with `ADMIN_USERNAME=organiser` and
`ADMIN_PASSWORD=correct-horse-battery`.

---

## License

MIT.
