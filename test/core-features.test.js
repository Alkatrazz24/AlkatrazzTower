'use strict';
// Sessions core (les sujets du jeu, leur memoire et leurs regles) et sessions feature (une par nouvelle
// idee, creee depuis la tour) : lib/regles.js, lib/features.js et leur branchement dans la tour.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { TowerState } = require('../server/state');
const sujets = require('../lib/sujets');
const features = require('../lib/features');
const regles = require('../lib/regles');
const taches = require('../lib/taches');

const TEAM = [
  { name: 'ctb-interface', section: 'Interface' },
  { name: 'ctb-economie', section: 'Économie et inventaire' },
  { name: 'ctb-monde', section: 'Monde et niveaux' },
  { name: 'ctb-relecteur', section: 'Tests et qualité' },
];
function withTopics() {
  const s = new TowerState();
  s.setSujets('CTB', { project: 'CTB', topics: sujets.topicsOf(TEAM), board: { at: 0, entries: [] } });
  return s;
}
const optList = (args, opt) => { const i = args.indexOf(opt); return i < 0 ? [] : args[i + 1].split(','); };

test('regles : par defaut les agents sans demander, git interdit, le reste demande ; Saved/Tour toujours permis', () => {
  const r = regles.rulesOf(undefined);
  assert.deepStrictEqual(r, { modifier: 'demander', commandes: 'demander', git: 'non', internet: 'demander', agents: 'oui' });
  const args = regles.args(undefined);
  assert.ok(optList(args, '--allowedTools').includes('Edit(./Saved/Tour/**)'));
  assert.ok(optList(args, '--allowedTools').includes('Agent'));
  assert.ok(optList(args, '--disallowedTools').includes('Bash(git push:*)'));
  assert.ok(!optList(args, '--allowedTools').includes('Bash'));
});

test('regles : modifier interdit protege les dossiers du jeu par des regles Edit, sans toucher a Saved/Tour', () => {
  const deny = optList(regles.args({ modifier: 'non', commandes: 'oui' }), '--disallowedTools');
  assert.ok(deny.includes('Edit(./Source/**)') && deny.includes('Edit(./Content/**)') && deny.includes('Edit(./.claude/**)'));
  // Claude Code ne lit les chemins que dans les regles Edit : pas de Write(chemin).
  assert.ok(deny.every(d => !/^(Write|NotebookEdit)\(/.test(d)));
  assert.ok(!deny.some(d => /Saved/.test(d)));
  assert.ok(optList(regles.args({ commandes: 'oui' }), '--allowedTools').includes('Bash'));
  assert.ok(optList(regles.args({ agents: 'non' }), '--disallowedTools').includes('Agent'));
  assert.match(regles.text({ modifier: 'non' }), /interdit[^;]*modifier les fichiers du jeu/);
  assert.ok(!regles.valid('modifier', 'peut-etre') && !regles.valid('voler', 'oui'));
});

test('feature : creee avec un nom, une idee et les sujets touches ; sa consigne lit les carnets core sans les reecrire', () => {
  const s = withTopics();
  assert.ok(!s.addFeature({ title: '', idea: 'x' }).ok);
  assert.ok(!s.addFeature({ title: 'Lampe', idea: '  ' }).ok);
  const r = s.addFeature({ title: 'Lampe torche', idea: 'Une lampe qui s\'allume avec F.', sujets: ['sujet-interface', 'sujet-items', 'sujet-inconnu'], project: 'CTB' });
  assert.ok(r.ok);
  assert.strictEqual(r.feature.id, 'feature-lampe-torche');
  assert.deepStrictEqual(r.feature.sujets, ['sujet-interface', 'sujet-items']);
  assert.strictEqual(s.addFeature({ title: 'Lampe torche', idea: 'encore', project: 'CTB' }).feature.id, 'feature-lampe-torche-2');
  const t = s.sujetTask('feature-lampe-torche');
  assert.ok(t && t.feature && !t.readonly);
  assert.match(t.prompt, /Saved\/Tour\/features\/lampe-torche\.md/);
  assert.match(t.prompt, /Saved\/Tour\/sujets\/interface\.md/);
  assert.match(t.prompt, /tu ne les réécris pas/);
  assert.match(t.prompt, /ctb-interface/);
  assert.match(t.prompt, /Tes droits/);
  // elle se lance comme une tache, et sa session est reconnue a sa premiere demande
  const tk = taches.create(s);
  assert.strictEqual(tk.find('feature-lampe-torche').title, 'Lampe torche');
  s.event({ session_id: 'f1', cwd: '/jeu', hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [feature-lampe-torche] : lis la consigne' });
  assert.strictEqual(s.agents.f1.task.id, 'feature-lampe-torche');
  // terminer la feature, puis la reprendre ; tout survit a un redemarrage
  assert.ok(s.endFeature('feature-lampe-torche'));
  assert.ok(s.features[0].doneAt);
  const s2 = new TowerState();
  s2.load(JSON.parse(JSON.stringify(s)));
  assert.strictEqual(s2.features.length, 2);
  assert.ok(s2.endFeature('feature-lampe-torche', false) && !s2.features[0].doneAt);
  assert.deepStrictEqual(features.make({ title: 'x', idea: 'y' }, [], []).feature.sujets, []);
});

test('regles d\'un sujet : ali les change, elles partent dans la consigne et a chaque message de la discussion', () => {
  const s = withTopics();
  assert.ok(!s.setRule('sujet-interface', 'modifier', 'parfois'));
  assert.ok(!s.setRule('relecture', 'modifier', 'non'));
  assert.ok(s.setRule('sujet-interface', 'modifier', 'non'));
  assert.strictEqual(s.snapshot().regles['sujet-interface'].modifier, 'non');
  assert.strictEqual(s.snapshot().regles['sujet-menus'], undefined);
  assert.match(s.sujetTask('sujet-interface').prompt, /interdit[^;]*modifier les fichiers du jeu/);
  const runs = [], kids = [];
  const run = (args) => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); runs.push(args); kids.push(c); return c; };
  const d = require('../lib/discussion').create(s, { run });
  const st = d.start({ cwd: '/jeu', text: 'Tache de la tour [sujet-interface] : lis la consigne', def: 'sujet-interface' });
  assert.ok(optList(runs[0], '--disallowedTools').includes('Edit(./Source/**)'));
  // une session sans sujet ni feature part sans regles
  d.start({ cwd: '/jeu', text: 'salut' });
  assert.ok(!runs[1].includes('--disallowedTools'));
  // la regle changee s'applique au message suivant
  s.setRule('sujet-interface', 'modifier', 'oui');
  s.event({ session_id: st.sessionId, cwd: '/jeu', hook_event_name: 'Stop' });
  d.send(st.sessionId, 'vas-y');
  assert.strictEqual(runs.length, 2); // il attend la fin du premier tour
  assert.deepStrictEqual(s.agents[st.sessionId].chat.queued, 1);
  kids[0].emit('close', 0);
  assert.ok(optList(runs[2], '--allowedTools').includes('Edit'));
  assert.ok(!optList(runs[2], '--disallowedTools').includes('Edit(./Source/**)'));
});
