'use strict';
// « Coup d'œil » : pour un second ecran. Rien que la tour en grand et une phrase en bas qui dit l'essentiel ;
// quand quelque chose change (un agent t'attend, un build finit, une feature casse), une notification
// apparait quelques secondes en haut a droite. Un clic sur une notification ou sur le jeu ouvre la fiche.
// Le jeu (web/usine/moteur.js) dessine la tour ; ce fichier ne decrit que le fonctionnement.
(function () {
  const U = window.Usine;
  const LIFE = 9000;
  let known = null, lastBuild = null, toasts = [], timer = null;

  // L'essentiel en une phrase, du plus urgent au plus calme.
  function headline(M, T) {
    const w = M.agents.find(a => a.st === 'waiting');
    if (w) return { tone: 'warn', text: `${w.name} t'attend`, sub: w.ask || 'Une question dans sa session Claude Code.', sel: { kind: 'agent', id: w.id } };
    const bad = M.attention.find(x => x.tone === 'ko');
    if (bad) return { tone: 'ko', text: bad.title, sub: bad.text, sel: { kind: 'silo' } };
    if (M.lock) return { tone: 'fire', text: `${M.lock.agent ? M.lock.agent.name : M.lock.label} compile`, sub: `${M.lock.kindText} depuis ${T.dur(Date.now() - M.lock.since)}${M.queue.length ? `, ${M.queue.length} en attente` : ''}`, sel: { kind: 'forge' } };
    if (M.counts.working) return { tone: 'ok', text: 'Tout tourne', sub: `${T.plural(M.counts.working, 'agent au travail', 'agents au travail')}, rien ne t'attend.` };
    return { tone: 'grey', text: 'Calme plat', sub: 'Aucun agent ne travaille en ce moment.' };
  }

  // Notifications : ce qui est apparu depuis le dernier etat (pas au premier affichage).
  function diff(M, api) {
    const now = Date.now(), cur = new Map(M.attention.map(x => [`${x.kind}:${x.agent ? x.agent.id : x.feature ? x.feature.id : ''}:${x.title}`, x]));
    // en demo, rien ne change jamais : on joue les trois premiers sujets comme s'ils venaient d'arriver
    if (!known && M.demo) known = new Set([...cur.keys()].slice(3));
    if (known) for (const [k, x] of cur) if (!known.has(k)) toasts.push({ tone: x.tone, title: x.title, text: x.text, sel: x.agent ? { kind: 'agent', id: x.agent.id } : x.feature ? { kind: 'silo' } : null, until: now + LIFE });
    known = new Set(cur.keys());
    const b = M.builds[0];
    if (b && lastBuild !== null && b.id !== lastBuild) toasts.push({ tone: b.ok ? 'ok' : 'ko', title: `${b.kindText} ${b.ok ? 'réussi' : 'en échec'}`, text: `${b.agent ? b.agent.name : b.label}, ${b.summary}`, sel: { kind: b.ok ? 'ok' : 'ko' }, until: now + LIFE });
    lastBuild = b ? b.id : '';
    toasts = toasts.filter(t => t.until > now).slice(-4);
    clearTimeout(timer);
    if (toasts.length) timer = setTimeout(() => api.rerender(), Math.max(200, Math.min(...toasts.map(t => t.until)) - now));
  }

  U.mode({
    id: 'coupdoeil', name: 'Coup d\'œil', counters: false,
    pads: (sel) => ({ l: 20, r: sel ? 410 : 20, t: 56, b: 120 }),
    hud(M, api) {
      const { h, T, dotFor } = api;
      diff(M, api);
      const hl = headline(M, T);
      const W = api.world;
      return [
        h('button', { type: 'button', class: `us-panel us-glance us-g-${hl.tone}`, onclick: () => hl.sel && api.select(hl.sel, true), disabled: !hl.sel },
          h('i', { 'aria-hidden': 'true' }), h('span', null, h('b', null, hl.text), h('small', null, hl.sub)),
          h('span', { class: 'us-dots', 'aria-label': 'Agents' }, (W ? W.machines : []).map(m => h('em', { class: `us-d-${dotFor(m.a.st)}`, title: `${m.a.name} : ${m.a.stText}` })))),
        h('div', { class: 'us-toasts', 'aria-live': 'polite' }, toasts.map(t => h('button', { type: 'button', class: `us-panel us-toast us-c-${t.tone}`, onclick: () => { toasts = toasts.filter(x => x !== t); if (t.sel) api.select(t.sel, true); else api.rerender(); } },
          h('span', { class: `us-tri us-tri-${t.tone}`, 'aria-hidden': 'true' }), h('span', null, h('b', null, t.title), t.text ? h('small', null, t.text) : null)))),
      ];
    },
  });
})();
