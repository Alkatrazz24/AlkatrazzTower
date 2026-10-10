# Alkatrazz Tower

Tour de garde locale : une page qui montre en direct chaque agent Claude Code qui travaille sur un
projet Unreal Engine 5, et un verrou qui garantit qu'un seul build Unreal tourne à la fois sur le PC.

Spécification complète : [Alkatrazz Tower — Spécification](https://claude.ai/code/artifact/8990f63e-d9bb-4da9-855d-0908465aedaa).

## Ce que fait la tour

- **Agents en direct** : une fiche par session (projet, dossier, demande, dernier outil, état :
  travaille, attend une réponse, à toi, terminé), mise à jour en temps réel.
- **Verrou de build** : `Build.bat`, `UnrealBuildTool`, `RunUAT`, `UnrealEditor-Cmd`,
  `cycle_editeur.ps1` et `tests.ps1` passent un par un ; les autres attendent dans une file visible.
- **Résultats** : dernier build et derniers tests de chaque agent (verdict, erreurs, tests ratés).
- **Éditeur et chantiers** : la page dit si `UnrealEditor.exe` est ouvert et affiche les verrous
  de domaine `Saved/chantiers/*.txt` des projets vus.
- **Jamais bloquant** : tour éteinte, les agents travaillent et buildent exactement comme avant.

## Cinq façons de se servir de la page

La page est un jeu de gestion qui tourne en fond, en direct, vu de dessus comme un bâtiment : chaque
session Claude Code est une salle, son agent y est assis à son bureau (un personnage en pixels) et ses
sous-agents travaillent autour d'une table. Les salles bordent un couloir et sont regroupées en ailes,
une par projet (ou par dossier). Au bout du couloir, la forge : un seul build à la fois, les agents
qui attendent font la queue devant sa porte, puis le build part au coffre des réussis ou des échecs.
En face, la salle de lancement : la version est une fusée qui monte à chaque feature prête. On glisse
pour se déplacer, la molette zoome, un clic ouvre une fiche ; touches 1 à 9 pour un agent, F la
forge, V la version, 0 pour recadrer.

Les cinq templates ne changent pas le décor mais la façon de travailler avec la tour. Le menu
**Fonctionnement** passe de l'un à l'autre ; le choix est retenu par le navigateur. **Galerie**
(<http://127.0.0.1:4777/galerie.html>) les compare côte à côte en captures.

| Template | Comment on s'en sert |
| --- | --- |
| À traiter (par défaut) | une liste de ce qui t'attend, un bouton par sujet ; liste vide, rien à faire |
| L'équipe | une carte par agent (ce qu'il fait, depuis quand) ; la caméra suit celui qu'on choisit |
| La version | la version à sortir pilote tout : la prochaine étape en grand, puis chaque feature et ses preuves |
| Coup d'œil | pour un second écran : la tour en grand, une phrase qui dit l'essentiel, des notifications |
| Au clavier | une barre de commande (`/` ou Ctrl+K) : on tape un nom ou « forge », Entrée fait l'action |

Le décor se choisit à part, dans le menu **Ambiance** : Jour (par défaut), Nuit, Plan, Volcan ou
Banquise. Il marche avec les cinq templates.

- `?t=equipe` dans l'adresse ouvre un template précis, `?w=nuit` une ambiance ; `?demo` joue une matinée de démonstration
  (`web/demo/state.json`, régénérée par `node scripts/demo-state.js`) sans toucher à la tour.
- L'ancienne page reste disponible : <http://127.0.0.1:4777/classique.html>.

## Tutos : voir la tour marcher sur ton projet

Le bouton **Tutos** de la barre du haut ouvre cinq scénarios courts, joués sur la vraie tour avec ton
projet connecté. Chaque étape se coche quand la tour la voit vraiment.

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

## Tâches : lancer le travail courant, suivre ses tokens

Le bouton **Tâches** de la barre du haut propose des consignes prêtes à lancer sur le projet connecté :

| Tâche | Ce que fait l'agent |
| --- | --- |
| Relecture complète et rapport | relit code, Blueprints, niveaux et config, sans rien modifier, et écrit un rapport dans `Saved/Tour/rapports/` |
| Anomalies du code et corrections | liste les bugs par gravité, puis corrige les plus sûrs un par un, build et tests à l'appui |
| Idées de features et plan d'action | propose 5 features, puis écrit le plan détaillé de la meilleure dans `Saved/Tour/plans/` |

- **Lancer** ouvre Claude Code dans une nouvelle fenêtre, dans le dossier du projet, avec la consigne
  (écrite dans `Saved/Tour/taches/`, dossier non versionné). Tu valides ses modifications comme d'habitude.
- **En fond** (relecture, idées de features, et tes tâches cochées « ne modifie pas le code ») lance
  Claude Code sans fenêtre (`claude -p`) : il lit le projet et n'écrit que dans `Saved/Tour/`, le reste
  est refusé sans question. Son journal va dans `Saved/Tour/taches/`, et la tour le suit comme les autres.
- **Copier la consigne** la met dans le presse-papiers, pour une session déjà ouverte.
- **Nouvelle tâche** en ajoute une à toi (`{projet}` et `{date}` sont remplacés) ; « Copier en perso »
  part d'une tâche de base. Elles sont gardées par la tour.

**Suivi des tâches** : chaque tâche lancée a son suivi, dans le panneau Tâches et dans la fiche de son
agent, mis à jour en direct. Il dit où elle en est (en cours, attend ta réponse, finie), **ce qu'il a
fait**, **ce qu'il reste à faire**, **ses questions pour toi**, et les fichiers écrits : un rapport ou un
plan de `Saved/Tour/` s'ouvre dans la page avec « Lire ». Pendant le travail, la tour remplit le suivi
avec ce qu'elle voit passer (lectures, fichiers écrits, commandes, builds) ; à la fin, l'agent termine
par un bloc `## Suivi` (Fait, À faire, Questions pour ali, Rapport), demandé par toute consigne de tâche,
que la tour affiche tel quel. Quand une tâche finit, « À traiter » le dit avec ce qui reste.

La tour compte les **tokens** de chaque session en lisant son journal Claude Code (le `transcript_path`
que le hook lui passe ; lecture seule) : le total (entrée, sortie, cache), le **contexte** rempli par
rapport à la fenêtre (200 k, ou 1 M), et ce que coûte chaque **action** (Read, Bash, Edit...). On les
voit dans la fiche de chaque agent, et dans le panneau Tâches : suivi des tâches et tokens du
jour par session. Au clavier, « tâche » liste les tâches à lancer.

## Sessions core et feature

Sous le bâtiment principal, deux bâtiments à part :

- **Core** (bouton Core, touche S) : une session par sujet du jeu, décrite plus bas. Elle garde la mémoire
  de son sujet dans son carnet et a ses **règles** : dans sa fiche, pour chaque action (modifier les
  fichiers du jeu, lancer des commandes, committer et pousser, chercher sur internet, appeler ses
  agents), tu choisis « Sans demander », « Demander » ou « Interdit ». Par défaut : agents sans demander,
  git interdit, le reste demandé. Lire le projet et écrire dans `Saved/Tour` restent toujours permis. Les
  règles vivent dans les données de la tour (`lib/regles.js`) et partent avec la session, à chaque
  lancement et à chaque message de la discussion (`--allowedTools`, `--disallowedTools`) ; rien n'est
  écrit dans les réglages du projet. « Modifier interdit » protège `Source/`, `Content/`, `Config/`,
  `Plugins/`, `tools/`, `docs/`, `.claude/` et les fichiers à la racine (`.uproject`, `CLAUDE.md`, scripts).
- **Mise en place** : pour préparer les prochaines tâches, une session core fait le tour de son sujet
  (code, assets, tests, décisions) et réécrit son carnet : où on en est, fichiers clés, décisions, points
  d'attention, prochaines étapes. Bouton « Mise en place » dans la fiche d'un sujet, ou « Tout mettre en
  place » dans le panneau Core. Elle tourne en fond et en lecture seule : elle lit tout, n'écrit que dans
  `Saved/Tour`, sans commande ni agent. Elle s'arrête à la limite choisie par sujet (`--max-budget-usd`,
  0,50 à 5 $, 1 $ par défaut ; Claude Code vérifie entre deux étapes, donc il peut la dépasser un peu).
  Les sujets passent un par un. La tour note pour chacun quand, combien de tokens et combien de dollars,
  puis range sa session (`lib/miseenplace.js`).
