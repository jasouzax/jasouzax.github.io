/* =====================================================================
   memory.js: the "Memory" theme engine
   - builds the interactive SVG background (dream sky, checker hall, mosaic globe, floating things)
   - wraps the name in ransom-note letters
   - hands the WebGL contour map over while the theme is on
   - WebGPU scene extras: wind-blown shallow waves (pointer wake + click ripples) with ground mist, a Fly Agaric
     with an eye waiting at the end of the corridor, and confetti when a balloon pops (shared with the SVG fallback)
   Everything is inert unless the Memory radio (#theme_name_memory) is checked.
   Palette: edit PALETTE below. Each colour has 3 stops: [day dream, dusk, the void]; scrolling descends through them.
   ===================================================================== */
const getRadio = () => document.getElementById("theme_name_memory");

const NS = 'http://www.w3.org/2000/svg';
const root = document.documentElement;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fx = n => Math.round(n * 10) / 10;
const rng = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const rand = rng(1999);

/* ---------- palette: [day, dusk, void] ---------- */
const PALETTE = {
  light: {
    'sky-top': ['#3563e8', '#3b1f94', '#08041f'], 'sky-mid': ['#8aa5fb', '#a8409e', '#1d0b47'], 'sky-low': ['#d3caf8', '#ff93b4', '#6a1b86'],
    'haze': ['#f4eaff', '#ffd1a1', '#ff4fd0'], 'cloud': ['#ffffff', '#ffd9f0', '#7d4cc0'], 'cloud-shade': ['#aeb0f0', '#b14fb4', '#1e0c42'],
    'lit': ['#d9d0ff', '#f2b8ff', '#8f6af0'], 'mid': ['#a79df0', '#a35dd9', '#4a2a96'], 'dark': ['#6b60d6', '#5d2aa3', '#1a0c45'],
    'tile-a': ['#f1f1ff', '#ffdcf2', '#43307f'], 'tile-b': ['#5a62dc', '#7d38c4', '#0c0625'],
    'grass-a': ['#63c93f', '#86b53c', '#1d6a43'], 'grass-b': ['#2c982a', '#4d7d2b', '#0a2f22'],
    'sea-a': ['#0a3cb0', '#25097a', '#06020f'], 'sea-m': ['#1c5cdc', '#4a22b0', '#1a0d6a'], 'sea-b': ['#2f7cff', '#7b3df2', '#3a20a8'],
    'land-a': ['#1f8a3c', '#2f8a52', '#0f8a6a'], 'land-m': ['#3fa844', '#5aa865', '#37cfa8'], 'land-b': ['#86d65a', '#ffc96b', '#5dfff0'],
    'gcloud': ['#ffffff', '#ffe3f6', '#b78cff'],
    'balloon': ['#f26ad2', '#ff58b5', '#ff3ba5'], 'balloon-d': ['#a31f86', '#a3185f', '#8a0f66'],
    'iris-a': ['#3fa6ff', '#ff63d8', '#8dff9f'], 'iris-b': ['#0a3a9e', '#58108f', '#07422b'], 'glow': ['#ffa3ee', '#ffb347', '#00f0ff'],
    'cap': ['#e0212f', '#ea2640', '#f0243c'], 'cap-d': ['#8c0f26', '#8a1040', '#7a0c4a'], 'stem': ['#fff4e2', '#ffe4ee', '#ffe0ff'], 'stem-d': ['#c9b3c8', '#b88aa8', '#7a5ab0'],
  },
  dark: {
    'sky-top': ['#101a66', '#12063a', '#02010a'], 'sky-mid': ['#3b34b3', '#5f1a93', '#0b032b'], 'sky-low': ['#8d6ae0', '#e03e8c', '#3a0b5a'],
    'haze': ['#ffb8f2', '#ff9e72', '#ff2bd6'], 'cloud': ['#cdbcff', '#e9a7e6', '#55308f'], 'cloud-shade': ['#4d3fa8', '#7a2a8a', '#150836'],
    'lit': ['#a791ff', '#d58bff', '#7a58e0'], 'mid': ['#5d49c8', '#7a3ac0', '#3a2090'], 'dark': ['#251a78', '#34135f', '#120838'],
    'tile-a': ['#c9c2ff', '#f4b6e8', '#392a73'], 'tile-b': ['#2a2690', '#4b1f8f', '#070418'],
    'grass-a': ['#3fa44a', '#6c9a3a', '#1c6a45'], 'grass-b': ['#19692e', '#38601f', '#082a1e'],
    'sea-a': ['#071a66', '#180654', '#04010c'], 'sea-m': ['#1540b8', '#3a1a98', '#160a58'], 'sea-b': ['#2559d8', '#6a30d8', '#3318a0'],
    'land-a': ['#1c7a3e', '#2f8a52', '#0f8a6a'], 'land-m': ['#3a9e48', '#5aa865', '#37cfa8'], 'land-b': ['#6ccf52', '#ffb85c', '#5dfff0'],
    'gcloud': ['#e6dcff', '#ffd0f0', '#b78cff'],
    'balloon': ['#ff6fd0', '#ff4fb0', '#ff3ba5'], 'balloon-d': ['#a31f86', '#a3185f', '#8a0f66'],
    'iris-a': ['#5fb4ff', '#ff6fe0', '#8dff9f'], 'iris-b': ['#0a3a9e', '#58108f', '#07422b'], 'glow': ['#ff9be8', '#ffa040', '#00f0ff'],
    'cap': ['#e8283c', '#f02a48', '#f52a42'], 'cap-d': ['#7a0c22', '#7a0e3a', '#6a0a40'], 'stem': ['#f6e8d6', '#f4d4e6', '#e8c8ff'], 'stem-d': ['#9a86a8', '#8a5a90', '#5a3a98'],
  },
};
const TOKENS = Object.keys(PALETTE.light);
const hex = h => { h = h.replace('#', ''); const n = parseInt(h, 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const PAL = {};
for (const m of ['light', 'dark']) { PAL[m] = {}; for (const t of TOKENS) PAL[m][t] = PALETTE[m][t].map(hex); }

/* ---------- land bitmap (256x128 equirectangular, 1 bit per pixel, from contour.js) ---------- */
const LAND_W = 256, LAND_H = 128;
const LAND = (() => { const b = atob('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v8DgP8/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOD///z///8fAAAAAAAAAAAAGAAAAAAAAAAAAAAAAAAA4P8D/////wcAAP8DAAAAAAB4AAAAAAAAAAAAAAAAAAAE/OH/////AwAAnAEAAAAAAAAAAAAAAAAAAAAAAAAeAGj+wP////8DAAAAAAAAQAAAAA8AAAAAAAAAAAAAAMAf038AwP///wMAAAAAAAAOAMD//wEAPAAAAAAAAAAAHwByAAAA////AQAAAAAAgAEA4P//AAAAAAAAAAAAAID3Gzf/AwD+//8AAAAAAADgAA7+////D3gAAAABgAEAAPA/MP4/APz//wAAAAAcAMAA5////////w8AAADw/x++5v90OP4A/P9/AAAA4P8AABj//////////wMOAPz///9/GOQ5/AH8/wMAAAD4/4/x/+7///////////8A8P///////x/wD/z/AAAAAPz/n/3/9////////////wD+////////C/4E+A+APwAAf/zh////////////////AOD///////8I8AP4BwAPAIB//////////////////38A+P//////PwDAAPADAAAA4J//////////////////fwD8//////8fAD4A4AMAAADwn///////////////f/QHAOA34P///x8AfgQAAAAAAPAf8P////////////8/GAAAAAOA////PwD+BwAAAAAQMA/+////////////DwAGAACAAAD+////AP4PAAAAADBAhv////////////8HgA8AACAAAPz///8P/h8AAAAAcECB/////////////wGABwAAAAAA+P///z//fwAAAADMwPv/////////////A4ADAAAAAADw////P///AAAAAO75//////////////8/gAEAAAAAAOD///////8AAAAA4P3//////////////y8AAAAAAAAA4P//////gAAAAAAA////////////////LwAAAAAAAAAA/v/////DAwAAAMD///////////////8nAAAAAAAAAAD//////wMAAAAAwP///////////////ycAAAAAAAAAAP//////DwAAAACA//+f+cP/////////AwAAAAAAAAAA//////8GAAAAAID/+Q/48f////////8hAAAAAAAAAID/////PwAAAAAA/AfjD+Dj////////P3AAAAAAAAAAgP////8/AAAAAAD8A8aP44f///////8PAAAAAAAAAAAA/////wcAAAAAAPxAyPn/x///////nwcQAAAAAAAAAAD/////BwAAAAAA/gCI+f/H//////8PBggAAAAAAAAAAP7///8DAAAAAAB8AIb4/8///////38MDAAAAAAAAAAA/P///wMAAAAAABD/AAD8////////HwwOAAAAAAAAAAD8////AQAAAAAA+P8AAPz///////8f4AMAAAAAAAAAAPD///8AAAAAAAD8/wAA/v///////z8wAAAAAAAAAAAA4P//PwAAAAAAAP7/xwP/////////fwAAAAAAAAAAAABA//8/AAAAAAAA/v////////////9/AAAAAAAAAAAAAED/DyAAAAAAAAD///////P//////38AAAAAAAAAAAAAgP4HYAAAAAAAgP/////+5///////PwAAAAAAAAAAAAAA/QdAAAAAAADA//////0P/v////8fAAAAAAAAAAAAAAD4BwAAAAAAAOD//////Z8A/////08AAAAAAAAAAAAAAPAHAAAAAAAA4P/////5/wP+////BwAAAAAAAAAAAAAA4AeAAQAAAADw//////P/A/5//n8AAAAAAAAAAAAAAADgBwMCAAAAAPD/////8/8B8D/8DwAAAAAAAAAAAAAAAMCPA3AAAAAA8P/////n/wHwD/hnAAAAAAAAAAAAAAAAAP8BAAAAAADw/////8d/APAH+A9AAAAAAAAAAAAAAAAA/AEAAAAAAPD/////zx8A8APoH2AAAAAAAAAAAAAAAACAHwAAAAAA8P/////fDwDgAcAfQAAAAAAAAAAAAAAAAAAeAAAAAADw/////78BAOABwD8AAAAAAAAAAAAAAAAAABwAAAAAAOD/////fwAAwAFAPgAAAAAAAAAAAAAAAAAAGPgNAAAAwP//////DwDAAQAcAAAAAAAAAAAAAAAAAAAw/B8AAACA//////8PAIAAQAAAAgAAAAAAAAAAAAAAAED/PwAAAID//////wcAAANAAIADAAAAAAAAAAAAAAAAAP5/AAAAAP/9////BwAAAoAACAAAAAAAAAAAAAAAAAAA/v8HAAAADPD///8DAAAAEAEMAAAAAAAAAAAAAAAAAAD+/w8AAAAAgP///wEAAABgAw4AAAAAAAAAAAAAAAAAAP//DwAAAACA////AAAAAMCCDwAAAAAAAAAAAAAAAACA//8PAAAAAID//38AAAAAwMFPAAAAAAAAAAAAAAAAAID//z8AAAAAwP//PwAAAACAwydAAAAAAAAAAAAAAAAAgP///wAAAACA//8fAAAAAADHZ0AGAAAAAAAAAAAAAACA////DwAAAAD//w8AAAAAAAZiyD8AAAAAAAAAAAAAAMD///8/AAAAAP7/DwAAAAAABCAA/gAAAAAAAAAAAAAAgP///38AAAAA/v8PAAAAAAAYAAD8AQAAAAAAAAAAAACA////fwAAAAD+/w8AAAAAAOABAPwBAAAAAAAAAAAAAAD///9/AAAAAP7/DwAAAAAAAAABIAIAAAAAAAAAAAAAAP///z8AAAAA/P8fAAAAAAAAAAAAAAAAAAAAAAAAAAAA/v//HwAAAAD8/x8AAAAAAAAAQCAAAAAAAAAAAAAAAAD+//8fAAAAAP7/HwQAAAAAAADgIQAAAAAAAAAAAAAAAPz//w8AAAAA/v8fDAAAAAAAAPZgAAAAAAAAAAAAAAAA8P//DwAAAAD//w8HAAAAAAAA//MAAAAAAAAAAAAAAADg//8PAAAAAP//hwcAAAAAAID/9wAAAAAAAAAAAAAAAMD//w8AAAAA/v8BBwAAAAAAwP//AAAAAAAAAAAAAAAAwP//BwAAAAD+/4EHAAAAAADw//8DAAAAAAAAAAAAAADA//8HAAAAAPz/gQMAAAAAAPz//wMAAAAAAAAAAAAAAMD//wEAAAAA/P+BAwAAAAAA/v//BwAAAAAAAAAAAAAAwP9/AAAAAAD8/4ABAAAAAAD+//8PAAAAAAAAAAAAAADA/z8AAAAAAPh/AAAAAAAAAP7//x8AAAAAAAAAAAAAAMD/HwAAAAAA+H8AAAAAAAAA/v//HwAAAAAAAAAAAAAA4P8fAAAAAADwfwAAAAAAAAD8//8fAAAAAAAAAAAAAADg/w8AAAAAAPA/AAAAAAAAAPz//x8AAAAAAAAAAAAAAOD/BwAAAAAA4B8AAAAAAAAA/M//HwAAAAAAAAAAAAAA4P8DAAAAAADgDwAAAAAAAAD8AP8PAAAAAAAAAAAAAADg/wEAAAAAAEAAAAAAAAAAABwA/QcAAAAAAAAAAAAAAPB/AAAAAAAAAAAAAAAAAAAAAAD4BwAIAAAAAAAAAAAA8H8AAAAAAAAAAAAAAAAAAAAAAPADABAAAAAAAAAAAADwPwAAAAAAAAAAAAAAAAAAAAAAAAEAcAAAAAAAAAAAAPAPAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAA+AMAAAAAAAAAAAAAAAAAAAAAAIABAAQAAAAAAAAAAADwAwAAAAAAAAAAAAAAAAAAAAAAAAEABgAAAAAAAAAAAPABAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAgAEAAAAAAAAAAAD4AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/AAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAADwAQBAgOfP/wEAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAP//Af7//////wEAAAAAAAAAAAAAAKAHAAAAAAAAAID3///B/////////wEAAAAAAAAAAAAAYA8AAAAAAPz///////n//////////wAAAAAAAAAABwAgDwAAAID/////////////////////AQAAAAAAAID///8PAAAA4P////////////////////8AAAAA+f///////wMAAAD4////////////////////HwAAAID///////8fAAAA8P////////////////////8PAAAA/////////wcAwAD//////////////////////x8AAADg////////AQDwAfj/////////////////////BwAAAID///////8/AAAA/v////////////////////8DAAAA+P////////8f+P///////////////////////x8AAAD4/////////////////////////////////////wEAAMADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; })();
const isLand = (lon, lat) => {
  const x = ((Math.floor((lon / (Math.PI * 2) + .5) * LAND_W) % LAND_W) + LAND_W) % LAND_W;
  const y = clamp(Math.floor((.5 - lat / Math.PI) * LAND_H), 0, LAND_H - 1);
  const i = y * LAND_W + x; return (LAND[i >> 3] >> (i & 7)) & 1;
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/* ---------- svg helpers ---------- */
function el(tag, attrs, parent, html) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
const tf = (x, y, rot = 0, sc = 1) => `translate(${fx(x)} ${fx(y)})${rot ? ` rotate(${fx(rot)})` : ''}${sc !== 1 ? ` scale(${sc})` : ''}`;
function jagged(w, h, step, amp, r = rand) {
  const p = [], hw = w / 2, hh = h / 2, j = () => (r() - .5) * amp;
  for (let x = -hw; x < hw; x += step) p.push([x, -hh + j()]);
  for (let y = -hh; y < hh; y += step) p.push([hw + j(), y]);
  for (let x = hw; x > -hw; x -= step) p.push([x, hh + j()]);
  for (let y = hh; y > -hh; y -= step) p.push([-hw + j(), y]);
  return 'M' + p.map(q => fx(q[0]) + ' ' + fx(q[1])).join('L') + 'Z';
}

/* ---------- state ---------- */
const S = {
  on: false, svg: null, W: 0, H: 0, u: 1, portrait: false,
  p: 0, pTarget: 0, tx: 0, ty: 0, px: 0, py: 0, time: 0, dark: false,
  hy: 0, vx: 0, tileW: 100, S: 100, hc: 3, zb: 1.4,
  spin: 0.6, spinV: 0.07, bodies: [], eyes: [], doors: [], balloons: [], parts: [],
  glitch: null, nextGlitch: 3, floorT: 0, floorKey: '', ripple: 0, rippleT0: 0,
  hover: null, note: 0, noteOverride: -1, lastMove: 0, pv: { x: 0, y: 0 },
};
let stillV = false;
const refreshStill = () => { stillV = matchMedia('(prefers-reduced-motion: reduce)').matches || !!document.getElementById('motion_pause')?.checked; };
const still = () => stillV;

/* =====================================================================
   BUILD
   ===================================================================== */
function defsMarkup() {
  const st = (o, c, op) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`;
  const cloud = (id, pts) => `<g id="${id}"><ellipse cx="0" cy="34" rx="150" ry="24" fill="url(#m-cs)"/>${pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#m-cg)"/>`).join('')}</g>`;
  return `<defs>
<linearGradient id="m-sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="600">${st(0, 'var(--m-sky-top)')}${st(.55, 'var(--m-sky-mid)')}${st(1, 'var(--m-sky-low)')}</linearGradient>
<radialGradient id="m-haze" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="500">${st(0, 'var(--m-haze)', .95)}${st(.5, 'var(--m-haze)', .35)}${st(1, 'var(--m-haze)', 0)}</radialGradient>
<radialGradient id="m-cg">${st(0, 'var(--m-cloud)', .95)}${st(.55, 'var(--m-cloud)', .7)}${st(1, 'var(--m-cloud)', 0)}</radialGradient>
<radialGradient id="m-cs">${st(0, 'var(--m-cloud-shade)', .55)}${st(1, 'var(--m-cloud-shade)', 0)}</radialGradient>
<linearGradient id="m-gloss" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="600">${st(0, 'var(--m-haze)', .92)}${st(.3, 'var(--m-sky-low)', .4)}${st(1, 'var(--m-sky-low)', 0)}</linearGradient>
<linearGradient id="m-band" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">${st(0, 'var(--m-haze)', 0)}${st(.62, 'var(--m-haze)', .9)}${st(1, 'var(--m-haze)', 0)}</linearGradient>
<radialGradient id="m-bal" cx=".35" cy=".3" r=".8">${st(0, '#fff', .95)}${st(.22, 'var(--m-balloon)')}${st(1, 'var(--m-balloon-d)')}</radialGradient>
<radialGradient id="m-sph" cx=".38" cy=".34" r=".75">${st(0, '#000', 0)}${st(.55, '#000', 0)}${st(.82, 'var(--m-sea-a)', .4)}${st(1, '#02031c', .85)}</radialGradient>
<radialGradient id="m-atmo">${st(.55, 'var(--m-glow)', 0)}${st(.62, 'var(--m-glow)', .5)}${st(.75, 'var(--m-haze)', .12)}${st(1, 'var(--m-haze)', 0)}</radialGradient>
<linearGradient id="m-xp" x1="0" y1="0" x2="0" y2="1">${st(0, '#0058e6')}${st(.1, '#3a93ff')}${st(.2, '#288bff')}${st(.55, '#0f6cf0')}${st(.9, '#0a5be0')}${st(1, '#0840b8')}</linearGradient>
<radialGradient id="m-irisg">${st(0, 'var(--m-iris-b)')}${st(.3, 'var(--m-iris-b)')}${st(.42, 'var(--m-iris-a)')}${st(.8, 'var(--m-iris-b)')}${st(1, '#070826')}</radialGradient>
<radialGradient id="m-scl">${st(0, '#fff')}${st(.7, '#f3e9ff')}${st(1, '#cdb9ea')}</radialGradient>
<radialGradient id="m-lid" cx=".5" cy=".1" r=".7">${st(0, '#10104a', .55)}${st(1, '#10104a', 0)}</radialGradient>
<linearGradient id="m-wood" x1="0" y1="0" x2="1" y2="1">${st(0, '#f1b6bd')}${st(1, '#9a4f78')}</linearGradient>
<radialGradient id="m-spill">${st(0, '#fff', .85)}${st(.45, 'var(--m-glow)', .35)}${st(1, 'var(--m-glow)', 0)}</radialGradient>
<linearGradient id="m-di1" x1="0" y1="0" x2="0" y2="1">${st(0, '#2a6ee8')}${st(1, '#c7deff')}</linearGradient>
<radialGradient id="m-di2" cx=".5" cy=".6" r=".7">${st(0, '#ffe0f8')}${st(.5, '#c25be0')}${st(1, '#40208c')}</radialGradient>
<linearGradient id="m-di3" x1="0" y1="0" x2="0" y2="1">${st(0, '#ffd2f1')}${st(1, '#ff6fcb')}</linearGradient>
<linearGradient id="m-di0" x1="0" y1="0" x2="0" y2="1">${st(0, '#40208c')}${st(1, '#150a40')}</linearGradient>
<linearGradient id="m-bs" x1="0" y1="0" x2="0" y2="1">${st(0, '#2f6fe0')}${st(1, '#a9ccf8')}</linearGradient>
<linearGradient id="m-bh" x1="0" y1="0" x2="0" y2="1">${st(0, '#7ad656')}${st(1, '#2a8a22')}</linearGradient>
<radialGradient id="m-vig" cx=".5" cy=".5" r=".75">${st(.55, '#0a0030', 0)}${st(1, '#0a0030', .55)}</radialGradient>
<pattern id="m-chk" width="48" height="48" patternUnits="userSpaceOnUse" patternTransform="rotate(9)"><rect width="48" height="48" fill="#f6f2ff"/><rect width="24" height="24" fill="#150f2e"/><rect x="24" y="24" width="24" height="24" fill="#150f2e"/></pattern>
<pattern id="m-chk2" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" fill="#f6f2ff"/><rect width="14" height="14" fill="#150f2e"/><rect x="14" y="14" width="14" height="14" fill="#150f2e"/></pattern>
<filter id="m-glitch" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" color-interpolation-filters="sRGB">
<feTurbulence id="m-gt" type="fractalNoise" baseFrequency="0.0004 0.2" numOctaves="1" seed="3" result="n"/>
<feDisplacementMap id="m-gd" in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feColorMatrix in="d" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
<feColorMatrix in="d" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb"/>
<feOffset id="m-go" in="r" dx="8" dy="0" result="ro"/>
<feBlend in="ro" in2="gb" mode="screen"/></filter>
${cloud('m-cloudA', [[-100, 10, 44], [-48, -14, 62], [14, -26, 72], [78, -8, 58], [124, 14, 42], [0, 16, 78], [-64, 22, 54], [62, 24, 56]])}
${cloud('m-cloudB', [[-70, 8, 40], [-18, -16, 56], [44, -8, 52], [92, 12, 38], [10, 18, 62]])}
${cloud('m-cloudC', [[-120, 14, 40], [-70, -10, 56], [-8, -30, 68], [54, -16, 60], [112, 4, 52], [150, 20, 36], [20, 20, 80], [-60, 24, 60]])}
</defs>`;
}

/* ----- eyes ----- */
function makeEye(parent, a, o = {}) {
  const b = a * .56, g = el('g', {}, parent);
  const blinkG = el('g', {}, g);
  const clipId = 'm-ec' + (S.eyes.length + 1);
  const almond = `M${-a} 0C${-a * .45} ${-b * 1.5} ${a * .45} ${-b * 1.5} ${a} 0C${a * .45} ${b * 1.5} ${-a * .45} ${b * 1.5} ${-a} 0Z`;
  el('clipPath', { id: clipId }, blinkG, `<path d="${almond}"/>`);
  if (o.glow) el('path', { d: almond, fill: 'none', stroke: 'var(--m-glow)', 'stroke-width': a * .09, opacity: .35 }, blinkG);
  const clipped = el('g', { 'clip-path': `url(#${clipId})` }, blinkG);
  el('rect', { x: -a, y: -b * 1.6, width: a * 2, height: b * 3.2, fill: 'url(#m-scl)' }, clipped);
  const veins = el('g', { stroke: '#e4568a', 'stroke-width': Math.max(.6, a * .012), fill: 'none', opacity: .5 }, clipped);
  for (let i = 0; i < 6; i++) { const s = i < 3 ? -1 : 1, y = (rand() - .5) * b * 1.3; el('path', { d: `M${s * a} ${fx(y)}Q${s * a * .75} ${fx(y + (rand() - .5) * b * .6)} ${s * a * (.5 + rand() * .15)} ${fx(y * .5)}` }, veins); }
  const pup = el('g', {}, clipped);
  const ir = b * 1.0;
  el('circle', { r: ir, fill: 'url(#m-irisg)' }, pup);
  el('circle', { r: ir * .36, fill: '#05051a' }, pup);
  el('circle', { cx: -ir * .3, cy: -ir * .34, r: ir * .15, fill: '#fff', opacity: .92 }, pup);
  el('circle', { cx: ir * .22, cy: ir * .28, r: ir * .07, fill: '#fff', opacity: .6 }, pup);
  el('ellipse', { cx: 0, cy: -b * 1.05, rx: a * 1.02, ry: b * .9, fill: 'url(#m-lid)' }, clipped);
  el('path', { d: almond, fill: 'none', stroke: '#14123f', 'stroke-width': Math.max(1.2, a * .045), 'stroke-linejoin': 'round' }, blinkG);
  const lash = el('path', { fill: 'none', stroke: '#14123f', 'stroke-width': Math.max(1, a * .03), 'stroke-linecap': 'round' }, blinkG);
  let d = ''; for (let i = 0; i < 7; i++) { const t = (i + 1) / 8, x = lerp(-a * .8, a * .8, t), y = -b * 1.09 * Math.sin(Math.PI * t) * .99; d += `M${fx(x)} ${fx(y)}l${fx((t - .5) * a * .12)} ${fx(-b * .22)}`; } lash.setAttribute('d', d);
  const eye = { g, blinkG, pup, a, b, travel: b * .42, ox: 0, oy: 0, bl: 1, next: 1 + rand() * 4, t0: -9, parent: null, lx: 0, ly: 0, wander: rand() * 6 };
  S.eyes.push(eye); return eye;
}

/* ----- floating bodies ----- */
function makeBody(layer, kind, o = {}) {
  const g = el('g', {}, layer);
  const b = Object.assign({
    g, kind, bx: 0, by: 0, rot: 0, sc: 1, ox: 0, oy: 0, vx: 0, vy: 0, orot: 0, vrot: 0, hr: 40, hw: 0, hh: 0, par: 1, rise: .3,
    fa: [4, 6, 1.2], ff: .3 + rand() * .3, ph: rand() * 6.28, grab: false, nodrag: false, sx: 0, sy: 0, layer: null, alive: true,
  }, o);
  S.bodies.push(b); return b;
}

function bliss(parent, w, h, extra) {
  const id = 'm-bc' + Math.round(rand() * 1e6);
  el('clipPath', { id }, parent, `<rect width="${w}" height="${h}"/>`);
  const g = el('g', { 'clip-path': `url(#${id})` }, parent);
  el('rect', { width: w, height: h, fill: 'url(#m-bs)' }, g);
  el('ellipse', { cx: w * .3, cy: h * .28, rx: w * .26, ry: h * .1, fill: '#fff', opacity: .85 }, g);
  el('ellipse', { cx: w * .72, cy: h * .18, rx: w * .2, ry: h * .07, fill: '#fff', opacity: .7 }, g);
  el('path', { d: `M0 ${h * .62}C${w * .25} ${h * .42} ${w * .6} ${h * .5} ${w} ${h * .46}V${h}H0Z`, fill: 'url(#m-bh)' }, g);
  el('path', { d: `M0 ${h * .8}C${w * .3} ${h * .62} ${w * .7} ${h * .72} ${w} ${h * .66}V${h}H0Z`, fill: '#2a8a22', opacity: .55 }, g);
  if (extra) extra(g, w, h);
  return g;
}
function xpWindow(layer, w, h, title, content) {
  const b = makeBody(layer, 'win', { hw: w / 2, hh: h / 2, par: 1.1, rise: .28 });
  const g = el('g', { transform: `translate(${-w / 2} ${-h / 2})` }, b.g);
  el('rect', { x: 4, y: 6, width: w, height: h, rx: 7, fill: '#0a1060', opacity: .28 }, g);
  el('rect', { width: w, height: h, rx: 7, fill: '#0a50d6' }, g);
  el('path', { d: `M0 8Q0 0 8 0H${w - 8}Q${w} 0 ${w} 8V24H0Z`, fill: 'url(#m-xp)' }, g);
  el('text', { x: 8, y: 16, fill: '#fff', 'font-size': 10.5, 'font-weight': 700, 'font-family': 'Trebuchet MS,Tahoma,Verdana,sans-serif' }, g, title);
  [[w - 57, '#2a6df0'], [w - 38, '#2a6df0'], [w - 19, '#e1472a']].forEach(([x, c]) => el('rect', { x, y: 4, width: 15, height: 15, rx: 3, fill: c, stroke: '#fff', 'stroke-width': 1 }, g));
  el('path', { d: `M${w - 15} 8l7 7m0-7l-7 7`, stroke: '#fff', 'stroke-width': 1.8, fill: 'none' }, g);
  el('rect', { x: w - 54, y: 14, width: 7, height: 2.5, fill: '#fff' }, g);
  el('rect', { x: w - 35, y: 7.5, width: 8, height: 7, fill: 'none', stroke: '#fff', 'stroke-width': 1.5 }, g);
  const cg = el('g', { transform: 'translate(4 24)' }, g);
  content(cg, w - 8, h - 28, b);
  return b;
}
function polaroid(layer, w, h, kind, rot) {
  const b = makeBody(layer, 'poly', { hw: w / 2, hh: h / 2, par: 1.2, rise: .22, rot });
  const g = el('g', {}, b.g);
  el('path', { d: jagged(w, h, 14, 3), fill: '#0a1060', opacity: .25, transform: 'translate(5 7)' }, g);
  el('path', { d: jagged(w, h, 14, 3), fill: '#f4f0e8' }, g);
  const pw = w - 22, ph = h - 56, pg = el('g', { transform: `translate(${-pw / 2} ${-h / 2 + 11})` }, g);
  bliss(pg, pw, ph, (gg, ww, hh) => {
    if (kind === 'door') {
      el('rect', { x: ww * .6, y: hh * .38, width: ww * .15, height: hh * .3, fill: '#fff', stroke: '#c9c2f0', 'stroke-width': 1.5 }, gg);
      el('circle', { cx: ww * .72, cy: hh * .53, r: 1.6, fill: '#8a7fd0' }, gg);
    } else {
      el('rect', { x: ww * .62, y: hh * .34, width: ww * .1, height: hh * .3, fill: '#d9d6e6' }, gg);
      el('path', { d: `M${ww * .61} ${hh * .34}Q${ww * .67} ${hh * .24} ${ww * .73} ${hh * .34}Z`, fill: '#a9a3c9' }, gg);
    }
  });
  el('rect', { x: -26, y: -h / 2 - 7, width: 52, height: 17, fill: '#f3e6bb', opacity: .78, transform: `rotate(${kind === 'door' ? -4 : 5})` }, g);
  return b;
}

function buildScene() {
  const svg = el('svg', { id: 'memory_bg', class: 'memory_bg', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'none' });
  svg.innerHTML = defsMarkup();
  S.svg = svg; S.bodies = []; S.eyes = []; S.doors = []; S.balloons = []; S.parts = [];
  const scene = el('g', { id: 'm-scene' }, svg); S.scene = scene;
  const L = S.L = {};
  const layer = (n, par, rise) => (L[n] = Object.assign(el('g', {}, scene), {}), L[n].par = par, L[n].rise = rise, L[n].sx = 0, L[n].sy = 0, L[n]);
  S.sky = el('rect', { fill: 'url(#m-sky)' }, scene);
  S.haze = el('rect', { fill: 'url(#m-haze)' }, scene);

  /* sky: giant eye, clouds, ladder, watchers */
  layer('sky', 5, .38);
  const ladder = el('g', { opacity: .75 }, L.sky); S.ladder = ladder;
  S.skyEye = makeBody(L.sky, 'skyeye', { hr: 100, nodrag: true, par: 0, rise: 0 });
  S.skyEye.layer = L.sky;
  const eyeBig = makeEye(S.skyEye.g, 125, { glow: true }); eyeBig.parent = S.skyEye; S.eyeBig = eyeBig; S.skyEye.g.setAttribute('opacity', .82);
  S.watchers = [];
  for (let i = 0; i < 7; i++) { const g = el('g', { opacity: 0 }, L.sky); const e = makeEye(g, 26 + rand() * 30); e.parent = null; S.watchers.push({ g, e, fx: rand(), fy: rand() * .7 + .05, rot: (rand() - .5) * 24 }); }
  S.cloudsFar = [];
  for (let i = 0; i < 9; i++) S.cloudsFar.push({ u: el('use', { href: ['#m-cloudA', '#m-cloudB', '#m-cloudC'][i % 3] }, L.sky), x: rand(), y: .06 + rand() * .45, s: .55 + rand() * .45, v: 3 + rand() * 4 });

  /* far: hills + tree */
  layer('far', 6, 0);
  S.hillA = el('path', { fill: 'url(#m-bh)', opacity: .95 }, L.far);
  S.hillB = el('path', { fill: 'var(--m-grass-b)', opacity: .8 }, L.far);
  S.tree = el('g', {}, L.far);
  el('rect', { x: -2.5, y: -4, width: 5, height: 22, fill: '#6b4a3a' }, S.tree);
  [[0, -16, 15], [-11, -7, 11], [11, -7, 11], [0, -3, 13]].forEach(([x, y, r]) => el('circle', { cx: x, cy: y, r, fill: 'var(--m-grass-b)' }, S.tree));
  [[-3, -19, 8], [8, -9, 6]].forEach(([x, y, r]) => el('circle', { cx: x, cy: y, r, fill: 'var(--m-grass-a)', opacity: .9 }, S.tree));
  S.band = el('rect', { fill: 'url(#m-band)' }, L.far);

  /* floor */
  layer('floor', 10, 0);
  S.floorA = el('path', { fill: 'var(--m-tile-a)', 'shape-rendering': 'crispEdges' }, L.floor);
  S.floorB = el('path', { fill: 'var(--m-tile-b)', 'shape-rendering': 'crispEdges' }, L.floor);
  S.gloss = el('rect', { fill: 'url(#m-gloss)' }, L.floor);

  /* portals */
  layer('portals', 10, 0);
  S.refl = el('g', {}, L.portals);
  S.portals = [{ z: 8.2, w: 1.45, h: 3.3, t: .26, d: .5 }, { z: 5, w: 1.85, h: 3.6, t: .3, d: .6 }, { z: 2.9, w: 2.35, h: 4, t: .36, d: .7 }].map(P => {
    const g = el('g', {}, L.portals);
    const rg = el('g', { opacity: .2 }, S.refl);
    const mk = (parent, fill, ev) => el('path', Object.assign({ fill }, ev ? { 'fill-rule': 'evenodd' } : {}), parent);
    const o = { P, g, rg, parts: [] };
    for (const host of [g, rg]) o.parts.push([mk(host, 'var(--m-mid)'), mk(host, 'var(--m-dark)'), mk(host, 'var(--m-dark)'), mk(host, 'var(--m-lit)', true)]);
    return o;
  });

  /* globe */
  layer('globe', 22, .72);
  buildGlobe();

  /* near clouds */
  layer('near', 34, .5);
  S.cloudsNear = [];
  for (let i = 0; i < 3; i++) S.cloudsNear.push({ u: el('use', { href: ['#m-cloudC', '#m-cloudA'][i % 2], opacity: .55 }, L.near), x: rand(), y: .86 + rand() * .12, s: .8 + rand() * .3, v: 6 + rand() * 5 });

  /* floaters */
  layer('float', 40, .3);
  const F = L.float;
  S.win2 = xpWindow(F, 118, 96, 'eye.avi', (g, w, h, b) => {
    el('rect', { width: w, height: h, fill: '#d8caff' }, g);
    const e = makeEye(el('g', { transform: `translate(${w / 2} ${h / 2})` }, g), w * .46); e.parent = b; e.lx = 0; e.ly = 10; e.travel = e.b * .5;
  });
  S.win1 = xpWindow(F, 152, 126, 'Bliss.bmp', (g, w, h) => bliss(g, w, h));
  S.poly1 = polaroid(F, 172, 196, 'door', 10);
  S.poly2 = polaroid(F, 172, 196, 'silo', -9);
  S.orbRefl = el('use', { href: '#m-orb', opacity: .28 }, F);
  S.orb = makeBody(F, 'orb', { hr: 60, par: 1.3, rise: .12, fa: [3, 9, 3] });
  const art = el('g', { id: 'm-orb' }, S.orb.g);
  el('circle', { r: 58, fill: 'url(#m-bal)' }, art);
  el('circle', { r: 58, fill: 'none', stroke: '#fff', 'stroke-opacity': .25, 'stroke-width': 2 }, art);
  const oe = makeEye(art, 40); oe.parent = S.orb; oe.travel = oe.b * .55; S.orbEye = oe;
  for (let i = 0; i < 3; i++) S.balloons.push(makeBalloon(F, i));
  S.smiley = makeBody(F, 'smiley', { hr: 40, par: 1.4, rise: .08, fa: [1, 2, 4] });
  buildSmiley(S.smiley);
  S.noteB = makeBody(F, 'note', { hw: 78, hh: 56, par: 1.2, rise: .15, rot: -14 });
  buildNote(S.noteB);

  /* corners */
  layer('corners', 0, .0);
  S.cBL = el('path', { fill: 'url(#m-chk)' }, L.corners);
  S.cBR = el('path', { fill: 'url(#m-chk2)' }, L.corners);
  S.cTL = el('path', { fill: 'url(#m-chk2)', opacity: 0 }, L.corners);

  /* glitch bars + vignette (outside #m-scene so the filter does not touch them) */
  S.bars = []; const bg = el('g', {}, svg); S.barG = bg;
  const BC = ['#00f0ff', '#ff2bd6', '#fff35c', '#ffffff', '#ff3b3b', '#58ff7a'];
  for (let i = 0; i < 9; i++) S.bars.push(el('rect', { fill: BC[i % BC.length], opacity: 0, height: 4 }, bg));
  S.vig = el('rect', { fill: 'url(#m-vig)', opacity: 0 }, svg);
  S.flash = el('rect', { fill: '#fff', opacity: 0 }, svg);
  S.gt = svg.querySelector('#m-gt'); S.gd = svg.querySelector('#m-gd'); S.go = svg.querySelector('#m-go'); S.gf = svg.querySelector('#m-glitch');
  document.body.insertBefore(svg, document.body.firstChild);
}

function makeBalloon(parent, i) {
  const b = makeBody(parent, 'balloon', { hr: 34, par: 1.5 + i * .2, rise: .8 + i * .1, fa: [10, 14, 4], ff: .25 + i * .07 });
  b.i = i; b.pop = 0; b.respawn = 0;
  el('path', { d: 'M0 30Q9 60 -5 90T3 140', stroke: '#fff', 'stroke-opacity': .7, fill: 'none', 'stroke-width': 1.2 }, b.g);
  el('path', { d: 'M-4 29L0 24L4 29Z', fill: 'var(--m-balloon-d)' }, b.g);
  el('ellipse', { rx: 24, ry: 29, fill: 'url(#m-bal)' }, b.g);
  return b;
}
function buildSmiley(b) {
  const g = b.g, r = 34;
  let d = ''; const n = 22; for (let i = 0; i < n; i++) { const a = i / n * 6.283, rr = 41 + (rand() - .5) * 4; d += (i ? 'L' : 'M') + fx(Math.cos(a) * rr) + ' ' + fx(Math.sin(a) * rr); }
  el('path', { d: d + 'Z', fill: '#0a1060', opacity: .25, transform: 'translate(3 5)' }, g);
  el('path', { d: d + 'Z', fill: '#fffdf3' }, g);
  el('circle', { r, fill: '#ffd21a' }, g);
  el('circle', { r, fill: 'url(#m-bal)', opacity: .0 }, g);
  el('ellipse', { cx: -9, cy: -14, rx: 14, ry: 8, fill: '#fff', opacity: .38, transform: 'rotate(-30)' }, g);
  b.eyeL = el('ellipse', { cx: -11, cy: -8, rx: 3.6, ry: 6, fill: '#2b1b00' }, g);
  b.eyeR = el('ellipse', { cx: 11, cy: -8, rx: 3.6, ry: 6, fill: '#2b1b00' }, g);
  b.mouth = el('path', { d: 'M-17 7Q0 27 17 7', stroke: '#2b1b00', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, g);
  b.mood = 1;
}
function buildNote(b) {
  const g = b.g, r = rng(7);
  el('path', { d: jagged(150, 108, 15, 3, r), fill: '#0a1060', opacity: .22, transform: 'translate(4 6)' }, g);
  el('path', { d: jagged(150, 108, 15, 3, r), fill: '#efe6cf' }, g);
  el('path', { d: 'M-60 -14H60M-60 6H60M-60 26H60', stroke: '#b9c6e8', 'stroke-width': 1, opacity: .7 }, g);
  el('rect', { x: -24, y: -64, width: 48, height: 17, fill: '#fff', opacity: .6, transform: 'rotate(-5)' }, g);
  const msgs = [['somewhere', 'in your', 'memory...'], ['you have', 'been here', 'before...'], ['wake up.', 'wake up.', 'WAKE UP.']];
  b.msgs = msgs.map(m => {
    const t = el('text', { 'font-family': '"Segoe Script","Bradley Hand","Comic Sans MS","Chalkboard SE",cursive', 'font-size': 20, fill: '#33336e', 'text-anchor': 'middle', opacity: 0 }, g);
    m.forEach((l, i) => el('tspan', { x: 0, y: -8 + i * 22 }, t, l)); return t;
  });
}

/* ----- globe ----- */
function buildGlobe() {
  const gl = S.gl = {}, G = S.L.globe;
  gl.g = el('g', {}, G);
  gl.atmo = el('circle', { fill: 'url(#m-atmo)' }, gl.g);
  gl.ringBack = el('g', {}, gl.g);
  gl.sea = el('circle', { fill: 'var(--m-sea-a)' }, gl.g);
  gl.cells = el('g', { 'shape-rendering': 'crispEdges' }, gl.g);
  gl.buckets = ['sea-b', 'sea-m', 'land-a', 'land-m', 'land-b', 'gcloud', 'gx1', 'gx2'].map(n => el('path', { fill: n === 'gx1' ? '#2ff3ff' : n === 'gx2' ? '#ff3bd8' : `var(--m-${n})` }, gl.cells));
  gl.shade = el('circle', { fill: 'url(#m-sph)' }, gl.g);
  gl.rim = el('circle', { fill: 'none', stroke: '#fff', 'stroke-opacity': .55, 'stroke-width': 1.5 }, gl.g);
  gl.doorsG = el('g', {}, gl.g);
  const defs = [[.34, -.52, 0, 0, -8], [-.4, -.06, 1, .9, 4], [.88, .02, 2, .8, 0], [.36, .48, 3, 1, 3]];
  defs.forEach(([nx, ny, kind, open, rot]) => {
    const g = el('g', {}, gl.doorsG);
    const spill = el('circle', { r: 90, fill: 'url(#m-spill)', opacity: 0 }, g);
    el('rect', { x: -57, y: -77, width: 114, height: 154, rx: 10, fill: 'var(--m-lit)' }, g);
    el('rect', { x: -50, y: -70, width: 100, height: 140, fill: `url(#m-di${kind})` }, g);
    if (kind === 1) { el('ellipse', { cx: -12, cy: -20, rx: 30, ry: 11, fill: '#fff', opacity: .9 }, g); el('ellipse', { cx: 18, cy: 6, rx: 24, ry: 9, fill: '#fff', opacity: .7 }, g); }
    if (kind === 2) el('path', { d: 'M-50 30H50', stroke: '#fff', 'stroke-opacity': .6 }, g);
    if (kind === 3) { el('rect', { x: -12, y: -6, width: 24, height: 44, fill: '#ffe6f8', opacity: .85 }, g); el('path', { d: 'M-50 40H50', stroke: '#fff', 'stroke-opacity': .5 }, g); }
    const leaf = el('path', { fill: 'url(#m-wood)', stroke: '#5a2a58', 'stroke-width': 2 }, g);
    const knob = el('circle', { r: 4, fill: '#ffe9a8', stroke: '#8a5a20' }, g);
    S.doors.push({ g, spill, leaf, knob, nx, ny, kind, open, target: open, rot, cx: 0, cy: 0, w: 0, h: 0, sc: 1 });
    drawDoor(S.doors[S.doors.length - 1]);
  });
  gl.ringFront = el('g', {}, gl.g);
  gl.sparkGlow = el('circle', { r: 15, fill: 'url(#m-spill)' }, gl.ringFront);
  gl.spark = el('circle', { r: 5, fill: '#fff' }, gl.ringFront);
  S.ringAng = 0;
}
function drawDoor(d) {
  const o = d.open, hw = 50, hh = 70, xr = -hw + (hw * 2) * Math.max(.1, Math.cos(o * 1.3)), k = .08 * o;
  d.leaf.setAttribute('d', `M${-hw} ${-hh}L${fx(xr)} ${fx(-hh * (1 + k))}L${fx(xr)} ${fx(hh * (1 + k))}L${-hw} ${hh}Z`);
  d.knob.setAttribute('cx', fx(xr - 9)); d.knob.setAttribute('cy', 4); d.knob.setAttribute('r', fx(4 * (1 - o * .45)));
  d.spill.setAttribute('opacity', fx(o * .7 * 100) / 100);
}
let cells = [];
function buildCells(r) {
  const n = Math.round(clamp(r / 7.5, 20, 52)), c = r / n; cells = [];
  const tilt = 22 * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
    const nx = (i + .5) / n, ny = (j + .5) / n, dd = nx * nx + ny * ny; if (dd > 1) continue;
    const nz = Math.sqrt(1 - dd), yu = -ny;
    const yb = yu * ct - nz * st, zb = yu * st + nz * ct;
    const lit = clamp(nx * -.45 + yu * .5 + nz * .74, 0, 1);
    cells.push({ x: i * c, y: j * c, xb: nx, yb, zb, lat: Math.asin(clamp(yb, -1, 1)), a: Math.atan2(nx, zb), lit, th: BAYER[(i & 3) + ((j & 3) << 2)] / 16 - .5, h: ((i * 73856093) ^ (j * 19349663)) >>> 0 });
  }
  S.cellSize = c;
}
function updateGlobe(t) {
  const c = S.cellSize + .5, off = -.25, B = [[], [], [], [], [], [], [], []];
  const step = Math.floor(t * 8), spin = S.spin;
  for (const q of cells) {
    const lon = q.a + spin, land = isLand(lon, q.lat);
    const wv = Math.sin(lon * 3 + q.lat * 5 + t * .15) * Math.sin(q.lat * 7 - lon * 2 + t * .1);
    const hh = ((q.h ^ (step * 2654435761)) >>> 0) / 4294967296;
    let k;
    if (wv > .62 && q.lit > .15) k = 5;
    else if (hh < .006 + S.p * .02) k = hh < .003 ? 6 : 7;
    else {
      const v = q.lit + q.th * .5;
      if (land) k = v > .74 ? 4 : v > .4 ? 3 : 2; else k = v > .78 ? 0 : v > .45 ? 1 : -1;
    }
    if (k < 0) continue;
    B[k].push(`M${fx(q.x + off)} ${fx(q.y + off)}h${fx(c)}v${fx(c)}h${fx(-c)}z`);
  }
  S.gl.buckets.forEach((p, i) => p.setAttribute('d', B[i].join('')));
}
function ringUpdate(r) {
  const gl = S.gl;
  gl.ringBack.textContent = ''; gl.ringFront.querySelectorAll('.m-ring').forEach(n => n.remove());
  const rx = r * 1.5, ry = r * .32;
  const mk = (host, y0, y1) => {
    const rg = el('g', { transform: 'rotate(-13)', class: 'm-ring' }, host);
    const cid = 'm-rc' + (host === gl.ringBack ? 'b' : 'f');
    const old = S.svg.querySelector('#' + cid); if (old) old.remove();
    el('clipPath', { id: cid }, rg, `<rect x="${-rx * 1.2}" y="${y0}" width="${rx * 2.4}" height="${y1 - y0}"/>`);
    const e = el('g', { 'clip-path': `url(#${cid})` }, rg);
    el('ellipse', { rx, ry, fill: 'none', stroke: '#fff', 'stroke-opacity': .22, 'stroke-width': 7 }, e);
    el('ellipse', { rx, ry, fill: 'none', stroke: '#fff', 'stroke-opacity': .95, 'stroke-width': 1.6 }, e);
    return rg;
  };
  mk(gl.ringBack, -r, 0);
  gl.ringFront.insertBefore(mk(gl.ringFront, 0, r), gl.ringFront.firstChild);
  gl.rx = rx; gl.ry = ry;
}

/* =====================================================================
   LAYOUT + PER-SCROLL UPDATE
   ===================================================================== */
function measure() {
  const W = S.W = innerWidth, H = S.H = innerHeight;
  S.portrait = W < 760 || H > W * 1.15;
  S.u = S.portrait ? clamp(W / 430, .6, 1) * .85 : clamp(Math.min(W / 1672, H / 941), .55, 1.6);
  S.vx = W * (S.portrait ? .5 : .49);
  S.tileW = S.portrait ? W * .17 : clamp(W * .085, 64, 200);
  S.S = S.tileW * S.zb;
  const svg = S.svg; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  for (const r of [S.sky, S.haze, S.vig, S.flash]) { r.setAttribute('width', W); r.setAttribute('height', H); }
  S.gf.setAttribute('width', W); S.gf.setAttribute('height', H);
  S.gl.r = S.portrait ? W * .42 : Math.min(W * .18, H * .33);
  buildCells(S.gl.r); ringUpdate(S.gl.r);
  for (const k of ['atmo']) S.gl[k].setAttribute('r', S.gl.r * 1.75);
  for (const k of ['sea', 'shade', 'rim']) S.gl[k].setAttribute('r', S.gl.r);
  S.floorKey = '';
  /* fixed spots (fractions of the viewport) */
  const u = S.u, P = S.portrait, set = (b, fxp, fyp, sc) => { b.bx = W * fxp; b.by = H * fyp; b.sc = sc * u; };
  if (!P) {
    set(S.win1, .614, .255, 1); set(S.win2, .692, .275, 1); S.win2.rot = 3; S.win1.rot = -2;
    set(S.poly1, .89, .17, 1); set(S.poly2, .1, .83, 1);
    set(S.orb, .378, .8, 1); set(S.smiley, .052, .88, 1); set(S.noteB, .93, .84, 1);
    const bp = [[.544, .257], [.572, .4], [.47, .36]]; S.balloons.forEach((b, i) => { set(b, bp[i][0], bp[i][1], [1, .85, .7][i]); });
    set(S.skyEye, .46, .15, 1);
  } else {
    set(S.win1, .3, .24, .62); set(S.win2, .7, .3, .62); S.win2.rot = 3; S.win1.rot = -2;
    set(S.poly1, .86, .1, .62); set(S.poly2, .16, .8, .6);
    set(S.orb, .5, .8, .75); set(S.smiley, .07, .88, .8); set(S.noteB, .9, .56, .7);
    const bp = [[.6, .22], [.2, .4], [.85, .4]]; S.balloons.forEach((b, i) => { set(b, bp[i][0], bp[i][1], [.8, .7, .6][i]); });
    set(S.skyEye, .5, .12, .8);
  }
  S.smiley.hr = 40 * S.smiley.sc; S.orb.hr = 60 * S.orb.sc; S.skyEye.hr = 120 * S.skyEye.sc;
  S.balloons.forEach(b => b.hr = 34 * b.sc);
  S.noteB.hw = 78 * S.noteB.sc; S.noteB.hh = 56 * S.noteB.sc;
  for (const b of [S.win1, S.win2]) { b.hw = (b === S.win1 ? 76 : 59) * b.sc; b.hh = (b === S.win1 ? 63 : 48) * b.sc; }
  for (const b of [S.poly1, S.poly2]) { b.hw = 86 * b.sc; b.hh = 98 * b.sc; }
  S.watchers.forEach((w, i) => { w.pxp = w.fx * W; w.pyp = w.fy * H; w.g.setAttribute('transform', tf(w.pxp, w.pyp, w.rot || 0)); w.e.parent = null; w.e.watch = w; });
  /* corner patches */
  const Hb = H - 40, c = P ? .6 : 1, bl = `M0 ${Hb * .8}L${70 * c} ${Hb * .84}L${95 * c} ${Hb * .9}L${190 * c} ${Hb * .945}L${215 * c} ${H}L0 ${H}Z`;
  S.cBL.setAttribute('d', bl);
  S.cBR.setAttribute('d', `M${W} ${Hb * .9}L${W - 110 * c} ${Hb * .93}L${W - 150 * c} ${Hb * .975}L${W - 160 * c} ${H}L${W} ${H}Z`);
  S.cTL.setAttribute('d', '');
  updateScene(true);
}

function parallaxOf(n) { return n; }
function updateScene(force) {
  const { W, H } = S, p = S.p, P = S.portrait;
  /* palette */
  const m = S.dark ? PAL.dark : PAL.light, uu = clamp(p, 0, 1) * 2, i = Math.min(1, Math.floor(uu)), f = uu - i, st = S.svg.style;
  for (const t of TOKENS) { const a = m[t][i], b = m[t][i + 1]; st.setProperty('--m-' + t, `rgb(${(lerp(a[0], b[0], f)) | 0},${(lerp(a[1], b[1], f)) | 0},${(lerp(a[2], b[2], f)) | 0})`); }
  root.style.setProperty('--m-p', p.toFixed(3));
  /* horizon */
  const hy = S.hy = H * ((P ? .5 : .6) - p * (P ? .26 : .36)), vx = S.vx;
  S.hc = (H - hy) / S.tileW;
  document.getElementById('m-sky').setAttribute('y2', fx(hy + H * .04));
  const hz = document.getElementById('m-haze'); hz.setAttribute('cx', vx); hz.setAttribute('cy', hy); hz.setAttribute('r', W * .6);
  const gl = document.getElementById('m-gloss'); gl.setAttribute('y1', hy); gl.setAttribute('y2', H);
  const bd = document.getElementById('m-band'); bd.setAttribute('y1', hy - H * .05); bd.setAttribute('y2', hy + H * .03);
  S.band.setAttribute('x', 0); S.band.setAttribute('width', W); S.band.setAttribute('y', hy - H * .05); S.band.setAttribute('height', H * .08);
  S.gloss.setAttribute('x', 0); S.gloss.setAttribute('width', W); S.gloss.setAttribute('y', hy); S.gloss.setAttribute('height', H - hy);
  /* hills + tree */
  const hw = W * .5, a = hy - H * .075 * (P ? .6 : 1);
  S.hillA.setAttribute('d', `M${vx - hw} ${hy + 6}C${vx - hw * .5} ${a - H * .012} ${vx - hw * .12} ${a + H * .02} ${vx + hw * .05} ${a - H * .03}S${vx + hw * .7} ${a + H * .03} ${vx + hw} ${hy + 6}Z`);
  S.hillB.setAttribute('d', `M${vx - hw * .9} ${hy + 6}C${vx - hw * .55} ${hy - H * .03} ${vx - hw * .3} ${hy - H * .01} ${vx - hw * .05} ${hy + 6}Z`);
  S.tree.setAttribute('transform', tf(vx + hw * .02, hy - H * .052 * (P ? .8 : 1), 0, S.u * 1.15));
  /* portals */
  updatePortals();
  /* globe position (rides up as we descend) */
  const r = S.gl.r, gx = P ? W * .78 : W * .80, gy = P ? H * .8 : H * .595;
  S.gl.cx = gx; S.gl.cy = gy - p * H * .78;
  S.gl.g.setAttribute('transform', `translate(${fx(S.gl.cx)} ${fx(S.gl.cy)})`);
  S.doors.forEach(d => {
    const sx = Math.sqrt(Math.max(.08, 1 - d.nx * d.nx)), sy = Math.sqrt(Math.max(.08, 1 - d.ny * d.ny)), k = r * .0029;
    d.cx = d.nx * r; d.cy = d.ny * r; d.sc = k; d.w = 50 * k * sx; d.h = 70 * k * sy;
    d.g.setAttribute('transform', `translate(${fx(d.cx)} ${fx(d.cy)}) rotate(${d.rot}) scale(${fx(k * sx * 100) / 100} ${fx(k * sy * 100) / 100})`);
  });
  /* descent: grade + tilt */
  S.vig.setAttribute('opacity', fx(smooth(.15, 1, p) * 100) / 100);
  S.cTL.setAttribute('opacity', 0);
  S.skyEye.g.setAttribute('opacity', fx((.5 + p * .4) * 100) / 100);
  /* watchers fade in */
  const wa = smooth(.28, .8, p);
  S.watchers.forEach((w, k) => w.g.setAttribute('opacity', fx(clamp(wa * 1.6 - k * .12, 0, 1) * .85 * 100) / 100));
  /* ladder */
  const lx = W * (P ? .84 : .68), len = H * .3;
  let ld = `M${lx} ${-20}L${lx - 36} ${len}M${lx + 40} ${-20}L${lx + 10} ${len}`;
  for (let y = 10; y < len; y += 22) { const t = (y + 20) / (len + 20), xa = lerp(lx, lx - 36, t), xb = lerp(lx + 40, lx + 10, t); ld += `M${fx(xa)} ${y}L${fx(xb)} ${y}`; }
  S.ladder.innerHTML = `<path d="${ld}" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none" opacity=".9" /><path d="${ld}" stroke="var(--m-mid)" stroke-width="1.2" fill="none" transform="translate(2 2)" opacity=".7"/>`;
  /* note text phase */
  const ph = S.noteOverride >= 0 ? S.noteOverride : (p < .4 ? 0 : p < .75 ? 1 : 2);
  S.noteB.msgs.forEach((t, k) => t.setAttribute('opacity', k === ph ? 1 : 0));
  S.floorKey = '';
  drawFloor(true);
}

function updatePortals() {
  const { vx, hy, hc, S: s } = S, X = (x, z) => vx + x * s / z, Y = (h, z) => hy + (hc - h) * s / z;
  for (const o of S.portals) {
    const { z, w, h, t, d } = o.P, z2 = z + d;
    const xl = X(-w, z), xr = X(w, z), yt = Y(h, z), yb = Y(0, z), xl2 = X(-(w - t), z), xr2 = X(w - t, z), yt2 = Y(h - t, z);
    const xlb = X(-(w - t), z2), xrb = X(w - t, z2), ytb = Y(h - t, z2), ybb = Y(0, z2);
    const f = n => fx(n);
    const dL = `M${f(xl2)} ${f(yt2)}L${f(xlb)} ${f(ytb)}L${f(xlb)} ${f(ybb)}L${f(xl2)} ${f(yb)}Z`;
    const dR = `M${f(xr2)} ${f(yt2)}L${f(xrb)} ${f(ytb)}L${f(xrb)} ${f(ybb)}L${f(xr2)} ${f(yb)}Z`;
    const dT = `M${f(xl2)} ${f(yt2)}L${f(xr2)} ${f(yt2)}L${f(xrb)} ${f(ytb)}L${f(xlb)} ${f(ytb)}Z`;
    const dF = `M${f(xl)} ${f(yt)}H${f(xr)}V${f(yb)}H${f(xr2)}V${f(yt2)}H${f(xl2)}V${f(yb)}H${f(xl)}Z`;
    for (const ps of o.parts) { ps[0].setAttribute('d', dL); ps[1].setAttribute('d', dR); ps[2].setAttribute('d', dT); ps[3].setAttribute('d', dF); }
    o.rg.setAttribute('transform', `translate(0 ${f(2 * yb)}) scale(1 -1)`);
  }
}

function drawFloor(force) {
  const { W, H, hy, vx, S: s, zb } = S, zmax = S.portrait ? 12 : 15, Z = S.floorT;
  const key = fx(hy) + '|' + fx(Z * 20) + '|' + fx(S.rippleAmp * 10 || 0);
  if (!force && key === S.floorKey) return; S.floorKey = key;
  const A = (H - hy) * zb, base = Math.floor(Z), off = Z - base;
  const amp = (S.rippleAmp || 0) + smooth(.5, 1, S.p) * 5, tm = S.time;
  const yz = z => hy + A / z + (amp ? Math.sin(z * 1.1 - tm * 2.2) * amp * Math.min(1, z / 4) / Math.max(1, z * .25) : 0);
  const sh = z => smooth(.55, 1, S.p) * Math.sin(z * .6 + tm * .7) * 14 / z;
  const da = [], db = [], K = Math.ceil(zmax);
  let zA = zb - off, yA = yz(zA);
  for (let k = 0; k < K; k++) {
    const zB = zb + k + 1 - off; if (zB > zmax + 1) break;
    const yB = yz(zB), sA = s / zA, sB = s / zB, shA = sh(zA), shB = sh(zB);
    const cmin = Math.floor((-vx - 60) / sB), cmax = Math.ceil((W - vx + 60) / sB);
    for (let c = cmin; c < cmax; c++) {
      const par = (c + k + base) & 1, q = `M${fx(vx + c * sA + shA)} ${fx(yA)}L${fx(vx + (c + 1) * sA + shA)} ${fx(yA)}L${fx(vx + (c + 1) * sB + shB)} ${fx(yB)}L${fx(vx + c * sB + shB)} ${fx(yB)}Z`;
      (par ? da : db).push(q);
    }
    zA = zB; yA = yB;
  }
  S.floorA.setAttribute('d', da.join('')); S.floorB.setAttribute('d', db.join(''));
  S.floorTop = yA;
  /* fill the strip between the last row and the horizon with the haze */
  S.floorB.setAttribute('transform', '');
  if (!S.floorFill) S.floorFill = el('rect', { fill: 'var(--m-tile-b)' }, S.L.floor), S.L.floor.insertBefore(S.floorFill, S.floorA);
  S.floorFill.setAttribute('x', -10); S.floorFill.setAttribute('width', W + 20); S.floorFill.setAttribute('y', hy - 2); S.floorFill.setAttribute('height', Math.max(0, yA - hy + 6));
}

/* =====================================================================
   GLITCH + PARTICLES
   ===================================================================== */
function glitch(k = 1, dur = .28) {
  if (still()) return;
  S.glitch = { t0: S.time, dur, k, last: -1 };
  S.scene.setAttribute('filter', 'url(#m-glitch)');
}
function updateGlitch() {
  const G = S.glitch;
  if (!G) return;
  const t = (S.time - G.t0) / G.dur;
  if (t >= 1) { S.glitch = null; S.scene.removeAttribute('filter'); S.bars.forEach(b => b.setAttribute('opacity', 0)); return; }
  if (S.time - G.last > .05) {
    G.last = S.time;
    S.gt.setAttribute('seed', (Math.random() * 99) | 0);
    S.gd.setAttribute('scale', fx(Math.random() * 40 * G.k * (1 - t * .6)));
    S.go.setAttribute('dx', fx((Math.random() - .5) * 26 * G.k));
    const n = 2 + ((Math.random() * 5) | 0);
    S.bars.forEach((b, i) => {
      if (i >= n) { b.setAttribute('opacity', 0); return; }
      const w = 60 + Math.random() * S.W * .6;
      b.setAttribute('x', fx(Math.random() * (S.W - w * .5))); b.setAttribute('width', fx(w));
      b.setAttribute('y', fx(Math.random() * S.H)); b.setAttribute('height', fx(1 + Math.random() * 16));
      b.setAttribute('opacity', fx((.25 + Math.random() * .4) * G.k * 100) / 100);
    });
  }
}
function burst(x, y, n = 16) {
  const cols = ['var(--m-balloon)', '#fff', '#2ff3ff', '#ff3bd8', '#fff35c'];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = 80 + Math.random() * 260, sq = i % 3 === 0;
    const e = sq ? el('rect', { width: 9, height: 9, fill: i % 2 ? '#150f2e' : '#fff' }, S.L.float) : el('circle', { r: 2 + Math.random() * 4, fill: cols[i % cols.length] }, S.L.float);
    S.parts.push({ e, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: .8 + Math.random() * .7, age: 0, r: Math.random() * 360, sq });
  }
}
function updateParts(dt) {
  for (let i = S.parts.length - 1; i >= 0; i--) {
    const q = S.parts[i]; q.age += dt; if (q.age > q.life) { q.e.remove(); S.parts.splice(i, 1); continue; }
    q.vy += 520 * dt; q.vx *= .99; q.x += q.vx * dt; q.y += q.vy * dt; q.r += q.vx * dt;
    q.e.setAttribute(q.sq ? 'transform' : 'transform', `translate(${fx(q.x)} ${fx(q.y)}) rotate(${fx(q.r)})`);
    q.e.setAttribute('opacity', fx(1 - q.age / q.life));
  }
}

/* =====================================================================
   CONFETTI  (a 2D canvas above the page; pointer-events none. Used when a balloon pops, by both renderers)
   ===================================================================== */
const CF = { cv: null, x: null, parts: [], raf: 0, last: 0, dpr: 1, W: 0, H: 0 };
const CF_COLORS = ['#ff3ba5', '#ff6ad2', '#2ff3ff', '#fff35c', '#ffffff', '#58ff7a', '#3563e8', '#150f2e', '#ff9e72', '#b78cff'];
function confettiCanvas() {
  if (CF.cv && CF.cv.isConnected) return CF.cv;
  const c = document.createElement('canvas');
  c.id = 'memory_confetti'; c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  document.body.appendChild(c); CF.cv = c; CF.x = c.getContext('2d'); return c;
}
function confettiSize() {
  const c = CF.cv, dpr = CF.dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  if (CF.W !== W || CF.H !== H || c.width !== Math.round(W * dpr)) { CF.W = W; CF.H = H; c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
}
function confetti(x, y, n = 90) {
  if (stillV) return;                       /* reduced motion / motion paused: no flying paper */
  confettiCanvas(); confettiSize();
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.35, v = 260 + Math.random() * 620, kind = Math.random();
    CF.parts.push({
      x: x + (Math.random() - .5) * 14, y: y + (Math.random() - .5) * 14, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, rot: Math.random() * 6.283, vr: (Math.random() - .5) * 16,
      fp: Math.random() * 6.283, fs: 6 + Math.random() * 9, sw: 18 + Math.random() * 40, age: 0, life: 2.2 + Math.random() * 1.8,
      col: CF_COLORS[(Math.random() * CF_COLORS.length) | 0], shape: kind < .62 ? 0 : kind < .84 ? 1 : 2,
    });
  }
  if (CF.parts.length > 600) CF.parts.splice(0, CF.parts.length - 600);
  if (!CF.raf) { CF.last = performance.now(); CF.raf = requestAnimationFrame(confettiTick); }
}
function confettiTick(now) {
  CF.raf = 0;
  if (!CF.cv || !CF.cv.isConnected) { CF.parts.length = 0; return; }
  const dt = Math.min(.05, (now - CF.last) / 1000 || .016); CF.last = now;
  confettiSize();
  const x = CF.x, d = CF.dpr; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, CF.cv.width, CF.cv.height); x.scale(d, d);
  for (let i = CF.parts.length - 1; i >= 0; i--) {
    const q = CF.parts[i]; q.age += dt;
    if (q.age > q.life || q.y > CF.H + 40) { CF.parts.splice(i, 1); continue; }
    q.vy += 640 * dt; const drag = Math.exp(-2.5 * dt); q.vx *= drag; q.vy *= drag;
    q.x += (q.vx + Math.sin(q.age * 3 + q.fp) * q.sw) * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
    const k = Math.cos(q.age * q.fs + q.fp), fade = clamp((q.life - q.age) / (q.life * .3), 0, 1);
    x.save(); x.translate(q.x, q.y); x.rotate(q.rot); x.globalAlpha = fade; x.fillStyle = q.col;
    if (q.shape === 1) { x.beginPath(); x.ellipse(0, 0, q.w * .45, Math.max(.6, q.w * .45 * Math.abs(k)), 0, 0, 6.283); x.fill(); }
    else if (q.shape === 2) { x.scale(1, Math.max(.12, Math.abs(k))); x.fillRect(-q.w * 1.4, -1.6, q.w * 2.8, 3.2); }
    else { x.scale(1, Math.max(.12, Math.abs(k))); x.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); }
    x.restore();
  }
  if (CF.parts.length) CF.raf = requestAnimationFrame(confettiTick);
  else x.clearRect(0, 0, CF.cv.width, CF.cv.height);
}
function confettiClear() { cancelAnimationFrame(CF.raf); CF.raf = 0; CF.parts.length = 0; CF.cv?.remove(); CF.cv = null; CF.x = null; }

/* =====================================================================
   FRAME
   ===================================================================== */
const ptr = { x: -9999, y: -9999, down: false, drag: null, hit: null, sx: 0, sy: 0, vx: 0, vy: 0, lx: 0, ly: 0, type: 'mouse', moved: 0, gx: 0, gy: 0 };
function bodyScreen(b, dt) {
  const L = b.layer || S.L.float, t = S.time;
  const fl = still() ? 0 : 1;
  const fxo = Math.sin(t * b.ff + b.ph) * b.fa[0] * fl, fyo = Math.cos(t * b.ff * 1.3 + b.ph) * b.fa[1] * fl;
  b.sx = b.bx + b.ox + fxo + L.sx * (b.par ? 1 : 0); b.sy = b.by - S.p * b.rise * S.H + b.oy + fyo + L.sy * (b.par ? 1 : 0);
  b.drot = b.rot + b.orot + Math.sin(t * b.ff * .8 + b.ph) * b.fa[2] * fl;
}
function frame(now) {
  S.raf = requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - S.last) / 1000 || .016); S.last = now; S.time += dt;
  step(dt, false);
}
function step(dt, instant) {
  const { W, H } = S, t = S.time, ease = instant ? 1 : 1 - Math.pow(.001, dt);
  /* scroll progress + pointer */
  const max = Math.max(1, root.scrollHeight - innerHeight), raw = clamp(scrollY / max, 0, 1);
  S.pTarget = 1 - Math.pow(1 - raw, 1.5);
  const pOld = S.p; S.p += (S.pTarget - S.p) * (instant ? 1 : 1 - Math.pow(.02, dt));
  if (Math.abs(S.p - pOld) > .0004 || instant) { updateScene(true); }
  const nm = still() ? 0 : 1;
  S.px += (S.tx * nm - S.px) * (1 - Math.pow(.03, dt)); S.py += (S.ty * nm - S.py) * (1 - Math.pow(.03, dt));
  for (const k in S.L) { const l = S.L[k]; if (!l.par) continue; l.sx = -S.px * l.par; l.sy = -S.py * l.par * .6 - S.p * l.rise * H; l.setAttribute('transform', `translate(${fx(l.sx)} ${fx(l.sy)})`); }
  /* rise of non-parallax layer 'sky' children is handled by layer */
  /* tilt */
  const tilt = -S.p * 2.4 + Math.sin(t * .35) * .25 * S.p * nm, sc = 1 + S.p * .045;
  S.scene.style.transform = `rotate(${fx(tilt * 100) / 100}deg) scale(${sc})`;
  S.scene.style.transformOrigin = `${W / 2}px ${H / 2}px`;
  /* floor drift */
  const driftOn = !still();
  if (driftOn) { S.floorT += dt * .22; }
  if (driftOn || instant || S.rippleAmp) {
    if (S.rippleAmp) { S.rippleAmp = Math.max(0, S.rippleAmp - dt * 9); if (S.rippleAmp < .2) S.rippleAmp = 0; }
    if (!S.fAcc || instant) S.fAcc = 0; S.fAcc += dt; if (S.fAcc > .05 || instant || S.rippleAmp) { S.fAcc = 0; drawFloor(true); }
  }
  /* clouds */
  const clouds = (arr, w, yb) => arr.forEach(c => { const span = W + 700; const x = ((c.x * span + t * c.v * (nm || .0)) % span) - 350; c.u.setAttribute('transform', `translate(${fx(x)} ${fx(c.y * H + Math.sin(t * .2 + c.x * 9) * 4 * nm)}) scale(${fx(c.s * S.u * 100 * (w || 1)) / 100})`); });
  clouds(S.cloudsFar); clouds(S.cloudsNear);
  /* bodies */
  const f = Math.min(1, dt * 60);
  for (const b of S.bodies) {
    if (b.kind === 'skyeye') { b.layer = S.L.sky; bodyScreen(b); b.sy = b.by - S.p * S.L.sky.rise * H + S.L.sky.sy * 0 + S.L.sky.sy; b.sx = b.bx + S.L.sky.sx; b.g.setAttribute('transform', `translate(${fx(b.bx)} ${fx(b.by)}) scale(${fx(b.sc * 100) / 100})`); continue; }
    if (b.kind === 'balloon') balloonPhysics(b, dt);
    else if (b.grab) { b.vx = b.vy = 0; }
    else { const k = 60, c = 7; b.vx += (-k * b.ox - c * b.vx) * dt; b.vy += (-k * b.oy - c * b.vy) * dt; b.ox += b.vx * dt; b.oy += b.vy * dt; b.vrot += (-50 * b.orot - 6 * b.vrot) * dt; b.orot += b.vrot * dt; }
    if (b.grab) { const tx = ptr.x - ptr.gx, ty = ptr.y - ptr.gy; b.ox += (tx - b.sx) * Math.min(1, dt * 18); b.oy += (ty - b.sy) * Math.min(1, dt * 18); }
    bodyScreen(b, dt);
    if (b.kind === 'balloon' && b.pop) { b.g.setAttribute('opacity', 0); continue; }
    b.g.setAttribute('transform', tf(b.sx - S.L.float.sx, b.sy - S.L.float.sy, b.drot, b.sc));
    if (b.kind === 'smiley') { smileyMood(b, dt); }
  }
  S.orbRefl.setAttribute('transform', `translate(${fx(S.orb.sx - S.L.float.sx)} ${fx(S.orb.sy - S.L.float.sy + 118 * S.orb.sc)}) scale(${fx(S.orb.sc * 100) / 100} ${fx(-S.orb.sc * 100) / 100})`);
  /* eyes */
  eyes(dt, t);
  /* globe */
  const gl = S.gl;
  S.spin += S.spinV * dt; if (!ptr.drag || ptr.drag.kind !== 'globe') S.spinV += ((.07 + S.p * .25) - S.spinV) * Math.min(1, dt * .7);
  if (!still() && t - (S.gAt || -1) > .125) { S.gAt = t; updateGlobe(t); } else if (instant) updateGlobe(t);
  S.ringAng += dt * .35; const sa = S.ringAng, sx = Math.cos(sa) * gl.rx, sy = Math.sin(sa) * gl.ry;
  const front = Math.sin(sa) > 0, host = front ? gl.ringFront : gl.ringBack;
  const rotg = (host.querySelector('.m-ring'));
  if (gl.spark.parentNode !== (front ? gl.ringFront : gl.ringBack)) { host.appendChild(gl.spark); host.insertBefore(gl.sparkGlow, gl.spark); }
  const ca = Math.cos(-13 * Math.PI / 180), sa2 = Math.sin(-13 * Math.PI / 180), rxp = sx * ca - sy * sa2, ryp = sx * sa2 + sy * ca;
  gl.spark.setAttribute('cx', fx(rxp)); gl.spark.setAttribute('cy', fx(ryp)); gl.sparkGlow.setAttribute('cx', fx(rxp)); gl.sparkGlow.setAttribute('cy', fx(ryp));
  /* doors */
  for (const d of S.doors) { if (Math.abs(d.open - d.target) > .002) { d.open += (d.target - d.open) * (instant ? 1 : Math.min(1, dt * 6)); drawDoor(d); } }
  /* glitch scheduling */
  if (!still()) {
    S.nextGlitch -= dt; if (S.nextGlitch <= 0) { glitch(.35 + Math.random() * .5 + S.p * .5, .12 + Math.random() * .2); S.nextGlitch = (2.2 + Math.random() * 6) / (1 + S.p * 2.8); }
    updateGlitch(); updateParts(dt);
  }
  /* flash on intro */
  if (S.flashV > 0) { S.flashV = Math.max(0, S.flashV - dt * 1.6); S.flash.setAttribute('opacity', fx(S.flashV * 100) / 100); }
}
function balloonPhysics(b, dt) {
  if (b.pop) { b.respawn -= dt; if (b.respawn <= 0) { b.pop = 0; b.ox = (Math.random() - .5) * 60; b.oy = S.H * .7; b.vx = b.vy = 0; b.g.setAttribute('opacity', 1); } return; }
  let fxs = -40 * b.ox, fys = -14 * b.oy;
  const dx = b.sx - ptr.x, dy = b.sy - ptr.y, d = Math.hypot(dx, dy), R = 130 * b.sc;
  if (d < R && ptr.type !== 'touch') { const k = (1 - d / R) * 900; fxs += dx / (d || 1) * k; fys += dy / (d || 1) * k; }
  b.vx += (fxs - 3.2 * b.vx) * dt; b.vy += (fys - 3.2 * b.vy) * dt; b.ox += b.vx * dt; b.oy += b.vy * dt;
}
function smileyMood(b, dt) {
  const near = S.hover === b ? 1 : 0, target = near ? -.4 : (S.p > .55 ? -.6 : 1);
  b.mood += (target - b.mood) * Math.min(1, dt * 8);
  const y = 7, c = 7 + 20 * b.mood;
  b.mouth.setAttribute('d', `M-17 ${y}Q0 ${fx(c)} 17 ${y}`);
  const ry = 6 + (near ? 2.5 : 0); b.eyeL.setAttribute('ry', ry); b.eyeR.setAttribute('ry', ry);
}
function eyes(dt, t) {
  const idle = t - S.lastMove > 4;
  for (const e of S.eyes) {
    let cx, cy;
    if (e.parent) { const p = e.parent; if (p.kind === 'skyeye') { cx = p.bx + S.L.sky.sx; cy = p.by + S.L.sky.sy; } else { cx = p.sx + e.lx * p.sc; cy = p.sy + e.ly * p.sc; } }
    else if (e.watch) { cx = e.watch.pxp + S.L.sky.sx; cy = e.watch.pyp + S.L.sky.sy; }
    else { cx = S.W / 2; cy = S.H / 2; }
    let dx, dy; if (idle) { dx = Math.sin(t * .5 + e.wander) * 100; dy = Math.cos(t * .37 + e.wander) * 50; } else { dx = ptr.x - cx; dy = ptr.y - cy; }
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / (S.W * .35)) * e.travel;
    e.ox += (dx / d * k - e.ox) * Math.min(1, dt * 9); e.oy += (dy / d * k * .8 - e.oy) * Math.min(1, dt * 9);
    e.pup.setAttribute('transform', `translate(${fx(e.ox)} ${fx(e.oy)})`);
    if (t > e.next && t - e.t0 > .3) { e.t0 = t; e.next = t + 2.5 + Math.random() * 5; }
    const bt = (t - e.t0) / .2; e.bl = bt < 1 ? 1 - Math.sin(bt * Math.PI) * .94 : 1;
    e.blinkG.setAttribute('transform', `scale(1 ${fx(e.bl * 100) / 100})`);
  }
}

/* =====================================================================
   INTERACTION
   ===================================================================== */
const BG = 'html, body, main, .article, .landing, .landing_panel, .contact, .contact_panel, .error, .error_panel, .expertise, .desk';
const isBg = t => t === root || t === document.body || (t && t.matches && t.matches(BG));
function pick(x, y) {
  /* doors first, then globe, then floaters from the top */
  const gl = S.gl, gx = gl.cx + S.L.globe.sx, gy = gl.cy + S.L.globe.sy;
  for (const d of S.doors) { const dx = x - (gx + d.cx), dy = y - (gy + d.cy); if (Math.abs(dx) < d.w * 1.1 && Math.abs(dy) < d.h * 1.1) return { kind: 'door', d, nodrag: true }; }
  const bs = S.bodies.slice().reverse();
  for (const b of bs) {
    if (b.pop || b.kind === 'skyeye') continue;
    const dx = Math.abs(x - b.sx), dy = Math.abs(y - b.sy);
    if (b.hw ? (dx < b.hw && dy < b.hh) : (dx * dx + dy * dy < b.hr * b.hr)) return b;
  }
  if (Math.hypot(x - gx, y - gy) < gl.r) return { kind: 'globe', nodrag: false };
  const se = S.skyEye; if (Math.hypot((x - (se.bx + S.L.sky.sx)) / 1.5, y - (se.by + S.L.sky.sy)) < se.hr * .8) return se;
  return null;
}
function onMove(e) {
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.type = e.pointerType || 'mouse';
  S.tx = (ptr.x / S.W - .5) * 2; S.ty = (ptr.y / S.H - .5) * 2; S.lastMove = S.time;
  const bg = isBg(e.target);
  if (ptr.down && ptr.drag) {
    ptr.moved += Math.hypot(e.movementX || 0, e.movementY || 0);
    if (ptr.drag.kind === 'globe') { S.spin += (e.movementX || 0) / S.gl.r * .9; S.spinV = (e.movementX || 0) * .02; }
    return;
  }
  if (ptr.down) { ptr.moved += 2; }
  const h = bg && ptr.type !== 'touch' ? pick(ptr.x, ptr.y) : null;
  if (h !== S.hover) { S.hover = h; root.classList.toggle('m-grab', !!h && h.kind !== 'skyeye'); }
}
function onDown(e) {
  if (e.button > 0 || !isBg(e.target)) return;
  ptr.down = true; ptr.moved = 0; ptr.sx = e.clientX; ptr.sy = e.clientY; ptr.type = e.pointerType;
  const h = pick(e.clientX, e.clientY); ptr.hit = h;
  if (h && e.pointerType !== 'touch' && !h.nodrag && h.kind !== 'skyeye') {
    ptr.drag = h; if (h.kind !== 'globe') { h.grab = true; ptr.gx = e.clientX - h.sx; ptr.gy = e.clientY - h.sy; }
    root.classList.add('m-dragging');
  }
}
function onUp(e) {
  if (!ptr.down) return; ptr.down = false;
  const dist = Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy), h = ptr.hit;
  if (ptr.drag && ptr.drag.grab) { ptr.drag.grab = false; ptr.drag.vx = ptr.vx * .6; ptr.drag.vy = ptr.vy * .6; ptr.drag.vrot = ptr.vx * .03; }
  ptr.drag = null; ptr.hit = null; root.classList.remove('m-dragging');
  if (h && dist < 6) activate(h, e.clientX, e.clientY);
  else if (!h && dist < 6 && isBg(e.target) && e.clientY > S.hy) S.rippleAmp = 14;
}
function activate(h, x, y) {
  switch (h.kind) {
    case 'balloon': h.pop = 1; h.respawn = 5 + Math.random() * 3; burst(h.sx - S.L.float.sx, h.sy - S.L.float.sy); confetti(h.sx, h.sy); glitch(.5, .15); h.g.setAttribute('opacity', 0); break;
    case 'door': h.d.target = h.d.target > .5 ? 0 : 1; glitch(.3, .12); break;
    case 'smiley': h.vrot = 14; h.mood = -1; glitch(.6, .2); break;
    case 'orb': S.orbEye.t0 = S.time - .01; h.vrot = (Math.random() - .5) * 20; h.vy = -160; break;
    case 'note': S.noteOverride = (S.noteOverride < 0 ? (S.p < .4 ? 0 : S.p < .75 ? 1 : 2) : S.noteOverride) + 1; S.noteOverride %= 3; updateScene(true); glitch(.5, .2); break;
    case 'skyeye': S.eyeBig.t0 = S.time; glitch(1, .35); S.flashV = .35; break;
    case 'globe': S.spinV += 1.2; S.rippleAmp = 0; glitch(.6, .25); break;
    default: h.vrot = (Math.random() - .5) * 12; h.vy = -120; glitch(.4, .15);
  }
}
function onFloor(e) { }
function trackVel() { ptr.vx = (ptr.x - ptr.lx) * 8; ptr.vy = (ptr.y - ptr.ly) * 8; ptr.lx = ptr.x; ptr.ly = ptr.y; }

