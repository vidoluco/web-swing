import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { clamp } from './config.js';

// ---------- pickups at real bars and kiosks ----------

function labelTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg;
  g.font = '900 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A bottle from a lathe profile: [radius, height] pairs from the base up.
function bottle(profile, glass, liquid, fill, label) {
  const g = new THREE.Group();
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 20), glass));
  const top = profile[profile.length - 1][1];
  const inner = profile.filter(([, y]) => y <= top * fill).map(([r, y]) => new THREE.Vector2(r * 0.9, y + 0.005));
  if (inner.length > 1) g.add(new THREE.Mesh(new THREE.LatheGeometry(inner, 20), liquid));
  if (label) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(label.r, label.r, label.h, 24, 1, true), new THREE.MeshStandardMaterial({ map: label.tex, roughness: 0.6 }));
    band.position.y = label.y;
    g.add(band);
  }
  return g;
}

function makeModels() {
  const amberGlass = new THREE.MeshStandardMaterial({ color: 0x5a2c08, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x2a1200, emissiveIntensity: 0.6 });
  const beer = new THREE.MeshStandardMaterial({ color: 0xf0a010, roughness: 0.2, emissive: 0xa05a00, emissiveIntensity: 0.9 });
  const foam = new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.9, emissive: 0x333028, emissiveIntensity: 0.4 });
  const clearGlass = new THREE.MeshStandardMaterial({ color: 0xdfeff5, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
  const tuica = new THREE.MeshStandardMaterial({ color: 0xf5e38a, roughness: 0.1, transparent: true, opacity: 0.9, emissive: 0x8a7a20, emissiveIntensity: 0.8 });

  // Beer mug for bars.
  const mug = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.46, 24), beer);
  body.position.y = 0.23;
  const glassWall = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.195, 0.5, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.15, depthWrite: false }));
  glassWall.position.y = 0.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.215, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), foam);
  head.position.y = 0.46;
  head.scale.y = 0.45;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 16, Math.PI), clearGlass);
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0.22, 0.25, 0);
  mug.add(body, glassWall, head, handle);

  // Brown beer bottle for kiosks.
  const beerBottle = bottle(
    [[0, 0], [0.12, 0], [0.13, 0.02], [0.13, 0.38], [0.1, 0.46], [0.045, 0.56], [0.04, 0.72], [0.048, 0.74], [0, 0.745]],
    amberGlass, beer, 0.7,
    { r: 0.133, h: 0.14, y: 0.22, tex: labelTexture('BERE', '#f2c230', '#6a1a10') },
  );
  // Clear tuica bottle.
  const tuicaBottle = bottle(
    [[0, 0], [0.11, 0], [0.12, 0.02], [0.12, 0.42], [0.09, 0.5], [0.04, 0.6], [0.035, 0.78], [0.045, 0.8], [0, 0.805]],
    clearGlass, tuica, 0.62,
    { r: 0.123, h: 0.16, y: 0.24, tex: labelTexture('ȚUICĂ', '#fbf4df', '#7a1a3a') },
  );
  return { mug, beerBottle, tuicaBottle };
}

// Glow on the ground and a soft beam of light, so a drink shows from down the street.
let fadeTex = null;
function ring(color) {
  if (!fadeTex) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, '#000');
    gr.addColorStop(1, '#fff');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 64);
    fadeTex = new THREE.CanvasTexture(c);
  }
  const grp = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.95, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.position.y = 0.05;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.75, 7, 20, 1, true).translate(0, 3.5, 0),
    new THREE.MeshBasicMaterial({ color, alphaMap: fadeTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  grp.add(glow, beam);
  return grp;
}

// The real name of the bar or kiosk, on a sign above its drinks.
const signs = new Map();
function sign(name, kind) {
  const key = kind + name;
  if (!signs.has(key)) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = kind === 0 ? 'rgba(90,20,10,0.88)' : 'rgba(20,40,70,0.85)';
    g.beginPath();
    g.roundRect(8, 8, 496, 112, 22);
    g.fill();
    g.fillStyle = '#ffd54a';
    g.font = '900 46px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((name || (kind === 0 ? 'Bar' : 'Non-Stop')).slice(0, 22), 256, 50);
    g.fillStyle = '#fff';
    g.font = '700 28px system-ui, sans-serif';
    g.fillText(kind === 0 ? 'bere · țuică' : 'bere rece', 256, 96);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    sp.scale.set(4, 1, 1);
    signs.set(key, sp);
  }
  return signs.get(key);
}

