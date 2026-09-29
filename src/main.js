import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { OsmCity, pointInPrism2D, closestOnPrism } from './osmcity.js';
import { loadTextures } from './materials2.js';
import { XbotHero } from './hero2.js';
import { Hero } from './hero.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Minimap } from './minimap.js';
import { Sfx } from './audio.js';
import { Traffic } from './traffic.js';
import { Drinks, Drunk, DrunkEffect, Voice } from './drinks.js';
import { clamp, mulberry32 } from './config.js';
import { CITIES } from './cities.js';
import { Events } from './events.js';
import { Save } from './save.js';
import { Hud } from './hud.js';
import { Systems } from './systems.js';
import { showMapSelect, mapSelectQuery } from './mapselect.js';
import { Actors } from './actors.js'; // actors:

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const SHOT = params.get('shot');
const LOWQ = params.has('lowq');
const save = new Save();
// A plain start shows the map selection, and choosing a card reloads with ?city=. Demo and shot links skip it.
if (!params.has('city') && !DEMO && !SHOT) {
  showMapSelect(save, params);
  await new Promise(() => {});
}
const cityId = params.get('city') || 'bucharest';
const cfg = CITIES[cityId];
const TUNE = {
  exp: +(params.get('exp') || 1.0),
  tm: params.get('tm') || 'aces',
  sun: +(params.get('sun') || 3.2),
  env: +(params.get('env') || 0.3),
  fogNear: +(params.get('fogn') || 1200),
  fogFar: +(params.get('fogf') || 6500),
};

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const setLoading = (t) => ($('loading-text').textContent = t);
// Stops on a message, with a way back to the map selection.
async function stopWith(msg) {
  setLoading(msg);
  const back = document.createElement('a');
  back.className = 'btn';
  back.href = mapSelectQuery(params);
  back.textContent = 'Cambia mappa';
  $('loading').append(back);
  await new Promise(() => {});
}
if (!cfg) await stopWith(`Mappa sconosciuta: ${cityId}`);

// ---------- renderer, sky, light ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOWQ ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMappingExposure = TUNE.exp;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb9c7d3, TUNE.fogNear, TUNE.fogFar);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.3, 30000);

// Late September afternoon in Bucharest: sun in the south-west, about 35 degrees up.
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 35), THREE.MathUtils.degToRad(-35));
const sky = new Sky();
sky.scale.setScalar(20000);
const su = sky.material.uniforms;
su.turbidity.value = 3.5;
su.rayleigh.value = 1.2;
su.mieCoefficient.value = 0.004;
su.mieDirectionalG.value = 0.82;
su.sunPosition.value.copy(sunDir);
if (su.cloudCoverage) {
  su.cloudCoverage.value = 0.38;
  su.cloudDensity.value = 0.4;
}
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
if (su.showSunDisc) su.showSunDisc.value = 0;
envScene.add(sky);
const envGround = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5b5d5f }));
envGround.position.y = -60;
envScene.add(envGround);
const envMap = pmrem.fromScene(envScene, 0.02, 0.1, 40000).texture;
envScene.remove(sky);
if (su.showSunDisc) su.showSunDisc.value = 1;
scene.add(sky);
scene.environment = envMap;
scene.environmentIntensity = TUNE.env;
scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x6a655a, 0.25));

const csm = new CSM({
  maxFar: LOWQ ? 500 : 1100,
  cascades: LOWQ ? 2 : 4,
  mode: 'practical',
  parent: scene,
  shadowMapSize: LOWQ ? 1024 : 2048,
  lightDirection: sunDir.clone().negate(),
  lightIntensity: TUNE.sun,
  lightColor: new THREE.Color(0xfff0da),
  camera,
});
csm.fade = true;
for (const l of csm.lights) {
  l.shadow.bias = -0.0002;
  l.shadow.normalBias = 0.4;
}
const csmDone = new WeakSet();
function withCSM(mat) {
  if (!mat || csmDone.has(mat) || mat.isShaderMaterial || mat.isMeshBasicMaterial) return;
  csmDone.add(mat);
  const prev = mat.onBeforeCompile;
  csm.setupMaterial(mat);
  const csmCb = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(mat, s, r);
    csmCb.call(mat, s, r);
  };
}

