'use strict';
// Installer dans CTB les skills des sessions de la tour et ceux de ponytail : ce qui est deja la est
// laisse, le reste est copie depuis GitHub (ou vendor/), sans rien ecraser.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib/skills-ctb');

function write(f, text) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
const md = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n\nConsignes.\n`;

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-skctb-'));
  const cfg = path.join(base, 'claude'), root = path.join(base, 'CTB 5.8');
  write(path.join(root, 'CTB.uproject'), '{}');
  write(path.join(root, '.claude', 'skills', 'game-ui-design', 'SKILL.md'), md('game-ui-design', 'UI de jeu.'));
  write(path.join(root, '.claude', 'skills', 'docx', 'SKILL.md'), md('docx', 'Deja copie dans CTB.'));
  write(path.join(cfg, 'skills', 'pdf', 'SKILL.md'), md('pdf', 'Skill perso deja la.'));
  write(path.join(cfg, 'plugins', 'synced', 'compte', 'design', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'design' }));
  write(path.join(cfg, 'plugins', 'synced', 'compte', 'design', 'skills', 'ux-copy', 'SKILL.md'), md('ux-copy', 'Textes d\'interface.'));
  return { base, cfg, root };
}

// Un faux GitHub : l'arbre d'un depot et ses fichiers bruts.
function fakeGithub(files) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const m = url.match(/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\//);
    if (m) return { ok: true, status: 200, json: async () => ({ tree: Object.keys(files).filter(k => k.startsWith(m[1] + ':')).map(k => ({ type: 'blob', path: k.split(':')[1] })) }) };
    const r = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/[^/]+\/(.+)$/);
    const key = r && `${r[1]}:${decodeURIComponent(r[2])}`;
    if (key && key in files) return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(files[key]) };
    return { ok: false, status: 404 };
  };
  return { fetchFn, calls };
}

test('plan : deja dans CTB, deja disponible, ou a installer', () => {
  const F = fixture();
  const p = lib.plan({ root: F.root, cfg: F.cfg });
  const st = (n) => p.items.find(i => i.name === n);
  assert.strictEqual(st('docx').status, 'present');
  assert.strictEqual(st('pdf').status, 'available');
  assert.strictEqual(st('ux-copy').status, 'available', 'plugin du compte');
  assert.strictEqual(st('design-critique').status, 'install', 'absent du plugin installe');
  assert.strictEqual(st('ponytail').status, 'install');
  assert.match(st('ponytail').source, /github\.com\/DietrichGebert\/ponytail\/tree\/main\/skills\/ponytail$/);
  assert.match(st('unreal-mcp').source, /^vendor\/unreal-mcp-skills\/skills\/unreal-mcp$/);
  assert.ok(p.skipped.some(s => s.names.includes('graphify')), 'graphify jamais installe dans CTB');
  assert.ok(!lib.CATALOG.some(i => /graphify/.test(i.name)));
});

test('apply : copie depuis GitHub et vendor/, ponytail a la main, sans rien ecraser', async () => {
  const F = fixture();
  const { fetchFn, calls } = fakeGithub({
    'DietrichGebert/ponytail:skills/ponytail/SKILL.md': '---\nname: ponytail\ndescription: >\n  Lazy senior dev mode.\nlicense: MIT\n---\n\n# Ponytail\n',
    'DietrichGebert/ponytail:skills/ponytail-review/SKILL.md': md('ponytail-review', 'Review.'),
    'DietrichGebert/ponytail:skills/ponytail-reviewer/SKILL.md': md('autre', 'Ne doit pas etre pris par ponytail-review.'),
    'anthropics/skills:skills/docx/SKILL.md': md('docx', 'Ne doit pas ecraser celui de CTB.'),
  });
  const p = lib.plan({ root: F.root, cfg: F.cfg, only: ['ponytail', 'ponytail-review', 'unreal-mcp', 'docx', 'pptx'] });
  const res = await lib.apply(p, { fetchFn });
  const by = Object.fromEntries(res.map(r => [r.name, r]));
  assert.ok(by.ponytail.ok && by['ponytail-review'].ok && by['unreal-mcp'].ok, JSON.stringify(res));
  assert.strictEqual(by.pptx.ok, false, 'introuvable : echec signale');
  assert.ok(!('docx' in by), 'deja present : pas touche');
  const sk = (n) => path.join(F.root, '.claude', 'skills', n);
  const pony = fs.readFileSync(path.join(sk('ponytail'), 'SKILL.md'), 'utf8');
  assert.match(pony, /license: MIT\ndisable-model-invocation: true\n---/);
  assert.match(fs.readFileSync(path.join(sk('docx'), 'SKILL.md'), 'utf8'), /Deja copie dans CTB/);
  assert.ok(!fs.existsSync(path.join(sk('ponytail-review'), 'ponytail-reviewer')));
  assert.ok(fs.existsSync(path.join(sk('unreal-mcp'), 'references', 'setup.md')), 'fichiers annexes copies');
  assert.strictEqual(calls.filter(u => u.includes('/git/trees/')).length, 2, 'un arbre par depot');
  assert.deepStrictEqual(fs.readdirSync(path.join(F.root, '.claude', 'skills')).filter(n => n.startsWith('.')), [], 'aucun dossier temporaire laisse');
  // relance : tout est deja la
  const again = lib.plan({ root: F.root, cfg: F.cfg, only: ['ponytail', 'unreal-mcp'] });
  assert.deepStrictEqual(again.items.map(i => i.status), ['present', 'present']);
});

test('ponytail automatique sur demande, en-tete deja manuel laisse tel quel', () => {
  const t = '---\nname: x\ndisable-model-invocation: true\n---\nCorps';
  assert.strictEqual(lib.makeManual(t), t);
  assert.strictEqual(lib.makeManual('---\nname: x\n---\nCorps'), '---\nname: x\ndisable-model-invocation: true\n---\nCorps');
});

test('le script montre sans ecrire, puis refuse un dossier sans .uproject', async () => {
  const F = fixture();
  const { main } = require('../scripts/skills-ctb');
  const lines = [];
  const log = console.log;
  console.log = (s) => lines.push(s);
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = F.cfg;
  try {
    assert.strictEqual(await main([F.root]), 0);
    assert.strictEqual(await main([F.base]), 2);
  } finally { console.log = log; if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
  const out = lines.join('\n');
  assert.match(out, /Rien n'a ete ecrit/);
  assert.match(out, /ponytail  \(a la main : \/ponytail\)/);
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(out), 'sortie ASCII');
  assert.ok(!fs.existsSync(path.join(F.root, '.claude', 'skills', 'ponytail')));
});
