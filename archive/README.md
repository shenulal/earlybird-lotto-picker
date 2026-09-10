# Archived artwork

The images the board originally shipped with. They are kept here for reference
only — nothing in the application points at them any more, and they are not
served as part of a deployment.

| File | Size | Notes |
| --- | --- | --- |
| `Background.png` | 1984 × 1026 | Backdrop produced for the AKCAF Onam event |
| `logo.jpg` | 1267 × 1088 | Kalandoor Group / Varma Homes mark used on that board |

Both are specific to that event and its sponsors, so they were replaced by the
neutral Pickora placeholders in the project root:

- `pickora-background.jpg`
- `pickora-logo.png`

A settings file that still names `Background.png` or `logo.jpg` is remapped to
those placeholders when it is read, so an older deployment upgrades without a
broken image on screen.

## Putting one of these back

Upload it through the organiser console — **Branding → Logo / Background**. The
console copies it into the asset store, which is the only place the board reads
uploaded artwork from. Dropping a file back into the project root works for a
local install but is lost on the next deployment.
