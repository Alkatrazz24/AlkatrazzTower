'use strict';
// Inventaire d'un projet Unreal pour la carte : combien d'assets de chaque sorte, le code C++,
// les tests, ce qui a bouge recemment. Lecture seule, rien n'est modifie dans le projet.

const fs = require('fs');
const path = require('path');

// Les extensions de la maison, dans l'ordre ou elles sont posees autour d'elle.
const ROOMS = [
  { id: 'blueprints', name: 'Blueprints', color: '#3b82f6' },
  { id: 'animations', name: 'Animations', color: '#f59e0b' },
  { id: 'personnages', name: 'Personnages', color: '#ec4899' },
  { id: 'decors', name: 'Décors', color: '#84cc16' },
  { id: 'materiaux', name: 'Matériaux', color: '#a855f7' },
  { id: 'textures', name: 'Textures', color: '#14b8a6' },
  { id: 'sons', name: 'Sons', color: '#06b6d4' },
  { id: 'effets', name: 'Effets', color: '#f97316' },
  { id: 'niveaux', name: 'Niveaux', color: '#22c55e' },
  { id: 'interface', name: 'Interface', color: '#eab308' },
  { id: 'donnees', name: 'Données', color: '#64748b' },
  { id: 'ia', name: 'IA', color: '#ef4444' },
  { id: 'cinematiques', name: 'Cinématiques', color: '#8b5cf6' },
  { id: 'code', name: 'Code C++', color: '#0ea5e9' },
  { id: 'tests', name: 'Tests', color: '#10b981' },
  { id: 'autres', name: 'Autres', color: '#475569' },
];

// Prefixes de nommage Epic (et usages courants des packs).
const PREFIX = {
  BP: 'blueprints', BPI: 'blueprints', BFL: 'blueprints', GM: 'blueprints', PC: 'blueprints', GE: 'blueprints', GA: 'blueprints', B: 'blueprints',
  ABP: 'animations', A: 'animations', AS: 'animations', AM: 'animations', BS: 'animations', AO: 'animations', CR: 'animations', PA: 'personnages', Anim: 'animations', IK: 'animations', RTG: 'animations',
  SK: 'personnages', SKM: 'personnages', SKEL: 'personnages', PHYS: 'personnages',
  SM: 'decors',
  M: 'materiaux', MI: 'materiaux', MF: 'materiaux', MM: 'materiaux', MPC: 'materiaux', ML: 'materiaux', PM: 'materiaux',
  T: 'textures', TX: 'textures', HDR: 'textures',
  S: 'sons', SW: 'sons', SC: 'sons', MS: 'sons', SA: 'sons', SCL: 'sons', SMX: 'sons', ATT: 'sons', RE: 'sons', WAV: 'sons',
  NS: 'effets', NE: 'effets', P: 'effets', FX: 'effets', VFX: 'effets',
  L: 'niveaux', LVL: 'niveaux', MAP: 'niveaux',
  WBP: 'interface', W: 'interface', UI: 'interface', F: 'interface', Font: 'interface',
  DA: 'donnees', DT: 'donnees', C: 'donnees', CT: 'donnees', ST: 'donnees', E: 'donnees', IA: 'donnees', IMC: 'donnees',
  BT: 'ia', BB: 'ia', EQS: 'ia', STT: 'ia',
  LS: 'cinematiques', SEQ: 'cinematiques',
};