// ---------- post-processing ----------
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
if (!LOWQ) {
  const n8 = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
  n8.configuration.aoRadius = 2.5;
  n8.configuration.distanceFalloff = 1.2;
  n8.configuration.intensity = 2.2;
  n8.configuration.halfRes = true;
  n8.configuration.gammaCorrection = false;
  composer.addPass(n8);
}
const bloomOn = params.has('bloom');
composer.addPass(
  new EffectPass(
    camera,
    ...(bloomOn ? [new BloomEffect({ intensity: +params.get('bloom') || 0.3, luminanceThreshold: 4, luminanceSmoothing: 0.3, mipmapBlur: true })] : []),
    new ToneMappingEffect({ mode: { aces: ToneMappingMode.ACES_FILMIC, agx: ToneMappingMode.AGX, neutral: ToneMappingMode.NEUTRAL }[TUNE.tm] }),
    new VignetteEffect({ darkness: 0.38, offset: 0.3 })
  )
);
const drunkFx = new DrunkEffect();
composer.addPass(new EffectPass(camera, drunkFx));
composer.addPass(new EffectPass(camera, new SMAAEffect()));

// ---------- world ----------
setLoading('Carico le texture…');
const textures = loadTextures('textures');
setLoading(`Ricostruisco ${cfg.label}…`);
const city = await OsmCity.load(`city/${cityId}`, scene, envMap, textures, (p) => setLoading(`Ricostruisco ${cfg.label}… ${Math.round(p * 100)}%`), cfg.spawnFacing).catch(async (e) => {
  console.error(e);
  await stopWith(`Mappa non disponibile: ${cfg.label}`);
});
save.set('city', cityId);
document.title = `Web Swing · ${cfg.label}`;
setLoading('Carico il personaggio…');
let hero;
try {
  hero = await XbotHero.load('models/Xbot.glb');
} catch (e) {
  console.warn('Xbot failed, using the primitive hero', e);
  hero = new Hero();
}
scene.add(hero.root);
setLoading('Metto le macchine in strada…');
const traffic = await Traffic.load('models/cars', scene, city);
if (LOWQ) traffic.max = 24;
if (params.has('cars')) traffic.max = +params.get('cars');
const drinks = new Drinks(scene, city);
const drunk = new Drunk();
const voice = new Voice($('say'));
const actors = await Actors.load('models/Xbot.glb', scene, city, { onMaterial: withCSM, max: LOWQ ? 60 : 120 }); // actors:
for (const m of Object.values(traffic.models)) m.holder.traverse((o) => o.isMesh && withCSM(o.material));
for (const m of Object.values(drinks.models)) m.traverse((o) => o.isMesh && withCSM(o.material));
const player = new Player(city);
const input = new Input(canvas);
const rig = new CameraRig(camera, city);
rig.yaw = city.spawnYaw || 0;
const minimap = new Minimap(city, $('minimap'), $('compass'));
const sfx = new Sfx();
const events = new Events();
const hud = new Hud({ panels: $('hud-panels'), toast: $('toast'), objective: $('objective') });
const rng = mulberry32(+params.get('seed') || 20260929);

const webMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4, transparent: true });
const web = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0), webMat);
web.frustumCulled = false;
scene.add(web);

scene.traverse((o) => {
  if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(withCSM);
});
city.onChunkMesh = (g) => g.traverse((o) => o.isMesh && withCSM(o.material));

// ---------- cars ----------
let driving = null;
let crashSaid = 0, wastedSaid = 0;
const carProxy = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), mode: 'drive', poseName: () => 'drive' };
function enterCar(c) {
  traffic.steal(c);
  events.emit('car:stolen', { car: c });
  driving = c;
  player.mode = 'drive';
  player.wall = player.zip = null;
  player.webFade = 0;
  hero.root.visible = false;
  sfx.play('door');
  const kind = drunk.amount > 0.35 ? 'stealdrunk' : c.type === 'taxi' && Math.random() < 0.6 ? 'stealtaxi' : c.type === 'police' ? 'stealpolice' : 'steal';
  voice.say(kind, drunk.amount);
}
// Out through the driver's door (left), or with a leap onto the roof and into the air.
function exitCar(leap) {
  const c = driving;
  if (!c) return;
  driving = null;
  const lx = Math.cos(c.yaw), lz = -Math.sin(c.yaw);
  player.groundBox = null;
  if (leap) {
    player.mode = 'air';
    player.pos.set(c.x, c.h + 0.4, c.z);
    player.vel.set(c.vx, 11, c.vz);
  } else {
    player.mode = 'ground';
    player.pos.set(c.x + lx * (c.wid / 2 + 0.7), 0, c.z + lz * (c.wid / 2 + 0.7));
    player.vel.set(0, 0, 0);
  }
  player.facing.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
  traffic.leave(c);
  hero.root.visible = true;
  sfx.play('door');
}
function dropCar() {
  if (!driving) return;
  traffic.leave(driving);
  driving = null;
  hero.root.visible = true;
}