/* =====================================================================
   RANSOM LETTERS
   ===================================================================== */
const PAPERS = [['#f3efe6', '#151515', 'Georgia,"Times New Roman",serif', 800], ['#f1e7c8', '#8d1b1b', 'Impact,"Arial Narrow",sans-serif', 400], ['#f2c230', '#c4161c', '"Courier New",monospace', 900], ['#c4161c', '#f6e3a6', '"Times New Roman",serif', 700], ['#1b1b1b', '#f2f2f2', '"Arial Black",Arial,sans-serif', 900], ['#e9edf6', '#1b46b8', '"Trebuchet MS",sans-serif', 800], ['#f5d6dc', '#111', '"Palatino Linotype",Palatino,serif', 800], ['#ffffff', '#b3101b', '"Courier New",monospace', 900]];
function ransomize(on) {
  const h = document.querySelector('.landing_name'); if (!h) return;
  if (!on) {
    h.querySelectorAll('.m-rn').forEach(n => n.replaceWith(document.createTextNode(n.dataset.t)));
    h.removeAttribute('aria-label'); h.normalize(); return;
  }
  if (h.querySelector('.m-rn')) return;
  const r = rng(42); let last = -1, idx = 0;
  h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
  const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT), nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const txt = n.textContent; if (!txt.trim()) continue;
    const wrap = document.createElement('span'); wrap.className = 'm-rn'; wrap.dataset.t = txt; wrap.setAttribute('aria-hidden', 'true');
    let word = null;
    for (const ch of txt) {
      if (/\s/.test(ch)) { word = null; const s = document.createElement('span'); s.className = 'm-sp'; s.textContent = ' '; wrap.appendChild(s); continue; }
      if (!word) { word = document.createElement('span'); word.className = 'm-w'; wrap.appendChild(word); }
      let v; do { v = Math.floor(r() * PAPERS.length); } while (v === last); last = v;
      const [paper, ink, ff, fw] = PAPERS[v], s = document.createElement('span'), j = (a, b) => a + r() * (b - a);
      s.className = 'm-l'; s.textContent = ch;
      const cp = `polygon(${j(0, 3).toFixed(1)}% ${j(0, 5).toFixed(1)}%,${j(30, 70).toFixed(1)}% ${j(0, 3).toFixed(1)}%,${j(97, 100).toFixed(1)}% ${j(0, 5).toFixed(1)}%,${j(95, 100).toFixed(1)}% ${j(40, 60).toFixed(1)}%,${j(96, 100).toFixed(1)}% ${j(95, 100).toFixed(1)}%,${j(40, 70).toFixed(1)}% ${j(96, 100).toFixed(1)}%,${j(0, 4).toFixed(1)}% ${j(95, 100).toFixed(1)}%,${j(0, 3).toFixed(1)}% ${j(40, 60).toFixed(1)}%)`;
      s.style.cssText = `--paper:${paper};--ink:${ink};--ff:${ff};--fw:${fw};--rot:${j(-7, 7).toFixed(1)}deg;--dy:${j(-.07, .07).toFixed(3)}em;--sz:${j(.9, 1.12).toFixed(2)};--cp:${cp};--i:${idx++}`;
      word.appendChild(s);
    }
    n.replaceWith(wrap);
  }
}

