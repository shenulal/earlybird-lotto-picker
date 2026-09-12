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
| **Participants** | Upload the entry list or link a Google Sheet, with a column preview; download a template, export, or delete |
| **Board layout** | How big the reel and the buttons are, and how far the backdrop is darkened — judged against a live preview of the board |
| **Text & media** | How the words are set on each screen — face, size, weight, colour, opacity, alignment, line height, letter spacing — and how a prize's photographs are shown on the board, with a live preview |
| **Channels** | Social links and their QR codes: style, position, size, display mode, with a live preview |
| **Fields** | Rename columns, mark sensitive ones, choose the identifier and what appears in the export |
| **Display** | Choose exactly which fields appear while spinning, on the announcement, on the winner card and in the winners list, and how long the announcement is held before the card — with a rehearsal of the reveal |
| **Branding** | Upload the logo and backdrop, with size and resolution validated on the server |
| **Welcome** | Greet a chief guest with a message and a carousel of photos |
| **Prizes** | Build the prize list, each with its own photo carousel |
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
- **It comes to rest on the winner.** The draw is requested the instant Stop is
  pressed, so the answer is usually in hand while the reel is still slowing and
  it can land on the entry that actually won, rather than on a stranger who is
  then replaced.
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
| `animation.rollingSpeed` | Milliseconds per entry on the reel |
| `animation.winnerAnnouncementDelay` | How long the announcement is held before the winner card, 0–30000ms (default 5000). Timed from the moment the reel stops; 0 skips the announcement entirely |
| `animation.confettiStartDelay`, `confettiDuration`, `confettiCount` | Confetti timing and density. Two cannons fire from the bottom corners, a softer fall keeps coming from above, and emission stops early so the last pieces drift out of frame rather than being cut off |
| `animation.confettiPalette` | Up to 12 hex colours for the confetti |
| `animation.celebration` | Which celebration fires: `classic`, `streamers`, `stars`, `balloons`, `snow`, `money`, `mix` or `none` |
| `ui.showEventName` | Show the event name on the board. Off gives the header back to the draw |
| `ui.showNewDrawButton` | Offer "New draw" on the board at all. Off removes the button and its N shortcut |
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

---

## How the draw works

Selection happens **on the server**, using `crypto.randomInt` (Node) or
`secrets.randbelow` (Python) — both uniform and cryptographically sound. Each
winner is appended to `winners.json` before the response is sent, so a refresh,
a crashed browser or a second screen can never lose or duplicate a result.

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
│   └── server/                           # app, micro (http shim), paths, store,
│                                         # auth, schema, settings, tickets,
│                                         # draw, images, routes
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

## License

MIT.
