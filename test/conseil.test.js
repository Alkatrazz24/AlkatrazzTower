'use strict';
// Le conseil : cinq avis independants, une relecture croisee anonyme, un verdict du president, ecrit
// dans Saved/Tour/conseil/ et confiable au chef. Claude Code est remplace par un faux.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const C = require('../lib/conseil');
const chefLib = require('../lib/chef');

function fakeState() {
  let t = Date.UTC(2026, 9, 11, 13, 0, 0);
  return { conseil: null, changes: 0, now: () => (t += 1000), changed() { this.changes++; } };
}

// Un faux claude -p : answer(args, cwd, input) -> { text } | { error } | null (ne repond jamais).
function fakeRun(answer) {
  const calls = [];
  const run = (args, cwd, input) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', 1));
    calls.push({ args, cwd, input });
    const a = answer(args, cwd, input);
    if (a) setImmediate(() => {
      const res = a.error ? { type: 'result', is_error: true, result: a.error } : { type: 'result', is_error: false, result: a.text, total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 50 } };
      child.stdout.emit('data', JSON.stringify(res) + '\n');
      child.emit('close', a.error ? 1 : 0);
    });
    return child;
  };
  return { run, calls };
}
const kindOf = (call) => call.args.includes('Read,Grep,Glob') ? 'cadrage' : /^Tu relis/.test(call.input) ? 'revue' : /^Tu es le Président/.test(call.input) ? 'president' : 'membre';
const VERDICT = '**Décision :** Garder la porte du SAS au badge.\n\n## Où le conseil est d\'accord\n- Le SAS protège l\'équipe.\n\n## La première chose à faire\nUn drapeau sur ACTBPorte.';

function setup(answer, extra = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-conseil-'));
  const root = path.join(base, 'CTB');
  fs.mkdirSync(root, { recursive: true });
  const state = fakeState();
  const { run, calls } = fakeRun(answer);
  const chefCalls = [];
  const cs = C.create(state, {
    projectFor: () => ({ name: 'ConquerTheBackrooms', root }), run, rnd: () => 0.5, dataDir: base,
    toChef: (p, text) => { chefCalls.push({ p, text }); return { ok: true, sessionId: 'chef-1' }; }, ...extra,
  });
  return { state, cs, calls, chefCalls, root, base };
}
const standard = (args, cwd, input) => {
  const k = kindOf({ args, input });
  if (k === 'cadrage') return { text: 'QUESTION CADREE : porte du SAS, ADR 0081.' };
  if (k === 'revue') return { text: 'B est la plus solide.' };
  if (k === 'president') return { text: VERDICT };
  return { text: `Avis : ${/Tu es (.+?), membre/.exec(input)[1]}.` };
};

test('une deliberation complete : cadrage, cinq avis, relecture anonyme, verdict ecrit', async () => {
  const { state, cs, calls, root } = setup(standard);
  const r = cs.ask({ question: 'La porte du SAS doit-elle céder au coup de pied ?', project: 'ConquerTheBackrooms' });
  assert.ok(r.ok, r.error);
  await r.done;
  const run = state.conseil.runs[0];
  assert.strictEqual(run.step, 'fini', run.error);
  assert.deepStrictEqual(calls.map(kindOf).sort(), ['cadrage', 'membre', 'membre', 'membre', 'membre', 'membre', 'president', 'revue', 'revue', 'revue', 'revue', 'revue'].sort());
  // le cadrage lit le projet, en lecture seule et avec une limite de depense
  const cad = calls.find(c => kindOf(c) === 'cadrage');
  assert.strictEqual(cad.cwd, root);
  assert.ok(cad.args.includes('--max-budget-usd'));
  assert.match(cad.input, /porte du SAS/);
  // les autres appels : aucun outil, aucun skill, ni reglages ni hooks du compte, rien garde sur le disque
  for (const c of calls.filter(x => kindOf(x) !== 'cadrage')) {
    assert.notStrictEqual(c.cwd, root, 'pas dans le projet : son CLAUDE.md ne se charge pas');
    assert.strictEqual(c.args[c.args.indexOf('--tools') + 1], '');
    for (const f of ['--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config']) assert.ok(c.args.includes(f), f);
    assert.strictEqual(c.args[c.args.indexOf('--setting-sources') + 1], 'project');
    assert.strictEqual(c.args[c.args.indexOf('--model') + 1], 'sonnet');
  }
  // les membres recoivent la question cadree ; la relecture ne voit pas leurs noms
  for (const c of calls.filter(x => kindOf(x) === 'membre')) assert.match(c.input, /QUESTION CADREE/);
  const rev = calls.find(c => kindOf(c) === 'revue');
  for (const m of C.MEMBERS) assert.ok(!rev.input.includes(m.name), `${m.name} anonyme`);
  assert.match(rev.input, /\*\*Réponse A :\*\*/);
  // le president voit les noms et la relecture
  const pres = calls.find(c => kindOf(c) === 'president');
  assert.match(pres.input, /\*\*Le Contradicteur :\*\*/);
  assert.match(pres.input, /B est la plus solide/);
  assert.strictEqual(run.decision, 'Garder la porte du SAS au badge.');
  assert.strictEqual(run.revues.length, 5);
  assert.ok(Math.abs(run.cost - 0.12) < 1e-9, String(run.cost));
  // le verdict est ecrit dans Saved/Tour/conseil/
  assert.match(run.file, /^Saved\/Tour\/conseil\/.+-la-porte-du-sas-doit-elle-ceder-au-coup.*\.md$/);
  const text = fs.readFileSync(path.join(root, ...run.file.split('/')), 'utf8');
  for (const s of ['La question cadrée', 'Le verdict', 'Garder la porte du SAS', 'Le Visionnaire', 'La relecture croisée']) assert.ok(text.includes(s), s);
  assert.ok(!cs.busy());
});

