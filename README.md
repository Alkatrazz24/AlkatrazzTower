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

La page est un jeu de gestion d'usine qui tourne en fond, en direct : chaque agent est une machine
avec son personnage, les domaines du projet sont des gisements, les builds roulent en caisses sur le
tapis jusqu'à la forge (une seule à la fois) puis vers le coffre des réussis ou des échecs, et la
version est une fusée à assembler dans le silo. On glisse pour se déplacer, la molette zoome, un clic
ouvre une fiche ; touches 1 à 9 pour un agent, F la forge, V la version, 0 pour recadrer.

Les cinq templates ne changent pas le décor mais la façon de travailler avec la tour. Le menu
**Fonctionnement** passe de l'un à l'autre ; le choix est retenu par le navigateur. **Galerie**
(<http://127.0.0.1:4777/galerie.html>) les compare côte à côte en captures.

| Template | Comment on s'en sert |
| --- | --- |
| À traiter (par défaut) | une liste de ce qui t'attend, un bouton par sujet ; liste vide, rien à faire |
| L'équipe | une carte par agent (ce qu'il fait, depuis quand) ; la caméra suit celui qu'on choisit |
| La version | la version à sortir pilote tout : la prochaine étape en grand, puis chaque feature et ses preuves |
| Coup d'œil | pour un second écran : l'usine en grand, une phrase qui dit l'essentiel, des notifications |
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

La tour compte les **tokens** de chaque session en lisant son journal Claude Code (le `transcript_path`
que le hook lui passe ; lecture seule) : le total (entrée, sortie, cache), le **contexte** rempli par
rapport à la fenêtre (200 k, ou 1 M), et ce que coûte chaque **action** (Read, Bash, Edit...). On les
voit dans la fiche de chaque agent, et dans le panneau Tâches : dernières tâches lancées et tokens du
jour par session. Au clavier, « tâche » liste les tâches à lancer.

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
| `lib/inventory.js`, `web/map.js` | carte du projet : comptage des assets et dessin de la ville |
| `unreal/AlkatrazzTower`, `scripts/install-plugin.js` | plugin d'éditeur Unreal et son installation dans un projet |
| `skills/alkatrazz-tower-personnages` | skill qui apprend aux agents à modifier un personnage |
| `vendor/unreal-engine-skills` | 31 skills Unreal de quodsoler (MIT, commit f3742d7) |
