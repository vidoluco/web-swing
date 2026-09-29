import * as THREE from 'three';

// Materials for the OSM city. Facades are drawn from per-vertex attributes (distance along
// the wall, base and top height, style, seed, wall tangent), so any footprint gets correctly
// spaced floors. Windows use interior mapping: each one shows a room in perspective.

const COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float band(float f, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, f) * (1.0 - smoothstep(b - aa, b + aa, f));
}
`;

function offset(mat, units) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = units;
  mat.polygonOffsetUnits = units;
  return mat;
}

export function loadTextures(base = 'textures') {
  const L = new THREE.TextureLoader();
  const load = (name, srgb) => {
    const t = L.load(`${base}/${name}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    brick: load('brick_col.jpg', true), brickN: load('brick_nrm.jpg'),
    concrete: load('concrete_col.jpg', true), concreteN: load('concrete_nrm.jpg'),
    plaster: load('plaster_col.jpg', true), plasterN: load('plaster_nrm.jpg'),
    asphalt: load('asphalt_col.jpg', true), asphaltN: load('asphalt_nrm.jpg'),
    pavers: load('pavers_col.jpg', true), paversN: load('pavers_nrm.jpg'),
    water: load('waternormals.jpg'),
  };
}

export function osmBuildingMaterial(envMap, tex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 });
  void envMap;
  const uniforms = {
    tBrick: { value: tex.brick }, tBrickN: { value: tex.brickN },
    tConcrete: { value: tex.concrete }, tConcreteN: { value: tex.concreteN },
    tPlaster: { value: tex.plaster }, tPlasterN: { value: tex.plasterN },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aU; attribute float aBase; attribute float aTop; attribute float aStyle; attribute float aSeed; attribute float aRoof; attribute vec2 aTan;
varying vec3 vWPos; varying vec3 vWNormal; varying float vU; varying float vRoof; varying vec2 vTan;
flat varying float vBase; flat varying float vTop; flat varying float vStyle; flat varying float vSeed;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);
vU = aU; vBase = aBase; vTop = aTop; vStyle = aStyle; vSeed = aSeed; vRoof = aRoof; vTan = aTan;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tBrick; uniform sampler2D tBrickN; uniform sampler2D tConcrete; uniform sampler2D tConcreteN; uniform sampler2D tPlaster; uniform sampler2D tPlasterN;
varying vec3 vWPos; varying vec3 vWNormal; varying float vU; varying float vRoof; varying vec2 vTan;
flat varying float vBase; flat varying float vTop; flat varying float vStyle; flat varying float vSeed;
float gRough = 0.85; float gMetal = 0.0; vec3 gEmit = vec3(0.0); vec3 gTN = vec3(0.0, 0.0, 1.0); float gTNk = 0.0; float gSpecK = 1.0;
${COMMON}
// Interior mapping: ray-cast a box room behind the window. p = position on the front face in metres,
// r = view ray in room space (x along the wall, y up, z into the building).
vec3 room(vec2 p, vec3 r, vec2 size, float depth, float seed, float lit, out float shade) {
  vec3 o = vec3(p, 0.0);
  float tx = r.x > 0.0 ? (size.x - o.x) / r.x : -o.x / min(r.x, -1e-4);
  float ty = r.y > 0.0 ? (size.y - o.y) / r.y : -o.y / min(r.y, -1e-4);
  float tz = depth / max(r.z, 1e-4);
  float t = min(min(tx, ty), tz);
  vec3 h = o + r * t;
  vec3 wallC = mix(vec3(0.78, 0.74, 0.66), vec3(0.62, 0.7, 0.74), hash12(vec2(seed, 3.1)));
  wallC = mix(wallC, vec3(0.85, 0.66, 0.5), step(0.75, hash12(vec2(seed, 9.2))));
  vec3 c;
  if (t == tz) {
    c = wallC;
    // A door or a picture on the back wall.
    float fx = h.x / size.x;
    if (hash12(vec2(seed, 5.0)) > 0.5 && abs(fx - 0.3) < 0.1 && h.y < size.y * 0.75) c *= 0.55;
    if (abs(fx - 0.65) < 0.12 && abs(h.y / size.y - 0.55) < 0.12) c = mix(c, vec3(0.2, 0.3, 0.5) * hash12(vec2(seed, 7.0)) + 0.1, 0.8);
  } else if (t == ty) {
    c = r.y < 0.0 ? mix(vec3(0.35, 0.25, 0.17), vec3(0.4, 0.4, 0.42), hash12(vec2(seed, 1.7))) : vec3(0.9);
    if (r.y > 0.0) c += lit * 1.5 * exp(-8.0 * length((h.xz - vec2(size.x * 0.5, depth * 0.5)) / vec2(size.x, depth)));
  } else {
    c = wallC * 0.82;
  }
  // Furniture silhouette near the back: a sofa or a desk.
  if (t == tz && h.y < size.y * 0.3 && abs(h.x / size.x - 0.5) < 0.3 && hash12(vec2(seed, 4.4)) > 0.4) c *= 0.45;
  shade = 1.0 - 0.55 * clamp(h.z / depth, 0.0, 1.0);
  return c * shade;
}
`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec3 N = normalize(vWNormal);
  vec3 base = diffuseColor.rgb;
  float y = vWPos.y;
  int style = int(vStyle + 0.5);
  if (N.y > 0.3) {
    if (vRoof > 0.5) {
      // Terracotta tiles in rows.
      float rows = fract(y * 3.2 + vnoise(vWPos.xz * 2.0) * 0.1);
      vec3 tile = mix(vec3(0.46, 0.17, 0.09), vec3(0.6, 0.26, 0.13), hash12(floor(vWPos.xz * 2.5)));
      diffuseColor.rgb = tile * (0.75 + 0.25 * smoothstep(0.0, 0.25, rows));
      gRough = 0.7;
    } else {
      vec3 t = texture2D(tConcrete, vWPos.xz / 6.0).rgb;
      float n = vnoise(vWPos.xz * 0.2);
      diffuseColor.rgb = mix(vec3(0.2, 0.2, 0.21), vec3(0.13, 0.125, 0.12), n) * (t / 0.62);
      gRough = 0.95;
      gSpecK = 0.25;
    }
  } else {
    float u = vU;
    float localY = y - vBase;
    float h = vTop - vBase;
    vec3 T = normalize(vec3(vTan.x, 0.0, vTan.y));
    vec3 B = vec3(0.0, 1.0, 0.0);
    // View ray in wall space.
    vec3 Vw = normalize(vWPos - cameraPosition);
    vec3 rr = vec3(dot(Vw, T), dot(Vw, B), -dot(Vw, N));
    float fw = max(fwidth(u), fwidth(y)) + 1e-4;
    // Style parameters: floor height, cell width, window box in the cell.
    float fh = 3.4, cw = 3.0; vec4 win = vec4(0.28, 0.72, 0.28, 0.82);
    if (style == 0) { fh = 3.8; cw = 1.6; win = vec4(0.04, 0.96, 0.1, 0.94); }
    else if (style == 1) { fh = 3.5; cw = 3.0; win = vec4(0.3, 0.7, 0.26, 0.8); }
    else if (style == 2) { fh = 4.4; cw = 3.6; win = vec4(0.32, 0.68, 0.24, 0.8); }
    else if (style == 3) { fh = 3.6; cw = 2.0; win = vec4(0.04, 0.96, 0.2, 0.78); }
    else if (style == 4) { fh = 2.8; cw = 3.0; win = vec4(0.2, 0.8, 0.3, 0.88); }
    else if (style == 5) { fh = 3.9; cw = 3.3; win = vec4(0.32, 0.68, 0.22, 0.82); }
    float parapet = localY > h - 0.02 ? 1.0 : 0.0;
    float storefront = (vBase < 0.5 && localY < 4.4 && h > 7.0 && style != 1) ? 1.0 : 0.0;
    float gy = storefront > 0.5 ? localY : localY - (vBase < 0.5 && h > 7.0 ? 4.4 - fh : 0.0);
    vec2 cell = vec2(floor(u / cw), floor(gy / fh));
    vec2 f = vec2(fract(u / cw), fract(gy / fh));
    if (storefront > 0.5) { cell = vec2(floor(u / 6.0), -1.0); f = vec2(fract(u / 6.0), localY / 4.4); win = vec4(0.06, 0.94, 0.06, 0.78); }
    float rs = hash12(cell + vSeed * 0.713);
    // Wall surface from textures, tinted by the building colour.
    vec2 wuv = vec2(u, y);
    vec3 wall; vec3 tn;
    if (style == 1) {
      wall = texture2D(tBrick, wuv / 2.4).rgb * mix(vec3(1.0), base / 0.55, 0.25);
      tn = texture2D(tBrickN, wuv / 2.4).xyz * 2.0 - 1.0;
    } else if (style == 2 || style == 5) {
      wall = base * (texture2D(tPlaster, wuv / 3.0).rgb / 0.72);
      tn = texture2D(tPlasterN, wuv / 3.0).xyz * 2.0 - 1.0;
    } else {
      wall = base * (texture2D(tConcrete, wuv / 4.0).rgb / 0.62);
      tn = texture2D(tConcreteN, wuv / 4.0).xyz * 2.0 - 1.0;
    }
    // Grime: darker near the ground and streaks under windows.
    float grime = mix(0.72, 1.0, smoothstep(0.0, 10.0, y)) * (0.9 + 0.1 * vnoise(vec2(u * 0.3, y * 0.05)));
    wall *= grime;
    vec3 col = wall;
    float rough = 0.88, metal = 0.0;
    vec3 emit = vec3(0.0);
    gTN = tn; gTNk = 0.6;
    // Architectural bands.
    if (style == 2 || style == 5) {
      float cornice = band(localY, h - 1.1, h - 0.2, fw) + (vBase < 0.5 ? band(localY, 4.2, 4.7, fw) : 0.0);
      col = mix(col, base * 1.18 + 0.03, clamp(cornice, 0.0, 1.0));
      float pil = band(f.x, -0.02, 0.05, fw / cw) + band(f.x, 0.95, 1.02, fw / cw);
      col = mix(col, base * 1.08, pil * 0.6);
    }
    if (style == 4) {
      // Prefab panels: joints at every floor and every 3.6 m, balconies on alternate columns.
      float jx = 1.0 - band(fract(u / 3.6), 0.006, 0.994, fw / 3.6);
      float jy = 1.0 - band(f.y, 0.01, 0.99, fw / fh);
      col *= 1.0 - 0.35 * max(jx, jy);
      float balc = step(0.5, fract(cell.x * 0.5 + floor(vSeed) * 0.5)) * step(0.5, hash12(vec2(floor(u / 6.0), vSeed)) + 0.3);
      float rail = band(f.y, 0.0, 0.33, fw / fh) * balc;
      vec3 balcC = mix(base, vec3(0.75, 0.72, 0.62), 0.5) * (0.9 + 0.2 * hash12(cell));
      col = mix(col, balcC, rail);
      win.z = mix(win.z, 0.36, balc);
    }
    float ww = win.y - win.x, wh = win.w - win.z;
    float inWin = band(f.x, win.x, win.y, fw / cw) * band(f.y, win.z, win.w, fw / fh);
    float fade = smoothstep(0.1, 0.5, fw / cw);
    if (style == 0) {
      // Curtain wall: mullions and spandrels in the building colour.
      float span = 1.0 - band(f.y, 0.1, 0.94, fw / fh);
      float mull = 1.0 - band(f.x, 0.04, 0.96, fw / cw);
      inWin = (1.0 - max(span, mull));
      col = mix(base * 0.55, base * 0.35, span);
      rough = 0.4; metal = 0.6;
    }
    if (parapet > 0.5) { inWin = 0.0; col = wall * 0.95; }
    if (inWin > 0.001 && fade < 0.999) {
      vec2 size = vec2(cw * ww, fh * wh);
      if (storefront > 0.5) size = vec2(6.0 * ww, 4.4 * wh);
      vec2 p = vec2((f.x - win.x) / ww, (f.y - win.z) / wh) * size;
      float lit = step(0.72, rs) + storefront * 0.8;
      float shade;
      vec3 inside = room(p, rr, size, style == 0 ? 7.0 : 4.5, rs * 97.0 + vSeed, lit, shade);
      // Blinds or curtains pulled partway down.
      float blinds = step(0.55, hash12(cell + 11.3)) * hash12(cell + 2.9) * 0.8;
      float pf = (f.y - win.z) / wh;
      vec3 blindC = mix(vec3(0.85, 0.82, 0.74), vec3(0.55, 0.6, 0.62), hash12(cell + 5.5));
      if (pf > 1.0 - blinds) inside = blindC * (0.55 + 0.1 * step(0.5, fract(pf * 30.0)));
      float daylight = style == 0 ? 0.12 : 0.14;
      vec3 roomLight = inside * (daylight + lit * 0.9 * vec3(1.0, 0.85, 0.65));
      // Glass: the sky and the street reflected with Fresnel on top of the room.
      vec3 R = reflect(Vw, N);
      float cosv = clamp(dot(-Vw, N), 0.0, 1.0);
      float fres = (style == 0 ? 0.25 : 0.1) + (style == 0 ? 0.75 : 0.9) * pow(1.0 - cosv, 4.0);
      vec3 skyR = mix(vec3(0.62, 0.66, 0.7), vec3(0.3, 0.46, 0.72), clamp(R.y * 1.6, 0.0, 1.0));
      skyR = mix(vec3(0.1, 0.1, 0.11) + 0.05 * hash12(cell + 3.3), skyR, smoothstep(-0.04, 0.14, R.y));
      roomLight = roomLight * (1.0 - fres) + skyR * fres * 1.1;
      // Frame.
      float frame = 1.0 - band((f.x - win.x) / ww, 0.035, 0.965, fw / (cw * ww)) * band(pf, 0.05, 0.95, fw / (fh * wh));
      float glass = inWin * (1.0 - frame) * (1.0 - fade);
      col = mix(col, style == 0 ? base * 0.3 : vec3(0.92), inWin * frame * (1.0 - fade));
      col = mix(col, vec3(0.02), glass);
      emit = mix(emit, roomLight, glass);
      rough = mix(rough, 0.04, glass);
      metal = mix(metal, style == 0 ? 0.55 : 0.1, glass);
      gTNk = mix(gTNk, 0.0, inWin);
    }
    if (fade > 0.001) {
      // Far away: average glass and wall so the pattern does not shimmer.
      float frac = style == 0 ? 0.82 : ww * wh;
      col = mix(col, mix(wall, vec3(0.08, 0.1, 0.12), frac), fade);
      rough = mix(rough, mix(0.9, 0.2, frac), fade);
      metal = mix(metal, style == 0 ? 0.5 : 0.1, fade);
    }
    diffuseColor.rgb = col;
    gRough = rough; gMetal = metal; gEmit = emit;
  }
}`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (gTNk > 0.0) {
  vec3 Nw = normalize(vWNormal);
  vec3 Tw = normalize(vec3(vTan.x, 0.0, vTan.y));
  vec3 pert = normalize(Tw * gTN.x * gTNk + vec3(0.0, 1.0, 0.0) * gTN.y * gTNk + Nw * gTN.z);
  normal = normalize((viewMatrix * vec4(pert, 0.0)).xyz);
}`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= gSpecK;');
  };
  mat.customProgramCacheKey = () => 'osm-building-v1';
  return mat;
}

// Ground surfaces with world-space textures: base ground, sidewalks, roads, plazas, grass.
export function surfaceMaterial(kind, tex) {
  const cfg = {
    ground: { map: tex.concrete, nmap: tex.concreteN, scale: 5, tint: [0.62, 0.61, 0.58], off: 0 },
    sidewalk: { map: tex.pavers, nmap: tex.paversN, scale: 2.2, tint: [0.78, 0.77, 0.75], off: -4 },
    plaza: { map: tex.pavers, nmap: tex.paversN, scale: 2.8, tint: [0.86, 0.8, 0.72], off: -4 },
    road: { map: tex.asphalt, nmap: tex.asphaltN, scale: 4, tint: [0.72, 0.72, 0.74], off: -6 },
    grass: { map: null, nmap: null, scale: 1, tint: [1, 1, 1], off: -2 },
  }[kind];
  const mat = offset(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), cfg.off);
  const uniforms = { tMap: { value: cfg.map }, tNorm: { value: cfg.nmap } };
  // The ground can carry a map of the whole city, shown beyond the streamed chunks.
  if (kind === 'ground') {
    Object.assign(uniforms, { tCity: { value: null }, uCityBox: { value: new THREE.Vector4() }, uCamXZ: { value: new THREE.Vector2() }, uHasCity: { value: 0 } });
    mat.userData.city = uniforms;
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D tMap; uniform sampler2D tNorm; varying vec3 vWPos; vec3 gTN = vec3(0,0,1);\n${kind === 'ground' ? 'uniform sampler2D tCity; uniform vec4 uCityBox; uniform vec2 uCamXZ; uniform float uHasCity;' : ''}\n${COMMON}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  ${
    kind === 'grass'
      ? `vec3 g = mix(vec3(0.16, 0.3, 0.08), vec3(0.3, 0.42, 0.12), vnoise(p * 0.07)) * (0.8 + 0.3 * vnoise(p * 1.9));
  g = mix(g, vec3(0.42, 0.38, 0.2), smoothstep(0.62, 0.8, vnoise(p * 0.03 + 7.0)) * 0.6);
  diffuseColor.rgb = g;`
      : `vec3 t = texture2D(tMap, p / ${cfg.scale.toFixed(1)}).rgb;
  float n = vnoise(p * 0.05);
  diffuseColor.rgb = t * vec3(${cfg.tint.join(',')}) * (0.85 + 0.25 * n);
  gTN = texture2D(tNorm, p / ${cfg.scale.toFixed(1)}).xyz * 2.0 - 1.0;${
    kind === 'ground'
      ? `
  // Open ground between blocks is mostly worn grass and dirt in Bucharest, with paved patches.
  float gp = smoothstep(0.42, 0.62, vnoise(p * 0.011) * 0.75 + vnoise(p * 0.043) * 0.35);
  vec3 turf = mix(vec3(0.13, 0.2, 0.07), vec3(0.24, 0.28, 0.1), vnoise(p * 0.21)) * (0.75 + 0.35 * vnoise(p * 2.3));
  turf = mix(turf, vec3(0.26, 0.21, 0.15), smoothstep(0.55, 0.85, vnoise(p * 0.09 + 3.0)) * 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, turf, gp);
  gTN = mix(gTN, vec3(0.0, 0.0, 1.0), gp);
  if (uHasCity > 0.5) {
    vec2 cuv = (p - uCityBox.xy) / (uCityBox.zw - uCityBox.xy);
    bool outside = cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0;
    vec3 cm = outside ? vec3(0.25, 0.27, 0.12) : texture2D(tCity, cuv).rgb;
    // Plain grey land on the map gets the same turf patches as the near ground, so the seam hides.
    float grey = 1.0 - smoothstep(0.015, 0.05, max(cm.r, max(cm.g, cm.b)) - min(cm.r, min(cm.g, cm.b)));
    vec3 far = mix(cm * (0.9 + 0.2 * n), turf, gp * grey * 0.8);
    float f = smoothstep(1500.0, 1900.0, distance(p, uCamXZ));
    diffuseColor.rgb = mix(diffuseColor.rgb, far, f);
    gTN = mix(gTN, vec3(0.0, 0.0, 1.0), f);
  }`
      : ''
  }`
  }
}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(normalize(vec3(gTN.x * 0.7, gTN.z, -gTN.y * 0.7)), 0.0)).xyz);`
      );
  };
  mat.customProgramCacheKey = () => 'surface-' + kind;
  return mat;
}

