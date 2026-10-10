'use strict';
// « À traiter » : la tour comme une boite de reception. A gauche, uniquement ce qui demande ton
// attention, une ligne par sujet avec le bon bouton ; quand la liste est vide, il n'y a rien a faire et
// la tour tourne seule en fond. Fleches haut et bas pour passer d'un sujet a l'autre, Entree pour agir.
// Le jeu (web/usine/moteur.js) dessine la tour ; ce fichier ne decrit que le fonctionnement.
(function () {
  const U = window.Usine;
  let cur = 0, keys = [];
  // « Vu » : ce qui est masque reste masque tant que le sujet ne change pas (texte different = nouveau sujet).
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('tower.seen') || '{}'); } catch { /* stockage bloque */ }
  const hide = (key) => { seen[key] = Date.now(); try { localStorage.setItem('tower.seen', JSON.stringify(seen)); } catch { /* idem */ } };

  // Chaque sujet : un ton, une phrase, une action principale et parfois une seconde.
  function items(M, api) {
    const { T } = api, out = [];
    if (!M.projects.length) out.push({ key: 'projet', tone: 'you', title: 'Connecte ton projet Unreal', text: 'Les tâches se lancent dans son dossier, et chaque session ouverte dessus a sa salle dans son aile.', go: ['Connecter', T.act.openProjects] });
    for (const x of M.attention) {
      const key = `${x.kind}:${x.agent ? x.agent.id : x.feature ? x.feature.id : ''}:${x.text}`;
      if (seen[key]) continue;
      const it = { key, tone: x.tone, title: x.title, text: x.text, sel: x.agent ? { kind: 'agent', id: x.agent.id } : x.feature ? { kind: 'silo' } : null };
      if (x.kind === 'waiting') {
        const p = x.agent && x.agent.pending;
        it.go = [p ? 'Répondre' : 'Voir sa question', () => api.select(it.sel, true)];
        it.hint = p ? 'Tu réponds ici, dans la tour : la session reprend toute seule.' : 'Tu réponds dans sa session Claude Code.';
      }
      else if (x.kind === 'manual') { it.go = ['Je l\'ai testée', () => T.act.manual(x.feature.id, true)]; it.alt = ['Voir la version', () => api.select({ kind: 'silo' }, true)]; }
      else if (x.kind === 'idle') { it.go = ['Voir', () => api.select(it.sel, true)]; it.alt = ['Vu', () => { hide(key); api.rerender(); }]; }
      else if (x.kind === 'dirty') { it.alt = ['Vu', () => { hide(key); api.rerender(); }]; }
      else it.go = ['Voir la version', () => api.select({ kind: 'silo' }, true)];
      out.push(it);
    }
    const L = M.lock;
    if (L && Date.now() - L.since > 15 * 60_000) out.push({ key: 'forge', tone: 'warn', title: `La forge est occupée depuis ${T.dur(Date.now() - L.since)}`, text: `${L.kindText} de ${L.agent ? L.agent.name : L.label}. Si c'est bloqué, libère-la.`, sel: { kind: 'forge' }, go: ['Voir la forge', () => api.select({ kind: 'forge' }, true)], alt: ['Libérer', T.act.release] });
    return out;
  }

  // Une phrase qui resume ce qui tourne sans toi.
  function calm(M, api) {
    const { T } = api, bits = [];
    bits.push(M.counts.working ? `${T.plural(M.counts.working, 'agent travaille', 'agents travaillent')}` : 'Aucun agent ne travaille');
    if (M.lock) bits.push(`la forge compile pour ${M.lock.agent ? M.lock.agent.name : M.lock.label}`);
    if (M.campaign && !M.campaign.won) bits.push(`la version ${M.campaign.name} en est à ${M.campaign.proven} sur ${M.campaign.total}`);
    return bits.join(', ') + '.';
  }

  U.mode({
    id: 'atraiter', name: 'À traiter', counters: false,
    pads: (sel) => ({ l: 430, r: sel ? 410 : 20, t: 64, b: 20 }),
    hud(M, api) {
      const { h, btn } = api, list = items(M, api);
      keys = list.map(i => i.key);
      // la selection faite dans le jeu (clic, touches 1 a 9) se retrouve dans la liste
      const s = api.sel, at = s ? list.findIndex(it => it.sel && it.sel.kind === s.kind && it.sel.id === s.id) : -1;
      if (at >= 0) cur = at;
      cur = Math.min(cur, Math.max(0, list.length - 1));
      const card = (it, i) => h('li', { class: `us-card us-c-${it.tone}${i === cur ? ' cur' : ''}`, onclick: (e) => { if (e.target.closest('button')) return; cur = i; if (it.sel) api.select(it.sel, true); else api.rerender(); } },
        h('span', { class: `us-tri us-tri-${it.tone}`, 'aria-hidden': 'true' }),
        h('div', { class: 'us-ctext' }, h('b', null, it.title), it.text ? h('p', null, it.text) : null, it.hint ? h('small', null, it.hint) : null),
        h('div', { class: 'us-cact' }, it.go ? btn(it.go[0], it.go[1], 'us-go') : null, it.alt ? btn(it.alt[0], it.alt[1]) : null));
      return [h('section', { class: 'us-panel us-inbox', 'aria-label': 'À traiter' },
        h('header', { class: 'us-ihead' }, h('h2', null, 'À traiter'), h('span', { class: 'us-count' + (list.length ? ' on' : '') }, String(list.length))),
        list.length ? h('ol', { class: 'us-cards' }, list.map(card))
          : h('div', { class: 'us-empty' }, h('strong', null, 'Rien ne t\'attend.'), h('p', null, calm(M, api)), h('small', { class: 'us-dim' }, 'La tour tourne en fond : clique sur une salle pour voir ce que fait son agent.')),
        h('footer', { class: 'us-ifoot' }, list.length ? [h('kbd', null, '↑'), h('kbd', null, '↓'), ' pour passer d\'un sujet à l\'autre, ', h('kbd', null, 'Entrée'), ' pour agir.'] : calm(M, api)))];
    },
    onKey(e, api) {
      if (e.ctrlKey || e.metaKey || e.altKey || /input|select|textarea/i.test(e.target.tagName || '')) return false;
      const list = items(api.M, api);
      if (!list.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        cur = (cur + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        const it = list[cur]; if (it.sel) api.select(it.sel, true); else api.rerender();
        return true;
      }
      if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) { const it = list[cur]; (it.go || it.alt)[1](); return true; }
      return false;
    },
  });
})();
