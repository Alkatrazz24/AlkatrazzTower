'use strict';
// Features : une session pour mettre en place une nouvelle idee, a cote des sessions core.
//
// Les sessions core sont les sujets du jeu (lib/sujets.js) : elles durent, gardent la memoire de leur
// sujet dans leur carnet et ont leurs regles (lib/regles.js). Une feature, elle, nait d'une idee, se
// cree depuis la tour (nom, idee, sujets touches) et se termine quand l'idee est en place. Elle lit les
// carnets core des sujets qu'elle touche sans les reecrire : ce qui change pour un sujet passe par le
// tableau partage, et la session core le range dans son carnet a sa prochaine session. Elle tient son
// propre carnet dans Saved/Tour/features/<nom>.md.
//
// Une feature est aussi une carte du tableau des demandes (lib/demandes.js) : les demandes d'ali qui en
// parlent s'y rangent (le chef dit laquelle), et son historique se reconstruit avec ce que la tour garde
// sur le disque (le tableau partage, les envois du chef, les verdicts du conseil) grace a ses mots-cles.
// Une feature peut donc exister sans session : le chef la cree pour ranger ses demandes.

const sujets = require('./sujets');

const fs = require('fs');
const path = require('path');

const PREFIX = 'feature-';
const NOTES_DIR = 'Saved/Tour/features';
const isFeature = (id) => String(id || '').startsWith(PREFIX);
const notesPath = (id) => `${NOTES_DIR}/${String(id).slice(PREFIX.length)}.md`;
const clean = (s, max) => String(s || '').replace(/\r/g, '').trim().slice(0, max);

// Une nouvelle feature. list : les features deja la (pour un id unique), topics : les sujets du projet.
function make({ title, idea, sujets: touched, project, mots, by }, list = [], topics = [], now = Date.now()) {
  title = clean(title, 60).replace(/\s+/g, ' ');
  idea = clean(idea, 2000);
  const words = wordsOf(mots);
  if (!title) return { ok: false, error: 'Donne un nom à la feature.' };
  if (!idea) return { ok: false, error: 'Décris l\'idée en quelques mots.' };
  const known = new Set(topics.map(t => t.id));
  const ids = [...new Set((Array.isArray(touched) ? touched : []).map(String))].filter(id => known.has(id));
  const base = PREFIX + sujets.slug(title).slice(0, 28);
  let id = base;
  for (let i = 2; list.some(f => f.id === id); i++) id = `${base}-${i}`;
  return { ok: true, feature: { id, title, idea, sujets: ids, project: clean(project, 80), createdAt: now, ...(words.length ? { mots: words } : {}), ...(by ? { by: clean(by, 40) } : {}) } };
}

// ---- retrouver une feature par son nom, et son historique par ses mots-cles ---------------------