- **Features** (bouton Features, touche N pour une nouvelle) : une session par nouvelle idée. « Nouvelle
  feature » demande un nom, l'idée et les sujets touchés, puis la lance (dans la tour ou dans une
  fenêtre). Elle lit les carnets core de ces sujets sans les réécrire, propose un plan avant de toucher
  au jeu, laisse au tableau ce qui change pour chaque sujet, et tient son carnet dans
  `Saved/Tour/features/<nom>.md`. « Terminer la feature » sort sa salle du bâtiment (« Anciennes » la
  remontre). Elle a ses règles, comme une session core.

## Sujets : une session par sujet du jeu

Bouton **Core** (touche S). Chaque sujet du jeu a sa salle dans la tour, même quand aucune session ne
tourne : un sujet par section des agents du projet (`section:` de `.claude/agents/*.md` : Animation,
Interface, Menus, Armes et combat...), plus **Items** et **Base**. Le réseau et les tests ne sont pas des
sujets : leurs agents relisent le travail de tous.

- **Discuter** lance la session du sujet dans la tour (ou « Dans une fenêtre »). La session ne tourne pas en
  permanence (une longue session relit tout son contexte à chaque tour, c'est ce qui coûte des tokens) :
  elle tient le **carnet** du sujet, `Saved/Tour/sujets/<sujet>.md` (où on en est, décisions, prochaines
  étapes, fichiers), et la suivante reprend en le lisant.
- Les sujets se parlent par le **tableau**, `Saved/Tour/tableau.md` : une ligne par message
  (`- date heure · Animation → Armes et combat : ...`), toujours ajoutée à la fin. Chaque session le lit
  en commençant, y écrit ce que les autres doivent savoir, et passe à ses agents les lignes qui les
  concernent. Tu peux y écrire depuis la tour (« Écrire au tableau »).
- **Discuter** : tu parles à la session depuis la tour, sans fenêtre. Chaque message relance la session
  (`claude -p --resume`, elle garde tout son historique) ; ce que tu écris pendant qu'elle travaille
  attend son tour, et « Arrêter » coupe le tour en cours. Ses demandes d'autorisation s'affichent dans la
  discussion (Autoriser, Refuser) ; elle pose ses questions dans ses réponses. « Dans une fenêtre » lance
  la session comme avant. Toute session a « Discuter » dans sa fiche : une session ouverte dans sa fenêtre
  se lit seulement, une session fermée se reprend ici.
- Les **anciennes sessions** (terminées, rangées, ou sans rien de neuf depuis une heure) quittent le
  bâtiment ; le bouton « Anciennes » les remontre. « Ranger la salle » en range une à la main ; rien
  n'est effacé, et une session rangée qui reprend revient d'elle-même.

## La bibliothèque des skills

Au bout du couloir, à côté de la salle de lancement, la **bibliothèque** : un livre par skill installé
(bouton **Skills** de la barre du haut, ou touche B). Elle lit, sans rien modifier :

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

## La carte du projet

Sur la page, le projet est une petite ville. La maison au centre, c'est le jeu, avec son nom,
sa version d'Unreal et le drapeau de la version en cours. Autour, une extension par domaine :
Blueprints, Animations, Personnages, Décors, Matériaux, Textures, Sons, Effets, Niveaux, Interface,
Données, IA, Cinématiques, Code C++ et Tests.

- **Sa taille** suit le nombre d'éléments, et son panneau l'affiche.
- **Des échafaudages** montrent ce qui a été modifié ces 3 derniers jours (« +146 » sur le panneau).
- **Les personnages** se tiennent devant l'extension du fichier que leur agent touche, et devant la
  forge quand il compile.
- **Un clic** sur une extension montre ses dossiers et ses derniers éléments modifiés ; un clic sur la
  maison, le résumé du projet (assets, lignes de C++, classes, tests).

La tour compte le projet en lisant `Content` et `Source` (lecture seule) : le type d'un asset vient de
son préfixe (`BP_`, `AM_`, `T_`…), sinon de son dossier, sinon de l'en-tête du `.uasset`. Le comptage
tourne dans un thread à part, se refait toutes les 10 minutes et à la demande (« Actualiser »).

## Plugin Unreal : la tour dans l'éditeur

Le plugin `unreal/AlkatrazzTower` (UE 5.8, Win64) relie l'éditeur à la tour : bouton **Tour** et onglet
avec la page, notifications (agent qui attend ta réponse, build en échec, compilation d'un agent,
version validée), Live Coding sous le verrou de build, avertissement quand tu ouvres un asset qu'un
agent travaille, carte du projet mise à jour à chaque asset sauvegardé. Il reste en sommeil dans les
`UnrealEditor-Cmd` des agents. Détails et installation : [unreal/README.md](unreal/README.md).

```bat
node scripts\install-plugin.js "C:\chemin\vers\MonJeu.uproject"
```

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

## Doc Unreal d'abord

Au début de chaque session sur un projet Unreal, le hook donne à l'agent la règle « vérifier dans la
doc officielle avant d'agir », les liens de la doc épinglés sur la version du projet et le chemin des
en-têtes du moteur installé. La fiche de l'agent montre ensuite s'il a consulté la doc ou les
en-têtes, et prévient s'il modifie des fichiers sans l'avoir fait. `TOWER_NO_DOCS=1` coupe ce rappel.

Ce qui aide vraiment les agents sur UE5, avec les sources : [docs/agents-unreal.md](docs/agents-unreal.md).

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

`setup.cmd --yes` répond oui à tout sans poser de question (sauf le démarrage automatique).
**`uninstall.cmd`** retire les hooks, le démarrage automatique et le skill des personnages.

Au quotidien : `start-tower.cmd` lance la tour si elle ne démarre pas toute seule. Les sessions déjà
ouvertes prennent les hooks au vol ; `TOWER_OFF=1` coupe la tour sans rien désinstaller.

## Les agents sont des personnages

Chaque agent est dessiné en personnage façon Minecraft. Il tape avec son outil quand il travaille, une
bulle « ? » apparaît quand il attend ta réponse, une bulle « ! » quand il a fini. Quand il compile, il
se tient devant la forge, et ceux qui attendent leur tour font la queue derrière.

Un personnage dure plus longtemps qu'une session : la tour le redonne à l'agent suivant. Clique sur un
personnage pour changer son nom, ses cheveux, sa tenue, son chapeau, son accessoire, son outil et ses
couleurs, ou pour l'attacher à un rôle (titre de session, par exemple `ctb-armes`).

Tu peux aussi demander à n'importe quel agent : « donne un casque de chantier jaune à Brique ». Le
skill `alkatrazz-tower-personnages` lui explique l'API (`POST /api/characters/update`).

Brancher les hooks à la main : `node scripts\install-hooks.js` (aperçu), `--apply`, `--remove`, `--settings <fichier>`.

## Comment marche le verrou

Avant chaque commande PowerShell ou Bash, le hook regarde si c'est une commande Unreal. Si oui et
que la tour répond, il réécrit la commande pour la faire passer par `bin/tower-run.js`, qui prend
un ticket, attend son tour en l'écrivant dans la sortie, lance la commande d'origine, rend le
verrou avec le résultat et renvoie le code de sortie d'origine. Les règles de permission de
Claude Code s'appliquent normalement à la commande réécrite.

- Sans signe de vie pendant 30 secondes, le verrou passe au suivant.
- Le bouton **Libérer** de la page débloque un verrou coincé.
- `tower-run` s'utilise aussi à la main :
  `node bin\tower-run.js --shell powershell --kind build -- & "...\Build.bat" ...`

Limites connues : un `cd` dans une commande emballée ne change plus le dossier courant de l'agent ;
un agent qui donne un délai court à sa commande peut expirer pendant qu'il attend en file.

## Tests

```bat
npm test
```

## Voir la page en développement : Chrome DevTools MCP

`.mcp.json` branche le serveur MCP [Chrome DevTools](https://github.com/ChromeDevTools/chrome-devtools-mcp)
pour toute session Claude Code ouverte dans ce dossier (sur le PC comme dans le cloud). Claude ouvre
la page dans un navigateur, la regarde (captures, arbre de la page), lit la console et le réseau,
clique et tape comme un utilisateur, lance Lighthouse et mesure les performances. Il vérifie ainsi
chaque changement de `web/` au lieu de deviner.

- Sur le PC : Chrome installé (sinon Edge) s'ouvre dans une fenêtre à part, avec un profil propre à
  l'outil, sans tes comptes. La tour en marche est sur http://127.0.0.1:4777.
- Dans le cloud : le Chromium de Playwright, sans fenêtre, profil jetable. Claude lance une tour
  d'essai à part (`TOWER_PORT=4799 TOWER_DATA=<dossier temporaire> npm start`) ou ouvre `?demo`.
- `CHROME_DEVTOOLS_EXECUTABLE` force un autre navigateur. Le premier lancement télécharge le paquet
  avec npx (version épinglée dans `scripts/chrome-devtools-mcp.js`) ; rien n'entre dans le dépôt.
- `/mcp` dans Claude Code montre si le serveur est connecté.

## Fichiers

| Chemin | Rôle |
| --- | --- |
| `server/server.js` | serveur HTTP, flux en direct, sondes éditeur et chantiers |
| `server/state.js` | état des agents, verrou, file, builds |
| `hooks/tower-hook.js` | hook unique branché sur tous les événements |
| `bin/tower-run.js` | lanceur sous verrou |
| `lib/detect.js` | reconnaissance des commandes Unreal et des projets |
| `lib/results.js` | lecture des verdicts UBT et des tests |
| `lib/campaign.js` | versions à sortir : features, épreuve finale, victoire |
| `lib/unreal.js` | version du moteur, liens de la doc, consigne « doc d'abord » |
| `web/index.html`, `web/core.js`, `web/core.css` | la page : flux en direct, données, actions et dialogues communs |
| `web/templates/` | les cinq façons de se servir de la page (`list.js` les déclare et fixe celui par défaut) et leurs captures ; `web/usine/` : le moteur du jeu, son HUD et les ambiances (`mondes/`) |
| `web/galerie.html`, `web/demo/`, `scripts/demo-state.js` | galerie des templates et état de démonstration |
| `web/fonts/` | polices servies en local (SIL Open Font License) |
| `web/classique.html` | l'ancienne page, gardée en secours |
| `scripts/install-hooks.js` | branchement des hooks |
| `.mcp.json`, `scripts/chrome-devtools-mcp.js` | Chrome DevTools MCP : Claude voit la page qu'il construit |
| `scripts/setup.js`, `setup.cmd`, `uninstall.cmd` | installation et retrait sur un PC |
| `lib/characters.js`, `web/avatar.js` | personnages : allure, validation, dessin en pixels |
| `lib/projects.js` | recherche et connexion des projets Unreal |
| `lib/skills.js`, `lib/agents.js` | bibliothèque des skills et quartier des agents : inventaire, vérification, usage |
| `lib/taches.js`, `lib/suivi.js` | tâches prêtes à lancer, et leur suivi (fait, à faire, questions, rapport) |
| `lib/discussion.js` | discuter avec une session depuis la tour : sa conversation lue dans le journal, un message = un `claude -p --resume` |
| `lib/features.js` | sessions feature : une par nouvelle idée, créée depuis la tour, sa consigne et son carnet |
| `lib/miseenplace.js` | mise en place des sessions core : un sujet après l'autre, en fond, en lecture seule, avec une limite de dépense |
| `lib/regles.js` | règles d'une session core ou feature : sans demander, en demandant, interdit ; ses options de lancement |
| `lib/sujets.js` | sujets du jeu : leur consigne, leur carnet et le tableau partagé, dans `Saved/Tour/` |
| `lib/inventory.js`, `web/map.js` | carte du projet : comptage des assets et dessin de la ville |
| `unreal/AlkatrazzTower`, `scripts/install-plugin.js` | plugin d'éditeur Unreal et son installation dans un projet |
| `skills/alkatrazz-tower-personnages` | skill qui apprend aux agents à modifier un personnage |
| `vendor/unreal-engine-skills` | 31 skills Unreal de quodsoler (MIT, commit f3742d7) |
