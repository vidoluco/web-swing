import * as THREE from 'three';
import { uniforms } from './uniforms.js';
import { PARAMS } from './buildings.js';

// The building material. Every wall pixel is worked out from per-vertex data (see buildings.js): distance along
// the wall, building kind, seed, floor range, edge length and variant bits. Floors and window bays are laid out
// per wall edge so a facade always starts and ends on a whole bay. Windows are recessed: the view ray is walked
// into the wall, so reveals, frames and the room behind move with the viewpoint.

export const GLSL_COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash11(float p) { return hash12(vec2(p, p * 1.37 + 4.1)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.7) * 0.3 + vnoise(p * 4.7 + 3.1) * 0.15; }
// 1 between a and b, antialiased over aa
float bandAA(float f, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, f) * (1.0 - smoothstep(b - aa, b + aa, f));
}
`;

const FRAGMENT_DECL = /* glsl */ `
uniform highp sampler2DArray tWallA;
uniform highp sampler2DArray tWallN;
uniform float uNight;
varying vec3 vWPos; varying vec3 vWNormal; varying vec3 vTan3; varying float vU; varying float vV;
flat varying vec4 vInfo; flat varying vec4 vGeoF;
float gRough = 0.85; float gMetal = 0.0; float gAO = 1.0; vec3 gEmit = vec3(0.0); vec2 gNrm = vec2(0.0); float gNrmK = 0.0; float gSpec = 1.0;
vec3 gWinN = vec3(0.0);
${GLSL_COMMON}

vec4 wallTex(float layer, vec2 uv) { return texture(tWallA, vec3(uv, layer)); }
vec2 wallNrm(float layer, vec2 uv) { return texture(tWallN, vec3(uv, layer)).xy * 2.0 - 1.0; }

vec3 accent(int i) {
  vec3 c = vec3(0.5);
  if (i == 0) c = vec3(0.78, 0.25, 0.20); else if (i == 1) c = vec3(0.90, 0.65, 0.15); else if (i == 2) c = vec3(0.20, 0.45, 0.60);
  else if (i == 3) c = vec3(0.25, 0.55, 0.35); else if (i == 4) c = vec3(0.85, 0.45, 0.20); else if (i == 5) c = vec3(0.55, 0.30, 0.55);
  else if (i == 6) c = vec3(0.30, 0.35, 0.55); else if (i == 7) c = vec3(0.70, 0.55, 0.40); else if (i == 8) c = vec3(0.90, 0.85, 0.70);
  else if (i == 9) c = vec3(0.35, 0.25, 0.20); else if (i == 10) c = vec3(0.55, 0.60, 0.62); else if (i == 11) c = vec3(0.80, 0.30, 0.40);
  else if (i == 12) c = vec3(0.35, 0.60, 0.55); else if (i == 13) c = vec3(0.75, 0.72, 0.20); else if (i == 14) c = vec3(0.20, 0.20, 0.22);
  else c = vec3(0.95, 0.95, 0.92);
  return pow(c, vec3(2.2));
}
// Window frame colours: white PVC, old brown wood, anthracite, silver aluminium.
vec3 frameColour(float r) {
  if (r < 0.52) return vec3(0.82, 0.82, 0.80);
  if (r < 0.74) return pow(vec3(0.36, 0.22, 0.13), vec3(2.2));
  if (r < 0.88) return pow(vec3(0.16, 0.17, 0.18), vec3(2.2));
  return vec3(0.55, 0.56, 0.58);
}

