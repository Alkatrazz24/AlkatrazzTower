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

## La carte du projet

En haut de la page, le projet est une petite ville. La maison au centre, c'est le jeu, avec son nom,
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
| `web/index.html` | la page |
| `scripts/install-hooks.js` | branchement des hooks |
| `scripts/setup.js`, `setup.cmd`, `uninstall.cmd` | installation et retrait sur un PC |
| `lib/characters.js`, `web/avatar.js` | personnages : allure, validation, dessin en pixels |
| `lib/projects.js` | recherche et connexion des projets Unreal |
| `lib/inventory.js`, `web/map.js` | carte du projet : comptage des assets et dessin de la ville |
| `skills/alkatrazz-tower-personnages` | skill qui apprend aux agents à modifier un personnage |
| `vendor/unreal-engine-skills` | 31 skills Unreal de quodsoler (MIT, commit f3742d7) |
