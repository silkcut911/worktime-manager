// 앱 아이콘(시계) PNG 만들기: node tools/make-icons.js → web/icon-192.png, web/icon-512.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1)), r0 = size / 2, R = size * 0.33, W = size * 0.035;
  // 바늘: 12시(분침), 4시 방향(시침) — 선분까지 거리로 그림
  const seg = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - ax - t * dx, y - ay - t * dy); };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - r0, y - r0);
      let c = [0x1f, 0x3a, 0x5f];
      if (dist < R) c = [255, 255, 255];
      if (Math.abs(dist - R) < W) c = [0xff, 0xd1, 0x66];
      if (seg(x, y, r0, r0, r0, r0 - R * 0.75) < W * 0.9 || seg(x, y, r0, r0, r0 + R * 0.45, r0 + R * 0.28) < W * 1.1) c = [0x1f, 0x3a, 0x5f];
      raw.set([...c, 255], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) fs.writeFileSync(path.join(__dirname, `../web/icon-${s}.png`), png(s));
console.log('web/icon-192.png, web/icon-512.png');
