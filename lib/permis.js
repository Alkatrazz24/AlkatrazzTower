'use strict';
// Les autorisations que la tour donne seule aux sessions qu'elle lance (hooks/tower-ask.js).
//
// Quand une session demande une permission, la tour regarde d'abord si elle peut repondre seule :
//   - « lecture » (par defaut) : ce qui ne fait que lire passe (lire un fichier, Get-ChildItem,
//     git log...), et une commande qu'ali a deja autorisee une fois aussi (« git commit », « build.bat ») ;
//   - « sauf-suppression » : tout passe sauf ce qui supprime ou ecrase (Remove-Item, rm, git reset --hard...) ;
//   - « tout » : tout passe.
// Le reste arrive dans la tour comme avant, et ali repond d'un clic. Une suppression n'est jamais retenue :
// elle redemande a chaque fois (sauf au niveau « tout »).
//
// La lecture d'une commande est volontairement prudente : au moindre doute (substitution, appel .NET,
// shell imbrique), la commande n'est pas comptee comme lecture et la tour demande.

const NIVEAUX = ['lecture', 'sauf-suppression', 'tout'];
const MAX_RETENUES = 200;

const SHELLS = new Set(['Bash', 'PowerShell']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoRead', 'TodoWrite']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Programmes et cmdlets qui ne font que lire (alias PowerShell compris). Tout Get-* lit aussi.
const READ = new Set([
  'ls', 'dir', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'pwd', 'echo', 'printf', 'which', 'where',
  'stat', 'file', 'du', 'df', 'tree', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink', 'date',
  'whoami', 'hostname', 'uname', 'printenv', 'diff', 'cmp', 'md5sum', 'sha1sum', 'sha256sum', 'jq', 'true', 'test', 'cd',
  'findstr', 'more', 'type', 'nl', 'column', 'ver', 'ps', 'git',
  'gci', 'gc', 'gi', 'gp', 'gl', 'gm', 'gcm', 'gps', 'select', 'sls', 'where', '?', 'measure', 'group', 'ft', 'fl', 'fw',
  'write', 'sl', 'pushd', 'popd', '%', 'foreach', 'compare',
  'select-object', 'select-string', 'select-xml', 'sort-object', 'where-object', 'foreach-object', 'measure-object',
  'group-object', 'compare-object', 'format-table', 'format-list', 'format-wide', 'format-custom', 'out-string', 'out-host',
  'out-null', 'test-path', 'resolve-path', 'split-path', 'join-path', 'convertto-json', 'convertfrom-json', 'convertto-csv',
  'convertfrom-csv', 'write-output', 'write-host', 'set-location', 'push-location', 'pop-location', 'get-unique',
]);
// Verbes PowerShell : un mot Verbe-Nom n'importe ou dans la commande est une cmdlet, qui doit lire.
const VERBS = new Set(('add clear close copy enter exit find format get hide join lock move new open optimize pop push redo remove ' +
  'rename reset resize search select set show skip split step switch undo unlock watch backup checkpoint compare compress ' +
  'convert convertfrom convertto dismount edit expand export group import initialize limit merge mount out publish restore ' +
  'save sync unpublish update approve assert build complete confirm deny deploy disable enable install invoke register ' +
  'request restart resume start stop submit suspend uninstall unregister wait debug measure ping repair resolve test trace ' +
  'connect disconnect read receive send write block grant protect revoke unblock unprotect use foreach where sort tee').split(' '));
// Ce qui supprime, deplace ou ecrase : jamais retenu, jamais passe seul (sauf au niveau « tout »).
const DESTRUCTIVE = new Set(['rm', 'del', 'erase', 'rd', 'rmdir', 'ri', 'rimraf', 'unlink', 'shred', 'mv', 'move', 'mi', 'move-item',
  'taskkill', 'kill', 'stop-process', 'spps', 'format-volume', 'clear-disk', 'clear-recyclebin']);
const NESTED = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'wsl', 'start-process', 'saps', 'start', 'invoke-expression', 'iex',
  'invoke-command', 'icm', 'xargs', 'env', 'sudo', '.']);
