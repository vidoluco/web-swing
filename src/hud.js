// DOM HUD over the canvas: an objective line, a toast, and a row of panels the systems add to.
// Layout lives in index.template.html (#hud-top holds the objective and #hud-panels), so panels
// wrap instead of overlapping at any width. Body text stays at 13 px or more.
const RENDER_EVERY = 0.1; // seconds between render() calls

export class Hud {
  constructor(dom) {
    this.dom = dom; // { panels, toast, objective }
    this.items = new Map();
    this.game = null; // set once the game object exists, passed to render()
    this.toastT = 0;
    this.renderT = 0;
  }

  // spec: an element, or { order, el?, render?(el, game) }. Returns the panel's container; lower
  // order comes first. render() runs about ten times a second: update text in place, do not rebuild.
  add(id, spec) {
    this.remove(id);
    const el = document.createElement('div');
    el.className = 'hud-item';
    el.dataset.id = id;
    const node = spec instanceof Element ? spec : spec.el;
    if (node) el.append(node);
    el.style.order = (spec instanceof Element ? 0 : spec.order) ?? 0;
    this.dom.panels.append(el);
    const item = { el, render: spec instanceof Element ? null : spec.render };
    this.items.set(id, item);
    item.render?.(el, this.game);
    return el;
  }

  remove(id) {
    this.items.get(id)?.el.remove();
    this.items.delete(id);
  }

  toast(text, seconds = 1.8) {
    this.dom.toast.textContent = text;
    this.dom.toast.classList.add('show');
    this.toastT = seconds;
  }

  // One line under the top edge, or nothing for null.
  setObjective(text) {
    this.dom.objective.textContent = text || '';
    this.dom.objective.classList.toggle('hidden', !text);
  }

  update(dt) {
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) this.dom.toast.classList.remove('show');
    if ((this.renderT -= dt) > 0) return;
    this.renderT = RENDER_EVERY;
    for (const it of this.items.values()) it.render?.(it.el, this.game);
  }
}