/* ---------- WebGPU shaders ---------- */
/* WGSL for the scene pass. Palette indices are injected as constants. */
const WGSL_COMMON = (NPAL, consts) => `
struct U {
  res: vec4<f32>,   // render w,h ; canvas w,h
  cam: vec4<f32>,   // x y z tanHalfFov
  ang: vec4<f32>,   // yaw pitch time p
  ptr: vec4<f32>,   // pointer (screen units) , glitch , 0
  misc: vec4<f32>,  // dark spin ringAng blink
  look: vec4<f32>,  // iris look xy
  rip: vec4<f32>,   // pointer wake: floor x, z, amp, 0
  dr: vec4<f32>,    // door open x3
  fx: vec4<f32>,    // fogDens hazeStr noteIdx smileMood
  orb: vec4<f32>,   // x y z squash
  gl: vec4<f32>,    // globe c.xyz R
  bal: array<vec4<f32>, 3>,
  pal: array<vec4<f32>, ${NPAL}>,
  mu: vec4<f32>,    // mushroom: squash, spore age (<0 = none), hover, shear
  mp: vec4<f32>,    // mushroom base xyz
  wv: vec4<f32>,    // wind angle, wind phase, gust, 0
  rp: array<vec4<f32>, 4>,  // click ripples: x, z, age, amp
};
@group(0) @binding(0) var<uniform> u: U;
${consts}
`;

