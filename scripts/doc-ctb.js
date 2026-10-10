#!/usr/bin/env node
'use strict';
// Ecrit la regle « doc obligatoire » dans un projet Unreal : son CLAUDE.md et ses agents (.claude/agents),
// et assouplit la consigne de lire la doc Unreal avant chaque API (mode « question »).
//
//   node scripts/doc-ctb.js "<dossier du projet>"            montre ce qui changerait, ne touche a rien
//   node scripts/doc-ctb.js "<dossier du projet>" --apply    l'ecrit (copie de chaque fichier avant, dans
//                                                            Saved/Tour/sauvegardes/doc-ctb-<date>/)
//   --unreal modif                                           garde la lecture avant chaque modification
//
// Idempotent : un fichier qui porte deja la marque n'est pas touche une seconde fois. Rien d'autre n'est
// modifie : on ajoute une section a la fin du fichier, et on remplace une seule phrase dans les agents.
// Sorties en ASCII (console PowerShell).

const fs = require('fs');
const path = require('path');

const MARK = '<!-- alkatrazz-tower:doc-obligatoire -->';

function claudeSection(mode) {
  const unreal = mode === 'modif'
    ? 'Pour Unreal Engine, on vérifie dans la doc officielle de la version du projet avant chaque modification qui'
      + '\nutilise une API'
    : 'Pour Unreal Engine, la doc officielle se consulte quand on se demande comment créer ou utiliser quelque'
      + '\nchose, pas à chaque modification';
  return `

## Documentation obligatoire

${MARK}
Toute session et tout agent qui modifie le jeu (\`Source/\`, \`Content/\`, \`Config/\`, \`Plugins/\`, \`tools/\`, le
\`.uproject\`) écrit ou met à jour sa doc dans \`docs/\` avant de rendre la main : ce qui a changé, où, pourquoi,
comment le tester. \`docs/README.md\` dit où écrire quoi ; on met à jour la page du sujet quand elle existe
plutôt que d'en créer une. La tour (Alkatrazz Tower) vérifie : tant qu'une modification du jeu n'est suivie
d'aucune écriture dans \`docs/\`, elle fait continuer la session ou l'agent pour qu'il l'écrive. Le chef de
chantier le rappelle dans le brief de chaque spécialiste.

En cas de question sur le projet, cherche d'abord dans \`docs/\` (\`docs/COMPRENDRE.md\` pour comprendre le jeu,
quand elle existe). ${unreal} : le rayon par thème est dans
\`Saved/Tour/doc-unreal.md\`, et ali le lit dans le bâtiment Documentation de la tour.
`;
}

const AGENT_SECTION = `

## Doc obligatoire

${MARK}
Si tu modifies le jeu, écris ou mets à jour ta doc dans \`docs/\` avant de rendre la main (\`docs/README.md\` dit
où) : ce qui a changé, où, pourquoi, comment le tester. La tour te fait continuer tant que ce n'est pas fait.
Dis au chef quelle page tu as écrite.
`;

// La phrase des agents qui demande de lire la doc avant chaque API, quelle que soit sa mise en ligne.
const OLD_WORDS = "Vérifie dans la doc officielle d'Unreal 5.8 (`?application_version=5.8`) ou dans les en-têtes du moteur installé avant d'utiliser une API.";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OLD = new RegExp(OLD_WORDS.split(' ').map(esc).join('\\s+'));
function newSentence(ws) {
  return `En cas de doute sur une API ou sur la façon de créer quelque chose, consulte la doc officielle${ws}d'Unreal 5.8 (\`?application_version=5.8\`, rayon par thème : \`Saved/Tour/doc-unreal.md\`) ou les en-têtes${ws}du moteur installé.`;
}

// Ce qui changerait dans le projet : [{ file, rel, before, after, what }].
function plan(root, { mode = 'question' } = {}) {
  const out = [];
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const claude = path.join(root, 'CLAUDE.md');
  const c = read(claude);
  if (c != null && !c.includes(MARK)) out.push({ file: claude, rel: 'CLAUDE.md', before: c, after: c.replace(/\s*$/, '') + claudeSection(mode), what: ['section « Documentation obligatoire » ajoutée à la fin'] });
  const dir = path.join(root, '.claude', 'agents');
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.md')).sort(); } catch { /* pas d'agents */ }
  for (const n of names) {
    const f = path.join(dir, n), t = read(f);
    if (t == null) continue;
    let after = t;
    const what = [];
    if (mode !== 'modif') {
      const m = OLD.exec(after);
      if (m) {
        const ws = (/\s*\n\s*/.exec(m[0]) || [' '])[0];
        after = after.replace(OLD, newSentence(ws.includes('\n') ? ws : ' '));
        what.push('doc Unreal : en cas de doute, plus avant chaque API');
      }
    }
    if (!after.includes(MARK)) { after = after.replace(/\s*$/, '') + AGENT_SECTION; what.push('section « Doc obligatoire » ajoutée à la fin'); }
    if (after !== t) out.push({ file: f, rel: `.claude/agents/${n}`, before: t, after, what });
  }
  return out;
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»]/g, '"').replace(/[^\x20-\x7e\n]/g, '?');

function apply(root, changes) {
  const bak = path.join(root, 'Saved', 'Tour', 'sauvegardes', `doc-ctb-${stamp()}`);
  for (const ch of changes) {
    const b = path.join(bak, ...ch.rel.split('/'));
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.writeFileSync(b, ch.before, 'utf8');
    fs.writeFileSync(ch.file, ch.after, 'utf8');
  }
  return bak;
}

function main() {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--') && a !== 'question' && a !== 'modif');
  const i = args.indexOf('--unreal');
  const mode = i >= 0 && args[i + 1] === 'modif' ? 'modif' : 'question';
  if (!root || !fs.existsSync(root) || !fs.readdirSync(root).some(n => n.endsWith('.uproject'))) {
    console.error('Usage : node scripts/doc-ctb.js "<dossier du projet Unreal>" [--apply] [--unreal modif]');
    process.exit(1);
  }
  const changes = plan(root, { mode });
  if (!changes.length) { console.log('Rien a changer : la regle est deja ecrite partout.'); return; }
  for (const ch of changes) console.log(`${ch.rel} : ${ascii(ch.what.join(' ; '))}`);
  if (!args.includes('--apply')) {
    console.log(`\n${changes.length} fichier(s). Essai seulement : relance avec --apply pour ecrire.`);
    return;
  }
  const bak = apply(root, changes);
  console.log(`\n${changes.length} fichier(s) ecrit(s). Copies d'avant : ${bak}`);
}

if (require.main === module) main();

module.exports = { plan, apply, MARK, OLD };
