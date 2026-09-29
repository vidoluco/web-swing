import * as THREE from 'three';

// The sky: a procedural dome (gradient, sun glow, soft clouds, stars, moon) and the palette that drives it,
// the fog, the lights and the environment map through the day. Everything is keyed by the sun's elevation.

const C = (hex) => new THREE.Color(hex);
const mixC = (a, b, t, out) => out.copy(a).lerp(b, t);
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

// One row per sun elevation (degrees). zen: zenith, hor: horizon (also the fog), glow: tint around the sun,
// sun: colour of the direct light, sunK: its strength as a share of the daytime sun, glowK: how strong the sky
// glow is, hs and hg: sky and ground colour of the fill light, hK: fill strength, envK: image based light,
// ex: exposure, cl: cloud lit colour.
const STOPS = [
  { e: -20, zen: '#070d22', hor: '#18213a', glow: '#1c2238', sun: '#8fa4ff', sunK: 0.0, glowK: 0.0, hs: '#4a5e9c', hg: '#181c28', hK: 0.62, envK: 1.0, ex: 2.1, cl: '#26345a' },
  { e: -9, zen: '#0d1838', hor: '#2c3358', glow: '#7a5060', sun: '#8fa4ff', sunK: 0.0, glowK: 0.45, hs: '#5a6ca8', hg: '#1c202c', hK: 0.62, envK: 1.0, ex: 1.9, cl: '#6a5478' },
  { e: -3, zen: '#1b2f6c', hor: '#8b6c92', glow: '#f08a60', sun: '#ff8a4a', sunK: 0.1, glowK: 0.9, hs: '#8a86b8', hg: '#2a2226', hK: 0.6, envK: 1.0, ex: 1.5, cl: '#f0a080' },
  { e: 0.5, zen: '#2c4d90', hor: '#eb8a68', glow: '#ff9048', sun: '#ff9450', sunK: 0.36, glowK: 1.0, hs: '#c8b4bc', hg: '#4a3a30', hK: 0.5, envK: 1.0, ex: 1.2, cl: '#ffb08a' },
  { e: 5, zen: '#3b6aad', hor: '#f5a672', glow: '#ff9a52', sun: '#ffac64', sunK: 0.64, glowK: 0.85, hs: '#d4c8cc', hg: '#5a4a3a', hK: 0.55, envK: 1.0, ex: 1.15, cl: '#ffc99a' },
  { e: 12, zen: '#4a82c3', hor: '#efcc9c', glow: '#ffcf8c', sun: '#ffd2a0', sunK: 0.88, glowK: 0.5, hs: '#ccd2dc', hg: '#5c5142', hK: 0.5, envK: 1.0, ex: 1.05, cl: '#ffe6c8' },
  { e: 28, zen: '#4a88d4', hor: '#cbe0f2', glow: '#fff0d0', sun: '#ffead0', sunK: 1.0, glowK: 0.25, hs: '#c8d6ec', hg: '#615a4c', hK: 0.46, envK: 1.0, ex: 1.0, cl: '#ffffff' },
  { e: 60, zen: '#3c7ad2', hor: '#b8d6f2', glow: '#ffffe6', sun: '#fff3e0', sunK: 1.0, glowK: 0.15, hs: '#c8d6ec', hg: '#665e50', hK: 0.44, envK: 1.0, ex: 1.0, cl: '#ffffff' },
].map((s) => ({
  e: s.e,
  zen: C(s.zen), hor: C(s.hor), glow: C(s.glow), sun: C(s.sun), hs: C(s.hs), hg: C(s.hg), cl: C(s.cl),
  sunK: s.sunK, glowK: s.glowK, hK: s.hK, envK: s.envK, ex: s.ex,
}));
const COLOR_KEYS = ['zen', 'hor', 'glow', 'sun', 'hs', 'hg', 'cl'];
const NUM_KEYS = ['sunK', 'glowK', 'hK', 'envK', 'ex'];

