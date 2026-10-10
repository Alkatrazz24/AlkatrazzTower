'use strict';
// Mise en place des sessions core : avant le travail, chaque session de sujet fait le tour de ce qui
// touche son sujet dans le projet (code, assets, tests, decisions) et remplit son carnet, pour que les
// prochaines taches partent de la. C'est un passage en fond et en lecture seule : la session lit tout,
// n'ecrit que dans Saved/Tour, ne lance ni commande ni agent, et s'arrete a sa limite de depense.
//
// Plusieurs sujets passent un par un, dans une file : jamais deux mises en place en meme temps. La tour
// garde pour chaque sujet sa derniere mise en place (quand, combien de tokens, combien de dollars).

const fs = require('fs');
const path = require('path');
const sujets = require('./sujets');
const regles = require('./regles');

const BUDGETS = [0.5, 1, 2, 5]; // limite de depense par sujet, en dollars (--max-budget-usd)
const DEFAULT_BUDGET = 1;

// Lecture seule : toutes les actions interdites, sauf lire le projet et ecrire dans Saved/Tour.
const READ_ONLY = { modifier: 'non', commandes: 'non', git: 'non', internet: 'non', agents: 'non' };
function argsFor(budget) {
  return [...regles.args(READ_ONLY), '--max-budget-usd', String(budget)];
}

function promptOf(t, projectName) {
  const notes = sujets.notesPath(t.id);
  return `Tache de la tour [${t.id}] : mise en place du sujet « ${t.title} »

Tu es la session core du sujet « ${t.title} » sur ${projectName || 'le projet'}.${t.text ? ` ${t.text}` : ''} Avant les prochaines tâches, fais la mise en place : un tour de ce qui touche ce sujet dans le projet, pour que la prochaine session parte de ton carnet sans tout relire.

Ce passage est en lecture seule et sans fenêtre : tu lis le projet, tu n'écris que dans Saved/Tour, tu ne lances ni commande ni agent, et personne ne peut te répondre. Ne pose pas de question : note-la dans le carnet.

1. Lis le carnet du sujet, ${notes}, s'il existe, et la fin du tableau partagé, ${sujets.BOARD}.
2. Lis le CLAUDE.md du projet et, pour savoir ce que couvre ce sujet, les fichiers de ses agents dans .claude/agents/ (${t.agents.length ? t.agents.join(', ') : 'ceux des sections voisines'}).
3. Fais le tour, sans t'éparpiller : le code (Source/), les assets par leurs noms et dossiers (Content/), les tests, la config et la doc (docs/, décisions) qui touchent ce sujet. Va droit aux fichiers clés, ne lis pas tout le projet.
4. Réécris le carnet, ${notes}, court et concret, avec ces rubriques :
   ## Où on en est
   ## Fichiers clés
   (chemins, et une ligne sur ce que fait chacun)
   ## Décisions
   (ce qui est déjà décidé, avec la source : doc, commit, carnet)
   ## Points d'attention
   (fragile, incohérent, tests rouges, questions pour ali)
   ## Prochaines étapes
   (les tâches possibles, de la plus utile à la moins utile, une ligne chacune)
   Garde ce que l'ancien carnet disait de juste, et ses décisions.
5. Si un autre sujet doit savoir quelque chose, ajoute une ligne à la fin du tableau : - {date} HH:MM · ${t.title} → <sujet> : <message court>.
6. Termine par trois lignes dans ta réponse : ce que tu as vu, le plus important à faire, et le chemin du carnet.`;
}

