# Offline installation

Pickora itself needs **no downloads** — it has zero npm dependencies and its
fonts are bundled. The only thing a bare PC might be missing is **Node.js**.

To make setup work on a machine with no internet, put one of these here before
copying the folder across:

## Option A — the Node.js installer (recommended)

1. On a PC with internet, download the Windows **.msi**, LTS, 64-bit, from
   <https://nodejs.org/en/download>
2. Drop the file into this `vendor` folder, keeping its name
   (for example `node-v20.11.1-x64.msi`).
3. Copy the whole Pickora folder to the event PC and run `Install-Pickora.bat`.

The installer finds the `.msi` here and installs Node.js silently, with no
network access.

## Option B — a portable Node.js build

1. Download the Windows **.zip** from the same page.
2. Extract it so that `node.exe` sits at `vendor\node\node.exe`.

Nothing is installed system-wide in this case — Pickora just uses that copy.

## Neither?

If Node.js is already installed on the event PC, you do not need anything here.
The installer checks the PC first and only falls back to this folder.
