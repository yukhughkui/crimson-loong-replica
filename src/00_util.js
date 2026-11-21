'use strict';
// 数学基底：影片里每个像素都从这里的一族函数出发。
const U = (() => {
  const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, x) => a + (b - a) * x;
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const pulse = (t, at, rise, fall) => t <= at ? 0 : t < at + rise ? sm(at, at + rise, t) : t < at + rise + fall ? 1 - sm(at + rise, at + rise + fall, t) : 0;
  const h1 = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); };
  const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return s - Math.floor(s); };
  const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123; return s - Math.floor(s); };
  const noise2 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), ux), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), ux), uy);
  };
  const noise3 = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const c = (a, b, d) => h3(ix + a, iy + b, iz + d);
    return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
  };
  const fbm2 = (x, y, oct = 5) => { let v = 0, a = .5, f = 1; for (let i = 0; i < oct; i++) { v += a * noise2(x * f, y * f); f *= 2.03; a *= .5; } return v; };
  const fbm3 = (x, y, z, oct = 4) => { let v = 0, a = .5, f = 1; for (let i = 0; i < oct; i++) { v += a * noise3(x * f, y * f, z * f); f *= 2.07; a *= .5; } return v; };
  const ridged = (x, y, z, oct = 5) => { let v = 0, a = .5, f = 1; for (let i = 0; i < oct; i++) { v += a * (1 - Math.abs(noise3(x * f, y * f, z * f) * 2 - 1)); f *= 2.11; a *= .52; } return v; };
  const keyed = rows => x => {
    if (x <= rows[0][0]) return rows[0][1];
    const n = rows.length; if (x >= rows[n - 1][0]) return rows[n - 1][1];
    let i = 0; while (i < n - 2 && x > rows[i + 1][0]) i++;
    return lerp(rows[i][1], rows[i + 1][1], sm(rows[i][0], rows[i + 1][0], x));
  };
  const track = rows => (t, out) => {
    const n = rows.length, nc = out.isVector3 ? 3 : out.length;
    if (t <= rows[0][0]) { for (let c = 1; c <= nc; c++) out.setComponent(c - 1, rows[0][c]); return out; }
    if (t >= rows[n - 1][0]) { for (let c = 1; c <= nc; c++) out.setComponent(c - 1, rows[n - 1][c]); return out; }
    let i = 0; while (i < n - 2 && t > rows[i + 1][0]) i++;
    const a = rows[i], b = rows[i + 1], x = sm(a[0], b[0], t);
    for (let c = 1; c <= nc; c++) out.setComponent(c - 1, lerp(a[c], b[c], x));
    return out;
  };
  const spline = (pts, t, out) => {
    const n = pts.length, f = ((t % 1) + 1) % 1 * n, i = Math.floor(f), u = f - i, u2 = u * u, u3 = u2 * u;
    const a = pts[(i - 1 + n) % n], b = pts[i % n], c = pts[(i + 1) % n], d = pts[(i + 2) % n];
    for (let k = 0; k < 3; k++) out.setComponent(k, .5 * (2 * b[k] + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u3));
    return out;
  };
  const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return { clamp, lerp, sm, pulse, h1, h2, h3, noise2, noise3, fbm2, fbm3, ridged, keyed, track, spline, rng, TAU: Math.PI * 2 };
})();