// Per-city air: Bucharest is hazy and warm grey, Brasov clear with blue distance.
export const PROFILES = {
  bucharest: { lat: 44.43, fogNear: 700, fogFar: 6200, haze: 1.0, hazeScale: 380, tint: '#c2b8a6', tintK: 0.3, cover: 0.42 },
  brasov: { lat: 45.65, fogNear: 1800, fogFar: 13000, haze: 0.55, hazeScale: 700, tint: '#86aae0', tintK: 0.4, cover: 0.5 },
};
PROFILES.center = PROFILES.bucharest;
export const profileFor = (id) => PROFILES[id] || PROFILES.bucharest;

// Per-style tweaks to the palette: saturation, warmth of the horizon, strength of the glow and cloud cover.
export const STYLE_SKY = {
  a: { sat: 1.0, glow: 1.0, cover: 0, warm: 0 },
  b: { sat: 1.32, glow: 1.45, cover: 0.1, warm: 0.16 },
  c: { sat: 1.22, glow: 1.2, cover: 0.05, warm: 0.08 },
};
const _hsl = { h: 0, s: 0, l: 0 };
function saturate(c, k) {
  if (k === 1) return c;
  c.getHSL(_hsl);
  return c.setHSL(_hsl.h, Math.min(1, _hsl.s * k), _hsl.l);
}

const _tint = new THREE.Color();
const _warm = new THREE.Color('#ffb480');
export function makeAtmosphere() {
  const a = { elev: 0, cover: 0.4 };
  for (const k of COLOR_KEYS) a[k] = new THREE.Color();
  for (const k of NUM_KEYS) a[k] = 0;
  a.fog = new THREE.Color();
  return a;
}

