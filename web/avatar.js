'use strict';
// Dessin d'un personnage en pixels, facon Minecraft, vu de face. Grille de 16 x 32 :
// tete 8x8, corps 8x12, bras 4x12, jambes 4x12. Les etats (travaille, attend...) sont animes en CSS.

(function () {
  const HEX = /^#[0-9a-f]{6}$/i;
  const col = (c, d) => (typeof c === 'string' && HEX.test(c) ? c : d);
  // Assombrit / eclaircit une couleur hexadecimale.
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => ch(v).toString(16).padStart(2, '0')).join('');
  }

  function render(look, opts = {}) {
    const L = look || {};
    const skin = col(L.skin, '#e0ac69'), hair = col(L.hair, '#5a3825'), eyes = col(L.eyes, '#2563eb');
    const shirt = col(L.shirt, '#3b82f6'), pants = col(L.pants, '#1e3a8a'), shoes = col(L.shoes, '#1f2937');
    const hatC = col(L.hatColor, '#ef4444'), accC = col(L.accessoryColor, '#111827');
    const px = [];
    const r = (x, y, w, h, c) => px.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`);

    // --- jambes et chaussures
    const legs = [];
    const rl = (x, y, w, h, c) => legs.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`);
    rl(4, 20, 4, 12, pants); rl(8, 20, 4, 12, shade(pants, -0.12));
    rl(4, 30, 4, 2, shoes); rl(8, 30, 4, 2, shoes);
    if (L.shirtStyle === 'salopette') { rl(4, 20, 8, 2, pants); }

    // --- corps
    r(4, 8, 8, 12, shirt);
    if (L.shirtStyle === 'rayures') for (let y = 9; y < 20; y += 3) r(4, y, 8, 1, shade(shirt, -0.3));
    if (L.shirtStyle === 'veste') { r(4, 8, 3, 12, shade(shirt, -0.35)); r(9, 8, 3, 12, shade(shirt, -0.35)); r(7, 8, 2, 12, '#e5e7eb'); }
    if (L.shirtStyle === 'salopette') { r(5, 12, 6, 8, pants); r(5, 8, 1, 4, pants); r(10, 8, 1, 4, pants); r(5, 13, 1, 1, '#facc15'); r(10, 13, 1, 1, '#facc15'); }
    r(4, 19, 8, 1, shade(shirt, -0.2));

    // --- bras (le droit, a gauche de l'image, tient l'outil)
    const armL = [], armR = [];
    const ra = (arr) => (x, y, w, h, c) => arr.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`);
    const aL = ra(armL), aR = ra(armR);
    aL(0, 8, 4, 4, shade(shirt, -0.1)); aL(0, 12, 4, 8, skin); aL(0, 19, 4, 1, shade(skin, -0.15));
    aR(12, 8, 4, 4, shade(shirt, -0.1)); aR(12, 12, 4, 8, shade(skin, -0.06)); aR(12, 19, 4, 1, shade(skin, -0.2));
    if (L.shirtStyle === 'veste') { aL(0, 8, 4, 10, shade(shirt, -0.35)); aR(12, 8, 4, 10, shade(shirt, -0.35)); }

    // outil tenu dans la main droite
    const t = L.tool, wood = '#8b5a2b', iron = '#cbd5e1', dark = '#334155';
    if (t === 'pioche') { aL(1, 12, 1, 9, wood); aL(-3, 11, 9, 2, iron); aL(-4, 12, 1, 2, iron); aL(6, 12, 1, 2, iron); }
    if (t === 'marteau') { aL(1, 13, 1, 8, wood); aL(-1, 11, 5, 3, dark); }
    if (t === 'cle') { aL(1, 12, 1, 8, iron); aL(0, 10, 3, 2, iron); aL(1, 10, 1, 1, '#0f1115'); }
    if (t === 'epee') { aL(1, 4, 2, 13, iron); aL(-1, 16, 6, 1, '#a16207'); aL(1, 17, 2, 3, wood); }
    if (t === 'clavier') { aL(-3, 16, 10, 3, dark); for (let k = -2; k < 7; k += 2) aL(k, 17, 1, 1, iron); }
    if (t === 'pinceau') { aL(1, 12, 1, 8, wood); aL(0, 10, 3, 2, '#e5e7eb'); aL(0, 9, 3, 1, hatC); }

    // --- tete
    const head = [];
    const rh = (x, y, w, h, c) => head.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`);
    rh(4, 0, 8, 8, skin);
    rh(5, 4, 1, 1, '#ffffff'); rh(6, 4, 1, 1, eyes); rh(9, 4, 1, 1, eyes); rh(10, 4, 1, 1, '#ffffff');
    rh(7, 6, 2, 1, shade(skin, -0.3));
    const hs = L.hairStyle || 'court';
    if (hs !== 'chauve') { rh(4, 0, 8, 2, hair); rh(4, 2, 1, 2, hair); rh(11, 2, 1, 2, hair); }
    if (hs === 'long') { rh(4, 2, 1, 8, hair); rh(11, 2, 1, 8, hair); rh(3, 3, 1, 7, hair); rh(12, 3, 1, 7, hair); }
    if (hs === 'crete') { rh(7, -3, 2, 3, hair); }
    if (hs === 'queue') { rh(12, 2, 2, 2, hair); rh(13, 4, 1, 4, hair); }
    // accessoires du visage
    const a = L.accessory;
    if (a === 'lunettes') { rh(4, 4, 8, 1, accC); rh(5, 3, 2, 3, accC); rh(9, 3, 2, 3, accC); rh(5, 4, 1, 1, '#93c5fd'); rh(10, 4, 1, 1, '#93c5fd'); }
    if (a === 'barbe') { rh(4, 5, 1, 3, hair); rh(11, 5, 1, 3, hair); rh(5, 7, 6, 1, hair); rh(6, 6, 1, 1, hair); rh(9, 6, 1, 1, hair); }
    if (a === 'masque') { rh(4, 5, 8, 3, accC); }
    if (a === 'cache-oeil') { rh(4, 3, 8, 1, '#111111'); rh(9, 3, 2, 3, '#111111'); }
    if (a === 'casque-audio') { rh(3, -1, 10, 1, accC); rh(3, 0, 1, 3, accC); rh(12, 0, 1, 3, accC); rh(2, 3, 2, 3, accC); rh(12, 3, 2, 3, accC); }
    // chapeaux
    const h = L.hat;
    if (h === 'casquette') { rh(4, -1, 8, 2, hatC); rh(3, 1, 11, 1, shade(hatC, -0.25)); }
    if (h === 'casque') { rh(4, -2, 8, 3, hatC); rh(3, -1, 10, 2, hatC); rh(2, 1, 12, 1, shade(hatC, -0.2)); rh(7, -2, 2, 1, shade(hatC, 0.3)); }
    if (h === 'couronne') { rh(4, -1, 8, 1, '#facc15'); [4, 6, 9, 11].forEach(x => rh(x, -3, 1, 2, '#facc15')); rh(7, -2, 2, 1, '#ef4444'); }
    if (h === 'bandana') { rh(4, 1, 8, 1, hatC); rh(4, 0, 8, 1, shade(hatC, -0.2)); rh(12, 1, 2, 1, hatC); rh(13, 2, 1, 2, hatC); }
    if (h === 'chapeau') { rh(2, 0, 12, 1, hatC); rh(5, -3, 6, 3, hatC); rh(5, -1, 6, 1, shade(hatC, -0.4)); }
    if (h === 'capuche') { rh(3, -1, 10, 2, hatC); rh(3, 1, 1, 8, hatC); rh(12, 1, 1, 8, hatC); }

    const size = opts.size || 64;
    const state = opts.state || '';
    // Bulle au-dessus de la tete : ? = attend ta reponse, ! = a fini, a toi
    const bubble = state === 'waiting' ? ['?', '#f2b84b'] : state === 'idle' ? ['!', '#4fd18b'] : null;
    const bub = bubble ? `<g class="av-bubble"><rect x="12" y="-10" width="9" height="8" rx="1" fill="${bubble[1]}"/><rect x="14" y="-2" width="2" height="2" fill="${bubble[1]}"/><text x="16.5" y="-3.6" font-size="7" font-weight="700" text-anchor="middle" fill="#0f1115" font-family="monospace">${bubble[0]}</text></g>` : '';
    return `<svg class="av av-${state}" viewBox="-6 -11 28 44" width="${Math.round(size * 28 / 44)}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="personnage">
<g class="av-body"><g class="av-legs">${legs.join('')}</g>${px.join('')}<g class="av-arm-l">${armL.join('')}</g><g class="av-arm-r">${armR.join('')}</g><g class="av-head">${head.join('')}</g></g>${bub}</svg>`;
  }

  // Une petite forge en pixels, pour la compilation.
  function forge(size = 64, lit = false) {
    const f = lit ? '#f97316' : '#475569', g = lit ? '#facc15' : '#64748b';
    return `<svg class="forge${lit ? ' lit' : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" shape-rendering="crispEdges" aria-label="forge">
<rect x="2" y="10" width="20" height="12" fill="#57534e"/><rect x="2" y="10" width="20" height="2" fill="#78716c"/>
<rect x="6" y="14" width="12" height="6" fill="#1c1917"/><rect x="7" y="16" width="10" height="4" fill="${f}" class="forge-fire"/>
<rect x="9" y="15" width="6" height="2" fill="${g}" class="forge-fire"/><rect x="4" y="2" width="4" height="8" fill="#44403c"/>
<rect x="4" y="0" width="4" height="2" fill="#57534e"/></svg>`;
  }

  window.Avatar = { render, forge, shade };
})();
