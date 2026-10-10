'use strict';
// Features : une session pour mettre en place une nouvelle idee, a cote des sessions core.
//
// Les sessions core sont les sujets du jeu (lib/sujets.js) : elles durent, gardent la memoire de leur
// sujet dans leur carnet et ont leurs regles (lib/regles.js). Une feature, elle, nait d'une idee, se
// cree depuis la tour (nom, idee, sujets touches) et se termine quand l'idee est en place. Elle lit les
// carnets core des sujets qu'elle touche sans les reecrire : ce qui change pour un sujet passe par le
// tableau partage, et la session core le range dans son carnet a sa prochaine session. Elle tient son
// propre carnet dans Saved/Tour/features/<nom>.md.

const sujets = require('./sujets');

const PREFIX = 'feature-';
const NOTES_DIR = 'Saved/Tour/features';
const isFeature = (id) => String(id || '').startsWith(PREFIX);
const notesPath = (id) => `${NOTES_DIR}/${String(id).slice(PREFIX.length)}.md`;
const clean = (s, max) => String(s || '').replace(/\r/g, '').trim().slice(0, max);

// Une nouvelle feature. list : les features deja la (pour un id unique), topics : les sujets du projet.
function make({ title, idea, sujets: touched, project }, list = [], topics = [], now = Date.now()) {
  title = clean(title, 60).replace(/\s+/g, ' ');
  idea = clean(idea, 2000);
  if (!title) return { ok: false, error: 'Donne un nom à la feature.' };
  if (!idea) return { ok: false, error: 'Décris l\'idée en quelques mots.' };
  const known = new Set(topics.map(t => t.id));
  const ids = [...new Set((Array.isArray(touched) ? touched : []).map(String))].filter(id => known.has(id));
  const base = PREFIX + sujets.slug(title).slice(0, 28);
  let id = base;
  for (let i = 2; list.some(f => f.id === id); i++) id = `${base}-${i}`;
  return { ok: true, feature: { id, title, idea, sujets: ids, project: clean(project, 80), createdAt: now } };
}

// La consigne d'une session feature. {projet} et {date} sont remplaces au lancement (lib/taches.js).
function promptOf(f, topics = []) {
  const mine = topics.filter(t => f.sujets.includes(t.id));
  const agents = [...new Set(mine.flatMap(t => t.agents))];
  const reviewers = [...new Set(mine.flatMap(t => t.reviewers || []))];
  const notes = mine.map(t => `- ${t.title} : ${sujets.notesPath(t.id)}`).join('\n');
  return `Tu es la session de la feature « ${f.title} » sur {projet}. C'est une session feature : elle met en place une nouvelle idée, puis elle s'arrête.

L'idée d'ali :
${f.idea.split('\n').map(l => `> ${l}`).join('\n')}

Avant tout :
1. Lis ton carnet de feature, ${notesPath(f.id)}. S'il n'existe pas, crée-le avec les rubriques du point 5.
2. ${mine.length ? `Lis les carnets core des sujets que cette feature touche. Ce sont la mémoire du jeu, tenue par les sessions core : tu les lis, tu ne les réécris pas.\n${notes}` : 'Aucun sujet core n\'a été choisi : cherche dans Saved/Tour/sujets/ les carnets des sujets que l\'idée touche, et lis-les sans les réécrire.'}
3. Lis la fin du tableau partagé, ${sujets.BOARD} (les 40 dernières lignes).
4. Propose ensuite à ali un plan court (étapes, fichiers, agents) et attends son accord avant de modifier le jeu : avec AskUserQuestion si tu l'as, sinon pose la question dans ta réponse et arrête-toi là.

Tes agents : ${agents.length ? agents.map(a => `\`${a}\``).join(', ') : 'ceux des sujets que l\'idée touche'}.${reviewers.length ? ` Pour relire, tester et vérifier la réplication : ${reviewers.map(a => `\`${a}\``).join(', ')}.` : ''} Tu es leur chef : tu découpes, tu confies, tu vérifies ce qu'ils rendent. Dans le brief de chaque agent, colle les lignes des carnets core qui le concernent. Demande-lui d'écrire en une phrase ce qu'il va faire avant de commencer, puis une phrase courte avant chaque étape importante : la tour affiche ces phrases à ali, en direct. De ton côté, dis à ali en une phrase ce que tu confies à qui, et ce que tu en penses quand ça revient.

Pendant le travail, chaque fois que la feature change quelque chose qu'un sujet core doit retenir (fichier, classe, décision, règle du jeu), ajoute une ligne à la fin du tableau, pour ce sujet :
   - {date} HH:MM · Feature ${f.title} → <sujet> : <ce qui change>
N'efface et ne réécris jamais les lignes des autres.

5. Avant de rendre la main, mets à jour ton carnet de feature, court :
   ## Où on en est
   ## Décisions
   ## Prochaines étapes
   ## Fichiers touchés
Quand l'idée est en place, écris-le en tête de « Où on en est » et dis à ali qu'il peut terminer la feature dans la tour.`;
}

function taskOf(f, topics) {
  return { id: f.id, title: f.title, text: f.idea.split('\n')[0].slice(0, 160), prompt: promptOf(f, topics), readonly: false, feature: true };
}

// Ce que la tour montre d'une feature : elle-meme et son carnet.
function scan(root, f) {
  return { ...f, notes: sujets.readNotes(root, f.id, notesPath(f.id)) };
}

module.exports = { PREFIX, NOTES_DIR, isFeature, notesPath, make, promptOf, taskOf, scan };
