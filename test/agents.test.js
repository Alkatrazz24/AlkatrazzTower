'use strict';
// Le quartier des agents : inventaire (integres, perso, projet, plugins), en-tete de chaque agent,
// acces aux skills, et usage lu dans les journaux de Claude Code (appels de l'outil Agent et leurs tokens).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const skills = require('../lib/skills');
const agents = require('../lib/agents');

function write(f, text) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
const skill = (name) => `---\nname: ${name}\ndescription: Un skill de test assez long pour être valide.\n---\n\nFais ceci.\n`;

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-agents-'));
  const cfg = path.join(base, 'claude');
  const proj = path.join(base, 'CTB 5.8');
  write(path.join(cfg, 'skills', 'ue-animation-system', 'SKILL.md'), skill('ue-animation-system'));
  write(path.join(proj, '.claude', 'skills', 'ctb-webui', 'SKILL.md'), skill('ctb-webui'));
  const A = (n, head, body = 'Tu es un spécialiste.\n') => write(path.join(proj, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\n${head}---\n\n${body}`);
  A('ctb-animation', 'section: Animation\ndescription: "Animations : montages et gestes."\n', 'Lis la doc.\n- Skills utiles : ue-animation-system,\n  ue-character-movement.\n');
  A('ctb-interface', 'section: Interface\ndescription: La WebUI du jeu\ndisallowedTools: Agent, Workflow\nskills:\n  - ctb-webui\n  - absent-ici\n', 'La skill `ctb-webui` est déjà chargée.\n');
  A('ctb-relecteur', 'description: Relit avant terminé\ntools: Read, Grep, Glob, Bash\n', 'Skills utiles : ue-animation-system.\n');
  A('ctb-menus', 'description: Les menus\ntools: [Read, Edit, Skill]\n');
  A('sans-desc', '');
  write(path.join(proj, '.claude', 'agents', 'Explore.md'), '---\nname: Explore\ndescription: Exploration maison, sur haiku.\nmodel: haiku\n---\n\nCherche.\n');
  write(path.join(cfg, 'agents', 'revue-cpp.md'), '---\nname: revue-cpp\ndescription: Relecteur C++ pour tous les projets.\n---\n\nRelis.\n');
  write(path.join(cfg, 'agents', 'ctb-menus.md'), '---\nname: ctb-menus\ndescription: Version perso des menus.\n---\n\nMenus.\n');
  write(path.join(cfg, 'plugins', 'cache', 'mkt', 'outils', '1.0.0', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews code.\n---\n\nReview.\n');
  return { base, cfg, proj, projects: [{ name: 'ConquerTheBackrooms', root: proj }] };
}

const get = (inv, call) => inv.agents.find(a => a.call === call && a.scope !== 'integre') || inv.agents.find(a => a.call === call);

test('inventaire : integres, perso, projet et plugin, avec leur en-tete', () => {
  const F = fixture();
  const sk = skills.scan({ cfg: F.cfg, projects: F.projects });
  const inv = agents.scan({ cfg: F.cfg, projects: F.projects, skills: sk });
  for (const n of ['general-purpose', 'Explore', 'Plan']) assert.ok(inv.agents.some(a => a.scope === 'integre' && a.name === n), n);
  assert.strictEqual(get(inv, 'revue-cpp').scope, 'perso');
  const pl = get(inv, 'outils:reviewer');
  assert.strictEqual(pl.scope, 'plugin');
  assert.ok(pl.issues.some(i => /activé nulle part/.test(i.text)));

  const anim = get(inv, 'ctb-animation');
  assert.strictEqual(anim.section, 'Animation');
  assert.match(anim.description, /montages/);
  assert.strictEqual(anim.canSkill, true, 'sans tools: il herite de Skill');
  assert.deepStrictEqual(anim.cites.map(c => [c.name, c.ok]), [['ue-animation-system', true], ['ue-character-movement', false]], 'liste sur deux lignes');
  assert.ok(anim.issues.some(i => /ue-character-movement/.test(i.text)));

  const ui = get(inv, 'ctb-interface');
  assert.deepStrictEqual(ui.disallowed, ['Agent', 'Workflow']);
  assert.deepStrictEqual(ui.preload.map(p => [p.name, p.ok]), [['ctb-webui', true], ['absent-ici', false]]);
  assert.deepStrictEqual(ui.cites, [], 'un skill precharge n\'est pas compte comme cite');
  assert.ok(ui.issues.some(i => /Précharge absent-ici/.test(i.text)));

  const rel = get(inv, 'ctb-relecteur');
  assert.deepStrictEqual(rel.tools, ['Read', 'Grep', 'Glob', 'Bash']);
  assert.strictEqual(rel.canSkill, false);
  assert.ok(rel.issues.some(i => /n'a pas Skill/.test(i.text)));
  assert.strictEqual(get(inv, 'ctb-menus').canSkill, true, 'tools en [liste] avec Skill');

  assert.strictEqual(get(inv, 'sans-desc').issues[0].level, 'ko');
  // l'agent du projet passe avant l'agent perso du meme nom
  assert.ok(inv.agents.find(a => a.scope === 'perso' && a.name === 'ctb-menus').issues.some(i => /passe avant lui/.test(i.text)));
  assert.deepStrictEqual(inv.agents.find(a => a.scope === 'integre' && a.name === 'Explore').hiddenIn, ['ConquerTheBackrooms']);
});

test('usage : appels de l\'outil Agent, tokens rendus, et l\'agent du projet avant le perso', async () => {
  const F = fixture();
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  let k = 0;
  const call = (type, at, sid, cwd, tokens) => {
    const id = `toolu_${++k}`;
    return [JSON.stringify({ type: 'assistant', sessionId: sid, cwd, timestamp: iso(at), message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: type, description: `tâche ${k}` } }] } }),
      tokens == null ? null : JSON.stringify({ type: 'user', sessionId: sid, cwd, timestamp: iso(at + 1000), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'fini' }] }, toolUseResult: { status: 'completed', totalTokens: tokens } })].filter(Boolean);
  };
  write(path.join(F.cfg, 'projects', 'C--CTB', 's1.jsonl'), [
    ...call('ctb-animation', now - 3600_000, 's1', F.proj, 120_000),
    ...call('ctb-animation', now - 60_000, 's2', path.join(F.proj, 'Source'), 30_000),
    ...call('ctb-menus', now - 5000, 's1', F.proj, 1000),
    ...call('ctb-menus', now - 4000, 's1', path.join(F.base, 'ailleurs'), 2000),
    ...call('Explore', now - 3000, 's1', path.join(F.base, 'ailleurs'), null), // en cours : pas encore de tokens
    ...call('ctb-animation', now - 40 * 86400_000, 's1', F.proj, 9), // trop vieux
    ...call('fantome', now - 1000, 's1', F.proj, 5),
  ].join('\n') + '\n');
  const sk = skills.scan({ cfg: F.cfg, projects: F.projects });
  const inv = agents.scan({ cfg: F.cfg, projects: F.projects, skills: sk });
  const R = agents.withUsage(inv, await skills.readAgentUsage({ cfg: F.cfg, now }), { now });
  const anim = R.agents.find(a => a.call === 'ctb-animation');
  assert.strictEqual(anim.uses, 2);
  assert.strictEqual(anim.sessions, 2);
  assert.strictEqual(anim.tokens, 150_000);
  assert.deepStrictEqual(anim.usedIn, ['ConquerTheBackrooms']);
  assert.strictEqual(anim.recent[0].what, 'tâche 2', 'le plus recent d\'abord');
  assert.strictEqual(R.agents.find(a => a.scope === 'projet' && a.name === 'ctb-menus').uses, 1, 'dans le projet : celui du projet');
  assert.strictEqual(R.agents.find(a => a.scope === 'perso' && a.name === 'ctb-menus').uses, 1, 'ailleurs : le perso');
  const ex = R.agents.find(a => a.scope === 'integre' && a.name === 'Explore');
  assert.strictEqual(ex.uses, 1);
  assert.strictEqual(ex.tokens, 0);
  assert.deepStrictEqual(R.unknown.map(u => u.name), ['fantome']);
  assert.strictEqual(R.agents[0].section, agents.BUILTIN_SECTION, 'les integres d\'abord');
  assert.strictEqual(R.total, R.ko + R.warn + R.unused + R.ok);
  assert.strictEqual(R.agents.some(a => 'root' in a), false);
  assert.strictEqual(anim.status, 'warn', 'il cite un skill absent');
  assert.strictEqual(R.agents.find(a => a.call === 'revue-cpp').status, 'unused');

  // le fichier d'un agent se lit par son id ; un integre n'en a pas
  assert.match(agents.readFileOf(inv, anim.id).text, /ctb-animation/);
  assert.strictEqual(agents.readFileOf(inv, ex.id).ok, false);
});

test('skills cites dans les consignes', () => {
  assert.deepStrictEqual(agents.citedSkills('Skills utiles : ue-a, ue-b.\nInvoque la skill `ctb-blockout` pour les niveaux.'), ['ue-a', 'ue-b', 'ctb-blockout']);
  assert.deepStrictEqual(agents.citedSkills('Rien de special ici : pas de skill.'), []);
});