// Programmes qui font plusieurs metiers : on retient le metier avec (« git commit », « python creer.py »).
const MULTI = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'python', 'python3', 'py', 'dotnet', 'pip', 'uv', 'cargo', 'winget',
  'choco', 'docker', 'claude', 'gh']);
const SCRIPT_RUNNERS = new Set(['node', 'python', 'python3', 'py']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'describe', 'shortlog',
  'cat-file', 'rev-list', 'show-ref', 'grep', 'check-ignore', 'merge-base', 'count-objects', 'version', 'help']);
const SAFE_METHODS = new Set(['tolower', 'toupper', 'trim', 'trimend', 'trimstart', 'substring', 'split', 'startswith', 'endswith',
  'contains', 'indexof', 'lastindexof', 'tostring', 'gettype', 'padleft', 'padright', 'equals', 'getfilename', 'getextension',
  'getdirectoryname', 'getfilenamewithoutextension', 'format']);
const NULL_TARGETS = new Set(['$null', '/dev/null', 'nul']);

// ---- lire une commande -------------------------------------------------------------------------
// Coupe la commande en segments (|, ;, &&, ||, &, retours a la ligne, accolades, parentheses) hors des
// guillemets. Chaque mot garde s'il etait entre guillemets. Note les redirections vers un fichier et
// les constructions qui peuvent cacher une autre commande.
function parse(command, shell) {
  const s = String(command || '');
  const bash = shell === 'Bash';
  const segs = [[]];
  // call : un appel par & ou une sous-expression $( ) : jamais compte comme lecture (mais retenable)
  let word = null, quote = '', unsafe = false, writes = false, call = false, pendingRedirect = false;
  const targets = []; // fichiers vises par une redirection
  const flush = () => {
    if (word === null) return;
    if (pendingRedirect) {
      pendingRedirect = false;
      if (!NULL_TARGETS.has(word.text.toLowerCase())) { writes = true; targets.push(word.text); }
    } else segs[segs.length - 1].push(word);
    word = null;
  };
  const cut = () => { flush(); if (segs[segs.length - 1].length) segs.push([]); };
  const add = (c, quoted) => { if (word === null) word = { text: '', quoted: false }; word.text += c; if (quoted) word.quoted = true; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) { quote = ''; if (word === null) add('', true); continue; }
      if (quote === '"' && c === '$' && s[i + 1] === '(') unsafe = true;
      if (quote === '"' && bash && c === '`') unsafe = true;
      if (quote === '"' && bash && c === '\\' && i + 1 < s.length) { add(s[++i], true); continue; }
      add(c, true);
      continue;
    }
    if (c === '\'' || c === '"') { quote = c; add('', true); continue; }
    if (bash && c === '\\' && i + 1 < s.length) { add(s[++i], false); continue; }
    if (bash && c === '`') { unsafe = true; continue; }
    if (c === ':' && s[i + 1] === ':') unsafe = true;
    if (c === ' ' || c === '\t') { flush(); continue; }
    if (c === '&' && !bash) { if (s[i + 1] === '&') i++; else call = true; }
    if (c === '$' && s[i + 1] === '(') call = true;
    if ('|;&\n\r{}()'.includes(c)) { cut(); continue; }
    if (c === '<') { flush(); continue; }
    if (c === '>') {
      // 2>&1, *>&1, >&2 : on fusionne des flux, rien n'est ecrit. Sinon la cible est le mot suivant.
      const stream = word && /^[0-9*]$/.test(word.text) && !word.quoted;
      if (stream) word = null; else flush();
      if (s[i + 1] === '>') i++;
      if (s[i + 1] === '&') { i++; while (/[0-9]/.test(s[i + 1] || '')) i++; continue; }
      pendingRedirect = true;
      continue;
    }
    add(c, false);
  }
  if (quote) unsafe = true;
  flush();
  if (pendingRedirect) writes = true;
  // Un appel de methode .NET qui n'est pas dans la liste sure (Delete, MoveTo...) : on ne lit pas.
  for (const m of s.matchAll(/\.([A-Za-z_]\w*)\s*\(/g)) if (!SAFE_METHODS.has(m[1].toLowerCase())) unsafe = true;
  return { segments: segs.filter(x => x.length), unsafe, writes, call, targets };
}

