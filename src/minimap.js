// Heading-up minimap of the real streets, redrawn around the player, plus a compass strip.
export class Minimap {
  constructor(city, canvas, compass) {
    this.city = city;
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.k = compass;
    this.kg = compass.getContext('2d');
    this.scale = 1.1; // px per metre on a 200 px wide map
    this.t = 0;
    this.cells = city.mmCells;
    this.markers = new Map(); // owner id -> [{ x, z, color, shape, label? }]
  }

  // Each system owns its own set of markers; a new call replaces it, an empty list clears it.
  // shape is 'dot', 'ring' or 'square'. Markers off the map stick to its edge, pointing the way.
  setMarkers(owner, list) {
    if (list?.length) this.markers.set(owner, list);
    else this.markers.delete(owner);
  }

  toggleZoom() {
    this.scale = this.scale > 0.7 ? 0.4 : 1.1;
  }

  poly(g, pts) {
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
  }

  drawMarkers(g, W, H, s, pos, yaw) {
    if (!this.markers.size) return;
    const k = W / (this.c.clientWidth || 190); // canvas pixels per CSS pixel, so sizes and labels hold on a phone
    const cos = Math.cos(yaw), sin = Math.sin(yaw), pad = 8 * k;
    g.font = `700 ${Math.round(13 * k)}px system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const list of this.markers.values()) {
      for (const m of list) {
        const a = (m.x - pos.x) * s, b = (m.z - pos.z) * s;
        let x = cos * a - sin * b, y = sin * a + cos * b;
        const off = Math.abs(x) > W / 2 - pad || Math.abs(y) > H / 2 - pad;
        if (off) {
          const t = Math.min((W / 2 - pad) / (Math.abs(x) || 1e-6), (H / 2 - pad) / (Math.abs(y) || 1e-6));
          x *= t;
          y *= t;
        }
        x += W / 2;
        y += H / 2;
        const r = (off ? 3.5 : 4.5) * k;
        g.globalAlpha = off ? 0.8 : 1;
        g.strokeStyle = '#000';
        g.fillStyle = m.color;
        g.beginPath();
        if (m.shape === 'square') g.rect(x - r, y - r, r * 2, r * 2);
        else g.arc(x, y, m.shape === 'ring' ? r * 1.2 : r, 0, Math.PI * 2);
        if (m.shape === 'ring') {
          g.lineWidth = 4.6 * k;
          g.stroke();
          g.strokeStyle = m.color;
          g.lineWidth = 2.4 * k;
          g.stroke();
        } else {
          g.lineWidth = 1.5 * k;
          g.fill();
          g.stroke();
        }
        if (m.label && !off) {
          g.lineWidth = 3 * k;
          g.strokeStyle = 'rgba(0,0,0,0.8)';
          g.strokeText(m.label, x + r + 3 * k, y);
          g.fillStyle = '#fff';
          g.fillText(m.label, x + r + 3 * k, y);
        }
      }
    }
    g.globalAlpha = 1;
  }

  draw(dt, pos, yaw, anchor) {
    this.t += dt;
    if (this.t < 1 / 15) return;
    this.t = 0;
    const g = this.g, W = this.c.width, H = this.c.height, s = this.scale * (W / 200);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1b4aa8';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(yaw);
    g.scale(s, s);
    g.translate(-pos.x, -pos.z);
    const R = Math.ceil(Math.hypot(W, H) / 2 / s / 200) + 1;
    const cx = Math.floor(pos.x / 200), cz = Math.floor(pos.z / 200);
    const buckets = [];
    for (let i = cx - R; i <= cx + R; i++) for (let j = cz - R; j <= cz + R; j++) {
      const b = this.cells.get(i * 1000 + j);
      if (b) buckets.push(b);
    }
    g.fillStyle = '#3f9c5a';
    g.beginPath();
    for (const b of buckets) for (const p of b.g) this.poly(g, p);
    g.fill();
    g.fillStyle = '#0d2f73';
    g.beginPath();
    for (const b of buckets) for (const p of b.w) this.poly(g, p);
    g.fill();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const major of [false, true]) {
      g.strokeStyle = major ? '#ffffff' : '#8fb2f0';
      g.beginPath();
      for (const b of buckets) {
        for (const r of b.r) {
          if (r.cls === 'river' || r.cls === 'foot' || !!r.major !== major) continue;
          const p = r.pts;
          g.moveTo(p[0], p[1]);
          for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
        }
      }
      g.lineWidth = (major ? 9 : 5) / Math.max(s, 0.6);
      g.stroke();
    }
    g.fillStyle = '#6f95e6';
    g.beginPath();
    for (const b of buckets) for (const p of b.b) this.poly(g, p);
    g.fill();
    // Places to drink: amber for bars, pale gold for kiosks.
    for (const b of buckets) {
      for (const p of b.p || []) {
        g.fillStyle = p.kind === 0 ? '#ffb000' : '#f3e39a';
        g.beginPath();
        g.arc(p.x, p.z, (p.kind === 0 ? 5 : 3.5) / s, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (anchor) {
      g.strokeStyle = '#fff';
      g.lineWidth = 2 / s;
      g.beginPath();
      g.moveTo(pos.x, pos.z);
      g.lineTo(anchor.x, anchor.z);
      g.stroke();
    }
    g.restore();
    this.drawMarkers(g, W, H, s, pos, yaw);
    g.fillStyle = '#ffd400';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2, H / 2 - 12);
    g.lineTo(W / 2 + 8, H / 2 + 9);
    g.lineTo(W / 2, H / 2 + 4);
    g.lineTo(W / 2 - 8, H / 2 + 9);
    g.closePath();
    g.fill();
    g.stroke();

    const kg = this.kg, KW = this.k.width, KH = this.k.height;
    kg.clearRect(0, 0, KW, KH);
    kg.fillStyle = 'rgba(0,0,0,0.55)';
    kg.fillRect(0, 0, KW, KH);
    kg.font = `700 ${Math.round(KH * 0.62)}px system-ui, sans-serif`;
    kg.textAlign = 'center';
    kg.textBaseline = 'middle';
    const heading = ((-yaw * 180) / Math.PI + 360) % 360;
    const pxPerDeg = KW / 120;
    for (let d = 0; d < 360; d += 15) {
      const diff = ((d - heading + 540) % 360) - 180;
      const x = KW / 2 + diff * pxPerDeg;
      if (x < -10 || x > KW + 10) continue;
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d];
      kg.fillStyle = label ? (label === 'N' ? '#ff6b6b' : '#fff') : 'rgba(255,255,255,0.55)';
      if (label) kg.fillText(label, x, KH / 2 + 1);
      else kg.fillRect(x - 1, KH * 0.35, 2, KH * 0.3);
    }
    kg.fillStyle = '#ffd400';
    kg.fillRect(KW / 2 - 1, 0, 2, 4);
  }
}