const WGSL_VS = `
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
`;

const WGSL_SCENE = `
@group(0) @binding(1) var landTex: texture_2d<f32>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;

const PI = 3.14159265;
const ATLAS = vec2<f32>(512.0, 576.0);

fn P(i: u32) -> vec3<f32> { return u.pal[i].xyz; }
fn hash21(p: vec2<f32>) -> f32 { var q = fract(p * vec2<f32>(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), w.x), mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), w.x), w.y);
}
fn fbm(p: vec2<f32>) -> f32 {
  var a = 0.5; var s = 0.0; var q = p;
  for (var i = 0; i < 4; i = i + 1) { s += a * vnoise(q); q = q * 2.03 + vec2<f32>(17.1, 9.2); a *= 0.5; }
  return s;
}
fn safeDir(d: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(select(d.x, 1e-5, abs(d.x) < 1e-5), select(d.y, 1e-5, abs(d.y) < 1e-5), select(d.z, 1e-5, abs(d.z) < 1e-5));
}

struct Basis { r: vec3<f32>, u: vec3<f32>, f: vec3<f32> };
fn basis() -> Basis {
  let yaw = u.ang.x; let pit = u.ang.y;
  let f = vec3<f32>(sin(yaw) * cos(pit), sin(pit), -cos(yaw) * cos(pit));
  let r = vec3<f32>(cos(yaw), 0.0, sin(yaw));
  let up = cross(r, f);
  return Basis(r, up, f);
}

fn sky(rd: vec3<f32>, clouds: bool) -> vec3<f32> {
  let h = clamp(rd.y, -0.2, 1.0);
  var c = mix(P(P_sky_low), P(P_sky_mid), smoothstep(0.0, 0.28, h));
  c = mix(c, P(P_sky_top), smoothstep(0.22, 0.95, h));
  let hz = exp(-abs(rd.y) * 8.0) * u.fx.y;
  c = mix(c, P(P_haze), hz * 0.7);
  if (clouds && rd.y > 0.015) {
    let q = rd.xz / (rd.y + 0.18) * 1.5 + vec2<f32>(u.ang.z * 0.012, 3.0);
    let n = fbm(q * vec2<f32>(1.0, 1.9));
    let cm = smoothstep(0.5, 0.8, n) * smoothstep(0.015, 0.2, rd.y);
    let cc = mix(P(P_cloud_shade), P(P_cloud), smoothstep(0.45, 0.95, n + rd.y * 0.35));
    c = mix(c, cc, cm * 0.92);
  }
  return c;
}
fn fogMix(c: vec3<f32>, t: f32) -> vec3<f32> {
  let f = 1.0 - exp(-t * u.fx.x);
  return mix(c, mix(P(P_sky_low), P(P_haze), 0.55 * u.fx.y), f);
}
fn checker(p: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> f32 {
  let w = max(abs(dx), abs(dy)) + vec2<f32>(0.0001);
  let i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}
fn sphereHit(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: f32) -> f32 {
  let oc = ro - c; let b = dot(oc, rd); let cc = dot(oc, oc) - r * r; let h = b * b - cc;
  if (h < 0.0) { return -1.0; }
  let t = -b - sqrt(h);
  if (t > 0.0) { return t; }
  return -1.0;
}
fn ellipsoidHit(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, rad: vec3<f32>) -> f32 {
  let o = (ro - c) / rad; let d = rd / rad;
  let a = dot(d, d); let b = dot(o, d); let cc = dot(o, o) - 1.0; let h = b * b - a * cc;
  if (h < 0.0) { return -1.0; }
  let t = (-b - sqrt(h)) / a;
  if (t > 0.0) { return t; }
  return -1.0;
}
fn boxI(ro: vec3<f32>, ird: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec2<f32> {
  let t1 = (bmin - ro) * ird; let t2 = (bmax - ro) * ird;
  let tn = min(t1, t2); let tx = max(t1, t2);
  return vec2<f32>(max(max(tn.x, tn.y), tn.z), min(min(tx.x, tx.y), tx.z));
}

/* ---- shallow waves, wind and ground mist ---- */
fn windDir() -> vec2<f32> { return vec2<f32>(cos(u.wv.x), sin(u.wv.x)); }
fn rot2(v: vec2<f32>, a: f32) -> vec2<f32> { let c = cos(a); let s = sin(a); return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c); }
fn waveBase(p: vec2<f32>, att: f32) -> f32 {
  let wd = windDir(); let ph = u.wv.y; let g = u.wv.z;
  var h = sin(dot(p, wd) * 1.15 - ph) * 0.040;
  h += sin(dot(p, rot2(wd, 0.55)) * 2.10 - ph * 1.45 + 1.7) * 0.022;
  h += sin(dot(p, rot2(wd, -0.70)) * 3.30 - ph * 1.90 + 4.1) * 0.012;
  h += (vnoise(p * 0.9 - wd * ph * 0.55) - 0.5) * 0.050 * (0.4 + g);   /* chop, blown along the wind */
  return h * g * att;
}
fn waveRip(p: vec2<f32>) -> f32 {
  var h = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    let r = u.rp[i];
    if (r.w > 0.001) {
      let d = length(p - r.xy); let e = d - r.z * 3.4;
      h += r.w * exp(-r.z * 0.55) * exp(-e * e * 0.28) * cos(e * 3.1) * 0.13 / (1.0 + d * 0.22);
    }
  }
  let wk = u.rip;
  if (wk.z > 0.001) { let d = length(p - wk.xy); h += wk.z * exp(-d * d * 0.35) * cos(d * 4.0 - u.ang.z * 8.0) * 0.05; }
  return h;
}
fn floorH(p: vec2<f32>, att: f32) -> f32 { return waveBase(p, att) + waveRip(p); }
fn mist(c: vec3<f32>, ro: vec3<f32>, rd: vec3<f32>, tEnd: f32, crest: f32) -> vec3<f32> {
  let H0 = 0.42; let tm = min(tEnd, 60.0);
  let y0 = max(ro.y, 0.0); let y1 = max(ro.y + rd.y * tm, 0.0);
  var od = exp(-y0 / H0) * tm;
  if (abs(rd.y) > 1e-3) { od = H0 * (exp(-y0 / H0) - exp(-y1 / H0)) / rd.y; }
  let pm = ro.xz + rd.xz * min(tm, 14.0);
  let n = fbm(pm * 0.28 - windDir() * u.wv.y * 0.22 + vec2<f32>(0.0, 5.0));
  let dens = (0.10 + 0.55 * smoothstep(0.36, 0.78, n)) * (0.55 + 0.9 * crest);
  let a = min(1.0 - exp(-od * dens * 0.5), 0.7);
  return mix(c, mix(P(P_haze), P(P_cloud), 0.5), a * 0.85);
}

/* ---- door frames (the liminal corridor) ---- */
const F_OW = 3.65; const F_OH = 5.4; const F_IW = 2.45; const F_IH = 4.2; const F_D = 1.4; const F_Z0 = -20.0; const F_DZ = 9.0;
fn frameHit(ro: vec3<f32>, rd: vec3<f32>, ird: vec3<f32>, zc: f32) -> vec4<f32> {
  let bo = boxI(ro, ird, vec3<f32>(-F_OW, 0.0, zc - F_D), vec3<f32>(F_OW, F_OH, zc));
  if (bo.x > bo.y || bo.y < 0.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let tin = max(bo.x, 0.0);
  let p = ro + rd * tin;
  let inOpen = abs(p.x) < F_IW && p.y < F_IH;
  if (!inOpen) {
    let t1 = (vec3<f32>(-F_OW, 0.0, zc - F_D) - ro) * ird; let t2 = (vec3<f32>(F_OW, F_OH, zc) - ro) * ird;
    let tn = min(t1, t2);
    var n = vec3<f32>(0.0);
    if (tn.x >= tn.y && tn.x >= tn.z) { n = vec3<f32>(-sign(rd.x), 0.0, 0.0); }
    else if (tn.y >= tn.z) { n = vec3<f32>(0.0, -sign(rd.y), 0.0); }
    else { n = vec3<f32>(0.0, 0.0, -sign(rd.z)); }
    return vec4<f32>(tin, n);
  }
  let a = (vec3<f32>(-F_IW, -9.0, zc - F_D) - ro) * ird; let b = (vec3<f32>(F_IW, F_IH, zc) - ro) * ird;
  let tx = max(a, b);
  let te = min(min(tx.x, tx.y), tx.z);
  if (tx.z <= tx.x && tx.z <= tx.y) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  if (tx.x <= tx.y) { return vec4<f32>(te, -sign(rd.x), 0.0, 0.0); }
  return vec4<f32>(te, 0.0, -1.0, 0.0);
}

/* ---- quads ---- */
struct Q { r: vec3<f32>, u: vec3<f32> };
fn orient(yaw: f32, roll: f32) -> Q {
  let r0 = vec3<f32>(cos(yaw), 0.0, sin(yaw)); let u0 = vec3<f32>(0.0, 1.0, 0.0);
  let c = cos(roll); let s = sin(roll);
  return Q(r0 * c + u0 * s, u0 * c - r0 * s);
}
fn quadHit(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: vec3<f32>, up: vec3<f32>, hw: f32, hh: f32) -> vec4<f32> {
  let n = cross(r, up); let dn = dot(rd, n);
  if (abs(dn) < 1e-5) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let t = dot(c - ro, n) / dn;
  if (t <= 0.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let p = ro + rd * t - c;
  let lx = dot(p, r) / hw; let ly = dot(p, up) / hh;
  if (abs(lx) > 1.0 || abs(ly) > 1.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  return vec4<f32>(t, lx, ly, 1.0);
}
fn pxl(t: f32, hw: f32) -> f32 { return t * u.cam.w * 2.0 / u.res.y / hw; }
fn atl(px: vec2<f32>) -> vec4<f32> { return textureSampleLevel(atlas, smp, px / ATLAS, 0.0); }

/* ---- pictures ---- */
fn bliss(uv: vec2<f32>, k: f32) -> vec3<f32> {
  var c = mix(vec3<f32>(0.17, 0.42, 0.93), vec3<f32>(0.75, 0.87, 1.0), smoothstep(0.0, 0.7, uv.y));
  if (k > 0.5) { c = mix(vec3<f32>(0.45, 0.30, 0.80), vec3<f32>(1.0, 0.72, 0.80), smoothstep(0.0, 0.7, uv.y)); }
  let c1 = length((uv - vec2<f32>(0.3, 0.3)) * vec2<f32>(1.0, 2.6)) - 0.2;
  let c2 = length((uv - vec2<f32>(0.62, 0.22)) * vec2<f32>(1.0, 3.2)) - 0.15;
  c = mix(c, vec3<f32>(1.0), (1.0 - smoothstep(-0.03, 0.03, min(c1, c2))) * 0.92);
  let hy = 0.62 + 0.11 * cos((uv.x - 0.32) * 3.4);
  let g = smoothstep(hy - 0.008, hy + 0.008, uv.y);
  let grass = mix(vec3<f32>(0.42, 0.78, 0.25), vec3<f32>(0.15, 0.55, 0.15), smoothstep(hy, 1.0, uv.y));
  return mix(c, grass, g);
}
fn eyeCol(uv: vec2<f32>, look: vec2<f32>, blink: f32, aa: f32) -> vec4<f32> {
  let b = 0.52 * blink;
  let lid = b * pow(max(1.0 - uv.x * uv.x, 0.0), 0.8);
  let d = abs(uv.y) - lid;
  let inside = 1.0 - smoothstep(-aa, aa, d);
  let ic = look * vec2<f32>(0.34, 0.14);
  let ir = length(uv - ic);
  var sc = mix(vec3<f32>(1.0, 0.98, 1.0), vec3<f32>(0.80, 0.78, 0.97), smoothstep(0.1, 0.95, length(vec2<f32>(uv.x, uv.y * 1.8))));
  let irisT = smoothstep(0.38, 0.12, ir);
  let ico = mix(P(P_iris_b), P(P_iris_a), smoothstep(0.38, 0.1, ir) * 0.9 + 0.1 * sin(atan2(uv.y - ic.y, uv.x - ic.x) * 14.0));
  var c = mix(sc, ico, smoothstep(0.38 + aa, 0.38 - aa, ir));
  c = mix(c, vec3<f32>(0.05, 0.04, 0.2), smoothstep(0.17 + aa, 0.17 - aa, ir));
  c = mix(c, vec3<f32>(1.0), smoothstep(0.06 + aa, 0.06 - aa, length(uv - ic - vec2<f32>(-0.1, 0.12))));
  let lash = 1.0 - smoothstep(0.015, 0.015 + 2.0 * aa, abs(d));
  c = mix(c, vec3<f32>(0.08, 0.07, 0.25), lash);
  return vec4<f32>(c, max(inside, lash));
}
fn xpWindow(lx: f32, ly: f32, kind: f32, aa: f32, look: vec2<f32>, blink: f32) -> vec4<f32> {
  let uv = vec2<f32>(lx * 0.5 + 0.5, 0.5 - ly * 0.5);
  let rr = 0.05;
  let qq = abs(uv - 0.5) - vec2<f32>(0.5 - rr);
  let sd = (length(max(qq, vec2<f32>(0.0))) + min(max(qq.x, qq.y), 0.0) - rr) * 0.5;
  let a = 1.0 - smoothstep(-aa, aa, sd);
  var c = vec3<f32>(0.0, 0.32, 0.93);
  let tb = 0.17;
  if (uv.y < tb) {
    c = mix(vec3<f32>(0.2, 0.58, 1.0), vec3<f32>(0.0, 0.31, 0.93), smoothstep(0.0, 0.08, uv.y));
    c = mix(c, vec3<f32>(0.0, 0.25, 0.8), smoothstep(0.12, 0.17, uv.y));
    let band = kind;
    if (uv.x > 0.05 && uv.x < 0.55 && uv.y > 0.03 && uv.y < 0.15) {
      let ap = vec2<f32>((uv.x - 0.05) * 512.0, band * 32.0 + (uv.y - 0.03) / 0.12 * 32.0);
      c = mix(c, vec3<f32>(1.0), atl(ap).a);
    }
    for (var i = 0; i < 3; i = i + 1) {
      let bx = 0.93 - f32(i) * 0.085; let bq = (uv - vec2<f32>(bx, 0.085)) * vec2<f32>(1.0, 1.0);
      let bs = max(abs(bq.x) - 0.03, abs(bq.y) - 0.045);
      var bc = vec3<f32>(0.2, 0.45, 0.98); if (i == 0) { bc = vec3<f32>(0.9, 0.35, 0.2); }
      c = mix(c, vec3<f32>(1.0), 1.0 - smoothstep(0.0, 0.006, bs));
      c = mix(c, bc, 1.0 - smoothstep(0.0, 0.006, bs + 0.006));
    }
  } else {
    let inner = uv.x > 0.03 && uv.x < 0.97 && uv.y < 0.97;
    if (inner) {
      let cu = vec2<f32>((uv.x - 0.03) / 0.94, (uv.y - tb) / (0.97 - tb));
      if (kind < 0.5) { c = bliss(cu, 0.0); }
      else {
        let e = eyeCol(vec2<f32>((cu.x - 0.5) * 2.1, (0.5 - cu.y) * 2.1 * 0.9), look, blink, aa * 2.0);
        c = mix(vec3<f32>(0.86, 0.9, 1.0), e.rgb, e.a);
      }
    }
  }
  return vec4<f32>(c, a);
}
fn polaroid(lx: f32, ly: f32, kind: f32, aa: f32) -> vec4<f32> {
  let uv = vec2<f32>(lx * 0.5 + 0.5, 0.5 - ly * 0.5);
  var c = vec3<f32>(0.97, 0.95, 0.9) * (0.96 + 0.04 * hash21(floor(uv * 90.0)));
  let pic = uv.x > 0.08 && uv.x < 0.92 && uv.y > 0.07 && uv.y < 0.78;
  if (pic) {
    let cu = vec2<f32>((uv.x - 0.08) / 0.84, (uv.y - 0.07) / 0.71);
    c = bliss(cu, kind);
    let dq = abs(cu - vec2<f32>(0.62, 0.52)) - vec2<f32>(0.035, 0.1);
    if (kind < 0.5) { c = mix(c, vec3<f32>(1.0), 1.0 - smoothstep(0.0, 0.01, max(dq.x, dq.y))); }
  }
  let e = max(abs(lx), abs(ly)) - 1.0;
  return vec4<f32>(c, 1.0 - smoothstep(-aa, 0.0, e));
}

/* ---- the globe: orthographic mosaic of cells ---- */
fn bayer(c: vec2<i32>) -> f32 {
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[(c.y & 3) * 4 + (c.x & 3)] + 0.5) / 16.0;
}
fn globeColor(fcxy: vec2<f32>, tHit: f32, ro: vec3<f32>, rd: vec3<f32>, B: Basis) -> vec3<f32> {
  let gc = u.gl.xyz; let R = u.gl.w; let tf = u.cam.w; let res = u.res.xy;
  let Pw = ro + rd * tHit;
  let rpx = R / length(gc - ro) / tf * 0.5 * res.y;
  let cs = max(2.0, floor(rpx / 24.0));
  let cell = floor(fcxy / cs);
  let q = (cell + 0.5) * cs;
  let sq = vec2<f32>((q.x - 0.5 * res.x) / (0.5 * res.y), (q.y - 0.5 * res.y) / (0.5 * res.y));
  let rdq = normalize(B.f + B.r * sq.x * tf - B.u * sq.y * tf);
  let tq = sphereHit(ro, rdq, gc, R);
  var n = normalize(Pw - gc);
  if (tq > 0.0) { n = normalize(ro + rdq * tq - gc); }
  let sp = -u.misc.y;
  var nl = vec3<f32>(cos(sp) * n.x + sin(sp) * n.z, n.y, -sin(sp) * n.x + cos(sp) * n.z);
  let tl = -0.38;
  nl = vec3<f32>(cos(tl) * nl.x - sin(tl) * nl.y, sin(tl) * nl.x + cos(tl) * nl.y, nl.z);
  let lon = atan2(nl.x, nl.z); let lat = asin(clamp(nl.y, -1.0, 1.0));
  let tx = i32(floor((lon / (2.0 * PI) + 0.5) * 256.0)) & 255;
  let ty = clamp(i32(floor((0.5 - lat / PI) * 128.0)), 0, 127);
  let land = textureLoad(landTex, vec2<i32>(tx, ty), 0).r > 0.5;
  let L = normalize(vec3<f32>(-0.55, 0.55, 0.65));
  let lam = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
  let d = bayer(vec2<i32>(cell));
  let v = clamp(lam + (d - 0.5) * 0.42, 0.0, 1.0);
  var c = vec3<f32>(0.0);
  if (land) { c = select(select(P(P_land_a), P(P_land_m), v > 0.36), P(P_land_b), v > 0.7); }
  else { c = select(select(P(P_sea_a), P(P_sea_m), v > 0.34), P(P_sea_b), v > 0.72); }
  let cn = fbm(vec2<f32>(lon * 2.6 + u.ang.z * 0.04, lat * 4.6));
  if (cn > 0.64) { c = mix(c, P(P_gcloud), select(0.0, 1.0, v + cn * 0.4 > 0.55)); }
  let rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
  return mix(c, vec3<f32>(0.85, 0.9, 1.0), rim * 0.45);
}

@fragment
fn fs(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let res = u.res.xy;
  let s = vec2<f32>((fc.x - 0.5 * res.x) / (0.5 * res.y), (fc.y - 0.5 * res.y) / (0.5 * res.y));
  let tf = u.cam.w; let B = basis(); let ro = u.cam.xyz;
  let rd = normalize(B.f + B.r * s.x * tf - B.u * s.y * tf);
  let ird = 1.0 / safeDir(rd);
  let time = u.ang.z; let pp = u.ang.w;
  /* floor point for derivatives (uniform control flow) */
  let tF = -ro.y / min(rd.y, -1e-4);
  let pF = ro.xz + rd.xz * tF;
  let ddx = dpdx(pF); let ddy = dpdy(pF);

  var col = sky(rd, true);
  var tB = 1e9;
  var crest = 0.5;

  /* hill + tree */
  let hc = vec3<f32>(-26.0 + ro.x, -7.0, ro.z - 118.0); let hr = vec3<f32>(120.0, 23.0, 42.0);
  let th = ellipsoidHit(ro, rd, hc, hr);
  if (th > 0.0) {
    let ph = ro + rd * th; let nh = normalize((ph - hc) / (hr * hr));
    let lam = clamp(dot(nh, normalize(vec3<f32>(-0.4, 0.8, 0.5))) * 0.5 + 0.5, 0.0, 1.0);
    var gc = mix(P(P_grass_b), P(P_grass_a), smoothstep(0.35, 0.8, lam));
    gc *= 0.92 + 0.12 * vnoise(ph.xz * 0.12);
    col = fogMix(gc, th * 0.35); tB = th;
  }

  /* floor: shallow, wind-blown waves over the checkerboard (click = ring ripple, pointer = wake) */
  if (rd.y < -0.0004 && tF < tB) {
    let att = 1.0 / (1.0 + tF * 0.045);
    var pf = pF; var tt = tF;
    for (var wi = 0; wi < 2; wi = wi + 1) {
      tt = clamp((ro.y - floorH(pf, att)) / -rd.y, tF * 0.8, tF * 1.25);
      pf = ro.xz + rd.xz * tt;
    }
    let h0 = floorH(pf, att);
    let ee = 0.07 + tt * 0.004;
    let hx = floorH(pf + vec2<f32>(ee, 0.0), att); let hz = floorH(pf + vec2<f32>(0.0, ee), att);
    let nrm = normalize(vec3<f32>((h0 - hx) / ee, 1.0, (h0 - hz) / ee));
    crest = clamp(h0 * 7.0 + 0.5, 0.0, 1.0);
    let ch = checker(pf, ddx, ddy);
    var fcol = mix(P(P_tile_b), P(P_tile_a), ch);
    var rr = reflect(rd, nrm); rr.y = abs(rr.y);
    var refl = sky(rr, false);
    let po = vec3<f32>(pf.x, h0, pf.y);
    let to = sphereHit(po, rr, u.orb.xyz, 1.0);
    if (to > 0.0) { refl = mix(refl, P(P_balloon), 0.9); }
    let fres = 0.1 + 0.5 * pow(1.0 - clamp(dot(nrm, -rd), 0.0, 1.0), 4.0);
    fcol = mix(fcol, refl, fres);
    let sunD = normalize(vec3<f32>(0.12, 0.22, -1.0));
    fcol += P(P_haze) * pow(clamp(dot(rr, sunD), 0.0, 1.0), 220.0) * 0.45 * (0.35 + 0.65 * u.wv.z);
    fcol = mix(fcol, mix(P(P_haze), vec3<f32>(1.0), 0.5), smoothstep(0.62, 1.0, crest) * 0.16);
    col = fogMix(fcol, tt); tB = tF;
  }

  /* door frames */
  let k0 = max(0, i32(ceil((-ro.z - 19.5 - F_Z0 * 0.0) / F_DZ)));
  for (var k = 0; k < 8; k = k + 1) {
    let zc = F_Z0 - F_DZ * f32(k0 + k);
    if (zc > ro.z + F_D) { continue; }
    let fh = frameHit(ro, rd, ird, zc);
    if (fh.x > 0.0 && fh.x < tB) {
      let ph = ro + rd * fh.x; let n = fh.yzw;
      var fcl = P(P_mid);
      if (n.z > 0.5) { fcl = P(P_lit); }
      else if (n.y > 0.5) { fcl = mix(P(P_lit), vec3<f32>(1.0), 0.15); }
      else if (n.y < -0.5) { fcl = P(P_dark); }
      else if (abs(n.x) > 0.5) { fcl = select(P(P_dark), P(P_mid), n.x > 0.0); }
      fcl *= 0.78 + 0.22 * smoothstep(0.0, 4.0, ph.y);
      fcl = mix(fcl, P(P_haze), 0.08 * smoothstep(1.0, 0.0, abs(fract((ph.y + ph.x) * 0.9) - 0.5) * 3.0));
      col = fogMix(fcl, fh.x); tB = fh.x;
    }
  }

  /* fly agaric at the end of the corridor: red cap, warts, skirt, stem and one big eye. Squashes and puffs spores when poked. */
  {
    let M = u.mp.xyz;
    let boc = ro - (M + vec3<f32>(0.0, 1.25, 0.0)); let bb = dot(boc, rd); let bh = bb * bb - (dot(boc, boc) - 5.0);
    if (bh > 0.0 && (-bb - sqrt(bh)) < tB) {
      let sq = u.mu.x; let sy = max(0.5, 1.0 - sq); let sxz = 1.0 + sq * 0.5; let sh = u.mu.w;
      let wo = ro - M;
      /* world -> mushroom space (undo squash + shear); rd is left unnormalised so the ray parameter t is shared */
      let lo = vec3<f32>((wo.x - sh * wo.y) / sxz, wo.y / sy, wo.z / sxz);
      let ld = vec3<f32>((rd.x - sh * rd.y) / sxz, rd.y / sy, rd.z / sxz);
      let CC = vec3<f32>(0.0, 1.38, 0.0); let CR = vec3<f32>(1.55, 1.0, 1.55);
      let SC = vec3<f32>(0.0, 1.17, 0.0); let SR = vec3<f32>(0.8, 0.15, 0.8);
      let BC0 = vec3<f32>(0.0, 0.3, 0.0); let BR = vec3<f32>(0.52, 0.34, 0.52);
      var tm = 1e9; var kind = 0;
      let tc = ellipsoidHit(lo, ld, CC, CR);
      if (tc > 0.0) {
        if (lo.y + ld.y * tc >= CC.y) { tm = tc; kind = 1; }
        else if (ld.y > 1e-5) { let tp = (CC.y - lo.y) / ld.y; if (tp > 0.0) { tm = tp; kind = 2; } }
      }
      let a2 = dot(ld.xz, ld.xz);
      if (a2 > 1e-8) {
        let b2 = dot(lo.xz, ld.xz); let c2 = dot(lo.xz, lo.xz) - 0.1225; let h2 = b2 * b2 - a2 * c2;
        if (h2 > 0.0) {
          let ts = (-b2 - sqrt(h2)) / a2; let ys = lo.y + ld.y * ts;
          if (ts > 0.0 && ts < tm && ys > 0.0 && ys < 1.38) { tm = ts; kind = 3; }
        }
      }
      let tk = ellipsoidHit(lo, ld, SC, SR);
      if (tk > 0.0 && tk < tm) { tm = tk; kind = 4; }
      let tbb = ellipsoidHit(lo, ld, BC0, BR);
      if (tbb > 0.0 && tbb < tm) { tm = tbb; kind = 5; }
      if (kind > 0 && tm < tB) {
        let pl = lo + ld * tm;
        let L = normalize(vec3<f32>(-0.4, 0.7, 0.6));
        var nl = vec3<f32>(0.0, 1.0, 0.0);
        if (kind == 1) { nl = normalize((pl - CC) / (CR * CR)); }
        else if (kind == 2) { nl = vec3<f32>(0.0, -1.0, 0.0); }
        else if (kind == 3) { nl = normalize(vec3<f32>(pl.x, 0.0, pl.z)); }
        else if (kind == 4) { nl = normalize((pl - SC) / (SR * SR)); }
        else { nl = normalize((pl - BC0) / (BR * BR)); }
        let nw = normalize(vec3<f32>(nl.x / sxz, nl.y / sy - sh * nl.x / sxz, nl.z / sxz));
        let lam = clamp(dot(nw, L) * 0.5 + 0.5, 0.0, 1.0);
        let ang = atan2(pl.z, pl.x);
        var oc = vec3<f32>(0.0);
        if (kind == 1) {
          let ns = (pl - CC) / CR;
          /* the eye sits low on the front of the cap, tangent to the dome */
          let ew = 0.66 + 0.14 * u.mu.z;
          let ep = pl - vec3<f32>(0.0, 1.75, 1.44);
          let ex = ep.x / ew; let ey = dot(ep, normalize(vec3<f32>(0.0, 0.93, -0.37))) / ew;
          /* warts: a conformal (stereographic) grid so they stay round on the dome */
          let q = ns.xz / (1.0 + ns.y) * 3.2;
          let cellId = floor(q); let fq = fract(q);
          var sp = 0.0;
          for (var j = -1; j <= 1; j = j + 1) {
            for (var i = -1; i <= 1; i = i + 1) {
              let cid = cellId + vec2<f32>(f32(i), f32(j));
              if (hash21(cid) > 0.1) {
                let cen = vec2<f32>(f32(i), f32(j)) + vec2<f32>(0.5) + (vec2<f32>(hash21(cid + 7.3), hash21(cid + 13.1)) - 0.5) * 0.45;
                let rad = 0.2 + 0.2 * hash21(cid + 3.7);
                sp = max(sp, 1.0 - smoothstep(rad - 0.03, rad + 0.03, length(fq - cen)));
              }
            }
          }
          sp = sp * smoothstep(1.0, 1.5, length(vec2<f32>(ex, ey * 1.35)));
          let base = mix(P(P_cap_d), P(P_cap), smoothstep(0.1, 0.85, lam));
          oc = mix(base, vec3<f32>(1.0, 0.97, 0.92) * (0.8 + 0.2 * lam), sp * 0.96);
          oc += pow(clamp(dot(reflect(rd, nw), L), 0.0, 1.0), 26.0) * 0.55 * (1.0 - sp * 0.7);
          if (ns.z > 0.1 && abs(ex) < 1.2 && abs(ey) < 1.0) {
            let e = eyeCol(vec2<f32>(ex, ey), u.look.xy, u.misc.w, 0.02);
            oc = mix(oc, e.rgb, e.a);
          }
        } else if (kind == 2) {
          let rr2 = length(pl.xz) / CR.x;
          oc = mix(P(P_stem_d), P(P_stem), 0.2 + 0.6 * (0.5 + 0.5 * sin(ang * 64.0))) * (0.5 + 0.5 * smoothstep(0.1, 0.95, rr2));
        } else if (kind == 3) {
          oc = mix(P(P_stem_d), P(P_stem), lam) * (0.92 + 0.08 * sin(ang * 18.0)) * (0.55 + 0.45 * smoothstep(1.4, 0.7, pl.y));
        } else if (kind == 4) {
          oc = mix(P(P_stem_d), P(P_stem), lam) * (0.9 + 0.1 * sin(ang * 30.0));
        } else {
          oc = mix(P(P_stem_d) * 0.8, mix(P(P_stem_d), P(P_stem), lam), smoothstep(0.0, 0.5, pl.y));
        }
        oc += P(P_haze) * pow(1.0 - clamp(dot(nw, -rd), 0.0, 1.0), 3.0) * 0.18;
        col = fogMix(oc, tm); tB = tm;
      }
    }
    /* spores, puffed when the mushroom is poked */
    if (u.mu.y >= 0.0 && u.mu.y < 3.2) {
      let age = u.mu.y; let wd = windDir(); let out = 1.0 - exp(-age * 1.6);
      for (var si = 0; si < 14; si = si + 1) {
        let fi = f32(si);
        let h1 = hash21(vec2<f32>(fi, 1.0)); let h2 = hash21(vec2<f32>(fi, 2.0)); let h3 = hash21(vec2<f32>(fi, 3.0));
        let a = h1 * 6.283; let sp = (0.6 + 1.3 * h2) * out * 0.9;
        let pos = M + vec3<f32>(cos(a) * sp + wd.x * age * 0.5, 1.9 + h3 * 0.6 + age * (0.5 + 0.9 * h2) - age * age * 0.12, sin(a) * sp + wd.y * age * 0.5);
        let rel = pos - ro; let tq = dot(rel, rd);
        if (tq > 0.0 && tq < tB) {
          let r = (0.06 + 0.07 * h3) * (1.0 + age * 0.3);
          let al = (1.0 - smoothstep(r * 0.4, r, length(rel - rd * tq))) * (1.0 - age / 3.2);
          col = mix(col, mix(P(P_glow), vec3<f32>(1.0), 0.5), al * 0.9);
        }
      }
    }
  }

  /* globe + ring + doors */
  let gc = u.gl.xyz; let gR = u.gl.w;
  let tg = sphereHit(ro, rd, gc, gR);
  if (tg > 0.0 && tg < tB) { col = globeColor(fc.xy, tg, ro, rd, B); tB = tg; }
  /* ring */
  let rn = normalize(vec3<f32>(-0.17, 0.96, 0.24));
  let rdn = dot(rd, rn);
  if (abs(rdn) > 1e-4) {
    let tr = dot(gc - ro, rn) / rdn;
    if (tr > 0.0 && tr < tB) {
      let pr = ro + rd * tr - gc; let rr = length(pr); let ringR = gR * 1.5; let rw = gR * 0.022 + tr * 0.0012;
      let ra = 1.0 - smoothstep(rw * 0.5, rw, abs(rr - ringR));
      let e1 = normalize(cross(rn, vec3<f32>(0.0, 0.0, 1.0))); let e2 = cross(rn, e1);
      let sa = u.misc.z; let sp = gc + ringR * (cos(sa) * e1 + sin(sa) * e2) - gc;
      let sd = length(pr - sp);
      let spark = exp(-sd * sd / (gR * gR * 0.012));
      col = mix(col, vec3<f32>(1.0), clamp(ra * 0.85 + spark * 0.9, 0.0, 1.0));
      tB = select(tB, tr, ra > 0.5);
    }
  }
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    var off = vec3<f32>(-0.45, 0.25, 0.8); var base = 0.35;
    if (i == 1) { off = vec3<f32>(0.1, -0.35, 0.95); base = -0.05; }
    if (i == 2) { off = vec3<f32>(0.62, 0.05, 0.75); base = 0.0; }
    let hinge = gc + off * gR * 0.95 + vec3<f32>(-0.45, -0.9, 0.0) * 0.0;
    let dw = 0.5; let dh = 0.95;
    let op = u.dr[i];
    // portal view behind
    let qa = orient(base * 0.5 - 0.15, 0.06 * (fi - 1.0));
    let ctr = hinge + vec3<f32>(0.0, dh, 0.0);
    let hq = quadHit(ro, rd, ctr, qa.r, qa.u, dw, dh);
    if (hq.x > 0.0 && hq.x < tB) {
      col = bliss(vec2<f32>(hq.y * 0.5 + 0.5, 0.5 - hq.z * 0.5), fi * 0.5);
      let fr = max(abs(hq.y) - 1.0 + 0.1, abs(hq.z) - 1.0 + 0.05);
      col = mix(col, vec3<f32>(0.85, 0.55, 0.72), smoothstep(0.0, 0.02, fr));
      tB = hq.x;
    }
    // panel swinging on its left hinge
    let ang = base * 0.5 - 0.15 + op * 1.15;
    let pq = orient(ang, 0.06 * (fi - 1.0));
    let pc = ctr - qa.r * dw + pq.r * dw;
    let ph2 = quadHit(ro, rd, pc, pq.r, pq.u, dw, dh);
    if (ph2.x > 0.0 && ph2.x < tB) {
      var dc = mix(vec3<f32>(0.93, 0.66, 0.8), vec3<f32>(0.78, 0.5, 0.68), ph2.y * 0.5 + 0.5);
      let pn = abs(vec2<f32>(ph2.y, ph2.z)) - vec2<f32>(0.62, 0.78);
      dc = mix(dc, dc * 0.86, 1.0 - smoothstep(0.0, 0.03, max(pn.x, pn.y)));
      let kn = length(vec2<f32>(ph2.y - 0.72, ph2.z + 0.05)) - 0.07;
      dc = mix(dc, vec3<f32>(1.0, 0.92, 0.6), 1.0 - smoothstep(0.0, 0.02, kn));
      col = dc; tB = ph2.x;
    }
  }

  /* orb with an eye */
  let to2 = sphereHit(ro, rd, u.orb.xyz, 1.0);
  if (to2 > 0.0 && to2 < tB) {
    let po = ro + rd * to2; let n = normalize(po - u.orb.xyz);
    let lam = clamp(dot(n, normalize(vec3<f32>(-0.4, 0.7, 0.6))) * 0.5 + 0.5, 0.0, 1.0);
    var oc = mix(P(P_balloon_d), P(P_balloon), smoothstep(0.1, 0.9, lam));
    let spec = pow(clamp(dot(reflect(rd, n), normalize(vec3<f32>(-0.4, 0.7, 0.6))), 0.0, 1.0), 40.0);
    oc += spec * 0.6;
    let lp = po - u.orb.xyz;
    let ex = dot(lp, B.r) / 0.95; let ey = dot(lp, B.u) / 0.95;
    if (dot(n, -B.f) > 0.2) {
      let e = eyeCol(vec2<f32>(ex * 1.25, ey * 1.25 + 0.02), u.look.xy, u.misc.w, 0.02);
      oc = mix(oc, e.rgb, e.a);
    }
    col = fogMix(oc, to2); tB = to2;
  }

  /* balloons */
  for (var i = 0; i < 3; i = i + 1) {
    let b = u.bal[i];
    if (b.w <= 0.01) { continue; }
    let c = b.xyz; let r = 0.78 * b.w;
    // string
    let st = quadHit(ro, rd, c - vec3<f32>(0.0, 2.6 + r, 0.0), B.r, vec3<f32>(0.0, 1.0, 0.0), 0.03, 2.6);
    if (st.x > 0.0 && st.x < tB) { col = mix(col, vec3<f32>(1.0), 0.8); tB = st.x; }
    let tb2 = sphereHit(ro, rd, c, r);
    if (tb2 > 0.0 && tb2 < tB) {
      let pb = ro + rd * tb2; let n = normalize(pb - c);
      let lam = clamp(dot(n, normalize(vec3<f32>(-0.4, 0.7, 0.6))) * 0.5 + 0.5, 0.0, 1.0);
      var bc = mix(P(P_balloon_d), P(P_balloon), smoothstep(0.1, 0.9, lam));
      bc += pow(clamp(dot(reflect(rd, n), normalize(vec3<f32>(-0.4, 0.7, 0.6))), 0.0, 1.0), 30.0) * 0.7;
      col = fogMix(bc, tb2); tB = tb2;
    }
  }

  /* floating windows + polaroids + note + smiley + sky eye (camera-relative layers) */
  let A = vec3<f32>(ro.x, 0.0, ro.z);
  // sky eye
  {
    let c = A + vec3<f32>(-14.0 * u.look.z, 22.0 + pp * 10.0, -62.0);
    let h = quadHit(ro, rd, c, B.r, B.u, 14.5, 8.6);
    if (h.x > 0.0 && h.x < tB) {
      /* one world scale on both axes (8.6 / 14.5) so the iris stays a circle */
      let e = eyeCol(vec2<f32>(h.y, h.z * 0.593), u.look.xy, u.misc.w, 0.02);
      col = mix(col, mix(e.rgb, P(P_sky_mid), 0.35), e.a * 0.55); 
    }
  }
  // windows
  var wpos = array<vec3<f32>, 2>(vec3<f32>(5.2 * u.look.z, 5.0, -13.0), vec3<f32>(7.0 * u.look.z, 3.9, -12.0));
  for (var i = 0; i < 2; i = i + 1) {
    let c = vec3<f32>(wpos[i].x, wpos[i].y + sin(time * 0.6 + f32(i) * 2.0) * 0.12, wpos[i].z);
    let o = orient(-0.3 - f32(i) * 0.15, 0.06 - f32(i) * 0.12);
    let hw = select(2.1, 1.35, i == 1); let hh = select(1.55, 1.05, i == 1);
    let h = quadHit(ro, rd, c, o.r, o.u, hw, hh);
    if (h.x > 0.0 && h.x < tB) {
      let wc = xpWindow(h.y, h.z, f32(i), pxl(h.x, hw), u.look.xy, u.misc.w);
      if (wc.a > 0.02) { col = mix(col, wc.rgb, wc.a); if (wc.a > 0.5) { tB = h.x; } }
    }
  }
  // polaroids
  var ppos = array<vec3<f32>, 2>(vec3<f32>(13.0 * u.look.z, 9.0, -20.0), vec3<f32>(-8.5 * u.look.z, 2.8, -12.0));
  for (var i = 0; i < 2; i = i + 1) {
    let c = A + vec3<f32>(ppos[i].x, ppos[i].y + sin(time * 0.5 + f32(i) * 3.1) * 0.15 + pp * 7.0, ppos[i].z);
    let o = orient(select(-0.45, 0.35, i == 1), select(-0.22, 0.17, i == 1));
    let hw = select(2.7, 1.4, i == 1); let hh = hw * 1.17;
    let h = quadHit(ro, rd, c, o.r, o.u, hw, hh);
    if (h.x > 0.0 && h.x < tB) {
      let pc = polaroid(h.y, h.z, f32(i), pxl(h.x, hw));
      if (pc.a > 0.02) { col = mix(col, pc.rgb, pc.a); if (pc.a > 0.5) { tB = h.x; } }
    }
  }
  // note
  {
    let c = A + vec3<f32>(7.0 * u.look.z, 2.0 + pp * 4.0, -9.0);
    let o = orient(-0.5, 0.2);
    let h = quadHit(ro, rd, c, o.r, o.u, 1.5, 1.1);
    if (h.x > 0.0 && h.x < tB) {
      var nc = vec3<f32>(0.95, 0.91, 0.78) * (0.95 + 0.05 * hash21(floor(vec2<f32>(h.y, h.z) * 70.0)));
      let idx = floor(u.fx.z + 0.5);
      let ap = vec2<f32>((h.y * 0.5 + 0.5) * 256.0, 64.0 + idx * 160.0 + (0.5 - h.z * 0.5) * 160.0);
      nc = mix(nc, vec3<f32>(0.55, 0.15, 0.4), atl(ap).a);
      col = nc; tB = h.x;
    }
  }
  // smiley
  {
    let c = vec3<f32>(-7.0 * u.look.z, 1.5, -9.0);
    let h = quadHit(ro, rd, c, B.r, B.u, 1.1, 1.1);
    if (h.x > 0.0 && h.x < tB) {
      let uv = vec2<f32>(h.y, h.z); let r = length(uv); let aa = pxl(h.x, 1.1);
      var sc = vec3<f32>(1.0, 0.82, 0.1) * (0.9 + 0.1 * (uv.y * 0.5 + 0.5));
      let ey = min(length((uv - vec2<f32>(-0.33, 0.25)) * vec2<f32>(1.0, 0.6)), length((uv - vec2<f32>(0.33, 0.25)) * vec2<f32>(1.0, 0.6)));
      sc = mix(sc, vec3<f32>(0.17, 0.1, 0.0), 1.0 - smoothstep(0.1, 0.1 + aa * 2.0, ey));
      let mm = u.fx.w;
      let my = -0.35 + (uv.x * uv.x) * (0.55 * mm) * 1.0 - 0.0;
      let md = abs(uv.y - (-0.25 + (uv.x * uv.x - 0.2) * 0.9 * mm)) ;
      sc = mix(sc, vec3<f32>(0.17, 0.1, 0.0), (1.0 - smoothstep(0.045, 0.045 + aa * 2.0, md)) * select(0.0, 1.0, abs(uv.x) < 0.5));
      let a = 1.0 - smoothstep(0.88, 0.88 + aa * 2.0, r);
      let halo = (1.0 - smoothstep(0.88, 0.98, r)) * smoothstep(0.78, 0.88, r);
      col = mix(col, vec3<f32>(1.0), halo * 0.8);
      col = mix(col, sc, a);
      if (a > 0.5) { tB = h.x; }
    }
  }
  col = mist(col, ro, rd, tB, crest);
  /* END */
  return vec4<f32>(col, 1.0);
}
`;