// ---------- presets and autopilot ----------
function placeOnRoof(box, pos, yaw) {
  player.reset();
  player.pos.copy(pos);
  player.groundBox = box;
  player.facing.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  rig.yaw = yaw;
}

// Places across the city on the number keys (cities.js), positions taken from the OSM data.
let travelling = false;
async function goTo(i) {
  if (!cfg.spots[i]) return;
  const [name, x, z] = cfg.spots[i];
  dropCar();
  travelling = true;
  hud.toast(name + '…');
  city.focus = { x, z };
  await city.streamAround(x, z, 900);
  const r = city.roofNear(x, z, 500);
  if (r) placeOnRoof(r.box, r.pos, r.yaw);
  else {
    player.reset();
    player.pos.set(x, 0, z);
    player.groundBox = null;
  }
  player.idleTime = 2;
  rig.pitch = -0.2;
  rig.dist = 6.5;
  city.focus = null;
  travelling = false;
  hud.toast(name);
}

const WAYPOINTS = cfg.waypoints.length ? cfg.waypoints : [[0, 0]];
let pilot = null;
function startDemo() {
  applyShot('perch');
  pilot = { t: 0, fired: {}, wp: 0 };
}
function pilotState(dt) {
  const P = pilot;
  P.t += dt;
  const p = player.pos;
  let [tx, tz] = WAYPOINTS[P.wp];
  const dist = Math.hypot(tx - p.x, tz - p.z);
  // Next waypoint when close, or when 6 s went by without getting 15 m nearer.
  if (P.best === undefined || dist < P.best - 15) (P.best = dist), (P.bestT = P.t);
  if (dist < 120 || P.t - P.bestT > 6) {
    P.wp = (P.wp + 1) % WAYPOINTS.length;
    [tx, tz] = WAYPOINTS[P.wp];
    P.best = Math.hypot(tx - p.x, tz - p.z);
    P.bestT = P.t;
  }
  const want = new THREE.Vector3(tx - p.x, 0, tz - p.z).normalize();
  const fwd = new THREE.Vector3(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const once = (k, cond) => (cond && !P.fired[k] ? (P.fired[k] = true) : false);
  const cycle = P.t % 14;
  const dive = P.t > 6 && cycle > 12 && cycle < 13;
  return {
    moveX: clamp(want.dot(right), -1, 1),
    moveY: P.t < 1.0 ? 0 : clamp(want.dot(fwd), -1, 1),
    jump: false,
    jumpPressed: once('leap', P.t > 1.4 && player.mode === 'ground') || (player.mode === 'wall' && P.t > 2),
    swing: P.t > 2.2 && !dive,
    swingPressed: false,
    zipPressed: false,
    suitPressed: once('suit', P.t > 20),
    carPressed: false,
    resetPressed: false,
    mapPressed: false,
  };
}

function applyShot(name) {
  if (name === 'perch' || name === 'symbiote') {
    placeOnRoof(city.spawnBox, city.spawn, city.spawnYaw);
    player.idleTime = 2;
    rig.pitch = -0.3;
    rig.dist = 6.5;
    if (name === 'symbiote') hero.setSuit('symbiote');
  } else if (name === 'facade') {
    // Hang on the face of a mid-rise block near the start and look at the wall.
    const b = city.prisms.find((p) => p.y0 < 0.5 && p.y1 > 30 && p.y1 < 50 && Math.hypot((p.minx + p.maxx) / 2 - 200, (p.minz + p.maxz) / 2 + 200) < 400 && p.maxx - p.minx > 25);
    player.reset();
    const cz = (b.minz + b.maxz) / 2;
    player.pos.set(b.maxx + 12, 18, cz);
    player.mode = 'air';
    player.vel.set(0, 0, 0);
    rig.yaw = Math.PI / 2 + 0.5;
    rig.pitch = 0.05;
    rig.dist = 10;
  } else if (name === 'street') {
    player.reset();
    player.pos.set(-300, 0, 12);
    player.groundBox = null;
    rig.yaw = Math.PI / 2;
    rig.pitch = 0.1;
    player.facing.set(-1, 0, 0);
  }
}

// ---------- UI ----------
const overlay = $('overlay');
let started = DEMO;
if (DEMO) {
  overlay.classList.add('hidden');
  startDemo();
} else if (SHOT) {
  overlay.classList.add('hidden');
  started = true;
  applyShot(SHOT);
} else applyShot('perch');

overlay.addEventListener('click', () => {
  input.lock();
  sfx.init();
  sfx.ctx?.resume?.();
  overlay.classList.add('hidden');
  started = true;
});
$('overlay-sub').textContent = `${cfg.label} vera, da OpenStreetMap. Fisica del pendolo, tutto nel browser`;
if (cfg.spots.length) {
  const k = document.createElement('b');
  k.textContent = '1–9, 0';
  $('keys-spots').append(k, ` vai a ${cfg.spots.map((sp) => sp[0]).join(', ')}`);
}
$('overlay-map').addEventListener('click', (e) => {
  e.stopPropagation();
  location.assign(mapSelectQuery(params));
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !DEMO && !SHOT) {
    started = false;
    overlay.classList.remove('hidden');
    $('overlay-title').innerHTML = 'PAUSA';
    $('overlay-cta').textContent = 'Clicca per continuare';
  }
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  csm.updateFrustums();
});

