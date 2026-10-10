'use strict';
// La bibliotheque des skills : inventaire (perso, compte, projet, plugins), verification de chaque
// SKILL.md, usage lu dans les journaux de Claude Code, et ajout d'un skill.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const skills = require('../lib/skills');

function write(f, text) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
const md = (name, desc, body = '\n# Titre\n\nFais ceci.\n') => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;

// Un faux ~/.claude et un faux projet, avec un peu de tout.
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-skills-'));
  const cfg = path.join(base, 'claude');
  const proj = path.join(base, 'CTB 5.8');
  write(path.join(cfg, 'skills', 'revue-ue', 'SKILL.md'), md('revue-ue', '"Relis du C++ Unreal : UPROPERTY, réplication, GC. Utilise ce skill avant chaque commit."'));
  write(path.join(cfg, 'skills', 'sans-desc', 'SKILL.md'), '---\nname: sans-desc\n---\n\nRien.\n');
  write(path.join(cfg, 'skills', 'vide', 'notes.txt'), 'pas de SKILL.md');
  write(path.join(cfg, 'skills', 'deux-points', 'SKILL.md'), md('deux-points', 'Utilise ce skill quand: le build casse et que tu dois lire le log complet'));
  write(path.join(cfg, 'skills', 'lien-casse', 'SKILL.md'), md('lien-casse', 'Utilise ce skill pour les blueprints de portes et leurs tests', '\nVoir [la ref](references/portes.md) et `[pas un lien](x.md)`.\n'));
  write(path.join(cfg, 'skills', 'synced', 'compte1', 'docx', 'SKILL.md'), md('docx', '"Word documents: create, edit and read .docx files for the user."'));
  write(path.join(proj, '.claude', 'skills', 'ctb-portes', 'SKILL.md'), md('ctb-portes', 'Les portes de CTB : ouverture, coup de pied, réplication, tests CTB.Portes.'));
  write(path.join(proj, '.claude', 'skills', 'revue-ue', 'SKILL.md'), md('revue-ue', 'Revue C++ propre a CTB, avec ses conventions et ses tests automatiques.'));
  // plugin installe dans le cache, active dans le projet ; un autre installe mais active nulle part
  write(path.join(cfg, 'plugins', 'cache', 'mkt', 'agent-skills', '1.0.0', 'skills', 'spec', 'SKILL.md'), md('spec', 'Écrire une spec avant de coder une fonctionnalité non triviale.'));
  write(path.join(cfg, 'plugins', 'cache', 'mkt', 'dormant', '0.1.0', 'skills', 'zzz', 'SKILL.md'), md('zzz', 'Un skill de plugin que personne n\'a activé, pour le test.'));
  write(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'agent-skills@mkt': true, 'absent@mkt': true } }));
  write(path.join(cfg, 'settings.json'), JSON.stringify({ enabledPlugins: { 'dormant@mkt': false } }));
  return { base, cfg, proj, projects: [{ name: 'ConquerTheBackrooms', root: proj }] };
}

const byCall = (inv, call, where) => inv.skills.find(s => s.call === call && (!where || s.where === where));

test('inventaire : perso, compte, projet et plugins, avec ce qui cloche', () => {
  const F = fixture();
  const inv = skills.scan({ cfg: F.cfg, projects: F.projects });
  const ok = byCall(inv, 'revue-ue', 'Perso');
  assert.ok(ok, 'skill perso trouve');
  assert.match(ok.description, /UPROPERTY/);
  assert.ok(byCall(inv, 'docx', 'Compte claude.ai'), 'skill du compte trouve');
  assert.ok(byCall(inv, 'ctb-portes', 'ConquerTheBackrooms'), 'skill du projet trouve');
  assert.ok(byCall(inv, 'agent-skills:spec'), 'skill de plugin appele plugin:nom');

  const levels = (call) => byCall(inv, call, 'Perso').issues.map(i => i.level);
  assert.deepStrictEqual(levels('sans-desc'), ['ko']);
  assert.deepStrictEqual(levels('vide'), ['ko']);
  assert.ok(byCall(inv, 'deux-points').issues.some(i => /« : » sans guillemets/.test(i.text)));
  const lien = byCall(inv, 'lien-casse').issues.map(i => i.text).join(' ');
  assert.match(lien, /references\/portes\.md/);
  assert.doesNotMatch(lien, /x\.md/, 'un lien dans du code n\'est pas un fichier cite');
  // meme nom en perso et dans le projet
  assert.ok(byCall(inv, 'revue-ue', 'ConquerTheBackrooms').issues.some(i => /Même nom/.test(i.text)));

  const pl = (id) => inv.plugins.find(p => p.id === id);
  assert.deepStrictEqual(pl('agent-skills@mkt').enabled, ['ConquerTheBackrooms']);
  assert.match(pl('dormant@mkt').issues[0].text, /désactivé/);
  assert.ok(byCall(inv, 'dormant:zzz').issues.some(i => /activé nulle part/.test(i.text)));
  assert.strictEqual(pl('absent@mkt').installed, false);
});

