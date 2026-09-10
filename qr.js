/**
 * NEW: a QR encoder, in about as little code as the job takes.
 *
 * The board has to work with no network at all, so a hosted QR image is out,
 * and the project carries no runtime dependencies — so the codes are built
 * here. Byte mode at error-correction level H throughout: H is what lets a
 * logo sit in the middle of a code and still scan, and the payloads are short
 * enough that the extra redundancy costs nothing anyone will notice.
 *
 * `matrixFor(text)` gives the raw modules; `toSvg(text, options)` gives markup
 * ready to drop into a page.
 */
(function attachQr(global) {
  'use strict';

  /* ------------------------------------------------------- GF(256) maths */

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);

  (function buildTables() {
    let value = 1;
    for (let power = 0; power < 255; power += 1) {
      EXP[power] = value;
      LOG[value] = power;
      value <<= 1;
      // The QR field is defined modulo x^8 + x^4 + x^3 + x^2 + 1.
      if (value & 0x100) value ^= 0x11d;
    }
    for (let power = 255; power < 512; power += 1) EXP[power] = EXP[power - 255];
  })();

  function multiply(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  /** The generator polynomial for `degree` error-correction codewords. */
  function generatorPoly(degree) {
    let poly = [1];
    for (let step = 0; step < degree; step += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let index = 0; index < poly.length; index += 1) {
        next[index] ^= poly[index];
        next[index + 1] ^= multiply(poly[index], EXP[step]);
      }
      poly = next;
    }
    return poly;
  }

  /** Polynomial division; the remainder is the error correction. */
  function errorCorrection(data, count) {
    const generator = generatorPoly(count);
    const remainder = new Array(count).fill(0);

    for (const byte of data) {
      const factor = byte ^ remainder[0];
      remainder.shift();
      remainder.push(0);
      if (factor !== 0) {
        for (let index = 0; index < count; index += 1) {
          remainder[index] ^= multiply(generator[index + 1], factor);
        }
      }
    }
    return remainder;
  }

  /* ------------------------------------------------------------- version */

  /**
   * Block structure at level H, versions 1 to 20:
   * [error-correction codewords per block, blocks in group 1, data codewords
   * in each, blocks in group 2, data codewords in each].
   *
   * Twenty versions carries 382 bytes, which is more URL than anyone will put
   * on a poster.
   */
  const BLOCKS_H = [
    [17, 1, 9, 0, 0],
    [28, 1, 16, 0, 0],
    [22, 2, 13, 0, 0],
    [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0],
    [26, 4, 13, 1, 14],
    [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13],
    [28, 6, 15, 2, 16],
    [24, 3, 12, 8, 13],
    [28, 7, 14, 4, 15],
    [22, 12, 11, 4, 12],
    [24, 11, 12, 5, 13],
    [24, 11, 12, 7, 13],
    [30, 3, 15, 13, 16],
    [28, 2, 14, 17, 15],
    [28, 2, 14, 19, 15],
    [26, 9, 13, 16, 14],
    [28, 15, 15, 10, 16],
  ];

  const ALIGNMENT = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
    [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  ];

  function dataCapacity(version) {
    const [, group1, data1, group2, data2] = BLOCKS_H[version - 1];
    return group1 * data1 + group2 * data2;
  }

  /* -------------------------------------------------------------- encode */

  function toBytes(text) {
    // Byte mode is defined over ISO-8859-1, but every reader in practice takes
    // UTF-8, which is what a URL with anything but ASCII in it needs.
    return Array.from(new TextEncoder().encode(text));
  }

  function encodeData(bytes, version) {
    const bits = [];
    const push = (value, length) => {
      for (let shift = length - 1; shift >= 0; shift -= 1) bits.push((value >> shift) & 1);
    };

    push(0b0100, 4); // Byte mode.
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((byte) => push(byte, 8));

    const capacityBits = dataCapacity(version) * 8;
    // Terminator, then pad to a whole codeword, then the standard filler.
    for (let index = 0; index < 4 && bits.length < capacityBits; index += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let index = 0; index < bits.length; index += 8) {
      codewords.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
    }
    const padding = [0xec, 0x11];
    while (codewords.length < dataCapacity(version)) {
      codewords.push(padding[(codewords.length - bits.length / 8) % 2]);
    }
    return codewords;
  }

  /** Splits into blocks, adds the correction, and interleaves both. */
  function buildCodewords(bytes, version) {
    const [ecCount, group1, data1, group2, data2] = BLOCKS_H[version - 1];
    const codewords = encodeData(bytes, version);

    const blocks = [];
    let offset = 0;
    for (let index = 0; index < group1; index += 1) {
      blocks.push(codewords.slice(offset, offset + data1));
      offset += data1;
    }
    for (let index = 0; index < group2; index += 1) {
      blocks.push(codewords.slice(offset, offset + data2));
      offset += data2;
    }

    const corrections = blocks.map((block) => errorCorrection(block, ecCount));

    const result = [];
    const longest = Math.max(data1, data2);
    for (let column = 0; column < longest; column += 1) {
      blocks.forEach((block) => {
        if (column < block.length) result.push(block[column]);
      });
    }
    for (let column = 0; column < ecCount; column += 1) {
      corrections.forEach((block) => result.push(block[column]));
    }
    return result;
  }

  /* -------------------------------------------------------------- matrix */

  function createGrid(size, fill) {
    return Array.from({ length: size }, () => new Array(size).fill(fill));
  }

  function placeFinder(modules, reserved, row, column) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const targetY = row + y;
        const targetX = column + x;
        if (targetY < 0 || targetX < 0 || targetY >= modules.length || targetX >= modules.length) continue;

        const onRing = (y === 0 || y === 6) && x >= 0 && x <= 6;
        const onSide = (x === 0 || x === 6) && y >= 0 && y <= 6;
        const inCore = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        modules[targetY][targetX] = onRing || onSide || inCore;
        reserved[targetY][targetX] = true;
      }
    }
  }

  function placeAlignment(modules, reserved, version) {
    const centres = ALIGNMENT[version - 1];
    const last = centres.length - 1;

    centres.forEach((row, rowIndex) => {
      centres.forEach((column, columnIndex) => {
        // The three finder corners have no alignment pattern.
        const atFinder =
          (rowIndex === 0 && columnIndex === 0) ||
          (rowIndex === 0 && columnIndex === last) ||
          (rowIndex === last && columnIndex === 0);
        if (atFinder) return;

        for (let y = -2; y <= 2; y += 1) {
          for (let x = -2; x <= 2; x += 1) {
            modules[row + y][column + x] = Math.max(Math.abs(y), Math.abs(x)) !== 1;
            reserved[row + y][column + x] = true;
          }
        }
      });
    });
  }

  function placeTiming(modules, reserved, size) {
    for (let index = 8; index < size - 8; index += 1) {
      const dark = index % 2 === 0;
      modules[6][index] = dark;
      modules[index][6] = dark;
      reserved[6][index] = true;
      reserved[index][6] = true;
    }
  }

  function reserveFormat(reserved, size) {
    for (let index = 0; index <= 8; index += 1) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
    for (let index = 0; index < 8; index += 1) {
      reserved[8][size - 1 - index] = true;
      reserved[size - 1 - index][8] = true;
    }
    // The module that is always dark.
    reserved[size - 8][8] = true;
  }

  function formatBits(mask) {
    // Level H is 0b10; the five data bits are the level then the mask.
    const data = (0b10 << 3) | mask;
    let remainder = data << 10;
    for (let bit = 14; bit >= 10; bit -= 1) {
      if (remainder & (1 << bit)) remainder ^= 0b10100110111 << (bit - 10);
    }
    return ((data << 10) | remainder) ^ 0b101010000010010;
  }

  function versionBits(version) {
    // BCH(18,6) over x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1, which is
    // a different polynomial from the format's and only applies from version 7.
    let remainder = version << 12;
    for (let bit = 17; bit >= 12; bit -= 1) {
      if (remainder & (1 << bit)) remainder ^= 0b1111100100101 << (bit - 12);
    }
    return (version << 12) | remainder;
  }

  /**
   * Where the fifteen format bits live, most significant first.
   *
   * The two copies use different paths around the code so that damage to one
   * corner cannot take both. Getting either order wrong produces a code that
   * looks perfectly well formed and scans as nothing at all, so these lists
   * are checked against a reference encoder in the tests.
   */
  function formatCoordinates(size) {
    return [
      [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
       [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]],
      [
        ...Array.from({ length: 7 }, (unused, index) => [size - 1 - index, 8]),
        ...Array.from({ length: 8 }, (unused, index) => [8, size - 8 + index]),
      ],
    ];
  }

  function placeFormat(modules, size, mask) {
    const bits = formatBits(mask);

    formatCoordinates(size).forEach((coordinates) => {
      coordinates.forEach(([row, column], position) => {
        modules[row][column] = ((bits >> (14 - position)) & 1) === 1;
      });
    });

    // The one module that is dark in every code ever made.
    modules[size - 8][8] = true;
  }

  function placeVersion(modules, reserved, size, version) {
    if (version < 7) return;
    const bits = versionBits(version);

    for (let index = 0; index < 18; index += 1) {
      const bit = ((bits >> index) & 1) === 1;
      const row = Math.floor(index / 3);
      const column = index % 3;
      modules[size - 11 + column][row] = bit;
      modules[row][size - 11 + column] = bit;
      reserved[size - 11 + column][row] = true;
      reserved[row][size - 11 + column] = true;
    }
  }

  function placeData(modules, reserved, size, codewords) {
    let bitIndex = 0;
    let upward = true;

    for (let right = size - 1; right >= 1; right -= 2) {
      // Column 6 is the vertical timing pattern and is stepped over.
      const columnPair = right === 6 ? 5 : right;

      for (let step = 0; step < size; step += 1) {
        const row = upward ? size - 1 - step : step;
        for (let offset = 0; offset < 2; offset += 1) {
          const column = columnPair - offset;
          if (reserved[row][column]) continue;

          const byte = codewords[bitIndex >> 3];
          const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
          modules[row][column] = bit === 1;
          bitIndex += 1;
        }
      }
      upward = !upward;
      if (right === 8) right -= 1; // Skip the timing column cleanly.
    }
  }

  const MASKS = [
    (row, column) => (row + column) % 2 === 0,
    (row) => row % 2 === 0,
    (row, column) => column % 3 === 0,
    (row, column) => (row + column) % 3 === 0,
    (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
    (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
    (row, column) => ((((row * column) % 2) + ((row * column) % 3)) % 2) === 0,
    (row, column) => ((((row + column) % 2) + ((row * column) % 3)) % 2) === 0,
  ];

  /** The four penalty rules, which decide which mask reads most reliably. */
  function penalty(modules, size) {
    let score = 0;

    const runScore = (line) => {
      let total = 0;
      let run = 1;
      for (let index = 1; index < size; index += 1) {
        if (line[index] === line[index - 1]) {
          run += 1;
        } else {
          if (run >= 5) total += run - 2;
          run = 1;
        }
      }
      if (run >= 5) total += run - 2;
      return total;
    };

    for (let index = 0; index < size; index += 1) {
      score += runScore(modules[index]);
      score += runScore(modules.map((row) => row[index]));
    }

    for (let row = 0; row < size - 1; row += 1) {
      for (let column = 0; column < size - 1; column += 1) {
        const first = modules[row][column];
        if (
          first === modules[row][column + 1] &&
          first === modules[row + 1][column] &&
          first === modules[row + 1][column + 1]
        ) {
          score += 3;
        }
      }
    }

    const finderLike = [true, false, true, true, true, false, true, false, false, false, false];
    const reversed = [...finderLike].reverse();
    const matches = (line, at, pattern) => pattern.every((value, offset) => line[at + offset] === value);

    for (let index = 0; index < size; index += 1) {
      const row = modules[index];
      const column = modules.map((line) => line[index]);
      for (let at = 0; at + 11 <= size; at += 1) {
        if (matches(row, at, finderLike) || matches(row, at, reversed)) score += 40;
        if (matches(column, at, finderLike) || matches(column, at, reversed)) score += 40;
      }
    }

    const dark = modules.reduce((total, row) => total + row.filter(Boolean).length, 0);
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  /** The smallest version at level H that holds this payload. */
  function versionFor(bytes) {
    for (let version = 1; version <= BLOCKS_H.length; version += 1) {
      const headerBytes = version < 10 ? 2 : 3;
      if (bytes.length + headerBytes <= dataCapacity(version)) return version;
    }
    throw new Error('That link is too long for a QR code.');
  }

  /**
   * The finished modules for a payload: true is a dark square.
   *
   * `options.mask` forces one of the eight masks instead of scoring them,
   * which is only useful for checking this encoder against another.
   */
  function matrixFor(text, options = {}) {
    const bytes = toBytes(String(text));
    const version = versionFor(bytes);
    const size = version * 4 + 17;
    const codewords = buildCodewords(bytes, version);

    const base = createGrid(size, false);
    const reserved = createGrid(size, false);

    placeFinder(base, reserved, 0, 0);
    placeFinder(base, reserved, 0, size - 7);
    placeFinder(base, reserved, size - 7, 0);
    placeAlignment(base, reserved, version);
    placeTiming(base, reserved, size);
    placeVersion(base, reserved, size, version);
    reserveFormat(reserved, size);
    placeData(base, reserved, size, codewords);

    const candidates =
      typeof options.mask === 'number' ? [options.mask] : MASKS.map((unused, index) => index);

    let best = null;
    for (const mask of candidates) {
      const candidate = base.map((row) => [...row]);
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          if (!reserved[row][column] && MASKS[mask](row, column)) {
            candidate[row][column] = !candidate[row][column];
          }
        }
      }
      placeFormat(candidate, size, mask);

      const score = penalty(candidate, size);
      if (!best || score < best.score) best = { score, modules: candidate, mask };
    }

    return { size, version, mask: best.mask, modules: best.modules };
  }

  /* ----------------------------------------------------------------- svg */

  // Four modules of clear space, as the standard asks. A code printed tight to
  // its neighbours is the most common reason one will not scan.
  const QUIET = 4;

  function escapeAttribute(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  /**
   * Markup for a payload.
   *
   * `style` is one of standard, colored, rounded or logo. A logo is drawn over
   * the middle on its own plate rather than by removing modules: level H
   * tolerates roughly a third of the code being lost, and a plate this size is
   * well inside that, where cutting modules out would not be.
   */
  function toSvg(text, options = {}) {
    const { size, modules } = matrixFor(text);
    const total = size + QUIET * 2;
    const dark = options.color || '#000000';
    const light = options.background || '#ffffff';
    const style = options.style || 'standard';
    const rounded = style === 'rounded';

    const shapes = [];
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        if (!modules[row][column]) continue;
        const x = column + QUIET;
        const y = row + QUIET;
        shapes.push(
          rounded
            ? `<rect x="${x}" y="${y}" width="1" height="1" rx="0.5"/>`
            : `<rect x="${x}" y="${y}" width="1" height="1"/>`
        );
      }
    }

    const centre = total / 2;
    const plate = total * 0.22;
    const logo =
      style === 'logo' && options.logo
        ? `<rect x="${centre - plate / 2}" y="${centre - plate / 2}" width="${plate}" height="${plate}" rx="${plate * 0.22}" fill="${escapeAttribute(light)}"/>` +
          `<g transform="translate(${centre - plate * 0.34}, ${centre - plate * 0.34}) scale(${(plate * 0.68) / 24})" fill="${escapeAttribute(dark)}">${options.logo}</g>`
        : '';

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
      `shape-rendering="${rounded ? 'geometricPrecision' : 'crispEdges'}" ` +
      `role="img" aria-label="${escapeAttribute(options.label || 'QR code')}">` +
      `<rect width="${total}" height="${total}" fill="${escapeAttribute(light)}"${rounded ? ` rx="${total * 0.06}"` : ''}/>` +
      `<g fill="${escapeAttribute(dark)}">${shapes.join('')}</g>` +
      logo +
      '</svg>'
    );
  }

  global.pickoraQr = { matrixFor, toSvg };
})(window);
