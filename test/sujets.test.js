'use strict';
// Sujets du jeu (une salle par sujet, son carnet, le tableau partage) et salles qui ne restent plus
// « au travail » apres la fin de leur session.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TowerState } = require('../server/state');
const sujets = require('../lib/sujets');
const taches = require('../lib/taches');

const TEAM = [
  { name: 'ctb-animation', section: 'Animation' },
  { name: 'ctb-interface', section: 'Interface' },
  { name: 'ctb-menus', section: 'Menus' },
  { name: 'ctb-armes', section: 'Armes et combat' },
  { name: 'ctb-economie', section: 'Économie et inventaire' },
  { name: 'ctb-monde', section: 'Monde et niveaux' },
  { name: 'ctb-gameplay', section: 'Gameplay' },
  { name: 'ctb-reseau', section: 'Réseau' },
  { name: 'ctb-relecteur', section: 'Tests et qualité' },
  { name: 'ctb-testeur', section: 'Tests et qualité' },
];

test('un sujet par section du jeu, plus Items et Base ; le reseau et les tests relisent tout', () => {
  const t = sujets.topicsOf(TEAM);
  const titles = t.map(x => x.title);
  for (const s of ['Animation', 'Interface', 'Menus', 'Armes et combat', 'Items', 'Base']) assert.ok(titles.includes(s), s);
  assert.ok(!titles.includes('Réseau') && !titles.includes('Tests et qualité'));
  assert.deepStrictEqual(t.find(x => x.title === 'Items').agents, ['ctb-economie']);
  assert.deepStrictEqual(t.find(x => x.title === 'Base').agents, ['ctb-monde', 'ctb-gameplay']);
  assert.deepStrictEqual(t.find(x => x.title === 'Animation').reviewers, ['ctb-relecteur', 'ctb-testeur', 'ctb-reseau']);
  assert.strictEqual(t.find(x => x.title === 'Armes et combat').id, 'sujet-armes-et-combat');
});

test('la consigne d\'un sujet : carnet, tableau, agents, et elle porte la marque de la tour', () => {
  const t = sujets.topicsOf(TEAM).find(x => x.title === 'Animation');
  const p = taches.promptFor(sujets.taskOf(t), 'CTB');
  assert.match(p, /^Tache de la tour \[sujet-animation\] : Animation/);
  assert.match(p, /Saved\/Tour\/sujets\/animation\.md/);
  assert.match(p, /Saved\/Tour\/tableau\.md/);
  assert.match(p, /`ctb-animation`/);
  assert.match(p, /- \d{4}-\d{2}-\d{2} HH:MM · Animation → /);
  assert.strictEqual(taches.taskIdIn(p), 'sujet-animation');
});

