'use strict';
// « Au clavier » : une barre de commande, comme une recherche. On tape quelques lettres (un nom d'agent,
// « forge », « libérer », « version », « tester »...) et Entrée fait l'action. Sans rien taper, la barre
// propose ce qui t'attend. « / » ou Ctrl+K y revient de n'importe ou.
// Le jeu (web/usine/moteur.js) dessine l'usine ; ce fichier ne decrit que le fonctionnement.
(function () {
  const U = window.Usine;
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let box = null, input = null, list = null, cur = 0, shown = [], apiRef = null;

  // Toutes les commandes possibles a cet instant, chacune avec ses mots-cles.
  function commands(M, api) {
    const { T } = api, out = [];
    const add = (label, hint, words, run, tone = '') => out.push({ label, hint, words: norm(`${label} ${words}`), run, tone });
    for (const x of M.attention) {
      if (x.kind === 'manual') add(`Je l'ai testée : ${x.feature.title}`, 'coche l\'essai en jeu', 'tester teste valider essai', () => T.act.manual(x.feature.id, true), 'you');
      else add(x.title, x.agent ? 'ouvrir sa fiche' : 'voir la version', 'alerte attend', () => api.select(x.agent ? { kind: 'agent', id: x.agent.id } : { kind: 'silo' }, true), x.tone);
    }
    for (const a of M.agents.filter(a => a.st !== 'ended')) {
      add(a.name, `${a.stText}${a.roomName ? ', ' + a.roomName : ''}`, `agent ${a.role || ''} ${a.st}`, () => api.select({ kind: 'agent', id: a.id }, true));
      add(`Personnage de ${a.name}`, 'changer son apparence', 'perso costume apparence', () => T.act.openChar(a.id));
    }
    add('Forge', M.lock ? `${M.lock.kindText} de ${M.lock.agent ? M.lock.agent.name : M.lock.label}` : 'libre', 'build compilation lock', () => api.select({ kind: 'forge' }, true));
    if (M.lock) add('Libérer la forge', 'si le build est bloqué', 'liberer debloquer forcer', T.act.release);
    add('Version', M.campaign ? `${M.campaign.name}, ${M.campaign.proven} sur ${M.campaign.total}` : 'aucune en cours', 'campagne silo fusee release', () => api.select({ kind: 'silo' }, true));
    if (!M.campaign || M.campaign.won) add('Préparer une version', 'choisir les features', 'nouvelle creer campagne', T.act.openBuilder);
    add('Journal des échecs', `${M.builds.filter(b => !b.ok).length} récents`, 'erreurs builds rates ko', () => api.select({ kind: 'ko' }, true));
    add('Journal des réussis', `${M.builds.filter(b => b.ok).length} récents`, 'builds ok succes', () => api.select({ kind: 'ok' }, true));
    for (const p of (M.inv ? T.rooms(M.inv) : [])) add(`Gisement ${p.name}`, `${T.num(p.count)} éléments`, 'dossier domaine', () => api.select({ kind: 'patch', id: p.id }, true));
    const proj = M.projects[0] ? M.projects[0].name : '';
    for (const t of (M.S.tasks || [])) add(`Tâche : ${t.title}`, proj ? `lancer Claude Code sur ${proj}` : 'connecte un projet', 'tache lancer claude', () => api.launchTask(t, proj));
    add('Tâches et tokens', 'ouvrir le panneau', 'taches tokens consommation contexte', () => api.side('taches', true));
    add('Tutos', 'voir la tour marcher', 'tuto aide demo', () => api.side('tuto', true));
    add('Connecter un projet', 'Unreal', 'projet uproject ajouter', T.act.openProjects);
    add('Recompter le projet', 'met à jour les gisements', 'rafraichir inventaire', T.act.refreshMap);
    add(T.ui.showEnded ? 'Masquer les sessions terminées' : 'Montrer les sessions terminées', `${M.endedCount}`, 'fini ended', () => T.act.toggleEnded());
    add('Recadrer l\'usine', 'touche 0', 'vue zoom centre', api.refit);
    return out;
  }

  function filter(M, api) {
    const q = norm(input.value.trim());
    const all = commands(M, api);
    if (!q) return all.filter(c => c.tone).concat(all.filter(c => !c.tone).slice(0, 5)).slice(0, 8);
    const words = q.split(/\s+/);
    return all.filter(c => words.every(w => c.words.includes(w)))
      .sort((a, b) => (norm(b.label).startsWith(q) - norm(a.label).startsWith(q)))
      .slice(0, 8);
  }

  function paint() {
    const { h } = apiRef;
    shown = filter(apiRef.M, apiRef);
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((c, i) => h('li', { class: `us-k${i === cur ? ' cur' : ''}${c.tone ? ' us-c-' + c.tone : ''}`, role: 'option', 'aria-selected': String(i === cur), onmousedown: (e) => { e.preventDefault(); run(i); } },
      h('b', null, c.label), h('span', null, c.hint), i === cur ? h('kbd', null, 'Entrée') : null))
      : [h('li', { class: 'us-k us-dim' }, 'Aucune commande ne correspond.')]));
  }
  function run(i) {
    const c = shown[i]; if (!c) return;
    input.value = ''; cur = 0; input.blur();
    c.run();
    paint();
  }

  function build(api) {
    const { h } = api;
    input = h('input', { class: 'us-kin', type: 'text', placeholder: 'Tape un nom, « forge », « libérer », « version »…', 'aria-label': 'Commande', autocomplete: 'off', spellcheck: 'false',
      oninput: () => { cur = 0; paint(); },
      onkeydown: (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (shown.length) { cur = (cur + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; paint(); } }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(cur); }
        else if (e.key === 'Escape') { e.stopPropagation(); if (input.value) { input.value = ''; paint(); } else { input.blur(); api.select(null); } }
      } });
    list = h('ul', { class: 'us-klist', role: 'listbox' });
    box = h('section', { class: 'us-panel us-kbar', 'aria-label': 'Barre de commande' },
      h('div', { class: 'us-krow' }, h('span', { class: 'us-kicon', 'aria-hidden': 'true' }, '›'), input, h('kbd', null, '/')),
      list,
      h('p', { class: 'us-khelp' }, 'Sans rien taper : ce qui t\'attend d\'abord. ', h('kbd', null, '↑'), h('kbd', null, '↓'), ' pour choisir, ', h('kbd', null, 'Entrée'), ' pour agir, ', h('kbd', null, 'Échap'), ' pour effacer.'));
  }

  U.mode({
    id: 'clavier', name: 'Au clavier', counters: true,
    pads: (sel) => ({ l: 20, r: sel ? 410 : 20, t: 130, b: 20 }),
    hud(M, api) {
      apiRef = api;
      if (!box) { build(api); setTimeout(() => input.focus(), 50); }
      paint();
      return [box];
    },
    onKey(e) {
      if (!input) return false;
      const typing = /input|select|textarea/i.test(e.target.tagName || '');
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { input.focus(); input.select(); return true; }
      return false;
    },
  });
})();
