'use strict';
// Taches : des consignes pretes a lancer sur un projet (relecture, anomalies, idees de features) et
// celles qu'on ajoute soi-meme. Lancer une tache ouvre Claude Code dans le dossier du projet, dans une
// nouvelle fenetre : on y valide ses modifications comme d'habitude. La consigne est ecrite dans
// Saved/Tour/taches/ du projet (dossier non versionne), et l'agent la lit : la premiere demande,
// « Tache de la tour [id] », permet a la tour de reconnaitre la session et d'en compter les tokens.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { CONSIGNE: SUIVI } = require('./suivi');

const BUILTIN = [
  {
    id: 'relecture', title: 'Relecture complète et rapport', readonly: true,
    text: 'Relit tout le jeu (code, Blueprints, niveaux, config) et écrit un rapport, sans rien modifier.',
    prompt: `Fais une relecture complète du projet {projet}, sans modifier aucun fichier.

1. Lis le CLAUDE.md du projet et la doc dans docs/ s'il y en a.
2. Parcours le code C++ (Source/), les Blueprints et assets (Content/, par leurs noms et dossiers), les niveaux et la config (Config/).
3. Écris un rapport dans Saved/Tour/rapports/relecture-{date}.md avec :
   - ce qu'est le jeu aujourd'hui et ce qui marche ;
   - l'architecture (modules, classes clés, Blueprints importants) ;
   - les points faibles : code fragile, dettes, incohérences, assets orphelins, perfs probables ;
   - les 10 actions les plus utiles, de la plus rentable à la moins rentable.
4. Termine par un résumé de 10 lignes dans la conversation.`,
  },
  {
    id: 'anomalies', title: 'Anomalies du code et corrections',
    text: 'Cherche les bugs et les plantages possibles, puis corrige les plus sûrs un par un, tests à l\'appui.',
    prompt: `Cherche les anomalies dans le code du projet {projet}, puis corrige-les.

1. Lis le CLAUDE.md du projet et respecte ses règles (build, tests, domaines réservés).
2. Passe le code C++ (Source/) au crible : pointeurs nuls, accès hors limites, fuites, UPROPERTY manquants sur des UObject, réplication, warnings de compilation, code mort, Blueprints qui appellent des fonctions supprimées.
3. Fais la liste par gravité (plantage, bug visible, risque, propreté) dans Saved/Tour/rapports/anomalies-{date}.md.
4. Corrige ensuite les anomalies sûres une par une : une correction, une compilation, les tests concernés. Ne touche pas aux .uasset ni aux .umap.
5. Pour chaque correction, note dans le rapport le fichier, la cause et la preuve (build ou test vert). Ce qui est risqué reste en liste, non corrigé.
6. Termine par un résumé : corrigé, laissé de côté, et pourquoi.`,
  },
  {
    id: 'features', title: 'Idées de features et plan d\'action', readonly: true,
    text: 'Propose des features adaptées au jeu, puis un plan d\'action détaillé pour la meilleure.',
    prompt: `Propose des idées de features pour le projet {projet}, sans modifier le code.

1. Lis le CLAUDE.md, la doc et assez de code et de Content/ pour comprendre le jeu et son état.
2. Propose 5 features qui ont du sens pour ce jeu. Pour chacune : ce que ça apporte au joueur, l'effort (petit, moyen, gros), les risques, ce qui existe déjà et peut servir.
3. Choisis la meilleure (le plus de valeur pour le moins d'effort) et écris son plan d'action dans Saved/Tour/plans/feature-{date}.md : étapes dans l'ordre, fichiers et classes à créer ou modifier, assets nécessaires, tests qui prouveront qu'elle marche, découpage en tâches pour plusieurs agents.
4. Termine par la liste des 5 idées en une ligne chacune, et le chemin du plan.`,
  },
  {
    // Ne touche pas au jeu : lit tout le projet et n'ecrit que dans docs/ (et son suivi dans Saved/Tour).
    id: 'doc-projet', title: 'Doc du projet : tout comprendre', readonly: true, writesDocs: true,
    text: 'Fait de docs/ la doc qui suffit pour comprendre le jeu : une page d\'entrée (docs/COMPRENDRE.md), une page par système, sans toucher au jeu.',
    prompt: `Fais de docs/ la documentation qui suffit, à elle seule, pour comprendre le projet {projet} : pour ali qui la lit dans la tour (bâtiment Documentation) et pour les sessions qui y cherchent leurs réponses. Tu ne modifies que docs/ : ni le code, ni les assets, ni la config, ni CLAUDE.md, ni les agents.

1. Lis d'abord ce qui existe : CLAUDE.md, docs/ en entier (README, architecture, bible, décisions, idées, chantiers…), les skills du projet (.claude/skills) et les derniers rapports de Saved/Tour/rapports. Note ce qui est à jour, ce qui est faux par rapport au code, et ce qui manque.
2. Parcours le projet pour vérifier : Source/ (modules, classes clés, qui appelle quoi), Content/ (dossiers, Blueprints, niveaux, par leurs noms), Config/, Plugins/ (hors Plugins/AlkatrazzTower), tools/ (build, tests). La doc décrit le jeu tel qu'il est dans le code aujourd'hui.
3. Écris ou complète la page d'entrée docs/COMPRENDRE.md, « Comprendre {projet} », qu'on lit en dix minutes (docs/README.md reste l'index « où écrire quoi » : ajoute seulement en tête un lien vers cette page) :
   - le jeu en quelques lignes, et comment se déroule une partie ;
   - la carte des systèmes (un par ligne : à quoi il sert, ses classes et Blueprints principaux, le lien vers sa page) ;
   - l'architecture : modules, réseau (serveur, client, réplication), le flux d'une partie de la carte au raid ;
   - où est quoi dans les dossiers ;
   - construire, lancer et tester (les commandes exactes de tools/) ;
   - un glossaire des mots du projet ;
   - où écrire quoi dans docs/ (décision, système, chantier, idée), en renvoyant à docs/README.md : les sessions s'y fient pour écrire leur doc obligatoire.
4. Une page par système dans docs/systemes/<nom>.md quand le sujet n'en a pas déjà une ailleurs dans docs/ (sinon complète celle-là et pointe vers elle) : ce qu'il fait côté joueur, ses classes, Blueprints et assets, comment il parle aux autres systèmes, ses réglages, comment le tester, ses pièges et ce qui reste à faire. Cite les fichiers par leur chemin.
5. Ne supprime rien et ne réécris pas une décision (docs/decisions) : corrige une page fausse en le disant (« Corrigé le {date} : … »), ajoute ce qui manque. Écris en français simple, des liens relatifs entre les pages.
6. Termine par docs/COMPRENDRE.md à jour, puis un résumé dans la conversation : les pages écrites ou complétées, ce qui était faux, et ce que tu n'as pas pu vérifier.`,
  },
];

