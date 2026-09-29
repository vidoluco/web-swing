import * as THREE from 'three';
import { GLSL_COMMON } from './facade.js';
import { uniforms } from './uniforms.js';

// Street level materials on the photographic ground set (assets.js GROUND): roads with lane paint, kerbs and
// wear, pavements, paths, plazas, grass, tram beds. All are world-space and use two samples of every texture
// at different scales and angles so the repeat never shows.
//   layers: asphalt_a 0, asphalt_b 1, paving_a 2, paving_b 3, paving_c 4, paving_d 5, grass_a 6, grass_b 7, dirt_a 8, gravel_a 9, bark_a 10

const DECL = /* glsl */ `
uniform highp sampler2DArray tGndA;
uniform highp sampler2DArray tGndN;
uniform float uNight;
varying vec3 vWPos;
varying vec2 vUv;
varying vec4 vRoad;
varying vec2 vDir;
float gRough = 0.9; float gMetal = 0.0; vec3 gEmit = vec3(0.0); vec2 gNrm = vec2(0.0); float gNrmK = 1.0;
${GLSL_COMMON}
vec4 gndA(float l, vec2 uv) { return texture(tGndA, vec3(uv, l)); }
vec2 gndN(float l, vec2 uv) { return texture(tGndN, vec3(uv, l)).xy * 2.0 - 1.0; }
// Two taps at different scale and rotation, blended by low frequency noise.
vec4 gndSample(float l, vec2 p, float s, out vec2 n) {
  vec2 q = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8) * 0.71 + 13.7;
  float k = smoothstep(0.3, 0.7, vnoise(p * 0.045));
  vec4 a = gndA(l, p / s), b = gndA(l, q / s);
  n = mix(gndN(l, p / s), gndN(l, q / s), k);
  return mix(a, b, k);
}
float line(float d, float halfW, float aa) { return 1.0 - smoothstep(halfW - aa, halfW + aa, abs(d)); }
`;

const ROAD = /* glsl */ `
void groundShade(inout vec4 dc) {
  float w = vRoad.x;
  int flags = int(vRoad.y + 0.5);
  bool major = (flags & 1) != 0, oneway = (flags & 2) != 0;
  float len = vRoad.z, seed = vRoad.w;
  float u = vUv.x;
  float off = (vUv.y - 0.5) * (w + 0.36);
  float ad = abs(off);
  float hw = w * 0.5;
  vec2 p = vWPos.xz;
  float aa = fwidth(off) * 1.2 + 1e-4;
  vec2 n;
  if (ad > hw) {
    // kerb stone: pale concrete, dark shadow line on the street side, bevel towards the pavement
    vec4 t = gndSample(2.0, p, 1.6, n);
    float e = (ad - hw) / 0.18;
    dc.rgb = t.rgb * vec3(1.08, 1.06, 1.02) * (0.92 + 0.1 * vnoise(p * 6.0));
    dc.rgb *= mix(0.42, 1.0, smoothstep(0.0, 0.28, e));
    gRough = 0.8;
    vec2 across = vec2(-vDir.y, vDir.x) * sign(off);
    gNrm = n * 0.4 - vec2(across.x, -across.y) * 0.9 * (1.0 - smoothstep(0.0, 0.3, e));
    gNrmK = 1.0;
    return;
  }
  // asphalt with a worn set blended in patches
  vec4 a0 = gndSample(0.0, p, 4.2, n);
  vec2 n1;
  vec4 a1 = gndSample(1.0, p, 3.6, n1);
  float wear = smoothstep(0.5, 0.75, fbm(p * 0.09 + seed));
  vec3 col = mix(a0.rgb, a1.rgb, wear * 0.8);
  n = mix(n, n1, wear * 0.8);
  gRough = mix(a0.a, a1.a, wear);
  col *= vec3(0.86, 0.87, 0.9);
  // wheel tracks: polished darker bands 0.85 m either side of each lane centre
  float lanes = max(1.0, floor((w + 0.6) / 3.2));
  float lw = w / lanes;
  float lc = (floor((off + hw) / lw) + 0.5) * lw - hw;
  float dl = abs(off - lc);
  float track = exp(-pow((dl - 0.85) / 0.3, 2.0));
  col *= 1.0 - 0.14 * track * smoothstep(0.0, 6.0, len);
  gRough = mix(gRough, 0.55, track * 0.4);
  // repair patches and cracks
  vec2 pc = floor(vec2(u / 6.5, off / 2.6) + seed);
  float fix = step(0.9, hash12(pc)) * bandAA(fract(u / 6.5 + seed), 0.05, 0.95, 0.02) * bandAA(fract(off / 2.6 + seed), 0.05, 0.95, 0.02);
  col = mix(col, col * 0.62, fix);
  gRough = mix(gRough, 0.75, fix);
  float crack = (1.0 - smoothstep(0.0, 0.03, abs(fbm(p * 0.7 + seed) - 0.5))) * step(0.6, fbm(p * 0.05 + 3.0));
  col *= 1.0 - 0.5 * crack;
  // paint
  float paint = 0.0;
  float clearance = min(w * 0.55 + 1.0, 8.0);
  float ends = smoothstep(clearance, clearance + 1.5, min(u, len - u));
  float dash = step(fract(u / 9.0), 0.36);
  float dashL = step(fract(u / 6.0), 0.4);
  if (!oneway) {
    if (w >= 10.5) {
      paint = max(line(off - 0.13, 0.055, aa), line(off + 0.13, 0.055, aa)) * ends;
      float l4 = line(abs(off) - hw * 0.5, 0.06, aa) * dashL * ends;
      paint = max(paint, l4 * step(12.5, w));
    } else if (w >= 6.0) {
      paint = line(off, 0.06, aa) * dash * ends;
    }
  } else if (lanes >= 2.0) {
    for (int i = 1; i < 5; i++) {
      float fi = float(i);
      if (fi < lanes) paint = max(paint, line(off + hw - fi * lw, 0.06, aa) * dashL * ends);
    }
  }
  if (major && w >= 7.0) paint = max(paint, line(ad - (hw - 0.3), 0.06, aa) * smoothstep(1.0, 3.0, min(u, len - u) - clearance * 0.2));
  float pv = paint * (0.55 + 0.45 * smoothstep(0.3, 0.7, vnoise(p * 4.0)));
  col = mix(col, vec3(0.78, 0.78, 0.74), pv);
  gRough = mix(gRough, 0.5, pv);
  dc.rgb = col;
  gNrm = n; gNrmK = 1.0 - 0.5 * pv;
}
`;

