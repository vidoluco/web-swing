import { KINDS } from './pets.js';

// The status panels along the top: level with a progress bar, health, police stars, the timer of the
// mission or race, jars of zacusca, PET bottles and the bonuses still running. They read what the
// other systems publish (game.respect, game.health, game.wanted, game.missions.timer,
// game.challenges, game.pets, game.buffs) and skip what is not there yet, so this branch draws
// well alone and picks the rest up once it is merged. The row wraps instead of overlapping (see
// hud.js), text is 13 px or more, and the panels keep a fixed width so numbers do not shift them.
const CSS = `
.hud-item.hp { display: flex; align-items: center; gap: 8px; box-sizing: border-box; height: 42px; padding: 4px 12px; }
.hud-item.hp[hidden] { display: none; }
.hp .big { font-size: 26px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
.hp .tag { font-size: 13px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.8; }
.hp .sub { font-size: 13px; font-weight: 700; opacity: 0.85; font-variant-numeric: tabular-nums; white-space: nowrap; }
.hp .bar { position: relative; flex: none; width: 100px; height: 12px; border-radius: 6px; background: rgba(255,255,255,0.2); overflow: hidden; }
.hp .bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 6px; background: var(--c, #ffd400); transition: width 0.25s; }
.hp.level { min-width: 244px; }
.hp.level.flash { animation: hpflash 1.2s; }
@keyframes hpflash { 0%, 50% { background: rgba(255,212,0,0.85); color: #000; } }
.hp.health { min-width: 216px; }
.hp.health .heart { color: #ff4d5e; font-size: 22px; line-height: 1; }
.hp.health .bar { width: 130px; }
.hp.stars .star { font-size: 24px; line-height: 1; color: rgba(255,255,255,0.28); }
.hp.stars .star.on { color: #ffd400; text-shadow: 0 0 6px rgba(255,212,0,0.7); }
.hp.timer { min-width: 150px; }
.hp.timer .big { font-size: 28px; min-width: 76px; }
.hp.timer.low .big { color: #ff5a5a; }
.hp.jars .big, .hp.pet .big { min-width: 34px; text-align: right; }
.hp.pet .kinds { display: flex; gap: 8px; }
.hp.pet .kinds span { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 800; }
.hp.pet .kinds span[hidden] { display: none; }
.hp.pet .kinds b { width: 10px; height: 10px; border-radius: 2px; background: var(--c); display: inline-block; }
.hp.buffs { gap: 12px; }
.hp.buffs span { font-size: 14px; font-weight: 800; white-space: nowrap; }
.hp.buffs em { font-style: normal; opacity: 0.75; margin-left: 4px; font-variant-numeric: tabular-nums; }
@media (max-width: 600px), (max-height: 520px) {
  .hud-item.hp { height: 36px; padding: 3px 9px; gap: 6px; }
  .hp .big { font-size: 22px; }
  .hp.timer .tag, .hp.jars .tag { display: none; }
  .hp.jars::before { content: ''; width: 11px; height: 15px; border-radius: 3px; background: #e0501a; box-shadow: inset 0 4px 0 #d8a72a; }
  .hp .bar, .hp.health .bar { width: 64px; }
  .hp.level { min-width: 0; }
  .hp.health { min-width: 0; }
  .hp.stars .star { font-size: 20px; }
  .hp.timer { min-width: 0; }
  .hp.timer .big { font-size: 24px; min-width: 64px; }
}`;

