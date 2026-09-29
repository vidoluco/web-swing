import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Red suit fabric: thin dark web lines over the base colour.
export function webPatternTexture(base = '#c3141c') {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(10,0,0,0.75)';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.stroke();
  }
  for (let j = 0; j <= 256; j += 24) {
    g.beginPath();
    for (let i = 0; i <= 256; i += 32) {
      const y = j + 6 * Math.sin((i / 32) * Math.PI);
      if (i === 0) g.moveTo(i, y);
      else g.quadraticCurveTo(i - 16, j + 9, i, y);
    }
    g.stroke();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

export function spiderEmblemTexture(color = '#111', big = false) {
  const [c, g] = canvas(256, 256);
  g.translate(128, 128);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = 'round';
  const s = big ? 1.25 : 1;
  g.beginPath();
  g.ellipse(0, -18 * s, 16 * s, 22 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(0, 26 * s, 20 * s, 34 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 9 * s;
  const legs = [
    [[-12, -26], [-50, -70], [-70, -40]],
    [[-12, -14], [-66, -30], [-96, 6]],
    [[-12, 6], [-60, 30], [-86, 80]],
    [[-12, 18], [-40, 60], [-50, 110]],
  ];
  for (const side of [1, -1]) {
    for (const leg of legs) {
      g.beginPath();
      g.moveTo(leg[0][0] * side * s, leg[0][1] * s);
      g.lineTo(leg[1][0] * side * s, leg[1][1] * s);
      g.lineTo(leg[2][0] * side * s, leg[2][1] * s);
      g.stroke();
    }
  }
  return tex(c);
}

const ADS = [
  { bg: ['#d4143a', '#8a0620'], text: 'BROADWAY', sub: 'TICKETS', fg: '#fff' },
  { bg: ['#ffffff', '#e9e9e9'], text: 'RAMEN', sub: 'OPEN 24H', fg: '#c8102e' },
  { bg: ['#0e7a3e', '#054d25'], text: 'SNEAKERS', sub: 'NEW DROP', fg: '#fff' },
  { bg: ['#0a5d78', '#083549'], text: 'DRUGSTORE', sub: 'OPEN 24 HOURS', fg: '#fff' },
  { bg: ['#ffcc00', '#ff8a00'], text: 'FIZZ', sub: 'COLA', fg: '#b3001b' },
  { bg: ['#1b1464', '#6a1b9a'], text: 'ORBIT', sub: 'PHONES', fg: '#7df9ff' },
  { bg: ['#ff5f6d', '#ffc371'], text: 'PULSE', sub: 'MUSIC', fg: '#fff' },
  { bg: ['#101010', '#303030'], text: 'THE GLOBE', sub: 'DAILY NEWS', fg: '#f5f5f5' },
  { bg: ['#00b4db', '#0083b0'], text: 'SKYLINE', sub: 'AIRWAYS', fg: '#fff' },
  { bg: ['#f7971e', '#ffd200'], text: 'PIZZA', sub: 'BY THE SLICE', fg: '#7a1d00' },
  { bg: ['#11998e', '#38ef7d'], text: 'FRESH', sub: 'JUICE BAR', fg: '#063' },
  { bg: ['#833ab4', '#fd1d1d'], text: 'NEON', sub: 'THE MUSICAL', fg: '#fff' },
];

export function adTexture(k) {
  const ad = ADS[k % ADS.length];
  const [c, g] = canvas(512, 384);
  const grd = g.createLinearGradient(0, 0, 512, 384);
  grd.addColorStop(0, ad.bg[0]);
  grd.addColorStop(1, ad.bg[1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 384);
  g.globalAlpha = 0.15;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 384, 40 + Math.random() * 120, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = ad.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${ad.text.length > 7 ? 86 : 118}px "Helvetica Neue", Arial, sans-serif`;
  g.fillText(ad.text, 256, 170);
  g.font = '700 40px "Helvetica Neue", Arial, sans-serif';
  g.fillText(ad.sub, 256, 270);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 502, 374);
  return tex(c);
}

export const AD_COUNT = ADS.length;

export function tickerTexture() {
  const [c, g] = canvas(4096, 128);
  g.fillStyle = '#060606';
  g.fillRect(0, 0, 4096, 128);
  const items = [
    'CAR HEIST ON 7TH AVE',
    'DOW 38,221 ▲ 0.4%',
    'KNIGHTS WIN 104-99 IN OT',
    'MASKED HERO SPOTTED OVER MIDTOWN',
    'SUNNY, HIGH 24°C',
    'SUBWAY SERVICE RESTORED ON THE A LINE',
    'NASDAQ 17,402 ▼ 0.2%',
    'CITY MARATHON ROUTE ANNOUNCED',
  ];
  g.font = '700 72px "Helvetica Neue", Arial, sans-serif';
  g.textBaseline = 'middle';
  let x = 20;
  let i = 0;
  while (x < 4096) {
    const s = items[i % items.length];
    g.fillStyle = i % 2 ? '#ffd23f' : '#ff4d4d';
    g.fillText(s, x, 66);
    x += g.measureText(s).width + 40;
    g.fillStyle = '#fff';
    g.fillText('•', x, 66);
    x += 70;
    i++;
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function storeSignTexture(text, bg, fg) {
  const [c, g] = canvas(512, 96);
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  g.font = '900 64px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  return tex(c);
}
