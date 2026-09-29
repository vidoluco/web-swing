// Rasterises the city's land use, water and streets into one PNG that textures the ground
// beyond the streamed chunks, so the far view shows parks, lakes and boulevards.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

export function groundMap(path, box, layers, px = 5.6) {
  const W = Math.ceil((box.x1 - box.x0) / px), H = Math.ceil((box.z1 - box.z0) / px);
  const img = new Uint8Array(W * H * 3);
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const fillBg = hex(layers.background);
  for (let i = 0; i < W * H; i++) img.set(fillBg, i * 3);
  // Even-odd scanline fill of a set of rings (outer plus holes) in world metres.
  function fill(rings, colour) {
    const rgb = hex(colour);
    let z0 = Infinity, z1 = -Infinity;
    for (const r of rings) for (const p of r) (z0 = Math.min(z0, p[1])), (z1 = Math.max(z1, p[1]));
    const r0 = Math.max(0, Math.floor((z0 - box.z0) / px)), r1 = Math.min(H - 1, Math.ceil((z1 - box.z0) / px));
    const xs = [];
    for (let row = r0; row <= r1; row++) {
      const z = box.z0 + (row + 0.5) * px;
      xs.length = 0;
      for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const a = r[j], b = r[i];
          if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - box.x0) / px - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - box.x0) / px - 0.5));
        for (let c = c0; c <= c1; c++) img.set(rgb, (row * W + c) * 3);
      }
    }
  }
  function line(pts, width, colour) {
    const h = Math.max(width, px * 1.2) / 2;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (-(bz - az) / L) * h, nz = ((bx - ax) / L) * h, ex = ((bx - ax) / L) * h * 0.5, ez = ((bz - az) / L) * h * 0.5;
      fill([[[ax + nx - ex, az + nz - ez], [bx + nx + ex, bz + nz + ez], [bx - nx + ex, bz - nz + ez], [ax - nx - ex, az - nz - ez]]], colour);
    }
  }
  for (const [colour, polys] of layers.areas) for (const p of polys) fill([p.outer, ...(p.holes || [])], colour);
  for (const [colour, width, lines] of layers.lines) for (const pts of lines) line(pts, width(pts), colour);

  // PNG, 8-bit RGB, no filtering.
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let r = 0; r < H; r++) raw.set(img.subarray(r * W * 3, (r + 1) * W * 3), r * (W * 3 + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(path, png);
  return { w: W, h: H, bytes: png.length };
}
