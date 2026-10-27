// Genera build/icon.ico (PNG embebidos 16-256 px) sin dependencias externas.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Dibujo en coordenadas 0..1, con supermuestreo para suavizar bordes.
function inRoundRect(x, y, r) {
  const m = 0.04, lo = m, hi = 1 - m;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + r), hi - r), cy = Math.min(Math.max(y, lo + r), hi - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inArrow(x, y) {
  if (x >= 0.44 && x <= 0.56 && y >= 0.2 && y <= 0.52) return true;            // tallo
  if (y >= 0.5 && y <= 0.72 && Math.abs(x - 0.5) <= (0.72 - y) * 1.15) return true; // punta
  if (x >= 0.25 && x <= 0.75 && y >= 0.76 && y <= 0.82) return true;           // bandeja
  return false;
}
function render(size) {
  const ss = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size, y = (py + (sy + 0.5) / ss) / size;
          if (!inRoundRect(x, y, 0.22)) continue;
          a++;
          if (inArrow(x, y)) { r += 255; g += 255; b += 255; }
          else {
            const t = (x + y) / 2; // degradado diagonal
            r += 79 + (124 - 79) * t; g += 140 + (92 - 140) * t; b += 255 + (240 - 255) * t;
          }
        }
      }
      const n = ss * ss, i = (py * size + px) * 4;
      if (a) { buf[i] = r / a; buf[i + 1] = g / a; buf[i + 2] = b / a; buf[i + 3] = Math.round((a / n) * 255); }
    }
  }
  return buf;
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => png(s, render(s)));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([head, ...dir, ...images]));
fs.writeFileSync(path.join(__dirname, 'icon.png'), images[images.length - 1]);
console.log('icono generado:', out);

// ---- macOS: icon.icns (entradas PNG). Los iconos de macOS dejan ~10% de margen alrededor del dibujo. ----
function renderPadded(size) {
  const inner = Math.round(size * 0.8);
  const small = render(inner);
  const buf = Buffer.alloc(size * size * 4);
  const off = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y++) small.copy(buf, ((y + off) * size + off) * 4, y * inner * 4, (y + 1) * inner * 4);
  return buf;
}
const icnsTypes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
const icnsParts = icnsTypes.map(([type, s]) => {
  const data = png(s, renderPadded(s));
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const icnsBody = Buffer.concat(icnsParts);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(icnsBody.length + 8, 4);
fs.writeFileSync(path.join(__dirname, 'icon.icns'), Buffer.concat([icnsHead, icnsBody]));
console.log('icono macOS generado:', path.join(__dirname, 'icon.icns'));
