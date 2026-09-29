// Reads the terrain grid of a city (dem.bin plus its index.json "dem" entry) and samples it.
// The runtime groundAt(x, z) must use this exact interpolation: bilinear between the four grid
// nodes around the point, clamped at the edges. See docs/city-data-format.md.
import { readFileSync } from 'node:fs';

export function demFromBuffer(meta, buf) {
  const data = new Float32Array(meta.w * meta.h);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength !== data.length * 4) throw new Error(`dem.bin is ${buf.byteLength} bytes, ${meta.w}x${meta.h} floats need ${data.length * 4}`);
  for (let i = 0; i < data.length; i++) data[i] = dv.getFloat32(i * 4, true);
  return { meta, data, groundAt: (x, z) => bilinear(meta, data, x, z) };
}

export function loadDem(dir, meta) {
  return demFromBuffer(meta, readFileSync(`${dir}/${meta.file || 'dem.bin'}`));
}

export function bilinear({ w, h, x0, z0, step }, data, x, z) {
  const u = Math.min(Math.max((x - x0) / step, 0), w - 1), v = Math.min(Math.max((z - z0) / step, 0), h - 1);
  const i = Math.min(Math.floor(u), w - 2), j = Math.min(Math.floor(v), h - 2);
  const fu = u - i, fv = v - j, k = j * w + i;
  return data[k] * (1 - fu) * (1 - fv) + data[k + 1] * fu * (1 - fv) + data[k + w] * (1 - fu) * fv + data[k + w + 1] * fu * fv;
}
