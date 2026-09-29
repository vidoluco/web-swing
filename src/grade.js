import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

// The last look of the picture, one shader for the three styles: aerial haze from the depth buffer, tone
// mapping and grading, and for the cartoon style the flat light bands and the ink outlines. The style is a
// uniform, so switching costs nothing and the branches that are off cost nothing either.

const FRAG = /* glsl */ `
uniform float uAces, uStyle, uExposure, uSat, uContrast, uVig, uDither, uNight;
uniform vec3 uLift, uGain;
uniform float uHaze, uHazeK, uHazeSunK;
uniform vec3 uHazeCol, uHazeSunCol, uSunDirW, uCamPos;
uniform mat4 uInvProj, uCamWorld;
uniform float uBands, uInkW, uInkDepth, uInkColorK, uInkStrength;
uniform vec3 uInk, uRimCol;
uniform vec2 uRimDir;
uniform float uRimK;
uniform vec4 uLamp[16];
uniform float uLampN;
uniform vec3 uLampCol;
uniform float uGlare;
uniform vec3 uGlareCol;

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);

vec3 aces(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(OUT * (a / b), 0.0, 1.0);
}

// Khronos PBR Neutral: keeps the colours the palette asked for, compresses only the highlights.
vec3 neutral(vec3 color) {
  const float start = 0.76, desat = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < start) return color;
  const float d = 1.0 - start;
  float newPeak = 1.0 - d * d / (peak + d - start);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
  return mix(color, newPeak * vec3(1.0), g);
}

float linZ(vec2 p) {
  float d = readDepth(p);
  return d >= 0.999999 ? 1.0e5 : -getViewZ(d);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Haze at this pixel, applied to any colour by look().
float gT = 1.0;
vec3 gHaze = vec3(0.0);
vec3 gLamp = vec3(0.0);

// Haze, exposure, tone mapping and colour grade of one linear colour.
vec3 look(vec3 col) {
  col += gLamp * (0.05 + 0.5 * dot(col, LW));
  col = col * gT + gHaze * (1.0 - gT);
  col *= uExposure;
  vec3 c = mix(neutral(col), aces(col), uAces);
  if (uStyle > 0.5 && uStyle < 1.5) c = pow(c, vec3(0.93));
  float l = dot(c, LW);
  c = mix(vec3(l), c, uSat);
  c = (c - 0.18) * uContrast + 0.18;
  c = c * uGain + uLift * (1.0 - c);
  return max(c, 0.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float z0 = depth >= 0.999999 ? 1.0e5 : -getViewZ(depth);

  if (depth < 0.999999 && (uHaze > 0.0 || uLampN > 0.5)) {
    vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 vdir = vp.xyz / vp.w;
    float dist = z0 * length(vdir) / -vdir.z;
    vec3 rd = normalize((uCamWorld * vec4(vdir, 0.0)).xyz);

    // Aerial perspective: height fog integrated along the view ray, tinted toward the sun on its side.
    if (uHaze > 0.0) {
      float k = uHazeK;
      float dy = clamp(k * rd.y * dist, -8.0, 8.0);
      float ray = abs(rd.y) > 1e-4 ? (1.0 - exp(-dy)) / (k * rd.y) : dist;
      float f = uHaze * exp(-k * max(uCamPos.y, 0.0)) * ray;
      gT = exp(-f);
      float sunAmt = pow(max(dot(rd, uSunDirW), 0.0), 4.0);
      gHaze = mix(uHazeCol, uHazeSunCol, sunAmt * uHazeSunK);
    }

    // Street lamps at night: a warm pool around each of the nearest, strongest on the ground below it.
    if (uLampN > 0.5 && dist < 160.0) {
      vec3 wp = uCamPos + rd * dist;
      for (int i = 0; i < 16; i++) {
        if (float(i) >= uLampN) break;
        vec3 dl = wp - uLamp[i].xyz;
        float r2 = dot(dl, dl);
        float fall = 1.0 / (1.0 + r2 * 0.02) * (1.0 - smoothstep(16.0, 30.0, sqrt(r2)));
        fall *= smoothstep(6.0, 0.0, wp.y - uLamp[i].y);
        gLamp += uLampCol * fall;
      }
    }
  }
  vec3 c = look(inputColor.rgb);

  if (uGlare > 0.0) {
    // Sun in the eyes: a veil of glare around the sun, over sky and buildings alike.
    vec4 gp = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 gd = normalize((uCamWorld * vec4(gp.xyz / gp.w, 0.0)).xyz);
    float gc = max(dot(gd, uSunDirW), 0.0);
    c += uGlareCol * uGlare * (0.5 * pow(gc, 24.0) + 0.5 * pow(gc, 400.0));
  }

  if (uRimK > 0.0 && z0 < 9.0e4) {
    // Rim light: the edge of a shape that faces the light, where the ground behind it is much farther away.
    vec2 rd2 = uRimDir * texelSize;
    float zA = linZ(uv + rd2 * 2.5), zB = linZ(uv + rd2 * 6.0);
    float open = max(smoothstep(0.015, 0.09, (zA - z0) / z0), smoothstep(0.03, 0.14, (zB - z0) / z0) * 0.6);
    c += uRimCol * open * uRimK * (1.0 - smoothstep(150.0, 1200.0, z0));
  }

  if (uStyle > 1.5) {
    // Flat light bands that keep the hue. The colour is first smoothed with a wide blur that stops at depth
    // edges, so texture grain melts into flat areas and does not flicker between bands.
    const vec2 OFF[8] = vec2[8](vec2(3.0, 0.0), vec2(-3.0, 0.0), vec2(0.0, 3.0), vec2(0.0, -3.0), vec2(6.0, 6.0), vec2(-6.0, 6.0), vec2(6.0, -6.0), vec2(-6.0, -6.0));
    vec3 acc = inputColor.rgb;
    float wsum = 1.0;
    for (int i = 0; i < 8; i++) {
      vec2 q = uv + OFF[i] * texelSize;
      float w = exp(-abs(linZ(q) - z0) / (0.14 * z0 + 0.6));
      acc += texture2D(inputBuffer, q).rgb * w;
      wsum += w;
    }
    c = mix(c, look(acc / wsum), 0.8);
    float L = dot(c, LW);
    float x = L * uBands;
    float fr = fract(x);
    float w = fwidth(x) * 1.5 + 0.05;
    float Lq = (floor(x) + smoothstep(0.5 - w, 0.5 + w, fr)) / uBands;
    Lq = mix(mix(0.1, 0.03, uNight), 1.0, Lq); // the darkest band is a shadow colour, not black
    c *= (Lq + 0.03) / (L + 0.03);
    float l2 = dot(c, LW);
    c = mix(vec3(l2), c, 1.25);
    c = clamp(c, 0.0, 1.0);

    // Ink: depth discontinuities (second difference, so slanted walls stay clean) and strong colour steps.
    vec2 px = texelSize * uInkW;
    float z1 = linZ(uv + vec2(px.x, 0.0)), z2 = linZ(uv - vec2(px.x, 0.0));
    float z3 = linZ(uv + vec2(0.0, px.y)), z4 = linZ(uv - vec2(0.0, px.y));
    float lap = abs(z1 + z2 - 2.0 * z0) + abs(z3 + z4 - 2.0 * z0);
    float edge = smoothstep(uInkDepth * z0, uInkDepth * z0 * 2.5, lap);
    float near = 1.0 - smoothstep(180.0, 900.0, z0);
    vec2 cx = vec2(px.x, 0.0), cy = vec2(0.0, px.y);
    float g1 = log2(1.0 + dot(texture2D(inputBuffer, uv + cx).rgb, LW)), g2 = log2(1.0 + dot(texture2D(inputBuffer, uv - cx).rgb, LW));
    float g3 = log2(1.0 + dot(texture2D(inputBuffer, uv + cy).rgb, LW)), g4 = log2(1.0 + dot(texture2D(inputBuffer, uv - cy).rgb, LW));
    float ce = smoothstep(0.55, 1.0, abs(g1 - g2) + abs(g3 - g4)) * uInkColorK * near;
    float ink = clamp(max(edge * mix(0.55, 1.0, near), ce), 0.0, 1.0) * uInkStrength;
    c = mix(c, uInk, ink);
  }

  c *= 1.0 - uVig * dot(uv - 0.5, uv - 0.5) * 1.7;
  c += (hash12(uv * resolution + fract(time) * 61.0) - 0.5) * uDither * (0.05 + c);
  outputColor = vec4(c, inputColor.a);
}`;

