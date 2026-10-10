'use strict';
// Fabrique web/demo/state.json : un etat de tour realiste (agents, verrou, version a sortir,
// carte, editeur) pour essayer les templates sans projet ni agent, et pour leurs captures.
//   node scripts/demo-state.js
// L'etat est produit par le vrai TowerState sur un faux projet ConquerTheBackrooms cree dans un
// dossier temporaire : les donnees ont exactement la forme de celles du serveur. La page decale
// toutes les dates a l'ouverture (web/core.js), la demo reste donc "en direct".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { TowerState } = require('../server/state');
const { inventory } = require('../lib/inventory');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-demo-'));
const PROJ = path.join(ROOT, 'ConquerTheBackrooms');
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);
let clock = T0 - 3 * 3600_000;
const at = (min) => { clock = T0 + min * 60_000; };
const state = new TowerState(() => clock);

// ---- faux projet : assez de fichiers pour une carte vivante -----------------------------------
function touch(rel, ageDays = 30, body = '') {
  const f = path.join(PROJ, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  const t = new Date(T0 - ageDays * 86400_000);
  fs.utimesSync(f, t, t);
}
touch('ConquerTheBackrooms.uproject', 90, JSON.stringify({ EngineAssociation: '5.8' }));
const sets = [
  ['Content/Blueprints', 'BP', ['Player', 'Door', 'Flashlight', 'AmmoBox', 'Shotgun', 'Pistol', 'RaidManager', 'Exit', 'Lamp', 'Vent', 'Locker', 'Keycard', 'Elevator', 'Spawner', 'GameMode', 'Pickup', 'Battery', 'Radio'], 2],
  ['Content/Characters/Stalker', 'SK', ['Stalker', 'Hound', 'Smiler', 'Player_Arms', 'Wanderer'], 1],
  ['Content/Characters/Animations', 'A', ['Stalker_Walk', 'Stalker_Run', 'Stalker_Attack', 'Hound_Idle', 'Arms_Reload', 'Arms_Fire', 'Arms_Idle', 'Arms_Inspect', 'Smiler_Lurk', 'Player_Crouch', 'Player_Sprint', 'Hound_Bite'], 4],
  ['Content/Environment/Level0', 'SM', ['Wall_Yellow', 'Wall_Corner', 'Ceiling_Tile', 'Ceiling_Light', 'Carpet_Floor', 'Pillar', 'Door_Frame', 'Vent_Grate', 'Desk', 'Chair', 'Pipe', 'Pipe_Bend', 'Box', 'Shelf', 'Cable', 'Exit_Sign', 'Wall_Damaged', 'Water_Puddle', 'Fire_Door', 'Crate'], 8],
  ['Content/Environment/Materials', 'MI', ['Wallpaper_Yellow', 'Carpet_Damp', 'Ceiling', 'Fluorescent', 'Concrete', 'Metal_Rust', 'Water', 'Blood', 'Glass'], 12],
  ['Content/Environment/Textures', 'T', ['Wallpaper_D', 'Wallpaper_N', 'Carpet_D', 'Carpet_N', 'Ceiling_D', 'Concrete_D', 'Concrete_N', 'Rust_D', 'Noise', 'Grime', 'Decal_Stain', 'Decal_Crack', 'Flashlight_Cookie', 'Exit_Sign_E'], 20],
  ['Content/Audio', 'S', ['Hum_Loop', 'Footstep_Carpet', 'Footstep_Wet', 'Shotgun_Fire', 'Shotgun_Reload', 'Stalker_Scream', 'Hound_Growl', 'Door_Open', 'Light_Buzz', 'Ambience_L0', 'Radio_Static'], 3],
  ['Content/FX', 'NS', ['MuzzleFlash', 'Dust', 'Sparks', 'Blood_Hit', 'Flicker'], 6],
  ['Content/Maps', 'L', ['Level0_Lobby', 'Level0_Maze', 'Level1_Garage', 'Raid_Test'], 1],
  ['Content/UI', 'WBP', ['HUD', 'RaidMenu', 'Inventory', 'Pause', 'Death', 'Ammo_Counter', 'Stamina'], 0.5],
  ['Content/Data', 'DT', ['Weapons', 'Ammo', 'Loot', 'Levels', 'Entities'], 5],
  ['Content/AI', 'BT', ['Stalker', 'Hound', 'Smiler'], 0.3],
  ['Content/AI', 'BB', ['Stalker', 'Hound'], 0.3],
];
for (const [dir, pre, names, age] of sets) names.forEach((n, i) => touch(`${dir}/${pre}_${n}.uasset`, age + i * 1.7));
const cpp = (n) => Array.from({ length: n }, (_, i) => `// ligne ${i}`).join('\n');
for (const [f, n, age] of [['Weapons/CTBAmmoComponent', 420, 0.1], ['Weapons/CTBShotgun', 380, 0.2], ['AI/CTBStalkerController', 610, 0.4], ['Player/CTBFlashlight', 240, 6], ['Player/CTBCharacter', 900, 3], ['Raid/CTBRaidSubsystem', 520, 1], ['Save/CTBSaveGame', 300, 2]])
  touch(`Source/ConquerTheBackrooms/${f}.cpp`, age, `UCLASS()\n${cpp(n)}`);
for (const t of ['Munitions', 'Lampe', 'IA', 'Sauvegarde']) touch(`Source/ConquerTheBackrooms/Tests/CTB${t}Test.cpp`, 2, 'IMPLEMENT_SIMPLE_AUTOMATION_TEST(x, "CTB.' + t + '.Base", 0)\n' + cpp(80));

const P = (sub) => path.join(PROJ, sub);
const ev = (session, name, extra = {}) => state.event({ session_id: session, cwd: PROJ, hook_event_name: name, ts: clock, ...extra });
const tool = (session, name, input) => { ev(session, 'PreToolUse', { tool_name: name, tool_input: input }); ev(session, 'PostToolUse', { tool_name: name, tool_input: input }); };

function run(session, kind, command, result, extra = {}, minutes = 3) {
  const st = state.acquire({ sessionId: session, kind, command, cwd: PROJ, ...extra });
  clock += minutes * 60_000;
  state.release(st.ticket, result);
}
const tests = (group, names, failed = []) => ({
  ok: !failed.length,
  summary: failed.length ? `${failed.length} test${failed.length > 1 ? 's' : ''} en echec sur ${names.length}` : `${names.length} tests passent`,
  tests: {
    total: names.length, failed: failed.length, passed: names.length - failed.length,
    failedNames: failed, passedPaths: names.filter(n => !failed.includes(n)).map(n => `${group}.${n}`), failedPaths: failed.map(n => `${group}.${n}`),
  },
  errorLines: failed.map(n => `Error: ${group}.${n} : Expected value to be true, but it was false`),
});

state.connectProject({ name: 'ConquerTheBackrooms', root: PROJ, uproject: P('ConquerTheBackrooms.uproject'), engine: '5.8' });

// ---- personnages nommes d'apres les roles des agents CTB ---------------------------------------
const crew = [
  ['s-armes', 'ctb-armes', 'Brigitte', { hat: 'casque', hatColor: '#facc15', tool: 'marteau', shirt: '#b45309', hairStyle: 'queue', hair: '#7c2d12' }],
  ['s-ia', 'ctb-ia', 'Odile', { hat: 'aucun', tool: 'clavier', accessory: 'lunettes', shirt: '#334155', hairStyle: 'long', hair: '#111827' }],
  ['s-niveaux', 'ctb-niveaux', 'Marcel', { hat: 'casquette', hatColor: '#16a34a', tool: 'pioche', shirt: '#15803d', shirtStyle: 'salopette', pants: '#1d4ed8', accessory: 'barbe', hair: '#a16207' }],
  ['s-ui', 'ctb-ui', 'Yasmine', { hat: 'bandana', hatColor: '#db2777', tool: 'pinceau', shirt: '#f472b6', shirtStyle: 'rayures', hairStyle: 'crete', hair: '#7e22ce' }],
  ['s-test', 'ctb-testeur', 'Gaston', { hat: 'chapeau', hatColor: '#475569', tool: 'cle', shirt: '#0f766e', shirtStyle: 'veste', hairStyle: 'chauve', accessory: 'cache-oeil' }],
  ['s-son', 'ctb-son', 'Lucien', { hat: 'capuche', hatColor: '#4338ca', tool: 'aucun', accessory: 'casque-audio', accessoryColor: '#e11d48', shirt: '#312e81' }],
];
for (const [, role, name, look] of crew) state.createCharacter({ name, role, look });

// ---- la matinee : les agents demarrent, la version est preparee -----------------------------------
at(-180);
for (const [s, role] of crew) ev(s, 'SessionStart', { session_title: role, model: 'claude' });
state.createCampaign({
  name: 'CTB 0.3',
  project: 'ConquerTheBackrooms',
  text: [
    'Munitions et rechargement | tests:CTB.Munitions',
    'Lampe torche | tests:CTB.Lampe',
    'Stalker qui traque au son | tests:CTB.IA',
    'Sauvegarde du raid | build:ConquerTheBackroomsEditor',
    'Menu de raid | manuel',
    'Boss | paquet, tests:CTB',
  ].join('\n'),
});

at(-170); ev('s-ui', 'UserPromptSubmit', { prompt: 'Branche le menu de raid sur le RaidSubsystem et ajoute le choix du niveau de départ.' });
at(-160); ev('s-son', 'UserPromptSubmit', { prompt: 'Ajoute le bourdonnement des néons qui monte quand le Stalker est proche.' });
at(-150); run('s-armes', 'build', 'Build.bat ConquerTheBackroomsEditor Win64 Development', { ok: true, summary: '0 erreur, 12 avertissements', warnings: 12 }, { target: 'ConquerTheBackroomsEditor' }, 4);
at(-140); run('s-test', 'test', 'tests.ps1 -Filter CTB.Lampe', tests('CTB.Lampe', ['Allumage', 'Batterie', 'Clignote', 'Cone']), { testFilter: 'CTB.Lampe' }, 5);
at(-120); run('s-test', 'test', 'tests.ps1 -Filter CTB.Munitions', tests('CTB.Munitions', ['Chargeur', 'Ramassage', 'Plafond', 'Recharge']), { testFilter: 'CTB.Munitions' }, 6);
at(-100); run('s-ia', 'test', 'tests.ps1 -Filter CTB.IA', tests('CTB.IA', ['Patrouille', 'Ecoute', 'Poursuite', 'Abandon']), { testFilter: 'CTB.IA' }, 5);
at(-80); run('s-niveaux', 'build', 'Build.bat ConquerTheBackroomsEditor Win64 Development', { ok: false, summary: '2 erreurs de compilation', errors: 2,
  errorLines: ['CTBRaidSubsystem.cpp(214): error C2039: "StartLevel" n\'est pas membre de "UCTBRaidSettings"', 'CTBRaidSubsystem.cpp(231): error C2660: "SpawnExit" ne prend pas 2 arguments'] }, { target: 'ConquerTheBackroomsEditor' }, 3);
at(-62); run('s-niveaux', 'build', 'Build.bat ConquerTheBackroomsEditor Win64 Development', { ok: true, summary: '0 erreur, 9 avertissements', warnings: 9 }, { target: 'ConquerTheBackroomsEditor' }, 4);
at(-45); run('s-ia', 'test', 'tests.ps1 -Filter CTB.IA', tests('CTB.IA', ['Patrouille', 'Ecoute', 'Poursuite', 'Abandon'], ['Ecoute', 'Abandon']), { testFilter: 'CTB.IA' }, 6);
at(-30); run('s-son', 'livecoding', 'LiveCoding (Ctrl+Alt+F11)', { ok: true, summary: 'patch applique' }, {}, 1);
at(-18); run('s-armes', 'test', 'tests.ps1 -Filter CTB.Munitions', tests('CTB.Munitions', ['Chargeur', 'Ramassage', 'Plafond', 'Recharge', 'FusilPompe'], ['FusilPompe']), { testFilter: 'CTB.Munitions' }, 5);

// ---- maintenant : qui fait quoi ---------------------------------------------------------------
at(-14);
ev('s-armes', 'UserPromptSubmit', { prompt: 'Le test FusilPompe échoue : la recharge cartouche par cartouche ne s\'interrompt pas quand on tire. Corrige puis relance les tests Munitions.' });
tool('s-armes', 'Read', { file_path: P('Source/ConquerTheBackrooms/Weapons/CTBShotgun.cpp') });
at(-9); tool('s-armes', 'Edit', { file_path: P('Source/ConquerTheBackrooms/Weapons/CTBAmmoComponent.cpp') });
at(-12); ev('s-ia', 'UserPromptSubmit', { prompt: 'Les tests CTB.IA.Ecoute et Abandon échouent depuis le changement du rayon d\'écoute. Trouve pourquoi.' });
tool('s-ia', 'Read', { file_path: P('Source/ConquerTheBackrooms/AI/CTBStalkerController.cpp') });
tool('s-ia', 'WebFetch', { url: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/ai-perception-in-unreal-engine' });
at(-4); ev('s-ia', 'Notification', { notification_type: 'permission_prompt', message: 'Odile veut supprimer BT_Stalker_old.uasset et deux Blackboards qui ne servent plus. Tu autorises ?' });
at(-25); ev('s-niveaux', 'UserPromptSubmit', { prompt: 'Place les sorties du Level0_Maze et vérifie qu\'aucune n\'est accessible en moins de 3 minutes de marche.' });
at(-3); tool('s-niveaux', 'Edit', { file_path: P('Content/Maps/L_Level0_Maze.umap') });
at(-40); tool('s-ui', 'Write', { file_path: P('Content/UI/WBP_RaidMenu.uasset') });
at(-7); ev('s-ui', 'Stop', { last_assistant_message: 'Le menu de raid est branché : choix du niveau, du loadout et bouton Lancer. Il reste à l\'essayer en jeu pour cocher la feature.' });
at(-6); tool('s-son', 'Edit', { file_path: P('Content/Audio/S_Hum_Loop.uasset') });
ev('s-son', 'SubagentStart', { agent_id: 'sub-1', agent_type: 'Explore' });
tool('s-son', 'Grep', { pattern: 'StalkerDistance', path: P('Source') });

// Le verrou : Brigitte relance les tests, Gaston attend son tour pour le package.
at(-0.4);
const lockT = state.acquire({ sessionId: 's-armes', kind: 'test', command: 'powershell -File tests.ps1 -Filter CTB.Munitions', cwd: PROJ, testFilter: 'CTB.Munitions' });
at(-0.2);
ev('s-test', 'UserPromptSubmit', { prompt: 'Quand les Munitions sont vertes, lance le package Win64 Shipping pour l\'épreuve finale.' });
const q = state.acquire({ sessionId: 's-test', kind: 'package', command: 'RunUAT.bat BuildCookRun -project=ConquerTheBackrooms.uproject -platform=Win64 -clientconfig=Shipping -cook -stage -pak', cwd: PROJ });
at(0);
state.touch(lockT.ticket); state.touch(q.ticket);
// Le test tourne depuis une minute et demie, le package attend depuis un peu moins.
state.lock.since = state.lock.grantedAt = T0 - 95_000;
state.queue[0].since = T0 - 50_000;
state.agents['s-test'].status = 'working';

// Une session terminee hier soir.
state.agents['s-old'] = { ...state.agents['s-ui'], sessionId: 's-old', status: 'ended', title: 'ctb-docs', prompt: 'Mets à jour docs/agents-unreal.md', message: 'fin : logout', lastSeen: T0 - 15 * 3600_000, characterId: state.createCharacter({ name: 'Firmin' }).id, lastBuild: null, lastTest: null, subagents: {} };

// Une tache lancee depuis le panneau Taches, et une tache ajoutee par l'utilisateur.
at(-35); ev('s-relec', 'UserPromptSubmit', { prompt: 'Tache de la tour [relecture] : lis la consigne dans Saved/Tour/taches/relecture.md et suis-la.' });
state.agents['s-relec'].characterId = state.createCharacter({ name: 'Clothilde', look: { hat: 'aucun', tool: 'loupe', accessory: 'lunettes', shirt: '#7c3aed', hairStyle: 'chignon', hair: '#d6d3d1' } }).id;
for (const [m, f] of [[-30, 'CLAUDE.md'], [-24, 'Source/ConquerTheBackrooms/Weapons/CTBAmmoComponent.cpp'], [-15, 'Source/ConquerTheBackrooms/AI/CTBStalkerController.cpp']]) { at(m); tool('s-relec', 'Read', { file_path: P(f) }); }
at(-2); tool('s-relec', 'Read', { file_path: P('Source/ConquerTheBackrooms/Raid/CTBRaidSubsystem.cpp') });
// La relecture lit le projet avec cinq sous-agents, assis autour de la table de sa salle.
for (const [id, type] of [['rel-1', 'Explore'], ['rel-2', 'Explore'], ['rel-3', 'Explore'], ['rel-4', 'Explore'], ['rel-5', 'general-purpose']]) {
  ev('s-relec', 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: P('CLAUDE.md') }, agent_id: id, agent_type: type });
}
state.agents['s-ia'].subagents['ia-1'] = { type: 'Explore', lastSeen: T0 - 5 * 60_000 }; // Odile attend ta reponse, son sous-agent aussi
state.agents['s-test'].subagents['anim-1'] = { type: 'ctb-animation', lastSeen: T0 - 60_000 }; // un agent du projet au travail : son casier est ouvert
// Une session ouverte dans le dossier de la tour elle-meme : elle a son aile a part.
const TOWER = path.join(ROOT, 'Alkatrazz Tower');
at(-20); state.event({ session_id: 's-tour', cwd: TOWER, hook_event_name: 'SessionStart', ts: clock, session_title: 'Maintenance de la tour' });
state.agents['s-tour'].characterId = state.createCharacter({ name: 'Quartz', look: { hat: 'casque', hatColor: '#0ea5e9', tool: 'cle', shirt: '#0369a1', hairStyle: 'court', hair: '#111827' } }).id;
at(-8); state.event({ session_id: 's-tour', cwd: TOWER, hook_event_name: 'UserPromptSubmit', ts: clock, prompt: 'Mets à jour la tour locale après le merge et relance-la.' });
at(-3); state.event({ session_id: 's-tour', cwd: TOWER, hook_event_name: 'Stop', ts: clock, last_assistant_message: 'La tour est à jour sur main et relancée, /api/health répond.' });

// Une tache d'idees finie : son suivi (bloc « ## Suivi » de son dernier message) et son plan.
at(-80); ev('s-idees', 'UserPromptSubmit', { prompt: 'Tache de la tour [features] : lis la consigne dans Saved/Tour/taches/features.md et suis-la.' });
state.agents['s-idees'].characterId = state.createCharacter({ name: 'Basalte', look: { hat: 'casquette', hatColor: '#16a34a', tool: 'aucun', shirt: '#be185d', hairStyle: 'court', hair: '#3f2a14' } }).id;
for (const [m, f] of [[-78, 'CLAUDE.md'], [-74, 'Source/ConquerTheBackrooms/Raid/CTBRaidSubsystem.cpp'], [-70, 'Content/Data/DT_Loot.uasset']]) { at(m); tool('s-idees', 'Read', { file_path: P(f) }); }
at(-62); tool('s-idees', 'Write', { file_path: P('Saved/Tour/plans/feature-2026-10-09.md'), content: '# Plan' });
at(-60); ev('s-idees', 'Stop', { last_assistant_message: [
  '5 idées pour CTB, le plan de la meilleure est écrit.', '',
  '## Suivi',
  'Fait :', '- Lu le CLAUDE.md, le sous-système de raid et les tables de loot', '- Proposé 5 features (radio d\'extraction, loot maudit, coffre partagé, carte griffonnée, sprint bruyant)', '- Écrit le plan de la radio d\'extraction, la plus rentable',
  'À faire :', '- Relire le plan et choisir si on part sur la radio d\'extraction', '- Découper le plan en 4 tâches pour ctb-armes, ctb-ui, ctb-son et ctb-testeur', '- Ajouter la feature à la version CTB 0.3',
  'Questions pour ali :', '- Le loot maudit peut-il faire perdre des objets du coffre, ou seulement ceux du raid ?',
  'Rapport : Saved/Tour/plans/feature-2026-10-09.md',
].join('\n') });
at(-2); // l'horloge de la demo reste « maintenant »
state.tasks.push({ id: 'perso-assets-orphelins', title: 'Assets orphelins', text: 'Liste les assets que plus rien ne référence.', prompt: 'Liste les assets de Content/ que plus rien ne référence dans {projet}, sans rien supprimer.', readonly: true, createdAt: T0 - 86400_000 });

// Tokens : ce que la tour lirait dans les journaux de Claude Code.
const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const use = (sid, k, ctx, win, tools) => {
  const total = Math.round(k * 1000);
  state.agents[sid].usage = {
    in: Math.round(total * 0.004), out: Math.round(total * 0.012), cacheRead: Math.round(total * 0.9), cacheWrite: Math.round(total * 0.084), total,
    messages: Math.round(k / 9), context: ctx * 1000, window: win, contextPct: Math.round(100 * ctx * 1000 / win),
    tools: tools.map(([name, calls, outK, ctxK]) => ({ name, calls, out: outK * 1000, ctx: ctxK * 1000 })), days: { [day(T0)]: total }, lastAt: T0 - 60_000,
  };
};
use('s-armes', 4820, 118, 200_000, [['Bash', 31, 22, 2400], ['Edit', 14, 18, 1100], ['Read', 26, 4, 950], ['Réponse', 0, 6, 300]]);
use('s-ia', 3150, 164, 200_000, [['Read', 40, 6, 1500], ['WebFetch', 5, 2, 700], ['Bash', 12, 9, 650], ['Réponse', 0, 5, 260]]);
use('s-niveaux', 2210, 71, 200_000, [['Bash', 18, 11, 980], ['Edit', 9, 12, 760], ['Read', 15, 3, 400]]);
use('s-ui', 1640, 52, 200_000, [['Write', 6, 15, 620], ['Read', 19, 3, 540], ['Bash', 7, 4, 380]]);
use('s-son', 980, 43, 200_000, [['Edit', 5, 6, 410], ['Agent', 1, 3, 300], ['Read', 9, 1, 230]]);
use('s-test', 2730, 96, 200_000, [['Bash', 28, 14, 1900], ['Read', 21, 3, 700]]);
use('s-idees', 870, 96, 200_000, [['Read', 31, 4, 520], ['Write', 1, 6, 90], ['Réponse', 0, 4, 60]]);
use('s-relec', 1260, 312, 1_000_000, [['Read', 58, 7, 980], ['Grep', 22, 2, 230], ['Réponse', 0, 3, 50]]);

// L'editeur, vu par le plugin.
state.editorState({ project: 'ConquerTheBackrooms', uproject: P('ConquerTheBackrooms.uproject'), engine: '5.8', map: 'Level0_Maze', pie: false, dirty: 3,
  dirtyNames: ['L_Level0_Maze', 'BP_Exit', 'MI_Fluorescent'], liveCoding: { enabled: true, compiling: false }, openAssets: ['/Game/Maps/L_Level0_Maze', '/Game/Blueprints/BP_Exit'] });
state.editor = { open: true, count: 1, checkedAt: clock, plugin: true };

state.chantiers = { ConquerTheBackrooms: [
  { file: 'armes', text: 'Brigitte : CTBAmmoComponent et CTBShotgun, ne pas toucher avant la fin des tests Munitions.', mtime: T0 - 14 * 60_000 },
  { file: 'level0-maze', text: 'Marcel : L_Level0_Maze ouvert dans l\'editeur, sorties en cours de placement.', mtime: T0 - 25 * 60_000 },
] };

const inv = inventory({ name: 'ConquerTheBackrooms', root: PROJ, engine: '5.8' });
inv.scannedAt = T0 - 2 * 60_000;
state.inventories.ConquerTheBackrooms = inv;

// La bibliotheque des skills : un faux ~/.claude (perso, compte, plugin) et les skills du projet,
// lus par le vrai lib/skills.js, avec des journaux de sessions pour l'usage.
async function demoSkills() {
  const skills = require('../lib/skills');
  const CFG = path.join(ROOT, 'claude');
  const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const md = (name, desc, body = '\n# Étapes\n\n1. Lis le code concerné.\n2. Applique la règle.\n') => `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n${body}`;
  for (const [n, d] of [
    ['ue-cpp-conventions', 'Conventions C++ Unreal du PC : UPROPERTY, UFUNCTION, GC, noms. Utilise ce skill avant d\'écrire ou relire du C++ UE.'],
    ['ue-replication', 'Réplication réseau Unreal : RPC serveur, propriétés répliquées, autorité. Utilise ce skill pour tout ce qui touche au multijoueur.'],
    ['ue-tests-auto', 'Écrire et lancer les tests automatiques Unreal (tools\\tests.ps1) et lire leur résultat.'],
    ['ue-build-logs', 'Lire le log complet d\'un build UBT quand il échoue, sans le couper, et trouver la première vraie erreur.'],
    ['ue-blueprints', 'Lire et modifier des Blueprints par script Python dans l\'éditeur.'],
    ['ue-animation', 'Montages, slots et Anim Blueprints : ajouter une animation jouée par le code.'],
  ]) put(path.join(CFG, 'skills', n, 'SKILL.md'), md(n, d));
  put(path.join(CFG, 'skills', 'ue-niagara', 'SKILL.md'), '---\nname: ue-niagara\n---\n\nEffets Niagara.\n'); // sans description : casse
  put(path.join(CFG, 'skills', 'revue-perf', 'SKILL.md'), '---\nname: revue-perf\ndescription: Profiler: lire un Unreal Insights et proposer des gains\n---\n\nVoir [la méthode](methode.md).\n');
  for (const [n, d] of [['docx', 'Create, read and edit Word documents (.docx).'], ['pdf', 'Read, fill, merge and create PDF files.'], ['skill-creator', 'Create new skills, improve existing ones and measure how well they trigger.']]) put(path.join(CFG, 'skills', 'synced', 'compte', n, 'SKILL.md'), md(n, d));
  for (const [n, d] of [['spec-driven-development', 'Write a spec before coding any non-trivial feature.'], ['test-driven-development', 'Write the failing test first, then the code.'], ['code-review-and-quality', 'Review a change for correctness, readability and risk before merging.'], ['frontend-ui-engineering', 'Build accessible, fast UI without a framework when asked.']]) put(path.join(CFG, 'plugins', 'cache', 'addy-agent-skills', 'agent-skills', '1.2.0', 'skills', n, 'SKILL.md'), md(n, d));
  put(path.join(CFG, 'plugins', 'cache', 'claude-plugins-official', 'frontend-design', 'b8e5', 'skills', 'frontend-design', 'SKILL.md'), md('frontend-design', 'Distinctive, intentional visual design for new UI.'));
  put(path.join(PROJ, '.claude', 'skills', 'ctb-portes', 'SKILL.md'), md('ctb-portes', 'Les portes de CTB : ouverture, coup de pied, réplication et tests CTB.Portes.'));
  put(path.join(PROJ, '.claude', 'skills', 'ctb-version', 'SKILL.md'), md('ctb-version', 'Monter la version de CTB (ProjectVersion), écrire le changelog et la décision.'));
  put(path.join(TOWER, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'agent-skills@addy-agent-skills': true, 'frontend-design@claude-plugins-official': true } }));
  const lines = [];
  const call = (skill, minAgo, sid, cwd, typed) => lines.push(JSON.stringify(typed
    ? { type: 'user', sessionId: sid, cwd, timestamp: new Date(T0 - minAgo * 60_000).toISOString(), message: { role: 'user', content: `<command-name>/${skill}</command-name>` } }
    : { type: 'assistant', sessionId: sid, cwd, timestamp: new Date(T0 - minAgo * 60_000).toISOString(), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } }));
  const usesOf = { 'ue-cpp-conventions': 23, 'ue-replication': 9, 'ue-build-logs': 4, 'ue-tests-auto': 12, 'ctb-portes': 3, 'agent-skills:spec-driven-development': 2, 'frontend-design:frontend-design': 5, docx: 1 };
  let k = 0;
  for (const [n, c] of Object.entries(usesOf)) for (let i = 0; i < c; i++) {
    const tower = n.includes(':');
    call(n, 30 + (k++ * 397) % (9 * 24 * 60), `demo-${i % 4}`, tower ? TOWER : PROJ, n === 'ctb-portes' && i === 0);
  }
  call('simplify', 90, 'demo-1', TOWER);
  // Le quartier des agents : les agents du projet par section, un agent perso, un agent de plugin, et
  // leurs appels (outil Agent) avec les tokens rendus par chaque appel.
  const agentMd = (name, section, desc, extra = '', body = '') => `---\nname: ${name}\nsection: ${section}\ndescription: ${JSON.stringify(desc)}\n${extra}---\n\nTu es le spécialiste ${name}.\n${body}`;
  for (const [n, sec, d, extra, body] of [
    ['ctb-animation', 'Animation', 'Montages, gestes CTB.Geste.*, notifies et Anim Blueprints. À appeler pour toute nouvelle animation.', '', 'Skills utiles : ue-animation, ue-cpp-conventions.\n'],
    ['ctb-gameplay', 'Gameplay', 'Portes, coffres, bornes et interactions du joueur.', 'model: inherit\n', 'Skills utiles : ue-replication, ctb-portes.\n'],
    ['ctb-armes', 'Armes et combat', 'Tir, munitions, balistique et mêlée.', 'disallowedTools: Agent, Workflow\nmodel: inherit\n', 'Skills utiles : ue-armes-skg.\n'],
    ['ctb-interface', 'Interface', 'La WebUI : inventaire, équipement, marchands, carte.', 'skills:\n  - ctb-portes\n', ''],
    ['ctb-reseau', 'Réseau', 'Relit la réplication de toute feature : autorité serveur, RPC, OnRep.', 'skills:\n  - ue-replication\n', ''],
    ['ctb-relecteur', 'Tests et qualité', 'Relit un travail avant qu\'il soit déclaré terminé.', 'tools: Read, Grep, Glob, Bash, PowerShell\n', 'Skills utiles : ue-tests-auto.\n'],
    ['ctb-testeur', 'Tests et qualité', 'Lance la suite de tests complète après chaque lot et traque les régressions.', '', 'Skills utiles : ue-tests-auto.\n'],
    ['ctb-son', 'Son', 'L\'Oreille, occlusion, réverb, radio.', '', ''],
  ]) put(path.join(PROJ, '.claude', 'agents', `${n}.md`), agentMd(n, sec, d, extra, body));
  put(path.join(CFG, 'agents', 'revue-cpp.md'), agentMd('revue-cpp', 'Tests et qualité', 'Relecteur C++ Unreal pour tous les projets du PC.', 'model: sonnet\n', 'Skills utiles : ue-cpp-conventions.\n'));
  put(path.join(CFG, 'plugins', 'cache', 'addy-agent-skills', 'agent-skills', '1.2.0', 'agents', 'code-reviewer.md'), '---\nname: code-reviewer\ndescription: Senior code reviewer for correctness, readability and risk.\n---\n\nReview the diff.\n');
  const agentCall = (type, minAgo, sid, cwd, what, tokens, k) => {
    const ts = (m) => new Date(T0 - m * 60_000).toISOString();
    lines.push(JSON.stringify({ type: 'assistant', sessionId: sid, cwd, timestamp: ts(minAgo), message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_demo_${k}`, name: 'Agent', input: { subagent_type: type, description: what, prompt: what } }] } }));
    lines.push(JSON.stringify({ type: 'user', sessionId: sid, cwd, timestamp: ts(minAgo - 3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_demo_${k}`, content: 'ok' }] }, toolUseResult: { status: 'completed', totalTokens: tokens } }));
  };
  let n = 0;
  for (const [type, c, what, tok] of [['Explore', 14, 'Chercher les appels de la porte', 38_000], ['general-purpose', 3, 'Relire le plan de la version', 61_000], ['ctb-gameplay', 4, 'Coup de pied dans les portes', 412_000],
    ['ctb-relecteur', 6, 'Relire le lot avant « terminé »', 95_000], ['ctb-reseau', 5, 'Réplication du coup de pied', 120_000], ['ctb-animation', 2, 'Montage du coup de pied', 230_000], ['ctb-testeur', 3, 'Suite complète après le lot', 80_000], ['revue-cpp', 2, 'Relire CTBPorte.cpp', 54_000]]) {
    for (let i = 0; i < c; i++) agentCall(type, 40 + (n++ * 331) % (6 * 24 * 60), `demo-${i % 3}`, PROJ, what, tok + i * 1000, n);
  }
  put(path.join(CFG, 'projects', 'C--demo', 'journal.jsonl'), lines.join('\n') + '\n');
  const inv = skills.scan({ cfg: CFG, projects: [{ name: 'ConquerTheBackrooms', root: PROJ }, { name: 'Alkatrazz Tower', root: TOWER }] });
  state.skills = skills.withUsage(inv, await skills.readUsage({ cfg: CFG, now: T0 }), { now: T0 });
  const agents = require('../lib/agents');
  state.roster = agents.withUsage(agents.scan({ cfg: CFG, projects: [{ name: 'ConquerTheBackrooms', root: PROJ }, { name: 'Alkatrazz Tower', root: TOWER }], skills: inv }), await skills.readAgentUsage({ cfg: CFG, now: T0 }), { now: T0 });
}

