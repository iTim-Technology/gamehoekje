// Bouwt het icoon van de Spellenhoek in de root van de repo:
//   favicon.svg           – voor browsers die SVG-icoontjes kennen
//   favicon.ico           – 16/32/48 px, voor de rest (en wie /favicon.ico vraagt)
//   apple-touch-icon.png  – 180 px, het icoon van een app op het beginscherm (iOS)
// Run: node tools/favicon.js
//
// Eén definitie: vier tegels op een donker vlak, in een raster van 64×64. De
// PNG's tekent dit script zelf (met supersampling), zonder dependencies, dus
// dezelfde invoer geeft byte voor byte dezelfde bestanden.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const BG = '#1b1b20';                     // kaartkleur van de homepage
const TILES = [
  { x: 8,  y: 8,  fill: '#5b8cff' },      // accent van de homepage
  { x: 34, y: 8,  fill: '#ffd500' },
  { x: 8,  y: 34, fill: '#1faa47' },      // spel-accent
  { x: 34, y: 34, fill: '#ff5d73' },
];
const TILE = 22, TILE_R = 6, BG_R = 14;

// iOS rondt de hoeken van een beginschermicoon zelf af en vult wat doorzichtig
// is met zwart; dat icoon krijgt daarom een vlak zonder ronde hoeken.
function shapes(bgRadius) {
  return [{ x: 0, y: 0, w: 64, h: 64, r: bgRadius, fill: BG },
    ...TILES.map(t => ({ x: t.x, y: t.y, w: TILE, h: TILE, r: TILE_R, fill: t.fill }))];
}

function svg() {
  const rect = s => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${s.fill}"/>`;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  ' +
    shapes(BG_R).map(rect).join('\n  ') + '\n</svg>\n';
}

// ---- tekenen ----------------------------------------------------------------
function inside(s, u, v) {
  if (u < s.x || u > s.x + s.w || v < s.y || v > s.y + s.h) return false;
  const dx = Math.max(s.x + s.r - u, 0, u - (s.x + s.w - s.r));
  const dy = Math.max(s.y + s.r - v, 0, v - (s.y + s.h - s.r));
  return dx * dx + dy * dy <= s.r * s.r;
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// RGBA-pixels van size×size; per pixel 8×8 monsters, de bovenste vorm telt
function raster(size, list) {
  const SS = 8, scale = 64 / size, out = Buffer.alloc(size * size * 4);
  const cols = list.map(s => rgb(s.fill));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, hits = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) * scale, v = (y + (sy + 0.5) / SS) * scale;
      let top = -1;
      list.forEach((s, i) => { if (inside(s, u, v)) top = i; });
      if (top < 0) continue;
      r += cols[top][0]; g += cols[top][1]; b += cols[top][2]; hits++;
    }
    const o = (y * size + x) * 4;
    if (hits) {
      out[o] = Math.round(r / hits); out[o + 1] = Math.round(g / hits); out[o + 2] = Math.round(b / hits);
      out[o + 3] = Math.round(255 * hits / (SS * SS));
    }
  }
  return out;
}

// ---- PNG en ICO -----------------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                // 8 bits per kanaal, RGBA
  const row = size * 4 + 1, raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) pixels.copy(raw, y * row + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// ICO met PNG's erin (kent elke browser)
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images.map(i => i.data)]);
}

const write = (name, data) => {
  fs.writeFileSync(path.join(ROOT, name), data);
  console.log('built ' + name + ' (' + data.length + ' bytes)');
};
write('favicon.svg', svg());
write('favicon.ico', ico([16, 32, 48].map(size => ({ size, data: png(size, raster(size, shapes(BG_R))) }))));
write('apple-touch-icon.png', png(180, raster(180, shapes(0))));