const WGSL_POST = `
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
fn h21(p: vec2<f32>) -> f32 { var q = fract(p * vec2<f32>(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }

@fragment
fn fs(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fc.xy / u.res.zw;
  let g = u.ptr.z; let t = u.ang.z; let p = u.ang.w;
  var off = vec2<f32>(0.0);
  let tick = floor(t * 14.0);
  let band = floor(uv.y * 30.0);
  let rb = h21(vec2<f32>(band, tick));
  if (rb > 1.0 - g * 0.55) { off.x += (h21(vec2<f32>(band, tick + 9.0)) - 0.5) * g * 0.24; }
  let blk = floor(uv * vec2<f32>(6.0, 9.0));
  if (h21(blk + vec2<f32>(tick, 3.0)) > 1.0 - g * 0.12) { off += (vec2<f32>(h21(blk + 1.0), h21(blk + 2.0)) - 0.5) * g * 0.1; }
  off.x += sin(uv.y * 42.0 + t * 3.0) * 0.0007 * (0.15 + p * 1.6);
  let ca = 0.0010 + g * 0.012 + p * 0.0014;
  let uvv = uv + off;
  var c = vec3<f32>(
    textureSampleLevel(sceneTex, smp, uvv + vec2<f32>(ca, 0.0), 0.0).r,
    textureSampleLevel(sceneTex, smp, uvv, 0.0).g,
    textureSampleLevel(sceneTex, smp, uvv - vec2<f32>(ca, 0.0), 0.0).b);
  /* corner checker patches (2D collage) */
  let H = u.res.w; let X = fc.x / H; let Y = (u.res.w - fc.y) / H;
  let nz = h21(vec2<f32>(floor(fc.y / 14.0), 1.0));
  let rot = vec2<f32>(0.9, 0.43);
  var cpatch = 0.0;
  let L = 0.36 - X * 0.85 + (nz - 0.5) * 0.02;
  if (Y < L) { cpatch = 1.0; }
  let X2 = (u.res.z - fc.x) / H;
  let R = 0.30 - X2 * 0.9 + (nz - 0.5) * 0.02;
  if (Y < R) { cpatch = 2.0; }
  if (cpatch > 0.5) {
    var q = vec2<f32>(X, Y) * 7.0; if (cpatch > 1.5) { q = vec2<f32>(X2, Y) * 9.0; }
    q = vec2<f32>(q.x * rot.x - q.y * rot.y, q.x * rot.y + q.y * rot.x);
    let cb = fract(floor(q.x) * 0.5 + floor(q.y) * 0.5) * 2.0;
    c = mix(vec3<f32>(0.08, 0.06, 0.16), vec3<f32>(0.97, 0.96, 1.0), cb);
  }
  c += (h21(fc.xy + t) - 0.5) * 0.012;
  return vec4<f32>(c, 1.0);
}
`;