const norm = (w) => String(w || '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|com)$/, '');
const isExpr = (w) => /^[$@[0-9]/.test(w) || /^\.[A-Za-z_]/.test(w); // $x, @(), [type], 12, .Propriete

// Le programme d'un segment et ses arguments (une affectation « $a = ... » regarde ce qui suit le =).
function programOf(words, shell) {
  let i = 0;
  if (shell === 'Bash') while (i < words.length && !words[i].quoted && /^[A-Za-z_]\w*=/.test(words[i].text)) i++;
  if (words[i] && isExpr(words[i].text) && !words[i].quoted) {
    if (words[i + 1] && /^[-+*/]?=$/.test(words[i + 1].text)) i += 2;
    else return { expr: true };
  }
  if (!words[i]) return { expr: true };
  if (words[i].quoted && !/[\\/.]/.test(words[i].text)) return { expr: true }; // une chaine seule s'affiche
  return { prog: norm(words[i].text), raw: words[i].text, args: words.slice(i + 1).map(w => w.text) };
}

function gitSub(args) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '-C' || a === '--git-dir' || a === '--work-tree') { i += 2; continue; }
    if (a === '--no-pager' || /^--(git-dir|work-tree)=/.test(a)) { i++; continue; }
    if (a === '-c' || /^-c/.test(a)) return { bad: true };
    break;
  }
  return { sub: (args[i] || '').toLowerCase(), rest: args.slice(i + 1) };
}

function gitReads(args) {
  const { sub, rest, bad } = gitSub(args);
  if (bad || !sub) return false;
  if (rest.some(a => /^--output/.test(a) || a === '-o' && sub !== 'log')) return false;
  if (GIT_READ.has(sub)) return true;
  const flagsOnly = (ok) => rest.every(a => ok.includes(a));
  if (sub === 'branch') return flagsOnly(['-a', '-r', '-v', '-vv', '-l', '--list', '--show-current', '--all', '--remotes']);
  if (sub === 'remote') return !rest.length || flagsOnly(['-v', '--verbose']) || rest[0] === 'get-url' || rest[0] === 'show';
  if (sub === 'tag') return flagsOnly(['-l', '--list', '-n']);
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  if (sub === 'config') return rest.some(a => ['--get', '--get-all', '--list', '-l', '--get-regexp'].includes(a));
  if (sub === 'reflog') return !rest.length || rest[0] === 'show';
  if (sub === 'worktree') return rest[0] === 'list';
  if (sub === 'lfs') return ['ls-files', 'status', 'env', 'version', 'locks'].includes(rest[0]);
  return false;
}

function gitDestroys(args) {
  const { sub, rest } = gitSub(args);
  const has = (...f) => rest.some(a => f.includes(a));
  switch (sub) {
    // reecrire l'historique compte comme supprimer : un reset qui deplace la branche, un commit --amend
    case 'reset': return has('--hard', '--merge', '--keep', '--soft') || rest.some(a => /^(HEAD[~^@]|ORIG_HEAD|FETCH_HEAD|origin\/|[0-9a-f]{7,40}$)/i.test(a));
    case 'commit': return has('--amend', '--fixup', '--squash');
    case 'replace': return true;
    case 'clean': return !has('-n', '--dry-run');
    case 'checkout': return has('--', '.', '-f', '--force');
    case 'switch': return has('-f', '--force', '--discard-changes');
    case 'restore': case 'rm': case 'rebase': case 'filter-branch': case 'filter-repo': case 'prune': case 'gc': return true;
    case 'push': return has('-f', '--force', '--force-with-lease', '--delete', '-d', '--mirror', '--prune') || rest.some(a => /^\+|^:/.test(a));
    case 'branch': return has('-d', '-D', '--delete', '-M', '-C', '--force', '-f');
    case 'tag': return has('-d', '--delete', '-f', '--force');
    case 'stash': return rest[0] === 'drop' || rest[0] === 'clear';
    case 'reflog': return rest[0] === 'expire' || rest[0] === 'delete';
    case 'update-ref': return has('-d');
    case 'remote': return rest[0] === 'remove' || rest[0] === 'rm';
    case 'worktree': return rest[0] === 'remove' || rest[0] === 'prune';
    case 'lfs': return rest[0] === 'prune';
    default: return false;
  }
}

