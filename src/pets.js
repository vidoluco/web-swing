import * as THREE from 'three';
import { loadCollect, Pickups, bandTexture } from './collectibles.js';

// PET bonuses: plastic bottles of every kind lying around the city as rare pickups, each with a glow
// in the colour of what is inside. Six kinds, about 20 per city (public/city/<id>/collect.json).
//   beer   Bere 2,5 L       turbo 30 s, drunk +2         wine   Vin 2 L       shield 30 s, drunk +2
//   tuica  Țuică 1,5 L      fire 30 s, drunk +3          cola   Cola 2 L      energy 30 s
//   water  Apă plată 1,5 L  sober up, heal a quarter     juice  Suc 2 L       heal half
// The brands on the labels are invented. A bottle taken is gone for good; the counts are saved under 'pet'
// as { counts: {kind: n}, total, taken: {cityId: [ids]} }, and every 10 bottles win a scarf colour.
const RESPECT = 2;
const TEN_RESPECT = 25;

export const KINDS = {
  beer: { name: 'Bere 2,5 L', short: 'Bere', buff: 'turbo', drunk: 2, say: 'pet.beer', text: 'Turbo', glow: 0xffb320, liquid: 0xf0a010, tint: 0xf4c040, label: ['AURIE', 'BERE BLONDĂ'], bg: '#e9b91d', fg: '#4a1d00', accent: '#8a1c10', cap: 0xb8221a, r: 0.058, h: 0.38 },
  wine: { name: 'Vin la PET 2 L', short: 'Vin', buff: 'shield', drunk: 2, say: 'pet.wine', text: 'Scudo', glow: 0xff2a4a, liquid: 0x7a0a1c, tint: 0xb04058, label: ['PIVNIȚA', 'VIN ROȘU'], bg: '#f1e6cf', fg: '#6e0d1c', accent: '#6e0d1c', cap: 0xf1e6cf, r: 0.053, h: 0.34 },
  tuica: { name: 'Țuică la PET 1,5 L', short: 'Țuică', buff: 'fire', drunk: 3, say: 'pet.tuica', text: 'Fuoco', glow: 0xe6fff2, liquid: 0xf2f6f0, tint: 0xeafff5, label: ['ȚUICĂ', 'DE PRUNE'], bg: '#f4f7ef', fg: '#2d5a2a', accent: '#5a2d6e', cap: 0x2d5a2a, r: 0.046, h: 0.32 },
  cola: { name: 'Cola 2 L', short: 'Cola', buff: 'energy', drunk: 0, say: 'pet.cola', text: 'Energia', glow: 0xd2691e, liquid: 0x2a140a, tint: 0x5a2c14, label: ['KOLINA', 'COLA'], bg: '#3a0d10', fg: '#f6e3c0', accent: '#d8a72a', cap: 0x1a1a1a, r: 0.05, h: 0.34, waist: true },
  water: { name: 'Apă plată 1,5 L', short: 'Apă', heal: 0.25, sober: true, say: 'pet.water', text: 'Sobrio, +25% salute', glow: 0x60c8ff, liquid: 0xbfe6ff, tint: 0xdff4ff, label: ['IZVOR', 'APĂ PLATĂ'], bg: '#e8f6ff', fg: '#0d4a8a', accent: '#1f8ad8', cap: 0x1f8ad8, r: 0.043, h: 0.31 },
  juice: { name: 'Suc de portocale 2 L', short: 'Suc', heal: 0.5, say: 'pet.juice', text: '+50% salute', glow: 0xffa030, liquid: 0xff8c00, tint: 0xffa030, label: ['SOARE', 'SUC PORTOCALE'], bg: '#ff9a1a', fg: '#fff6dc', accent: '#2f8a2f', cap: 0x2f8a2f, r: 0.052, h: 0.3, wide: true },
};

