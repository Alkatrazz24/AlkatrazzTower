'use strict';
// Le suivi des demandes (lib/demandes.js) : ce qu'ali envoie depuis la tour, suivi jusqu'a son resultat.
// Claude Code est remplace par un faux (aucune session lancee).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { TowerState } = require('../server/state');
const sujets = require('../lib/sujets');
const chefLib = require('../lib/chef');
const taches = require('../lib/taches');
const D = require('../lib/demandes');

const TEAM = [{ name: 'ctb-animation', section: 'Animation' }, { name: 'ctb-interface', section: 'Interface' }];

// Une tour avec un projet sur disque, une fausse discussion, le chef et le suivi branches comme dans le serveur.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-demandes-'));
  let t = Date.UTC(2026, 9, 12, 13, 0, 0);
  const s = new TowerState(() => t);
  const p = { name: 'CTB', root };
  s.projects = [p];
  s.setSujets('CTB', { project: 'CTB', topics: sujets.topicsOf(TEAM), board: { at: 0, entries: [] } });
  const runs = [], kids = [];
  const run = (args, cwd, input) => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); runs.push({ args, cwd, input }); kids.push(c); return c; };
  let dm = null;
  const d = require('../lib/discussion').create(s, { run, onTurn: (e) => dm.turn(e) });
  dm = D.create(s, {
    conseilRun: (id) => ((s.conseil && s.conseil.runs) || []).find(r => r.id === id),
    envoiOf: (id) => s.chef.envois.find(e => e.id === id),
    busy: (sid) => d.busy(sid),
    canChat: (sid) => d.canChat(s.agents[sid]),
    send: (sid, text, o) => d.send(sid, text, o),
  });
  s.demandesView = dm.tree;
  s.onChange(() => dm.refresh());
  const tk = taches.create(s);
  const chef = chefLib.create(s, d, { projectFor: () => p, prepare: (o) => tk.prepare(o), onEnvoi: (e, tag) => dm.onEnvoi(e, tag) });
  // la fin d'un message : la ligne « result » de claude -p, puis le processus se ferme
  const finish = (k, text, code = 0) => { kids[k].stdout.emit('data', JSON.stringify({ type: 'result', is_error: false, result: text }) + '\n'); kids[k].emit('close', code); };
  const drop = (name, body) => {
    const dir = path.join(root, 'Saved', 'Tour', 'chef', 'envois');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, body, 'utf8');
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(f, old, old);
  };
  const one = (id) => s.snapshot().demandes.find(x => x.id === id);
  return { s, p, root, d, dm, chef, runs, kids, finish, drop, one, tick: (ms) => { t += ms; s.changed(); }, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// Un message a une salle, comme la route /api/chat/send.
function say(env, sid, text) {
  const tag = env.dm.newTag();
  const r = env.d.send(sid, text, { tag });
  assert.ok(r.ok, r.error);
  const a = env.s.agents[sid];
  const isChef = !!(a.task && a.task.id === 'chef');
  return env.dm.add({ id: tag, kind: isChef ? 'chef' : 'discussion', to: isChef ? 'Chef' : env.dm.roomOf(sid), text, project: a.project ? a.project.name : 'CTB', ref: { tag, session: sid } });
}

test('discussion : la demande part, est prise en charge, attend ali, reprend, puis finit avec la reponse', () => {
  const env = setup();
  const { s, d, dm, kids, finish, one, done } = env;
  const st = d.start({ cwd: env.root, text: 'Tache de la tour [sujet-interface] : lis la consigne', def: 'sujet-interface' });
  kids[0].emit('close', 0);
  const x = say(env, st.sessionId, 'Le HUD cache la barre de stamina, tu peux regarder ?');
  assert.ok(x.to); // le nom de la salle
  let v = one(x.id);
  assert.strictEqual(v.state, 'en-cours');
  assert.strictEqual(v.phase, 'prise en charge');
  // la session lit un fichier : la barre le dit
  s.event({ session_id: st.sessionId, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:/CTB/Source/HUD/StaminaBar.cpp' } });
  assert.match(one(x.id).live, /^lit HUD\/StaminaBar\.cpp/);
  // une autorisation demandee dans la tour : la demande attend ali
  const ask = s.openAsk({ sessionId: st.sessionId, kind: 'permission', tool: 'Edit', summary: 'StaminaBar.cpp' });
  v = one(x.id);
  assert.strictEqual(v.state, 'attend');
  assert.strictEqual(v.stateText, 'attend ta réponse');
  assert.match(v.live, /Autorisation : Edit/);
  s.answerAsk(ask, { decision: 'allow' });
  assert.strictEqual(one(x.id).phase, 'reprend');
  finish(1, 'La barre passait sous le HUD : je l\'ai remontee.\n\n## Suivi\nFait :\n- remontee');
  v = one(x.id);
  assert.strictEqual(v.state, 'fini');
  assert.strictEqual(v.result.text, 'La barre passait sous le HUD : je l\'ai remontee.');
  assert.deepStrictEqual(v.phases.map(p => p.text), ['envoyée', 'prise en charge', 'attend ta réponse', 'reprend', 'fini']);
  assert.ok(v.doneAt);
  // vue : elle quitte la barre (seenAt), reste dans la liste
  assert.ok(dm.seen(x.id).ok);
  assert.ok(one(x.id).seenAt);
  done();
});

test('discussion : un message en file attend son tour ; arreter la session arrete aussi ce qui etait en file', () => {
  const env = setup();
  const { d, kids, one, done } = env;
  const st = d.start({ cwd: env.root, text: 'premier', def: 'sujet-animation' });
  const a = say(env, st.sessionId, 'deuxieme');
  assert.strictEqual(one(a.id).state, 'envoyee');
  assert.match(one(a.id).live, /en file/);
  const b = say(env, st.sessionId, 'troisieme');
  d.stop(st.sessionId);
  kids[0].emit('close', 1);
  assert.strictEqual(one(a.id).state, 'arretee');
  assert.strictEqual(one(b.id).state, 'arretee');
  done();
});

test('conseil : la demande suit les etapes de la deliberation et finit sur la decision et son fichier', () => {
  const env = setup();
  const { s, dm, one, done } = env;
  const run = { id: 'c1', step: 'cadrage', question: 'Lampe : batterie ou infinie ?', members: { a: { avis: '' }, b: { avis: '' } }, decision: '', file: '' };
  s.conseil = { runs: [run] };
  const x = dm.add({ kind: 'conseil', to: 'Conseil', text: run.question, project: 'CTB', ref: { conseil: 'c1' } });
  assert.strictEqual(one(x.id).phase, 'cadre la question');
  run.step = 'avis'; run.members.a.avis = 'oui';
  env.tick(1000);
  assert.strictEqual(one(x.id).phase, 'les membres réfléchissent');
  assert.strictEqual(one(x.id).live, '1 avis sur 2');
  run.step = 'fini'; run.decision = 'Batterie à recharger.'; run.file = 'Saved/Tour/conseil/lampe.md';
  env.tick(1000);
  const v = one(x.id);
  assert.strictEqual(v.state, 'fini');
  assert.deepStrictEqual(v.result, { text: 'Batterie à recharger.', file: 'Saved/Tour/conseil/lampe.md' });
  assert.deepStrictEqual(v.phases.map(p => p.text), ['envoyée', 'cadre la question', 'les membres réfléchissent', 'verdict rendu']);
  done();
});

test('chef : ses envois pendant la demande en sont les filles ; la demande reste en cours tant qu\'une fille travaille', () => {
  const env = setup();
  const { s, d, dm, chef, kids, finish, drop, one, root, done } = env;
  // le verdict du conseil confie au chef : la demande du conseil, vue, revient dans la barre
  s.conseil = { runs: [{ id: 'c1', step: 'fini', question: 'Q', members: {}, decision: 'Oui.', file: '' }] };
  const conseil = dm.add({ kind: 'conseil', to: 'Conseil', text: 'Q', project: 'CTB', ref: { conseil: 'c1' } });
  dm.seen(conseil.id);
  assert.ok(one(conseil.id).seenAt);
  const tag = dm.newTag();
  const st = d.start({ cwd: root, text: 'Tache de la tour [chef] : lis la consigne', def: 'chef', tag });
  s.event({ session_id: st.sessionId, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [chef] : lis la consigne' });
  const x = dm.add({ id: tag, kind: 'chef', to: 'Chef', text: 'Mettre en œuvre : Oui.', project: 'CTB', parent: conseil.id, ref: { tag, session: st.sessionId } });
  assert.strictEqual(one(conseil.id).seenAt, 0);
  assert.strictEqual(one(conseil.id).state, 'en-cours');
  // pendant sa reponse, le chef confie le travail au sujet Animation
  drop('saut.md', 'pour: sujet-animation\n---\nLe saut ne joue pas son animation.');
  chef.scan();
  finish(0, 'J\'ai confié le saut à Animation.');
  const v = one(conseil.id);
  const chefNode = v.children[0];
  assert.strictEqual(chefNode.id, x.id);
  assert.strictEqual(chefNode.status, 'fini');
  assert.strictEqual(chefNode.children.length, 1);
  const envoi = chefNode.children[0];
  assert.strictEqual(envoi.kind, 'envoi');
  assert.strictEqual(envoi.to, 'Animation');
  assert.strictEqual(envoi.state, 'en-cours');
  // le chef a fini, sa fille non : tout reste en cours, et dit qui travaille
  assert.strictEqual(chefNode.state, 'en-cours');
  assert.strictEqual(v.state, 'en-cours');
  assert.match(v.live, /^Chef : Animation : /);
  // Animation repond au tableau pour « Chef » puis finit son message : c'est le resultat de l'envoi
  const stamp = sujets.stamp(new Date());
  s.setSujets('CTB', { ...s.sujets.CTB, board: { at: 1, entries: [{ when: stamp, from: 'Animation', to: 'Chef', text: 'fait, transition Jump ajoutee' }] } });
  finish(1, 'Fait.');
  const w = one(conseil.id);
  assert.strictEqual(w.state, 'fini');
  assert.strictEqual(w.children[0].children[0].result.text, 'fait, transition Jump ajoutee');
  // le chef et les sessions le lisent dans Saved/Tour/demandes.md
  dm.writeFiles(s.projects);
  const md = fs.readFileSync(path.join(root, 'Saved', 'Tour', 'demandes.md'), 'utf8');
  assert.match(md, /^- .* · Conseil · fini : « Q » Résultat : Oui\./m);
  assert.match(md, /^ {2}- .* · Chef · fini : « Mettre en œuvre : Oui\. »/m);
  assert.match(md, /^ {4}- .* · Animation · fini : « Le saut ne joue pas son animation\. » Résultat : fait, transition Jump ajoutee/m);
  assert.match(chefLib.promptOf([], []), /Saved\/Tour\/demandes\.md/);
  assert.strictEqual(kids.length, 2);
  done();
});

test('chef : un envoi propose attend la validation d\'ali, un envoi au tableau attend la reponse de la session', () => {
  const env = setup();
  const { s, dm, chef, drop, one, done } = env;
  chef.setAsk(true);
  drop('menu.md', 'pour: sujet-interface\n---\nAjoute un bouton Quitter.');
  chef.scan();
  const e = s.chef.envois[0];
  const x = s.demandes.find(z => z.ref.envoi === e.id);
  assert.strictEqual(one(x.id).state, 'attend');
  assert.strictEqual(one(x.id).phase, 'attend ta validation');
  chef.decide(e.id, false);
  env.tick(10);
  assert.strictEqual(one(x.id).state, 'arretee');
  // une session dans sa fenetre : au tableau
  chef.setAsk(false);
  s.event({ session_id: 'win', cwd: env.root, hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [sujet-animation] : lis la consigne' });
  drop('anim.md', 'pour: sujet-animation\n---\nRegarde les assets.');
  chef.scan();
  const y = s.demandes.find(z => z.ref.envoi === s.chef.envois[0].id);
  assert.strictEqual(one(y.id).state, 'attend');
  assert.strictEqual(one(y.id).phase, 'au tableau');
  done();
});

test('tache lancee dans une fenetre : la tour retrouve sa session, la suit, et prend son rapport', () => {
  const env = setup();
  const { s, dm, one, tick, done } = env;
  const x = dm.add({ kind: 'tache', to: 'Relecture complète et rapport', text: 'Relit tout le jeu', project: 'CTB', ref: { task: 'relecture' } });
  assert.strictEqual(one(x.id).state, 'envoyee');
  assert.strictEqual(one(x.id).live, 'la fenêtre s\'ouvre');
  tick(4 * 60_000);
  assert.match(one(x.id).live, /pas encore de nouvelles/);
  // une ancienne session de la meme tache n'est pas prise pour la nouvelle
  s.event({ session_id: 'w1', cwd: env.root, hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [relecture] : lis la consigne dans Saved/Tour/taches/relecture.md et suis-la.' });
  assert.strictEqual(one(x.id).state, 'en-cours');
  assert.strictEqual(one(x.id).ref.session, 'w1');
  s.event({ session_id: 'w1', hook_event_name: 'Stop', last_assistant_message: 'Rapport écrit.\n\n## Suivi\nFait :\n- relu\nQuestions pour ali :\n- garder le SAS ?\nRapport : Saved/Tour/rapports/relecture.md' });
  const v = one(x.id);
  assert.strictEqual(v.state, 'fini');
  assert.strictEqual(v.result.file, 'Saved/Tour/rapports/relecture.md');
  assert.deepStrictEqual(v.result.questions, ['garder le SAS ?']);
  assert.strictEqual(v.result.text, 'Rapport écrit.');
  done();
});

test('redemarrage : un message en cours est perdu, la demande le dit ; les demandes finies restent', () => {
  const env = setup();
  const { s, d, kids, finish, done } = env;
  const st = d.start({ cwd: env.root, text: 'premier', def: 'sujet-animation' });
  kids[0].emit('close', 0);
  const a = say(env, st.sessionId, 'un message qui tourne');
  const b = say(env, st.sessionId, 'un message fini');
  finish(1, 'ok');
  finish(2, 'ok aussi');
  const saved = JSON.parse(JSON.stringify(s.toJSON()));
  // le premier message est fini dans l'etat enregistre ; on remet en cours pour simuler une coupure
  const lost = saved.demandes.find(z => z.id === a.id);
  Object.assign(lost, { status: 'en-cours', phase: 'prise en charge', turn: { started: 1, ended: 0 }, doneAt: 0 });
  const s2 = new TowerState(() => Date.UTC(2026, 9, 12, 14, 0, 0));
  s2.load(saved);
  const dm2 = D.create(s2, { busy: () => false });
  dm2.refresh();
  assert.strictEqual(s2.demandes.find(z => z.id === a.id).status, 'erreur');
  assert.match(s2.demandes.find(z => z.id === a.id).phase, /redémarré/);
  assert.strictEqual(s2.demandes.find(z => z.id === b.id).status, 'fini');
  done();
});

test('activite : ce que fait la session, en mots', () => {
  const now = 1000;
  assert.strictEqual(D.activity({ tool: { name: 'Grep', summary: 'Stamina', at: now } }, now), 'cherche Stamina');
  assert.strictEqual(D.activity({ tool: { name: 'Bash', summary: 'tests.ps1', at: now }, subagents: { a: {}, b: {} } }, now), 'lance tests.ps1 · 2 agents au travail');
  assert.strictEqual(D.activity({ tool: { name: 'Read', summary: 'x', at: 0 } }, 10 * 60_000), 'travaille');
});

test('commentaires : un commentaire part a la session qui travaille, sa reponse s\'ajoute a la carte ; sans agent dessus, il reste une note', () => {
  const env = setup();
  const { s, d, dm, kids, runs, finish, one, done } = env;
  const st = d.start({ cwd: env.root, text: 'Tache de la tour [sujet-animation] : lis la consigne', def: 'sujet-animation' });
  kids[0].emit('close', 0);
  const x = say(env, st.sessionId, 'Le rechargement ne joue pas en jeu.');
  let v = one(x.id);
  assert.strictEqual(v.commentTo, x.to);
  assert.match(v.summary[0], /y travaille/);
  // le commentaire part a la session, en file derriere le message en cours
  const r = dm.comment(x.id, 'Regarde aussi le montage du fusil.');
  assert.ok(r.ok);
  assert.strictEqual(r.to, x.to);
  v = one(x.id);
  assert.strictEqual(v.notes.length, 1);
  assert.ok(v.notes[0].pending);
  assert.match(v.summary.join(' '), /Un commentaire de toi, un attend sa réponse/);
  // la demande finit, puis le commentaire part et la session repond
  finish(1, 'Le slot UpperBody manquait : ajoute.');
  assert.strictEqual(one(x.id).state, 'fini');
  assert.match(runs[2].input || runs[2].args.join(' '), /Commentaire d'ali sur sa demande/);
  finish(2, 'Le montage du fusil avait le meme souci : corrige aussi.\n\n## Suivi\n- fait');
  v = one(x.id);
  assert.strictEqual(v.notes.length, 2);
  assert.ok(!v.notes[0].pending);
  assert.deepStrictEqual([v.notes[1].who, v.notes[1].name, v.notes[1].text], ['agent', x.to, 'Le montage du fusil avait le meme souci : corrige aussi.']);
  assert.match(v.summary.join(' '), /Dernière réponse à tes commentaires/);
  // finie : plus personne dessus, le commentaire reste une note
  assert.strictEqual(v.commentTo, '');
  const n = runs.length;
  assert.ok(dm.comment(x.id, 'Merci, je teste ce soir.').ok);
  v = one(x.id);
  assert.strictEqual(v.notes[2].to, '');
  assert.strictEqual(runs.length, n);
  // le chef et les sessions lisent les commentaires dans demandes.md
  const md = dm.fileText('CTB');
  assert.match(md, /> .* · ali à .* : « Regarde aussi le montage du fusil\. »/);
  assert.match(md, /> .* · ali \(note\) : « Merci, je teste ce soir\. »/);
  assert.ok(!dm.comment(x.id, '   ').ok);
  assert.ok(!dm.comment('nope', 'x').ok);
  void s;
  done();
});

test('commentaires : sur un verdict confie au chef, le commentaire va au chef ; au redemarrage, une reponse attendue est perdue', () => {
  const env = setup();
  const { s, d, dm, kids, one, done } = env;
  s.conseil = { runs: [{ id: 'c1', step: 'fini', question: 'SAS ?', decision: 'Non.', members: {} }] };
  const k = dm.add({ kind: 'conseil', to: 'Conseil', text: 'SAS ?', project: 'CTB', ref: { conseil: 'c1' } });
  assert.strictEqual(one(k.id).state, 'fini');
  assert.strictEqual(one(k.id).commentTo, '');
  const st = d.start({ cwd: env.root, text: 'Tache de la tour [chef] : verdict', def: 'chef' });
  const tag = st.sessionId && dm.newTag();
  dm.add({ id: tag, kind: 'chef', to: 'Chef', text: 'Mettre en œuvre le verdict', project: 'CTB', parent: k.id, ref: { tag, session: st.sessionId } });
  dm.turn({ tag, phase: 'start' });
  kids[0].emit('close', 0);
  const v = one(k.id);
  assert.strictEqual(v.state, 'en-cours');
  assert.strictEqual(v.commentTo, 'Chef');
  assert.match(v.summary.join(' '), /Le conseil a tranché|a répondu|Conseil a confié/);
  assert.ok(dm.comment(k.id, 'Garde le badge vert.').ok);
  assert.strictEqual(one(k.id).notes[0].to, 'Chef');
  const back = D.restore(JSON.parse(JSON.stringify(s.demandes)));
  const n = back.find(x => x.id === k.id).notes[0];
  assert.ok(!n.pending && n.lost);
  done();
});