// Le segment ne fait que lire ?
function segReads(p) {
  if (p.expr) return true;
  const { prog, args } = p;
  if (prog === 'git') return gitReads(args);
  if (prog === 'find') return !args.some(a => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a));
  if (prog === 'sort') return !args.some(a => a === '-o' || /^--output/.test(a));
  if (READ.has(prog)) return true;
  return /^get-[a-z]+$/.test(prog);
}

function segDestroys(p, words) {
  if (p.expr) return false;
  if (p.prog === 'git' && gitDestroys(p.args)) return true;
  if (p.prog === 'find' && p.args.includes('-delete')) return true;
  if (p.prog === 'robocopy' && p.args.some(a => /^\/(mir|purge)$/i.test(a))) return true;
  // Un shell imbrique : on regarde aussi dans ses guillemets.
  const scan = NESTED.has(p.prog) ? words.flatMap(w => w.text.split(/[\s|;&(){}]+/)) : words.filter(w => !w.quoted).map(w => w.text);
  return scan.some(t => { const n = norm(t); return DESTRUCTIVE.has(n) || /^(remove|clear)-[a-z]+$/.test(n); });
}

// Ce qu'on retient d'un segment qu'ali autorise : le programme, avec son metier pour git, npm, python...
function segKey(p) {
  if (p.expr || !p.prog || NESTED.has(p.prog) || /[$*?]/.test(p.raw)) return null;
  if (!MULTI.has(p.prog)) return p.prog;
  if (p.prog === 'git') { const { sub, bad } = gitSub(p.args); return bad || !sub ? null : `git ${sub}`; }
  const sub = p.args.find(a => !a.startsWith('-'));
  if (!sub || /[$*?]/.test(sub)) return null;
  return `${p.prog} ${SCRIPT_RUNNERS.has(p.prog) ? norm(sub) : sub.toLowerCase()}`;
}