function create(state, discussion, { projectFor } = {}) {
  if (!state.misePlace || typeof state.misePlace !== 'object') state.misePlace = {};
  const runs = state.misePlace; // id du sujet -> { status, at, endedAt, sessionId, budget, tokens, cost, error }
  let queue = []; // { id, budget }
  let current = null;

  function topic(id) {
    for (const v of Object.values(state.sujets)) {
      const t = v && v.topics && v.topics.find(x => x.id === id);
      if (t) return { t, project: v.project };
    }
    return null;
  }

  function pump() {
    if (current || !queue.length) return;
    const { id, budget } = queue.shift();
    const found = topic(id);
    const p = found && projectFor ? projectFor(found.project) : null;
    if (!found || !p || !p.root) { runs[id] = { ...runs[id], status: 'error', error: 'Sujet ou projet introuvable.', endedAt: state.now() }; state.changed(); return pump(); }
    const rel = `Saved/Tour/taches/mise-en-place-${id.slice(sujets.PREFIX.length)}.md`;
    const text = promptOf(found.t, p.name).replace(/\{date\}/g, sujets.stamp().slice(0, 10));
    try {
      fs.mkdirSync(path.join(p.root, 'Saved', 'Tour', 'taches'), { recursive: true });
      fs.writeFileSync(path.join(p.root, ...rel.split('/')), text, 'utf8');
    } catch (e) { runs[id] = { ...runs[id], status: 'error', error: `Consigne impossible à écrire : ${e.message}`, endedAt: state.now() }; state.changed(); return pump(); }
    current = id;
    const run = runs[id] = { status: 'running', at: state.now(), budget, sessionId: '' };
    const r = discussion.start({
      cwd: p.root, def: id, args: argsFor(budget), label: `Mise en place : ${found.t.title}`,
      text: `Tache de la tour [${id}] : mise en place. Lis la consigne dans ${rel} et suis-la.`,
      onDone: ({ res, error }) => {
        const u = (res && res.usage) || {};
        Object.assign(run, {
          status: error && !/budget/i.test(error) ? 'error' : 'done', endedAt: state.now(), error: error || '',
          cost: res && typeof res.total_cost_usd === 'number' ? res.total_cost_usd : null,
          tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
          capped: !!(error && /budget/i.test(error)) || (res && res.subtype === 'error_max_budget_usd'),
        });
        current = null;
        // Sa session se range : la salle du sujet repasse en sommeil, le carnet rempli. On la retrouve dans
        // les anciennes sessions, et lui ecrire la fait revenir.
        if (run.sessionId && state.hide) state.hide(run.sessionId, true);
        state.changed();
        setImmediate(pump);
      },
    });
    if (!r.ok) { Object.assign(run, { status: 'error', error: r.error, endedAt: state.now() }); current = null; state.changed(); return pump(); }
    run.sessionId = r.sessionId;
    state.changed();
  }

  // Met des sujets dans la file (tous ceux du projet si ids est vide).
  function start({ ids, budget } = {}) {
    const b = BUDGETS.includes(Number(budget)) ? Number(budget) : DEFAULT_BUDGET;
    let list = Array.isArray(ids) && ids.length ? ids.map(String) : Object.values(state.sujets).flatMap(v => (v && v.topics) || []).map(t => t.id);
    list = list.filter(id => topic(id) && id !== current && !queue.some(q => q.id === id));
    if (!list.length) return { ok: false, error: current || queue.length ? 'Ces sujets sont déjà dans la file.' : 'Aucun sujet à préparer : connecte ton projet.' };
    for (const id of list) { queue.push({ id, budget: b }); runs[id] = { ...runs[id], status: 'queued', queuedAt: state.now(), budget: b }; }
    state.changed();
    pump();
    return { ok: true, queued: list.length };
  }

  // Vide la file ; la mise en place en cours s'arrete aussi.
  function stop() {
    for (const q of queue) { if (runs[q.id] && runs[q.id].status === 'queued') runs[q.id].status = runs[q.id].endedAt ? 'done' : 'none'; }
    queue = [];
    if (current && runs[current] && runs[current].sessionId) discussion.stop(runs[current].sessionId);
    state.changed();
    return { ok: true };
  }

  function view() {
    return { budgets: BUDGETS, budget: DEFAULT_BUDGET, current, queue: queue.map(q => q.id), runs };
  }

  return { start, stop, view, busy: () => !!current };
}

module.exports = { create, promptOf, argsFor, READ_ONLY, BUDGETS, DEFAULT_BUDGET };
