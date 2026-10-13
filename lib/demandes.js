'use strict';
// Le suivi des demandes : tout ce qu'ali envoie depuis la tour (une question au conseil, un message au
// chef ou a une salle, une tache lancee) devient une demande, suivie en direct jusqu'a son resultat.
// La page en fait une carte des qu'elle part ; finie, la carte garde la marque « nouveau » jusqu'a ce
// qu'ali l'ait ouverte.
//
// Une demande ne garde pas son etat a la main : la tour le relit a chaque changement dans ce qui la
// porte (la deliberation du conseil, le message de la discussion, la session de la tache, l'envoi du
// chef). Ce que le chef confie aux sessions pendant une demande devient une demande fille : la demande
// n'est finie que quand ses filles le sont.
//
// Le chef et les sessions la suivent aussi : la tour ecrit Saved/Tour/demandes.md dans chaque projet.
//
// La page en fait un tableau (a faire, en cours, t'attend, fini). Chaque carte a un resume ecrit par la
// tour a partir de ce que les agents rapportent (aucun appel de modele en plus), et des commentaires :
// celui d'ali part a l'agent qui travaille encore dessus (la conversation du chef pour une demande au
// chef), et sa reponse s'ajoute a la carte ; sans agent dessus, il reste une note.

const fs = require('fs');
const path = require('path');
const salles = require('./salles');
const featuresLib = require('./features');

const FILE = 'Saved/Tour/demandes.md';
const MAX = 60;           // demandes gardees (les plus anciennes finies partent d'abord)
const MAX_TEXT = 2000;
const MAX_PHASES = 12;
const LINK_MS = 5000;     // une tache lancee : sa session arrive dans la tour a quelques secondes pres
const SILENT_MS = 3 * 60_000;
const LOST_MS = 2 * 3600_000;
const MAX_NOTES = 40;     // commentaires et reponses gardes par demande
const MAX_NOTE = 2000;
const FINAL = new Set(['fini', 'erreur', 'arretee']);
const STATES = { envoyee: 'envoyée', 'en-cours': 'en cours', attend: 'attend ta réponse', fini: 'fini', erreur: 'erreur', arretee: 'arrêtée' };
const KINDS = { conseil: 'Conseil', chef: 'Chef', discussion: 'Discussion', tache: 'Tâche', envoi: 'Envoi du chef' };