// Palette for a sun elevation, a city profile and a style id ('a', 'b', 'c').
export function atmosphere(elev, profile, style, out = makeAtmosphere()) {
  let i = 0;
  while (i < STOPS.length - 2 && elev > STOPS[i + 1].e) i++;
  const A = STOPS[i], B = STOPS[i + 1];
  let t = (elev - A.e) / (B.e - A.e);
  t = Math.max(0, Math.min(1, t));
  t = t * t * (3 - 2 * t);
  for (const k of COLOR_KEYS) mixC(A[k], B[k], t, out[k]);
  for (const k of NUM_KEYS) out[k] = A[k] + (B[k] - A[k]) * t;
  out.elev = elev;
  const st = STYLE_SKY[style] || STYLE_SKY.a;
  // City air: pull the horizon toward the local haze colour, matched in brightness so the night stays dark.
  const l = lum(out.hor);
  _tint.set(profile.tint);
  _tint.multiplyScalar(l / Math.max(lum(_tint), 1e-4));
  out.hor.lerp(_tint, profile.tintK * (0.25 + 0.75 * Math.min(1, Math.max(0, (elev - 2) / 26))));
  if (st.warm) out.hor.lerp(_warm.clone().multiplyScalar(l / Math.max(lum(_warm), 1e-4)), st.warm * Math.min(1, out.glowK));
  for (const k of ['zen', 'hor', 'glow', 'cl']) saturate(out[k], st.sat);
  out.glowK *= st.glow;
  out.cover = Math.min(0.9, profile.cover + st.cover);
  out.fog.copy(out.hor);
  return out;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGlow, uSunCol, uBelow, uCloudLit;
uniform vec3 uSun, uMoon;
uniform float uGlowK, uNight, uStars, uCover, uTime, uStyle, uEnv, uSunVis, uDesat;
uniform sampler2D uHdri;
uniform float uHdriMix, uHdriRot, uHdriScale, uHdriMax;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm5(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}
float fbm3(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}

const float PI = 3.14159265;

vec3 hdriAt(vec3 d) {
  float c = cos(uHdriRot), s = sin(uHdriRot);
  vec3 r = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
  vec2 uv = vec2(atan(r.z, r.x) / (2.0 * PI) + 0.5, asin(clamp(r.y, -1.0, 1.0)) / PI + 0.5);
  return min(texture2D(uHdri, uv).rgb * uHdriScale, vec3(uHdriMax));
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float cs = max(dot(d, uSun), 0.0);
  float u = 1.0 - dot(d, uSun);
  float toon = step(1.5, uStyle);

  // Gradient from the horizon to the zenith.
  float t = exp(-max(y, 0.0) * 3.4);
  vec3 sky = mix(uZenith, uHorizon, t);
  // Glow around the sun and along the horizon on its side.
  vec2 hs = normalize(uSun.xz + vec2(1e-5)), hd = normalize(d.xz + vec2(1e-5));
  float az = max(dot(hs, hd), 0.0);
  float low = exp(-abs(y) * 4.2);
  sky += uGlow * uGlowK * (0.7 * pow(cs, 4.0) + 0.9 * pow(cs, 26.0) + 1.1 * pow(cs, 260.0) + 0.9 * low * pow(az, 3.0));

  float cloudA = 0.0;
  if (y > 0.0) {
    // Cumulus on a plane: density from noise, light from a second tap toward the sun.
    vec2 p = d.xz / (y * 0.85 + 0.12) * 0.5;
    vec2 wind = vec2(uTime * 0.0045, uTime * 0.002);
    float n = fbm5(p + wind);
    float edge = mix(0.3, 0.14, step(0.5, uStyle));
    float dens = smoothstep(1.0 - uCover, 1.0 - uCover + edge, n);
    vec2 sp = normalize(uSun.xz + vec2(1e-5)) * 0.07;
    float n2 = fbm5(p + wind + sp);
    float lit = clamp(0.5 + (n - n2) * 4.5, 0.0, 1.0);
    vec3 under = mix(uZenith, uHorizon, 0.55) * 0.62 + 0.03;
    vec3 top = uCloudLit * (0.85 + 0.9 * pow(cs, 3.0) * uGlowK) + 0.05;
    vec3 cc = mix(under, top, lit);
    cc = mix(cc, under * 0.85, smoothstep(0.62, 0.95, n) * 0.35 * (1.0 - lit));
    if (toon > 0.5) cc = mix(under * 1.05, top, step(0.52, lit));
    float fade = smoothstep(0.015, 0.17, y);
    cloudA = dens * fade;
    // Thin high cloud, stretched.
    vec2 q = d.xz / (y + 0.35) * vec2(0.55, 1.5);
    float ci = fbm3(q * 2.2 + wind * 1.6);
    float cirr = smoothstep(0.52, 0.85, ci) * 0.32 * smoothstep(0.03, 0.3, y) * (1.0 - toon);
    sky = mix(sky, uCloudLit * 0.9 + 0.05, cirr * (1.0 - cloudA));
    sky = mix(sky, cc, cloudA);
  }

  if (uEnv < 0.5) {
    // Sun disc, dimmed by cloud, with a hot corona.
    float disc = 1.0 - smoothstep(5.5e-5, 9.5e-5, u);
    sky += uSunCol * uSunVis * (2.6 * disc + 0.8 * exp(-u * 1800.0)) * (1.0 - cloudA * 0.9) * step(0.0, y + 0.01);
    // Stars and the moon at night, hidden by cloud.
    if (uStars > 0.02) {
      vec3 sp3 = d * 150.0;
      vec3 ip = floor(sp3), fp = fract(sp3);
      float hh = h31(ip);
      vec3 sc = vec3(h31(ip + 7.7), h31(ip + 13.1), h31(ip + 3.3)) * 0.6 + 0.2;
      float star = step(0.985, hh) * smoothstep(0.34, 0.0, length(fp - sc));
      vec3 sp4 = d * 62.0;
      vec3 ip4 = floor(sp4), fp4 = fract(sp4);
      float h4 = h31(ip4 + 91.0);
      vec3 sc4 = vec3(h31(ip4 + 1.7), h31(ip4 + 5.1), h31(ip4 + 9.3)) * 0.5 + 0.25;
      float star4 = step(0.992, h4) * smoothstep(0.3, 0.0, length(fp4 - sc4));
      float tw = 0.75 + 0.25 * sin(uTime * 2.5 + hh * 60.0);
      vec3 starCol = mix(vec3(0.8, 0.9, 1.2), vec3(1.3, 1.1, 0.9), fract(hh * 37.0));
      sky += starCol * (star * 2.4 * tw + star4 * 3.5) * uStars * smoothstep(0.0, 0.18, y) * (1.0 - cloudA);
      // Moon.
      float mu = 1.0 - dot(d, uMoon);
      if (mu < 6e-4 && uMoon.y > -0.05) {
        vec3 tg = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
        vec3 bt = cross(tg, uMoon);
        vec2 q = vec2(dot(d, tg), dot(d, bt)) / 0.024;
        float r = length(q);
        float m = 1.0 - smoothstep(0.93, 1.0, r);
        float maria = fbm3(q * 2.6 + 4.0);
        vec3 mc = mix(vec3(0.6, 0.64, 0.74), vec3(0.98, 0.97, 0.95), smoothstep(0.38, 0.62, maria));
        sky = mix(sky, mc * (0.65 + 0.35 * sqrt(max(1.0 - r * r, 0.0))) * 2.6, m * (1.0 - cloudA) * uStars);
      }
      sky += vec3(0.5, 0.6, 0.9) * exp(-mu * 900.0) * 0.4 * uStars * (1.0 - cloudA * 0.7) * step(-0.05, uMoon.y);
    }
  } else if (uHdriMix > 0.0 && y > -0.1) {
    sky = mix(sky, hdriAt(d), uHdriMix * smoothstep(-0.1, 0.05, y));
  }

  sky = mix(vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), sky, 1.0 - uDesat);

  // Under the horizon: the fog colour to look at, the ground bounce inside the environment map.
  sky = mix(sky, uBelow, smoothstep(0.004, -0.05, y));
  gl_FragColor = vec4(sky, 1.0);
}`;

export function makeSkyMaterial(env) {
  const dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  dummy.needsUpdate = true;
  const u = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() }, uBelow: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() },
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) },
    uGlowK: { value: 0 }, uNight: { value: 0 }, uCover: { value: 0.4 }, uTime: { value: 0 }, uStyle: { value: 0 },
    uEnv: { value: env ? 1 : 0 }, uSunVis: { value: 1 }, uStars: { value: 0 }, uDesat: { value: env ? 0.4 : 0 },
    uHdri: { value: dummy }, uHdriMix: { value: 0 }, uHdriRot: { value: 0 }, uHdriScale: { value: 1 }, uHdriMax: { value: 4 },
  };
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
}

// Copies a palette and the celestial directions into a sky material.
export function setSkyUniforms(mat, atm, sun, moon, night, styleIdx, time) {
  const u = mat.uniforms;
  u.uZenith.value.copy(atm.zen);
  u.uHorizon.value.copy(atm.hor);
  u.uGlow.value.copy(atm.glow);
  u.uSunCol.value.copy(atm.sun);
  u.uBelow.value.copy(atm.fog);
  u.uCloudLit.value.copy(atm.cl);
  u.uSun.value.set(sun.x, sun.y, sun.z);
  u.uMoon.value.set(moon.x, moon.y, moon.z);
  u.uGlowK.value = atm.glowK;
  u.uNight.value = night;
  u.uStars.value = Math.min(1, Math.max(0, (-sun.elev - 5) / 9));
  u.uCover.value = atm.cover;
  u.uStyle.value = styleIdx;
  u.uTime.value = time;
  u.uSunVis.value = Math.min(1, Math.max(0, (sun.elev + 4) / 4));
}

// The dome that follows the camera. It is drawn after the opaque geometry and only where nothing covers it.
export class SkyDome {
  constructor() {
    this.material = makeSkyMaterial(false);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), this.material);
    this.mesh.scale.setScalar(20000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1e6;
    this.mesh.name = 'sky';
    this.mesh.onBeforeRender = (r, s, cam) => this.mesh.position.copy(cam.position);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
