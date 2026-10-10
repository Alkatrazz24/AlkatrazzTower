'use strict';
// Sujets : une session Claude Code par sujet du jeu (animation, interface, menus, armes, items, base...).
// Chaque sujet a sa salle dans la tour, meme quand aucune session ne tourne, et se lance a la demande.
//
// Une session ne vit pas en permanence : une longue session relit tout son contexte a chaque tour, et
// c'est ce qui coute des tokens. A la place, chaque sujet tient un carnet, et la session suivante reprend
// la ou la precedente s'est arretee en le lisant. Les sujets se parlent par un tableau partage. Les deux
// sont dans Saved/Tour/ du projet (non versionne), comme les consignes et les rapports des taches :
//   Saved/Tour/sujets/<sujet>.md  le carnet du sujet : ou on en est, decisions, prochaines etapes ;
//   Saved/Tour/tableau.md         le tableau : une ligne par message d'un sujet a un autre, ajoutee a la fin.

const fs = require('fs');
const path = require('path');

const PREFIX = 'sujet-';
const BOARD = 'Saved/Tour/tableau.md';
const NOTES_DIR = 'Saved/Tour/sujets';

// Les sections de l'equipe (lib/equipe.js) qui ne sont pas un sujet du jeu : elles servent tous les sujets.
// Le reseau et les tests relisent le travail de tous les sujets : leurs agents sont proposes a chacun.
const NOT_TOPIC = new Set(['Direction', 'Tests et qualité', 'Réseau', 'Autres']);
const REVIEW = ['Tests et qualité', 'Réseau'];
// Sujets demandes qui n'ont pas de section a eux : leurs agents viennent des sections voisines.
const EXTRA = [
  { title: 'Items', match: /item|objet/i, from: ['Économie et inventaire'], text: 'Les objets du jeu : loot, équipement, consommables, leurs données et leur place dans l\'inventaire.' },
  { title: 'Base', match: /(^|\s)base|planque|abri|safe/i, from: ['Monde et niveaux', 'Gameplay'], text: 'La base du joueur : son niveau, ce qu\'on y fait, ce qu\'on y garde et ce qui s\'y construit.' },
];

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'sujet';
}
const isSujet = (id) => String(id || '').startsWith(PREFIX);
const notesPath = (id) => `${NOTES_DIR}/${String(id).slice(PREFIX.length)}.md`;

// Les sujets d'un projet, a partir de son equipe : un par section, plus Items et Base.
function topicsOf(team) {
  const bySection = new Map();
  for (const m of team || []) {
    if (!bySection.has(m.section)) bySection.set(m.section, []);
    bySection.get(m.section).push(m.name);
  }
  const reviewers = REVIEW.flatMap(s => bySection.get(s) || []);
  const out = [];
  for (const [section, agents] of bySection) {
    if (NOT_TOPIC.has(section)) continue;
    out.push({ id: PREFIX + slug(section), title: section, section, agents, reviewers, text: '' });
  }
  for (const x of EXTRA) {
    if (out.some(t => x.match.test(t.title))) continue;
    const agents = [...new Set(x.from.flatMap(s => bySection.get(s) || []))];
    out.push({ id: PREFIX + slug(x.title), title: x.title, section: '', agents, reviewers, text: x.text });
  }
  return out;
}

// La consigne d'une session de sujet. {projet} et {date} sont remplaces au lancement (lib/taches.js).
function promptOf(t) {
  const notes = notesPath(t.id);
  const ag = t.agents.length ? t.agents.map(a => `\`${a}\``).join(', ') : 'aucun agent attitré : appelle ceux des sections voisines si besoin';
  return `Tu es la session du sujet « ${t.title} » sur {projet}.${t.text ? ` ${t.text}` : ''} Tu restes dans ce sujet : ce qui relève d'un autre sujet va au tableau, pour lui.

Avant tout :
1. Lis le carnet du sujet, ${notes}. Il dit où la dernière session s'est arrêtée. S'il n'existe pas, crée-le avec les rubriques du point 6.
2. Lis la fin du tableau partagé, ${BOARD} (les 40 dernières lignes). Les messages pour « ${t.title} » ou pour « tous » passent avant le reste.
3. Demande ensuite ce qu'on fait aujourd'hui dans ce sujet, en proposant les prochaines étapes du carnet et les messages du tableau qui t'attendent : avec AskUserQuestion si tu l'as, sinon (discussion depuis la tour) pose la question dans ta réponse et arrête-toi là pour attendre la réponse.

Tes agents : ${ag}.${t.reviewers.length ? ` Pour relire, tester et vérifier la réplication : ${t.reviewers.map(a => `\`${a}\``).join(', ')}.` : ''} Dans le brief de chaque agent, colle les lignes du carnet et du tableau qui le concernent, et demande-lui de te rendre à la fin ce que les autres sujets doivent savoir (fichier ou classe changé qui les touche, décision, besoin, problème).

4. Pendant le travail, ajoute au tableau une ligne par information utile à un autre sujet, à la fin du fichier, au format :
   - {date} HH:MM · ${t.title} → <sujet ou tous> : <message court>
   N'efface et ne réécris jamais les lignes des autres.
5. Quand un message du tableau qui t'était adressé est traité, ajoute une ligne « ${t.title} → <son auteur> : fait, <ce qui a été fait> ».
6. Avant de rendre la main, mets à jour le carnet, court, pour que la prochaine session reprenne en le lisant :
   ## Où on en est
   ## Décisions
   ## Prochaines étapes
   ## Fichiers du sujet`;
}

