'use strict';
// Regles d'une session core (un sujet) ou feature : ce qu'elle fait sans demander, ce qu'elle demande a
// ali, ce qui lui est interdit. ali les regle dans la tour ; elles vivent dans les donnees de la tour et
// s'appliquent quand la tour lance la session (options --allowedTools et --disallowedTools de Claude
// Code), a chaque message de la discussion. Rien n'est ecrit dans les reglages du projet.
//
// Toujours permis : lire le projet, et ecrire dans Saved/Tour (le carnet, le tableau, les rapports).

const LEVELS = ['oui', 'demander', 'non'];
const LEVEL_TEXT = { oui: 'sans demander', demander: 'en demandant à ali', non: 'interdit' };

// Les dossiers du jeu qu'on protege quand « Modifier les fichiers » est interdit. Saved/ n'y est pas :
// la session doit pouvoir tenir son carnet dans Saved/Tour.
const GAME = ['Source', 'Content', 'Config', 'Plugins', 'Tools', 'tools', 'docs', '.claude'];
const ROOT_FILES = ['*.uproject', 'CLAUDE.md', '*.ps1', '*.bat', '*.py'];
// Une regle Edit(chemin) couvre tous les outils qui ecrivent des fichiers (Write, NotebookEdit...) :
// Claude Code ne lit les chemins que dans les regles Edit.
const editTools = ['Edit', 'Write', 'NotebookEdit'];
const protect = () => [...GAME.map(d => `Edit(./${d}/**)`), ...ROOT_FILES.map(f => `Edit(./${f})`)];

const ACTIONS = [
  { id: 'modifier', label: 'Modifier les fichiers du jeu', hint: 'code, Blueprints, config', tools: editTools, deny: protect, def: 'demander' },
  { id: 'commandes', label: 'Lancer des commandes', hint: 'build, tests, scripts', tools: ['Bash', 'PowerShell'], def: 'demander' },
  { id: 'git', label: 'Committer et pousser', hint: 'git commit, git push', tools: ['Bash(git commit:*)', 'Bash(git push:*)', 'PowerShell(git commit:*)', 'PowerShell(git push:*)'], def: 'non' },
  { id: 'internet', label: 'Chercher sur internet', hint: 'pages web, recherche', tools: ['WebFetch', 'WebSearch'], def: 'demander' },
  { id: 'agents', label: 'Appeler ses agents', hint: 'les spécialistes du sujet', tools: ['Agent', 'Task'], def: 'oui' },
];
const ALWAYS = ['Read', 'Grep', 'Glob', 'LS', 'Edit(./Saved/Tour/**)'];

// Les regles completes d'une session : ce qu'ali a regle, le reste par defaut (base : les defauts
// propres a une session, comme le chef qui ne modifie rien).
function rulesOf(saved, base) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = saved && LEVELS.includes(saved[a.id]) ? saved[a.id] : base && LEVELS.includes(base[a.id]) ? base[a.id] : a.def;
  return out;
}

// Les options de lancement de Claude Code pour ces regles.
function args(saved, base) {
  const r = rulesOf(saved, base), allow = [...ALWAYS], deny = [];
  for (const a of ACTIONS) {
    if (r[a.id] === 'oui') allow.push(...a.tools);
    else if (r[a.id] === 'non') deny.push(...(a.deny ? a.deny() : a.tools));
  }
  return [...(allow.length ? ['--allowedTools', allow.join(',')] : []), ...(deny.length ? ['--disallowedTools', deny.join(',')] : [])];
}

// Les regles dites a la session dans sa consigne, pour qu'elle ne tente pas ce qui est interdit.
function text(saved, base) {
  const r = rulesOf(saved, base);
  const by = (lv) => ACTIONS.filter(a => r[a.id] === lv).map(a => a.label.toLowerCase());
  const parts = [];
  if (by('oui').length) parts.push(`sans demander : ${by('oui').join(', ')}`);
  if (by('demander').length) parts.push(`en demandant à ali (la tour lui pose la question) : ${by('demander').join(', ')}`);
  if (by('non').length) parts.push(`interdit, ne le tente pas et propose à ali de le faire : ${by('non').join(', ')}`);
  return `Tes droits, réglés par ali dans la tour : tu lis tout le projet et tu écris dans Saved/Tour ; ${parts.join(' ; ')}.`;
}

function valid(action, level) { return ACTIONS.some(a => a.id === action) && LEVELS.includes(level); }

module.exports = { ACTIONS: ACTIONS.map(({ id, label, hint, def }) => ({ id, label, hint, def })), LEVELS, LEVEL_TEXT, ALWAYS, rulesOf, args, text, valid };