const _v = new THREE.Vector3();

export class GradeEffect extends Effect {
  constructor(camera) {
    const V = THREE.Vector3, M = THREE.Matrix4;
    super('GradeEffect', FRAG, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uStyle', new THREE.Uniform(0)], ['uAces', new THREE.Uniform(0.5)], ['uExposure', new THREE.Uniform(1)], ['uSat', new THREE.Uniform(1)],
        ['uContrast', new THREE.Uniform(1)], ['uVig', new THREE.Uniform(0.3)], ['uDither', new THREE.Uniform(0.01)],
        ['uNight', new THREE.Uniform(0)],
        ['uLift', new THREE.Uniform(new V(0, 0, 0))], ['uGain', new THREE.Uniform(new V(1, 1, 1))],
        ['uHaze', new THREE.Uniform(0)], ['uHazeK', new THREE.Uniform(1 / 400)], ['uHazeSunK', new THREE.Uniform(0.4)],
        ['uHazeCol', new THREE.Uniform(new V(0.6, 0.7, 0.8))], ['uHazeSunCol', new THREE.Uniform(new V(1, 0.8, 0.6))],
        ['uSunDirW', new THREE.Uniform(new V(0, 1, 0))], ['uCamPos', new THREE.Uniform(new V())],
        ['uInvProj', new THREE.Uniform(new M())], ['uCamWorld', new THREE.Uniform(new M())],
        ['uBands', new THREE.Uniform(4)], ['uInkW', new THREE.Uniform(1.3)], ['uInkDepth', new THREE.Uniform(0.035)],
        ['uInkColorK', new THREE.Uniform(0.3)], ['uRimK', new THREE.Uniform(0)], ['uGlare', new THREE.Uniform(0)], ['uGlareCol', new THREE.Uniform(new V(1, 0.8, 0.55))], ['uLamp', new THREE.Uniform(Array.from({ length: 16 }, () => new THREE.Vector4()))], ['uLampN', new THREE.Uniform(0)], ['uLampCol', new THREE.Uniform(new V(1.0, 0.6, 0.28))], ['uRimDir', new THREE.Uniform(new THREE.Vector2(0.6, 0.8))], ['uRimCol', new THREE.Uniform(new V(1, 0.8, 0.6))], ['uInkStrength', new THREE.Uniform(0.92)], ['uInk', new THREE.Uniform(new V(0.06, 0.05, 0.1))],
      ]),
    });
    this.camera = camera;
  }

  set(name, v) {
    const u = this.uniforms.get(name);
    if (u.value?.isVector3 || u.value?.isColor) u.value.set(v[0], v[1], v[2]);
    else u.value = v;
  }

  update() {
    const cam = this.camera;
    this.uniforms.get('uInvProj').value.copy(cam.projectionMatrixInverse);
    this.uniforms.get('uCamWorld').value.copy(cam.matrixWorld);
    this.uniforms.get('uCamPos').value.setFromMatrixPosition(cam.matrixWorld);
    // Screen direction of the light, for the rim: toward the sun when it is ahead, else from the upper right.
    const sv = _v.copy(this.uniforms.get('uSunDirW').value).transformDirection(cam.matrixWorldInverse);
    const dir = this.uniforms.get('uRimDir').value;
    if (sv.z < 0 && Math.hypot(sv.x, sv.y) > 0.05) dir.set(sv.x, sv.y).normalize();
    else dir.set(0.6, 0.8);
  }
}
