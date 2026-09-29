import { CITIES } from './cities.js';

// The map selection screen. A card is a plain link to ?city=<id>, so the page reloads with that city
// and nothing of the game is built before the choice. The other URL flags (?lowq, ?cars=...) are kept.

// Query string for a city.
export function cityQuery(params, id) {
  const q = new URLSearchParams(params);
  q.set('city', id);
  return `?${q}`;
}

// Query string that leads back to the selection: no city, and no demo or shot, which skip it.
export function mapSelectQuery(params) {
  const q = new URLSearchParams(params);
  for (const k of ['city', 'demo', 'shot']) q.delete(k);
  const s = q.toString();
  return s ? `?${s}` : location.pathname;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

export function showMapSelect(save, params) {
  const last = save.get('city');
  const box = document.getElementById('mapcards');
  for (const [id, c] of Object.entries(CITIES)) {
    if (c.menu === false) continue;
    const card = el('a', 'card');
    card.href = cityQuery(params, id);
    card.dataset.city = id;
    const img = new Image();
    img.src = c.image;
    img.alt = `${c.label}, un’immagine dal gioco`;
    const body = el('div', 'card-body');
    body.append(el('span', 'card-name', c.label), el('span', 'card-tag', c.tagline));
    card.append(img, body);
    if (id === last) card.append(el('span', 'card-last', 'Ultima scelta'));
    card.addEventListener('click', () => save.set('city', id));
    box.append(card);
  }
  for (const id of ['loading', 'overlay']) document.getElementById(id).classList.add('hidden');
  document.getElementById('mapselect').classList.remove('hidden');
  (box.querySelector(`[data-city="${last}"]`) || box.firstChild)?.focus();
}