// Interior mapping: a box room behind the glass. p = position on the glass in metres, r = view ray in room space.
vec3 room(vec2 p, vec3 r, vec2 size, float depth, float seed, float lit, float shop, out float shade) {
  vec3 o = vec3(p, 0.0);
  float tx = r.x > 0.0 ? (size.x - o.x) / r.x : -o.x / min(r.x, -1e-4);
  float ty = r.y > 0.0 ? (size.y - o.y) / r.y : -o.y / min(r.y, -1e-4);
  float tz = depth / max(r.z, 1e-4);
  float t = min(min(tx, ty), tz);
  vec3 h = o + r * t;
  vec3 wallC = mix(vec3(0.78, 0.74, 0.66), vec3(0.62, 0.7, 0.74), hash12(vec2(seed, 3.1)));
  wallC = mix(wallC, vec3(0.85, 0.66, 0.5), step(0.75, hash12(vec2(seed, 9.2))));
  vec3 c;
  if (t == tz && shop > 0.5) {
    // shelving: rows of coloured goods on a pale wall, a counter on one side
    c = vec3(0.72, 0.7, 0.66);
    float row = floor(h.y / 0.42);
    float col = floor(h.x / 0.32);
    float g = hash12(vec2(col, row) + seed);
    float shelf = step(0.86, fract(h.y / 0.42));
    vec3 goods = mix(vec3(0.75, 0.2, 0.15), vec3(0.15, 0.4, 0.7), hash12(vec2(col, row) + 7.0));
    goods = mix(goods, vec3(0.9, 0.75, 0.2), step(0.66, g));
    c = mix(c, goods, step(0.3, g) * (1.0 - shelf) * step(row, 4.0) * 0.85);
    c = mix(c, vec3(0.32, 0.22, 0.14), shelf);
    if (h.y < 1.0 && abs(h.x / size.x - 0.35) < 0.3) c = vec3(0.3, 0.2, 0.13);
  } else if (t == tz) {
    c = wallC;
    float fx = h.x / size.x;
    if (hash12(vec2(seed, 5.0)) > 0.5 && abs(fx - 0.3) < 0.1 && h.y < size.y * 0.75) c *= 0.55;
    if (abs(fx - 0.65) < 0.12 && abs(h.y / size.y - 0.55) < 0.12) c = mix(c, vec3(0.2, 0.3, 0.5) * hash12(vec2(seed, 7.0)) + 0.1, 0.8);
  } else if (t == ty) {
    c = r.y < 0.0 ? mix(vec3(0.35, 0.25, 0.17), vec3(0.4, 0.4, 0.42), hash12(vec2(seed, 1.7))) : vec3(0.9);
    if (shop > 0.5 && r.y < 0.0) c = mix(vec3(0.55, 0.5, 0.44), vec3(0.3, 0.3, 0.32), step(0.5, fract(h.x / 0.6) + fract(h.z / 0.6)) * 0.5);
    if (r.y > 0.0) {
      c += lit * 1.5 * exp(-8.0 * length((h.xz - vec2(size.x * 0.5, depth * 0.5)) / vec2(size.x, depth)));
      if (shop > 0.5) c += vec3(1.3, 1.25, 1.1) * step(0.5, fract(h.z / 2.2 + 0.25)) * step(0.5, fract(h.x / 1.6)) * 0.6 * (0.4 + 0.6 * uNight);
    }
  } else {
    c = wallC * 0.82;
  }
  if (t == tz && h.y < size.y * 0.3 && abs(h.x / size.x - 0.5) < 0.3 && hash12(vec2(seed, 4.4)) > 0.4) c *= 0.45;
  shade = 1.0 - 0.55 * clamp(h.z / depth, 0.0, 1.0);
  return c * shade;
}

