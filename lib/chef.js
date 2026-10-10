'use strict';
// Le chef : une session a qui ali confie toutes ses demandes sur le jeu (« pourquoi cette animation ne
// marche pas », « j'ai importe des assets, tu peux voir », une idee, un bug), dans son propre batiment.
//
// Le chef lit (le projet, les journaux, les carnets, le tableau) et repond a ce qu'il peut verifier
// lui-meme. Il ne modifie pas le jeu : ce qui demande un changement, il le confie a la session core du
// sujet qui le possede (elle a sa memoire et ses regles), ou a une nouvelle feature pour une idee neuve.
//
// Pour confier, il ecrit un fichier par envoi dans Saved/Tour/chef/envois/. La tour le lit (toutes les
// 10 s), le transmet a la session du sujet (dans sa discussion si elle tourne dans la tour, sinon elle
// en lance une), l'ecrit au tableau et le garde dans la liste des envois du batiment du chef. Les
// sessions repondent au tableau, pour « Chef ». La tour tient Saved/Tour/chef/suivi.md : ou en est
// chaque envoi, que le chef lit avant chaque demande.

const fs = require('fs');
const path = require('path');
const sujets = require('./sujets');
const features = require('./features');

const ID = 'chef';
const DIR = 'Saved/Tour/chef';
const ENVOIS = `${DIR}/envois`;
const SENT = `${DIR}/envoyes`;
const SUIVI = `${DIR}/suivi.md`;
const MAX_KEEP = 60; // envois gardes dans la tour
const MAX_FILE = 20 * 1024;
const MAX_TEXT = 6000;
// Ses regles par defaut (lib/regles.js) : il lit tout, appelle ses agents pour enqueter, et ne
// modifie rien du jeu ; ali peut les changer dans sa fiche.
const RULES = { modifier: 'non', commandes: 'non', git: 'non', internet: 'demander', agents: 'oui' };

const isChef = (id) => id === ID;
const one = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// La consigne du chef. {projet} et {date} sont remplaces au lancement (lib/taches.js).
function promptOf(topics = [], feats = []) {
  const list = topics.map(t => `- ${t.id} : ${t.title}${t.agents.length ? ` (agents ${t.agents.join(', ')})` : ''}, carnet ${sujets.notesPath(t.id)}`).join('\n');
  const open = feats.filter(f => !f.doneAt).map(f => `- ${f.id} : ${f.title}, carnet ${features.notesPath(f.id)}`).join('\n');
  return `Tu es le chef de la tour sur {projet}. ali t'apporte toutes sortes de demandes sur le jeu : « pourquoi cette animation ne marche pas », « j'ai importé des assets, tu peux voir », une idée, un bug, une question. Tu es son interlocuteur : tu comprends la demande, tu réponds à ce que tu peux vérifier toi-même, et tu confies le reste aux sessions core (une par sujet du jeu, avec sa mémoire et ses règles) ou à une nouvelle feature.

Ce que tu fais toi-même : lire. Le projet (Source/, Content/ par noms et dossiers, Config/, docs/, et Saved/Logs pour les journaux de l'éditeur et du jeu), les carnets des sujets et le tableau. Tu peux appeler des agents pour enquêter, en lecture seule. Tu ne modifies pas le jeu : un changement passe par la session du sujet qui le possède.

À chaque demande d'ali :
1. Lis ${SUIVI} (où en sont tes envois, écrit par la tour) et les dernières lignes du tableau, ${sujets.BOARD}, surtout celles pour « Chef ».
2. Vérifie ce qui peut l'être en lisant, et réponds à ali en quelques lignes : ce que tu as vu, avec les fichiers. S'il te manque une information, pose-lui la question dans ta réponse et arrête-toi là.
3. S'il faut changer le jeu, ou creuser à fond dans un sujet, confie-le : un fichier par envoi dans ${ENVOIS}/ (format plus bas). La tour le lit dans les 10 secondes, le transmet à la session du sujet (elle la lance si elle dort), l'écrit au tableau et le montre à ali dans ton bâtiment.
4. Termine par une ligne par envoi : à qui, et pour quoi.

Les sujets core :
${list || '- aucun pour l\'instant : le projet n\'a pas encore de sections d\'agents (.claude/agents).'}
${open ? `\nLes features en cours :\n${open}\n` : ''}
Une idée neuve qui n'est le travail d'aucun sujet ni d'aucune feature en cours devient une nouvelle feature.

Envoi à un sujet ou à une feature en cours, par exemple ${ENVOIS}/animation-saut.md :
pour: ${topics[0] ? topics[0].id : 'sujet-animation'}
---
La demande, complète : ce qu'ali a dit, ce que tu as déjà vérifié, les fichiers en cause, ce que tu attends en retour. La session ne voit pas ta discussion avec ali.

Nouvelle feature :
pour: nouvelle feature
titre: Lampe torche
sujets: ${topics.slice(0, 2).map(t => t.id).join(', ') || 'sujet-interface, sujet-items'}
---
L'idée, complète.

Un envoi par sujet : si une demande en touche deux, fais deux envois et dis à chacun ce que fait l'autre. Avant d'envoyer, regarde le suivi pour ne pas confier deux fois la même chose. Les sessions répondent au tableau, pour « Chef » : quand ali demande où en est quelque chose, lis le suivi, le tableau et le carnet du sujet.`;
}

