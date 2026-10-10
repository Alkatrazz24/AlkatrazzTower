'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const docs = require('../lib/docs');
const { TowerState } = require('../server/state');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-docs-'));
  const put = (rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('Jeu.uproject', JSON.stringify({ EngineAssociation: '5.8' }));
  put('CLAUDE.md', '# Règles du projet\n');
  put('docs/README.md', '# La documentation\n\nOù écrire quoi.\n');
  put('docs/ARCHITECTURE.md', '# Architecture\n\nLes portes sont répliquées.\n');
  put('docs/decisions/0081-coup-de-pied.md', '# 0081 · Le coup de pied\n\nSix coups cassent une porte.\n');
  put('docs/bible/00_PITCH.md', '# Le pitch\n');
  put('.claude/skills/ctb-portes/SKILL.md', '---\nname: ctb-portes\ndescription: x\n---\n\nOuvrir une porte.\n');
  put('.claude/agents/ctb-son.md', '---\nname: ctb-son\n---\n');
  put('Saved/Tour/sujets/animation.md', '# Animation\n');
  put('Infima.docs/index.md', '# Infima\n');
  put('Source/Jeu/Porte.cpp', '// porte\n');
  return { name: 'Jeu', root, uproject: path.join(root, 'Jeu.uproject') };
}

test('ce qui compte comme une modification du jeu, et comme de la doc', () => {
  assert.strictEqual(docs.relTo('C:\\P', 'C:\\P\\Source\\A.cpp'), 'Source/A.cpp');
  assert.strictEqual(docs.relTo('C:/P', 'c:/p/docs/x.md'), 'docs/x.md');
  assert.strictEqual(docs.relTo('C:/P', 'Source/A.cpp', 'C:/P'), 'Source/A.cpp');
  assert.strictEqual(docs.relTo('C:/P', 'C:/Autre/A.cpp'), null);
  for (const r of ['Source/A.cpp', 'Content/BP.uasset', 'Config/DefaultGame.ini', 'Plugins/SKG/x.h', 'tools/tests.ps1', 'Jeu.uproject']) assert.ok(docs.isGameRel(r), r);
  for (const r of ['docs/a.md', 'Saved/Tour/x.md', '.claude/agents/a.md', 'Plugins/AlkatrazzTower/web/x.js', 'CLAUDE.md']) assert.ok(!docs.isGameRel(r), r);
  assert.ok(docs.isDocRel('docs/decisions/0082.md') && docs.isDocRel('.claude/skills/x/SKILL.md'));
  assert.ok(!docs.isDocRel('docs/musique/analyse.py') && !docs.isDocRel('Saved/Tour/sujets/a.md'));
});

test('doc obligatoire : la fin du tour attend la doc, une seule fois', () => {
  const p = project();
  const s = new TowerState(() => 1000);
  s.connectProject(p);
  const ev = (e) => { s.event({ session_id: 'S', cwd: p.root, ...e }); return s.hookReply({ session_id: 'S', ...e }); };
  s.agent('S', p.root);
  s.agents.S.project = { name: 'Jeu', root: p.root };
  // rien de modifie : la session finit
  assert.strictEqual(ev({ hook_event_name: 'Stop' }).block, undefined);
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(p.root, 'Source', 'Jeu', 'Porte.cpp') } });
  const r = ev({ hook_event_name: 'Stop' });
  assert.match(r.block, /Doc obligatoire/);
  assert.match(r.block, /Source\/Jeu\/Porte\.cpp/);
  assert.strictEqual(s.agents.S.status, 'working');
  // Claude Code relance la fin avec stop_hook_active : la tour la laisse passer, la doc reste due
  assert.strictEqual(ev({ hook_event_name: 'Stop', stop_hook_active: true }).block, undefined);
  assert.ok(s.agents.S.docTrack.owed);
  // la doc ecrite efface la dette
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(p.root, 'docs', 'ARCHITECTURE.md') } });
  assert.strictEqual(ev({ hook_event_name: 'Stop' }).block, undefined);
  assert.strictEqual(s.agents.S.docTrack.owed, null);
  assert.strictEqual(s.agents.S.docTrack.written[0].rel, 'docs/ARCHITECTURE.md');
  // un rapport dans Saved/Tour ou un fichier d'agent ne demande pas de doc
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(p.root, 'Saved', 'Tour', 'rapports', 'r.md') } });
  assert.strictEqual(ev({ hook_event_name: 'Stop' }).block, undefined);
});