let hintText = '';
function updateHint() {
  let t = '';
  if (driving) t = 'F scendi · Shift salta fuori · Spazio freno a mano';
  else if (player.mode === 'ground' && traffic.nearest(player.pos, 3.2)) t = 'F ruba l’auto';
  if (t !== hintText) {
    hintText = t;
    $('hint').textContent = t;
    $('hint').classList.toggle('show', !!t);
  }
}

// ---------- loop ----------
const camDir = new THREE.Vector3();
const hand = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
let fpsAcc = 0, fpsN = 0, fps = 0;

function tick(dt) {
  const time = (game.time += dt);
  const inp = pilot ? pilotState(dt) : input.state;
  const mouse = pilot ? [0, 0] : input.consumeMouse();
  if (inp.suitPressed) {
    hero.toggleSuit();
    hud.toast(hero.suit === 'symbiote' ? 'Costume nero' : 'Costume classico');
  }
  if (inp.resetPressed) {
    dropCar();
    applyShot('perch');
    hud.toast('Di nuovo in cima');
  }
  if (inp.mapPressed) minimap.toggleZoom();
  if (inp.pausePressed) document.exitPointerLock?.();
  if (inp.spot !== undefined && inp.spot >= 0 && !travelling) goTo(inp.spot);

  drunk.update(dt);
  if (inp.carPressed) {
    if (driving) exitCar(false);
    else if (player.mode === 'ground' || player.mode === 'air') {
      const c = traffic.nearest(player.pos, 3.2);
      if (c) enterCar(c);
    }
  } else if (driving && inp.swingPressed) exitCar(true);

  camera.getWorldDirection(camDir);
  if (driving) {
    const c = driving;
    if (traffic.drive(c, dt, inp, drunk.amount, time) === 'sunk') {
      exitCar(false);
      traffic.remove(c);
      player.pos.copy(player.lastSafe);
      sfx.play('splash');
      voice.say('sunk', drunk.amount);
    } else {
      player.pos.set(c.x, 0, c.z);
      player.vel.set(c.vx, 0, c.vz);
      player.lastSafe.set(c.x, 0, c.z);
      carProxy.pos.set(c.x, 0.3, c.z);
      carProxy.vel.set(c.speed > 0 ? c.vx : 0, 0, c.speed > 0 ? c.vz : 0);
      rig.update(dt, carProxy, mouse, true);
    }
  }
  if (!driving) {
    // Drunk legs: the stick drifts while you walk.
    const pin = drunk.amount > 0 && (inp.moveX || inp.moveY) ? { ...inp, moveX: clamp(inp.moveX + drunk.drift(), -1, 1) } : inp;
    player.update(dt, pin, { yaw: rig.yaw, camPos: camera.position, camDir });
    rig.update(dt, player, mouse, !!pilot);
  }
  drunk.sway(camera);
  drunkFx.uniforms.get('amount').value = drunk.amount;
  drunkFx.uniforms.get('time').value = time;

  traffic.update(dt, player, driving);
  for (const ev of traffic.events) {
    sfx.play(ev);
    if (ev === 'crash' && driving && time - crashSaid > 8) {
      crashSaid = time;
      voice.say('crash', drunk.amount);
    }
  }
  traffic.events.length = 0;
  actors.update(dt, player); // actors:
  const drank = drinks.update(dt, player, !driving && player.mode !== 'swing' && player.mode !== 'zip');
  if (drank) {
    drunk.drink(drank);
    sfx.play('gulp');
    voice.say(drunk.level >= 6 && Math.random() < 0.5 ? 'wasted' : drank, drunk.amount);
    wastedSaid = time;
  } else if (drunk.amount > 0.8 && time - wastedSaid > 25) {
    wastedSaid = time;
    voice.say('wasted', drunk.amount);
  }
  voice.update(dt);
  sfx.engine(driving ? Math.abs(driving.speed) : -1);
  updateHint();

  const hs = Math.hypot(player.vel.x, player.vel.z);
  player.runPhase += hs * dt * 0.75;
  const pose = player.poseName();
  let pp = {};
  if (pose === 'run') pp = { phase: player.runPhase };
  else if (pose === 'wall') pp = { phase: player.wallPhase };
  else if (pose === 'swing') {
    const ahead = (player.pos.x - player.anchor.x) * player.swingDir.x + (player.pos.z - player.anchor.z) * player.swingDir.z;
    pp = { phase: clamp((ahead / (player.ropeLen || 1)) * 0.5 + 0.5, 0, 1) };
  }
  if (!driving) {
    hero.root.position.copy(player.pos);
    hero.root.quaternion.copy(player.quat);
    hero.animate(pose, dt, time, pp, pose === 'swing' ? 10 : 14, hs);
    hero.root.updateMatrixWorld(true);
  }

  if (player.webFade > 0 && !driving) {
    hero.handWorld(hand);
    const to = player.anchor.clone().sub(hand);
    const len = to.length();
    web.visible = true;
    web.position.copy(hand);
    web.quaternion.setFromUnitVectors(Y, to.divideScalar(len || 1));
    const thick = 0.02 + Math.min(len, 120) * 0.0003;
    web.scale.set(thick, len * player.webT, thick);
    webMat.opacity = player.webFade;
  } else web.visible = false;

  for (const ev of player.events) sfx.play(ev);
  player.events.length = 0;
  sfx.update(player.speed);

  systems.update(dt);
  city.update(dt, time, camera.position);
  if (su.time) su.time.value = time;
  camera.updateMatrixWorld();
  csm.update();
  minimap.draw(dt, player.pos, rig.yaw, player.webFade > 0 ? player.anchor : null);
  hud.update(dt);
  input.endFrame();
}