const SIDEWALK = /* glsl */ `
void groundShade(inout vec4 dc) {
  float w = vRoad.x, W = vRoad.y;
  float seed = vRoad.w;
  float ad = abs(vUv.y - 0.5) * W;
  vec2 p = vWPos.xz;
  vec2 n;
  vec4 t = gndSample(2.0, p, 2.6, n);
  vec3 col = t.rgb * vec3(1.0, 1.0, 1.02);
  // slabs: each 0.6 m square gets its own tone
  vec2 sl = floor(p / 0.6);
  col *= 0.9 + 0.2 * hash12(sl);
  float dirt = smoothstep(0.5, 0.85, fbm(p * 0.35 + seed));
  col = mix(col, col * 0.62 * vec3(1.0, 0.98, 0.92), dirt * 0.7);
  // darker towards the building line, lighter near the kerb
  float toEdge = W * 0.5 - ad;
  col *= mix(0.78, 1.0, smoothstep(0.0, 0.8, toEdge));
  // moss and weeds in the joints near the outer edge
  float weed = smoothstep(0.7, 0.9, hash12(floor(p * 9.0))) * smoothstep(1.5, 0.0, toEdge) * 0.55;
  col = mix(col, vec3(0.18, 0.24, 0.08), weed);
  dc.rgb = col;
  gRough = t.a * (1.0 - 0.3 * dirt);
  gNrm = n; gNrmK = 1.0;
}
`;

const PATH = /* glsl */ `
void groundShade(inout vec4 dc) {
  float w = vRoad.x;
  float ad = abs(vUv.y - 0.5) * vRoad.y;
  vec2 p = vWPos.xz;
  vec2 n;
  vec4 t = gndSample(9.0, p, 1.4, n);
  vec3 col = t.rgb * vec3(1.05, 1.02, 0.95);
  // worn centre, fresh grit at the sides, ragged edge blending into the lawn
  col *= 0.88 + 0.16 * smoothstep(0.0, 0.4, ad / max(w, 0.5));
  vec2 n2;
  vec4 g = gndSample(6.0, p, 1.8, n2);
  float edge = smoothstep(w * 0.5 - 0.5, w * 0.5, ad + 0.2 * vnoise(p * 3.0));
  dc.rgb = mix(col, g.rgb * vec3(0.92, 0.95, 0.85), edge);
  gRough = mix(t.a, g.a, edge);
  gNrm = mix(n, n2, edge); gNrmK = 1.0;
}
`;