export function markingMaterial() {
  const mat = offset(new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 }), -8);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vDist;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDist = uv.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDist;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (fract(vDist / 9.0) > 0.55) discard;');
  };
  mat.customProgramCacheKey = () => 'marking';
  return mat;
}

export function waterMaterial(envMap, tex) {
  tex.water.repeat.set(1, 1);
  const mat = offset(new THREE.MeshStandardMaterial({ color: 0x2a4a44, roughness: 0.06, metalness: 0.1, envMap, envMapIntensity: 0.6 }), -3);
  const time = { value: 0 };
  mat.userData.time = time;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tWater = { value: tex.water };
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWater; uniform float uTime; varying vec3 vWPos;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 p = vWPos.xz;
  vec3 n1 = texture2D(tWater, p / 23.0 + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWater, p / 9.0 - vec2(uTime * 0.02, -uTime * 0.013)).xyz * 2.0 - 1.0;
  vec3 n = normalize(vec3((n1.x + n2.x) * 0.25, 1.0, (n1.y + n2.y) * 0.25));
  normal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
}`
      );
  };
  mat.customProgramCacheKey = () => 'water2';
  return mat;
}

// Leaf texture painted on a canvas: a few hundred small leaves with alpha.
function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 520; i++) {
    const x = 128 + (r() - 0.5) * 230 * Math.sqrt(r()), y = 128 + (r() - 0.5) * 230 * Math.sqrt(r());
    if (Math.hypot(x - 128, y - 128) > 118) continue;
    const l = 30 + r() * 30;
    g.fillStyle = `hsl(${85 + r() * 35}, ${35 + r() * 30}%, ${l}%)`;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.beginPath();
    g.ellipse(0, 0, 4 + r() * 5, 2 + r() * 2.5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function treeMaterials() {
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.17, 1, 6).translate(0, 0.5, 0);
  // Crown: a cluster of crossed leaf cards inside a unit sphere, normals pointing outward
  // so the crown shades like a volume rather than like flat quads.
  const cards = [];
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const q = new THREE.PlaneGeometry(1.25, 1.25);
    const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.8, r() - 0.5).normalize().multiplyScalar(0.45 * Math.cbrt(r()));
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    m.setPosition(dir);
    q.applyMatrix4(m);
    const p = q.attributes.position, n = q.attributes.normal;
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, k).normalize();
      n.setXYZ(k, v.x, v.y, v.z);
    }
    cards.push(q);
  }
  const crownGeo = mergeGeo(cards);
  return {
    trunkGeo,
    crownGeo,
    trunk: new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 1 }),
    crown: new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: 0xffffff }),
  };
}

function mergeGeo(list) {
  let n = 0;
  for (const g of list) n += g.index.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < g.index.count; i++) {
      const k = g.index.getX(i);
      pos.set([P.getX(k), P.getY(k), P.getZ(k)], o * 3);
      nor.set([N.getX(k), N.getY(k), N.getZ(k)], o * 3);
      uv.set([U.getX(k), U.getY(k)], o * 2);
      o++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
