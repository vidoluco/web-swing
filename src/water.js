import * as THREE from 'three';

// Water for the Dambovita, Herastrau and the lakes. The city builds one standard material for all of it
// (materials2.js waterMaterial); here it gets its look: three layers of moving normals that calm down with
// distance, a sky reflection through the environment map, a deeper colour where it looks straight down,
// sparse foam on the wave crests and, in the cartoon style, flat water with white ripple lines.

export function restyleWater(mat, envTexture) {
  const uniforms = {
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uWaterStyle: { value: 0 },
    uWNight: { value: 0 },
    uWGlow: { value: 0 },
  };
  mat.userData.light = uniforms;
  // The normal map the city gave the material: run its shader hook once on a stand-in and take the texture.
  const stand = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  mat.onBeforeCompile(stand);
  const normals = stand.uniforms.tWater.value;
  const time = mat.userData.time;
  mat.color.set(0xffffff);
  mat.roughness = 0.05;
  mat.metalness = 0;
  mat.envMap = envTexture;
  mat.envMapIntensity = 1.35;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.tWater = { value: normals };
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tWater; uniform float uTime; uniform vec3 uDeep, uShallow; uniform float uWaterStyle, uWNight, uWGlow;
varying vec3 vWPos;
float gFoam = 0.0; vec2 gSlope = vec2(0.0);`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  float dist = length(vWPos - cameraPosition);
  vec3 V = normalize(cameraPosition - vWPos);
  float calm = 1.0 - 0.8 * smoothstep(60.0, 900.0, dist);
  vec3 n1 = texture2D(tWater, p / 23.0 + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWater, p / 9.0 - vec2(uTime * 0.02, -uTime * 0.013)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tWater, p / 3.1 + vec2(-uTime * 0.035, uTime * 0.028)).xyz * 2.0 - 1.0;
  gSlope = (n1.xy * 0.5 + n2.xy * 0.55 + n3.xy * 0.4 * (1.0 - smoothstep(30.0, 250.0, dist))) * calm;
  // Waves lie down when we look along the surface, so the reflection stays on the sky and does not dip into the ground.
  gSlope *= mix(0.3, 1.0, smoothstep(0.08, 0.55, V.y));
  if (uWaterStyle > 1.5) gSlope *= 0.4;
  // Deeper where we look down, lighter and greener along grazing views, patchy at a large scale.
  float depthK = clamp(V.y * 1.4, 0.0, 1.0);
  float blotch = texture2D(tWater, p / 140.0).z;
  diffuseColor.rgb = mix(uShallow, uDeep, depthK * (uWaterStyle > 1.5 ? 0.45 : 0.65 + 0.35 * blotch));
  // Foam on the steepest ripples, thin and broken up.
  float crest = smoothstep(0.62, 0.95, length(n2.xy) * 0.9 + length(n3.xy) * 0.6 + blotch * 0.15 - 0.2);
  gFoam = crest * 0.22 * calm * (1.0 - uWaterStyle * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0) * (1.0 - 0.6 * uWNight), gFoam);
  if (uWaterStyle > 0.5) {
    // Stylised water: bright, with white ripple lines that follow the zero crossings of two moving noise fields
    // and keep the same width in pixels (strong in the cartoon style).
    float f1 = texture2D(tWater, p / 21.0 + vec2(uTime * 0.01, uTime * 0.006)).x - 0.5;
    float f2 = texture2D(tWater, p / 8.5 - vec2(uTime * 0.017, -uTime * 0.01)).y - 0.5;
    float l1 = 1.0 - smoothstep(0.7, 1.5, abs(f1) / max(fwidth(f1), 1e-5));
    float l2 = 1.0 - smoothstep(0.7, 1.5, abs(f2) / max(fwidth(f2), 1e-5));
    float ripple = clamp(l1 * 0.9 + l2 * 0.7, 0.0, 1.0) * (uWaterStyle > 1.5 ? 1.0 : 0.3) * (1.0 - 0.7 * uWNight) * (1.0 - smoothstep(200.0, 1500.0, dist));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 1.0), ripple);
    gFoam = max(gFoam, ripple * float(uWaterStyle > 1.5));
  }
}`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uWGlow * (1.0 - uWNight);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.05, 0.3, clamp(gFoam * 2.0, 0.0, 1.0));')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(normalize(vec3(gSlope.x, 1.0, gSlope.y)), 0.0)).xyz);`
      );
  };
  mat.customProgramCacheKey = () => 'water-light-1';
  mat.needsUpdate = true;
  return uniforms;
}
