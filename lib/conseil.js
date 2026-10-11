'use strict';
// Le conseil : quand ali doit vraiment choisir (deux options lourdes, une direction a prendre), il pose
// la question au conseil plutot qu'au chef. Cinq membres, chacun avec sa facon de penser, repondent
// chacun de leur cote ; ils relisent ensuite les cinq reponses sans savoir qui a dit quoi ; enfin le
// president tranche : ou ils sont d'accord, ou ils s'opposent, la recommandation, la premiere chose a faire.
//
// C'est la methode du « LLM Council » de Karpathy, telle que le skill llm-council d'aiwithremy
// (github.com/aiwithremy/claude-skills-llm-council) la fait tourner dans Claude Code. Ici, la tour la
// fait tourner elle-meme, econome en tokens :
//   - le cadrage est le seul appel qui lit le projet (lecture seule, 3 fichiers au plus, depense limitee) ;
//   - les membres, la revue et le president sont des appels sans outils, sans skills, sans hooks, ni
//     CLAUDE.md du projet (lances depuis un dossier vide) : ils ne paient que la question et les reponses ;
//   - aucune session n'est gardee sur le disque, et aucune salle n'apparait dans la rue.
// Le verdict est ecrit dans Saved/Tour/conseil/ du projet : le chef le lit quand ali lui confie la suite.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIR = 'Saved/Tour/conseil';
const MAX_RUNS = 20;
const MAX_QUESTION = 4000;
const CALL_MS = 5 * 60_000; // un appel qui depasse est arrete
const CADRAGE_BUDGET = '0.5'; // dollars, --max-budget-usd du cadrage

// Les cinq membres : des facons de penser qui se contredisent (Contradicteur contre Visionnaire, le
// Fondamental contre l'Executant ; le Candide au milieu). Leur allure dans la salle du conseil.
const MEMBERS = [
  { id: 'contradicteur', name: 'Le Contradicteur', short: 'cherche ce qui va casser',
    style: 'Tu cherches ce qui ne va pas : ce qui manque, ce qui va échouer, la faille que personne ne veut voir. Tu pars du principe que l\'idée a un défaut grave et tu le trouves. Pas par pessimisme : tu es l\'ami qui évite le mauvais choix en posant la question qu\'on esquive.',
    look: { hat: 'capuche', hatColor: '#7f1d1d', shirt: '#991b1b', shirtStyle: 'veste', tool: 'epee', hairStyle: 'court' } },
  { id: 'fondamental', name: 'Le Fondamental', short: 'repart du vrai problème',
    style: 'Tu ignores la question telle qu\'elle est posée et tu demandes : qu\'essaie-t-on vraiment de résoudre ? Tu enlèves les suppositions et tu reconstruis le problème depuis la base. Parfois, ta meilleure réponse est : « ce n\'est pas la bonne question ».',
    look: { hat: 'chapeau', hatColor: '#1e3a8a', shirt: '#1d4ed8', shirtStyle: 'uni', tool: 'pinceau', accessory: 'lunettes', hairStyle: 'long' } },
  { id: 'visionnaire', name: 'Le Visionnaire', short: 'voit ce qui peut être plus grand',
    style: 'Tu cherches ce que les autres ne voient pas en mieux : ce qui pourrait être plus grand, l\'occasion voisine, ce qui est sous-estimé. Le risque, c\'est le travail du Contradicteur ; toi, tu regardes ce qui se passe si ça marche encore mieux que prévu.',
    look: { hat: 'couronne', hatColor: '#ca8a04', shirt: '#7c3aed', shirtStyle: 'rayures', tool: 'cle', hairStyle: 'queue' } },
  { id: 'candide', name: 'Le Candide', short: 'ne connaît ni ali ni le projet',
    style: 'Tu ne sais rien d\'ali, du projet ni de son domaine. Tu réponds seulement à ce qu\'on te montre. Les experts ont des angles morts : toi, tu vois ce qui est évident pour eux et obscur pour tout le monde, et tu le dis.',
    look: { hat: 'casquette', hatColor: '#0f766e', shirt: '#14b8a6', shirtStyle: 'salopette', tool: 'clavier', hairStyle: 'court' } },
  { id: 'executant', name: 'L\'Exécutant', short: 'lundi matin, on fait quoi ?',
    style: 'Une seule chose t\'intéresse : est-ce faisable, et quel est le chemin le plus court ? Tu laisses la théorie et la stratégie aux autres. Pour chaque idée, tu demandes : « d\'accord, et lundi matin, on fait quoi ? ». Une idée brillante sans première étape claire, tu le dis.',
    look: { hat: 'casque', hatColor: '#d97706', shirt: '#92400e', shirtStyle: 'salopette', tool: 'marteau', hairStyle: 'chauve' } },
];
const PRESIDENT = { id: 'president', name: 'Le Président', look: { hat: 'couronne', hatColor: '#facc15', shirt: '#334155', shirtStyle: 'veste', tool: 'clavier', accessory: 'barbe', hairStyle: 'court' } };
const MODELS = [['sonnet', 'Sonnet (conseillé)'], ['haiku', 'Haiku (le moins cher)'], ['opus', 'Opus (le plus fort)'], ['', 'Celui de Claude Code']];
const STEPS = { cadrage: 'cadre la question', avis: 'les membres réfléchissent', revue: 'relecture croisée', president: 'le président tranche', fini: 'verdict rendu', erreur: 'erreur', arrete: 'arrêté' };