let aerial = null;
function render() {
  if (aerial) {
    camera.position.set(aerial[0], aerial[1], aerial[2]);
    camera.lookAt(aerial[3], 0, aerial[4]);
    camera.updateMatrixWorld();
  }
  if (params.has('nopost')) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.render(scene, camera);
  } else composer.render();
}

let last = performance.now();
let manual = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  // Once a script steps the game itself (advance/simulate), the display loop only draws.
  if (started && !travelling && !manual) tick(dt);
  render();
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    fps = fpsN / fpsAcc;
    fpsAcc = fpsN = 0;
    updateHud();
  }
}

function updateHud() {
  const kmh = Math.round(player.speed * 3.6);
  const booze = drunk.beers + drunk.tuicas ? ` · 🍺 ${drunk.beers} · 🥃 ${drunk.tuicas} · ${'●'.repeat(Math.ceil(drunk.level))}${'○'.repeat(8 - Math.ceil(drunk.level))}` : '';
  $('hud').textContent = `${kmh} km/h · ${Math.round(player.pos.y)} m${booze}${params.has('fps') ? ` · ${Math.round(fps)} fps` : ''}`;
}

// The shared game object, also reachable as window.__game with the hooks for automated checks.
const game = {
  scene,
  camera,
  renderer,
  params,
  cityId,
  city,
  player,
  hero,
  traffic,
  drinks,
  drunk,
  voice,
  input,
  events,
  actors, // actors:
  gfx: { composer, csm, sky }, // light: the render pieces src/env.js takes over
  hud,
  save,
  minimap,
  sfx,
  time: 0, // seconds of game time, advanced by tick
  rng, // seeded, ?seed=N to change it
  systems: null,
  advance(seconds, step = 1 / 30) {
    manual = true;
    for (let t = 0; t < seconds && !travelling; t += step) tick(step);
    updateHud();
    render();
    return this.state();
  },
  // Tick without rendering; reports the deepest the player got inside a building footprint.
  simulate(seconds, step = 1 / 60) {
    manual = true;
    let worst = 0, minY = Infinity, maxSpeed = 0, nan = false;
    const modes = new Set();
    const cp = {};
    for (let t = 0; t < seconds; t += step) {
      tick(step);
      const p = player.pos;
      if (!Number.isFinite(p.x + p.y + p.z)) nan = true;
      modes.add(player.mode);
      minY = Math.min(minY, p.y);
      maxSpeed = Math.max(maxSpeed, player.speed);
      for (const b of city.nearby(p.x, p.z, 1, [])) {
        if (p.y >= b.y1 - 0.05 || p.y + 1.0 < b.y0) continue;
        if (!pointInPrism2D(p.x, p.z, b)) continue;
        worst = Math.max(worst, closestOnPrism(p.x, p.z, b, cp).d);
      }
    }
    return { ...this.state(), worstPenetration: Math.round(worst * 100) / 100, minY: Math.round(minY * 10) / 10, maxSpeed: Math.round(maxSpeed * 10) / 10, modes: [...modes], nan };
  },
  state() {
    return {
      mode: player.mode,
      pose: player.poseName(),
      pos: player.pos.toArray().map((v) => Math.round(v * 10) / 10),
      speed: Math.round(player.speed * 10) / 10,
      suit: hero.suit,
      fps: Math.round(fps),
      driving: driving ? driving.type : null,
      drunk: Math.round(drunk.level * 10) / 10,
      cars: traffic.cars.length,
      city: cityId,
      loaded: [...city.recs.values()].filter((r) => r.state === 'loaded').length,
      prisms: city.prisms.length,
    };
  },
  shot: applyShot,
  goTo,
  // Test view from above: fixed camera looking at (tx, 0, tz), with the fog pushed back.
  aerial(x, y, z, tx, tz) {
    aerial = [x, y, z, tx, tz];
    scene.fog.near = 3000;
    scene.fog.far = 26000;
    camera.far = 40000;
    camera.updateProjectionMatrix();
  },
  rig,
  setInput(o) {
    input.override = o ? { moveX: 0, moveY: 0, jump: false, jumpPressed: false, swing: false, swingPressed: false, zipPressed: false, suitPressed: false, resetPressed: false, mapPressed: false, carPressed: false, attackPressed: false, throwPressed: false, tiePressed: false, interactPressed: false, pausePressed: false, ...o } : null;
  },
  look(yaw, pitch) {
    rig.yaw = yaw;
    if (pitch !== undefined) rig.pitch = pitch;
  },
  pointIn: pointInPrism2D,
  pilot: () => pilot,
  stopPilot() {
    pilot = null;
  },
  enterCar,
  exitCar,
  driving: () => driving,
  ready: false,
};
window.__game = game;
hud.game = game;
const systems = (game.systems = new Systems(game));
await systems.load();

if (params.has('spot')) await goTo(+params.get('spot'));
// The demo starts with the whole streaming ring loaded, so every run swings through the same city.
if (DEMO) await city.streamAround(city.spawn.x, city.spawn.z, 1900);
systems.start();
events.emit('city:change', { id: cityId });
game.ready = true;
tick(0.001);
$('loading').classList.add('hidden');
requestAnimationFrame(frame);
