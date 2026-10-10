'use strict';
// Taches : des consignes pretes a lancer sur un projet (relecture, anomalies, idees de features) et
// celles qu'on ajoute soi-meme. Lancer une tache ouvre Claude Code dans le dossier du projet, dans une
// nouvelle fenetre : on y valide ses modifications comme d'habitude. La consigne est ecrite dans
// Saved/Tour/taches/ du projet (dossier non versionne), et l'agent la lit : la premiere demande,
// « Tache de la tour [id] », permet a la tour de reconnaitre la session et d'en compter les tokens.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const BUILTIN = [
  {
    id: 'relecture', title: 'Relecture complète et rapport',
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
    id: 'features', title: 'Idées de features et plan d\'action',
    text: 'Propose des features adaptées au jeu, puis un plan d\'action détaillé pour la meilleure.',
    prompt: `Propose des idées de features pour le projet {projet}, sans modifier le code.

1. Lis le CLAUDE.md, la doc et assez de code et de Content/ pour comprendre le jeu et son état.
2. Propose 5 features qui ont du sens pour ce jeu. Pour chacune : ce que ça apporte au joueur, l'effort (petit, moyen, gros), les risques, ce qui existe déjà et peut servir.
3. Choisis la meilleure (le plus de valeur pour le moins d'effort) et écris son plan d'action dans Saved/Tour/plans/feature-{date}.md : étapes dans l'ordre, fichiers et classes à créer ou modifier, assets nécessaires, tests qui prouveront qu'elle marche, découpage en tâches pour plusieurs agents.
4. Termine par la liste des 5 idées en une ligne chacune, et le chemin du plan.`,
  },
];

const ID = /^[a-z0-9-]{1,40}$/;

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'tache';
}
function clean(s, max) { return String(s || '').replace(/\r/g, '').trim().slice(0, max); }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// La consigne complete d'une tache pour un projet. La premiere ligne sert de marque a la tour.
function promptFor(task, projectName) {
  const body = task.prompt.replace(/\{projet\}/g, projectName || 'en cours').replace(/\{date\}/g, today());
  return `Tache de la tour [${task.id}] : ${task.title}\n\n${body}\n`;
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
  function find(id) { return list().find(t => t.id === id) || null; }

  function save({ id, title, prompt, text }) {
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
    Object.assign(t, { title, prompt, text: text || prompt.split('\n')[0].slice(0, 140) });
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
  async function launch({ id, project }) {
    const task = find(id);
    if (!task || !ID.test(task.id)) return { ok: false, error: 'tâche inconnue' };
    const p = project && project.root ? project : null;
    if (!p) return { ok: false, error: 'Aucun projet Unreal connecté : connecte d\'abord ton projet.' };
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
    const script = [
      `$host.UI.RawUI.WindowTitle = ${q(`Tache : ${slug(task.title)}`)}`,
      `Set-Location -LiteralPath ${q(p.root)}`,
      `claude ${q(ask)}`,
    ].join('\n');
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    try {
      const child = spawn('cmd.exe', ['/d', '/c', `start "Tache tour" powershell.exe -NoExit -EncodedCommand ${enc}`],
        { windowsHide: true, detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
      child.on('error', () => {});
      child.unref();
    } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, task: task.id, file: rel };
  }

  return { list, find, save, remove, launch };
}

module.exports = { create, BUILTIN, promptFor, taskIdIn, slug };
