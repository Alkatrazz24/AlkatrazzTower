'use strict';
// Le suivi des modifications : qui a ecrit quelle doc, qui a commite quoi, qui a pousse ou, et avec
// quel resultat. Un journal unique, lu par les batiments Documentation et Depots.
//
// Trois sortes d'entrees, toutes venues des hooks (PostToolUse et PostToolUseFailure) :
//   - doc    : une session ou un agent ecrit dans docs/ ou une skill du projet (lib/docs.js) ; on garde
//              les fichiers du jeu que cette doc couvre et si c'est la tour qui l'a demandee ;
//   - commit : un « git commit » lance par une session, avec sa sortie (branche, sha, fichiers) ;
//   - push   : un « git push », avec sa destination et son resultat (envoye, a jour, refuse, erreur).
// Le serveur complete ensuite un commit avec la liste de ses fichiers (git show), sans rien ecrire.
// Aucune E/S ici sauf commitInfo, pour tout tester sans serveur.

const path = require('path');

const MAX = 300;
const MAX_FILES = 30;

// ---- la commande ----------------------------------------------------------------------------
// Les commandes git d'une ligne de shell (Bash ou PowerShell), separees par &&, ||, ;, | ou un retour.
// « git -C dossier commit », « git -c cle=val push » comptent ; « git stash push » ou « git commit-tree », non.
// Une seule facon de lire chaque option : la regle ne peut pas exploser sur une ligne piegee.
const GIT_SEG = /^\s*(?:&\s*)?(?:sudo\s+)?git(?:\.exe)?((?:\s+(?:-c\s+(?:"[^"]*"|'[^']*'|[^\s-]\S*)|(?!-c\s)--?\w[\w-]*(?:=\S+)?))*)\s+(commit|push)(?=\s|$)(.*)$/i;
function gitCommands(command) {
  const out = [];
  const text = String(command || '');
  // le message d'un commit peut tenir sur plusieurs lignes (heredoc) : on decoupe quand meme, seul le
  // debut de chaque segment compte
  for (const seg of text.split(/&&|\|\||[;\n|]/)) {
    const m = GIT_SEG.exec(seg);
    if (!m) continue;
    const c = /-C\s+("([^"]*)"|'([^']*)'|(\S+))/.exec(m[1] || '');
    out.push({ verb: m[2].toLowerCase(), dir: c ? (c[2] ?? c[3] ?? c[4]) : null, args: m[3].trim() });
  }
  return out;
}

// Le message d'un commit tel qu'ecrit dans la commande (quand la sortie ne le donne pas).
function messageOf(command) {
  const m = /\bcommit\b[\s\S]*?(?:\s-m|\s--message)(?:=|\s+)("((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(String(command || ''));
  if (!m) return '';
  let msg = m[2] ?? m[3] ?? m[4] ?? '';
  // -m "$(cat <<'EOF' ... EOF)" : la premiere ligne apres le marqueur
  if (/^\$\(cat\s+<</.test(msg)) msg = String(command).split(/<<-?\s*'?"?EOF'?"?\s*\r?\n/)[1] || '';
  return msg.split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
}

// Ou pousse « git push origin main » : { remote, ref }.
function pushTarget(args) {
  const words = String(args || '').split(/\s+/).filter(w => w && !w.startsWith('-'));
  return { remote: words[0] || '', ref: words[1] || '' };
}

// ---- la sortie ------------------------------------------------------------------------------
// « [main 1a2b3c4] Le message » puis « 3 files changed, 10 insertions(+), 2 deletions(-) ».
function parseCommitOut(text) {
  const s = String(text || '');
  const head = /^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.*)$/m.exec(s);
  if (head) {
    const st = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(s);
    return { state: 'ok', branch: head[1], short: head[2].slice(0, 7), subject: head[3].trim(), files: st ? +st[1] : null, ins: st && st[2] ? +st[2] : 0, del: st && st[3] ? +st[3] : 0 };
  }
  if (/nothing to commit|no changes added to commit|nothing added to commit/i.test(s)) return { state: 'nothing' };
  const err = s.split(/\r?\n/).map(l => l.trim()).find(l => /^(fatal|error):/i.test(l));
  if (err) return { state: 'error', error: err.slice(0, 200) };
  return null;
}

// « To https://github.com/a/b.git » puis une ligne par branche : « abc..def  main -> main »,
// « * [new branch]  x -> x », « + abc...def  main -> main (forced update) », « ! [rejected]  main -> main (fetch first) ».
function parsePushOut(text) {
  const s = String(text || '');
  const to = /^To\s+(\S+)/m.exec(s);
  const refs = [];
  for (const l of s.split(/\r?\n/)) {
    const m = /^\s*([ +*!=-])\s+(\[[^\]]+\]|[0-9a-f]+\.\.\.?[0-9a-f]+)\s+(\S+)\s+->\s+(\S+)(?:\s+\((.+)\))?\s*$/.exec(l);
    if (!m) continue;
    const what = m[1] === '!' ? 'rejected' : m[1] === '+' ? 'forced' : m[1] === '*' ? 'new' : m[1] === '=' ? 'same' : m[1] === '-' ? 'deleted' : 'update';
    refs.push({ from: m[3], to: m[4], what, range: /\.\./.test(m[2]) ? m[2] : '', why: m[5] || '' });
  }
  const url = to ? to[1].replace(/\/\/[^@/]+@/, '//') : ''; // jamais d'identifiant dans la page
  const err = s.split(/\r?\n/).map(l => l.trim()).find(l => /^(fatal|error):/i.test(l) && !/failed to push some refs/i.test(l));
  if (refs.some(r => r.what === 'rejected')) return { state: 'rejected', to: url, refs, error: refs.find(r => r.what === 'rejected').why || 'refusé' };
  if (refs.length) return { state: 'ok', to: url, refs };
  if (/Everything up-to-date/i.test(s)) return { state: 'uptodate', to: url, refs };
  if (err || /failed to push/i.test(s)) return { state: 'error', to: url, refs, error: (err || 'git push a échoué').slice(0, 200) };
  return null;
}

// ---- le journal -----------------------------------------------------------------------------
let seq = 0;
const idOf = (at) => `m${at.toString(36)}${(seq++ % 1296).toString(36)}`;

// Qui a fait la modification : la salle (nom de la session dans la tour), l'agent s'il y en a un.
function who(a, ev, salle) {
  return { sessionId: a.sessionId, salle: salle || '', sub: ev.agent_id ? String(ev.agent_type || 'agent') : '', project: a.project ? a.project.name : '' };
}

function add(list, e) {
  list.unshift(e);
  if (list.length > MAX) list.length = MAX;
  return e;
}

// Une ecriture de doc deja reconnue par lib/docs.js : before = le suivi de la doc juste avant.
function docEntry(list, a, ev, rel, before, salle, now = Date.now()) {
  const covers = before ? [...new Set([...(before.pending || []), ...((before.sub && before.sub.pending) || [])])].slice(-12) : [];
  // une doc ecrite alors que la tour la reclamait (doc en retard) : c'est la tour qui l'a demandee
  const asked = !!(before && before.owed);
  // une page reprise plusieurs fois de suite par la meme session : une seule entree, mise a jour
  const last = list.find(x => x.kind === 'doc' && x.sessionId === a.sessionId && x.rel === rel && now - x.at < 10 * 60_000);
  if (last) {
    last.at = now; last.n = (last.n || 1) + 1;
    last.covers = [...new Set([...last.covers, ...covers])].slice(-12);
    last.asked = last.asked || asked;
    if (ev.tool_name === 'Write') last.tool = 'Write';
    return last;
  }
  return add(list, { id: idOf(now), kind: 'doc', at: now, ...who(a, ev, salle), root: a.project ? a.project.root : '', rel, tool: ev.tool_name || '', covers, asked, n: 1 });
}

// Un appel de shell termine (PostToolUse) ou echoue (PostToolUseFailure) : ses git commit et git push.
function gitEntries(list, a, ev, salle, now = Date.now()) {
  if (!ev || !/^(PostToolUse|PostToolUseFailure)$/.test(ev.hook_event_name || '') || !/^(Bash|PowerShell)$/.test(ev.tool_name || '')) return [];
  const command = ev.tool_input && ev.tool_input.command;
  const cmds = gitCommands(command);
  if (!cmds.length) return [];
  const failed = ev.hook_event_name === 'PostToolUseFailure';
  const out = String(ev.git_out || '') + (failed && ev.error ? `\n${ev.error}` : '');
  const made = [];
  for (const c of cmds) {
    const cwd = c.dir ? (path.isAbsolute(c.dir) || /^[a-z]:[\\/]/i.test(c.dir) ? c.dir : path.join(ev.cwd || a.cwd || '', c.dir)) : (ev.cwd || a.cwd || '');
    const base = { at: now, ...who(a, ev, salle), cwd, root: '', repo: '' };
    if (c.verb === 'commit') {
      const r = parseCommitOut(out) || (failed ? { state: 'error', error: String(ev.error || 'git commit a échoué').split(/\r?\n/)[0].slice(0, 200) } : { state: 'unknown' });
      if (r.state === 'nothing') continue; // rien a commiter : pas une modification
      made.push(add(list, { id: idOf(now), kind: 'commit', ...base, subject: r.subject || messageOf(command), ...r, amend: /--amend\b/.test(c.args) }));
    } else {
      const r = parsePushOut(out) || (failed ? { state: 'error', error: String(ev.error || 'git push a échoué').split(/\r?\n/)[0].slice(0, 200), refs: [] } : { state: 'unknown', refs: [] });
      const t = pushTarget(c.args);
      made.push(add(list, { id: idOf(now), kind: 'push', ...base, remote: t.remote, ref: t.ref, force: /(^|\s)(-f|--force(-with-lease)?)(\s|=|$)/.test(c.args), ...r }));
    }
  }
  return made;
}

// Le journal enregistre et relu au redemarrage : on garde ce qui a la bonne forme.
function restore(list) {
  return (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object' && ['doc', 'commit', 'push'].includes(e.kind) && Number.isFinite(e.at)).slice(0, MAX);
}

// ---- les fichiers d'un commit (le serveur, avec lib/git.js) ---------------------------------
// git show du commit (ou de HEAD si la sortie n'a rien dit) : son sha complet, son message, ses fichiers.
async function commitInfo(run, root, sha) {
  const r = await run(['--no-optional-locks', '-c', 'core.quotepath=false', 'show', '--no-renames', '--name-only', '--format=%H%x1f%s%x1f%an%x1f%ct', sha || 'HEAD', '--'], root, { timeout: 15_000 });
  if (!r.ok) return null;
  const lines = r.out.split(/\r?\n/);
  const [full, subject, author, ct] = (lines.shift() || '').split('\x1f');
  if (!/^[0-9a-f]{40}$/.test(full || '')) return null;
  const files = lines.map(l => l.trim()).filter(Boolean);
  return { sha: full, short: full.slice(0, 7), subject: subject || '', author: author || '', ct: (+ct || 0) * 1000, count: files.length, list: files.slice(0, MAX_FILES) };
}

// Ce que la page montre : le journal, et pour chaque doc, si elle est deja dans un commit.
function view(list) {
  const commits = list.filter(e => e.kind === 'commit' && Array.isArray(e.list));
  return list.map(e => {
    if (e.kind !== 'doc') return e;
    const c = commits.find(k => k.at >= e.at && sameRoot(k.root, e.root) && k.list.includes(e.rel));
    return c ? { ...e, commit: { short: c.short, at: c.at } } : e;
  });
}
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const sameRoot = (a, b) => !!a && !!b && normPath(a) === normPath(b);

module.exports = { gitCommands, messageOf, pushTarget, parseCommitOut, parsePushOut, docEntry, gitEntries, restore, commitInfo, view, sameRoot, MAX };