// Pickups around the player: bars offer a beer and a tuica, kiosks a beer. Each respawns after a while.
export class Drinks {
  constructor(scene, city) {
    this.city = city;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.models = makeModels();
    this.pool = [];
    this.list = [];
    this.scanT = 0;
    this.time = 0;
    this.shownSigns = new Set();
  }

  item(poi, kind, dx, dz) {
    const look = kind === 'tuica' ? 'tuica' : poi.kind === 0 ? 'mug' : 'bottle';
    let it = this.pool.find((p) => !p.used && p.look === look);
    if (!it) {
      const obj = new THREE.Group();
      const model = (kind === 'tuica' ? this.models.tuicaBottle : poi.kind === 0 ? this.models.mug : this.models.beerBottle).clone();
      model.scale.setScalar(2.8);
      obj.add(model, ring(kind === 'tuica' ? 0xfff0a0 : 0xffa020));
      obj.userData.model = model;
      this.group.add(obj);
      it = { obj, kind, look };
      this.pool.push(it);
    }
    it.used = true;
    it.poi = poi;
    it.x = poi.x + dx;
    it.z = poi.z + dz;
    it.obj.visible = true;
    it.y = this.city.groundAt(it.x, it.z); // terrain
    it.obj.position.set(it.x, it.y, it.z);
    return it;
  }

  showSign(p) {
    const sp = sign(p.name, p.kind);
    sp.position.set(p.x, this.city.groundAt(p.x, p.z) + 4.2, p.z); // terrain
    sp.visible = true;
    if (sp.parent !== this.group) this.group.add(sp);
    this.shownSigns.add(sp);
  }

  update(dt, player, onFoot) {
    this.time += dt;
    if ((this.scanT -= dt) <= 0) {
      this.scanT = 0.5;
      for (const it of this.pool) (it.used = false), (it.obj.visible = false);
      for (const sp of this.shownSigns) sp.visible = false;
      this.shownSigns.clear();
      const near = [];
      for (const rec of this.city.recs.values()) {
        if (rec.state !== 'loaded' || !rec.pois) continue;
        for (const p of rec.pois) {
          const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
          if (d < 260) near.push([d, p]);
        }
      }
      near.sort((a, b) => a[0] - b[0]);
      this.list = [];
      for (const [, p] of near.slice(0, 24)) {
        const beer = this.time >= (p.readyBeer || 0), tuica = p.kind === 0 && this.time >= (p.readyTuica || 0);
        if (!beer && !tuica) continue;
        this.city.settlePoi(p);
        this.showSign(p);
        // At a bar: beer on one side, tuica on the other, along the shop front.
        const tx = p.nx || p.nz ? -p.nz : 1, tz = p.nx || p.nz ? p.nx : 0, k = p.kind === 0 ? 1.1 : 0;
        if (beer) this.list.push(this.item(p, 'beer', tx * k, tz * k));
        if (tuica) this.list.push(this.item(p, 'tuica', -tx * k, -tz * k));
      }
    }
    let drank = null;
    for (const it of this.list) {
      if (!it.obj.visible) continue;
      const m = it.obj.userData.model;
      m.rotation.y = this.time * 1.6 + it.x;
      m.position.y = 0.7 + Math.sin(this.time * 2.2 + it.z) * 0.12;
      if (onFoot && !drank && Math.hypot(it.x - player.pos.x, it.z - player.pos.z) < 1.5 && Math.abs(player.pos.y - it.y - 1) < 2.2) {
        drank = it.kind;
        if (it.kind === 'beer') it.poi.readyBeer = this.time + 75;
        else it.poi.readyTuica = this.time + 75;
        it.obj.visible = false;
        this.lastPlace = it.poi.name;
      }
    }
    return drank;
  }
}