/* =====================================================================
   WEBGPU BACKGROUND  (a 3D ray-cast scene; falls back to the SVG scene)
   ===================================================================== */
const NPAL = TOKENS.length;
const G = { on: false, raf: 0, dev: null, p: 0, ps: 0, mx: 0, my: 0, yaw: 0, pit: 0, spin: .6, spinV: .07, ring: 0, t: 0, last: 0, glitch: 0, glitchDur: .25, nextGlitch: 3, blink: 1, nextBlink: 2, blinkT0: -9, rip: 0, ripX: 0, ripZ: -12, lookX: 0, lookY: 0, lastMove: 0, q: 1, ft: 0, fn: 0, doors: [0, 0, 0], doorT: [0, 0, 0], bal: [], note: 0, mood: 1, hover: null, dirty: false, L: 1, dpr: 1 };
Object.assign(G, {
  windA: .6, wph: 0, gust: .8, energy: 0, pPrev: 0,                 /* wind angle, wave phase, gust strength, scroll-stirred energy */
  rp: [0, 1, 2, 3].map(() => ({ x: 0, z: 0, t0: -99, amp: 0 })), rpi: 0,   /* click ripples */
  wkX: 0, wkZ: -8, wkAmp: 0,                                        /* pointer wake on the floor */
  mSq: 0, mSqV: 0, mSpore: -1, mHover: 0, mShear: 0,                /* mushroom spring, spore age, hover, lean */
});
const MUSH = [0, 0, -49.5];
const TF = Math.tan(55 * Math.PI / 360);
const BAL0 = [[1.8, 6.4, -17], [-1.2, 5.2, -14.5], [3.6, 4.4, -12.5]];
const ORB0 = [-2.9, 1.5, -12.5];
const DOOR_OFF = [[-.45, .25, .8], [.1, -.35, .95], [.62, .05, .75]], DOOR_BASE = [.35, -.05, 0];
const wgslConsts = () => TOKENS.map((t, i) => `const P_${t.replace(/-/g, '_')} = ${i}u;`).join('\n');

