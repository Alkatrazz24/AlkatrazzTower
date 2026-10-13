'use strict';
// Les features au tableau des demandes : le chef dit a quelle feature va une demande, la feature devient une
// carte qui regroupe ses demandes, et son historique d'avant se retrouve sur le disque (lib/features.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { TowerState } = require('../server/state');
const sujets = require('../lib/sujets');
const features = require('../lib/features');
const chefLib = require('../lib/chef');
const taches = require('../lib/taches');
const D = require('../lib/demandes');

const TEAM = [{ name: 'ctb-animation', section: 'Animation' }, { name: 'ctb-gameplay', section: 'Gameplay' }];

// Comme dans le serveur : une fausse discussion, le suivi des demandes et le chef.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-features-'));
  let t = Date.UTC(2026, 9, 13, 15, 0, 0);
  const s = new TowerState(() => t);
  const p = { name: 'CTB', root };
  s.projects = [p];
  s.setSujets('CTB', { project: 'CTB', topics: sujets.topicsOf(TEAM), board: { at: 0, entries: [] } });
  const kids = [];
  const run = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); kids.push(c); return c; };
  let dm = null;
  const d = require('../lib/discussion').create(s, { run, onTurn: (e) => dm.turn(e) });
  dm = D.create(s, {
    conseilRun: () => null,
    envoiOf: (id) => s.chef.envois.find(e => e.id === id),
    busy: (sid) => d.busy(sid),
    canChat: (sid) => d.canChat(s.agents[sid]),
    send: (sid, text, o) => d.send(sid, text, o),
    featureFor: (project, name, o) => chefLib.featureFor(s, project, name, o),
  });
  s.demandesView = dm.tree;
  s.featureCardsView = dm.featureCards;
  s.onChange(() => dm.refresh());
  const tk = taches.create(s);
  const chef = chefLib.create(s, d, { projectFor: () => p, prepare: (o) => tk.prepare(o), onEnvoi: (e, tag) => dm.onEnvoi(e, tag) });
  const finish = (k, text) => { kids[k].stdout.emit('data', JSON.stringify({ type: 'result', is_error: false, result: text }) + '\n'); kids[k].emit('close', 0); };
  const drop = (name, body) => {
    const dir = path.join(root, 'Saved', 'Tour', 'chef', 'envois');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, body, 'utf8');
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(f, old, old);
  };
  // un message au chef, comme la route /api/chat/send
  const toChef = (sid, text) => {
    const tag = dm.newTag();
    assert.ok(d.send(sid, text, { tag }).ok);
    return dm.add({ id: tag, kind: 'chef', to: 'Chef', text, project: 'CTB', ref: { tag, session: sid } });
  };
  const startChef = () => {
    const st = d.start({ cwd: root, text: 'Tache de la tour [chef] : lis la consigne', def: 'chef' });
    s.event({ session_id: st.sessionId, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [chef] : lis la consigne' });
    kids[kids.length - 1].emit('close', 0);
    return st.sessionId;
  };
  const card = (title) => s.snapshot().featureCards.find(c => c.title === title);
  const one = (id) => s.snapshot().demandes.find(x => x.id === id);
  return { s, p, root, d, dm, chef, kids, finish, drop, toChef, startChef, card, one, tick: (ms) => { t += ms; s.changed(); }, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const put = (root, rel, body, when) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body, 'utf8');
  if (when) fs.utimesSync(f, when, when);
};

test('la ligne « Feature : » du chef : lue, puis retiree de sa reponse', () => {
  const r = D.featureLine('J\'ai confié le montage à Animation.\n\n**Feature :** Coup de pied dans les portes\nMots : CoupDePied, ADR 0081');
  assert.strictEqual(r.feature, 'Coup de pied dans les portes');
  assert.strictEqual(r.mots, 'CoupDePied, ADR 0081');
  assert.strictEqual(r.text, 'J\'ai confié le montage à Animation.');
  assert.strictEqual(D.featureLine('Rien à voir.').feature, '');
  assert.strictEqual(D.featureLine('Une question.\nFeature : aucune').feature, 'aucune');
});

test('le chef range ses demandes dans une feature : creee la premiere fois, retrouvee ensuite, une carte qui les regroupe', () => {
  const env = setup();
  const { s, dm, kids, finish, toChef, startChef, card, one, done } = env;
  const sid = startChef();
  const a = toChef(sid, 'Le coup de pied dans les portes : il manque l\'animation, tu peux la faire créer ?');
  finish(kids.length - 1, 'J\'ai confié le montage AM_CoupDePied à Animation.\n\nFeature : Coup de pied dans les portes\nMots : CoupDePied, AM_CoupDePied');
  const f = s.features.find(x => x.title === 'Coup de pied dans les portes');
  assert.ok(f, 'feature creee par le chef');
  assert.strictEqual(f.by, 'Chef');
  assert.deepStrictEqual(f.mots, ['CoupDePied', 'AM_CoupDePied']);
  assert.strictEqual(one(a.id).feature, f.id);
  assert.strictEqual(one(a.id).result.text, 'J\'ai confié le montage AM_CoupDePied à Animation.');
  // aucune session lancee pour elle : la feature range les demandes
  assert.strictEqual(kids.length, 2);
  // une deuxieme demande, meme feature (la casse et les accents n'y changent rien)
  const b = toChef(sid, 'Et le son du coup de pied ?');
  let c = card('Coup de pied dans les portes');
  assert.strictEqual(c.state, 'en-cours');
  assert.match(c.summary[0], /y travaille/);
  finish(kids.length - 1, 'Le son est confié à Audio.\nFeature : coup de pied dans les PORTES');
  assert.strictEqual(s.features.length, 1);
  c = card('Coup de pied dans les portes');
  assert.deepStrictEqual(c.demandes.sort(), [a.id, b.id].sort());
  assert.strictEqual(c.state, 'repos');
  assert.strictEqual(c.stateText, 'à reprendre');
  assert.match(c.summary.join('\n'), /Dernière réponse \(Chef\) : Le son est confié à Audio\./);
  // « Feature : aucune » ne range rien
  const q = toChef(sid, 'Combien de tests sont verts ?');
  finish(kids.length - 1, '662 verts.\nFeature : aucune');
  assert.strictEqual(one(q.id).feature || '', '');
  // terminee, elle passe dans Fini
  s.endFeature(f.id);
  assert.strictEqual(card('Coup de pied dans les portes').state, 'fini');
  // le chef les lit dans demandes.md
  dm.writeFiles(s.projects);
  const md = fs.readFileSync(path.join(env.root, 'Saved', 'Tour', 'demandes.md'), 'utf8');
  assert.match(md, /## Les features/);
  assert.match(md, /Coup de pied dans les portes · terminée/);
  assert.match(md, /\[feature : Coup de pied dans les portes\]/);
  done();
});

test('un envoi du chef avec « feature: » range l\'envoi et cree la feature sans session', () => {
  const env = setup();
  const { s, chef, drop, done } = env;
  drop('pied.md', 'pour: sujet-animation\nfeature: Coup de pied dans les portes\nmots: CoupDePied\n---\nCrée le montage AM_CoupDePied.');
  chef.scan();
  const f = s.features.find(x => x.title === 'Coup de pied dans les portes');
  assert.ok(f);
  assert.deepStrictEqual(f.sujets, ['sujet-animation']);
  const e = s.chef.envois[0];
  assert.strictEqual(e.featureId, f.id);
  assert.strictEqual(e.to, 'sujet-animation');
  // un deuxieme envoi a la meme feature ne la recree pas
  drop('pied2.md', 'pour: sujet-gameplay\nfeature: Coup de pied dans les portes\n---\nBranche le montage.');
  chef.scan();
  assert.strictEqual(s.features.length, 1);
  assert.strictEqual(s.chef.envois[0].featureId, f.id);
  done();
});

test('les mots-cles rangent les demandes d\'avant ; le chef a le dernier mot', () => {
  const env = setup();
  const { s, dm, one, done } = env;
  const old = dm.add({ kind: 'chef', to: 'Chef', text: 'tu peux me faire une map ou je peux tester le coup de pied dans la porte', project: 'CTB', ref: { task: 'x' } });
  const other = dm.add({ kind: 'chef', to: 'Chef', text: 'le glyphe du mini-menu de la porte est faux', project: 'CTB', ref: { task: 'y' } });
  s.addFeature({ title: 'Coup de pied dans les portes', idea: 'idée', project: 'CTB' });
  const f = s.features[0];
  assert.strictEqual(one(old.id).feature, f.id);
  assert.strictEqual(one(other.id).feature || '', '');
  // une demande neuve qui la nomme s'y range des son arrivee
  const fresh = dm.add({ kind: 'discussion', to: 'Gameplay', text: 'Le CoupDePied rate une porte sur deux', project: 'CTB', ref: { task: 'z' } });
  assert.strictEqual(one(fresh.id).feature, f.id);
  assert.deepStrictEqual(env.card('Coup de pied dans les portes').demandes.sort(), [old.id, fresh.id].sort());
  assert.ok(features.mentions(f, 'test CTB.Geste.CoupDePied'));
  assert.ok(!features.mentions(f, 'les portes verrouillées'));
  done();
});

test('commenter une feature : a l\'agent qui travaille sur une de ses demandes, sinon une note', () => {
  const env = setup();
  const { s, dm, kids, finish, toChef, startChef, card, done } = env;
  s.addFeature({ title: 'Lampe torche', idea: 'idée', project: 'CTB' });
  const fid = s.features[0].id;
  let r = dm.commentFeature(fid, 'Pense à la pile.');
  assert.deepStrictEqual(r, { ok: true, to: '' });
  assert.strictEqual(card('Lampe torche').comments.length, 1);
  assert.strictEqual(card('Lampe torche').commentTo, '');
  const sid = startChef();
  toChef(sid, 'La lampe torche clignote');
  assert.strictEqual(card('Lampe torche').commentTo, 'Chef');
  r = dm.commentFeature(fid, 'Et elle doit s\'éteindre sous l\'eau.');
  assert.strictEqual(r.to, 'Chef');
  finish(kids.length - 1, 'Vu.\nFeature : Lampe torche');
  assert.ok(!dm.commentFeature('feature-inconnue', 'x').ok);
  assert.ok(!dm.commentFeature(fid, '  ').ok);
  done();
});

test('l\'historique d\'avant : tableau, envois du chef, verdicts, rapports et carnets qui la nomment', () => {
  const env = setup();
  const { s, root, card, done } = env;
  put(root, 'Saved/Tour/tableau.md', [
    '# Tableau', '',
    '- 2026-10-11 00:03 · Chef → Gameplay : chantier coup de pied dans les portes (ADR 0081)',
    '- 11/10/2026 00:47 · Animation → Gameplay : le montage AM_CoupDePied reste à créer',
    '- 2026-10-11 01:10 · Interface → Chef : glyphe du mini-menu de la porte corrigé',
  ].join('\n'));
  put(root, 'Saved/Tour/chef/envoyes/2026-10-11-00-03-coup-de-pied-gameplay.md', 'pour: sujet-gameplay\n---\nChantier coup de pied dans les portes : le joueur ouvre une porte d\'un coup de pied.');
  put(root, 'Saved/Tour/rapports/coup-de-pied-gameplay-2026-10-11.md', '# Rapport', new Date(2026, 9, 11, 17, 30));
  put(root, 'Saved/Tour/rapports/relecture-2026-10-11.md', '# Rapport');
  put(root, 'Saved/Tour/sujets/gameplay.md', '## Journal\n- 11/10, 00:15 — chantier coup de pied dans les portes : composant posé\n- 11/10, 00:20 — rien à voir\n', new Date(2026, 9, 11, 12, 0));
  put(root, 'Saved/Tour/conseil/2026-10-11-09-00-la-porte-du-sas.md', '# La porte du SAS doit-elle s\'ouvrir d\'un coup de pied ?\n\n**Décision :** Non.');
  s.addFeature({ title: 'Coup de pied dans les portes', idea: 'idée', project: 'CTB', mots: ['CoupDePied'] });
  const f = s.features[0];
  const past = features.past(root, f);
  const srcs = past.map(x => `${x.src}:${x.who}`);
  // la ligne du chef au tableau double son envoi : une seule trace
  assert.deepStrictEqual(srcs, ['envoi:Chef', 'carnet:Gameplay', 'tableau:Animation', 'conseil:Conseil', 'rapport:Rapport']);
  assert.match(past[0].text, /^Chantier coup de pied/);
  assert.strictEqual(past[0].to, 'Gameplay');
  assert.match(past[3].text, /SAS.* : Non\./);
  assert.ok(past.every((x, i) => !i || past[i - 1].at <= x.at));
  // dans la carte, une fois relu par le serveur
  s.setFeaturePast(f.id, past);
  const c = card('Coup de pied dans les portes');
  assert.strictEqual(c.past.length, 5);
  assert.match(c.summary.join('\n'), /5 traces d'avant retrouvées/);
  done();
});

test('les taches perso d\'ali deviennent des features, une fois chacune', () => {
  const env = setup();
  const { s, root, done } = env;
  put(root, 'Saved/Tour/taches/perso-coup-de-pied-dans-les-portes.md', 'Tache de la tour [perso-coup-de-pied-dans-les-portes] : Coup de pied dans les portes\n\nLe joueur ouvre les portes des parcelles d\'un coup de pied.\n');
  put(root, 'Saved/Tour/taches/perso-coup-de-pied-dans-les-portes-2026-10-11-123.log', 'log');
  put(root, 'Saved/Tour/taches/relecture.md', 'Tache de la tour [relecture] : Relecture');
  s.tasks.push({ id: 'perso-lampe', title: 'Lampe torche', prompt: 'Ajoute la lampe.', text: 'Ajoute la lampe.' });
  const seeds = features.seedsOf(root, s.tasks);
  assert.deepStrictEqual(seeds.map(x => x.title).sort(), ['Coup de pied dans les portes', 'Lampe torche']);
  assert.strictEqual(seeds.find(x => x.key === 'perso-coup-de-pied-dans-les-portes').idea, 'Le joueur ouvre les portes des parcelles d\'un coup de pied.');
  assert.strictEqual(s.seedFeatures('CTB', seeds), 2);
  assert.ok(s.features.every(f => f.by === 'Tâche'));
  // terminee, elle ne revient pas ; une deuxieme passe ne recree rien, et le choix survit au redemarrage
  s.endFeature(s.features[0].id);
  assert.strictEqual(s.seedFeatures('CTB', seeds), 0);
  const again = new TowerState();
  again.load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.strictEqual(again.seedFeatures('CTB', features.seedsOf(root, again.tasks)), 0);
  assert.strictEqual(again.features.length, 2);
  // une feature du meme nom deja la est retenue sans doublon
  const t2 = new TowerState();
  t2.addFeature({ title: 'lampe torche', idea: 'x', project: 'CTB' });
  assert.strictEqual(t2.seedFeatures('CTB', [{ key: 'perso-lampe', title: 'Lampe torche', idea: 'x' }]), 0);
  done();
});

test('l\'historique d\'avant tolere les fins de ligne Windows (CRLF)', () => {
  const env = setup();
  const { s, root, done } = env;
  const crlf = (l) => l.join('\r\n') + '\r\n';
  put(root, 'Saved/Tour/tableau.md', crlf(['# Tableau', '', '- 2026-10-11 00:17 · Animation → Gameplay : le montage AM_CoupDePied reste à créer']));
  put(root, 'Saved/Tour/chef/envoyes/2026-10-11-00-03-coup-de-pied.md', crlf(['pour: sujet-gameplay', 'feature: Coup de pied dans les portes', '---', 'Branche le montage.']));
  put(root, 'Saved/Tour/sujets/gameplay.md', crlf(['## Journal', '- 11/10, 00:15 — chantier coup de pied dans les portes : composant posé']), new Date(2026, 9, 11, 12, 0));
  s.addFeature({ title: 'Coup de pied dans les portes', idea: 'idée', project: 'CTB' });
  const past = features.past(root, s.features[0]);
  assert.deepStrictEqual(past.map(x => x.src), ['envoi', 'carnet', 'tableau']);
  assert.strictEqual(past[0].to, 'Gameplay');
  assert.strictEqual(past[0].text, 'Branche le montage.');
  assert.ok(past.every(x => !/\r/.test(x.text + x.to + x.who)));
  done();
});