const ID = /^[a-z0-9-]{1,40}$/;

// Droits d'une tache lancee en fond : lire le projet, ecrire seulement dans Saved/Tour. Le reste est
// refuse sans question (claude -p ne peut pas en poser), meme si le projet regle un autre mode.
const BACKGROUND_ARGS = [
  '--permission-mode', 'default',
  '--allowedTools', 'Read', 'Grep', 'Glob', 'LS', 'Write(./Saved/Tour/**)', 'Edit(./Saved/Tour/**)',
  '--disallowedTools', 'Bash', 'PowerShell', 'NotebookEdit',
];

// Une tache de doc (writesDocs) ecrit aussi dans docs/, et nulle part ailleurs : meme liste d'outils.
function backgroundArgs(task) {
  if (!task || !task.writesDocs) return BACKGROUND_ARGS;
  const i = BACKGROUND_ARGS.indexOf('--disallowedTools');
  return [...BACKGROUND_ARGS.slice(0, i), 'Write(./docs/**)', 'Edit(./docs/**)', ...BACKGROUND_ARGS.slice(i)];
}

// Environnement des sessions lancees par la tour. Si la tour a ete demarree depuis une session Claude
// Code (une mise a jour faite par un agent), elle herite de toutes ses variables CLAUDE* : marque de
// session enfant (Claude Code n'ecrit alors pas le journal, donc pas de tokens), identifiants et jeton
// de la session distante. On les retire toutes, sauf les reglages que l'utilisateur pose lui-meme.
const KEEP_ENV = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_GIT_BASH_PATH']);
function launchEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^CLAUDE/i.test(k) || KEEP_ENV.has(k.toUpperCase())) out[k] = v;
  out.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1';
  out.TOWER_ASK = '1'; // ses questions et permissions se repondent dans la tour (hooks/tower-ask.js)
  return out;
}

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'tache';
}
function clean(s, max) { return String(s || '').replace(/\r/g, '').trim().slice(0, max); }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// La consigne complete d'une tache pour un projet. La premiere ligne sert de marque a la tour.
function promptFor(task, projectName) {
  const body = task.prompt.replace(/\{projet\}/g, projectName || 'en cours').replace(/\{date\}/g, today());
  return `Tache de la tour [${task.id}] : ${task.title}\n\n${body}\n\n${SUIVI}\n`;
}