// ---------- being drunk ----------

// Double vision: the image splits into two drifting copies, plus a slow warm wave.
export class DrunkEffect extends Effect {
  constructor() {
    super(
      'DrunkEffect',
      /* glsl */ `
uniform float amount;
uniform float time;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (amount <= 0.001) { outputColor = inputColor; return; }
  vec2 wave = vec2(sin(uv.y * 9.0 + time * 1.3), cos(uv.x * 7.0 + time * 1.1)) * 0.004 * amount;
  vec2 off = vec2(sin(time * 0.7), cos(time * 0.53)) * 0.016 * amount;
  vec4 a = texture2D(inputBuffer, uv + wave + off);
  vec4 b = texture2D(inputBuffer, uv + wave - off);
  vec3 c = mix(texture2D(inputBuffer, uv + wave).rgb, (a.rgb + b.rgb) * 0.5, 0.75 * min(amount, 1.0));
  c = mix(c, c * vec3(1.06, 1.0, 0.9), 0.5 * amount);
  outputColor = vec4(c, inputColor.a);
}`,
      { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([['amount', new THREE.Uniform(0)], ['time', new THREE.Uniform(0)]]) },
    );
  }
}

// Units of alcohol in the blood: a beer is 1, a tuica 2. Wears off slowly.
export class Drunk {
  constructor() {
    this.level = 0;
    this.beers = 0;
    this.tuicas = 0;
    this.t = 0;
  }
  drink(kind) {
    if (kind === 'beer') (this.level += 1), this.beers++;
    else (this.level += 2), this.tuicas++;
    this.level = Math.min(this.level, 8);
  }
  update(dt) {
    this.t += dt;
    this.level = Math.max(0, this.level - dt / 35);
  }
  // 0 sober, 1 very drunk.
  get amount() {
    return clamp(this.level / 5, 0, 1);
  }
  sway(camera) {
    const a = this.amount;
    if (a <= 0) return;
    const t = this.t;
    camera.rotateZ(Math.sin(t * 0.8) * 0.09 * a);
    camera.rotateY(Math.sin(t * 0.45 + 1) * 0.05 * a);
    camera.rotateX(Math.sin(t * 0.6 + 2) * 0.035 * a);
  }
  // Legs that do not go where you want: drift added to the walking and steering input.
  drift() {
    const a = this.amount;
    return a * (Math.sin(this.t * 1.3) * 0.45 + Math.sin(this.t * 2.9 + 0.5) * 0.25);
  }
}

// ---------- what he says, in Romanian ----------