test('le tableau : on ajoute a la fin, la tour relit les messages ; le carnet donne ses prochaines etapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-sujets-'));
  try {
    assert.deepStrictEqual(sujets.readBoard(root).entries, []);
    assert.ok(sujets.post(root, { from: 'ali', to: 'tous', text: 'On garde la touche K\npour le coup de pied.' }).ok);
    fs.appendFileSync(path.join(root, 'Saved', 'Tour', 'tableau.md'), '- 2026-10-10 18:02 · Animation → Armes et combat : notify ajouté');
    assert.ok(sujets.post(root, { from: 'ali', to: 'Menus', text: 'Le menu pause d\'abord.' }).ok);
    const e = sujets.readBoard(root).entries;
    assert.strictEqual(e.length, 3);
    assert.deepStrictEqual(e[0].text, 'On garde la touche K pour le coup de pied.');
    assert.deepStrictEqual([e[1].from, e[1].to, e[1].text], ['Animation', 'Armes et combat', 'notify ajouté']);
    assert.strictEqual(e[2].to, 'Menus');
    assert.ok(!sujets.post(root, { text: '  ' }).ok);

    assert.strictEqual(sujets.readNotes(root, 'sujet-animation'), null);
    fs.mkdirSync(path.join(root, 'Saved', 'Tour', 'sujets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Saved', 'Tour', 'sujets', 'animation.md'), '# Animation\n\n## Où on en est\nCoup de pied codé.\n\n## Prochaines étapes\n- Importer le clip\n- Slot FullBody\n\n## Fichiers du sujet\n- ABP\n');
    const n = sujets.readNotes(root, 'sujet-animation');
    assert.strictEqual(n.where, 'Coup de pied codé.');
    assert.strictEqual(n.next, '- Importer le clip\n- Slot FullBody');
    assert.ok(sujets.readFile(root, 'sujet-animation').ok);
    assert.ok(sujets.readFile(root, 'tableau').ok);
    assert.ok(!sujets.readFile(root, '../../secret').ok);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('une session de sujet prend le nom du sujet et se lance comme une tache', () => {
  const s = new TowerState();
  s.setSujets('CTB', { project: 'CTB', topics: sujets.topicsOf(TEAM), board: { at: 0, entries: [] } });
  s.event({ session_id: 'a', cwd: '/x', hook_event_name: 'UserPromptSubmit', prompt: 'Tache de la tour [sujet-menus] : lis la consigne dans Saved/Tour/taches/sujet-menus.md et suis-la.' });
  assert.strictEqual(s.snapshot().agents[0].salle, 'Menus');
  assert.ok(s.snapshot().sujets.CTB.topics.length > 5);
  const t = taches.create(s).find('sujet-menus');
  assert.ok(t && t.sujet && !t.readonly);
  assert.ok(!s.taskList().some(x => x.id.startsWith('sujet-')), 'les sujets ne s\'ajoutent pas a la liste des taches');
});

test('un sous-agent de fond qui travaille apres la fin du tour ne remet pas la salle au travail', () => {
  let now = 1_000_000;
  const s = new TowerState(() => now);
  const ev = (name, extra = {}) => s.event({ session_id: 's', cwd: '/x', hook_event_name: name, ts: now, ...extra });
  ev('UserPromptSubmit', { prompt: 'fais ça' });
  ev('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'ctb-reseau' } });
  now += 1000; ev('Stop', { last_assistant_message: 'Fini, la relecture tourne en fond.' });
  assert.strictEqual(s.agents.s.status, 'idle');
  now += 1000; ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' }, agent_id: 'bg', agent_type: 'ctb-reseau' });
  now += 1000; ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' }, agent_id: 'bg', agent_type: 'ctb-reseau' });
  assert.strictEqual(s.agents.s.status, 'idle');
  assert.strictEqual(s.agents.s.message, 'Fini, la relecture tourne en fond.');
  assert.ok(s.agents.s.subagents.bg, 'le sous-agent reste a la table');
  // Sans plus aucune nouvelle, la table se vide toute seule, meme sans nouvel evenement.
  now += 11 * 60_000; s.expire();
  assert.deepStrictEqual(s.agents.s.subagents, {});
  // Une session reprise repart sans sous-agents.
  s.agents.s.subagents.vieux = { type: 'Explore', lastSeen: now };
  ev('SessionStart', { source: 'resume' });
  assert.deepStrictEqual(s.agents.s.subagents, {});
  // Une question de la session pendant qu'un sous-agent travaille : elle attend toujours ta reponse.
  ev('UserPromptSubmit', { prompt: 'continue' });
  ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { question: 'Quelle animation ?' } });
  ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/x/a.cpp' }, agent_id: 'bg2', agent_type: 'Explore' });
  assert.strictEqual(s.agents.s.status, 'waiting');
});

test('ranger une salle : elle sort du batiment, et revient quand la session reprend', () => {
  const s = new TowerState();
  s.event({ session_id: 'r', cwd: '/x', hook_event_name: 'Stop' });
  assert.ok(s.hide('r'));
  assert.ok(s.snapshot().agents[0].hidden);
  s.event({ session_id: 'r', cwd: '/x', hook_event_name: 'UserPromptSubmit', prompt: 'encore une chose' });
  assert.ok(!s.snapshot().agents[0].hidden);
  assert.ok(s.hide('r') && s.hide('r', false) && !s.agents.r.hidden);
  assert.ok(!s.hide('inconnu'));
});