// Classe lue dans l'en-tete du .uasset, par ordre de priorite : un Blueprint reference des meshes,
// des sons... donc on le reconnait d'abord.
const CLASS_ORDER = [
  ['WidgetBlueprint', 'interface'], ['AnimBlueprint', 'animations'], ['ControlRigBlueprint', 'animations'], ['Blueprint', 'blueprints'],
  ['World', 'niveaux'], ['LevelSequence', 'cinematiques'], ['BehaviorTree', 'ia'], ['BlackboardData', 'ia'], ['StateTree', 'ia'], ['EnvQuery', 'ia'],
  ['NiagaraSystem', 'effets'], ['NiagaraEmitter', 'effets'], ['ParticleSystem', 'effets'],
  ['MaterialInstanceConstant', 'materiaux'], ['MaterialFunction', 'materiaux'], ['MaterialParameterCollection', 'materiaux'], ['PhysicalMaterial', 'materiaux'],
  ['AnimMontage', 'animations'], ['BlendSpace', 'animations'], ['AimOffsetBlendSpace', 'animations'], ['AnimSequence', 'animations'], ['PoseAsset', 'animations'], ['IKRetargeter', 'animations'], ['IKRigDefinition', 'animations'],
  ['SkeletalMesh', 'personnages'], ['Skeleton', 'personnages'], ['PhysicsAsset', 'personnages'],
  ['MetaSoundSource', 'sons'], ['SoundCue', 'sons'], ['SoundWave', 'sons'], ['SoundAttenuation', 'sons'], ['SoundClass', 'sons'], ['SoundSubmix', 'sons'],
  ['DataTable', 'donnees'], ['UserDefinedStruct', 'donnees'], ['UserDefinedEnum', 'donnees'], ['CurveFloat', 'donnees'], ['InputAction', 'donnees'], ['InputMappingContext', 'donnees'], ['PrimaryDataAsset', 'donnees'], ['DataAsset', 'donnees'],
  ['Font', 'interface'], ['StaticMesh', 'decors'], ['Material', 'materiaux'], ['TextureCube', 'textures'], ['Texture2D', 'textures'],
];

const FOLDER_HINTS = [
  [/(^|[\\/])(anim|anims|animation|animations|montages?)([\\/]|$)/i, 'animations'],
  [/(^|[\\/])(blueprints?|bp)([\\/]|$)/i, 'blueprints'],
  [/(^|[\\/])(textures?)([\\/]|$)/i, 'textures'],
  [/(^|[\\/])(materials?|materiaux)([\\/]|$)/i, 'materiaux'],
  [/(^|[\\/])(meshes|mesh|props|static)([\\/]|$)/i, 'decors'],
  [/(^|[\\/])(audio|sounds?|sons|sfx|music)([\\/]|$)/i, 'sons'],
  [/(^|[\\/])(fx|vfx|niagara|effects?)([\\/]|$)/i, 'effets'],
  [/(^|[\\/])(maps?|levels?)([\\/]|$)/i, 'niveaux'],
  [/(^|[\\/])(ui|widgets?|hud)([\\/]|$)/i, 'interface'],
  [/(^|[\\/])(characters?|personnages?)([\\/]|$)/i, 'personnages'],
  [/(^|[\\/])(data|input)([\\/]|$)/i, 'donnees'],
  [/(^|[\\/])(cinematics?|sequences?)([\\/]|$)/i, 'cinematiques'],
];

function roomByPrefix(file) {
  const base = path.basename(file).replace(/\.(uasset|umap)$/i, '');
  if (/\.umap$/i.test(file)) return 'niveaux';
  if (/_BuiltData$/i.test(base)) return 'niveaux';
  const m = base.match(/^([A-Za-z]+)_/);
  return m && PREFIX[m[1]] ? PREFIX[m[1]] : (m && PREFIX[m[1].toUpperCase()]) || null;
}

function roomByFolder(rel) {
  for (const [re, room] of FOLDER_HINTS) if (re.test(path.dirname(rel))) return room;
  return null;
}

function roomByHeader(file) {
  let s;
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(24576);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    fs.closeSync(fd);
    s = b.toString('latin1', 0, n);
  } catch { return null; }
  const names = new Set();
  for (const m of s.matchAll(/([A-Z][A-Za-z0-9]{2,40})\x00/g)) names.add(m[1]);
  for (const [cls, room] of CLASS_ORDER) if (names.has(cls)) return room;
  return null;
}

// Piece d'un fichier touche par un agent (pour placer son personnage sur la carte).
function roomForPath(file) {
  const f = String(file || '');
  if (/\.(cpp|h|hpp|inl|cs)$/i.test(f)) return /tests?[\\/]|Tests?\.(cpp|h)$/i.test(f) ? 'tests' : 'code';
  if (/\.(uasset|umap)$/i.test(f)) {
    const content = f.split(/[\\/]Content[\\/]/i)[1] || f;
    return roomByPrefix(f) || roomByFolder(content) || null;
  }
  // Un dossier de Content (Grep, Glob) : on juge le chemin entier, pas son parent.
  if (/[\\/]Content[\\/]/i.test(f)) return roomByFolder(f.split(/[\\/]Content[\\/]/i)[1] + '/x') || null;
  return null;
}

