// 生成 Skill Helm 应用图标（舵轮）：node tools/make-icon.js <out.png>
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const S = 512;
const out = process.argv[2] ?? path.join(__dirname, "icon.png");

const BG = [20, 23, 28, 255];
const ACCENT = [79, 156, 249, 255];
const cx = S / 2;
const cy = S / 2;
const R = 185;
const RING_W = 24;
const HUB_R = 44;
const SPOKE_HALF_W = 9;

const buf = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    let c = BG;
    if (Math.abs(d - R) <= RING_W) c = ACCENT;
    else if (d <= HUB_R) c = ACCENT;
    else if (d < R - RING_W && d > HUB_R) {
      const sector = Math.PI / 4;
      const rel = ((Math.atan2(dy, dx) % sector) + sector) % sector;
      if (Math.min(rel, sector - rel) * d <= SPOKE_HALF_W) c = ACCENT;
    }
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const hd = Math.hypot(x - (cx + Math.cos(a) * (R + RING_W + 16)), y - (cy + Math.sin(a) * (R + RING_W + 16)));
      if (hd <= 17) c = ACCENT;
    }
    const i = (y * S + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = c[3];
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log("icon written:", out);