test('discuter : la conversation se lit dans le journal, sans outils ni sous-agents', () => {
  const { readChat } = require('../lib/discussion');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-chat-'));
  const f = path.join(dir, 's.jsonl');
  const L = (o) => JSON.stringify(o);
  fs.writeFileSync(f, [
    L({ type: 'user', timestamp: '2026-10-10T17:00:00Z', message: { role: 'user', content: 'Ajoute le menu pause' } }),
    L({ type: 'assistant', timestamp: '2026-10-10T17:00:05Z', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Je regarde.' }] } }),
    L({ type: 'assistant', timestamp: '2026-10-10T17:00:06Z', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
    L({ type: 'user', timestamp: '2026-10-10T17:00:07Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    L({ type: 'assistant', isSidechain: true, timestamp: '2026-10-10T17:00:08Z', message: { id: 'm2', content: [{ type: 'text', text: 'sous-agent' }] } }),
    L({ type: 'user', timestamp: '2026-10-10T17:00:09Z', message: { role: 'user', content: '<task-notification>fini</task-notification>' } }),
    L({ type: 'assistant', timestamp: '2026-10-10T17:01:00Z', message: { id: 'm3', role: 'assistant', content: [{ type: 'text', text: 'Quel style de menu ?' }] } }),
    'pas du json',
  ].join('\n'));
  const r = readChat(f);
  assert.deepStrictEqual(r.messages.map(m => [m.who, m.text]), [['toi', 'Ajoute le menu pause'], ['agent', 'Je regarde.'], ['agent', 'Quel style de menu ?']]);
  assert.ok(!readChat(path.join(dir, 'absent.jsonl')).ok);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('discuter : un message relance la session sans fenetre, les suivants attendent leur tour', () => {
  const { EventEmitter } = require('events');
  const discussion = require('../lib/discussion');
  const s = new TowerState();
  const runs = [];
  const run = (args, cwd, input) => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); runs.push({ args, cwd, input, c }); return c; };
  const d = discussion.create(s, { run });
  const st = d.start({ cwd: '/jeu', text: 'Tache de la tour [sujet-menus] : lis la consigne' });
  assert.ok(st.ok);
  const id = st.sessionId;
  assert.deepStrictEqual(runs[0].args.slice(0, 3), ['-p', '--session-id', id]);
  assert.ok(runs[0].args.includes('--permission-prompts'));
  assert.strictEqual(runs[0].cwd, '/jeu');
  assert.strictEqual(s.agents[id].status, 'working');
  // Pendant qu'il travaille, le message suivant attend.
  assert.deepStrictEqual(d.send(id, 'Le menu pause d\'abord'), { ok: true, queued: true });
  assert.strictEqual(s.agents[id].chat.queued, 1);
  assert.strictEqual(runs.length, 1);
  // Fin du tour : Stop puis SessionEnd du -p ; la session reste ouverte pour la tour.
  s.event({ session_id: id, cwd: '/jeu', hook_event_name: 'Stop', last_assistant_message: 'Quel style ?' });
  s.event({ session_id: id, cwd: '/jeu', hook_event_name: 'SessionEnd', reason: 'other' });
  assert.strictEqual(s.agents[id].status, 'idle');
  runs[0].c.stdout.emit('data', '{"type":"result","is_error":false,"result":"ok"}\n');
  runs[0].c.emit('close', 0);
  assert.deepStrictEqual(runs[1].args.slice(0, 3), ['-p', '--resume', id]);
  assert.strictEqual(runs[1].input, 'Le menu pause d\'abord');
  runs[1].c.stdout.emit('data', '{"type":"result","is_error":true,"result":"Credit balance is too low"}\n');
  runs[1].c.emit('close', 1);
  assert.match(s.agents[id].chat.error, /Credit/);
  assert.ok(!s.agents[id].chat.busy);
  // Une session ouverte dans sa fenetre se lit seulement ; une fois fermee, on la reprend ici.
  const w = '11111111-2222-4333-8444-555555555555';
  s.event({ session_id: w, cwd: '/jeu', hook_event_name: 'UserPromptSubmit', prompt: 'salut' });
  assert.ok(!d.send(w, 'coucou').ok);
  s.event({ session_id: w, cwd: '/jeu', hook_event_name: 'SessionEnd', reason: 'logout' });
  assert.ok(d.send(w, 'on reprend').ok);
  assert.deepStrictEqual(runs[2].args.slice(0, 3), ['-p', '--resume', w]);
  assert.ok(!d.send(id, '   ').ok);
});
