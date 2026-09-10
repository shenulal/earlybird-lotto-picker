#!/usr/bin/env python3
"""Checks qr.js against a reference QR encoder.

The board builds its own QR codes so that it needs no network and no runtime
dependency, which means nothing but a test stands between a subtle encoding
mistake and a code that looks perfectly well formed and scans as nothing at
all. Two of the three bugs found while writing it — the format bits placed in
reverse, and the wrong generator polynomial for the version information — were
invisible by eye and produced exactly that.

    pip install qrcode        # test-only, never imported by the application
    python3 tools/verify-qr.py

A payload passes when the modules are identical to the reference, or when they
are identical under one of the eight masks: the standard leaves the choice of
mask to the encoder, and the two implementations score the format modules at
slightly different moments.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    from qrcode.util import QRData, MODE_8BIT_BYTE
except ImportError:  # pragma: no cover - the message is the point
    sys.exit("This check needs the reference encoder: pip install qrcode")

ROOT = Path(__file__).resolve().parent.parent

CASES = [
    "A",
    "https://example.com",
    "https://instagram.com/pickora",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://wa.me/971500000000",
    "https://example.com/a-fairly-long-path/with/segments"
    "?utm_source=poster&utm_medium=qr&utm_campaign=annual-prize-draw-2026",
    "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0",
    "https://example.com/" + "x" * 300,
    "https://example.com/café-résumé",
]

DUMP = """
global.window = global;
require(process.argv[2]);
const fs = require('fs');
const cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const rows = (m) => m.modules.map((r) => r.map((v) => (v ? '1' : '0')).join(''));
const out = cases.map((text) => {
  const chosen = window.pickoraQr.matrixFor(text);
  const masks = {};
  for (let mask = 0; mask < 8; mask += 1) masks[mask] = rows(window.pickoraQr.matrixFor(text, { mask }));
  return { text, version: chosen.version, mask: chosen.mask, rows: rows(chosen), masks };
});
fs.writeFileSync(process.argv[4], JSON.stringify(out));
"""


def reference(text: str) -> list[str]:
    code = qrcode.QRCode(error_correction=ERROR_CORRECT_H, border=0, box_size=1)
    code.add_data(QRData(text.encode("utf-8"), mode=MODE_8BIT_BYTE))
    code.make(fit=True)
    return ["".join("1" if cell else "0" for cell in row) for row in code.get_matrix()]


def main() -> None:
    with tempfile.TemporaryDirectory() as work:
        script = Path(work) / "dump.js"
        cases_file = Path(work) / "cases.json"
        result_file = Path(work) / "mine.json"
        script.write_text(DUMP)
        cases_file.write_text(json.dumps(CASES))
        subprocess.run(
            ["node", str(script), str(ROOT / "qr.js"), str(cases_file), str(result_file)],
            check=True,
        )
        mine = json.loads(result_file.read_text())

    failures = 0
    for got in mine:
        expected = reference(got["text"])
        label = f"v{got['version']:<2} mask={got['mask']} len={len(got['text'])}"

        if expected == got["rows"]:
            print(f"  PASS   {label}  identical to the reference")
            continue

        alternative = [mask for mask, rows in got["masks"].items() if rows == expected]
        if alternative:
            print(f"  PASS   {label}  identical under mask {alternative[0]} (mask choice differs)")
            continue

        failures += 1
        differing = (
            sum(a != b for ra, rb in zip(expected, got["rows"]) for a, b in zip(ra, rb))
            if len(expected) == len(got["rows"])
            else "size differs"
        )
        print(f"  FAIL   {label}  {differing} modules differ under every mask")

    print(f"\n  {len(mine) - failures}/{len(mine)} payloads verified")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
