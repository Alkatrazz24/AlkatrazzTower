'use strict';
// Le chef (lib/chef.js) : une session qui recoit toutes les demandes d'ali, verifie en lisant, et confie
// les changements aux sessions core ou a une nouvelle feature par des fichiers d'envoi que la tour transmet.

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

const TEAM = [
  { name: 'ctb-animation', section: 'Animation' },
  { name: 'ctb-interface', section: 'Interface' },
  { name: 'ctb-relecteur', section: 'Tests et qualité' },
];
const optList = (args, opt) => { const i = args.indexOf(opt); return i < 0 ? [] : args[i + 1].split(','); };

// Une tour avec un projet sur disque, une fausse discussion (aucun claude lance) et le chef branche.
function setup({ clock } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-chef-'));
  let t = clock || Date.now();
  const s = new TowerState(() => t);
  const p = { name: 'CTB', root };
  s.projects = [p];
  s.setSujets('CTB', { project: 'CTB', topics: sujets.topicsOf(TEAM), board: { at: 0, entries: [] } });
  const runs = [], kids = [];
  const run = (args, cwd, input) => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); runs.push({ args, cwd, input }); kids.push(c); return c; };
  const d = require('../lib/discussion').create(s, { run });
  const tk = taches.create(s);
  const chef = chefLib.create(s, d, { projectFor: () => p, prepare: (o) => tk.prepare(o) });
  // un envoi depose par le chef, assez vieux pour etre lu
  const drop = (name, body) => {
    const dir = path.join(root, 'Saved', 'Tour', 'chef', 'envois');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, body, 'utf8');
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(f, old, old);
  };
  return { s, p, root, d, tk, chef, runs, kids, drop, tick: (ms) => { t += ms; }, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('chef : sa consigne liste les sujets, dit comment confier, et ses regles par defaut ne modifient rien', () => {
  const { s, tk, done } = setup();
  const t = tk.find('chef');
  assert.strictEqual(t.title, 'Chef');
  assert.match(t.prompt, /sujet-animation : Animation \(agents ctb-animation\)/);
  assert.match(t.prompt, /Saved\/Tour\/chef\/envois\//);
  assert.match(t.prompt, /Saved\/Tour\/chef\/suivi\.md/);
  assert.match(t.prompt, /pour: nouvelle feature/);
  assert.match(t.prompt, /Tu ne modifies pas le jeu/);
  assert.match(t.prompt, /interdit[^;]*modifier les fichiers du jeu/);
  assert.ok(!/sujet-tests/.test(t.prompt), 'les relecteurs ne sont pas un sujet');
  const args = s.ruleArgs('chef');
  assert.ok(optList(args, '--disallowedTools').includes('Edit(./Source/**)'));
  assert.ok(optList(args, '--disallowedTools').includes('Bash'));
  assert.ok(optList(args, '--allowedTools').includes('Agent'));
  assert.ok(optList(args, '--allowedTools').includes('Edit(./Saved/Tour/**)'));
  assert.strictEqual(s.snapshot().regles.chef.modifier, 'non');
  // ali peut changer ses regles ; les autres gardent les defauts du chef
  assert.ok(s.setRule('chef', 'commandes', 'demander'));
  assert.deepStrictEqual(s.snapshot().regles.chef, { ...chefLib.RULES, commandes: 'demander' });
  // sa premiere demande le reconnait
  s.event({ session_id: 'c1', cwd: '/jeu', hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [chef] : lis la consigne' });
  assert.strictEqual(s.agents.c1.task.id, 'chef');
  done();
});

test('envoi : lu, verifie ; une demande pour un sujet en sommeil lance sa session avec la demande, au tableau aussi', () => {
  const { s, root, chef, runs, drop, done } = setup();
  assert.ok(!chefLib.parse('pour: sujet-animation\nsans separateur').ok);
  assert.ok(!chefLib.parse('---\nrien').ok);
  assert.ok(!chefLib.parse('pour: nouvelle feature\n---\nidee sans titre').ok);
  drop('saut.md', 'pour: sujet-animation\n---\nLe saut ne joue pas son animation : ABP_Player n\'a pas de transition vers Jump.\n');
  drop('inconnu.md', 'pour: sujet-cuisine\n---\nUn gateau.');
  chef.scan();
  const [bad, e] = [...s.chef.envois].sort((a, b) => (a.file < b.file ? -1 : 1));
  assert.strictEqual(bad.status, 'erreur');
  assert.match(bad.error, /sujet-cuisine/);
  assert.strictEqual(e.status, 'envoyé');
  assert.strictEqual(e.toTitle, 'Animation');
  assert.strictEqual(runs.length, 1);
  assert.match(runs[0].input, /Tache de la tour \[sujet-animation\]/);
  assert.match(runs[0].input, /traite cette demande au lieu de demander/);
  assert.match(runs[0].input, /ABP_Player/);
  assert.strictEqual(runs[0].cwd, root);
  // la session du sujet garde ses regles (modifier : demander), pas celles du chef
  assert.ok(!optList(runs[0].args, '--disallowedTools').includes('Edit(./Source/**)'));
  assert.strictEqual(e.sessionId, Object.keys(s.agents)[0]);
  // les fichiers lus sont ranges, le tableau a la ligne du chef, le suivi est ecrit
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'Saved', 'Tour', 'chef', 'envois')), []);
  assert.strictEqual(fs.readdirSync(path.join(root, 'Saved', 'Tour', 'chef', 'envoyes')).length, 2);
  assert.match(fs.readFileSync(path.join(root, 'Saved', 'Tour', 'tableau.md'), 'utf8'), /Chef → Animation : Le saut ne joue pas/);
  assert.match(fs.readFileSync(path.join(root, 'Saved', 'Tour', 'chef', 'suivi.md'), 'utf8'), /Animation : Le saut .*\(transmis, session travaille\)/);
  chef.scan(); // rien de neuf : rien de relance
  assert.strictEqual(runs.length, 1);
  done();
});

test('envoi : une session de sujet deja dans la tour recoit la demande dans sa discussion ; une fenetre, au tableau', () => {
  const { s, d, chef, runs, kids, drop, done } = setup();
  const st = d.start({ cwd: '/jeu', text: 'Tache de la tour [sujet-interface] : lis la consigne', def: 'sujet-interface' });
  s.event({ session_id: st.sessionId, cwd: '/jeu', hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [sujet-interface] : lis la consigne' });
  kids[0].emit('close', 0);
  drop('hud.md', 'pour: sujet-interface\n---\nLe HUD cache la barre de stamina.');
  chef.scan();
  assert.strictEqual(runs.length, 2);
  assert.ok(runs[1].args.includes('--resume'));
  assert.match(runs[1].input, /Demande confiée par le chef/);
  assert.ok(!/au lieu de demander/.test(runs[1].input));
  assert.strictEqual(s.chef.envois[0].how, 'discussion');
  // une session ouverte dans sa fenetre : la tour ne peut pas lui ecrire, la demande attend au tableau
  s.event({ session_id: 'win', cwd: '/jeu', hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [sujet-animation] : lis la consigne' });
  drop('anim.md', 'pour: sujet-animation\n---\nRegarde les assets importes dans Content/Characters/New.');
  chef.scan();
  assert.strictEqual(s.chef.envois[0].status, 'au tableau');
  assert.strictEqual(s.chef.envois[0].sessionId, 'win');
  assert.strictEqual(runs.length, 2);
  done();
});

test('envoi : une idee neuve cree la feature et la lance ; en mode validation, ali envoie ou ignore', () => {
  const { s, chef, runs, drop, done } = setup();
  drop('lampe.md', 'pour: nouvelle feature\ntitre: Lampe torche\nsujets: sujet-interface, sujet-inconnu\n---\nUne lampe qui s\'allume avec F.');
  chef.scan();
  const e = s.chef.envois[0];
  assert.strictEqual(e.status, 'envoyé');
  assert.strictEqual(e.to, 'feature-lampe-torche');
  assert.deepStrictEqual(s.features[0].sujets, ['sujet-interface']);
  assert.match(runs[0].input, /Tache de la tour \[feature-lampe-torche\]/);
  // ali veut valider avant
  chef.setAsk(true);
  drop('menu.md', 'pour: sujet-interface\n---\nAjoute un bouton Quitter.');
  drop('rien.md', 'pour: sujet-animation\n---\nPas urgent.');
  chef.scan();
  assert.strictEqual(runs.length, 1);
  const menu = s.chef.envois.find(x => /Quitter/.test(x.text)), rien = s.chef.envois.find(x => /urgent/.test(x.text));
  assert.strictEqual(menu.status, 'proposé');
  assert.ok(chef.decide(menu.id, true).ok);
  assert.strictEqual(menu.status, 'envoyé');
  assert.strictEqual(runs.length, 2);
  assert.ok(chef.decide(rien.id, false).ok);
  assert.strictEqual(rien.status, 'ignoré');
  assert.ok(!chef.decide(rien.id, true).ok);
  // tout survit a un redemarrage
  const s2 = new TowerState();
  s2.load(JSON.parse(JSON.stringify(s)));
  assert.strictEqual(s2.chef.ask, true);
  assert.strictEqual(s2.chef.envois.length, 3);
  assert.strictEqual(s2.snapshot().chef.envois.length, 3);
  done();
});
