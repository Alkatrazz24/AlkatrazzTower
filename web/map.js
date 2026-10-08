'use strict';
// Carte du projet : la maison au centre, c'est le jeu ; chaque extension est un domaine du projet
// (Blueprints, Animations, Sons...). Sa taille suit ce qu'elle contient, des echafaudages montrent
// ce qui a bouge ces derniers jours, et les personnages des agents se tiennent devant la piece ou
// ils travaillent.

(function () {
  const ROOMS = {
    blueprints: ['Blueprints', '#3b82f6'], animations: ['Animations', '#f59e0b'], personnages: ['Personnages', '#ec4899'],
    decors: ['Décors', '#84cc16'], materiaux: ['Matériaux', '#a855f7'], textures: ['Textures', '#14b8a6'],
    sons: ['Sons', '#06b6d4'], effets: ['Effets', '#f97316'], niveaux: ['Niveaux', '#22c55e'],
    interface: ['Interface', '#eab308'], donnees: ['Données', '#64748b'], ia: ['IA', '#ef4444'],
    cinematiques: ['Cinématiques', '#8b5cf6'], code: ['Code C++', '#0ea5e9'], tests: ['Tests', '#10b981'], autres: ['Autres', '#475569'],
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shade = (hex, f) => window.Avatar.shade(hex, f);

  // Taille d'une extension selon son nombre d'elements (echelle log : 10 ou 1000 restent lisibles).
  function dims(count) {
    const l = Math.log10(count + 1);
    return { w: Math.round(64 + 14 * l), h: Math.round(Math.min(200, 46 + 38 * l)) };
  }

  function windows(x, y, w, h, color, lit) {
    const out = [];
    const cols = Math.max(1, Math.floor((w - 16) / 20)), rows = Math.max(1, Math.floor((h - 34) / 26));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = lit && ((r * 7 + c * 3) % 3 !== 0);
        out.push(`<rect x="${x + 10 + c * 20}" y="${y + 14 + r * 26}" width="10" height="12" fill="${on ? '#fde68a' : shade(color, -0.55)}" ${on ? 'class="map-lit"' : ''}/>`);
      }
    }
    return out.join('');
  }

  function scaffold(x, y, w, h) {
    const wood = '#a16207', parts = [];
    for (let px = x - 4; px <= x + w + 4; px += Math.max(18, Math.floor((w + 8) / 4))) parts.push(`<rect x="${px}" y="${y - 10}" width="3" height="${h + 10}" fill="${wood}"/>`);
    for (let py = y + 6; py < y + h; py += 28) {
      parts.push(`<rect x="${x - 6}" y="${py}" width="${w + 12}" height="3" fill="${wood}"/>`);
      parts.push(`<line x1="${x - 4}" y1="${py + 28}" x2="${x + w + 4}" y2="${py}" stroke="${wood}" stroke-width="2" opacity=".7"/>`);
    }
    return `<g class="map-scaffold">${parts.join('')}</g>`;
  }

  function building(room, inv, x, w, h, agentsHere, GROUND) {
    const [name, color] = ROOMS[room.id];
    const y = GROUND - h;
    const wall = shade(color, -0.35);
    const roofH = Math.round(Math.min(34, 14 + w / 8));
    const lit = agentsHere > 0;
    return `<g class="map-room" data-room="${room.id}" tabindex="0" role="button" aria-label="${esc(name)} : ${room.count}">
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${wall}"/>
<rect x="${x}" y="${y}" width="${w}" height="4" fill="${shade(wall, 0.15)}"/>
<polygon points="${x - 6},${y} ${x + w / 2},${y - roofH} ${x + w + 6},${y}" fill="${color}"/>
<polygon points="${x - 6},${y} ${x + w / 2},${y - roofH} ${x + w / 2},${y - roofH + 5} ${x + 2},${y}" fill="${shade(color, 0.25)}"/>
${windows(x, y, w, h - 14, color, lit)}
<rect x="${x + w / 2 - 7}" y="${GROUND - 20}" width="14" height="20" fill="${shade(wall, -0.4)}"/>
${room.recent ? scaffold(x, y, w, h) : ''}
<rect class="map-sign" x="${x - 2}" y="${GROUND + 8}" width="${w + 4}" height="34" rx="3" fill="#1e222b" stroke="${color}"/>
<text x="${x + w / 2}" y="${GROUND + 22}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#e6e9ef">${esc(name)}</text>
<text x="${x + w / 2}" y="${GROUND + 36}" text-anchor="middle" font-size="11" fill="#9aa3b2">${room.count.toLocaleString('fr-FR')}${room.recent ? ` · +${room.recent}` : ''}</text>
</g>`;
  }

  function house(inv, x, w, h, campaign, smoking, GROUND) {
    const y = GROUND - h, roofH = 70;
    const wall = '#d6c7a1', roof = '#9a3412';
    const flag = campaign ? `<g><rect x="${x + w / 2 - 1}" y="${y - roofH - 46}" width="3" height="48" fill="#e5e7eb"/>
<rect x="${x + w / 2 + 2}" y="${y - roofH - 46}" width="58" height="22" fill="${campaign.wonAt ? '#4fd18b' : '#78a6ff'}"/>
<text x="${x + w / 2 + 31}" y="${y - roofH - 31}" text-anchor="middle" font-size="11" font-weight="700" fill="#0f1115">${campaign.wonAt ? 'validée' : esc(`${campaign.progress.proven}/${campaign.progress.total}`)}</text></g>` : '';
    const smoke = smoking ? `<g class="map-smoke"><rect x="${x + w - 52}" y="${y - roofH - 6}" width="8" height="8" fill="#9ca3af" opacity=".7"/><rect x="${x + w - 46}" y="${y - roofH - 18}" width="10" height="10" fill="#9ca3af" opacity=".5"/><rect x="${x + w - 40}" y="${y - roofH - 34}" width="12" height="12" fill="#9ca3af" opacity=".3"/></g>` : '';
    return `<g class="map-house" data-room="maison" tabindex="0" role="button" aria-label="${esc(inv.project)}">
<rect x="${x + w - 56}" y="${y - roofH + 10}" width="18" height="40" fill="#57534e"/>${smoke}
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${wall}"/>
${Array.from({ length: Math.floor(h / 12) }, (_, i) => `<rect x="${x}" y="${y + i * 12}" width="${w}" height="1" fill="${shade(wall, -0.12)}"/>`).join('')}
<polygon points="${x - 14},${y} ${x + w / 2},${y - roofH} ${x + w + 14},${y}" fill="${roof}"/>
<polygon points="${x - 14},${y} ${x + w / 2},${y - roofH} ${x + w / 2},${y - roofH + 8} ${x - 2},${y}" fill="${shade(roof, 0.2)}"/>
${flag}
<rect x="${x + 18}" y="${y + 24}" width="28" height="26" fill="#fde68a" class="map-lit"/><rect x="${x + w - 46}" y="${y + 24}" width="28" height="26" fill="#fde68a" class="map-lit"/>
<rect x="${x + 31}" y="${y + 24}" width="2" height="26" fill="${wall}"/><rect x="${x + w - 33}" y="${y + 24}" width="2" height="26" fill="${wall}"/>
<rect x="${x + w / 2 - 16}" y="${GROUND - 40}" width="32" height="40" fill="#7c2d12"/><rect x="${x + w / 2 + 8}" y="${GROUND - 22}" width="4" height="4" fill="#facc15"/>
<rect class="map-sign" x="${x + 6}" y="${GROUND + 8}" width="${w - 12}" height="40" rx="3" fill="#2a1f14" stroke="#facc15"/>
<text x="${x + w / 2}" y="${GROUND + 26}" text-anchor="middle" font-size="14" font-weight="800" fill="#facc15">${esc(inv.project)}</text>
<text x="${x + w / 2}" y="${GROUND + 41}" text-anchor="middle" font-size="11" fill="#d6c7a1">UE ${esc(inv.engine || '?')} · ${inv.assets.toLocaleString('fr-FR')} assets</text>
</g>`;
  }

  function forge(x, lit, GROUND) {
    return `<g transform="translate(${x},${GROUND - 64})">${window.Avatar.forge(64, lit)}</g>
<text x="${x + 32}" y="${GROUND + 22}" text-anchor="middle" font-size="11.5" fill="#9aa3b2">Forge</text>`;
  }

  function avatarAt(look, state, x, name, GROUND) {
    const svg = window.Avatar.render(look, { state, size: 54 });
    return `<g class="map-agent" transform="translate(${x},${GROUND - 54})">${svg}</g>
<text x="${x + 17}" y="${GROUND - 60}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#e6e9ef" class="map-name">${esc(name)}</text>`;
  }

  // inv : inventaire ; people : [{ look, state, name, room, building }] ; options : { campaign, lockHeld }
  // Deux rues : en haut la maison et les 6 plus grosses extensions, en bas les autres et la forge.
  function render(inv, people, opts = {}) {
    const rooms = Object.values(inv.rooms).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
    const houseW = 230, houseH = Math.round(Math.min(220, 120 + 20 * Math.log10(inv.assets + 1)));
    const gap = 16, margin = 40, forgeW = 80;
    const sizes = new Map(rooms.map(r => [r.id, dims(r.count)]));
    const top = rooms.slice(0, 6), bottom = rooms.slice(6);
    const left = [], right = [];
    top.forEach((r, i) => (i % 2 ? left : right).push(r));
    const span = (list) => list.reduce((s, r) => s + sizes.get(r.id).w + gap, 0);
    const width1 = margin * 2 + span(left) + houseW + span(right);
    const width2 = margin * 2 + span(bottom) + forgeW;
    const width = Math.max(width1, width2, 900);
    const G1 = 330, G2 = bottom.length ? 610 : 330, H = (bottom.length ? G2 : G1) + 70;

    const pos = {};
    const hx = Math.round((width - houseW) / 2 + (span(left) - span(right)) / 2);
    let x = hx - gap;
    for (const r of left) { const d = sizes.get(r.id); x -= d.w; pos[r.id] = { x, g: G1, ...d }; x -= gap; }
    x = hx + houseW + gap;
    for (const r of right) { const d = sizes.get(r.id); pos[r.id] = { x, g: G1, ...d }; x += d.w + gap; }
    x = Math.round((width - (span(bottom) + forgeW)) / 2);
    for (const r of bottom) { const d = sizes.get(r.id); pos[r.id] = { x, g: G2, ...d }; x += d.w + gap; }
    const forgeX = bottom.length ? x + 4 : hx + houseW + span(right) + gap, forgeG = bottom.length ? G2 : G1;

    const here = {};
    for (const p of people) if (p.room && pos[p.room]) here[p.room] = (here[p.room] || 0) + 1;
    const parts = [];
    parts.push(`<rect x="0" y="0" width="${width}" height="${H}" fill="url(#map-sky)"/>`);
    for (let i = 0; i < width / 30; i++) parts.push(`<rect x="${(i * 97) % width}" y="${(i * 53) % 140 + 8}" width="2" height="2" fill="#cbd5e1" opacity="${0.3 + (i % 3) * 0.2}"/>`);
    const ground = (g) => {
      parts.push(`<rect x="0" y="${g}" width="${width}" height="8" fill="#3f6212"/><rect x="0" y="${g + 8}" width="${width}" height="56" fill="#3b2f25"/>`);
      for (let i = 0; i < width; i += 16) parts.push(`<rect x="${i}" y="${g}" width="8" height="4" fill="#4d7c0f"/>`);
    };
    ground(G1);
    if (bottom.length) ground(G2);
    parts.push(house(inv, hx, houseW, houseH, opts.campaign, people.some(p => p.state === 'working'), G1));
    for (const r of rooms) { const p = pos[r.id]; parts.push(building(r, inv, p.x, p.w, p.h, here[r.id] || 0, p.g)); }
    parts.push(forge(forgeX, opts.lockHeld, forgeG));

    // personnages : devant leur piece, sinon devant la maison ; celui qui compile a la forge
    const slots = {};
    for (const p of people) {
      let base, g, key;
      if (p.building) { base = forgeX + 70; g = forgeG; key = 'forge'; }
      else if (p.room && pos[p.room]) { base = pos[p.room].x + pos[p.room].w / 2 - 17; g = pos[p.room].g; key = p.room; }
      else { base = hx + houseW / 2 - 70; g = G1; key = 'maison'; }
      const n = slots[key] = (slots[key] || 0) + 1;
      const off = n === 1 ? 0 : Math.ceil((n - 1) / 2) * 30 * (n % 2 ? 1 : -1);
      parts.push(avatarAt(p.look, p.state, Math.round(base + off), p.name, g));
    }
    return `<svg class="map" viewBox="0 0 ${width} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Carte du projet ${esc(inv.project)}">
<defs><linearGradient id="map-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#1e293b"/></linearGradient></defs>
${parts.join('\n')}</svg>`;
  }

  window.ProjectMap = { render, ROOMS };
})();