// Un texte pour comparer : minuscules, sans accents, mots separes par une espace.
const norm = (s) => ` ${String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
function wordsOf(mots) {
  const l = Array.isArray(mots) ? mots : String(mots || '').split(/[,;\n]+/);
  return [...new Set(l.map(x => clean(x, 40).replace(/\s+/g, ' ')).filter(x => norm(x).trim().length >= 3))].slice(0, 12);
}
// La feature d'un nom donne par le chef : son id, ou son titre a la casse et aux accents pres.
function find(list, name, project) {
  const n = norm(String(name || '').replace(/^feature\s*:\s*/i, ''));
  if (!n.trim()) return null;
  const mine = (list || []).filter(f => !project || !f.project || f.project === project);
  return mine.find(f => f.id === String(name).trim()) || mine.find(f => norm(f.title) === n) || mine.find(f => norm(f.id.slice(PREFIX.length).replace(/-/g, ' ')) === n) || null;
}
// Ce qui designe la feature dans un texte : son titre, le coeur de son titre (« Coup de pied dans les
// portes » donne aussi « coup de pied »), et les mots-cles donnes par le chef. « CoupDePied » ou
// « coup-de-pied » comptent aussi : on compare aussi les textes sans espaces.
const LINK = /\s(?:dans|sur|pour|avec|et|ou|les|aux|au|du|des|en|a|la|le|l)\s/;
function coreOf(title) {
  const n = norm(title).trim();
  const head = n.split(LINK)[0].trim();
  return head && head !== n && (head.split(' ').length >= 2 || head.length >= 8) ? [head] : [];
}
function keysOf(f) {
  return [...new Set([f.title, ...coreOf(f.title), ...(f.mots || [])].map(k => norm(k).trim()).filter(k => k.length >= 3))];
}
const compact = (s) => s.replace(/ /g, '');
function matcher(f) {
  const keys = keysOf(f);
  return (text) => {
    const t = norm(text), c = compact(t);
    return keys.some(k => t.includes(` ${k} `) || (compact(k).length >= 8 && c.includes(compact(k))));
  };
}
const mentions = (f, text) => matcher(f)(text);

// L'historique d'une feature avant qu'elle soit suivie : les lignes du tableau partage, les envois du
// chef ranges dans envoyes/ et les verdicts du conseil qui la nomment. Lecture seule.
const PAST_MAX = 40;
function readHead(file, max) {
  try {
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(max); const n = fs.readSync(fd, buf, 0, max, 0); return buf.slice(0, n).toString('utf8').replace(/^\uFEFF/, ''); } finally { fs.closeSync(fd); }
  } catch { return ''; }
}
// Une date du disque, a l'heure du PC : « 2026-10-11 00:03 », « 2026-10-11-00-03 » ou « 11/10 00:03 »
// (sans annee : la plus recente qui ne soit pas dans le futur).
function parseWhen(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[ T_-](\d{1,2})[:h-](\d{2}))?/.exec(String(s || ''));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime();
  const d = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?,?\s*(\d{1,2})[:h](\d{2})/.exec(String(s || ''));
  if (!d) return 0;
  const y = d[3] ? (+d[3] < 100 ? 2000 + +d[3] : +d[3]) : new Date().getFullYear();
  let t = new Date(y, +d[2] - 1, +d[1], +d[4], +d[5]).getTime();
  if (!d[3] && t > Date.now() + 86400_000) t = new Date(y - 1, +d[2] - 1, +d[1], +d[4], +d[5]).getTime();
  return t;
}
function past(root, f, cache = new Map()) {
  if (!root) return [];
  const out = [];
  const hit = matcher(f);
  // un passage de la tour lit chaque fichier une fois pour toutes les features
  const read = (file, max) => { if (!cache.has(file)) cache.set(file, readHead(file, max)); return cache.get(file); };
  const list = (dir) => { const k = `dir:${dir}`; if (!cache.has(k)) { let l = []; try { l = fs.readdirSync(dir); } catch { /* absent */ } cache.set(k, l); } return cache.get(k); };
  // le tableau partage, en entier
  const board = read(path.join(root, ...sujets.BOARD.split('/')), 1024 * 1024);
  for (const e of sujets.parseBoard(board, 100000)) {
    if (hit(e.text) || hit(e.from) || hit(e.to)) out.push({ at: parseWhen(e.when), who: e.from, to: e.to, text: e.text, src: 'tableau' });
  }
  // les envois du chef deja lus (Saved/Tour/chef/envoyes/<date>-<nom>.md)
  const sent = path.join(root, 'Saved', 'Tour', 'chef', 'envoyes');
  let names = list(sent).filter(n => /\.(md|txt)$/i.test(n));
  for (const n of names) {
    const raw = read(path.join(sent, n), 8 * 1024);
    const head = raw.split(/^-{3,}\s*$/m)[0] || '';
    const named = /^\s*feature\s*:\s*(.+)$/im.exec(head);
    if (!hit(raw) && !(named && find([f], named[1]))) continue;
    const pour = (/^\s*pour\s*:\s*(.+)$/im.exec(head) || [])[1] || '';
    const body = raw.replace(/^[\s\S]*?^-{3,}\s*$/m, '').trim();
    const to = pour.trim().replace(/^sujet-/, '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
    out.push({ at: parseWhen(n), who: 'Chef', to, text: body.replace(/\s+/g, ' ').slice(0, 400), src: 'envoi' });
  }
  // les verdicts du conseil (Saved/Tour/conseil/<date>-<question>.md)
  const cdir = path.join(root, 'Saved', 'Tour', 'conseil');
  names = list(cdir).filter(n => /\.md$/i.test(n));
  for (const n of names) {
    const raw = read(path.join(cdir, n), 16 * 1024);
    if (!hit(raw) && !hit(n)) continue;
    const q = (/^#\s*(.+)$/m.exec(raw) || [])[1] || n.replace(/\.md$/i, '');
    const d = (/d[ée]cision\s*:?\**\s*:?\s*(.+)$/im.exec(raw) || [])[1] || '';
    out.push({ at: parseWhen(n), who: 'Conseil', to: '', text: `${q.trim()}${d ? ` : ${d.replace(/\*+/g, '').trim()}` : ''}`.slice(0, 400), src: 'conseil' });
  }
  // les rapports des taches qui la nomment (Saved/Tour/rapports/<nom>-<date>.md)
  for (const n of list(path.join(root, 'Saved', 'Tour', 'rapports')).filter(n => /\.md$/i.test(n))) {
    if (!hit(n.replace(/\.md$/i, ''))) continue;
    let when = 0;
    try { when = fs.statSync(path.join(root, 'Saved', 'Tour', 'rapports', n)).mtimeMs; } catch { /* parti */ }
    out.push({ at: Math.round(when) || parseWhen(n), who: 'Rapport', to: '', text: `Saved/Tour/rapports/${n}`, src: 'rapport', file: `Saved/Tour/rapports/${n}` });
  }
  // les lignes datees des carnets de sujets (« 11/10, 00:15 — ... ») : ou chaque sujet en est reste
  const sdir = path.join(root, ...sujets.NOTES_DIR.split('/'));
  for (const n of list(sdir).filter(n => /\.md$/i.test(n))) {
    const file = path.join(sdir, n);
    const raw = read(file, 64 * 1024);
    let year = new Date().getFullYear();
    try { year = new Date(fs.statSync(file).mtimeMs).getFullYear(); } catch { /* carnet parti */ }
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*[-*]?\s*(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?,?\s*(\d{1,2})[:h](\d{2})/.exec(line);
      if (!m || !hit(line)) continue;
      const text = line.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
      out.push({ at: new Date(year, +m[2] - 1, +m[1], +m[3], +m[4]).getTime(), who: n.replace(/\.md$/i, '').replace(/^./, c => c.toUpperCase()), to: '', text: text.slice(0, 300), src: 'carnet' });
    }
  }
  // le chef ecrit chaque envoi au tableau : la ligne du tableau double le fichier de l'envoi
  const envois = out.filter(x => x.src === 'envoi');
  for (let i = out.length - 1; i >= 0; i--) {
    const x = out[i];
    const same = (e) => Math.abs(e.at - x.at) < 3 * 60_000 && (!e.to || !x.to || norm(e.to).includes(` ${norm(x.to).trim()} `));
    if (x.src === 'tableau' && /^chef$/i.test(x.who) && envois.some(same)) out.splice(i, 1);
  }
  // une fois la feature suivie, les envois du chef sont deja ses demandes : on ne les compte pas deux fois
  const since = (f.createdAt || 0) - 60_000;
  const live = (x) => x.at >= since && (x.src === 'envoi' || (x.src === 'tableau' && /^chef$/i.test(x.who)));
  return out.filter(x => x.at && !live(x)).sort((a, b) => a.at - b.at).slice(-PAST_MAX);
}

// Les taches perso d'ali (lib/taches.js) sont deja des features qu'il suit : la tour en fait des cartes,
// une fois chacune. tasks : celles de la tour ; root : le projet, dont Saved/Tour/taches/perso-*.md
// garde les consignes deja lancees (meme si la tache a ete retiree de la tour).
function seedsOf(root, tasks = []) {
  const out = new Map();
  for (const t of tasks || []) {
    if (!t || !/^perso-/.test(t.id || '') || !t.title) continue;
    out.set(t.id, { key: t.id, title: t.title, idea: clean(t.text || String(t.prompt || '').split('\n')[0], 400) || t.title });
  }
  let names = [];
  try { names = root ? fs.readdirSync(path.join(root, 'Saved', 'Tour', 'taches')) : []; } catch { /* pas de taches */ }
  for (const n of names) {
    const m = /^(perso-[a-z0-9-]{1,40})\.md$/.exec(n);
    if (!m || out.has(m[1])) continue;
    const raw = readHead(path.join(root, 'Saved', 'Tour', 'taches', n), 4096);
    const head = /Tache de la tour \[[a-z0-9-]+\]\s*:\s*(.+)/.exec(raw);
    const title = clean(head ? head[1] : m[1].slice(6).replace(/-\d+$/, '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), 60);
    const body = raw.split(/\r?\n/).slice(head ? 1 : 0).map(l => l.trim()).filter(Boolean)[0] || '';
    if (title) out.set(m[1], { key: m[1], title, idea: clean(body, 400) || title });
  }
  return [...out.values()];
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
Quand l'idée est en place, écris-le en tête de « Où on en est » et dis à ali qu'il peut terminer la feature dans la tour.
6. Doc obligatoire : si toi ou tes agents avez modifié le jeu, écris ou mets à jour sa doc dans docs/ (docs/README.md dit où) : ce qui a changé, où, pourquoi, comment le tester. Le carnet ne la remplace pas : il est pour la prochaine session, la doc est pour ali. Dis-le aussi à chaque agent dans son brief.`;
}

function taskOf(f, topics) {
  return { id: f.id, title: f.title, text: f.idea.split('\n')[0].slice(0, 160), prompt: promptOf(f, topics), readonly: false, feature: true };
}

// Ce que la tour montre d'une feature : elle-meme, son carnet, et son historique sur le disque.
function scan(root, f, cache) {
  return { ...f, notes: sujets.readNotes(root, f.id, notesPath(f.id)), past: past(root, f, cache) };
}

module.exports = { PREFIX, NOTES_DIR, isFeature, notesPath, make, promptOf, taskOf, scan, find, wordsOf, mentions, matcher, keysOf, past, norm, seedsOf };