function walk(dir, onFile, skip) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip || !skip(e.name)) walk(p, onFile, skip); }
    else onFile(p);
  }
}

const RECENT_MS = 3 * 24 * 3600 * 1000;

// Inventaire complet d'un projet. `now` sert aux "recemment modifies".
function inventory(project, now = Date.now()) {
  const t0 = Date.now();
  const rooms = {};
  for (const r of ROOMS) rooms[r.id] = { id: r.id, count: 0, recent: 0, folders: {}, latest: [] };
  const add = (room, rel, mtime, label) => {
    const r = rooms[room];
    r.count++;
    if (now - mtime < RECENT_MS) r.recent++;
    const top = rel.split(/[\\/]/)[0];
    r.folders[top] = (r.folders[top] || 0) + 1;
    r.latest.push({ name: label, folder: path.dirname(rel).replace(/\\/g, '/'), mtime });
    if (r.latest.length > 40) { r.latest.sort((a, b) => b.mtime - a.mtime); r.latest.length = 12; }
  };

  // Contenu
  const content = path.join(project.root, 'Content');
  let assets = 0;
  walk(content, (f) => {
    if (!/\.(uasset|umap)$/i.test(f)) return;
    const rel = path.relative(content, f);
    if (/^__External(Actors|Objects)__/.test(rel)) return; // morceaux de World Partition, pas des assets a part
    let st; try { st = fs.statSync(f); } catch { return; }
    assets++;
    const room = roomByPrefix(f) || roomByFolder(rel) || roomByHeader(f) || 'autres';
    add(room, rel, st.mtimeMs, path.basename(f).replace(/\.(uasset|umap)$/i, ''));
  }, (n) => n === 'Collections' || n === 'Developers');

  // Code C++ et tests
  const source = path.join(project.root, 'Source');
  let lines = 0, classes = 0, tests = 0;
  const scanCode = (f, base) => {
    if (!/\.(cpp|h)$/i.test(f)) return;
    let txt, st;
    try { st = fs.statSync(f); txt = fs.readFileSync(f, 'utf8'); } catch { return; }
    const rel = path.relative(base, f);
    lines += txt.split('\n').length;
    classes += (txt.match(/^\s*UCLASS\s*\(/gm) || []).length;
    const t = (txt.match(/IMPLEMENT_(SIMPLE|COMPLEX|CUSTOM_SIMPLE|CUSTOM_COMPLEX)_AUTOMATION_TEST|BEGIN_DEFINE_SPEC|^\s*TEST_CLASS\s*\(/gm) || []).length;
    if (t) { tests += t; add('tests', rel, st.mtimeMs, path.basename(f)); rooms.tests.count += t - 1; }
    else add('code', rel, st.mtimeMs, path.basename(f));
  };
  walk(source, (f) => scanCode(f, source), (n) => n === 'ThirdParty');
  const plugins = path.join(project.root, 'Plugins');
  walk(plugins, (f) => { if (/[\\/]Source[\\/]/i.test(f)) scanCode(f, plugins); }, (n) => n === 'Marketplace' || n === 'ThirdParty' || n === 'Intermediate' || n === 'Binaries');

  const out = {};
  for (const r of Object.values(rooms)) {
    r.latest.sort((a, b) => b.mtime - a.mtime);
    out[r.id] = {
      id: r.id,
      count: r.count,
      recent: r.recent,
      folders: Object.entries(r.folders).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n })),
      latest: r.latest.slice(0, 8),
    };
  }
  return {
    project: project.name,
    root: project.root,
    engine: project.engine || null,
    scannedAt: now,
    ms: Date.now() - t0,
    assets,
    code: { lines, classes, tests },
    rooms: out,
  };
}

module.exports = { ROOMS, inventory, roomForPath, roomByPrefix, roomByFolder };