// Le sujet sous forme de tache : il se lance comme les autres (fenetre, consigne dans Saved/Tour/taches).
function taskOf(t) {
  return { id: t.id, title: t.title, text: t.text || `Session du sujet ${t.title}, avec son carnet et le tableau partagé.`, prompt: promptOf(t), readonly: false, sujet: true };
}

function readText(file, max) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(st.size, max);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, st.size - n);
      return { text: buf.toString('utf8').replace(/^﻿/, ''), at: st.mtimeMs, size: st.size, cut: st.size > max };
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

// Le carnet : sa date et ses prochaines etapes (ou sa fin), pour la fiche de la salle.
function readNotes(root, id) {
  const r = readText(path.join(root, ...notesPath(id).split('/')), 64 * 1024);
  if (!r) return null;
  const next = r.text.match(/^#{1,4}\s*prochaines?\s+[ée]tapes?\s*\n([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/im);
  const where = r.text.match(/^#{1,4}\s*o[uù] on en est\s*\n([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/im);
  const clip = (s) => String(s || '').trim().slice(0, 600);
  return { at: r.at, size: r.size, where: clip(where && where[1]), next: clip(next && next[1]) || (where ? '' : clip(r.text.slice(-600))) };
}

// Le tableau : ses dernieres lignes « - date · De → Pour : message ».
const LINE = /^\s*[-*]\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}[:h]\d{2})?)?\s*[·|-]?\s*([^→:\n]{1,40}?)\s*(?:→|->)\s*([^:\n]{1,40}?)\s*:\s*(.+)$/;
function parseBoard(text, n = 40) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (m) out.push({ when: m[1] || '', from: m[2].trim(), to: m[3].trim(), text: m[4].trim().slice(0, 300) });
  }
  return out.slice(-n);
}
function readBoard(root, n = 40) {
  const r = readText(path.join(root, ...BOARD.split('/')), 128 * 1024);
  return r ? { at: r.at, entries: parseBoard(r.text, n) } : { at: 0, entries: [] };
}

function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const one = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Un message ecrit depuis la tour (par toi) : ajoute a la fin du tableau, jamais rien d'autre.
function post(root, { from, to, text }) {
  const msg = one(text, 400), de = one(from, 40).replace(/[→:]/g, ' ').trim() || 'ali', pour = one(to, 40).replace(/[→:]/g, ' ').trim() || 'tous';
  if (!msg) return { ok: false, error: 'Le message est vide.' };
  const file = path.join(root, ...BOARD.split('/'));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = fs.existsSync(file) ? '' : '# Tableau des sujets\n\nUne ligne par message d\'un sujet à un autre, ajoutée à la fin. On n\'efface rien.\n\n';
    let sep = '';
    try { const r = readText(file, 1); if (r && r.size && r.text !== '\n') sep = '\n'; } catch { /* nouveau fichier */ }
    fs.appendFileSync(file, `${head}${sep}- ${stamp()} · ${de} → ${pour} : ${msg}\n`, 'utf8');
  } catch (e) { return { ok: false, error: `Écriture impossible dans ${BOARD} : ${e.message}` }; }
  return { ok: true };
}

// Le carnet d'un sujet ou le tableau, en entier, pour les lire depuis la tour. Rien d'autre n'est lisible.
function readFile(root, id) {
  const rel = id === 'tableau' ? BOARD : isSujet(id) && /^[a-z0-9-]{1,40}$/.test(id) ? notesPath(id) : null;
  if (!rel) return { ok: false, error: 'fichier inconnu' };
  const r = readText(path.join(root, ...rel.split('/')), 256 * 1024);
  if (!r) return { ok: false, error: id === 'tableau' ? 'Le tableau est encore vide.' : 'Pas encore de carnet : la première session de ce sujet le crée.' };
  return { ok: true, path: rel, text: (r.cut ? '…\n' : '') + r.text };
}

// Ce que la tour montre d'un projet : ses sujets avec leur carnet, et la fin du tableau.
function scan(project, team) {
  const topics = topicsOf(team).map(t => ({ ...t, notes: readNotes(project.root, t.id) }));
  return { project: project.name, topics, board: readBoard(project.root) };
}

module.exports = { PREFIX, BOARD, NOTES_DIR, isSujet, notesPath, slug, topicsOf, promptOf, taskOf, readNotes, parseBoard, readBoard, readFile, post, scan, stamp };