// Tout ce que la tour sait d'une commande.
function analyse(tool, command) {
  const { segments, unsafe, writes, call, targets } = parse(unwrap(command), tool);
  // Mots Verbe-Nom hors guillemets n'importe ou (dans un bloc { } aussi) : chacun doit etre une cmdlet qui lit.
  const words = segments.flat().filter(w => !w.quoted).map(w => w.text.toLowerCase());
  const cmdletOk = words.every(w => !/^[a-z]+-[a-z]+$/.test(w) || !VERBS.has(w.split('-')[0]) || READ.has(w) || /^get-/.test(w));
  const segs = segments.map(ws => ({ words: ws, p: programOf(ws, tool) }));
  const destroys = segs.some(x => segDestroys(x.p, x.words));
  const reads = !unsafe && !writes && !call && cmdletOk && segs.length > 0 && segs.every(x => segReads(x.p));
  const keys = segs.filter(x => !segReads(x.p)).map(x => segKey(x.p));
  // les chemins cites en argument (pas le programme lance) et les fichiers des redirections
  // (un chemin entre guillemets garde ses espaces ; dans un shell imbrique, on coupe sa commande en mots)
  const args = (x) => x.words.slice(x.p.expr ? 0 : x.words.findIndex(w => w.text === x.p.raw) + 1).map(w => w.text);
  const paths = [...targets, ...segs.flatMap(x => (NESTED.has(x.p.prog) ? args(x).flatMap(t => t.split(/\s+/)) : args(x)))]
    .map(t => t.replace(/^-+[\w-]*[=:](?![\\/])/, '').replace(/^["']|["',;]$/g, ''))
    .filter(t => pathLike(t) && !(tool !== 'Bash' && /^\/[a-z?]{1,12}$/i.test(t))); // /c, /MIR : options Windows, pas des chemins
  return { reads, destroys, unsafe, writes, keys, paths };
}

// ---- dedans ou hors du projet -------------------------------------------------------------------
// La session tourne dans le dossier du projet (cwd) : ce qui ecrit hors de ce dossier demande.
// Comparaison de texte (sans toucher au disque), sans casse : les chemins Windows ne la distinguent pas.
const pathLike = (t) => !!t && !/:\/\//.test(t) && (/[\\/]/.test(t) || /^~|^\.\.$|^[a-z]:/i.test(t) || /^\$env:|%[^%]+%/i.test(t));
function absPath(p, cwd) {
  let t = String(p || '').replace(/\\/g, '/');
  if (!/^[a-z]:\//i.test(t) && !t.startsWith('/')) {
    if (!cwd) return null;
    t = `${String(cwd).replace(/\\/g, '/')}/${t}`;
  }
  const out = [];
  for (const part of t.split('/')) {
    if (part === '' || part === '.') { if (!out.length) out.push(''); continue; }
    if (part === '..') { if (out.length > 1) out.pop(); continue; }
    out.push(part);
  }
  return out.join('/').toLowerCase();
}
function outside(p, cwd) {
  if (/^~|^\$env:|%[^%]+%|^\$home/i.test(String(p))) return true;
  const root = cwd ? absPath(cwd, '') : null, full = absPath(p, cwd);
  if (!root || !full) return true;
  return !(full === root || full.startsWith(root + '/'));
}

// Une commande de build emballee par le hook (tower-run) : on juge la commande d'origine.
function unwrap(command) {
  const m = String(command || '').match(/tower-run\.js"?.*--b64 ([A-Za-z0-9+/=]+)/);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : String(command || '');
}

function hostOf(url) { try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; } }

// ---- ce que la tour decide --------------------------------------------------------------------

// Les cles qu'un « Autoriser » d'ali retiendra pour cette demande ([] : rien n'est retenu).
function keysFor(tool, input) {
  const ti = input && typeof input === 'object' ? input : {};
  tool = String(tool || '');
  if (SHELLS.has(tool)) {
    const a = analyse(tool, ti.command);
    if (a.destroys || a.unsafe || !a.keys.length || a.keys.some(k => !k)) return [];
    return [...new Set(a.keys)];
  }
  if (!tool || EDIT_TOOLS.has(tool) || READ_TOOLS.has(tool)) return [];
  if (tool === 'WebFetch') { const h = hostOf(ti.url); return h ? [`WebFetch ${h}`] : []; }
  return [tool];
}

// La tour repond-elle seule ? conf : { niveau, retenues }.
// cwd : le dossier de la session (son projet) ; ce qui ecrit ailleurs demande, sauf au niveau « tout ».
function autoAllow(tool, input, conf = {}, cwd = '') {
  const niveau = NIVEAUX.includes(conf.niveau) ? conf.niveau : 'lecture';
  const retenues = new Set(Array.isArray(conf.retenues) ? conf.retenues : []);
  const ti = input && typeof input === 'object' ? input : {};
  tool = String(tool || '');
  if (!tool) return false;
  if (niveau === 'tout') return true;
  if (READ_TOOLS.has(tool)) return true;
  if (SHELLS.has(tool)) {
    if (typeof ti.command !== 'string' || !ti.command.trim()) return false;
    const a = analyse(tool, ti.command);
    if (a.destroys || a.unsafe) return false;
    if (a.reads) return true;
    if (a.paths.some(p => outside(p, cwd))) return false;
    if (niveau === 'sauf-suppression') return true;
    return a.keys.length > 0 && a.keys.every(k => k && retenues.has(k));
  }
  if (EDIT_TOOLS.has(tool)) return niveau === 'sauf-suppression' && typeof (ti.file_path || ti.notebook_path) === 'string' && !outside(ti.file_path || ti.notebook_path, cwd);
  if (niveau === 'sauf-suppression') return true;
  const keys = keysFor(tool, ti);
  return keys.length > 0 && keys.every(k => retenues.has(k));
}

function restore(saved) {
  const o = saved && typeof saved === 'object' ? saved : {};
  return {
    niveau: NIVEAUX.includes(o.niveau) ? o.niveau : 'lecture',
    retenues: Array.isArray(o.retenues) ? o.retenues.filter(k => typeof k === 'string' && k.length <= 120).slice(0, MAX_RETENUES) : [],
  };
}

function remember(conf, keys) {
  const add = (keys || []).filter(k => typeof k === 'string' && k && !conf.retenues.includes(k));
  if (!add.length) return false;
  conf.retenues = [...conf.retenues, ...add].slice(-MAX_RETENUES);
  return true;
}

module.exports = { NIVEAUX, outside, analyse, autoAllow, keysFor, restore, remember, unwrap };
