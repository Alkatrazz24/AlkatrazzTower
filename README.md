# Alkatrazz Tower

**Version 0.1** · Node 20 ou plus, aucune dépendance npm · Windows · licence GPL-3.0

Tour de garde locale pour Claude Code sur des projets Unreal Engine 5. Une page sur
<http://127.0.0.1:4777> montre en direct chaque session et chaque agent qui travaille sur tes jeux,
comme un bâtiment vu de dessus, et un verrou garantit qu'un seul build Unreal tourne à la fois sur le
PC. Autour, la tour lance et suit le travail courant (tâches, sessions par sujet, un chef qui reçoit
toutes tes demandes) et rassemble ce qu'il faut pour piloter le projet : skills, agents,
documentation, dépôts git, version à sortir.

Spécification complète : [Alkatrazz Tower — Spécification](https://claude.ai/code/artifact/8990f63e-d9bb-4da9-855d-0908465aedaa).

**Jamais bloquante** : tour éteinte, les agents travaillent et buildent exactement comme avant. Les
hooks sortent toujours en 0, sans rien dire, et `TOWER_OFF=1` coupe tout sans rien désinstaller.

## Sommaire

- [Ce qu'il y a dans la v0.1](#ce-quil-y-a-dans-la-v01)
- [Installer sur un PC](#installer-sur-un-pc)
- [La page : un bâtiment en direct](#la-page--un-bâtiment-en-direct)
- [Le verrou de build](#le-verrou-de-build)
- [Tâches : lancer le travail courant](#tâches--lancer-le-travail-courant)
- [Les questions des agents dans la tour](#les-questions-des-agents-dans-la-tour)
- [Sujets, Core et Features](#sujets-core-et-features)
- [Le chef : toutes tes demandes au même endroit](#le-chef--toutes-tes-demandes-au-même-endroit)
- [La bibliothèque des skills](#la-bibliothèque-des-skills)
- [Le quartier des agents](#le-quartier-des-agents)
- [La documentation](#la-documentation)
- [Les dépôts : git et GitHub](#les-dépôts--git-et-github)
- [La carte du projet](#la-carte-du-projet)
- [Version à sortir : finir le jeu comme une partie](#version-à-sortir--finir-le-jeu-comme-une-partie)
- [Plugin Unreal : la tour dans l'éditeur](#plugin-unreal--la-tour-dans-léditeur)
- [Réglages](#réglages)
- [Développer la tour](#développer-la-tour)
- [Fichiers](#fichiers)

## Ce qu'il y a dans la v0.1

La v0.1 rassemble tout ce qui a été construit jusqu'à la pull request 30 incluse.

| Partie | En bref |
| --- | --- |
| Agents en direct | une salle par session Claude Code, son agent à son bureau, ses sous-agents autour d'une table, ailes par projet |
| Verrou de build | `Build.bat`, UBT, `RunUAT`, `UnrealEditor-Cmd`, Live Coding : un seul à la fois, file visible à la forge |
| Fonctionnement et ambiances | cinq façons de se servir de la page (À traiter par défaut) et cinq décors |
| Tutos | cinq scénarios joués sur la vraie tour pour voir chaque partie marcher |
| Tâches | relecture, anomalies, idées, doc du projet et les tiennes ; « Lancer » ou « En fond », suivi et tokens |
| La tour vérifie | après une tâche qui a modifié le jeu, la tour compile et lance les tests elle-même |
| Questions dans la tour | les questions et demandes de permission des sessions lancées par la tour s'y répondent d'un clic |
| Sujets, Core, Features | une session par sujet du jeu avec son carnet et ses règles, un tableau partagé, une session par nouvelle idée, « Discuter » depuis la tour, « Mise en place » |
| Chef | une session qui reçoit toutes tes demandes, vérifie en lisant et confie les changements aux bonnes sessions |
| Skills, Agents | bibliothèque des skills et quartier des agents : inventaire, vérification, usage, ajout ; `skills-ctb.js` copie dans un projet les skills des sessions de la tour et ceux de ponytail |
| Documentation | la doc de chaque projet à lire dans la tour, la doc Unreal par thème, la doc obligatoire pour qui modifie le jeu |
| Dépôts | git sur le PC et GitHub pour la tour, les projets et les dossiers suivis |
| Carte et version | la ville du projet, la version à sortir avec ses features et son épreuve finale |
| Plugin Unreal | bouton **Tour** et onglet dans l'éditeur, notifications, Live Coding sous le verrou |
| Personnages | agents dessinés façon Minecraft (nos propres dessins), personnalisables |

## Installer sur un PC

Il faut [Node.js](https://nodejs.org) 20 ou plus et Claude Code. Récupère le dépôt, puis double-clique
sur **`setup.cmd`** :

1. il vérifie Node ;
2. il branche la tour sur Claude Code (hooks dans `~/.claude/settings.json`, avec une copie de
   sauvegarde ; les autres réglages et hooks ne sont pas touchés) ;
3. il installe les 31 skills Unreal (`vendor/unreal-engine-skills`) et le skill des personnages dans
   `~/.claude/skills` ;
4. il propose de lancer la tour au démarrage de Windows ;
5. il lance la tour et ouvre <http://127.0.0.1:4777>.

Sur la page, **Connecter un projet Unreal** cherche les `.uproject` du PC (Documents, Bureau, racine des
disques) : clique sur ceux que tes agents vont faire avancer, ou colle un chemin.

- `setup.cmd --yes` répond oui à tout sans poser de question (sauf le démarrage automatique).
- **`uninstall.cmd`** retire les hooks, le démarrage automatique et le skill des personnages (les skills
  Unreal restent, ils servent aussi sans la tour ; le dossier du dépôt n'est pas touché).
- Au quotidien, **`start-tower.cmd`** lance la tour si elle ne démarre pas toute seule. Les sessions déjà
  ouvertes prennent les hooks au vol.
- Brancher les hooks à la main : `node scripts\install-hooks.js` (aperçu), `--apply`, `--remove`,
  `--settings <fichier>` (ou `npm run hooks:show`, `hooks:install`, `hooks:remove`).

Les hooks branchés : `PreToolUse` (Bash et PowerShell pour le verrou, `AskUserQuestion` pour les
questions), `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `SessionStart`,
`UserPromptSubmit`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop` et `SessionEnd`. Ceux qui
n'ont rien à décider partent en arrière-plan.

**Mettre à jour** : tour arrêtée et aucun build en cours, `git pull`, `npm test`, puis relancer la tour.
Si `hooks/` ou `scripts/install-hooks.js` ont changé, repasser `node scripts\install-hooks.js --apply`.
Si `unreal/` a changé, fermer et rouvrir l'éditeur pour qu'Unreal recompile le plugin.

## La page : un bâtiment en direct

La page est un jeu de gestion qui tourne en fond, en direct, vu de dessus comme un bâtiment : chaque
session Claude Code est une **salle**, son agent y est assis à son bureau (un personnage en pixels) et
ses sous-agents travaillent autour d'une table. Les salles bordent un couloir et sont regroupées en
ailes, une par projet (ou par dossier). Au bout du couloir, la **forge** : un seul build à la fois, les
agents qui attendent font la queue devant sa porte, puis le build part au coffre des réussis ou des
échecs. En face, la **salle de lancement** : la version est une fusée qui monte à chaque feature prête.
Dehors, le long de la rue, les autres bâtiments : Core, Features, Chef, la bibliothèque des skills, le
quartier des agents, la Documentation et les Dépôts.

On glisse pour se déplacer, la molette zoome, un clic ouvre une fiche ; touches 1 à 9 pour un agent,
F la forge, V la version, 0 pour recadrer, et une touche par bâtiment (S, N, C, B, A, D, G).

**Une fiche par session** : projet, dossier, demande, dernier outil, état (travaille, attend une
réponse, à toi, terminé), dernier build et derniers tests (verdict, erreurs, tests ratés), tokens. La
page dit aussi si `UnrealEditor.exe` est ouvert et montre les verrous de domaine
`Saved/chantiers/*.txt` des projets vus.

**Le nom d'une salle** dit ce qu'elle fait : le nom que tu lui as donné dans la tour, sinon la tâche
lancée, le titre de la session dans Claude Code (`/rename` ou celui qu'il génère), sa première demande
résumée, et à défaut le projet. Les **anciennes sessions** (terminées, rangées, ou sans rien de neuf
depuis une heure) quittent le bâtiment ; « Anciennes » les remontre, « Ranger la salle » en range une à
la main. Rien n'est effacé, et une session rangée qui reprend revient d'elle-même.

### Fonctionnement et ambiance

Les cinq façons de travailler ne changent pas le décor mais la façon de se servir de la tour. Le menu
**Fonctionnement** passe de l'une à l'autre ; le choix est retenu par le navigateur. **Galerie**
(<http://127.0.0.1:4777/galerie.html>) les compare côte à côte en captures.

| Fonctionnement | Comment on s'en sert |
| --- | --- |
| À traiter (par défaut) | une liste de ce qui t'attend, un bouton par sujet ; liste vide, rien à faire |
| L'équipe | une carte par agent (ce qu'il fait, depuis quand) ; la caméra suit celui qu'on choisit |
| La version | la version à sortir pilote tout : la prochaine étape en grand, puis chaque feature et ses preuves |
| Coup d'œil | pour un second écran : la tour en grand, une phrase qui dit l'essentiel, des notifications |
| Au clavier | une barre de commande (`/` ou Ctrl+K) : on tape un nom ou « forge », Entrée fait l'action |

Le décor se choisit à part, dans le menu **Ambiance** : Jour (par défaut), Nuit, Plan, Volcan ou
Banquise.

- `?t=equipe` dans l'adresse ouvre un fonctionnement précis, `?w=nuit` une ambiance ; `?demo` joue une
  matinée de démonstration (`web/demo/state.json`, régénérée par `node scripts/demo-state.js`) sans
  toucher à la tour.
- L'ancienne page reste disponible : <http://127.0.0.1:4777/classique.html>.

### Les agents sont des personnages

Chaque agent est un personnage façon Minecraft, dessiné par nous. Il tape avec son outil quand il
travaille, une bulle « ? » apparaît quand il attend ta réponse, une bulle « ! » quand il a fini. Quand il
compile, il se tient devant la forge, et ceux qui attendent leur tour font la queue derrière.

Un personnage dure plus longtemps qu'une session : la tour le redonne à l'agent suivant. Clique sur un
personnage pour changer son nom, ses cheveux, sa tenue, son chapeau, son accessoire, son outil et ses
couleurs, ou pour l'attacher à un rôle (titre de session, par exemple `ctb-armes`). Tu peux aussi
demander à n'importe quel agent : « donne un casque de chantier jaune à Brique ». Le skill
`alkatrazz-tower-personnages` lui explique l'API (`POST /api/characters/update`).

### Tutos : voir la tour marcher sur ton projet

Le bouton **Tutos** ouvre cinq scénarios courts, joués sur la vraie tour avec ton projet connecté.
Chaque étape se coche quand la tour la voit vraiment.

| Tuto | Ce qu'il montre |
| --- | --- |
| Un agent arrive | une session s'ouvre sur le projet, lit deux fichiers, puis finit |
| Il te pose une question | un agent attend ta réponse ; « J'ai vu » le libère |
| Un build à la fois | deux builds en même temps : un à la forge, l'autre attend son tour |
| Un build qui échoue | la tour lit l'erreur de compilation et la montre |
| Ton vrai agent | tu lances Claude Code dans le dossier du projet, la tour le voit arriver |

Rien n'est écrit dans le projet. Les agents des tutos sont simulés (identifiants `tuto-…`), et la forge
lance un faux build (`scripts/tuto-build.js`) sous le vrai verrou avec le vrai `tower-run`. Leurs traces
ne sont jamais sauvegardées, ne comptent pas pour la version et partent avec « Effacer les traces des
tutos », au bout de 30 minutes ou au redémarrage. Les tutos de build refusent de partir quand un vrai
build tourne.

## Le verrou de build

`Build.bat`, `UnrealBuildTool`, `RunUAT`, `UnrealEditor-Cmd`, `cycle_editeur.ps1` et `tests.ps1` passent
un par un ; les autres attendent dans une file visible à la forge. Live Coding lancé depuis l'éditeur
prend aussi son ticket (avec le plugin Unreal).

Avant chaque commande PowerShell ou Bash, le hook regarde si c'est une commande Unreal. Si oui et que la
tour répond, il réécrit la commande pour la faire passer par `bin/tower-run.js`, qui prend un ticket,
attend son tour en l'écrivant dans la sortie (en ASCII, la console des agents ne lit pas l'UTF-8), lance
la commande d'origine, rend le verrou avec le résultat et renvoie le code de sortie d'origine. Les règles
de permission de Claude Code s'appliquent normalement à la commande réécrite.

- Sans signe de vie pendant 30 secondes, le verrou passe au suivant.
- Le bouton **Libérer** de la page débloque un verrou coincé.
- `tower-run` s'utilise aussi à la main :
  `node bin\tower-run.js --shell powershell --kind build -- & "...\Build.bat" ...`

Limites connues : un `cd` dans une commande emballée ne change plus le dossier courant de l'agent ; un
agent qui donne un délai court à sa commande peut expirer pendant qu'il attend en file ; avec l'éditeur
ouvert, un build de la cible Éditeur échoue (code 6), la tour prévient l'agent avant.

## Tâches : lancer le travail courant

Le bouton **Tâches** propose des consignes prêtes à lancer sur le projet connecté :

| Tâche | Ce que fait l'agent |
| --- | --- |
| Relecture complète et rapport | relit code, Blueprints, niveaux et config, sans rien modifier, et écrit un rapport dans `Saved/Tour/rapports/` |
| Anomalies du code et corrections | liste les bugs par gravité, puis corrige les plus sûrs un par un, build et tests à l'appui |
| Idées de features et plan d'action | propose 5 features, puis écrit le plan détaillé de la meilleure dans `Saved/Tour/plans/` |
| Doc du projet : tout comprendre | fait de `docs/` la doc qui suffit pour comprendre le jeu : une page d'entrée `docs/COMPRENDRE.md`, une page par système ; n'écrit que dans `docs/` |

- **Lancer** ouvre Claude Code dans une nouvelle fenêtre, dans le dossier du projet, avec la consigne
  (écrite dans `Saved/Tour/taches/`, dossier non versionné). Tu valides ses modifications comme d'habitude.
- **En fond** (relecture, idées, doc du projet, et tes tâches cochées « ne modifie pas le code ») lance
  Claude Code sans fenêtre (`claude -p`) : il lit le projet et n'écrit que dans `Saved/Tour/`, le reste
  est refusé sans question. Son journal va dans `Saved/Tour/taches/`. Une tâche en fond survit au
  redémarrage de la tour.
- **Copier la consigne** la met dans le presse-papiers, pour une session déjà ouverte.
- **Nouvelle tâche** en ajoute une à toi (`{projet}` et `{date}` sont remplacés) ; « Copier en perso »
  part d'une tâche de base. Elles sont gardées par la tour.

Les sessions lancées par la tour partent sans les variables `CLAUDE*` de la tour (sauf
`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` et `CLAUDE_CODE_GIT_BASH_PATH`),
avec `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` pour qu'on puisse les reprendre et `TOWER_ASK=1` pour que
leurs questions arrivent dans la tour.

**Suivi des tâches** : chaque tâche lancée a son suivi, dans le panneau Tâches et dans la fiche de son
agent, mis à jour en direct. Il dit où elle en est (en cours, attend ta réponse, finie), **ce qu'il a
fait**, **ce qu'il reste à faire**, **ses questions pour toi**, et les fichiers écrits : un rapport ou un
plan de `Saved/Tour/` s'ouvre dans la page avec « Lire ». Pendant le travail, la tour remplit le suivi
avec ce qu'elle voit passer (lectures, fichiers écrits, commandes, builds) ; à la fin, l'agent termine
par un bloc `## Suivi` (Fait, À faire, Questions pour ali, Rapport) que la tour affiche tel quel. Quand
une tâche finit, « À traiter » le dit avec ce qui reste.

**La tour vérifie** : quand une tâche qui a modifié le projet se termine, la tour compile et lance la
suite de tests elle-même, sous son verrou, et met le verdict sur la tâche. Une tâche ne se dit plus
finie sur des tests jamais lancés. L'éditeur ouvert n'est jamais gêné ni fermé : la tour compile alors
la cible Jeu (mêmes sources) et garde la cible Éditeur et les tests pour quand il sera fermé. Les
scripts du projet (`tools\tests.ps1`) passent avant ceux du moteur (`lib/verif.js`).

**Tokens** : la tour compte les tokens de chaque session en lisant son journal Claude Code (le
`transcript_path` que le hook lui passe ; lecture seule) : le total (entrée, sortie, cache), le
**contexte** rempli par rapport à la fenêtre (200 k, ou 1 M), et ce que coûte chaque **action** (Read,
Bash, Edit...). On les voit dans la fiche de chaque agent, et dans le panneau Tâches avec les tokens du
jour par session. Au clavier, « tâche » liste les tâches à lancer.

## Les questions des agents dans la tour

Quand une session lancée par la tour pose une question (`AskUserQuestion`) ou demande une permission,
la question s'affiche dans la tour : **Répondre**, ou **Autoriser** / **Refuser**. L'agent reçoit la
réponse et la question ne s'affiche pas dans sa fenêtre. « Dans sa fenêtre », 10 minutes sans réponse
(`TOWER_ASK_WAIT`), tour éteinte ou erreur : la question revient dans la fenêtre comme d'habitude.

Seules les sessions qui portent `TOWER_ASK=1` passent par là (`hooks/tower-ask.js`) : une session ouverte
à la main garde ses questions dans sa fenêtre, sans attente. Seule la page de la tour peut répondre :
la tour vérifie l'`Origin` et le `Host` de chaque action.

## Sujets, Core et Features

À côté du bâtiment principal, deux bâtiments à part : **Core** (bouton Core, touche S), une session par
sujet du jeu, et **Features** (bouton Features, touche N pour une nouvelle), une session par nouvelle
idée.

**Les sujets.** Chaque sujet du jeu a sa salle, même quand aucune session ne tourne : un sujet par
section des agents du projet (`section:` de `.claude/agents/*.md` : Animation, Interface, Menus, Armes
et combat...), plus **Items** et **Base**. Le réseau et les tests ne sont pas des sujets : leurs agents
relisent le travail de tous.

- La session d'un sujet ne tourne pas en permanence (une longue session relit tout son contexte à chaque
  tour, c'est ce qui coûte des tokens) : elle tient le **carnet** du sujet, `Saved/Tour/sujets/<sujet>.md`
  (où on en est, décisions, prochaines étapes, fichiers), et la suivante reprend en le lisant.
- Les sujets se parlent par le **tableau**, `Saved/Tour/tableau.md` : une ligne par message
  (`- date heure · Animation → Armes et combat : ...`), toujours ajoutée à la fin. Chaque session le lit
  en commençant, y écrit ce que les autres doivent savoir, et passe à ses agents les lignes qui les
  concernent. Tu peux y écrire depuis la tour (« Écrire au tableau »).

**Discuter.** Tu parles à une session depuis la tour, sans fenêtre. Chaque message relance la session
(`claude -p --resume`, elle garde tout son historique) ; ce que tu écris pendant qu'elle travaille attend
son tour, et « Arrêter » coupe le tour en cours. Ses demandes d'autorisation s'affichent dans la
discussion (Autoriser, Refuser) ; elle pose ses questions dans ses réponses. « Dans une fenêtre » lance
la session comme avant. Toute session a « Discuter » dans sa fiche : une session ouverte dans sa fenêtre
se lit seulement, une session fermée se reprend ici.

**Les règles.** Dans la fiche d'une session core ou feature, pour chaque action (modifier les fichiers
du jeu, lancer des commandes, committer et pousser, chercher sur internet, appeler ses agents), tu
choisis « Sans demander », « Demander » ou « Interdit ». Par défaut : agents sans demander, git interdit,
le reste demandé. Lire le projet et écrire dans `Saved/Tour` restent toujours permis. Les règles vivent
dans les données de la tour (`lib/regles.js`) et partent avec la session, à chaque lancement et à chaque
message (`--allowedTools`, `--disallowedTools`) ; rien n'est écrit dans les réglages du projet.
« Modifier interdit » protège `Source/`, `Content/`, `Config/`, `Plugins/`, `tools/`, `docs/`,
`.claude/` et les fichiers à la racine (`.uproject`, `CLAUDE.md`, scripts).

**Mise en place.** Pour préparer les prochaines tâches, une session core fait le tour de son sujet
(code, assets, tests, décisions) et réécrit son carnet : où on en est, fichiers clés, décisions, points
d'attention, prochaines étapes. Bouton « Mise en place » dans la fiche d'un sujet, ou « Tout mettre en
place » dans le panneau Core. Elle tourne en fond et en lecture seule : elle lit tout, n'écrit que dans
`Saved/Tour`, sans commande ni agent. Elle s'arrête à la limite choisie par sujet (`--max-budget-usd`,
0,50 à 5 $, 1 $ par défaut ; Claude Code vérifie entre deux étapes, donc il peut la dépasser un peu). Les
sujets passent un par un. La tour note pour chacun quand, combien de tokens et combien de dollars.

**Les features.** « Nouvelle feature » demande un nom, l'idée et les sujets touchés, puis la lance (dans
la tour ou dans une fenêtre). Elle lit les carnets core de ces sujets sans les réécrire, propose un plan
avant de toucher au jeu, laisse au tableau ce qui change pour chaque sujet, et tient son carnet dans
`Saved/Tour/features/<nom>.md`. « Terminer la feature » sort sa salle du bâtiment (« Anciennes » la
remontre). Elle a ses règles, comme une session core.

## Le chef : toutes tes demandes au même endroit

Bouton **Chef** (touche C), un bâtiment au bout de la rue. Tu lui confies tout ce qui touche au jeu :
« pourquoi cette animation ne marche pas », « j'ai importé des assets, tu peux voir », une idée, un bug.
« Discuter » le lance dans la tour (ou « Dans une fenêtre »).

- Il vérifie ce qu'il peut en lisant (le projet, `Saved/Logs`, les carnets, le tableau) et te répond. Il
  peut appeler des agents pour enquêter. Par défaut il ne modifie pas le jeu et ne lance ni commande ni
  git ; ses règles se changent dans sa fiche, comme celles d'une session core.
- Ce qui demande un changement, il le confie : un fichier par envoi dans `Saved/Tour/chef/envois/`
  (`pour: sujet-animation`, ou `pour: nouvelle feature` avec `titre:` et `sujets:`, une ligne `---`, puis
  la demande). La tour le lit toutes les 10 s et le transmet : dans la discussion de la session du sujet
  si elle tourne dans la tour, sinon elle lance une session du sujet avec la demande ; une idée neuve crée
  la feature et la lance. Si la session du sujet est ouverte dans sa fenêtre, la demande attend au tableau.
  Chaque envoi est aussi écrit au tableau, et le fichier est rangé dans `Saved/Tour/chef/envoyes/`.
- Le bureau des envois, sous sa salle, et sa fiche montrent chaque envoi : à qui, où en est la session,
  « Voir la salle ». « Me demander avant chaque envoi » les garde en attente : tu cliques « Envoyer » ou
  « Ignorer ».
- La tour tient `Saved/Tour/chef/suivi.md` (où en est chaque envoi), que le chef lit avant chaque demande,
  et les sessions lui répondent au tableau, pour « Chef ».

## La bibliothèque des skills

Au bout du couloir, à côté de la salle de lancement, la **bibliothèque** : un livre par skill installé
(bouton **Skills**, ou touche B). Elle lit, sans rien modifier :

- les skills **perso** (`~/.claude/skills`), ceux du **compte** claude.ai, ceux de chaque **projet**
  connu (`<projet>/.claude/skills`) et ceux des **plugins**, avec l'endroit où chaque plugin est activé ;
- chaque `SKILL.md` : en-tête lisible, description présente et pas trop longue, nom cohérent avec son
  dossier, fichiers cités présents, même nom à deux endroits ;
- l'**usage** des 30 derniers jours dans les journaux de Claude Code (`~/.claude/projects`) : appels de
  l'outil Skill et commandes `/nom` tapées, par session et par projet.

Un livre rouge est cassé (Claude Code ne peut pas s'en servir), orange à revoir, poussiéreux jamais
utilisé. **Ajouter un skill** écrit un `SKILL.md` dans le dossier perso ou dans `.claude/skills` d'un
projet, à partir d'un modèle, ou depuis une adresse GitHub : le fichier est montré en entier et ne
s'installe qu'une fois lu et confirmé.

**Les skills des sessions de la tour dans un projet.** Pour donner à un projet Unreal les skills qu'ont
les sessions de la tour, plus ceux de ponytail : `node scripts/skills-ctb.js "<projet>"` montre ce qui
serait copié dans `<projet>/.claude/skills`, ce qui y est déjà, ce qu'une session du projet a déjà (perso,
compte, plugin activé) et ce qui est écarté avec la raison ; `--apply` copie, `--only a,b` n'en prend que
certains. Les skills viennent de leurs dépôts GitHub publics (ceux d'Epic de `vendor/unreal-mcp-skills`),
rien n'est écrasé ni commité. ponytail arrive sans ses hooks, et son skill principal ne se lance qu'à la
main (`/ponytail`) sauf avec `--ponytail-auto`. graphify reste exclu.

## Le quartier des agents

En face de la bibliothèque, le **quartier des agents** : un casier par agent que Claude Code peut appeler
sur le PC, de la couleur de sa section (bouton **Agents**, ou touche A). Un casier ouvert : l'agent est
parti travailler dans une salle. Il lit, sans rien modifier :

- les agents **intégrés** (general-purpose, Explore, Plan…), les **perso** (`~/.claude/agents`), ceux de
  chaque **projet** connu (`<projet>/.claude/agents`) et ceux des **plugins** ;
- l'en-tête de chaque agent : section, description, modèle, `tools`, `disallowedTools`, les skills qu'il
  **précharge** (`skills:`) et ceux que ses consignes **citent**, avec ce qui manque sur le PC, et s'il
  peut appeler un skill (pas s'il a une liste `tools:` sans `Skill`) ;
- ses **appels** des 30 derniers jours (outil Agent dans les journaux de Claude Code) : sessions, projets,
  tokens rendus par chaque appel, ses derniers travaux, et les salles où il travaille en ce moment.

## La documentation

Le bâtiment **Documentation** (bouton **Doc**, ou touche D) regroupe la doc « humaine » de chaque projet
connecté, à lire par toi comme par les sessions :

- des **rayons** : `CLAUDE.md` et `docs/` (bible, décisions, idées, chantiers…), les skills du projet, les
  pages de la tour (tableau, sujets, features) et les rapports ; un dossier `*.docs` ou `*.wiki` à la racine
  a aussi son rayon ;
- une **recherche** (sans accents ni majuscules) et une **liseuse** : la page s'ouvre dans la tour, ses
  liens vers d'autres pages aussi ;
- **Écrit par les sessions** : les dernières pages que les sessions et leurs agents ont écrites ;
- **Comprendre le projet** ouvre la page d'entrée `docs/COMPRENDRE.md` (sinon `docs/README.md`) ;
  **Compléter la doc** lance en fond la tâche « Doc du projet », qui relit tout le jeu et complète `docs/`
  jusqu'à ce qu'elle suffise pour le comprendre.

**La doc est obligatoire.** Une session ou un agent qui modifie le jeu (`Source/`, `Content/`, `Config/`,
`Plugins/`, `tools/`, le `.uproject`) doit écrire dans `docs/` avant de finir : le hook `Stop` (ou
`SubagentStop` pour un agent) le fait continuer une fois pour l'écrire. S'il s'arrête quand même, sa page
passe en **Doc en retard** et la salle clignote. Seuls les projets connectés à la tour sont concernés, et
rien n'est bloqué quand la tour est éteinte. Pour l'écrire aussi dans le `CLAUDE.md` et les agents d'un
projet : `node scripts/doc-ctb.js "<projet>"` montre les changements, `--apply` les écrit (copie d'avant
dans `Saved/Tour/sauvegardes/`).

**Doc Unreal.** En face, la salle **Unreal Engine** : la doc officielle de la version du projet rangée
par thème (création, Blueprints, C++, réseau, UI, animation, rendu…), aussi écrite dans
`Saved/Tour/doc-unreal.md` pour les sessions. Au début de chaque session sur un projet Unreal, le hook
donne à l'agent les liens de la doc épinglés sur la version du projet et le chemin des en-têtes du moteur
installé. Par défaut, la doc se consulte **quand la session se demande comment créer ou utiliser quelque
chose** ; dans la salle Unreal Engine, « Avant chaque modification » la rend systématique. La fiche de
l'agent montre s'il a consulté la doc ou les en-têtes. `TOWER_NO_DOCS=1` coupe ce rappel. Ce qui aide
vraiment les agents sur UE5, avec les sources : [docs/agents-unreal.md](docs/agents-unreal.md).

## Les dépôts : git et GitHub

Le bâtiment **Dépôts** (bouton **Git**, ou touche G) suit la tour elle-même, chaque projet connu et les
dossiers que tu ajoutes (« Suivre un autre dossier ») :

- **sur le PC** : la branche, les derniers commits, les fichiers pas encore commités. Une baie par dépôt,
  dont les voyants prennent la couleur de son état ;
- **sur GitHub** (si le dépôt y est relié) : le dernier push, les PR ouvertes (une caisse par PR sur le
  quai), les derniers commits de la branche principale, et si le PC est à jour, en retard ou en avance,
  sans même lancer de `git fetch`. Sans jeton, la tour voit les dépôts publics ; une variable
  `GITHUB_TOKEN` (ou `GH_TOKEN`) ouvre aussi les privés.

La tour ne fait que lire : `git --no-optional-locks` ne touche même pas l'index. Trois gestes changent un
dépôt, chacun sur ton clic et après confirmation : **Initialiser git** (`git init -b main`, plus un
`.gitignore` Unreal s'il n'y en a pas, sans rien commiter), **Relier** à une adresse GitHub
(`git remote add origin`, sans rien pousser) et **Récupérer de GitHub** (`git fetch`). Rien ne pousse.
Si git n'est pas installé, la tour le dit (bâtiment et « À traiter ») avec le lien de téléchargement.

## La carte du projet

Le projet est aussi une petite ville. La maison au centre, c'est le jeu, avec son nom, sa version
d'Unreal et le drapeau de la version en cours. Autour, une extension par domaine : Blueprints,
Animations, Personnages, Décors, Matériaux, Textures, Sons, Effets, Niveaux, Interface, Données, IA,
Cinématiques, Code C++ et Tests.

- **Sa taille** suit le nombre d'éléments, et son panneau l'affiche.
- **Des échafaudages** montrent ce qui a été modifié ces 3 derniers jours (« +146 » sur le panneau).
- **Les personnages** se tiennent devant l'extension du fichier que leur agent touche, et devant la
  forge quand il compile.
- **Un clic** sur une extension montre ses dossiers et ses derniers éléments modifiés ; un clic sur la
  maison, le résumé du projet (assets, lignes de C++, classes, tests).

La tour compte le projet en lisant `Content` et `Source` (lecture seule) : le type d'un asset vient de
son préfixe (`BP_`, `AM_`, `T_`…), sinon de son dossier, sinon de l'en-tête du `.uasset`. Le comptage
tourne dans un thread à part, se refait toutes les 10 minutes et à la demande (« Actualiser »).

## Version à sortir : finir le jeu comme une partie

Le haut de la page, c'est la version que tu veux sortir (par exemple « CTB 0.3 »). Clique sur
**Préparer une version**, donne un nom, puis liste les features et comment la tour sait que chacune
est prête :

| Choix dans le formulaire | Prête quand |
| --- | --- |
| Ses tests d'automatisation passent | le dernier run qui touche ce groupe de tests (ex. `CTB.Lampe`) n'en rate aucun |
| Le jeu compile | la dernière compilation (de la cible indiquée, sinon n'importe laquelle) réussit |
| Je la teste en jeu moi-même | tu cliques sur « Je l'ai testée » |

Les groupes de tests déjà vus par la tour sont proposés dans la liste. L'**épreuve finale** se
débloque quand toutes les features sont prêtes et doit réussir après elles : par défaut, le jeu se
package (`RunUAT BuildCookRun`) et toute la suite de tests passe. La version est alors validée, avec
ses statistiques et le commit Git du projet.

La tour suit tout seule les résultats des builds et tests de tes agents. Le bandeau **Prochaine
étape** dit quoi faire maintenant, avec les tests en échec. Une feature prête qui repasse au rouge
devient « Cassée » et rebloque l'épreuve finale.

L'API accepte aussi un texte, une feature par ligne : `Lampe torche | tests:CTB.Lampe, build`,
`Menu de raid | manuel`, `Boss | paquet, tests:CTB`.

## Plugin Unreal : la tour dans l'éditeur

Le plugin `unreal/AlkatrazzTower` (UE 5.8, Win64) relie l'éditeur à la tour : bouton **Tour** dans la
barre d'outils et onglet avec la page, notifications (agent qui attend ta réponse, build en échec,
compilation d'un agent, version validée), Live Coding sous le verrou de build, avertissement quand tu
ouvres un asset qu'un agent travaille, carte du projet mise à jour à chaque asset sauvegardé. Il reste
en sommeil dans les `UnrealEditor-Cmd` des agents, et sans la tour il ne fait rien de visible. Détails
et installation : [unreal/README.md](unreal/README.md).

```bat
node scripts\install-plugin.js "C:\chemin\vers\MonJeu.uproject"
```

## Réglages

| Variable | Effet |
| --- | --- |
| `TOWER_OFF=1` | coupe la tour pour une session : les hooks ne font plus rien |
| `TOWER_PORT` | port de la tour (4777 par défaut) |
| `TOWER_DATA` | dossier des données de la tour (`data/` par défaut, non versionné) |
| `TOWER_ASK=1` | envoie les questions et permissions d'une session dans la tour (mis d'office sur les sessions qu'elle lance) |
| `TOWER_ASK_WAIT` | attente maximale d'une réponse dans la tour, en secondes (600 par défaut) |
| `TOWER_NO_DOCS=1` | coupe le rappel de la doc Unreal en début de session |
| `GITHUB_TOKEN` ou `GH_TOKEN` | le bâtiment Dépôts voit aussi les dépôts GitHub privés |

## Développer la tour

```bat
npm test
```

Aucune dépendance npm : `node --test` suffit. Il n'y a pas d'intégration continue ; « vert » veut dire
`npm test` vert en local, avant chaque push.

**Voir la page : Chrome DevTools MCP.** `.mcp.json` branche le serveur MCP
[Chrome DevTools](https://github.com/ChromeDevTools/chrome-devtools-mcp) pour toute session Claude Code
ouverte dans ce dossier (sur le PC comme dans le cloud). Claude ouvre la page dans un navigateur, la
regarde (captures, arbre de la page), lit la console et le réseau, clique et tape comme un utilisateur,
lance Lighthouse et mesure les performances. Il vérifie ainsi chaque changement de `web/` au lieu de
deviner.

- Sur le PC : Chrome installé (sinon Edge) s'ouvre dans une fenêtre à part, avec un profil propre à
  l'outil, sans tes comptes. La tour en marche est sur <http://127.0.0.1:4777>.
- Dans le cloud : le Chromium de Playwright, sans fenêtre, profil jetable. Claude lance une tour
  d'essai à part (`TOWER_PORT=4799 TOWER_DATA=<dossier temporaire> npm start`) ou ouvre `?demo`.
- `CHROME_DEVTOOLS_EXECUTABLE` force un autre navigateur. Le premier lancement télécharge le paquet
  avec npx (version épinglée dans `scripts/chrome-devtools-mcp.js`) ; rien n'entre dans le dépôt.
- `/mcp` dans Claude Code montre si le serveur est connecté.

Les consignes de travail de Claude sur ce dépôt sont dans [CLAUDE.md](CLAUDE.md).

## Fichiers

| Chemin | Rôle |
| --- | --- |
| `server/server.js` | serveur HTTP, flux en direct, sondes éditeur et chantiers |
| `server/state.js` | état des agents, verrou, file, builds |
| `hooks/tower-hook.js` | hook unique branché sur tous les événements |
| `hooks/tower-ask.js` | hook des questions et permissions : la réponse vient de la tour |
| `bin/tower-run.js` | lanceur sous verrou |
| `lib/client.js` | petit client HTTP vers la tour, qui ne lève jamais |
| `lib/detect.js` | reconnaissance des commandes Unreal et des projets |
| `lib/results.js` | lecture des verdicts UBT et des tests |
| `lib/verif.js` | la tour vérifie : compilation et tests après une tâche qui a modifié le projet |
| `lib/campaign.js` | versions à sortir : features, épreuve finale, victoire |
| `lib/unreal.js` | version du moteur, liens de la doc Unreal, consigne de début de session |
| `lib/salles.js` | le nom de la salle d'une session |
| `lib/usage.js` | tokens d'une session, lus dans son journal Claude Code |
| `lib/taches.js`, `lib/suivi.js` | tâches prêtes à lancer, et leur suivi (fait, à faire, questions, rapport) |
| `lib/tuto.js`, `scripts/tuto-build.js` | tutos joués sur la vraie tour, et leur faux build |
| `lib/discussion.js` | discuter avec une session depuis la tour : sa conversation lue dans le journal, un message = un `claude -p --resume` |
| `lib/sujets.js` | sujets du jeu : leur consigne, leur carnet et le tableau partagé, dans `Saved/Tour/` |
| `lib/features.js` | sessions feature : une par nouvelle idée, créée depuis la tour, sa consigne et son carnet |
| `lib/regles.js` | règles d'une session core ou feature : sans demander, en demandant, interdit ; ses options de lancement |
| `lib/miseenplace.js` | mise en place des sessions core : un sujet après l'autre, en fond, en lecture seule, avec une limite de dépense |
| `lib/chef.js` | le chef : sa consigne, ses envois lus dans `Saved/Tour/chef/envois/` et transmis aux sessions core ou feature, leur suivi |
| `lib/skills.js`, `lib/agents.js` | bibliothèque des skills et quartier des agents : inventaire, vérification, usage |
| `lib/equipe.js` | l'équipe d'un projet : ses agents rangés par section |
| `lib/docs.js` | bâtiment Documentation : rayons, recherche, doc obligatoire, rayon Unreal par thème |
| `lib/git.js` | bâtiment Dépôts : état git de chaque dossier suivi, GitHub, initialiser et relier |
| `lib/inventory.js`, `web/map.js` | carte du projet : comptage des assets et dessin de la ville |
| `lib/projects.js` | recherche et connexion des projets Unreal |
| `lib/characters.js`, `web/avatar.js` | personnages : allure, validation, dessin en pixels |
| `web/index.html`, `web/core.js`, `web/core.css` | la page : flux en direct, données, actions et dialogues communs |
| `web/templates/` | les cinq façons de se servir de la page (`list.js` les déclare et fixe celle par défaut) et leurs captures |
| `web/usine/` | le moteur du bâtiment, son HUD et les ambiances (`mondes/`) |
| `web/galerie.html`, `web/demo/`, `scripts/demo-state.js` | galerie des fonctionnements et état de démonstration |
| `web/fonts/` | polices servies en local (SIL Open Font License) |
| `web/classique.html` | l'ancienne page, gardée en secours |
| `scripts/install-hooks.js` | branchement des hooks |
| `scripts/doc-ctb.js` | écrit la règle « doc obligatoire » dans le `CLAUDE.md` et les agents d'un projet |
| `scripts/skills-ctb.js`, `lib/skills-ctb.js` | copie dans un projet Unreal les skills des sessions de la tour et ceux de ponytail |
| `scripts/setup.js`, `scripts/uninstall.js`, `setup.cmd`, `uninstall.cmd`, `start-tower.cmd` | installation, retrait et lancement sur un PC |
| `.mcp.json`, `scripts/chrome-devtools-mcp.js` | Chrome DevTools MCP : Claude voit la page qu'il construit |
| `unreal/AlkatrazzTower`, `scripts/install-plugin.js` | plugin d'éditeur Unreal et son installation dans un projet |
| `skills/alkatrazz-tower-personnages` | skill qui apprend aux agents à modifier un personnage |
| `vendor/unreal-engine-skills` | 31 skills Unreal de quodsoler (MIT, commit f3742d7) |
| `vendor/unreal-mcp-skills` | 3 skills du plugin MCP de l'éditeur Unreal d'Epic Games (MIT) |
| `docs/agents-unreal.md` | ce qui aide les agents sur UE5, avec les sources |

## Licence

GPL-3.0, voir [LICENSE](LICENSE). Les skills de `vendor/` gardent leur licence MIT, les polices de
`web/fonts/` la SIL Open Font License.