// One bottle: a lathe body with a petal base, the liquid, a label and a cap, about a metre tall.
function bottleModel(kind) {
  const K = KINDS[kind];
  const { r, h } = K;
  const prof = [[0, 0.012], [r * 0.55, 0.0], [r * 0.9, 0.012], [r, 0.045]];
  if (K.waist) prof.push([r, h * 0.3], [r * 0.85, h * 0.42], [r, h * 0.54]);
  else prof.push([r, h * (K.wide ? 0.5 : 0.62)]);
  prof.push([r * 0.95, h * 0.7], [r * 0.6, h * 0.85], [r * 0.3, h * 0.92], [r * 0.28, h * 0.97], [r * 0.3, h]);
  const glass = new THREE.MeshStandardMaterial({ color: K.tint, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.32, depthWrite: false });
  const liquid = new THREE.MeshStandardMaterial({ color: K.liquid, roughness: 0.25, emissive: K.liquid, emissiveIntensity: kind === 'cola' ? 0.1 : 0.35 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 24), glass));
  const inner = prof.filter(([, y]) => y <= h * 0.78).map(([x, y]) => new THREE.Vector2(x * 0.9, y + 0.006));
  inner.push(new THREE.Vector2(0, h * 0.78));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(inner, 24), liquid));
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.012, r * 1.012, h * 0.3, 28, 1, true),
    new THREE.MeshStandardMaterial({ map: bandTexture(K.label, K.bg, K.fg, K.accent), roughness: 0.6, side: THREE.DoubleSide }),
  );
  label.position.y = h * 0.38;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.33, r * 0.33, h * 0.06, 16), new THREE.MeshStandardMaterial({ color: K.cap, roughness: 0.5 }));
  cap.position.y = h * 1.01;
  g.add(label, cap);
  // Five petals under the base, the way a PET bottle stands.
  const petal = new THREE.MeshStandardMaterial({ color: K.tint, roughness: 0.2, transparent: true, opacity: 0.6, depthWrite: false });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 10, 6), petal);
    p.scale.y = 0.55;
    p.position.set(Math.cos(a) * r * 0.66, 0.012, Math.sin(a) * r * 0.66);
    g.add(p);
  }
  g.scale.setScalar(3.5);
  g.position.y = -h * 1.75;
  const outer = new THREE.Group();
  outer.add(g);
  return outer;
}

export function create(game) {
  const { save, events, hud } = game;
  const key = game.cityId;
  const load = () => {
    const s = save.get('pet', {});
    return { counts: s.counts ?? {}, total: s.total ?? 0, taken: s.taken ?? {} };
  };
  let pickups = null;
  let markT = 0;
  const models = new Map();

  function apply(kind) {
    const K = KINDS[kind];
    if (K.buff) game.buffs?.add(K.buff);
    if (K.drunk) game.drunk?.set(game.drunk.level + K.drunk);
    if (K.sober) game.drunk?.set(0);
    if (K.heal && game.health) game.health.heal(Math.round(game.health.max * K.heal));
    game.voice?.say(K.say);
  }

  function take(it) {
    const s = load();
    s.counts[it.type] = (s.counts[it.type] ?? 0) + 1;
    s.total++;
    (s.taken[key] ??= []).push(it.id);
    save.set('pet', s);
    apply(it.type);
    hud.toast(`${KINDS[it.type].name}: ${KINDS[it.type].text}${KINDS[it.type].buff ? ' (30 s)' : ''}`, 2.2);
    game.respect?.add(RESPECT, `pet:${it.type}`);
    if (s.total % 10 === 0) {
      game.respect?.add(TEN_RESPECT, 'pet:10');
      hud.toast(`${s.total} bottiglie: nuovo colore del basma!`, 3);
    }
    events.emit('collect', { kind: 'pet', type: it.type, id: it.id });
  }

  game.pets = {
    kinds: KINDS,
    get counts() {
      return load().counts;
    },
    get total() {
      return load().total;
    },
    get items() {
      return pickups?.items ?? [];
    },
    get left() {
      return pickups ? pickups.left.map((p) => p.id) : [];
    },
    take: (id) => pickups?.take(pickups.find(id)),
  };

  return {
    name: 'pets',
    init() {
      loadCollect(key).then((data) => {
        if (!data?.pets?.length) return;
        pickups = new Pickups(game, {
          items: data.pets,
          taken: new Set(load().taken[key] ?? []),
          build: (it) => (models.get(it.type) ?? (models.set(it.type, bottleModel(it.type)), models.get(it.type))).clone(),
          glow: (it) => KINDS[it.type].glow,
          height: 20,
          near: 700,
          radius: 2.4,
          take,
        });
      });
    },
    update(dt) {
      pickups?.update(dt);
      if (pickups && (markT -= dt) <= 0) {
        markT = 0.5;
        const near = pickups.left.filter((p) => Math.hypot(p.x - game.player.pos.x, p.z - game.player.pos.z) < 260).slice(0, 10);
        game.minimap.setMarkers('pet', near.map((p) => ({ x: p.x, z: p.z, color: '#' + KINDS[p.type].glow.toString(16).padStart(6, '0'), shape: 'square' })));
      }
    },
    dispose() {
      pickups?.dispose();
      game.minimap.setMarkers('pet', []);
    },
  };
}