const one = (s, n) => { s = String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const isFinal = (st) => FINAL.has(st);

// Ce que fait la session en ce moment, en mots : « lit Source/Porte.cpp », « 2 agents au travail ».
const VERBS = [
  [/^(Read|NotebookRead)$/, 'lit'], [/^(Grep|Glob|LS)$/, 'cherche'], [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'modifie'],
  [/^(Bash|PowerShell)$/, 'lance'], [/^(Agent|Task)$/, 'confie à un agent :'], [/^Web(Fetch|Search)$/, 'cherche en ligne'],
  [/^TodoWrite$/, 'fait sa liste'], [/^AskUserQuestion$/, 'te pose une question'],
];
function activity(a, now) {
  const subs = Object.keys(a.subagents || {}).length;
  const t = a.tool;
  let s = 'travaille';
  if (t && now - t.at < 2 * 60_000 && t.name) {
    const v = VERBS.find(([re]) => re.test(t.name));
    s = one(`${v ? v[1] : t.name}${t.summary ? ` ${t.summary}` : ''}`, 140);
  }
  if (subs) s += ` · ${subs > 1 ? `${subs} agents au travail` : '1 agent au travail'}`;
  return s;
}

// « Feature : <titre> » et « Mots : a, b » en fin de reponse du chef : la feature, et le texte sans ces lignes.
function featureLine(text) {
  const t = String(text || '');
  const m = /^[ \t>*_-]*feature[ \t*_]*:[ \t*_]*(.+?)[ \t*_]*$/im.exec(t);
  const w = /^[ \t>*_-]*mots(?:[- ]cl[ée]s)?[ \t*_]*:[ \t*_]*(.+?)[ \t*_]*$/im.exec(t);
  const strip = t.replace(/^[ \t>*_-]*(feature|mots(?:[- ]cl[ée]s)?)[ \t*_]*:.*$\n?/gim, '').trim();
  return { feature: m ? m[1].replace(/^[«"“\s]+|[»"”.\s]+$/g, '') : '', mots: w ? w[1] : '', text: strip || t };
}

// conseilRun(id) -> la deliberation ; envoiOf(id) -> l'envoi du chef ; busy(session) -> un message tourne ;
// canChat(session) -> on peut lui ecrire depuis la tour ; send(session, texte, { tag }) -> lib/discussion.js ;
// featureFor(projet, nom, { mots }) -> l'id de la feature de ce nom, creee au besoin (lib/chef.js).
function create(state, { conseilRun, envoiOf, busy, canChat, send, featureFor } = {}) {
  const list = () => { if (!Array.isArray(state.demandes)) state.demandes = []; return state.demandes; };
  const turns = new Map(); // tag -> { started, ended, error, result } : le message d'une discussion
  const written = new Map(); // projet -> dernier fichier ecrit
  const replies = new Map(); // tag d'un commentaire parti a un agent -> id de sa demande
  let seq = 0;

  const newTag = () => `d${state.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const find = (id) => list().find(d => d.id === id) || null;

  // Une nouvelle demande. ref : { conseil } | { tag, session } | { task, background } | { envoi, tag }.
  function add({ kind, to, text, project, ref, parent, id } = {}) {
    const t = state.now();
    const d = {
      id: id || newTag(), at: t, kind: KINDS[kind] ? kind : 'discussion', to: one(to, 60) || KINDS[kind] || 'Session',
      text: String(text || '').replace(/\r/g, '').trim().slice(0, MAX_TEXT), project: project || '', ref: { ...(ref || {}) },
      parent: parent || '', status: 'envoyee', phase: 'envoyée', live: '', phases: [{ at: t, text: 'envoyée' }],
      result: null, doneAt: 0, seenAt: 0, notes: [],
    };
    const all = list();
    // une demande qui repart (le verdict confie au chef) revient dans la barre jusqu'a sa nouvelle fin
    for (let up = find(d.parent), n = 0; up && n < 6; up = find(up.parent), n++) up.seenAt = 0;
    guessFeature(d);
    all.unshift(d);
    // les plus vieilles demandes finies partent, jamais une qui tourne encore
    while (all.length > MAX) {
      const i = all.map(x => isFinal(x.status)).lastIndexOf(true);
      if (i < 0) break;
      all.splice(i, 1);
    }
    update(d, t);
    state.changed();
    return d;
  }

  // Le debut et la fin d'un message de discussion (lib/discussion.js, onTurn).
  function turn({ tag, phase, error, result } = {}) {
    if (!tag) return;
    const t = state.now();
    if (replies.has(tag)) return noteTurn(tag, phase, error, result, t);
    const cur = turns.get(tag) || { started: 0, ended: 0, error: '', result: '' };
    if (phase === 'start') cur.started = cur.started || t;
    if (phase === 'end') Object.assign(cur, { started: cur.started || t, ended: t, error: error || '', result: String(result || '').trim().slice(0, 4000) });
    turns.set(tag, cur);
  }

  // ---- l'etat de chaque demande, relu dans ce qui la porte ---------------------------------------

  // Un message de discussion, ou une session suivie par sa tache.
  function fromTurn(d, now) {
    const fresh = turns.get(d.ref.tag);
    if (fresh) delete d.lost; // un message parti apres le redemarrage (un envoi valide plus tard)
    const tr = fresh || d.turn;
    if (tr) { d.turn = { ...tr }; if (tr.ended) turns.delete(d.ref.tag); }
    // la tour a redemarre pendant le message : son processus est parti avec elle
    if (d.lost && !(tr && tr.ended)) return { status: 'erreur', phase: 'interrompue : la tour a redémarré' };
    const a = d.ref.session && state.agents[d.ref.session];
    if (tr && tr.ended) {
      if (tr.error) return /arr[êe]t[ée] depuis la tour/i.test(tr.error) ? { status: 'arretee', phase: 'arrêtée depuis la tour' } : { status: 'erreur', phase: `erreur : ${one(tr.error, 200)}` };
      const full = tr.result || (a && a.message) || '';
      const tagged = featureLine(full);
      const text = tagged.text;
      return { status: 'fini', phase: 'fini', feature: tagged.feature, mots: tagged.mots, result: { text: one(text.split(/^[ \t]*#{1,4}[ \t]*suivi\b/im)[0] || text, 600), session: d.ref.session } };
    }
    if (!a) return { status: 'erreur', phase: 'la session a disparu de la tour' };
    if (tr && tr.started) {
      if (a.status === 'waiting') return { status: 'attend', phase: 'attend ta réponse', live: one(a.message, 200) };
      return { status: 'en-cours', phase: 'prise en charge', live: activity(a, now) };
    }
    return { status: 'envoyee', phase: 'envoyée', live: busy && busy(d.ref.session) ? 'en file : la session finit le message d\'avant' : 'part dans un instant' };
  }

  // Une tache lancee dans une fenetre ou en fond : la tour retrouve sa session a sa marque.
  function fromTask(d, now) {
    let a = d.ref.session && state.agents[d.ref.session];
    if (!a) {
      a = Object.values(state.agents).filter(x => x.task && x.task.id === d.ref.task && x.task.at >= d.at - LINK_MS).sort((x, y) => x.task.at - y.task.at)[0];
      if (a) d.ref.session = a.sessionId;
    }
    if (!a) {
      const age = now - d.at;
      if (age > LOST_MS) return { status: 'erreur', phase: 'la session n\'a jamais démarré' };
      const how = d.ref.background ? 'démarre en fond' : 'la fenêtre s\'ouvre';
      return { status: 'envoyee', phase: 'envoyée', live: age > SILENT_MS ? `pas encore de nouvelles de la session : ${d.ref.background ? 'Claude Code est-il installé ?' : 'la fenêtre s\'est-elle ouverte ?'}` : how };
    }
    const task = a.task && a.task.id === d.ref.task ? a.task : null;
    if (a.status === 'waiting') return { status: 'attend', phase: 'attend ta réponse', live: one(a.message, 200) };
    const done = task && task.doneAt && (a.status === 'idle' || a.status === 'ended');
    if (done) {
      const s = task.suivi;
      return { status: 'fini', phase: 'fini', result: { text: one(a.message, 600), file: s && s.rapport || '', questions: s ? s.questions.slice(0, 4) : [], session: a.sessionId } };
    }
    if (a.status === 'ended') return { status: 'arretee', phase: 'session fermée avant la fin' };
    return { status: 'en-cours', phase: 'prise en charge', live: a.status === 'ready' ? 'démarre' : activity(a, now) };
  }

  // Une deliberation du conseil (lib/conseil.js).
  function fromConseil(d) {
    const r = conseilRun ? conseilRun(d.ref.conseil) : null;
    if (!r) return { status: 'erreur', phase: 'délibération introuvable' };
    const steps = { cadrage: 'cadre la question', avis: 'les membres réfléchissent', revue: 'relecture croisée', president: 'le président tranche' };
    if (r.step === 'fini') return { status: 'fini', phase: 'verdict rendu', result: { text: r.decision || one(r.verdict, 400), file: r.file || '' } };
    if (r.step === 'erreur') return { status: 'erreur', phase: `erreur : ${one(r.error, 200)}` };
    if (r.step === 'arrete') return { status: 'arretee', phase: r.note ? one(r.note, 120) : 'arrêté' };
    const members = Object.values(r.members || {});
    const live = r.step === 'avis' ? `${members.filter(m => m.avis).length} avis sur ${members.length}` : '';
    return { status: 'en-cours', phase: steps[r.step] || 'délibère', live };
  }

  // Un envoi du chef (lib/chef.js) : propose, ignore, au tableau, ou transmis a une discussion.
  function fromEnvoi(d, now) {
    const e = envoiOf ? envoiOf(d.ref.envoi) : null;
    if (!e) return { status: 'erreur', phase: 'envoi introuvable' };
    if (e.status === 'proposé') return { status: 'attend', phase: 'attend ta validation', live: 'dans la conversation du Chef : Envoyer ou Ignorer' };
    if (e.status === 'ignoré') return { status: 'arretee', phase: 'ignoré' };
    if (e.status === 'erreur') return { status: 'erreur', phase: `erreur : ${one(e.error, 200)}` };
    if (e.sessionId && !d.ref.session) d.ref.session = e.sessionId;
    // la reponse de la session au tableau, pour « Chef », vaut resultat
    const reply = boardReply(d, e);
    if (e.status === 'au tableau') {
      return reply ? { status: 'fini', phase: 'réponse au tableau', result: { text: reply, session: e.sessionId } }
        : { status: 'attend', phase: 'au tableau', live: 'sa session tourne dans sa fenêtre : dis-lui de lire le tableau' };
    }
    const r = fromTurn(d, now);
    if (reply && r.result) r.result.text = reply;
    return r;
  }
  function boardReply(d, e) {
    const v = state.sujets && state.sujets[d.project];
    const lines = (v && v.board && v.board.entries) || [];
    const from = String(e.toTitle || '').toLowerCase();
    const since = e.sentAt || d.at;
    const pad = (n) => String(n).padStart(2, '0');
    const dt = new Date(since - 60_000);
    const min = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    const hit = lines.filter(l => l.from.toLowerCase() === from && /^chef$/i.test(l.to) && (!l.when || l.when.replace('T', ' ') >= min)).pop();
    return hit ? one(hit.text, 600) : '';
  }

  function update(d, now) {
    if (isFinal(d.status)) return false;
    const r = d.ref.conseil ? fromConseil(d) : d.ref.envoi ? fromEnvoi(d, now) : d.ref.task ? fromTask(d, now) : d.ref.tag ? fromTurn(d, now) : { status: 'erreur', phase: 'demande sans suivi' };
    const before = JSON.stringify([d.status, d.phase, d.live, d.result, d.ref, d.feature]);
    linkFeature(d, r);
    // de retour au travail apres une reponse d'ali : « reprend », pas une seconde prise en charge
    if (r.phase === 'prise en charge' && d.phase !== r.phase && d.phases.some(p => p.text === r.phase)) r.phase = 'reprend';
    d.status = r.status;
    d.live = r.live || '';
    if (r.result) d.result = r.result;
    if (r.phase !== d.phase) {
      d.phase = r.phase;
      d.phases = [...(d.phases || []), { at: now, text: r.phase }].slice(-MAX_PHASES);
    }
    if (isFinal(d.status)) { d.doneAt = now; d.live = ''; }
    return JSON.stringify([d.status, d.phase, d.live, d.result, d.ref, d.feature]) !== before;
  }

  // ---- la feature d'une demande : le chef la nomme ------------------------------------------------
  // Dans un envoi (« feature: », ou un envoi a une feature), ou en derniere ligne de sa reponse
  // (« Feature : <titre> »). La demande d'ali qui a mene a l'envoi passe dans la meme feature.
  function linkFeature(d, r) {
    let id = '';
    if (d.ref.envoi) { const e = envoiOf ? envoiOf(d.ref.envoi) : null; id = (e && e.featureId) || ''; }
    else if (r && r.feature && featureFor) id = featureFor(d.project, r.feature, { mots: r.mots }) || '';
    if (!id) return;
    // ce que le chef dit passe avant ce que les mots-cles avaient devine
    if (!d.feature || d.featureBy === 'mots') { d.feature = id; d.featureBy = 'chef'; }
    for (let up = find(d.parent), n = 0; up && n < 6; up = find(up.parent), n++) if (!up.feature || up.featureBy === 'mots') { up.feature = id; up.featureBy = 'chef'; }
  }
  // Une demande que personne n'a encore rangee : la feature dont elle parle (son titre ou ses mots-cles).
  function guessFeature(d) {
    if (d.feature || d.parent || !Array.isArray(state.features)) return false;
    const f = state.features.find(x => !x.doneAt && (!x.project || !d.project || x.project === d.project) && featuresLib.mentions(x, d.text));
    if (!f) return false;
    d.feature = f.id; d.featureBy = 'mots';
    return true;
  }

  // Relit chaque demande en cours. Appele a chaque changement de l'etat : ne previent personne lui-meme.
  function refresh() {
    const now = state.now();
    let moved = false;
    for (const d of list()) if (update(d, now)) moved = true;
    // une feature nouvelle (creee par le chef, ou une tache perso) range les demandes d'avant qui la nomment
    const fs_ = Array.isArray(state.features) ? state.features : [];
    const sig = fs_.map(f => `${f.id}:${(f.mots || []).length}:${f.doneAt ? 1 : 0}`).join('|');
    if (sig !== featSig) { featSig = sig; for (const d of list()) if (guessFeature(d)) moved = true; }
    return moved;
  }
  let featSig = '';

  // ---- les cartes des features : tout ce qui touche une feature, au meme endroit ------------------
  const FEATURE_DONE_DAYS = 7;
  // La session d'une feature encore au travail (ou qui attend ali).
  const sessionOf = (fid) => Object.values(state.agents || {}).filter(a => a && a.task && a.task.id === fid && (a.status === 'working' || a.status === 'waiting'))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))[0] || null;
  function featureCards() {
    const roots = tree();
    const now = state.now();
    const notesOf = (id) => (state.featureNotes && state.featureNotes[id]) || null;
    const pastOf = (id) => (state.featurePast && state.featurePast[id]) || [];
    return (Array.isArray(state.features) ? state.features : [])
      .filter(f => !f.doneAt || now - f.doneAt < FEATURE_DONE_DAYS * 86400_000)
      .map(f => {
        const mine = roots.filter(n => n.feature === f.id);
        const live = mine.filter(n => !isFinal(n.state));
        const wait = live.find(n => n.state === 'attend');
        const run = live.find(n => n.state !== 'attend');
        // la session de la feature elle-meme, quand ali l'a lancee
        const own = sessionOf(f.id);
        const ownWait = own && own.status === 'waiting', ownRun = own && !ownWait;
        const ownLive = own ? `Session ${f.title} : ${own.message || (ownWait ? 'attend ta réponse' : 'travaille')}` : '';
        const st = f.doneAt ? 'fini' : wait || ownWait ? 'attend' : run || ownRun ? 'en-cours' : 'repos';
        const cn = notesOf(f.id);
        const past = pastOf(f.id);
        const comments = f.comments || [];
        const at = Math.max(0, ...mine.map(n => Math.max(n.at, n.doneAt || 0, ...(n.notes || []).map(c => c.at))), ...past.map(x => x.at), ...comments.map(c => c.at)) || f.createdAt || 0;
        const lastDone = mine.filter(n => n.result && n.result.text).sort((a, b) => (b.ownDoneAt || b.doneAt) - (a.ownDoneAt || a.doneAt))[0];
        const out = [];
        if (st === 'attend') out.push(wait ? `Ça t'attend : ${wait.to} — ${wait.live || wait.phase}.` : `Ça t'attend : ${one(ownLive, 240)}.`);
        else if (st === 'en-cours') out.push(run ? `${run.who || run.to} y travaille${/^(travaille|prise en charge)$/.test(run.live || run.phase) ? '' : ` : ${run.live || run.phase}`}.` : `${one(ownLive, 240)}.`);
        else if (st === 'fini') out.push('Terminée.');
        else out.push('Personne n\'y travaille en ce moment.');
        if (cn && cn.where) out.push(`Où on en est (son carnet) : ${one(cn.where, 300)}`);
        if (lastDone) out.push(`Dernière réponse (${lastDone.to}) : ${one(String(lastDone.result.text).replace(/\*\*/g, ''), 260)}`);
        else if (past.length) { const x = past[past.length - 1]; out.push(`Dernière trace (${x.who}) : ${one(x.text, 220)}`); }
        if (cn && cn.next) out.push(`Prochaines étapes : ${one(cn.next, 260)}`);
        out.push(`${mine.length ? `${mine.length > 1 ? `${mine.length} demandes` : 'Une demande'} suivie${mine.length > 1 ? 's' : ''}` : 'Aucune demande suivie'}${past.length ? `, ${past.length} trace${past.length > 1 ? 's' : ''} d'avant retrouvée${past.length > 1 ? 's' : ''}` : ''}.`);
        const target = live.map(commentTarget).find(Boolean) || (own && canChat && canChat(own.sessionId) ? { to: `la session ${f.title}` } : null);
        return {
          id: `f:${f.id}`, feature: f.id, kind: 'feature', title: f.title, to: f.title, text: f.idea, project: f.project, by: f.by || '', mots: f.mots || [],
          state: st, stateText: { fini: 'terminée', attend: STATES.attend, 'en-cours': 'en cours', repos: 'à reprendre' }[st],
          at, createdAt: f.createdAt || 0, doneAt: f.doneAt || 0, live: wait ? `${wait.to} : ${wait.live || wait.phase}` : run ? `${run.to} : ${run.live || run.phase}` : ownLive,
          demandes: mine.map(n => n.id), past, comments, carnet: cn, summary: out, commentTo: target ? target.to : '',
          seenAt: f.seenAt || 0,
        };
      })
      .sort((a, b) => b.at - a.at);
  }

  // Un commentaire sur une carte de feature : a l'agent qui travaille sur une de ses demandes, sinon une
  // note sur la feature (le chef la lit dans demandes.md).
  function commentFeature(fid, text) {
    const f = (state.features || []).find(x => x.id === fid);
    if (!f) return { ok: false, error: 'Feature introuvable.' };
    const t = String(text || '').replace(/\r/g, '').trim().slice(0, MAX_NOTE);
    if (!t) return { ok: false, error: 'Le commentaire est vide.' };
    const run = tree().filter(n => n.feature === fid && !isFinal(n.state)).find(n => commentTarget(n));
    if (run) return comment(run.id, t);
    const note = { at: state.now(), who: 'ali', text: t, to: '' };
    // sinon la session de la feature, si elle tourne dans la tour : sa reponse reste dans sa conversation
    const own = sessionOf(fid);
    if (own && send && canChat && canChat(own.sessionId)) {
      const r = send(own.sessionId, `Commentaire d'ali sur la feature « ${f.title} » :\n\n${t}`, { tag: newTag() });
      if (r && r.ok) note.to = `la session ${f.title}`;
    }
    f.comments = [...(f.comments || []), note].slice(-MAX_NOTES);
    state.changed();
    return { ok: true, to: note.to };
  }

  // Les demandes rangees en arbre, avec l'etat d'ensemble : une demande qui a des filles en cours est en cours.
  function tree() {
    const all = list();
    const kids = new Map();
    for (const d of all) if (d.parent) { if (!kids.has(d.parent)) kids.set(d.parent, []); kids.get(d.parent).push(d); }
    const node = (d, depth) => {
      const children = depth < 4 ? (kids.get(d.id) || []).slice().sort((x, y) => x.at - y.at).map(k => node(k, depth + 1)) : [];
      let st = d.status, live = d.live, who = '';
      const waiting = children.find(c => c.state === 'attend');
      const running = children.find(c => !isFinal(c.state));
      if (d.status !== 'attend' && waiting) { st = 'attend'; who = waiting.who || waiting.to; live = `${waiting.to} : ${waiting.phase === 'attend ta validation' ? 'attend ta validation dans la conversation du Chef' : waiting.live || waiting.phase}`; }
      else if (isFinal(d.status) && running) { st = 'en-cours'; who = running.who || running.to; live = `${running.to} : ${running.live || running.phase}`; }
      const doneAt = isFinal(st) ? Math.max(d.doneAt || 0, ...children.map(c => c.doneAt || 0)) : 0;
      // un envoi du chef a valider attend ali dans le batiment du chef, pas une reponse
      const w = d.status === 'attend' ? d : waiting;
      const valid = st === 'attend' && w && (w.phase === 'attend ta validation' || w.stateText === 'attend ta validation');
      const n = { ...d, ownDoneAt: d.doneAt || 0, notes: d.notes || [], state: st, stateText: valid ? 'attend ta validation' : STATES[st], live, who, doneAt, children };
      n.summary = summaryOf(n);
      const target = commentTarget(n);
      n.commentTo = target ? target.to : '';
      return n;
    };
    const known = new Set(all.map(d => d.id));
    return all.filter(d => !d.parent || !known.has(d.parent)).map(d => node(d, 0));
  }

  // ali a vu une demande finie : elle quitte la barre (elle reste dans la liste).
  function seen(id) {
    const all = id ? [find(id)].filter(Boolean) : list();
    let n = 0;
    for (const d of all) if (!d.seenAt && isFinal(d.status)) { d.seenAt = state.now(); n++; }
    if (id && !all.length) return { ok: false, error: 'Demande introuvable.' };
    if (n) state.changed();
    return { ok: true, n };
  }

  // Les envois du chef pendant une de ses demandes : des demandes filles (lib/chef.js, onEnvoi).
  function onEnvoi(e, tag) {
    if (!e || list().some(d => d.ref.envoi === e.id)) return null;
    const chefs = list().filter(d => d.kind === 'chef' && d.project === e.project && d.at <= e.at);
    // la plus recente demande au chef encore en cours, ou finie juste avant (la tour lit les envois toutes les 10 s)
    const parent = chefs.find(d => !isFinal(d.status) || (d.doneAt && e.at - d.doneAt < 2 * 60_000));
    return add({ kind: 'envoi', to: e.toTitle || e.to || 'Session', text: e.text, project: e.project, parent: parent ? parent.id : '', ref: { envoi: e.id, tag } });
  }

  // ---- les commentaires d'ali ---------------------------------------------------------------------

  // L'agent qui recoit un commentaire : la demande elle-meme si elle tourne encore et qu'on peut ecrire
  // a sa session depuis la tour, sinon la premiere demande fille dans ce cas (le chef a qui le verdict
  // du conseil est confie). Personne : le commentaire reste une note.
  function commentTarget(n) {
    if (!n || isFinal(n.state)) return null;
    if (n.ref && n.ref.session && canChat && canChat(n.ref.session)) return { session: n.ref.session, to: n.to };
    for (const k of n.children || []) { const t = commentTarget(k); if (t) return t; }
    return null;
  }
  const nodeOf = (id) => {
    const walk = (l) => { for (const n of l) { if (n.id === id) return n; const k = walk(n.children); if (k) return k; } return null; };
    return walk(tree());
  };

  function comment(id, text) {
    const d = find(id);
    if (!d) return { ok: false, error: 'Demande introuvable.' };
    const t = String(text || '').replace(/\r/g, '').trim().slice(0, MAX_NOTE);
    if (!t) return { ok: false, error: 'Le commentaire est vide.' };
    const target = commentTarget(nodeOf(id));
    const note = { at: state.now(), who: 'ali', text: t, to: '' };
    if (target && send) {
      const tag = newTag();
      const r = send(target.session, `Commentaire d'ali sur sa demande « ${one(d.text, 160)} » (suivie dans ${FILE}) :\n\n${t}`, { tag });
      if (r && r.ok) { Object.assign(note, { to: target.to, session: target.session, tag, pending: true }); replies.set(tag, d.id); }
    }
    d.notes = [...(d.notes || []), note].slice(-MAX_NOTES);
    state.changed();
    return { ok: true, to: note.to };
  }

  // La reponse de l'agent a un commentaire : elle s'ajoute a la carte.
  function noteTurn(tag, phase, error, result, t) {
    const d = find(replies.get(tag));
    const n = d && (d.notes || []).find(x => x.tag === tag);
    if (!n) { replies.delete(tag); return; }
    if (phase === 'start') { n.started = t; state.changed(); return; }
    if (phase !== 'end') return;
    replies.delete(tag);
    n.pending = false;
    const text = String(result || '').trim();
    const reply = error ? { at: t, who: 'agent', name: n.to, text: /arr[êe]t[ée] depuis la tour/i.test(error) ? 'Arrêté avant de répondre.' : `Erreur : ${one(error, 300)}`, error: true }
      : { at: t, who: 'agent', name: n.to, text: (text.split(/^[ \t]*#{1,4}[ \t]*suivi\b/im)[0] || text).trim().slice(0, MAX_NOTE) || '(réponse vide)' };
    d.notes = [...d.notes, reply].slice(-MAX_NOTES);
    state.changed();
  }

  // ---- le resume d'une carte, ecrit par la tour avec ce que les agents rapportent ------------------
  // le texte des agents est du markdown : le resume le lit en clair
  const plain = (t, n) => one(String(t || '').replace(/\*\*|__|`/g, '').replace(/^[ \t]*#{1,6}[ \t]+/gm, ''), n);
  function summaryOf(n) {
    const out = [];
    const kids = n.children || [];
    const own = n.status;
    if (n.state === 'envoyee') out.push(`Envoyée à ${n.to}, pas encore prise en charge${n.live ? ` : ${n.live}` : ''}.`);
    else if (n.state === 'attend') out.push(`Ça t'attend : ${n.live || n.phase}.`);
    else if (n.state === 'en-cours') {
      const doing = n.live && n.live !== 'travaille' ? n.live : '';
      out.push(isFinal(own) ? `${n.to} a répondu ; ${n.live || 'le travail continue'}.` : `${n.to} y travaille${doing ? ` : ${doing}` : n.phase && n.phase !== 'prise en charge' ? ` : ${n.phase}` : ''}.`);
    } else if (n.state === 'fini') out.push(n.ref && n.ref.conseil ? 'Le conseil a tranché.' : `${n.to} a fini.`);
    else if (n.state === 'erreur') out.push(`Arrêtée sur une erreur : ${n.phase.replace(/^erreur : /, '')}.`);
    else out.push(`Arrêtée (${n.phase}).`);
    if (kids.length) {
      const list = kids.map(k => `${k.to} (${k.stateText})`).join(', ');
      out.push(`${n.to} a confié ${kids.length > 1 ? `${kids.length} envois` : 'un envoi'} : ${list}.`);
    }
    const res = n.result && n.result.text;
    if (res) out.push(`${n.ref && n.ref.conseil ? 'Décision' : 'Réponse'} : ${plain(res, 320)}`);
    for (const k of kids) if (k.result && k.result.text) out.push(`Réponse de ${k.to} : ${plain(k.result.text, 200)}`);
    const notes = n.notes || [];
    const mine = notes.filter(x => x.who === 'ali'), waiting = mine.filter(x => x.pending);
    const last = notes.filter(x => x.who === 'agent').pop();
    if (last) out.push(`Dernière réponse à tes commentaires (${last.name}) : ${plain(last.text, 200)}`);
    if (mine.length) out.push(`${mine.length > 1 ? `${mine.length} commentaires de toi` : 'Un commentaire de toi'}${waiting.length ? `, ${waiting.length > 1 ? `${waiting.length} attendent` : 'un attend'} sa réponse` : ''}.`);
    const q = n.result && n.result.questions && n.result.questions.length;
    if (q) out.push(`${q > 1 ? `${q} questions` : 'Une question'} pour toi dans son rapport.`);
    return out;
  }

  // ---- Saved/Tour/demandes.md, pour le chef et les sessions --------------------------------------
  function stamp(t) {
    const d = new Date(t), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fileText(project) {
    const lines = [];
    const put = (n, depth) => {
      const res = n.result && n.result.text ? ` Résultat : ${one(n.result.text, 300)}` : '';
      const file = n.result && n.result.file ? ` (${n.result.file})` : '';
      lines.push(`${'  '.repeat(depth)}- ${stamp(n.at)} · ${n.to} · ${STATES[n.status]}${n.status === 'erreur' || n.status === 'arretee' ? ` (${n.phase})` : n.status === 'en-cours' ? ` (${n.phase})` : ''} : « ${one(n.text, 200)} »${res}${file}`);
      for (const c of n.notes) lines.push(`${'  '.repeat(depth + 1)}> ${stamp(c.at)} · ${c.who === 'ali' ? `ali${c.to ? ` à ${c.to}` : ' (note)'}` : c.name} : « ${one(c.text, 300)} »`);
      for (const k of n.children) put(k, depth + 1);
    };
    const feats = featureCards().filter(f => !f.project || f.project === project);
    const titleOf = new Map(feats.map(f => [f.feature, f.title]));
    for (const n of tree().filter(x => x.project === project).slice(0, 30)) {
      const at = lines.length;
      put(n, 0);
      if (n.feature && titleOf.has(n.feature)) lines[at] += ` [feature : ${titleOf.get(n.feature)}]`;
    }
    const fl = feats.map(f => [
      `- ${f.title} · ${f.stateText}${f.mots.length ? ` · mots : ${f.mots.join(', ')}` : ''}${f.carnet && f.carnet.where ? ` · ${one(f.carnet.where, 200)}` : ''}`,
      ...f.comments.map(c => `  > ${stamp(c.at)} · ali (note) : « ${one(c.text, 300)} »`)].join('\n'));
    return `# Les demandes d'ali\n\nÉcrit par la tour, ne pas modifier. Ce qu'ali a envoyé depuis la tour (au conseil, au chef, à une salle, une tâche), où chaque demande en est et son résultat. Le plus récent en premier ; en retrait, ce qui a été confié pendant la demande ; après « > », les commentaires d'ali et les réponses.\n\n## Les features\n\nChaque demande se range dans une feature (le chef la nomme en dernière ligne : « Feature : <titre> »).\n\n${fl.join('\n') || 'Aucune feature.'}\n\n## Les demandes\n\n${lines.join('\n') || 'Aucune demande.'}\n`;
  }
  function writeFiles(projects) {
    for (const p of projects || []) {
      if (!p || !p.root || !p.name) continue;
      if (!list().some(d => d.project === p.name) && !(state.features || []).some(f => f.project === p.name) && !written.has(p.name)) continue;
      const text = fileText(p.name);
      if (written.get(p.name) === text) continue;
      try {
        fs.mkdirSync(path.join(p.root, 'Saved', 'Tour'), { recursive: true });
        fs.writeFileSync(path.join(p.root, ...FILE.split('/')), text, 'utf8');
        written.set(p.name, text);
      } catch { /* projet en lecture seule : la page suffit */ }
    }
  }

  // Le nom de la salle d'une session, pour « a qui ».
  const roomOf = (sessionId) => salles.salleOf(state.agents[sessionId]) || 'Session';

  // ali a vu une feature terminee
  function seenFeature(fid) {
    const f = (state.features || []).find(x => x.id === fid);
    if (!f) return { ok: false, error: 'Feature introuvable.' };
    f.seenAt = state.now(); state.changed();
    return { ok: true };
  }

  return { add, turn, refresh, tree, seen, comment, commentFeature, seenFeature, featureCards, onEnvoi, newTag, find, roomOf, fileText, writeFiles };
}

// Au redemarrage de la tour : un message de discussion en cours est parti avec l'ancienne tour.
function restore(saved) {
  const all = Array.isArray(saved) ? saved.filter(d => d && d.id && d.ref).slice(0, MAX) : [];
  // marquee « perdue » : relue, elle passe en erreur (un envoi reste au tableau s'il y etait)
  for (const d of all) if (!isFinal(d.status) && d.ref.tag && !(d.turn && d.turn.ended)) d.lost = true;
  // un commentaire parti a un agent : sa reponse est partie avec l'ancienne tour
  for (const d of all) for (const n of d.notes || []) if (n.pending) { n.pending = false; n.lost = true; }
  return all;
}

module.exports = { FILE, STATES, KINDS, activity, create, restore, featureLine };