test('en-tete : blocs, guillemets, et ce qui le rend illisible', () => {
  const p = skills.parseSkill('---\nname: a\ndescription: >\n  Ligne un\n  ligne deux\n---\nCorps');
  assert.strictEqual(p.fm.description, 'Ligne un ligne deux');
  assert.strictEqual(p.body, 'Corps');
  const q = skills.parseSkill('---\nname: a\ndescription: "Il dit : \\"oui\\""\n---\n');
  assert.strictEqual(q.fm.description, 'Il dit : "oui"');
  assert.deepStrictEqual(q.problems, []);
  assert.strictEqual(skills.parseSkill('---\ndescription: "jamais ferme\n---\n').problems[0].level, 'ko');
  assert.strictEqual(skills.parseSkill('pas d\'en-tete').fm, null);
});

test('usage : appels de l\'outil Skill et commandes tapees, dans les 30 derniers jours', async () => {
  const F = fixture();
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const line = (o) => JSON.stringify(o);
  const tool = (skill, at, sid, cwd) => line({ type: 'assistant', sessionId: sid, cwd, timestamp: iso(at), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } });
  const typed = (cmd, at, sid, cwd) => line({ type: 'user', sessionId: sid, cwd, timestamp: iso(at), message: { role: 'user', content: `<command-message>${cmd}</command-message>\n<command-name>/${cmd}</command-name>` } });
  write(path.join(F.cfg, 'projects', 'C--CTB', 's1.jsonl'), [
    tool('revue-ue', now - 3600_000, 's1', F.proj),
    tool('agent-skills:spec', now - 7200_000, 's1', F.proj),
    typed('ctb-portes', now - 60_000, 's1', path.join(F.proj, 'Source')),
    tool('revue-ue', now - 40 * 86400_000, 's1', F.proj), // trop vieux
    tool('simplify', now - 1000, 's1', F.proj), // pas sur le disque
    typed('clear', now - 1000, 's1', F.proj), // commande integree : ignoree
  ].join('\n') + '\n');
  write(path.join(F.cfg, 'projects', 'C--Users', 's2', 'subagents', 'agent-1.jsonl'), tool('revue-ue', now - 5000, 's2', path.join(F.base, 'ailleurs')) + '\n');
  const inv = skills.scan({ cfg: F.cfg, projects: F.projects });
  const calls = await skills.readUsage({ cfg: F.cfg, now });
  const lib = skills.withUsage(inv, calls, { now });
  const get = (call, where) => lib.skills.find(s => s.call === call && (!where || s.where === where));
  // dans le projet, « revue-ue » est celui du projet ; ailleurs, le perso
  assert.strictEqual(get('revue-ue', 'ConquerTheBackrooms').uses, 1);
  assert.strictEqual(get('revue-ue', 'Perso').uses, 1);
  assert.strictEqual(get('agent-skills:spec').uses, 1);
  const portes = get('ctb-portes');
  assert.strictEqual(portes.uses, 1);
  assert.strictEqual(portes.typed, 1);
  assert.deepStrictEqual(portes.usedIn, ['ConquerTheBackrooms']);
  assert.strictEqual(get('docx').status, 'unused');
  assert.strictEqual(get('sans-desc').status, 'ko');
  assert.deepStrictEqual(lib.unknown.map(u => u.name), ['simplify']);
  assert.strictEqual(lib.skills[0].status, 'ko', 'les casses d\'abord');
  assert.strictEqual(lib.total, lib.ko + lib.warn + lib.unused + lib.ok);
  assert.strictEqual(lib.skills.some(s => 'root' in s || 'dir' in s), false);

  // le journal grandit : seule la suite est relue
  fs.appendFileSync(path.join(F.cfg, 'projects', 'C--CTB', 's1.jsonl'), tool('docx', now - 500, 's1', F.proj) + '\n');
  const again = skills.withUsage(inv, await skills.readUsage({ cfg: F.cfg, now }), { now });
  assert.strictEqual(again.skills.find(s => s.call === 'docx').uses, 1);
  assert.strictEqual(again.skills.find(s => s.call === 'revue-ue' && s.where === 'Perso').uses, 1);
});