// Retrouve la tache dans la premiere demande d'une session (lancee par la tour ou collee a la main).
function taskIdIn(prompt) {
  const m = /Tache de la tour \[([a-z0-9-]{1,40})\]/.exec(String(prompt || ''));
  return m ? m[1] : null;
}

function create(state) {
  if (!Array.isArray(state.tasks)) state.tasks = [];

  function list() {
    return [...BUILTIN.map(t => ({ ...t, builtin: true })), ...state.tasks.map(t => ({ ...t, builtin: false }))];
  }
  function find(id) { return list().find(t => t.id === id) || (state.sujetTask ? state.sujetTask(id) : null); }

  function save({ id, title, prompt, text, readonly }) {
    title = clean(title, 80); prompt = clean(prompt, 8000); text = clean(text, 200);
    if (!title || !prompt) return { ok: false, error: 'Il faut un titre et une consigne.' };
    if (id && BUILTIN.some(t => t.id === id)) return { ok: false, error: 'Les tâches de base ne se modifient pas : crée une copie.' };
    let t = id && state.tasks.find(x => x.id === id);
    if (!t) {
      let nid = `perso-${slug(title)}`;
      for (let i = 2; list().some(x => x.id === nid); i++) nid = `perso-${slug(title)}-${i}`;
      t = { id: nid, createdAt: Date.now() };
      state.tasks.push(t);
    }
    Object.assign(t, { title, prompt, text: text || prompt.split('\n')[0].slice(0, 140), readonly: !!readonly });
    state.changed();
    return { ok: true, task: t };
  }

  function remove(id) {
    const n = state.tasks.length;
    state.tasks = state.tasks.filter(t => t.id !== id);
    if (n !== state.tasks.length) state.changed();
    return n !== state.tasks.length;
  }

  // Ouvre Claude Code dans le dossier du projet, dans une nouvelle fenetre PowerShell (Windows).
  // En fond (background) : pas de fenetre, Claude Code tourne seul (claude -p) et la tour le suit.
  // Il ne peut rien demander : il n'a que la lecture du projet et l'ecriture dans Saved/Tour, et
  // seules les taches qui ne modifient pas le code (readonly) se lancent ainsi.
  // Ecrit la consigne dans Saved/Tour/taches/ et renvoie la courte demande qui la fait lire.
  function prepare({ id, project }) {
    const task = find(id);
    if (!task || !ID.test(task.id)) return { ok: false, error: 'tâche inconnue' };
    const p = project && project.root ? project : null;
    if (!p) return { ok: false, error: 'Aucun projet Unreal connecté : connecte d\'abord ton projet.' };
    const rel = `Saved/Tour/taches/${task.id}.md`;
    try {
      fs.mkdirSync(path.join(p.root, 'Saved', 'Tour', 'taches'), { recursive: true });
      fs.writeFileSync(path.join(p.root, ...rel.split('/')), promptFor(task, p.name), 'utf8');
    } catch (e) { return { ok: false, error: `Impossible d'écrire la consigne dans Saved/Tour : ${e.message}` }; }
    return { ok: true, task, project: p, file: rel, ask: `Tache de la tour [${task.id}] : lis la consigne dans ${rel} et suis-la.` };
  }

  async function launch({ id, project, background }) {
    const task = find(id);
    if (!task || !ID.test(task.id)) return { ok: false, error: 'tâche inconnue' };
    const p = project && project.root ? project : null;
    if (!p) return { ok: false, error: 'Aucun projet Unreal connecté : connecte d\'abord ton projet.' };
    if (background && !task.readonly) return { ok: false, error: 'Cette tâche modifie le code : lance-la dans une fenêtre pour valider ses modifications.' };
    if (process.platform !== 'win32') return { ok: false, error: 'Le lancement ouvre une fenêtre Windows : ici, copie la consigne dans une session Claude Code.' };
    const found = await new Promise(r => execFile('where', ['claude'], { windowsHide: true, timeout: 5000 }, (e) => r(!e)));
    if (!found) return { ok: false, code: 'noclaude', error: 'Claude Code en ligne de commande n\'est pas installé sur ce PC.' };
    const rel = `Saved/Tour/taches/${task.id}.md`;
    try {
      fs.mkdirSync(path.join(p.root, 'Saved', 'Tour', 'taches'), { recursive: true });
      fs.writeFileSync(path.join(p.root, ...rel.split('/')), promptFor(task, p.name), 'utf8');
    } catch (e) { return { ok: false, error: `Impossible d'écrire la consigne dans Saved/Tour : ${e.message}` }; }
    // Demande courte et en ASCII : elle traverse PowerShell sans souci de guillemets ni d'encodage.
    const ask = `Tache de la tour [${task.id}] : lis la consigne dans ${rel} et suis-la.`;
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    if (background) {
      const log = `Saved/Tour/taches/${task.id}-${today()}-${Date.now() % 100000}.log`;
      const script = [
        `Set-Location -LiteralPath ${q(p.root)}`,
        `claude -p ${q(ask)} ${backgroundArgs(task).map(q).join(' ')} *> ${q(path.join(p.root, ...log.split('/')))}`,
      ].join('\n');
      try {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          { windowsHide: true, detached: true, stdio: 'ignore', env: launchEnv() });
        child.on('error', () => {});
        child.unref();
      } catch (e) { return { ok: false, error: e.message }; }
      return { ok: true, task: task.id, file: rel, log, background: true };
    }
    const script = [
      `$host.UI.RawUI.WindowTitle = ${q(`${task.sujet ? 'Sujet' : task.feature ? 'Feature' : 'Tache'} : ${slug(task.title)}`)}`,
      `Set-Location -LiteralPath ${q(p.root)}`,
      // une session core ou feature part avec ses regles (lib/regles.js)
      [`claude ${q(ask)}`, ...(state.ruleArgs ? state.ruleArgs(task.id) : []).map(q)].join(' '),
    ].join('\n');
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    try {
      const child = spawn('cmd.exe', ['/d', '/c', `start "Tache tour" powershell.exe -NoExit -EncodedCommand ${enc}`],
        { windowsHide: true, detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env: launchEnv() });
      child.on('error', () => {});
      child.unref();
    } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, task: task.id, file: rel };
  }

  return { list, find, save, remove, launch, prepare };
}

module.exports = { create, BUILTIN, BACKGROUND_ARGS, backgroundArgs, promptFor, taskIdIn, slug, launchEnv };