// Les sujets du jeu : une salle par section de l'equipe, plus Items et Base. Deux carnets deja tenus,
// le tableau partage avec quelques messages, et la session du sujet Animation au travail.
function demoSujets() {
  const sujets = require('../lib/sujets');
  const put = (rel, text) => { const f = P(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('Saved/Tour/sujets/animation.md', '# Animation\n\n## Où on en est\nLe coup de pied est codé (CTBPorte::CoupDePied), sans clip : il manque le montage et le slot FullBody dans ABP_PlayerPawn_CTB.\n\n## Décisions\n- Une seule animation de coup de pied, jouée en FullBody.\n\n## Prochaines étapes\n- Importer un clip de coup de pied\n- Ajouter le slot FullBody dans ABP_PlayerPawn_CTB\n- Lancer tools/creer_coup_de_pied.py\n\n## Fichiers du sujet\n- Content/CTB/Characters/Animations\n');
  put('Saved/Tour/sujets/armes-et-combat.md', '# Armes et combat\n\n## Où on en est\nLe fusil à pompe recharge cartouche par cartouche ; le test FusilPompe est rouge.\n\n## Prochaines étapes\n- Interrompre la recharge quand on tire\n- Relancer CTB.Munitions\n');
  put('Saved/Tour/tableau.md', ['# Tableau des sujets', '',
    '- 2026-10-09 10:12 · Armes et combat → Animation : le montage de recharge du fusil à pompe doit pouvoir s\'interrompre (notify « Interruptible »).',
    '- 2026-10-09 10:40 · Interface → Items : la WebUI lit maintenant la taille des objets dans DT_Loot (colonne Taille), garde-la.',
    '- 2026-10-09 11:05 · Animation → Armes et combat : fait, notify « Interruptible » ajouté au montage de recharge.',
    '- 2026-10-09 11:30 · ali → tous : on garde la touche K pour le coup de pied.',
    '- 2026-10-09 11:48 · Gameplay → Animation : CTBPorte appelle OnCoupDePied quand la porte cède, branche le son et l\'animation dessus.', ''].join('\n'));
  for (const [n, sec, d] of [['ctb-menus', 'Menus', 'Menu principal, pause, réglages.'], ['ctb-economie', 'Économie et inventaire', 'Inventaire, loot, commerce et profil.'], ['ctb-monde', 'Monde et niveaux', 'Parcelles, niveaux et décor.']])
    put(`.claude/agents/${n}.md`, `---\nname: ${n}\nsection: ${sec}\ndescription: ${JSON.stringify(d)}\n---\n\nTu es le spécialiste ${n}.\n`);
  state.setSujets('ConquerTheBackrooms', sujets.scan({ name: 'ConquerTheBackrooms', root: PROJ }, require('../lib/equipe').teamOf(PROJ, 0)));
  at(-11); ev('s-anim', 'UserPromptSubmit', { prompt: 'Tache de la tour [sujet-animation] : lis la consigne dans Saved/Tour/taches/sujet-animation.md et suis-la.' });
  state.agents['s-anim'].characterId = state.createCharacter({ name: 'Ambre', look: { hat: 'bandana', hatColor: '#0d9488', tool: 'pinceau', shirt: '#0f766e', hairStyle: 'queue', hair: '#78350f' } }).id;
  at(-10); tool('s-anim', 'Read', { file_path: P('Saved/Tour/sujets/animation.md') });
  at(-9); tool('s-anim', 'Read', { file_path: P('Saved/Tour/tableau.md') });
  at(-4); ev('s-anim', 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: P('Content/Characters/Animations/A_Arms_Reload.uasset') }, agent_id: 'anim-a', agent_type: 'ctb-animation' });
  // Deux features : la lampe torche au travail, les coffres de la base en sommeil avec son carnet ;
  // une regle changee par ali sur le sujet Armes et combat.
  const feats = require('../lib/features');
  const ids = (names) => state.topicsOf('ConquerTheBackrooms').filter(t => names.includes(t.title)).map(t => t.id);
  const lampe = state.addFeature({ title: 'Lampe torche', idea: 'Le joueur trouve une lampe torche, l\'allume avec F, et sa pile se vide en 3 minutes.', sujets: ids(['Interface', 'Items']), project: 'ConquerTheBackrooms' }).feature;
  const coffres = state.addFeature({ title: 'Coffres de la base', idea: 'Des coffres dans la base pour garder le loot entre deux raids.', sujets: ids(['Base', 'Items']), project: 'ConquerTheBackrooms' }).feature;
  put(feats.notesPath(coffres.id), '# Coffres de la base\n\n## Où on en est\nPlan validé par ali : un coffre de 20 cases, sauvegardé dans le profil.\n\n## Prochaines étapes\n- Créer BP_Coffre_Base\n- Sauver son contenu dans le profil\n');
  state.setFeatureNotes(coffres.id, feats.scan(PROJ, coffres).notes);
  state.setRule(ids(['Armes et combat'])[0], 'commandes', 'oui');
  // Mises en place deja faites sur deux sujets (lib/miseenplace.js).
  state.misePlace['sujet-animation'] = { status: 'done', at: clock - 50 * 60_000, endedAt: clock - 44 * 60_000, budget: 1, tokens: 412000, cost: 0.38 };
  state.misePlace[ids(['Armes et combat'])[0]] = { status: 'done', at: clock - 43 * 60_000, endedAt: clock - 35 * 60_000, budget: 1, tokens: 655000, cost: 1, capped: true };
  at(-6); ev('s-lampe', 'UserPromptSubmit', { prompt: `Tache de la tour [${lampe.id}] : lis la consigne dans Saved/Tour/taches/${lampe.id}.md et suis-la.` });
  state.agents['s-lampe'].characterId = state.createCharacter({ name: 'Silex', look: { hat: 'casque', hatColor: '#d97706', tool: 'cle', shirt: '#92400e' } }).id;
  at(-5); tool('s-lampe', 'Read', { file_path: P('Saved/Tour/sujets/interface.md') });
  at(-3); ev('s-lampe', 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: P('Source/CTB/Items/CTBItemData.h') }, agent_id: 'lampe-a', agent_type: 'ctb-economie' });
  at(-2);
}

(async () => {
await demoSkills();
demoSujets();

// Les chemins du dossier temporaire deviennent des chemins Windows plausibles.
const WIN = 'C:\\Users\\Alkatrazz\\Documents\\Unreal Projects';
const winify = (v) => {
  if (typeof v === 'string') return v.includes(ROOT) ? v.split(ROOT).join(WIN).replace(/\//g, '\\') : v;
  if (Array.isArray(v)) return v.map(winify);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, winify(x)]));
  return v;
};
const json = JSON.stringify(winify(JSON.parse(JSON.stringify(state.snapshot())))).split(JSON.stringify(WIN + '\\claude').slice(1, -1)).join(JSON.stringify('C:\\Users\\Alkatrazz\\.claude').slice(1, -1));
const out = path.join(__dirname, '..', 'web', 'demo', 'state.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, json);
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`demo : ${out} (${json.length} octets)`);
})();