test('doc obligatoire : chaque agent ecrit la sienne', () => {
  const p = project();
  const s = new TowerState(() => 1000);
  s.connectProject(p);
  s.agent('S', p.root);
  s.agents.S.project = { name: 'Jeu', root: p.root };
  const ev = (e) => { s.event({ session_id: 'S', cwd: p.root, ...e }); return s.hookReply({ session_id: 'S', ...e }); };
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'Source/Jeu/Porte.cpp' }, agent_id: 'a1', agent_type: 'ctb-gameplay' });
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'Source/Jeu/Porte.cpp' }, agent_id: 'a2', agent_type: 'ctb-son' });
  assert.strictEqual(ev({ hook_event_name: 'SubagentStop', agent_id: 'a2', agent_type: 'ctb-son' }).block, undefined);
  assert.match(ev({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'ctb-gameplay' }).block, /l'agent ctb-gameplay/);
  ev({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'docs/decisions/0081-coup-de-pied.md' }, agent_id: 'a1', agent_type: 'ctb-gameplay' });
  assert.strictEqual(ev({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'ctb-gameplay' }).block, undefined);
  assert.strictEqual(ev({ hook_event_name: 'Stop' }).block, undefined);
});

test('une session hors projet n est jamais arretee', () => {
  const s = new TowerState(() => 1000);
  s.event({ session_id: 'X', cwd: '/ailleurs', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/ailleurs/Source/a.cpp' } });
  assert.strictEqual(s.hookReply({ session_id: 'X', hook_event_name: 'Stop' }).block, undefined);
  assert.strictEqual(s.hookReply({ session_id: 'X', hook_event_name: 'SessionStart' }).unreal, 'question');
  // un projet Unreal que la tour ne suit pas (pas connecte) : jamais arrete non plus
  const p = project();
  s.event({ session_id: 'Y', cwd: p.root, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(p.root, 'Source', 'Jeu', 'Porte.cpp') } });
  assert.ok(s.agents.Y.project, 'la session est bien dans un projet Unreal');
  assert.strictEqual(s.hookReply({ session_id: 'Y', hook_event_name: 'Stop' }).block, undefined);
  assert.strictEqual(s.agents.Y.docTrack, undefined);
});

test('les etageres, la lecture et la recherche', () => {
  const p = project();
  const sh = docs.shelves(p.root);
  const ids = sh.map(x => x.id);
  assert.deepStrictEqual(ids.slice(0, 3), ['ensemble', 'docs-bible', 'docs-decisions']);
  assert.ok(ids.includes('skills') && ids.includes('tour'));
  assert.strictEqual(sh[0].files[0].rel, 'docs/README.md');
  assert.ok(sh[0].files.some(f => f.rel === 'CLAUDE.md'));
  assert.strictEqual(sh.find(x => x.id === 'docs-decisions').files[0].title, '0081 · Le coup de pied');
  assert.strictEqual(sh.find(x => x.id === 'skills').files[0].title, 'ctb-portes');
  assert.strictEqual(docs.thirdParty(p.root)[0].title, 'Infima');
  assert.ok(docs.readDoc(p.root, 'docs/ARCHITECTURE.md').ok);
  for (const bad of ['Source/Jeu/Porte.cpp', '../x.md', '.claude/agents/ctb-son.md', 'C:/x.md', 'docs/../Source/a.md']) assert.strictEqual(docs.readDoc(p.root, bad).ok, false, bad);
  const r = docs.search(p.root, 'porte REPLIQUEES');
  assert.strictEqual(r.hits[0].rel, 'docs/ARCHITECTURE.md');
  assert.match(r.hits[0].line, /répliquées/);
  assert.strictEqual(docs.search(p.root, 'introuvable').hits.length, 0);
});

test('le rayon Unreal : pages epinglees sur la version, ecrit pour les sessions', () => {
  const p = project();
  const v = docs.scan(p);
  assert.strictEqual(v.version, '5.8');
  assert.ok(v.ue.length >= 8 && v.ue.every(t => t.pages.every(pg => pg.url.endsWith('?application_version=5.8'))));
  const md = fs.readFileSync(path.join(p.root, 'Saved', 'Tour', 'doc-unreal.md'), 'utf8');
  assert.match(md, /Animation Blueprints : https:/);
  assert.match(md, /Infima\.docs\//);
  // les regles : doc obligatoire pour tous, doc Unreal selon le reglage de la tour
  assert.match(docs.rules(p, { agent: true }), /si tu modifies le jeu/);
  assert.match(docs.rules(p, { mode: 'modif' }), /AVANT toute modification/);
  const s = new TowerState(() => 1);
  assert.ok(s.setDocRule('modif') && !s.setDocRule('jamais'));
  assert.strictEqual(s.hookReply({ session_id: 'Z', hook_event_name: 'SessionStart' }).unreal, 'modif');
  const s2 = new TowerState(() => 1);
  s2.load(JSON.parse(JSON.stringify(s)));
  assert.strictEqual(s2.docRules.unreal, 'modif');
});

test('les hooks de fin et de debut d agent sont synchrones', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-hooks.js'), 'utf8');
  for (const ev of ['Stop', 'SubagentStop', 'SubagentStart']) assert.match(src, new RegExp(`${ev}: \\[\\{ hooks: \\[sync\\] \\}\\]`));
});

test('le script de CTB : essai, puis ecriture une seule fois', () => {
  const { plan, apply, MARK } = require('../scripts/doc-ctb');
  const p = project();
  const agent = path.join(p.root, '.claude', 'agents', 'ctb-animation.md');
  fs.writeFileSync(agent, "---\nname: ctb-animation\n---\n\n## Comment tu travailles\n\n- Vérifie dans la doc officielle d'Unreal 5.8 (`?application_version=5.8`) ou dans les en-têtes du moteur\n  installé avant d'utiliser une API. Skills utiles : ue-animation-system.\n- Pose le verrou.\n");
  const ch = plan(p.root);
  assert.deepStrictEqual(ch.map(c => c.rel), ['CLAUDE.md', '.claude/agents/ctb-animation.md', '.claude/agents/ctb-son.md']);
  assert.strictEqual(fs.readFileSync(agent, 'utf8').includes(MARK), false); // l'essai n'ecrit rien
  apply(p.root, ch);
  const a = fs.readFileSync(agent, 'utf8');
  assert.match(a, /En cas de doute sur une API[\s\S]*Skills utiles : ue-animation-system\.\n- Pose le verrou\./);
  assert.doesNotMatch(a, /avant d'utiliser une API/);
  assert.match(a, /## Doc obligatoire/);
  assert.match(fs.readFileSync(path.join(p.root, 'CLAUDE.md'), 'utf8'), /^# Règles du projet\n\n## Documentation obligatoire/);
  assert.strictEqual(plan(p.root).length, 0);
  assert.ok(fs.readdirSync(path.join(p.root, 'Saved', 'Tour', 'sauvegardes')).length === 1);
  // en mode « modif », la phrase des agents reste
  const p2 = project();
  fs.writeFileSync(path.join(p2.root, '.claude', 'agents', 'x.md'), "Vérifie dans la doc officielle d'Unreal 5.8 (`?application_version=5.8`) ou dans les en-têtes du moteur installé avant d'utiliser une API.\n");
  assert.ok(plan(p2.root, { mode: 'modif' }).every(c => !c.after.includes('En cas de doute')));
});

test('tour eteinte : les hooks de fin rendent la main tout de suite, sans rien bloquer', { timeout: 20_000 }, async () => {
  const { spawn } = require('child_process');
  const p = project();
  const run = (ev) => new Promise((resolve) => {
    const t0 = Date.now();
    // un port ou rien n'ecoute : la tour est eteinte
    const c = spawn(process.execPath, [path.join(__dirname, '..', 'hooks', 'tower-hook.js')], { env: { ...process.env, TOWER_PORT: '1' } });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.on('close', (code) => resolve({ code, out, ms: Date.now() - t0 }));
    c.stdin.end(JSON.stringify({ session_id: 'eteinte', cwd: p.root, ...ev }));
  });
  for (const e of ['Stop', 'SubagentStop']) {
    const r = await run({ hook_event_name: e, agent_id: e === 'SubagentStop' ? 'a1' : undefined });
    assert.deepStrictEqual([r.code, r.out], [0, ''], e);
    assert.ok(r.ms < 1500, `${e} : ${r.ms} ms`);
  }
  // l'agent recoit la regle, mais pas l'annonce que la tour l'arretera
  const s = await run({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'ctb-son' });
  assert.strictEqual(s.code, 0);
  const ctx = JSON.parse(s.out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /doc obligatoire/);
  assert.doesNotMatch(ctx, /La tour arrete/);
});

test('la tache « doc du projet » ecrit seulement dans docs/ et Saved/Tour', () => {
  const taches = require('../lib/taches');
  const t = taches.BUILTIN.find(x => x.id === 'doc-projet');
  assert.ok(t && t.readonly && t.writesDocs);
  const args = taches.backgroundArgs(t);
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  assert.deepStrictEqual(allowed.filter(a => /^(Write|Edit)/.test(a)), ['Write(./Saved/Tour/**)', 'Edit(./Saved/Tour/**)', 'Write(./docs/**)', 'Edit(./docs/**)']);
  assert.deepStrictEqual(args.slice(args.indexOf('--disallowedTools') + 1), ['Bash', 'PowerShell', 'NotebookEdit']);
  assert.strictEqual(taches.backgroundArgs(taches.BUILTIN[0]), taches.BACKGROUND_ARGS);
  assert.match(taches.promptFor(t, 'CTB'), /docs\/COMPRENDRE\.md, « Comprendre CTB »/);
});