function atlasCanvas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 576; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.textBaseline = 'middle';
  x.font = 'bold 22px "Trebuchet MS", Tahoma, sans-serif'; x.fillText('Bliss.bmp', 4, 16); x.fillText('eye.avi', 4, 48);
  const msgs = [['somewhere', 'in your', 'memory...'], ['you have', 'been here', 'before...'], ['wake up.', 'wake up.', 'wake up.']];
  x.font = 'italic 40px "Segoe Script","Bradley Hand","Brush Script MT",cursive'; x.textAlign = 'center';
  msgs.forEach((m, i) => m.forEach((ln, j) => x.fillText(ln, 128, 64 + i * 160 + 30 + j * 50)));
  return c;
}
function camBasis() {
  const y = G.yaw, p = G.pit, f = [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)], r = [Math.cos(y), 0, Math.sin(y)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { r, u, f };
}
function project(x, y, z) {
  const B = G.B, c = G.cam, d = [x - c[0], y - c[1], z - c[2]];
  const fz = d[0] * B.f[0] + d[1] * B.f[1] + d[2] * B.f[2]; if (fz < .1) return null;
  const rx = d[0] * B.r[0] + d[1] * B.r[1] + d[2] * B.r[2], ry = d[0] * B.u[0] + d[1] * B.u[1] + d[2] * B.u[2], k = .5 * G.H / TF / fz;
  return [G.W / 2 + rx * k, G.H / 2 - ry * k, k, fz];
}
function floorAt(px, py) {
  const B = G.B, sx = (px - G.W / 2) / (G.H / 2), sy = (py - G.H / 2) / (G.H / 2);
  const rd = [B.f[0] + B.r[0] * sx * TF - B.u[0] * sy * TF, B.f[1] + B.r[1] * sx * TF - B.u[1] * sy * TF, B.f[2] + B.r[2] * sx * TF - B.u[2] * sy * TF];
  if (rd[1] > -.01) return null; const t = -G.cam[1] / rd[1]; return [G.cam[0] + rd[0] * t, G.cam[2] + rd[2] * t];
}