const PLAZA = /* glsl */ `
void groundShade(inout vec4 dc) {
  vec2 p = vWPos.xz;
  float seed = vRoad.w;
  vec2 n;
  bool sett = seed > 1.5;
  vec4 t = gndSample(sett ? 3.0 : 4.0, p, sett ? 2.2 : 2.6, n);
  vec3 col = t.rgb;
  float dirt = smoothstep(0.5, 0.85, fbm(p * 0.3));
  col = mix(col, col * 0.65, dirt * 0.6);
  col *= 0.94 + 0.12 * hash12(floor(p / 0.5));
  dc.rgb = col;
  gRough = t.a;
  gNrm = n; gNrmK = 1.0;
}
`;

const GRASS = /* glsl */ `
void groundShade(inout vec4 dc) {
  vec2 p = vWPos.xz;
  vec2 n, n2;
  float k = smoothstep(0.35, 0.65, fbm(p * 0.02 + 5.0));
  vec4 a = gndSample(6.0, p, 1.7, n);
  vec4 b = gndSample(7.0, p, 1.4, n2);
  vec3 col = mix(a.rgb, b.rgb, k);
  n = mix(n, n2, k);
  // late September: yellow and brown patches, dry earth where it is trodden
  float dry = smoothstep(0.55, 0.8, fbm(p * 0.035 + 11.0));
  col = mix(col, col * vec3(1.35, 1.15, 0.55) + vec3(0.02, 0.01, 0.0), dry * 0.55);
  vec2 n3;
  vec4 d = gndSample(8.0, p, 2.0, n3);
  float bare = smoothstep(0.62, 0.82, fbm(p * 0.06 + 2.0));
  col = mix(col, d.rgb * 0.85, bare * 0.75);
  n = mix(n, n3, bare * 0.75);
  col *= 0.8 + 0.4 * vnoise(p * 0.4);
  // fallen leaves
  float leaf = step(0.955, hash12(floor(p * 7.0))) * (0.5 + 0.5 * vnoise(p * 0.5));
  vec3 lc = mix(vec3(0.55, 0.32, 0.08), vec3(0.62, 0.5, 0.1), hash12(floor(p * 7.0) + 4.0));
  col = mix(col, lc, leaf * 0.7);
  dc.rgb = col * 0.95;
  gRough = 0.95;
  gNrm = n; gNrmK = 0.8;
}
`;

const RAIL = /* glsl */ `
void groundShade(inout vec4 dc) {
  float ad = abs(vUv.y - 0.5) * vRoad.y;
  float u = vUv.x;
  vec2 p = vWPos.xz;
  vec2 n;
  bool bed = vRoad.w < 0.5;
  if (bed) {
    // ballast between and around the rails, sleepers every 0.6 m
    vec4 t = gndSample(9.0, p, 1.2, n);
    vec3 col = t.rgb * vec3(0.55, 0.53, 0.5);
    float sl = bandAA(fract(u / 0.62), 0.0, 0.16, fwidth(u)) * bandAA(ad, 0.0, 1.05, 0.03);
    col = mix(col, vec3(0.16, 0.1, 0.07), sl * 0.85);
    dc.rgb = col;
    gRough = 0.95; gNrm = n; gNrmK = 1.0;
  } else {
    // rail head: bright steel
    dc.rgb = vec3(0.32, 0.32, 0.34);
    gRough = 0.32; gMetal = 0.9; gNrmK = 0.0;
  }
}
`;

function groundMaterial(assets, body, off, key, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGndA = { value: assets.ground.albedo };
    shader.uniforms.tGndN = { value: assets.ground.normal };
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad; attribute vec2 aDir; varying vec3 vWPos; varying vec2 vUv; varying vec4 vRoad; varying vec2 vDir;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vUv = uv; vRoad = aRoad; vDir = aDir;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DECL}\n${body}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ngroundShade(diffuseColor);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 Nw = vec3(0.0, 1.0, 0.0);
  vec3 pert = normalize(vec3(gNrm.x * gNrmK, 1.0, -gNrm.y * gNrmK));
  normal = normalize((viewMatrix * vec4(pert, 0.0)).xyz);
}`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;');
  };
  mat.customProgramCacheKey = () => 'ground-' + key;
  Object.assign(mat, extra);
  return mat;
}

export function groundMaterials(assets) {
  return {
    road: groundMaterial(assets, ROAD, -6, 'road'),
    sidewalk: groundMaterial(assets, SIDEWALK, -4, 'sidewalk'),
    path: groundMaterial(assets, PATH, -5, 'path'),
    plaza: groundMaterial(assets, PLAZA, -4, 'plaza'),
    grass: groundMaterial(assets, GRASS, -2, 'grass'),
    railBed: groundMaterial(assets, RAIL, -7, 'rail'),
    rail: groundMaterial(assets, RAIL, -8, 'rail'),
  };
}