const NAME = { turbo: 'Turbo', shield: 'Scudo', fire: 'Fuoco', energy: 'Energia' };
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function create(game) {
  const { hud } = game;
  let style = null;
  let started = false;
  const mine = [];

  // Adds one panel unless another system already registered a panel with that id.
  function panel(id, order, cls, build, paint) {
    if (hud.items.has(id)) return;
    mine.push(id);
    hud.add(id, {
      order,
      render(el, g) {
        if (!el.ui) {
          el.classList.add('hp', cls);
          el.ui = build(el);
        }
        el.hidden = paint(el.ui, g, el) === false;
      },
    });
  }

  function start() {
    started = true;
    style = h('style');
    style.textContent = CSS;
    document.head.append(style);

    panel('timer', 0, 'timer', (el) => {
      const big = h('span', 'big'), tag = h('span', 'tag'), sub = h('span', 'sub');
      el.append(big, tag, sub);
      return { big, tag, sub };
    }, (u, g, el) => {
      const t = g.missions?.timer ?? g.challenges?.timer;
      if (!t) return false;
      u.big.textContent = clock(t.sec);
      u.tag.textContent = t.label;
      u.sub.textContent = t.goal ? `oro ${clock(t.goal)}` : '';
      el.classList.toggle('low', !t.up && t.sec < 20);
    });

    panel('level', 1, 'level', (el) => {
      const tag = h('span', 'tag', 'Liv.'), big = h('span', 'big'), bar = h('span', 'bar'), fill = h('i'), sub = h('span', 'sub');
      bar.append(fill);
      el.append(tag, big, bar, sub);
      game.events.on('level:up', () => {
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      });
      return { big, fill, sub };
    }, (u, g) => {
      const r = g.respect;
      if (!r) return false;
      u.big.textContent = r.level;
      u.fill.style.width = r.span ? `${Math.round((100 * r.into) / r.span)}%` : '100%';
      u.sub.textContent = r.span ? `${r.into}/${r.span}` : 'MAX';
    });

    panel('health', 2, 'health', (el) => {
      const heart = h('span', 'heart', '♥'), bar = h('span', 'bar'), fill = h('i'), sub = h('span', 'sub');
      bar.append(fill);
      el.append(heart, bar, sub);
      return { fill, sub };
    }, (u, g) => {
      const hp = g.health;
      if (!hp) return false;
      const f = Math.max(0, Math.min(1, hp.hp / hp.max));
      u.fill.style.width = `${Math.round(f * 100)}%`;
      u.fill.style.setProperty('--c', f > 0.5 ? '#54d16b' : f > 0.25 ? '#ffb020' : '#ff4d4d');
      u.sub.textContent = `${Math.ceil(hp.hp)}/${Math.round(hp.max)}`;
    });

    panel('stars', 3, 'stars', (el) => {
      const stars = Array.from({ length: 5 }, () => h('span', 'star', '★'));
      el.append(...stars);
      return { stars };
    }, (u, g) => {
      if (!g.wanted) return false;
      u.stars.forEach((s, i) => s.classList.toggle('on', i < g.wanted.stars));
    });

    panel('jars', 4, 'jars', (el) => {
      const tag = h('span', 'tag', 'Borcane'), big = h('span', 'big'), sub = h('span', 'sub');
      el.append(tag, big, sub);
      return { big, sub };
    }, (u, g) => {
      const j = g.challenges?.jars;
      if (!j?.total) return false;
      u.big.textContent = j.got;
      u.sub.textContent = `/${j.total}`;
    });

    panel('pet', 5, 'pet', (el) => {
      const tag = h('span', 'tag', 'PET'), big = h('span', 'big'), kinds = h('span', 'kinds');
      el.append(tag, big, kinds);
      const chips = {};
      for (const [k, K] of Object.entries(KINDS)) {
        const s = h('span'), b = h('b'), n = h('span');
        b.style.setProperty('--c', hex(K.glow));
        s.append(b, n);
        s.title = K.name;
        s.hidden = true;
        kinds.append(s);
        chips[k] = { s, n };
      }
      return { big, chips };
    }, (u, g) => {
      if (!g.pets) return false;
      const c = g.pets.counts;
      u.big.textContent = g.pets.total;
      for (const [k, ch] of Object.entries(u.chips)) {
        ch.s.hidden = !c[k];
        ch.n.textContent = c[k] ?? 0;
      }
    });

    panel('buffs', 6, 'buffs', () => ({ cache: '' }), (u, g, el) => {
      const act = g.buffs?.active() ?? [];
      if (!act.length) return false;
      const txt = act.map((n) => `${NAME[n] ?? n}|${Math.ceil(g.buffs.left(n))}`).join(',');
      if (txt === u.cache) return;
      u.cache = txt;
      el.replaceChildren(...act.map((n) => {
        const s = h('span', '', NAME[n] ?? n), e = h('em', '', `${Math.ceil(g.buffs.left(n))}s`);
        s.append(e);
        return s;
      }));
    });
  }

  return {
    name: 'hudpanels',
    // The panels are added on the first update, after every system has had its init and put its own panels up.
    update() {
      if (!started) start();
    },
    dispose() {
      for (const id of mine) hud.remove(id);
      style?.remove();
    },
  };
}