// A recessed window. p = cell position (m), b = opening x0 x1 y0 y1 (m), rr = view ray in wall space
// (x right, y up, z into the wall). Returns colour; em = emitted light; wr, wm = roughness, metalness.
// mode: 0 plain casement, 1 shop window (no frame bars, deep room), 2 glass curtain
vec3 windowView(vec2 p, vec4 b, vec3 rr, float depth, float frameW, vec3 frameCol, vec3 revCol, float seed, float lit, int mode, float fade, out vec3 em, out float wr, out float wm, out float glassAmt) {
  float rz = max(rr.z, 0.08);
  vec2 q = p + rr.xy * (depth / rz);
  em = vec3(0.0); wr = 0.6; wm = 0.0; glassAmt = 0.0;
  bool inGlass = q.x > b.x && q.x < b.y && q.y > b.z && q.y < b.w;
  if (!inGlass) {
    // side walls of the recess
    float sh = 0.55;
    if (q.y > b.w) sh = 0.32; else if (q.y < b.z) sh = 0.85; else sh = 0.55 + 0.15 * step(0.0, rr.x) * (q.x < b.x ? 1.0 : 0.0);
    wr = 0.9;
    return revCol * sh;
  }
  vec2 e = vec2(min(q.x - b.x, b.y - q.x), min(q.y - b.z, b.w - q.y));
  float w = b.y - b.x, h = b.w - b.z;
  bool frame = min(e.x, e.y) < frameW;
  if (mode == 0) {
    // mullion and transom
    if (w > 1.05 && abs(q.x - 0.5 * (b.x + b.y)) < 0.028) frame = true;
    if (h > 1.5 && abs(q.y - (b.z + h * 0.72)) < 0.025) frame = true;
  } else if (mode == 2) {
    frame = min(e.x, e.y) < 0.045;
  }
  if (frame) {
    wr = 0.5;
    return frameCol;
  }
  // glass: room behind, sky reflected on top
  float shade;
  vec2 size = vec2(w, h) * 1.9;
  vec3 inside = room(q - b.xz + vec2(0.3, 0.2), rr, size, mode == 1 ? 8.0 : mode == 2 ? 7.0 : 4.5, seed, lit, mode == 1 ? 1.0 : 0.0, shade);
  if (mode == 2) inside *= vec3(0.32, 0.42, 0.48);
  if (mode == 1) inside *= 0.7;
  float blinds = mode == 0 ? step(0.55, hash12(vec2(seed, 11.3))) * hash12(vec2(seed, 2.9)) * 0.85 : 0.0;
  float pf = (q.y - b.z) / h;
  vec3 blindC = mix(vec3(0.85, 0.82, 0.74), vec3(0.55, 0.6, 0.62), hash12(vec2(seed, 5.5)));
  if (pf > 1.0 - blinds) inside = blindC * (0.55 + 0.1 * step(0.5, fract(pf * 30.0)));
  float dayK = mix(0.16, 0.012, uNight);
  vec3 warm = mix(vec3(1.0, 0.86, 0.66), vec3(1.0, 0.72, 0.42), uNight);
  vec3 roomLight = inside * (dayK + lit * warm * mix(0.5, 2.6, uNight));
  vec3 N = normalize(vWNormal);
  vec3 Vw = normalize(vWPos - cameraPosition);
  vec3 R = reflect(Vw, N);
  float cosv = clamp(dot(-Vw, N), 0.0, 1.0);
  float fres = (mode == 2 ? 0.5 : mode == 1 ? 0.22 : 0.1) + (mode == 2 ? 0.5 : 0.9) * pow(1.0 - cosv, 4.0);
  vec3 skyR = mix(vec3(0.62, 0.66, 0.7), vec3(0.3, 0.46, 0.72), clamp(R.y * 1.6, 0.0, 1.0));
  skyR = mix(vec3(0.1, 0.1, 0.11) + 0.05 * hash12(vec2(seed, 3.3)), skyR, smoothstep(-0.04, 0.14, R.y));
  if (mode == 2) skyR = mix(skyR, vec3(0.18, 0.3, 0.42), 0.35) * (0.7 + 0.5 * fbm(vec2(vWPos.x + vWPos.z, vWPos.y * 0.4) * 0.15));
  skyR *= mix(1.0, 0.07, uNight);
  em = roomLight * (1.0 - fres) + skyR * fres * 1.1;
  wr = 0.05; wm = mode == 2 ? 0.55 : 0.1; glassAmt = 1.0;
  return vec3(0.015);
}
`;

// Wall shading. Writes diffuseColor, roughness, metalness, emissive, AO and the normal perturbation.
const KIND_PARAMS = /* glsl */ `
void kindParams(int k, out float cwT, out float fhT, out float gf) {
  cwT = 3.2; fhT = 3.2; gf = 3.4;
${PARAMS.map((p, i) => `  ${i ? 'else ' : ''}if (k == ${i}) { cwT = ${p[0].toFixed(2)}; fhT = ${p[1].toFixed(2)}; gf = ${p[2].toFixed(2)}; }`).join('\n')}
}
`;

const WALL_FN = /* glsl */ `
${KIND_PARAMS}
void wallShade(inout vec4 diffuseColor, vec3 N) {
  vec3 base = diffuseColor.rgb;
  float kind = vInfo.x, seed = vInfo.y, baseY = vInfo.z, topY = vInfo.w;
  float L = vGeoF.x, edge = vGeoF.y;
  int variant = int(vGeoF.z + 0.5);
  int ki = int(kind + 0.5);
  float u = vU, y = vWPos.y;
  float H = topY - baseY;
  float ly = y - baseY;
  vec3 Vw = normalize(vWPos - cameraPosition);
  float dist = length(vWPos - cameraPosition);
  float px = max(fwidth(u), fwidth(y)) + 1e-4;
  bool renov = (variant & 1) == 1;
  int accI = (variant >> 4) & 15;
  int balcStyle = (variant >> 8) & 3;
  float eh = hash11(edge * 0.371 + seed);

  // ---- layout per kind ----
  float cwT, fhT, gf;
  kindParams(ki, cwT, fhT, gf);
  float wallLayer = 0.0, wallScale = 3.0;
  if (ki == 0) wallLayer = 6.0;
  else if (ki == 1) { wallLayer = 3.0 + floor(hash11(seed) * 2.0); wallScale = 1.8; }
  else if (ki == 2) wallLayer = floor(hash11(seed + 1.0) * 2.0);
  else if (ki == 3) wallLayer = 5.0;
  else if (ki == 4) wallLayer = renov ? 0.0 : 5.0 + floor(hash11(seed) * 2.0);
  else wallLayer = floor(hash11(seed + float(ki)) * 3.0);
  // shops on the ground floor of the older centre and of some blocks
  bool shops = (ki == 5 || ki == 8 || ki == 6) || (ki == 4 && hash11(seed + 9.0) < 0.3);

  float gfH = min(gf, H);
  float upH = H - gfH;
  float nUp = upH < fhT * 0.55 ? 0.0 : max(1.0, floor(upH / fhT + 0.5));
  if (nUp < 0.5) gfH = H;
  float fh = nUp > 0.5 ? upH / nUp : H;
  float fi, fy, fhh;
  if (ly < gfH) { fi = 0.0; fhh = gfH; fy = ly / gfH; }
  else { float t = (ly - gfH) / fh; fi = 1.0 + floor(t); fy = fract(t); fhh = fh; }
  bool topFloor = fi > nUp - 0.5;
  bool groundF = fi < 0.5;
  float nc = max(1.0, floor(L / cwT + 0.5));
  float cw = L / nc;
  float ucol = clamp(u / cw, 0.0, nc - 0.001);
  float col = floor(ucol);
  float fx = fract(ucol);
  vec2 cp = vec2(fx * cw, fy * fhh);
  vec2 cell = vec2(col, fi);
  float rs = hash12(cell * 1.7 + seed * 0.713 + 3.0);
  float rs2 = hash12(cell + seed * 1.13 + 41.0);
  float aaX = px, aaY = px;
  float fade = smoothstep(0.07, 0.3, px / cw);

  // ---- wall surface ----
  vec2 wuv = vec2(u, y) / wallScale + vec2(hash11(edge), hash11(edge + 3.0)) * 5.0;
  vec4 wt = wallTex(wallLayer, wuv);
  vec2 tn = wallNrm(wallLayer, wuv);
  vec3 wall;
  if (ki == 1) wall = wt.rgb * mix(vec3(1.0), base / 0.5, 0.2);
  else if (ki == 0) wall = wt.rgb * base * 0.6;
  else wall = wt.rgb * base * 1.55;
  float rough = wt.a;
  float metal = 0.0;
  vec3 emit = vec3(0.0);
  float ao = 1.0;
  gNrm = tn; gNrmK = 0.85;
  // dirt: darker near the ground, streaks, stains
  float gy = smoothstep(0.0, 9.0, ly);
  float streak = vnoise(vec2(u * 1.7, y * 0.06) + seed);
  wall *= mix(0.72, 1.0, gy) * (0.86 + 0.14 * streak) * (0.92 + 0.08 * vnoise(wuv * 3.0));
  bool plinth = ly < 0.9;
  if (plinth) {
    vec3 pl = wallTex(6.0, vec2(u, y) / 2.0).rgb * 0.75;
    wall = mix(wall, pl, smoothstep(1.1, 0.7, ly));
  }
  vec3 col3 = wall;

  // ---- decorative structure (floor bands, cornices, pilasters) ----
  float ledge = 0.0; // > 0: this pixel is the top face of a ledge, < 0: underside
  float shadeDown = 1.0;
  bool old = (ki == 5 || ki == 8 || ki == 2);
  if (old) {
    float cH = min(1.3, H * 0.15);
    float cornice = bandAA(ly, H - cH, H - 0.05, px);
    float cs = bandAA(ly, H - cH - 0.02, H - cH + 0.35, px);
    col3 = mix(col3, base * 1.35, cornice * 0.75);
    // dentils
    float dent = step(0.5, fract(u / 0.45)) * bandAA(ly, H - cH * 0.55, H - cH * 0.25, px);
    col3 *= 1.0 - 0.3 * dent;
    // shadow under the cornice
    shadeDown *= 1.0 - 0.45 * bandAA(ly, H - cH - 0.6, H - cH, px * 2.0);
    float sc = 0.0;
    // string course at every floor line above the ground floor
    if (nUp > 0.5 && !groundF) {
      float sb = bandAA(fy, 0.0, 0.055, px / fhh);
      col3 = mix(col3, base * 1.25, sb * 0.7);
      shadeDown *= 1.0 - 0.3 * bandAA(fy, -0.04, 0.0, px / fhh);
    }
    // rusticated ground floor
    if (groundF) {
      vec2 rk = vec2(u / 1.2, ly / 0.55);
      float row = floor(rk.y);
      float joint = 1.0 - bandAA(fract(rk.y), 0.05, 1.0, px / 0.55) * bandAA(fract(rk.x + 0.5 * mod(row, 2.0)), 0.02, 1.0, px / 1.2);
      col3 *= 1.0 - 0.28 * joint;
    }
  }
  // corner piers: the outer bays of a wall are solid on decorated kinds
  int ei = int(edge + 0.5);
  bool pier = (ki == 5 || ki == 8 || ki == 6 || ki == 7 || ki == 2 || ki == 1) && nc > 2.5 && (col < 0.5 || col > nc - 1.5);
  if (ki == 4 && L < 15.0) pier = true; // blank gable ends of the prefab blocks
  if (ki == 4 && nc > 4.5 && (col < 0.5 || col > nc - 1.5) && ((ei >> 3) & 1) == 0) pier = true;

  // ---- window bays ----
  vec4 win = vec4(0.0);
  float frameW = 0.06;
  bool hasWin = !pier;
  bool balcony = false;
  bool door = false;
  float depth = 0.28;
  int mode = 0;
  vec3 frameCol = frameColour(hash12(cell + seed));
  vec3 revCol = col3;
  float wcx = cw * 0.5;
  bool shopF = shops && groundF;
  if (ki == 4) {
    // prefab block: balcony columns in strips, plain windows elsewhere
    float pat = float(ei % 3);
    float cidx = col;
    float stair = abs(col - floor(nc * 0.5)) < 0.5 ? 1.0 : 0.0;
    if (pat < 0.5) balcony = mod(cidx, 2.0) < 0.5;
    else if (pat < 1.5) balcony = mod(floor(cidx * 0.5), 2.0) < 0.5;
    else balcony = stair < 0.5;
    if (nc < 5.5 || pier) balcony = false;
    if (groundF) balcony = false;
    if (balcony) {
      win = vec4(cw * 0.1, cw * 0.9, fhh * 0.06, fhh * 0.9);
      frameW = 0.05;
    } else if (stair > 0.5 && pat > 1.5) {
      win = vec4(cw * 0.32, cw * 0.68, fhh * 0.2, fhh * 0.85);
    } else {
      win = vec4(cw * 0.5 - 0.72, cw * 0.5 + 0.72, fhh * 0.3, fhh * 0.3 + 1.32);
    }
    frameCol = renov ? vec3(0.82) : frameColour(hash12(cell + seed));
    depth = renov ? 0.34 : 0.2;
  } else if (ki == 5 || ki == 8) {
    win = vec4(cw * 0.5 - 0.62, cw * 0.5 + 0.62, fhh * 0.18, fhh * 0.82);
    if (ki == 8) win = vec4(cw * 0.5 - 0.58, cw * 0.5 + 0.58, fhh * 0.2, fhh * 0.8);
    depth = 0.3;
    frameW = 0.07;
    frameCol = vec3(0.86, 0.85, 0.8);
  } else if (ki == 6) {
    // wide ribbon windows between solid piers
    win = vec4(cw * 0.06, cw * 0.94, fhh * 0.24, fhh * 0.78);
    balcony = !groundF && !pier && ((int(col) + ei) % 4) < 2 && ((ei >> 4) & 7) < 5;
    depth = 0.22;
    frameCol = frameColour(hash12(cell + seed));
  } else if (ki == 7) {
    win = vec4(cw * 0.5 - 0.5, cw * 0.5 + 0.5, fhh * 0.28, fhh * 0.82);
    depth = 0.24;
    frameW = 0.06;
    // door at the ground floor of one bay
    if (groundF && abs(col - floor(nc * (0.3 + 0.4 * hash11(edge)))) < 0.5) { door = true; win = vec4(cw * 0.5 - 0.5, cw * 0.5 + 0.5, 0.0, fhh * 0.78); }
  } else if (ki == 1) {
    win = vec4(cw * 0.5 - 0.95, cw * 0.5 + 0.95, fhh * 0.22, fhh * 0.86);
    depth = 0.3;
    frameCol = pow(vec3(0.15, 0.16, 0.17), vec3(2.2));
    frameW = 0.09;
  } else if (ki == 2) {
    win = vec4(cw * 0.5 - 0.8, cw * 0.5 + 0.8, fhh * 0.12, fhh * 0.88);
    depth = 0.4;
    frameW = 0.1;
    frameCol = vec3(0.6, 0.58, 0.52);
  } else if (ki == 3) {
    win = vec4(0.0, cw, fhh * 0.28, fhh * 0.82);
    hasWin = true;
    depth = 0.2;
  } else {
    // curtain wall: nearly the whole cell is glass
    win = vec4(0.045, cw - 0.045, 0.16 * fhh, fhh - 0.06);
    mode = 2;
    depth = 0.08;
    frameW = 0.04;
  }
  if (shopF) {
    // one big display window per bay and a door in the middle bay
    win = vec4(cw * 0.07, cw * 0.93, 0.35, gfH * 0.82);
    mode = 1;
    depth = 0.3;
    hasWin = true;
    frameW = 0.05;
    frameCol = mix(vec3(0.1), accent(accI) * 0.6, step(0.5, hash11(edge + 2.0)));
    pier = pier && !(ki == 4);
    if (pier && nc > 2.5) hasWin = false;
  }
  if (topFloor && ki == 4 && nUp > 3.5 && hash11(seed + 2.0) < 0.25) { hasWin = hasWin; }
  float open = 0.0;
  if (hasWin && fade < 0.999) open = bandAA(cp.x, win.x, win.y, aaX) * bandAA(cp.y, win.z, win.w, aaY);
  if ((ki == 5 || ki == 8) && fi > 0.5 && fi < 1.5 && !pier && (int(col) + (ei >> 2)) % 3 == 0) balcony = true;
  // ornate surrounds on decorated kinds
  if (old && hasWin && !shopF) {
    vec2 sd = vec2(min(cp.x - win.x, win.y - cp.x), min(cp.y - win.z, win.w - cp.y));
    float sur = bandAA(min(cp.x - win.x + 0.22, win.y - cp.x + 0.22), 0.0, 0.22, px) * bandAA(cp.y, win.z - 0.16, win.w + 0.24, px);
    float lintel = bandAA(cp.x, win.x - 0.28, win.y + 0.28, px) * bandAA(cp.y, win.w + 0.03, win.w + 0.27, px);
    float sill = bandAA(cp.x, win.x - 0.12, win.y + 0.12, px) * bandAA(cp.y, win.z - 0.14, win.z - 0.02, px);
    // triangular pediment on alternate floors
    float tri = 0.0;
    if (mod(fi, 2.0) < 0.5 || ki == 8) {
      float dx = abs(cp.x - 0.5 * (win.x + win.y)) / (0.5 * (win.y - win.x) + 0.3);
      float ph = win.w + 0.27 + (1.0 - dx) * 0.28;
      tri = bandAA(cp.y, win.w + 0.25, ph, px) * step(dx, 1.0);
    }
    float orn = max(max(sur, lintel), max(sill, tri));
    col3 = mix(col3, base * 1.32 + 0.02, orn * (1.0 - fade));
    shadeDown *= 1.0 - 0.28 * bandAA(cp.y, win.w + 0.27, win.w + 0.55, px * 2.0) * (1.0 - fade);
    // pilasters between bays
    float pil = max(bandAA(cp.x, -0.02, 0.24, px), bandAA(cp.x, cw - 0.24, cw + 0.02, px));
    col3 = mix(col3, base * 1.22, pil * 0.8 * (1.0 - fade));
  }
  // painted balcony slab and rail when the 3D balconies are not drawn
  float farB = smoothstep(150.0, 230.0, dist);
  if (balcony && !groundF && farB > 0.001) {
    float slab = bandAA(cp.y, -0.04, 0.16, aaY);
    float rail = bandAA(cp.y, 0.16, 1.0, aaY) * bandAA(cp.x, cw * 0.02, cw * 0.98, aaX);
    vec3 bc = renov ? accent(accI) : base * 0.85;
    vec3 rc = mix(wall, bc, 0.85);
    col3 = mix(col3, bc, slab * farB);
    col3 = mix(col3, mix(col3, rc, 0.55), rail * (0.6 + 0.4 * step(0.5, fract(cp.x / 0.12))) * farB * (1.0 - open * 0.4));
  }
  // prefab joints and coloured coat
  if (ki == 4) {
    float jx = 1.0 - bandAA(fract(u / 3.0 + 0.5), 0.012, 0.988, px / 3.0);
    float jy = 1.0 - bandAA(fy, 0.008, 1.0, px / fhh);
    if (!renov) {
      col3 *= 1.0 - 0.32 * max(jx, jy) * (1.0 - fade);
      // rust and water stains under balcony slabs and window sills
      col3 *= 1.0 - 0.18 * smoothstep(0.55, 0.9, vnoise(vec2(u * 0.6, y * 0.3) + seed)) * 0.7;
    } else {
      // insulation coat: accent colour on the balcony strips and a band under the roof
      vec3 ac = accent(accI);
      float strip = balcony ? 1.0 : 0.0;
      float topBand = bandAA(ly, H - 1.2, H, px);
      float plth = groundF ? 1.0 : 0.0;
      col3 = mix(col3, ac, max(strip * bandAA(fx, 0.0, 1.0, 1e-3) * 0.9, max(topBand, plth * 0.9 * step(0.5, hash11(seed + 7.0)))));
      col3 *= 1.0 - 0.06 * max(jx, jy);
    }
    // floor slab line
    col3 *= 1.0 - 0.1 * bandAA(fy, 0.0, 0.04, px / fhh);
  }
  if (ki == 6) {
    // white horizontal bands at the slab lines and the roof edge
    float slab = bandAA(fy, 0.0, 0.1, px / fhh) + bandAA(ly, H - 0.6, H, px);
    col3 = mix(col3, vec3(0.9, 0.88, 0.82), clamp(slab, 0.0, 1.0));
  }
  if (ki == 0) {
    float span = 1.0 - bandAA(fy, 0.16, 0.9, px / fhh);
    col3 = mix(base * 0.45, base * 0.25, span);
    metal = 0.6; rough = 0.4;
  }
  // ---- shop fronts: awning band, sign board ----
  vec3 signCol = vec3(0.0);
  float signMask = 0.0;
  if (shopF) {
    float bandY = gfH - 0.08;
    float sgn = bandAA(ly, gfH * 0.84, gfH - 0.05, px);
    float pierMask = 1.0;
    vec3 sc = accent(int(mod(hash11(edge + 4.0) * 16.0 + col * 0.0, 16.0)));
    signMask = sgn;
    signCol = mix(vec3(0.05), sc, 0.9);
    // lettering as a hashed dash pattern (readable at street level as a sign, never as text)
    float letters = step(0.35, fract(u * 3.1 + hash11(edge) * 9.0)) * bandAA(fract(ly / (gfH * 0.16)), 0.25, 0.75, 0.05) * bandAA(u, 0.6, L - 0.6, px);
    signCol = mix(signCol, vec3(0.9, 0.88, 0.8), letters * 0.85 * (1.0 - fade));
    emit += signCol * signMask * uNight * 0.9 * step(0.35, hash11(edge + 8.0));
  }
  col3 = mix(col3, signCol, signMask);

  // ---- door in the house / shop ----
  vec3 fin = col3;
  vec3 em = vec3(0.0);
  float wr = 0.6, wm = 0.0, glassAmt = 0.0;
  if (open > 0.001) {
    float lit = step(mix(0.72, 0.42, uNight), rs2);
    if (shopF) lit = 1.0;
    if (balcony) revCol = col3 * 0.6;
    else revCol = col3;
    vec3 wc = windowView(cp, win, vec3(dot(Vw, vTan3), dot(Vw, vec3(0.0, 1.0, 0.0)), -dot(Vw, N)), depth, frameW, frameCol, revCol, rs * 97.0 + seed, lit, mode, fade, em, wr, wm, glassAmt);
    if (door) {
      vec2 dq = (cp - win.xz) / vec2(win.y - win.x, win.w - win.z);
      float dh = hash11(edge + 17.0);
      vec3 dc = dh < 0.3 ? vec3(0.32, 0.19, 0.1) : dh < 0.55 ? vec3(0.1, 0.28, 0.16) : dh < 0.75 ? vec3(0.16, 0.2, 0.3) : dh < 0.9 ? vec3(0.4, 0.06, 0.05) : vec3(0.1);
      dc = pow(dc, vec3(2.2));
      float fr = min(min(dq.x, 1.0 - dq.x), 1.0 - dq.y) < 0.09 ? 1.0 : 0.0;
      float pan = bandAA(dq.x, 0.2, 0.8, 0.02) * (bandAA(dq.y, 0.06, 0.42, 0.02) + bandAA(dq.y, 0.5, 0.88, 0.02));
      wc = dc * mix(0.75, 1.15, pan) * mix(1.0, 0.8, fr);
      if (dh > 0.5 && dq.y > 0.5 && fr < 0.5) wc = vec3(0.02) + vec3(0.12, 0.16, 0.2) * pow(1.0 - clamp(0.5, 0.0, 1.0), 2.0);
      float handle = step(length(dq - vec2(0.85, 0.45)), 0.035);
      wc = mix(wc, vec3(0.7, 0.62, 0.3), handle);
      em = vec3(0.0); glassAmt = 0.0; wr = 0.5;
    }
    float o = open * (1.0 - fade);
    fin = mix(fin, wc, o);
    emit = mix(emit, em, o);
    rough = mix(rough, wr, o);
    metal = mix(metal, wm, o);
    gNrmK = mix(gNrmK, 0.0, o);
  }
  // far: average glass into the wall so the pattern does not shimmer
  if (fade > 0.001 && hasWin) {
    float cov = ((win.y - win.x) * (win.w - win.z)) / (cw * fhh);
    vec3 avg = mix(vec3(0.06, 0.08, 0.1), vec3(0.1, 0.14, 0.2) * mix(1.0, 0.1, uNight), 0.5);
    fin = mix(fin, mix(col3, avg, cov * 0.85), fade);
    // some windows still glow at night
    emit += vec3(1.0, 0.75, 0.45) * cov * fade * uNight * 1.3 * step(0.55, rs2);
    rough = mix(rough, 0.6, fade);
  }
  if (nUp < 0.5 && groundF && ly < 0.0) fin = col3;
  fin *= shadeDown;
  diffuseColor.rgb = fin;
  gRough = clamp(rough, 0.04, 1.0);
  gMetal = metal;
  gEmit = emit;
  gAO = ao;
}
`;

const ROOF_FN = /* glsl */ `
void roofShade(inout vec4 diffuseColor, vec3 N) {
  float seed = vInfo.y;
  int variant = int(vGeoF.z + 0.5);
  float type = vGeoF.w;
  if (type > 1.5 && type < 2.5) {
    // pitched: clay tiles, one of three sets per building
    float layer = 7.0 + floor(hash11(seed + 6.0) * 3.0);
    vec2 uv = vec2(vU, vV) / 1.3;
    vec4 t = wallTex(layer, uv);
    vec3 tint = mix(vec3(1.0, 0.86, 0.78), vec3(1.2, 0.95, 0.8), hash11(seed + 7.0));
    if (layer > 8.5) tint = vec3(1.0);
    float moss = smoothstep(0.55, 0.8, fbm(vec2(vU, vV) * 0.35 + seed)) * 0.35;
    diffuseColor.rgb = t.rgb * tint * mix(vec3(1.0), vec3(0.75, 0.85, 0.6), moss) * 1.15;
    gRough = t.a; gNrm = wallNrm(layer, uv); gNrmK = 1.0;
    gAO = 1.0;
  } else if (type > 2.5) {
    vec2 uv = vWPos.xz / 2.5;
    vec4 t = wallTex(5.0, uv);
    diffuseColor.rgb = t.rgb * 0.9;
    gRough = t.a; gNrm = wallNrm(5.0, uv); gNrmK = 0.7;
  } else {
    // flat roof: tar paper, gravel, worn concrete, puddle patches
    vec2 p = vWPos.xz;
    vec4 t = wallTex(6.0, p / 2.4);
    float n = fbm(p * 0.22 + seed);
    vec3 tar = vec3(0.1, 0.1, 0.105) * (0.8 + 0.5 * t.r);
    vec3 conc = t.rgb * 0.7;
    vec3 gravel = vec3(0.22, 0.21, 0.2) * (0.6 + 0.9 * vnoise(p * 9.0));
    vec3 c = mix(tar, conc, smoothstep(0.45, 0.6, n));
    c = mix(c, gravel, smoothstep(0.62, 0.78, fbm(p * 0.13 + seed * 2.0)));
    diffuseColor.rgb = c;
    gRough = mix(0.9, 0.35, smoothstep(0.72, 0.85, fbm(p * 0.09 + seed * 3.0)) * step(0.5, hash11(seed + 3.0)));
    gNrm = wallNrm(6.0, p / 2.4); gNrmK = 0.7;
    gSpec = 0.5;
  }
}
`;

export function buildingMaterial(assets) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tWallA = { value: assets.wall.albedo };
    shader.uniforms.tWallN = { value: assets.wall.normal };
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aInfo; attribute vec4 aGeo; attribute vec2 aSurf; attribute vec3 aTan;
varying vec3 vWPos; varying vec3 vWNormal; varying vec3 vTan3; varying float vU; varying float vV;
flat varying vec4 vInfo; flat varying vec4 vGeoF;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);
vTan3 = normalize(mat3(modelMatrix) * aTan);
vU = aGeo.x; vV = aSurf.y;
vInfo = aInfo; vGeoF = vec4(aGeo.y, aGeo.z, aGeo.w, aSurf.x);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}\n${WALL_FN}\n${ROOF_FN}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 Nf = normalize(vWNormal);
  if (vGeoF.w < 0.5) wallShade(diffuseColor, Nf);
  else roofShade(diffuseColor, Nf);
}`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (gNrmK > 0.0) {
  vec3 Nw = normalize(vWNormal);
  vec3 Tw = normalize(vTan3);
  vec3 Bw = vGeoF.w < 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(cross(Nw, Tw));
  if (vGeoF.w > 1.5 && vGeoF.w < 2.5 && Bw.y < 0.0) Bw = -Bw;
  if (abs(vGeoF.w - 1.0) < 0.5) { Tw = vec3(1.0, 0.0, 0.0); Bw = vec3(0.0, 0.0, 1.0); }
  vec3 pert = normalize(Tw * gNrm.x * gNrmK + Bw * gNrm.y * gNrmK + Nw);
  normal = normalize((viewMatrix * vec4(pert, 0.0)).xyz);
}`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= gSpec;');
  };
  mat.customProgramCacheKey = () => 'facade-v1';
  return mat;
}