test('sans relecture ni cadrage : six appels, la question part telle quelle', async () => {
  const { state, cs, calls } = setup(standard);
  assert.ok(cs.settings({ revue: false, cadrage: false, model: 'haiku' }).ok);
  const r = cs.ask({ question: 'Batterie à recharger ou lumière infinie ?' });
  await r.done;
  assert.strictEqual(state.conseil.runs[0].step, 'fini');
  assert.deepStrictEqual(calls.map(kindOf).filter(k => k === 'revue' || k === 'cadrage'), []);
  assert.strictEqual(calls.length, 6);
  assert.match(calls[0].input, /Batterie à recharger/);
  assert.strictEqual(calls[0].args[calls[0].args.indexOf('--model') + 1], 'haiku');
  // le modele « celui de Claude Code » : pas d'option --model
  cs.settings({ model: '' });
  assert.ok(!C.argsOf('membre', '').includes('--model'));
});

test('un cadrage rate n\'arrete pas le conseil ; trop d\'avis rates, si', async () => {
  const a = setup((args, cwd, input) => kindOf({ args, input }) === 'cadrage' ? { error: 'budget depasse' } : standard(args, cwd, input));
  await a.cs.ask({ question: 'Une question assez longue ?', project: 'x' }).done;
  const r1 = a.state.conseil.runs[0];
  assert.strictEqual(r1.step, 'fini');
  assert.match(r1.note, /Cadrage impossible/);
  let n = 0;
  const b = setup((args, cwd, input) => kindOf({ args, input }) === 'membre' && n++ < 3 ? { error: 'credit epuise' } : standard(args, cwd, input));
  await b.cs.ask({ question: 'Une question assez longue ?' }).done;
  const r2 = b.state.conseil.runs[0];
  assert.strictEqual(r2.step, 'erreur');
  assert.match(r2.error, /Trop peu d'avis \(2 sur 5\) : credit epuise/);
  assert.ok(!b.cs.busy());
});

test('une seule deliberation a la fois, une vraie question, et on peut l\'arreter', async () => {
  const { state, cs } = setup(() => null); // Claude Code ne repond jamais
  assert.strictEqual(cs.ask({ question: 'oui ?' }).ok, false);
  const r = cs.ask({ question: 'Une question assez longue ?' });
  assert.ok(r.ok);
  assert.strictEqual(cs.ask({ question: 'Une autre question longue ?' }).ok, false);
  assert.strictEqual(cs.view().busy, true);
  assert.ok(cs.stop().ok);
  await r.done;
  assert.strictEqual(state.conseil.runs[0].step, 'arrete');
  assert.strictEqual(cs.stop().ok, false);
  assert.ok(cs.ask({ question: 'Une autre question longue ?' }).ok, 'la salle est libre');
});

test('confier le verdict au chef : la decision et le fichier, pas avant le verdict', async () => {
  const { state, cs, chefCalls } = setup(standard);
  const r = cs.ask({ question: 'La porte du SAS doit-elle céder ?', project: 'ConquerTheBackrooms' });
  assert.strictEqual(cs.chef(r.id).ok, false);
  await r.done;
  const res = cs.chef(r.id);
  assert.ok(res.ok);
  assert.strictEqual(res.sessionId, 'chef-1');
  assert.match(chefCalls[0].text, /Garder la porte du SAS au badge/);
  assert.match(chefCalls[0].text, /Saved\/Tour\/conseil\/.+\.md/);
  assert.strictEqual(state.conseil.runs[0].chef.sessionId, 'chef-1');
  assert.strictEqual(cs.chef('inconnu').ok, false);
});

test('au redemarrage, une deliberation en cours est marquee arretee', () => {
  const c = C.restore({ model: 'opus', runs: [{ id: 'a', step: 'avis' }, { id: 'b', step: 'fini' }] });
  assert.strictEqual(c.runs[0].step, 'arrete');
  assert.match(c.runs[0].note, /redémarré/);
  assert.strictEqual(c.runs[1].step, 'fini');
  assert.strictEqual(c.model, 'opus');
});

test('outils : lettres melangees, sortie json, phrase de decision', () => {
  const ids = C.MEMBERS.map(m => m.id);
  const L = C.lettersOf(ids, () => 0);
  assert.deepStrictEqual(Object.keys(L), ['A', 'B', 'C', 'D', 'E']);
  assert.deepStrictEqual(Object.values(L).sort(), ids.slice().sort());
  assert.deepStrictEqual(C.parseOut('bruit\n{"type":"result","result":"ok","total_cost_usd":0.5,"usage":{"input_tokens":3}}'), { ok: true, text: 'ok', cost: 0.5, tokens: 3 });
  assert.strictEqual(C.parseOut('').ok, false);
  assert.strictEqual(C.decisionOf('**Décision :** Faire A.\n\n## Suite'), 'Faire A.');
  assert.strictEqual(C.decisionOf('## Titre\nFaire B.'), 'Faire B.');
});

test('le chef renvoie les vrais choix au conseil', () => {
  assert.match(chefLib.promptOf([], []), /Conseil de la tour/);
  assert.match(chefLib.promptOf([], []), /Saved\/Tour\/conseil/);
});