test('ajouter un skill : modele rempli, ou SKILL.md recupere, jamais par-dessus un existant', () => {
  const F = fixture();
  assert.strictEqual(skills.create({ cfg: F.cfg, scope: 'perso', name: 'Mauvais Nom', description: 'x' }).ok, false);
  assert.strictEqual(skills.create({ cfg: F.cfg, scope: 'perso', name: 'revue-ue', description: 'x' }).ok, false, 'existe deja');
  assert.strictEqual(skills.create({ cfg: F.cfg, scope: 'perso', name: 'neuf', description: '' }).ok, false, 'description obligatoire');
  const r = skills.create({ cfg: F.cfg, scope: 'perso', name: 'lecture-logs', description: 'Utilise ce skill quand un build échoue : lis le log complet "UBT".' });
  assert.ok(r.ok, r.error);
  const made = skills.readSkill(path.dirname(r.path), { scope: 'perso', where: 'Perso' });
  assert.deepStrictEqual(made.issues, [], 'le modele est un skill valide');
  assert.match(made.description, /log complet "UBT"/);
  const w = skills.create({ cfg: F.cfg, scope: 'perso', name: 'avec-etapes', description: 'Utilise ce skill pour vérifier une porte en jeu avant de dire que c\'est fini.', body: '1. Lance PIE.\n2. Appuie sur K devant une porte.' });
  assert.match(fs.readFileSync(w.path, 'utf8'), /# Avec Etapes\n\n1\. Lance PIE\.\n2\. Appuie sur K/);
  const p = skills.create({ scope: 'projet', root: F.proj, name: 'importe', text: md('importe', 'Un skill récupéré sur GitHub et montré avant installation.') });
  assert.ok(p.ok);
  assert.ok(fs.existsSync(path.join(F.proj, '.claude', 'skills', 'importe', 'SKILL.md')));
  assert.strictEqual(skills.create({ scope: 'projet', root: F.proj, name: 'pas-skill', text: 'juste du texte' }).ok, false);
});

test('adresse GitHub vers le SKILL.md brut, et telechargement montre avant installation', async () => {
  assert.strictEqual(skills.rawUrl('https://github.com/o/r/blob/main/skills/x/SKILL.md'), 'https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md');
  assert.strictEqual(skills.rawUrl('https://github.com/o/r/tree/main/skills/x'), 'https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md');
  assert.strictEqual(skills.rawUrl('http://exemple.com/SKILL.md'), null, 'https seulement');
  assert.strictEqual(skills.rawUrl('https://github.com/o/r'), null);
  const seen = [];
  const fetchFn = async (url) => { seen.push(url); return { ok: true, status: 200, text: async () => md('Mon Skill', 'Fait une chose précise quand on le lui demande.', '\nVoir [ref](reference.md).\n') }; };
  const r = await skills.fetchSkill('https://github.com/o/r/tree/main/skills/x', { fetchFn });
  assert.ok(r.ok);
  assert.strictEqual(seen[0], 'https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md');
  assert.strictEqual(r.name, 'mon-skill');
  assert.deepStrictEqual(r.links, ['reference.md']);
  const bad = await skills.fetchSkill('https://exemple.com/a', { fetchFn: async () => ({ ok: true, status: 200, text: async () => '<html>' }) });
  assert.strictEqual(bad.ok, false);
});