// Court et en ASCII : il traverse cmd.exe sans souci de guillemets ni d'encodage.
const SYSTEM = 'Tu es un membre du Conseil de la tour d ali. Reponds en francais, directement, sans utiliser d outil.';

const one = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'question';
}
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---- les consignes -------------------------------------------------------------------------------
function cadragePrompt(question, project) {
  return `Tu prépares une question pour le Conseil de la tour d'ali, sur le projet ${project}. Cinq membres vont y répondre sans voir le projet, puis un président tranchera. Ton seul travail : cadrer la question pour qu'ils aient le contexte qui compte.

La demande d'ali :
---
${question}
---

1. Lis au plus 3 fichiers utiles (le CLAUDE.md du projet est déjà chargé) : par exemple une décision dans docs/decisions, docs/FEUILLE_DE_ROUTE.md, le carnet du sujet dans Saved/Tour/sujets/, un verdict du conseil dans ${DIR}/. Pas de gros fichiers, pas de journaux entiers.
2. Écris la question cadrée, 300 mots au plus : la décision à prendre, les options, le contexte du projet qui compte (contraintes, chiffres, décisions déjà prises, avec les fichiers), et ce qui est en jeu. Sans ton avis, sans orienter.

Réponds seulement avec la question cadrée, en français.`;
}
function framedOf(question, project) {
  return project ? `${question}\n\n(Projet : ${project}.)` : question;
}
function memberPrompt(m, framed) {
  return `Tu es ${m.name}, membre du Conseil de la tour d'ali.

Ta façon de penser : ${m.style}

La question posée au conseil :
---
${framed}
---

Réponds de ton point de vue. Sois direct et précis, ne cherche pas l'équilibre : les autres membres couvrent les autres angles. Si tu vois un défaut grave, dis-le ; une grande occasion, dis-la. Ne te nomme pas. 150 à 250 mots, en français, sans préambule.`;
}
// Les lettres A a E, melangees : la revue ne sait pas qui a dit quoi, ni dans quel ordre ils ont parle.
function lettersOf(ids, rnd = Math.random) {
  const order = ids.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return Object.fromEntries(order.map((id, i) => ['ABCDE'[i], id]));
}
// Un avis qui se nomme (« en tant que Contradicteur ») trahirait son auteur : on efface les noms.
function anonymous(text) {
  let t = String(text || '');
  for (const m of MEMBERS) {
    const bare = m.name.replace(/^(Le |L')/, '');
    t = t.replace(new RegExp(`(le |l'|l’)?${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), 'ce membre');
  }
  return t;
}
function reviewPrompt(framed, letters, avis) {
  const list = Object.entries(letters).map(([l, id]) => `**Réponse ${l} :**\n${anonymous(avis[id])}`).join('\n\n');
  return `Tu relis le travail du Conseil de la tour d'ali. Cinq membres ont répondu chacun de leur côté à cette question :
---
${framed}
---

Leurs réponses, sans leurs noms :

${list}

Réponds à ces trois questions, en citant les réponses par leur lettre :
1. Quelle réponse est la plus solide, et pourquoi ?
2. Quelle réponse a le plus gros angle mort, et lequel ?
3. Qu'est-ce que les cinq ont tous manqué ?

150 mots au plus, en français, direct.`;
}
function presidentPrompt(framed, avis, revues) {
  const said = MEMBERS.filter(m => avis[m.id]).map(m => `**${m.name} :**\n${avis[m.id]}`).join('\n\n');
  const rev = revues.length ? revues.map((r, i) => `Revue ${i + 1} :\n${r}`).join('\n\n') : '(pas de relecture croisée cette fois)';
  return `Tu es le Président du Conseil de la tour d'ali. Ton travail : tirer des cinq avis et de leur relecture croisée un verdict qui l'aide à choisir.

La question posée au conseil :
---
${framed}
---

LES AVIS :

${said}

LA RELECTURE CROISÉE (anonyme) :

${rev}

Écris le verdict en français, avec exactement cette forme :

**Décision :** la recommandation en une phrase.

## Où le conseil est d'accord
Les points sur lesquels plusieurs membres se rejoignent sans s'être concertés : les signaux les plus sûrs.

## Où il s'oppose
Les vrais désaccords. Présente les deux côtés, et pourquoi des gens raisonnables divergent. Ne lisse rien.

## Ce que la relecture a révélé
Ce qu'un membre avait manqué et qu'un autre a vu.

## La recommandation
Une vraie réponse, avec ses raisons. Pas « ça dépend ». Tu peux donner raison à un seul contre quatre si son raisonnement est le meilleur.

## La première chose à faire
Une seule étape concrète. Pas une liste.

Sois direct, utilise des listes courtes : ali lit vite.`;
}

// La phrase de decision, tiree du verdict.
function decisionOf(verdict) {
  const m = /\*\*D[ée]cision\s*:?\*\*\s*:?\s*(.+)/i.exec(String(verdict || ''));
  return one(m ? m[1] : String(verdict || '').split('\n').find(l => l.trim() && !l.startsWith('#')) || '', 300);
}

// Les options de Claude Code d'un appel. cadrage : lecture seule dans le projet ; sinon aucun outil.
// --setting-sources project : ni les reglages ni les hooks du compte (la tour ne voit pas ces appels
// comme des sessions) ; --disable-slash-commands : aucun skill charge ; --strict-mcp-config : aucun MCP.
function argsOf(kind, model) {
  const base = ['-p', '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', 'project', ...(model ? ['--model', model] : [])];
  if (kind === 'cadrage') return [...base, '--tools', 'Read,Grep,Glob', '--max-budget-usd', CADRAGE_BUDGET];
  return [...base, '--tools', '', '--system-prompt', SYSTEM];
}

// La sortie de claude -p --output-format json : { result, is_error, total_cost_usd, usage }.
function parseOut(out) {
  let res = null;
  for (const l of String(out || '').trim().split(/\r?\n/).reverse()) {
    if (!l.trim().startsWith('{')) continue;
    try { res = JSON.parse(l); break; } catch { /* ligne coupee */ }
  }
  if (!res) return { ok: false, error: 'Réponse illisible.' };
  const u = res.usage || {};
  const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const text = String(res.result || '').trim();
  if (res.is_error || !text) return { ok: false, error: one(res.result || res.subtype || 'Réponse vide.', 300), cost: res.total_cost_usd || 0, tokens };
  return { ok: true, text, cost: res.total_cost_usd || 0, tokens };
}

// Le texte du verdict ecrit dans Saved/Tour/conseil/.
function fileText(r) {
  const name = (id) => (MEMBERS.find(m => m.id === id) || {}).name || id;
  const parts = [
    `# Conseil : ${one(r.question, 80)}`,
    '',
    `Le ${stamp(new Date(r.at))}${r.project ? `, projet ${r.project}` : ''}. Écrit par la tour (bâtiment du conseil).`,
    '',
    '## La question d\'ali', '', r.question, '',
  ];
  if (r.cadrage && r.framed) parts.push('## La question cadrée', '', r.framed, '');
  parts.push('## Le verdict', '', r.verdict || '(pas de verdict)', '', '## Les avis', '');
  for (const m of MEMBERS) if (r.members[m.id] && r.members[m.id].avis) parts.push(`### ${m.name}`, '', r.members[m.id].avis, '');
  if (r.revues && r.revues.length) {
    parts.push('## La relecture croisée', '', `Lettres : ${Object.entries(r.letters || {}).map(([l, id]) => `${l} = ${name(id)}`).join(', ')}.`, '');
    r.revues.forEach((t, i) => parts.push(`### Revue ${i + 1}`, '', t, ''));
  }
  parts.push(`Coût : ${r.cost ? `${r.cost.toFixed(2)} $` : 'inconnu'}, ${r.tokens || 0} tokens.`, '');
  return parts.join('\n');
}

// projectFor(nom) -> { name, root } ; launchEnv() : l'environnement des sessions lancees par la tour ;
// toChef(projet, texte) : confie la suite au chef ; dataDir : sans projet, les verdicts y sont ecrits.
function create(state, { projectFor, launchEnv, toChef, run, dataDir, rnd } = {}) {
  const C = () => {
    if (!state.conseil || typeof state.conseil !== 'object') state.conseil = {};
    const c = state.conseil;
    if (!Array.isArray(c.runs)) c.runs = [];
    if (!MODELS.some(([id]) => id === c.model)) c.model = 'sonnet';
    if (typeof c.revue !== 'boolean') c.revue = true;
    if (typeof c.cadrage !== 'boolean') c.cadrage = true;
    return c;
  };
  const children = new Set();
  let current = null; // le conseil qui delibere

  run = run || ((args, cwd, input) => {
    const env = Object.assign({}, launchEnv ? launchEnv() : process.env);
    delete env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE; delete env.TOWER_ASK;
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', 'claude', ...args], { cwd, windowsHide: true, env })
      : spawn('claude', args, { cwd, env });
    child.stdin.end(input, 'utf8');
    return child;
  });

  // Un appel a Claude Code ; ne rejette jamais.
  function call(kind, model, cwd, input) {
    return new Promise((resolve) => {
      if (current && current.stopped) return resolve({ ok: false, error: 'Arrêté.' });
      let child, out = '', err = '', done = false;
      const end = (r) => { if (done) return; done = true; clearTimeout(timer); children.delete(child); resolve(r); };
      try { child = run(argsOf(kind, model), cwd, input); } catch (e) { return resolve({ ok: false, error: `Claude Code ne démarre pas : ${e.message}` }); }
      children.add(child);
      const timer = setTimeout(() => { kill(child); end({ ok: false, error: 'Trop long : arrêté au bout de 5 minutes.' }); }, CALL_MS);
      if (timer.unref) timer.unref();
      if (child.stdout) child.stdout.on('data', d => { out = (out + d).slice(-200_000); });
      if (child.stderr) child.stderr.on('data', d => { err = (err + d).slice(-4000); });
      child.on('error', (e) => end({ ok: false, error: `Claude Code ne démarre pas : ${e.message}` }));
      child.on('close', (code) => {
        const r = parseOut(out);
        if (!r.ok && !out.trim()) r.error = one(err.trim().split(/\r?\n/).pop() || `Claude Code s'est arrêté (code ${code}).`, 300);
        end(r);
      });
    });
  }
  function kill(child) {
    try {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
      else child.kill();
    } catch { /* deja fini */ }
  }

  const neutral = () => {
    const d = path.join(os.tmpdir(), 'alkatrazz-conseil');
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* le dossier temporaire existe toujours */ }
    return d;
  };
  const add = (r, res) => { r.cost = (r.cost || 0) + (res.cost || 0); r.tokens = (r.tokens || 0) + (res.tokens || 0); };
  const step = (r, s) => { r.step = s; state.changed(); };

  async function deliberate(r) {
    const p = r.project && projectFor ? projectFor(r.project) : null;
    const cwd = neutral();
    // 1. le cadrage, le seul appel qui lit le projet
    if (r.cadrage && p) {
      step(r, 'cadrage');
      const res = await call('cadrage', r.model, p.root, cadragePrompt(r.question, p.name));
      add(r, res);
      if (r.stopped) return;
      // un cadrage rate n'arrete pas le conseil : les membres recoivent la question telle quelle
      r.framed = res.ok ? res.text : framedOf(r.question, r.project);
      if (!res.ok) r.note = `Cadrage impossible (${res.error}) : la question part telle quelle.`;
    } else r.framed = framedOf(r.question, r.project);
    // 2. les cinq avis, en meme temps
    step(r, 'avis');
    await Promise.all(MEMBERS.map(async (m) => {
      const s = r.members[m.id];
      s.status = 'reflechit'; state.changed();
      const res = await call('membre', r.model, cwd, memberPrompt(m, r.framed));
      add(r, res);
      Object.assign(s, res.ok ? { status: 'fini', avis: res.text } : { status: 'erreur', error: res.error });
      state.changed();
    }));
    if (r.stopped) return;
    const avis = Object.fromEntries(MEMBERS.filter(m => r.members[m.id].avis).map(m => [m.id, r.members[m.id].avis]));
    if (Object.keys(avis).length < 3) throw new Error(`Trop peu d'avis (${Object.keys(avis).length} sur 5) : ${MEMBERS.map(m => r.members[m.id].error).filter(Boolean)[0] || 'erreur inconnue'}`);
    // 3. la relecture croisee : chaque membre relit les avis, sans les noms
    r.revues = [];
    if (r.revue) {
      step(r, 'revue');
      r.letters = lettersOf(Object.keys(avis), rnd);
      const prompt = reviewPrompt(r.framed, r.letters, avis);
      await Promise.all(MEMBERS.filter(m => avis[m.id]).map(async (m) => {
        const s = r.members[m.id];
        s.status = 'relit'; state.changed();
        const res = await call('revue', r.model, cwd, prompt);
        add(r, res);
        if (res.ok) { s.revue = res.text; r.revues.push(res.text); }
        s.status = 'fini';
        state.changed();
      }));
      if (r.stopped) return;
    }
    // 4. le president tranche
    step(r, 'president');
    const res = await call('president', r.model, cwd, presidentPrompt(r.framed, avis, r.revues));
    add(r, res);
    if (r.stopped) return;
    if (!res.ok) throw new Error(`Le président n'a pas pu trancher : ${res.error}`);
    r.verdict = res.text;
    r.decision = decisionOf(res.text);
    write(r, p);
    r.endedAt = state.now();
    step(r, 'fini');
  }

  // Le verdict dans Saved/Tour/conseil/ du projet (sinon dans les donnees de la tour).
  function write(r, p) {
    const name = `${stamp(new Date(r.at)).replace(/[: ]/g, '-')}-${slug(r.question)}.md`;
    const dir = p ? path.join(p.root, ...DIR.split('/')) : dataDir ? path.join(dataDir, 'conseil') : null;
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), fileText(r), 'utf8');
      r.file = p ? `${DIR}/${name}` : path.join(dir, name);
    } catch (e) { r.note = `Verdict non écrit : ${e.message}`; }
  }

  // ali pose sa question.
  function ask({ question, project, model, revue, cadrage } = {}) {
    const q = String(question || '').replace(/\r/g, '').trim().slice(0, MAX_QUESTION);
    if (q.length < 10) return { ok: false, error: 'Pose ta question en une ou deux phrases : le choix, et ce qui compte pour toi.' };
    if (current) return { ok: false, error: 'Le conseil délibère déjà : attends son verdict, ou arrête-le.' };
    const c = C();
    if (model !== undefined && MODELS.some(([id]) => id === model)) c.model = model;
    if (typeof revue === 'boolean') c.revue = revue;
    if (typeof cadrage === 'boolean') c.cadrage = cadrage;
    const p = projectFor ? projectFor(project) : null;
    const r = {
      id: `c${state.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: state.now(), project: p ? p.name : '', question: q,
      model: c.model, revue: c.revue, cadrage: c.cadrage && !!p, step: 'cadrage', framed: '', verdict: '', decision: '', error: '', note: '',
      members: Object.fromEntries(MEMBERS.map(m => [m.id, { status: 'attend', avis: '', revue: '', error: '' }])), revues: [], letters: null, cost: 0, tokens: 0, file: '', endedAt: 0,
    };
    c.runs.unshift(r);
    c.runs.length = Math.min(c.runs.length, MAX_RUNS);
    current = r;
    state.changed();
    const finished = deliberate(r).catch((e) => { r.error = e.message; r.endedAt = state.now(); step(r, 'erreur'); })
      .finally(() => {
        if (r.stopped && r.step !== 'fini') { r.endedAt = r.endedAt || state.now(); r.step = 'arrete'; }
        delete r.stopped;
        if (r.step !== 'fini') for (const m of Object.values(r.members)) if (m.status === 'reflechit' || m.status === 'relit') m.status = 'attend';
        if (current === r) current = null;
        state.changed();
      });
    return { ok: true, id: r.id, done: finished };
  }

  function stop() {
    if (!current) return { ok: false, error: 'Le conseil ne délibère pas.' };
    current.stopped = true;
    for (const ch of children) kill(ch);
    state.changed();
    return { ok: true };
  }

  // Les reglages du batiment : modele, relecture croisee, cadrage.
  function settings({ model, revue, cadrage } = {}) {
    const c = C();
    if (model !== undefined && MODELS.some(([id]) => id === model)) c.model = model;
    if (typeof revue === 'boolean') c.revue = revue;
    if (typeof cadrage === 'boolean') c.cadrage = cadrage;
    state.changed();
    return { ok: true, model: c.model, revue: c.revue, cadrage: c.cadrage };
  }

  // ali confie la decision au chef : il la met en oeuvre (verifie, puis confie aux sessions).
  function chef(id) {
    const r = C().runs.find(x => x.id === id);
    if (!r) return { ok: false, error: 'Verdict introuvable.' };
    if (r.step !== 'fini') return { ok: false, error: 'Le conseil n\'a pas encore rendu son verdict.' };
    const p = projectFor ? projectFor(r.project) : null;
    if (!p || !toChef) return { ok: false, error: 'Aucun projet connecté : le chef travaille dans le dossier du projet.' };
    const text = `Décision prise au Conseil de la tour, qu'ali te confie :
${r.decision || one(r.verdict, 400)}

${r.file ? `Le verdict complet (question, avis, recommandation, première chose à faire) : ${r.file}. Lis-le d'abord.` : `Le verdict :\n${r.verdict}`}

Mets-la en œuvre comme une demande d'ali : vérifie en lisant ce qui doit l'être, puis confie les changements aux sessions core ou à une nouvelle feature. Si un point du verdict ne colle pas au projet, dis-le à ali avant d'envoyer.`;
    const res = toChef(p, text);
    if (res && res.ok) { r.chef = { at: state.now(), sessionId: res.sessionId || '' }; state.changed(); }
    return res || { ok: false, error: 'Le chef ne répond pas.' };
  }

  // Ce que la page affiche.
  function view() {
    const c = C();
    return { model: c.model, revue: c.revue, cadrage: c.cadrage, busy: !!current, runs: c.runs.map(r => ({ ...r, stopped: undefined })), members: MEMBERS.map(({ id, name, short, look }) => ({ id, name, short, look })), president: PRESIDENT, models: MODELS, steps: STEPS };
  }

  return { ask, stop, settings, chef, view, busy: () => !!current };
}

// Au redemarrage de la tour : un conseil qui deliberait est parti avec l'ancienne tour.
function restore(saved) {
  const c = saved && typeof saved === 'object' ? saved : {};
  const runs = Array.isArray(c.runs) ? c.runs.slice(0, MAX_RUNS) : [];
  for (const r of runs) if (r && !['fini', 'erreur', 'arrete'].includes(r.step)) { r.step = 'arrete'; r.note = 'La tour a redémarré pendant la délibération.'; }
  return { model: c.model, revue: c.revue, cadrage: c.cadrage, runs };
}

module.exports = { DIR, MEMBERS, PRESIDENT, MODELS, STEPS, argsOf, parseOut, lettersOf, anonymous, decisionOf, cadragePrompt, memberPrompt, reviewPrompt, presidentPrompt, fileText, create, restore };