function taskOf(topics, feats) {
  return { id: ID, title: 'Chef', text: 'Toutes tes demandes sur le jeu : il vérifie, te répond, et confie les changements aux sessions core ou à une nouvelle feature.', prompt: promptOf(topics, feats), readonly: false, chef: true };
}

// Un envoi : des lignes « cle: valeur », une ligne « --- », puis la demande.
function parse(raw) {
  const text = String(raw || '').replace(/^﻿/, '').replace(/\r/g, '');
  const cut = text.search(/^-{3,}\s*$/m);
  if (cut < 0) return { ok: false, error: 'Il manque la ligne « --- » entre l\'en-tête et la demande.' };
  const head = {};
  for (const line of text.slice(0, cut).split('\n')) {
    const m = /^\s*([A-Za-zÀ-ÿ ]{2,20}?)\s*:\s*(.*)$/.exec(line);
    if (m) head[m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()] = m[2].trim();
  }
  const body = text.slice(cut).replace(/^-{3,}\s*\n?/, '').trim().slice(0, MAX_TEXT);
  const pour = String(head.pour || '').trim();
  if (!pour) return { ok: false, error: 'Il manque « pour: » (le sujet, la feature, ou « nouvelle feature »).' };
  if (!body) return { ok: false, error: 'La demande est vide.' };
  if (/^nouvelle\s+feature$/i.test(pour) || /^feature$/i.test(pour)) {
    const title = one(head.titre || head.title, 60);
    if (!title) return { ok: false, error: 'Une nouvelle feature a besoin d\'un « titre: ».' };
    const touched = String(head.sujets || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    return { ok: true, envoi: { to: '', newFeature: true, title, sujets: touched, text: body } };
  }
  return { ok: true, envoi: { to: pour.toLowerCase(), newFeature: false, title: '', sujets: [], text: body } };
}

// Le message que recoit la session a qui le chef confie une demande.
function messageFor(e, fresh) {
  return `${fresh ? 'Lis d\'abord ton carnet et la fin du tableau (étapes 1 et 2 de ta consigne), puis traite cette demande au lieu de demander quoi faire.\n\n' : ''}Demande confiée par le chef de la tour (pour ali) :
${e.text}

Traite-la dans ton sujet, avec tes règles. Une question pour ali : pose-la dans ta réponse, il la lit dans la tour. Quand c'est fait, ajoute au tableau une ligne pour « Chef » : ce qui a été fait, ou ce qui bloque.`;
}

const STATE_TEXT = { working: 'travaille', idle: 'a fini', waiting: 'attend ali', ready: 'prête', ended: 'fermée', silent: 'silencieuse' };

// projectFor(nom) -> { name, root } ; prepare : lib/taches.js prepare (la consigne du sujet dans Saved/Tour).
function create(state, discussion, { projectFor, prepare, projects } = {}) {
  // l'etat peut etre recharge apres coup (state.load) : on relit state.chef a chaque fois
  const chef = () => {
    if (!state.chef || typeof state.chef !== 'object') state.chef = { ask: false, envois: [] };
    if (!Array.isArray(state.chef.envois)) state.chef.envois = [];
    return state.chef;
  };
  const failed = new Map(); // fichier -> mtime : un fichier qu'on n'a pu ni ranger ni effacer n'est pas relu
  const suiviText = new Map(); // projet -> dernier suivi ecrit

  const projectList = () => (projects ? projects() : state.projects || []).filter(p => p && p.root && p.name);
  const titleOf = (id) => {
    for (const v of Object.values(state.sujets)) { const t = v && v.topics && v.topics.find(x => x.id === id); if (t) return t.title; }
    const f = state.features.find(x => x.id === id);
    return f ? f.title : '';
  };
  // La session qui tient la salle d'un sujet ou d'une feature : la plus recente, ouverte et pas rangee.
  function liveOf(id) {
    let best = null;
    for (const a of Object.values(state.agents)) {
      if (!a.task || a.task.id !== id || a.status === 'ended' || a.hidden) continue;
      if (!best || a.lastSeen > best.lastSeen) best = a;
    }
    return best;
  }

  // Transmet un envoi : a la session qui tourne dans la tour, sinon une nouvelle session ; au tableau.
  function deliver(e) {
    const p = projectFor ? projectFor(e.project) : null;
    if (!p || !p.root) return Object.assign(e, { status: 'erreur', error: 'Projet introuvable.' });
    let id = e.to;
    if (e.newFeature) {
      const r = state.addFeature({ title: e.title, idea: e.text, sujets: e.sujets, project: p.name });
      if (!r.ok) return Object.assign(e, { status: 'erreur', error: r.error });
      id = e.to = r.feature.id;
    }
    e.toTitle = titleOf(id) || e.toTitle || id;
    const live = liveOf(id);
    if (live && discussion.canChat(live)) {
      const r = discussion.send(live.sessionId, messageFor(e, false));
      if (!r.ok) return Object.assign(e, { status: 'erreur', error: r.error });
      Object.assign(e, { status: 'envoyé', sessionId: live.sessionId, how: 'discussion' });
    } else if (live) {
      // ouverte dans sa fenetre : la tour ne peut pas y ecrire, le message attend au tableau
      Object.assign(e, { status: 'au tableau', sessionId: live.sessionId, how: 'fenetre' });
    } else {
      const r = prepare ? prepare({ id, project: p }) : { ok: false, error: 'Lancement impossible.' };
      if (!r.ok) return Object.assign(e, { status: 'erreur', error: r.error });
      // une nouvelle feature lit son idee dans sa consigne, puis propose un plan
      const s = discussion.start({ cwd: p.root, def: id, text: e.newFeature ? r.ask : `${r.ask}\n\n${messageFor(e, true)}` });
      if (!s.ok) return Object.assign(e, { status: 'erreur', error: s.error });
      Object.assign(e, { status: 'envoyé', sessionId: s.sessionId, how: 'lancee' });
    }
    sujets.post(p.root, { from: 'Chef', to: e.toTitle, text: `${e.newFeature ? 'nouvelle feature, ' : ''}${one(e.text, 300)}` });
    e.sentAt = state.now();
    return e;
  }

  // Un envoi lu dans un fichier : verifie, puis transmis (ou propose a ali s'il veut valider avant).
  function take(p, file, raw) {
    const r = parse(raw);
    const e = { id: `e${state.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: state.now(), project: p.name, file, status: 'erreur', to: '', toTitle: '', text: '', error: '' };
    if (!r.ok) e.error = r.error;
    else {
      Object.assign(e, r.envoi);
      const known = e.newFeature || sujets.isSujet(e.to) && titleOf(e.to) || features.isFeature(e.to) && titleOf(e.to);
      if (!known) e.error = `« ${e.to} » n'est ni un sujet ni une feature en cours.`;
      else if (chef().ask) Object.assign(e, { status: 'proposé', toTitle: e.newFeature ? `Nouvelle feature : ${e.title}` : titleOf(e.to) });
      else deliver(e);
    }
    const C = chef();
    C.envois.unshift(e);
    C.envois.length = Math.min(C.envois.length, MAX_KEEP);
    state.changed();
    return e;
  }

  // Les envois deposes par le chef dans chaque projet ; chaque fichier lu est range dans envoyes/.
  function scan() {
    const now = Date.now();
    for (const p of projectList()) {
      const dir = path.join(p.root, ...ENVOIS.split('/'));
      let names;
      try { names = fs.readdirSync(dir).filter(n => /\.(md|txt)$/i.test(n)).slice(0, 20); } catch { names = []; }
      for (const n of names) {
        const f = path.join(dir, n);
        let st, raw;
        try { st = fs.statSync(f); } catch { continue; }
        if (!st.isFile() || now - st.mtimeMs < 1500 || failed.get(f) === st.mtimeMs) continue; // encore en cours d'ecriture
        try { raw = st.size > MAX_FILE ? '' : fs.readFileSync(f, 'utf8'); } catch { continue; }
        try {
          const out = path.join(p.root, ...SENT.split('/'));
          fs.mkdirSync(out, { recursive: true });
          fs.renameSync(f, path.join(out, `${sujets.stamp().replace(/[: ]/g, '-')}-${n}`));
        } catch { try { fs.unlinkSync(f); } catch { failed.set(f, st.mtimeMs); } }
        take(p, n, st.size > MAX_FILE ? '' : raw);
      }
      writeSuivi(p);
    }
  }

  // Saved/Tour/chef/suivi.md : ou en est chaque envoi de ce projet, pour le chef.
  function writeSuivi(p) {
    const mine = chef().envois.filter(e => e.project === p.name);
    if (!mine.length && !suiviText.has(p.name)) return;
    const lines = mine.slice(0, 30).map(e => {
      const a = e.sessionId && state.agents[e.sessionId];
      const where = e.status === 'proposé' ? 'attend la validation d\'ali' : e.status === 'ignoré' ? 'ignoré par ali' : e.status === 'erreur' ? `erreur : ${e.error}` : e.status === 'au tableau' ? 'au tableau (la session tourne dans sa fenêtre)' : 'transmis';
      const st = a ? `, session ${STATE_TEXT[a.status] || a.status}${a.message ? ` : « ${one(a.message, 200)} »` : ''}` : '';
      return `- ${sujets.stamp(new Date(e.at))} · ${e.toTitle || e.to || '?'} : ${one(e.text, 160)} (${where}${st})`;
    });
    const text = `# Suivi des envois du chef\n\nÉcrit par la tour, ne pas modifier. Le plus récent en premier.\n\n${lines.join('\n') || 'Aucun envoi.'}\n`;
    if (suiviText.get(p.name) === text) return;
    try {
      fs.mkdirSync(path.join(p.root, ...DIR.split('/')), { recursive: true });
      fs.writeFileSync(path.join(p.root, ...SUIVI.split('/')), text, 'utf8');
      suiviText.set(p.name, text);
    } catch { /* projet en lecture seule : le chef lira le tableau */ }
  }

  // ali valide (go) ou ignore un envoi propose.
  function decide(id, go) {
    const e = chef().envois.find(x => x.id === id);
    if (!e) return { ok: false, error: 'Envoi introuvable.' };
    if (e.status !== 'proposé') return { ok: false, error: 'Cet envoi est déjà traité.' };
    if (go) deliver(e); else Object.assign(e, { status: 'ignoré', sentAt: state.now() });
    state.changed();
    return e.status === 'erreur' ? { ok: false, error: e.error } : { ok: true, envoi: e };
  }

  function setAsk(on) { chef().ask = !!on; state.changed(); return { ok: true, ask: chef().ask }; }

  return { scan, take, deliver, decide, setAsk, liveOf };
}

module.exports = { ID, DIR, ENVOIS, SUIVI, RULES, isChef, promptOf, taskOf, parse, messageFor, create };
