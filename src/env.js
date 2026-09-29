import * as THREE from 'three';
import { EffectPass, BloomEffect, ToneMappingEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { uniforms } from './uniforms.js';
import { sunAt, moonAt, nightAmount, smooth, wrapHours, parseHours } from './sun.js';
import { SkyDome, setSkyUniforms, atmosphere, makeAtmosphere, profileFor } from './skydome.js';
import { EnvMaps } from './envmap.js';
import { GradeEffect } from './grade.js';
import { restyleWater } from './water.js';
import { LampPools } from './lamps.js';
import { STYLES, STYLE_IDS } from './styles.js';

// The light and the look of the game: the day and night cycle (sun, moon, sky, stars, fog, shadows, image
// based light, uNight for the lamps and windows) and the three style directions. game.env is its hand:
//   hours          the clock, 0 to 24 (17.5 is half past five)
//   style          'a' realistic, 'b' Pixar, 'c' cartoon
//   setTime(h)     jump to an hour, the cycle carries on from there unless it is off
//   setStyle(id)   switch the look, saved under 'style'; cycleStyle() goes to the next (key B)
// URL: ?time=17:30 fixes the hour (add ?cycle=on to let it run from there), ?cycle=off stops the clock,
// ?daymin=N sets the length of a day in real minutes (default 24), ?style=a|b|c.

const START_HOURS = 17.5;
const SUN_INTENSITY = 3.2; // the sun's light at noon, as tuned for the old sky
const MOON_INTENSITY = 1.1;

// The CSM add-on replaces lights_fragment_begin with a copy that predates three r186: it never looks up the
// DFG table (material.dfg) or sets the multi-scattering factor, so every specular term, the sun's glints and the
// reflections of the sky included, came out as zero. The block is put back into the copy. Then that specular
// light gets a rough-surface damping: asphalt, plaster and grass scatter it instead of shining like a mirror
// at grazing angles, while water, glass and paint keep the whole reflection.
function repairLightChunks() {
  const { ShaderChunk } = THREE;
  const begin = ShaderChunk.lights_fragment_begin;
  if (!begin.includes('material.dfg') && begin.includes('IncidentLight directLight;')) {
    ShaderChunk.lights_fragment_begin = begin.replace(
      'IncidentLight directLight;',
      `#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;`
    );
  }
  const end = ShaderChunk.lights_fragment_end;
  if (!end.includes('rough-damp')) {
    ShaderChunk.lights_fragment_end = end.replace(
      'RE_IndirectSpecular( radiance,',
      `#ifdef STANDARD
	radiance *= mix( 1.0, 0.3, smoothstep( 0.55, 0.95, material.roughness ) ); // rough-damp
	#endif
	RE_IndirectSpecular( radiance,`
    );
  }
  return ShaderChunk.lights_fragment_begin.includes('material.dfg') && ShaderChunk.lights_fragment_end.includes('rough-damp');
}

export function create(game) {
  const specularRepaired = repairLightChunks();
  const { scene, camera, renderer, params, save } = game;
  const gfx = game.gfx;
  const profile = profileFor(game.cityId);
  const dayMinutes = +params.get('daymin') || 24;
  const hoursPerSecond = 24 / (dayMinutes * 60);

  // ---- the clock ----
  const fixedByUrl = params.has('time');
  let hours = parseHours(params.get('time')) ?? START_HOURS;
  let running = params.get('cycle') === 'off' ? false : params.get('cycle') === 'on' || !fixedByUrl;

  // ---- the style: URL first, then what was saved, then A ----
  const pick = (id) => (STYLES[id] ? id : null);
  let styleId = pick(params.get('style')) || pick(save.get('style')) || 'a';
  if (params.has('style') && pick(params.get('style'))) save.set('style', styleId);
  let st = STYLES[styleId];

  const sunV = { x: 0, y: 1, z: 0, elev: 90 };
  const moonV = { x: 0, y: -1, z: 0, elev: -90 };
  const atm = makeAtmosphere();
  let night = 0;
  let phase = null;
  let dirty = true;
  let lastApplied = -1;

  const sky = new SkyDome();
  const envMaps = new EnvMaps(renderer);
  const grade = new GradeEffect(camera);
  let bloom = null, bloomPass = null, gradePass = null, n8 = null;
  let waterU = null;
  let ui = null;
  let lamps = null;
  let lampT = 0;
  let offKey = null;
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const baseHemi = hemi ? { intensity: hemi.intensity } : null;
  const _c = new THREE.Color();
  const _dir = new THREE.Vector3();
  let sunDirChanged = true;

  // Palette for a sun elevation in this city, in the neutral style: the environment maps are shared by the three looks.
  const atmFor = (elev) => atmosphere(elev, profile, 'a', makeAtmosphere());
  const moonFor = () => moonV;

  function applyStyle() {
    const g = grade;
    g.set('uStyle', st.idx);
    g.set('uAces', st.aces);
    g.set('uSat', st.sat);
    g.set('uContrast', st.contrast);
    g.set('uLift', st.lift);
    g.set('uGain', st.gain);
    g.set('uVig', st.vig);
    g.set('uDither', st.dither);
    g.set('uBands', st.bands);
    g.set('uRimK', st.rim * 0.55);
    if (bloomPass) {
      bloomPass.enabled = !!st.bloom;
      if (st.bloom) {
        bloom.intensity = st.bloom.intensity;
        bloom.luminanceMaterial.threshold = st.bloom.threshold;
        bloom.mipmapBlurPass.radius = st.bloom.radius;
      }
    }
    if (n8) {
      n8.configuration.intensity = st.ao[0];
      n8.configuration.aoRadius = st.ao[1];
    }
    for (const l of gfx.csm.lights) l.shadow.radius = st.shadow;
    if (waterU) {
      waterU.uWaterStyle.value = st.water;
      waterU.uWGlow.value = st.waterGlow;
      waterU.uDeep.value.set(st.deep);
      waterU.uShallow.value.set(st.shallow);
    }
    dirty = true;
  }

  // Sun, moon, sky, fog, lights and post settings for the current hour.
  function applyTime() {
    sunAt(hours, profile.lat, sunV);
    moonAt(hours, profile.lat, moonV);
    atmosphere(sunV.elev, profile, styleId, atm);
    night = nightAmount(sunV.elev);
    uniforms.uNight.value = night;

    setSkyUniforms(sky.material, atm, sunV, moonV, night, st.idx, game.time);

    // One shadow-casting light: the sun by day, the moon by night, each faded to nothing before they hand over.
    const csm = gfx.csm;
    const useSun = sunV.elev > -4.5;
    let intensity, color, dirSrc;
    if (useSun) {
      intensity = SUN_INTENSITY * atm.sunK * st.sunK * smooth(-4.5, -1, sunV.elev);
      color = atm.sun;
      dirSrc = sunV;
    } else {
      intensity = MOON_INTENSITY * smooth(-4.5, -8.5, sunV.elev) * smooth(-3, 12, moonV.elev);
      color = _c.set('#9db2ff');
      dirSrc = moonV;
    }
    // Keep the shadow direction off the horizon: long shadows, not endless ones.
    _dir.set(dirSrc.x, Math.max(dirSrc.y, Math.sin((6 * Math.PI) / 180)), dirSrc.z);
    const flat = Math.hypot(dirSrc.x, dirSrc.z) || 1;
    const k = Math.sqrt(Math.max(1 - _dir.y * _dir.y, 0)) / flat;
    _dir.x = dirSrc.x * k;
    _dir.z = dirSrc.z * k;
    csm.lightDirection.copy(_dir).negate().normalize();
    for (const l of csm.lights) {
      l.intensity = intensity;
      l.color.copy(color);
    }

    if (hemi) {
      hemi.color.copy(atm.hs);
      hemi.groundColor.copy(atm.hg);
      hemi.intensity = atm.hK * 0.9 * st.hemiK;
    }

    // Image based light: blend the baked maps for this sun height and turn them toward the sun.
    envMaps.blend(sunV.elev);
    scene.environmentIntensity = 1.5 * atm.envK * st.envK * (0.35 + 0.65 * Math.min(1, atm.sunK + 0.3)) * (night > 0.5 ? 0.6 + 0.4 * (1 - night) : 1);
    scene.environmentRotation.y = Math.atan2(sunV.x, sunV.z);
    if (waterU) {
      waterU.uWNight.value = night;
      const m = game.city?.mats?.water;
      if (m) {
        m.envMapRotation.y = scene.environmentRotation.y;
        m.envMapIntensity = 1.35 * st.waterEnv * (0.3 + 0.7 * Math.min(1, atm.sunK + 0.45));
      }
    }

    // Fog follows the horizon colour so far things melt into the sky.
    const fog = scene.fog;
    if (fog) {
      fog.color.copy(atm.fog);
      fog.near = profile.fogNear;
      fog.far = profile.fogFar;
    }

    // Grade and haze.
    grade.set('uExposure', atm.ex * st.exposure);
    grade.set('uNight', night);
    const lk = night * st.lamp;
    grade.set('uLampCol', [1.0 * lk, 0.6 * lk, 0.28 * lk]);
    grade.set('uHaze', 1.6e-4 * profile.haze * st.haze);
    grade.set('uHazeK', 1 / profile.hazeScale);
    grade.set('uHazeCol', [atm.fog.r, atm.fog.g, atm.fog.b]);
    _c.copy(atm.glow).multiplyScalar(1.2);
    grade.set('uHazeSunCol', [_c.r, _c.g, _c.b]);
    grade.set('uHazeSunK', st.hazeSun * Math.min(1, atm.glowK + 0.2));
    grade.set('uSunDirW', [sunV.x, sunV.y, sunV.z]);
    _c.copy(atm.glow).lerp(_dirWhite, 0.35);
    grade.set('uRimCol', [_c.r * 0.55, _c.g * 0.5, _c.b * 0.45]);

    // The day and night voice lines, only when the clock runs into them by itself.
    const next = night > 0.7 ? 'night' : night < 0.3 ? 'day' : phase;
    if (next !== phase) {
      if (phase !== null && running) game.voice?.say(next === 'night' ? 'night' : 'morning');
      phase = next;
    }
    lastApplied = hours;
    dirty = false;
  }
  const _dirWhite = new THREE.Color(1, 1, 1);

  function setStyle(id) {
    if (!STYLES[id] || id === styleId) return;
    styleId = id;
    st = STYLES[id];
    save.set('style', id);
    applyStyle();
    applyTime();
    ui?.sync();
    game.hud?.toast(`Stile ${id.toUpperCase()}: ${st.label}`);
  }

  function buildUi() {
    const ov = document.getElementById('overlay');
    if (!ov) return null;
    if (!document.getElementById('style-pick-css')) {
      const css = document.createElement('style');
      css.id = 'style-pick-css';
      css.textContent = `
#style-pick { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; font-size: 15px; }
#style-pick > span { opacity: 0.8; margin-right: 4px; }
#style-pick button { font: inherit; font-weight: 800; color: #fff; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.4); border-radius: 999px; padding: 8px 16px; cursor: pointer; }
#style-pick button[aria-pressed="true"] { background: var(--accent, #e23636); border-color: transparent; }
#style-pick button:hover, #style-pick button:focus-visible { filter: brightness(1.2); outline: none; }`;
      document.head.append(css);
    }
    const row = document.createElement('div');
    row.id = 'style-pick';
    const label = document.createElement('span');
    label.textContent = 'Stile (tasto B)';
    row.append(label);
    const btns = {};
    for (const id of STYLE_IDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${id.toUpperCase()} · ${STYLES[id].label}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        setStyle(id);
      });
      btns[id] = b;
      row.append(b);
    }
    ov.insertBefore(row, ov.querySelector('.credit') || null);
    const sync = () => {
      for (const id of STYLE_IDS) btns[id].setAttribute('aria-pressed', String(id === styleId));
    };
    sync();
    return { row, sync };
  }

  game.env = {
    get hours() {
      return hours;
    },
    get style() {
      return styleId;
    },
    get night() {
      return uniforms.uNight.value;
    },
    get running() {
      return running;
    },
    set running(v) {
      running = !!v;
    },
    styles: STYLES,
    maps: envMaps,
    specularRepaired,
    setTime(h) {
      hours = wrapHours(h);
      phase = null;
      dirty = true;
      applyTime();
    },
    setStyle,
    cycleStyle() {
      setStyle(STYLE_IDS[(STYLE_IDS.indexOf(styleId) + 1) % STYLE_IDS.length]);
    },
    // Resolves once the Poly Haven skies are in and the environment maps are baked with them.
    ready: null,
  };

  return {
    name: 'env',

    init() {
      // The old sky and its light stay in main.js but are not drawn; the dome here replaces them.
      if (gfx.sky) gfx.sky.visible = false;
      scene.add(sky.mesh);

      // Post chain: our grade replaces the tone mapping pass, with bloom in front of it.
      const comp = gfx.composer;
      n8 = comp.passes.find((p) => p instanceof N8AOPostPass) || null;
      const at = comp.passes.findIndex((p) => p.effects?.some((e) => e instanceof ToneMappingEffect));
      if (at >= 0) {
        const old = comp.passes[at];
        comp.removePass(old);
        old.dispose();
      }
      const index = at >= 0 ? at : comp.passes.length - 2;
      bloom = new BloomEffect({ intensity: 0.4, luminanceThreshold: 2.4, luminanceSmoothing: 0.4, mipmapBlur: true, radius: 0.72 });
      bloomPass = new EffectPass(camera, bloom);
      gradePass = new EffectPass(camera, grade);
      comp.addPass(bloomPass, index);
      comp.addPass(gradePass, index + 1);

      // Environment maps: procedural now, with the real skies mixed in as soon as they have loaded.
      sunAt(hours, profile.lat, sunV);
      moonAt(hours, profile.lat, moonV);
      envMaps.bake(atmFor, moonFor);
      scene.environment = envMaps.texture;
      game.env.ready = envMaps.loadHdris().then(() => {
        envMaps.bake(atmFor, moonFor);
        dirty = true;
      });

      const water = game.city?.mats?.water;
      if (water) waterU = restyleWater(water, envMaps.texture);

      ui = buildUi();
      const onKey = (e) => {
        if (e.code === 'KeyB' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) game.env.cycleStyle();
      };
      addEventListener('keydown', onKey);
      offKey = () => removeEventListener('keydown', onKey);

      lamps = new LampPools(game.city);
      applyStyle();
      applyTime();
    },

    update(dt) {
      if (running) {
        hours = wrapHours(hours + dt * hoursPerSecond);
        if (Math.abs(hours - lastApplied) > 0.004 || hours < lastApplied) dirty = true;
      }
      if (dirty) applyTime();
      sky.material.uniforms.uTime.value = game.time;
      // Street light pools: pick the nearest lamps four times a second, only while it is dark.
      if (night > 0.05) {
        if ((lampT -= dt) <= 0) {
          lampT = 0.25;
          const n = lamps.update(camera.position.x, camera.position.z);
          const arr = grade.uniforms.get('uLamp').value;
          for (let i = 0; i < n; i++) arr[i].set(lamps.data[i][0], lamps.data[i][1], lamps.data[i][2], 0);
          grade.set('uLampN', n);
        }
      } else if (lampT !== 0) {
        lampT = 0;
        grade.set('uLampN', 0);
      }
    },

    dispose() {
      offKey?.();
      ui?.row.remove();
      scene.remove(sky.mesh);
      sky.dispose();
      envMaps.dispose();
    },
  };
}