export const LINES = {
  steal: [
    ['Hai, frate, că ți-o aduc înapoi... poate!', 'Dai, fratello, te la riporto... forse!'],
    ['Scuze, șefu\', e urgență: se închide non-stopul!', 'Scusa capo, è un\'emergenza: chiude il non-stop!'],
    ['Mașina e a lu\' văru\'. Văru\' încă nu știe.', 'L\'auto è di mio cugino. Mio cugino ancora non lo sa.'],
    ['Stai liniștit, o parchez pe trotuar, ca tot Bucureștiul.', 'Tranquillo, la parcheggio sul marciapiede, come tutta Bucarest.'],
    ['Merge și fără ITP, nu?', 'Va anche senza revisione, no?'],
    ['Ia uite, are și brăduț parfumat!', 'Guarda, ha pure l\'alberello profumato!'],
    ['Plec la mare, mă-ntorc luni!', 'Vado al mare, torno lunedì!'],
    ['Las-o, bă, că n-o zgârii!', 'Lasciala, dai, che non la graffio!'],
  ],
  stealtaxi: [
    ['Taxi! A, stai, acum eu sunt taximetristul.', 'Taxi! Ah, aspetta, adesso il tassista sono io.'],
    ['Aparatul e stricat, facem la negru!', 'Il tassametro è rotto, facciamo in nero!'],
  ],
  stealpolice: [['Poliția sunt eu acum. Actele la control!', 'La polizia adesso sono io. Documenti, prego!']],
  stealdrunk: [
    ['Șofer desemnat? Eu. Desemnat de mine.', 'Autista designato? Io. Designato da me.'],
    ['Văd două drumuri. Îl iau pe cel din mijloc.', 'Vedo due strade. Prendo quella in mezzo.'],
  ],
  beer: [
    ['Noroc!', 'Salute!'],
    ['Una rece, ca la mama acasă!', 'Una fresca, come a casa della mamma!'],
    ['Bere la PET: patrimoniu național.', 'Birra nella bottiglia di plastica: patrimonio nazionale.'],
    ['Asta e apă cu spumă, frate.', 'Questa è acqua con la schiuma, fratello.'],
    ['Noroc și sănătate, că de bani mai vedem!', 'Fortuna e salute, per i soldi si vedrà!'],
    ['Încă una și plec la Vama Veche!', 'Un\'altra e parto per Vama Veche!'],
  ],
  tuica: [
    ['Țuică de la bunica, curată ca lacrima!', 'Țuică della nonna, limpida come una lacrima!'],
    ['Ooof, arde până-n suflet!', 'Ooof, brucia fino all\'anima!'],
    ['Asta nu e băutură, e medicament!', 'Questa non è una bevanda, è una medicina!'],
    ['Parcă văd două Case ale Poporului...', 'Mi sembra di vedere due Case del Popolo...'],
    ['Hai noroc, să trăiască Bucureștiul!', 'Salute, viva Bucarest!'],
    ['Bunicul zicea: o țuică dimineața și n-ai nevoie de doctor.', 'Il nonno diceva: una țuică al mattino e il medico non serve.'],
  ],
  wasted: [
    ['Te iubesc, frate... pe tine și pe toată lumea!', 'Ti voglio bene, fratello... a te e a tutto il mondo!'],
    ['Unde mi-e mașina? Care mașină?', 'Dov\'è la mia macchina? Quale macchina?'],
    ['Pământul se mișcă. Sigur e cutremur.', 'La terra si muove. Sicuro è un terremoto.'],
  ],
  crash: [
    ['Nu-i nimic, se rezolvă cu o bere la tinichigiu.', 'Non è niente, si risolve con una birra dal carrozziere.'],
    ['Cine a pus blocul ăsta aici?!', 'Chi ha messo questo palazzo qui?!'],
  ],
  sunk: [['Am parcat în lac. Tot e mai bine decât în Centrul Vechi.', 'Ho parcheggiato nel lago. Sempre meglio che nel Centro Storico.']],
};

// Subtitle (Romanian, with the Italian underneath) and a Romanian system voice, slurred when drunk.
export class Voice {
  constructor(el) {
    this.el = el;
    this.t = 0;
    this.last = {};
    this.lastLine = null;
    this.voice = null;
    const pick = () => {
      const vs = window.speechSynthesis?.getVoices() || [];
      this.voice = vs.find((v) => /^ro/i.test(v.lang)) || null;
    };
    pick();
    window.speechSynthesis?.addEventListener?.('voiceschanged', pick);
  }

  say(kind, drunk = 0) {
    const list = LINES[kind];
    if (!list) return;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.last[kind]) i = (i + 1) % list.length;
    this.last[kind] = i;
    const [ro, it] = list[i];
    this.lastLine = ro;
    this.el.replaceChildren();
    const b = document.createElement('b');
    b.textContent = ro;
    const s = document.createElement('span');
    s.textContent = it;
    this.el.append(b, s);
    this.el.classList.add('show');
    this.t = 2.2 + ro.length * 0.055;
    const synth = window.speechSynthesis;
    if (synth && window.SpeechSynthesisUtterance) {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(ro);
      u.lang = 'ro-RO';
      if (this.voice) u.voice = this.voice;
      u.rate = Math.max(0.62, 1.05 - drunk * 0.4);
      u.pitch = Math.max(0.6, 1 - drunk * 0.35);
      synth.speak(u);
    }
  }

  update(dt) {
    if (this.t > 0 && (this.t -= dt) <= 0) this.el.classList.remove('show');
  }
}