async function gpuStart(token) {
  if (window.MEMORY_NO_GPU || !navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!adapter) return false;
    const dev = await adapter.requestDevice();
    const cv = document.createElement('canvas'); cv.id = 'memory_gl'; cv.className = 'memory_bg'; cv.setAttribute('aria-hidden', 'true');
    const ctx = cv.getContext('webgpu'); if (!ctx) { dev.destroy(); return false; }
    const fmt = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: dev, format: fmt, alphaMode: 'opaque' });
    const common = WGSL_COMMON(NPAL, wgslConsts());
    const mS = dev.createShaderModule({ code: common + WGSL_VS + WGSL_SCENE }), mP = dev.createShaderModule({ code: common + WGSL_VS + WGSL_POST });
    const infos = await Promise.all([mS.getCompilationInfo(), mP.getCompilationInfo()]);
    const errs = infos.flatMap(i => i.messages.filter(m => m.type === 'error'));
    dev.pushErrorScope('validation');
    const [pipeS, pipeP] = await Promise.all([
      dev.createRenderPipelineAsync({ layout: 'auto', vertex: { module: mS, entryPoint: 'vs' }, fragment: { module: mS, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } }),
      dev.createRenderPipelineAsync({ layout: 'auto', vertex: { module: mP, entryPoint: 'vs' }, fragment: { module: mP, entryPoint: 'fs', targets: [{ format: fmt }] }, primitive: { topology: 'triangle-list' } }),
    ]);
    const verr = await dev.popErrorScope(); if (verr || errs.length) { dev.destroy(); return false; }
    if (!S.on || S.gen !== token) { dev.destroy(); return false; }
    /* resources */
    const landData = new Uint8Array(LAND_W * LAND_H); for (let i = 0; i < landData.length; i++) landData[i] = (LAND[i >> 3] >> (i & 7)) & 1 ? 255 : 0;
    const landTex = dev.createTexture({ size: [LAND_W, LAND_H], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    dev.queue.writeTexture({ texture: landTex }, landData, { bytesPerRow: LAND_W }, [LAND_W, LAND_H]);
    const atlasTex = dev.createTexture({ size: [512, 576], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    dev.queue.copyExternalImageToTexture({ source: atlasCanvas() }, { texture: atlasTex }, [512, 576]);
    const smp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const f32n = (14 + NPAL + 7) * 4, ub = dev.createBuffer({ size: f32n * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bgS = dev.createBindGroup({ layout: pipeS.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: landTex.createView() }, { binding: 2, resource: atlasTex.createView() }, { binding: 3, resource: smp }] });
    Object.assign(G, { on: true, dev, cv, ctx, fmt, pipeS, pipeP, bgS, ub, smp, data: new Float32Array(f32n), sceneTex: null, bgP: null });
    G.bal = BAL0.map((b, i) => ({ x: b[0], y: b[1], z: b[2], w: 1, pop: 0, ph: i * 2.1, respawn: 0 }));
    G.q = 1; G.ft = 0; G.fn = 0; G.t = G.t || 0; G.last = performance.now(); G.lastMove = 0;
    document.body.insertBefore(cv, document.body.firstChild);
    dev.lost.then(info => { if (G.on && G.dev === dev && info.reason !== 'destroyed') { gpuStop(); if (S.on) startSVG(); } });
    gpuMeasure();
    return true;
  } catch (e) { return false; }
}
/* Configure before memory.js runs:  window.MEMORY_CONFIG = { scale: 1, maxDpr: 2, adaptive: true, budget: 1.15e6 }
   scale    1 (default) = render 1:1 with the canvas pixels for best sharpness; .75/.5 = cheaper, softer; 'auto' = pixel budget
   maxDpr   cap on devicePixelRatio used for the canvas (default 2)
   adaptive true = lower quality automatically if frames run slow (set false to hold the chosen scale)
   filter   'linear' (smooth upscale, default) or 'nearest' (crisp pixels when scale < 1); the upscale happens inside the
            shader, so CSS image-rendering has no effect on it
   Also readable from <html data-memory-scale="1">. */
function gpuConfig() {
  const c = Object.assign({ scale: 0.5, maxDpr: 2, adaptive: true, budget: 1.15e6, filter: 'linear' }, window.MEMORY_CONFIG || {});
  const a = root.dataset.memoryScale; if (a) c.scale = a === 'auto' ? 'auto' : +a;
  if (root.dataset.memoryFilter) c.filter = root.dataset.memoryFilter;
  return c;
}
function gpuMeasure() {
  if (!G.dev || !G.cv) return;
  const C = gpuConfig(), W = G.W = innerWidth, H = G.H = innerHeight, dpr = G.dpr = Math.min(devicePixelRatio || 1, C.maxDpr);
  G.L = clamp(W / H / 1.78, .42, 1.7);   /* layout scales with aspect so wide screens fill the frame */
  G.cv.width = Math.round(W * dpr); G.cv.height = Math.round(H * dpr);
  /* scale: 1 = scene rendered 1:1 with the canvas pixels (sharpest); <1 renders smaller and upscales; 'auto' = pixel budget */
  const rs = C.scale === 'auto' ? Math.min(1, Math.sqrt(C.budget / (W * H))) * G.q : clamp(+C.scale || 1, .25, 2) * G.q,
    base = C.scale === 'auto' ? [W, H] : [G.cv.width, G.cv.height],
    rw = Math.max(160, Math.round(base[0] * rs)), rh = Math.max(90, Math.round(base[1] * rs));
  G.rw = rw; G.rh = rh;
  G.sceneTex?.destroy();
  G.sceneTex = G.dev.createTexture({ size: [rw, rh], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  G.bgP = G.dev.createBindGroup({ layout: G.pipeP.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: G.ub } }, { binding: 1, resource: G.sceneTex.createView() }, { binding: 2, resource: G.dev.createSampler(gpuConfig().filter === 'nearest' ? { magFilter: 'nearest', minFilter: 'nearest' } : { magFilter: 'linear', minFilter: 'linear' }) }] });
  G.dirty = true;
}
function gpuKick(k, dur) { G.glitch = Math.max(G.glitch, k); G.glitchDur = dur; }
function gpuScrollP() { return clamp(scrollY / Math.max(1, root.scrollHeight - innerHeight), 0, 1); }

function gpuUpdate(dt) {
  const still = stillV, t = G.t += still ? 0 : dt;
  const P = G.H > G.W, L = G.L;
  G.p = gpuScrollP(); G.ps += (G.p - G.ps) * (still ? 1 : Math.min(1, dt * 4));
  const p = G.ps, k = Math.min(1, dt * 5);
  G.yaw += (G.mx * .05 - G.yaw) * k; G.pit0 = Math.atan(((2 * ((P ? .5 : .6) - p * (P ? .26 : .36))) - 1) * TF);
  G.pit += (G.pit0 - G.my * .025 - G.pit) * k;
  G.cam = [G.mx * .6 + Math.sin(t * .15) * .25 * p, 1.7 - p * .55, -p * 42];
  G.B = camBasis();
  if (!still) {
    G.spin += G.spinV * dt; G.spinV += ((.07 + p * .25) - G.spinV) * Math.min(1, dt * .7); G.ring += dt * .35;
    if (G.rip > 0) G.rip = Math.max(0, G.rip - dt * 1.4);
    G.glitch = Math.max(0, G.glitch - dt / G.glitchDur);
    G.nextGlitch -= dt; if (G.nextGlitch <= 0) { gpuKick(.35 + Math.random() * .5 + p * .5, .12 + Math.random() * .2); G.nextGlitch = (2.2 + Math.random() * 6) / (1 + p * 2.8); }
    if (t > G.nextBlink && t - G.blinkT0 > .3) { G.blinkT0 = t; G.nextBlink = t + 2.5 + Math.random() * 5; }
    const bt = (t - G.blinkT0) / .2; G.blink = bt < 1 ? 1 - Math.sin(bt * Math.PI) * .94 : 1;
  }
  for (let i = 0; i < 3; i++) G.doors[i] += (G.doorT[i] - G.doors[i]) * Math.min(1, dt * 6);
  /* wind, waves + the mushroom's spring */
  if (dt > 0) G.energy += (Math.min(Math.abs(p - G.pPrev) / dt * 2.2, 1.3) - G.energy) * Math.min(1, dt * 2.5);
  G.pPrev = p;
  if (!still) {
    G.windA = .62 + Math.sin(t * .09) * .5 + Math.sin(t * .031 + 1.3) * .22;
    G.gust = clamp(.78 + Math.sin(t * .23) * .2 + Math.sin(t * .67 + 2) * .1 + G.energy * .55 + G.wkAmp * .25, .4, 1.8);
    G.wph += dt * (.8 + G.gust * 1.2);
    G.wkAmp = Math.max(0, G.wkAmp - dt * 1.1);
    G.mSqV += (-140 * G.mSq - 9 * G.mSqV) * dt; G.mSq = clamp(G.mSq + G.mSqV * dt, -.4, .45);
    if (G.mSpore >= 0) { G.mSpore += dt; if (G.mSpore > 3.2) G.mSpore = -1; }
  }
  G.mHover += ((G.hover && G.hover.kind === 'mush' ? 1 : 0) - G.mHover) * Math.min(1, dt * 8);
  G.mShear = clamp(G.mx, -1, 1) * .04 * G.mHover + (still ? 0 : Math.sin(t * .9) * .018 * G.gust);
  const idle = t - G.lastMove > 4;
  const tx = idle ? Math.sin(t * .5) * .8 : clamp(G.mx * 1.4, -1, 1), ty = idle ? Math.cos(t * .37) * .5 : clamp(-G.my * 1.4, -1, 1);
  G.lookX += (tx - G.lookX) * Math.min(1, dt * 9); G.lookY += (ty - G.lookY) * Math.min(1, dt * 9);
  /* balloons */
  G.bal.forEach((b, i) => {
    const o = BAL0[i];
    if (b.pop) { b.respawn -= dt; b.w = 0; if (b.respawn <= 0) { b.pop = 0; b.w = .01; } }
    else if (b.w < 1) b.w = Math.min(1, b.w + dt * 1.2);
    b.x = o[0] * L + Math.sin(t * .5 + b.ph) * .35; b.y = o[1] + Math.sin(t * .7 + b.ph) * .4 + p * 2; b.z = o[2];
  });
  /* globe */
  const wide = clamp((L - 1) / .4, 0, 1), gR = 5.3 * (1 + .3 * wide);
  G.gc = [G.cam[0] + 9.6 * L * (1 + .15 * wide), 4.4 + p * 22, G.cam[2] - 22]; G.gR = gR;
  G.orb = [ORB0[0] * L, ORB0[1] + Math.sin(t * .8) * .12, ORB0[2]];
}
function gpuWrite() {
  const d = G.data, p = G.ps, m = S.dark ? PAL.dark : PAL.light, uu = clamp(p, 0, 1) * 2, ii = Math.min(1, Math.floor(uu)), ff = uu - ii;
  const set = (o, a) => { for (let i = 0; i < a.length; i++) d[o + i] = a[i]; };
  set(0, [G.rw, G.rh, G.cv.width, G.cv.height]);
  set(4, [G.cam[0], G.cam[1], G.cam[2], TF]);
  set(8, [G.yaw, G.pit, G.t, p]);
  set(12, [G.mx, G.my, G.glitch * G.glitch * (3 - 2 * G.glitch) * 1.0 + (G.glitch > 0 ? 0 : 0), 0]);
  set(16, [S.dark ? 1 : 0, G.spin, G.ring, G.blink]);
  set(20, [G.lookX, G.lookY, G.L, 0]);
  set(24, [G.wkX, G.wkZ, G.wkAmp, 0]);
  set(28, [G.doors[0], G.doors[1], G.doors[2], 0]);
  set(32, [.012 + p * .014, .55 + p * .45, G.note, G.mood]);
  set(36, [G.orb[0], G.orb[1], G.orb[2], 1]);
  set(40, [G.gc[0], G.gc[1], G.gc[2], G.gR]);
  G.bal.forEach((b, i) => set(44 + i * 4, [b.x, b.y, b.z, b.w]));
  TOKENS.forEach((t, i) => { const a = m[t][ii], b = m[t][ii + 1], o = 56 + i * 4; d[o] = lerp(a[0], b[0], ff) / 255; d[o + 1] = lerp(a[1], b[1], ff) / 255; d[o + 2] = lerp(a[2], b[2], ff) / 255; d[o + 3] = 1; });
  const e0 = 56 + NPAL * 4;
  set(e0, [G.mSq, G.mSpore, G.mHover, G.mShear]);
  set(e0 + 4, [MUSH[0], MUSH[1], MUSH[2], 0]);
  set(e0 + 8, [G.windA, G.wph, G.gust, 0]);
  G.rp.forEach((r, i) => { const age = G.t - r.t0; set(e0 + 12 + i * 4, [r.x, r.z, age, age >= 0 && age < 8 ? r.amp : 0]); });
  if (G.dev?.queue) G.dev.queue.writeBuffer(G.ub, 0, d);
}
function gpuRender() {
  if (!G.on || !G.dev || !G.sceneTex) return;
  gpuUpdate(G.dt || 0); gpuWrite();
  if (!G.dev || !G.ctx) return;
  const enc = G.dev.createCommandEncoder();
  let pass = enc.beginRenderPass({ colorAttachments: [{ view: G.sceneTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(G.pipeS); pass.setBindGroup(0, G.bgS); pass.draw(3); pass.end();
  pass = enc.beginRenderPass({ colorAttachments: [{ view: G.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(G.pipeP); pass.setBindGroup(0, G.bgP); pass.draw(3); pass.end();
  if (G.dev?.queue) G.dev.queue.submit([enc.finish()]);
  if (!G.ready) { G.ready = true; root.classList.add('m-ready'); }
}
function gpuFrame(now) {
  if (!G.on || !G.dev) return; G.raf = requestAnimationFrame(gpuFrame);
  if (G.busy) return;   /* never queue more work than the GPU can finish */
  const dt = Math.min(.05, (now - G.last) / 1000); G.last = now; G.dt = dt;
  gpuRender();
  if (!G.on || !G.dev?.queue) return;
  const t0 = performance.now(); G.busy = true;
  G.dev.queue.onSubmittedWorkDone().then(() => {
    G.busy = false; if (!G.on || !G.dev || window.MEMORY_GPU_FIXED || document.hidden) return;
    G.ft += performance.now() - t0; G.fn++;
    if (G.fn >= 30) { const avg = G.ft / G.fn; G.ft = 0; G.fn = 0; if (avg > 20 && G.q > .45 && gpuConfig().adaptive) { G.q = Math.max(.45, G.q * .8); gpuMeasure(); } }
  }).catch(() => { G.busy = false; });
}
function gpuSync() {
  if (!G.on || !G.dev) return; cancelAnimationFrame(G.raf); G.raf = 0; G.lf = 0; G.ft = 0; G.fn = 0;
  if (document.hidden || stillV) { G.dt = 0; gpuRender(); return; }
  G.last = performance.now(); G.raf = requestAnimationFrame(gpuFrame);
}
function gpuDirty() { if (G.on && G.dev && !G.raf) { G.dt = 0; gpuRender(); } }

/* interaction */
function gpuPick(x, y) {
  const tf = TF;
  for (let i = 2; i >= 0; i--) { // doors
    const o = DOOR_OFF[i], h = [G.gc[0] + o[0] * G.gR * .95, G.gc[1] + o[1] * G.gR * .95 + .95, G.gc[2] + o[2] * G.gR * .95], s = project(h[0], h[1], h[2]);
    if (s && Math.abs(x - s[0]) < .6 * s[2] && Math.abs(y - s[1]) < 1.0 * s[2]) return { kind: 'door', i };
  }
  for (let i = 0; i < 3; i++) { const b = G.bal[i]; if (b.pop || b.w < .5) continue; const s = project(b.x, b.y, b.z); if (s && Math.hypot(x - s[0], y - s[1]) < .85 * s[2]) return { kind: 'balloon', i }; }
  const so = project(G.orb[0], G.orb[1], G.orb[2]); if (so && Math.hypot(x - so[0], y - so[1]) < 1.05 * so[2]) return { kind: 'orb' };
  const sg = project(G.gc[0], G.gc[1], G.gc[2]); if (sg && Math.hypot(x - sg[0], y - sg[1]) < G.gR * sg[2]) return { kind: 'globe' };
  /* the fly agaric: an ellipse for the cap, a strip for the stem */
  const mc = project(MUSH[0], MUSH[1] + 1.45, MUSH[2]), mb = project(MUSH[0], MUSH[1], MUSH[2]);
  if (mc && mb) {
    const k = mc[2], dx = (x - mc[0]) / (1.65 * k), dy = (y - mc[1]) / (1.1 * k);
    if ((dx * dx + dy * dy < 1 && y <= mc[1] + .25 * k) || (Math.abs(x - mc[0]) < .55 * k && y > mc[1] && y < mb[1])) return { kind: 'mush' };
  }
  return null;
}
function gpuRipple(x, z, amp) { const r = G.rp[G.rpi = (G.rpi + 1) % 4]; r.x = x; r.z = z; r.t0 = G.t; r.amp = amp; }
function gpuMove(e) {
  G.mx = (e.clientX / innerWidth - .5) * 2; G.my = (e.clientY / innerHeight - .5) * 2; G.lastMove = G.t;
  if (G.down && G.drag === 'globe') { G.spin += (e.movementX || 0) / (G.gR * 60) * 3; G.spinV = (e.movementX || 0) * .02; return; }
  if (e.pointerType === 'touch' || !isBg(e.target)) { if (G.hover) { G.hover = null; root.classList.remove('m-grab'); } return; }
  const h = gpuPick(e.clientX, e.clientY);
  if ((h?.kind || '') !== (G.hover?.kind || '')) { root.classList.toggle('m-grab', !!h); } G.hover = h;
  /* the pointer drags a wake through the floor */
  if (G.B && !stillV) { const f = floorAt(e.clientX, e.clientY); if (f) { G.wkX = f[0]; G.wkZ = f[1]; G.wkAmp = Math.min(1, G.wkAmp + Math.hypot(e.movementX || 0, e.movementY || 0) * .006); } }
  if (!G.raf) gpuDirty();
}
function gpuDown(e) {
  if (e.button > 0 || !isBg(e.target)) return;
  G.down = true; G.sx = e.clientX; G.sy = e.clientY; const h = gpuPick(e.clientX, e.clientY); G.hit = h;
  if (h?.kind === 'globe' && e.pointerType !== 'touch') { G.drag = 'globe'; root.classList.add('m-dragging'); }
}
function gpuUp(e) {
  if (!G.down) return; G.down = false; const h = G.hit; G.hit = null; G.drag = null; root.classList.remove('m-dragging');
  if (Math.hypot(e.clientX - G.sx, e.clientY - G.sy) > 6) return;
  if (h) {
    if (h.kind === 'balloon') { const b = G.bal[h.i], s = project(b.x, b.y, b.z); b.pop = 1; b.respawn = 5 + Math.random() * 3; b.w = 0; gpuKick(.5, .15); if (s) confetti(s[0], s[1]); }
    else if (h.kind === 'mush') { G.mSqV = 4.5; G.mSpore = 0; G.blinkT0 = G.t - .01; gpuKick(.35, .12); gpuRipple(MUSH[0], MUSH[2] + .4, 1.2); }
    else if (h.kind === 'door') { G.doorT[h.i] = G.doorT[h.i] > .5 ? 0 : 1; gpuKick(.3, .12); }
    else if (h.kind === 'orb') { G.blinkT0 = G.t - .01; gpuKick(.4, .15); }
    else if (h.kind === 'globe') { G.spinV += 1.2; gpuKick(.6, .25); }
  } else if (isBg(e.target)) {
    const f = floorAt(e.clientX, e.clientY); if (f) gpuRipple(f[0], f[1], 1);
  }
  gpuDirty();
}
function gpuStop() {
  G.on = false;
  if (G.raf) { cancelAnimationFrame(G.raf); G.raf = 0; }
  G.busy = false;
  root.classList.remove('m-ready', 'm-grab', 'm-dragging');
  try { G.cv?.remove(); G.sceneTex?.destroy(); G.dev?.destroy(); } catch (e) { }
  G.dev = null;
  G.cv = null;
  G.ctx = null;
  G.pipeS = null;
  G.pipeP = null;
  G.bgS = null;
  G.bgP = null;
  G.ub = null;
  G.sceneTex = null;
  G.ready = false;
}

/* =====================================================================
   ENABLE / DISABLE
   ===================================================================== */
function isDark() {
  if (root.dataset.mode === "dark") return true;
  if (root.dataset.mode === "light") return false;
  const g = id => document.getElementById(id)?.checked;
  return g("theme_state_dark") || (!g("theme_state_light") && matchMedia("(prefers-color-scheme: dark)").matches);
}
function enable() {
  if (S.on) return; S.on = true; S.mode = ''; root.classList.add('m-on');
  try { if (typeof Contour_Map !== 'undefined' && Contour_Map.instance?.destroy) { Contour_Map.instance.destroy(); S.contourStopped = true; } } catch (e) { }
  refreshStill(); S.dark = isDark(); ransomize(true);
  S.ac = new AbortController(); const o = { signal: S.ac.signal };
  document.addEventListener('visibilitychange', sync, o);
  const retheme = () => { S.dark = isDark(); if (S.mode === 'gpu') gpuDirty(); else if (S.mode === 'svg') updateScene(true); };
  document.addEventListener('change', e => { if (e.target.name === 'theme_state') setTimeout(retheme, 0); if (e.target.id === 'motion_pause') { refreshStill(); sync(); } }, o);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme, o);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { refreshStill(); sync(); }, o);
  const token = S.gen = (S.gen || 0) + 1;
  gpuStart(token).then(ok => {
    if (!S.on || S.gen !== token) { if (ok) gpuStop(); return; }
    if (!ok) { startSVG(); return; }
    S.mode = 'gpu';
    addEventListener('resize', () => { gpuMeasure(); gpuDirty(); }, o);
    addEventListener('pointermove', gpuMove, { signal: S.ac.signal, passive: true });
    addEventListener('pointerdown', gpuDown, o); addEventListener('pointerup', gpuUp, o); addEventListener('pointercancel', gpuUp, o);
    addEventListener('scroll', () => { if (stillV) gpuDirty(); }, { signal: S.ac.signal, passive: true });
    G.ps = gpuScrollP(); G.dt = 0; sync();
    if (!stillV) { gpuKick(1, .5); for (let i = 1; i < 5; i++) setTimeout(() => G.on && gpuKick(1 - i * .15, .2), i * 170); }
  });
}
function startSVG() {
  S.mode = 'svg'; const o = { signal: S.ac.signal };
  if (!S.svg) buildScene(); else document.body.insertBefore(S.svg, document.body.firstChild);
  S.p = 0; S.last = performance.now(); S.time = S.time || 0;
  measure();
  addEventListener('resize', () => { measure(); step(0, true); }, o);
  addEventListener('pointermove', e => { onMove(e); }, { signal: S.ac.signal, passive: true });
  addEventListener('pointerdown', onDown, o); addEventListener('pointerup', onUp, o); addEventListener('pointercancel', onUp, o);
  addEventListener('scroll', () => { if (still()) step(0, true); }, { signal: S.ac.signal, passive: true });
  S.velTimer = setInterval(trackVel, 40);
  S.p = clamp(scrollY / Math.max(1, root.scrollHeight - innerHeight), 0, 1);
  step(0, true); sync(); root.classList.add('m-ready');
  if (!still()) { S.flashV = .7; for (let i = 0; i < 5; i++) setTimeout(() => S.on && glitch(1 - i * .15, .2), i * 170); }
}
function disable() {
  if (!S.on) return; S.on = false; S.gen = (S.gen || 0) + 1; root.classList.remove('m-on', 'm-ready', 'm-grab', 'm-dragging');
  cancelAnimationFrame(S.raf); S.raf = 0; clearInterval(S.velTimer); S.ac?.abort();
  gpuStop(); S.mode = ''; confettiClear();
  S.svg?.remove(); ransomize(false); root.style.removeProperty('--m-p');
  try { if (S.contourStopped && typeof Contour_Map !== 'undefined') { Contour_Map.instance = new Contour_Map(); S.contourStopped = false; } } catch (e) { }
}
function sync() {
  if (!S.on) return;
  if (S.mode === 'gpu') { gpuSync(); return; }
  if (S.mode !== 'svg') return;
  cancelAnimationFrame(S.raf); S.raf = 0;
  if (document.hidden || still()) { step(0, true); return; }
  S.last = performance.now(); S.raf = requestAnimationFrame(frame);
}
function check() {
  const isMemory = root.dataset.theme === "memory" || getRadio()?.checked;
  if (isMemory) enable();
  else disable();
}

export function mount(layer, options) {
  enable();
  return {
    async fade_in(ms) {},
    async fade_out(ms) {},
    pause() {
      if (S.mode === "gpu") { cancelAnimationFrame(G.raf); G.raf = 0; }
      else if (S.mode === "svg") { cancelAnimationFrame(S.raf); S.raf = 0; }
    },
    resume() {
      sync();
    },
    dispose() {
      disable();
    }
  };
}

export { enable, disable };

document.addEventListener("change", e => {
  if (e.target.name === "theme_name") check();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (root.dataset.theme === "memory" || getRadio()?.checked) enable();
  });
} else {
  if (root.dataset.theme === "memory" || getRadio()?.checked) enable();
}

if (typeof window !== "undefined") {
  window.jasouza_theme_memory = { mount, enable, disable };
}