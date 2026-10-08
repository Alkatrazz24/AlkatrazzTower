# Alkatrazz Tower

Tour de garde locale : une page qui montre en direct chaque agent Claude Code qui travaille sur un
projet Unreal Engine 5, et un verrou qui garantit qu'un seul build Unreal tourne à la fois sur le PC.

Spécification complète : [Alkatrazz Tower — Spécification](https://claude.ai/code/artifact/8990f63e-d9bb-4da9-855d-0908465aedaa).

## Ce que fait la V1

- **Agents en direct** : une fiche par session (projet, dossier, demande, dernier outil, état :
  travaille, attend une réponse, à toi, terminé), mise à jour en temps réel.
- **Verrou de build** : `Build.bat`, `UnrealBuildTool`, `RunUAT`, `UnrealEditor-Cmd`,
  `cycle_editeur.ps1` et `tests.ps1` passent un par un ; les autres attendent dans une file visible.
- **Résultats** : dernier build et derniers tests de chaque agent (verdict, erreurs, tests ratés).
- **Éditeur et chantiers** : la page dit si `UnrealEditor.exe` est ouvert et affiche les verrous
  de domaine `Saved/chantiers/*.txt` des projets vus.
- **Jamais bloquant** : tour éteinte, les agents travaillent et buildent exactement comme avant.

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

## Démarrer

Node 20 ou plus, aucune dépendance npm.

```bat
start-tower.cmd
```

ou `npm start`, puis ouvrir <http://127.0.0.1:4777>. Le serveur n'écoute que sur la machine.

## Brancher les agents

Les hooks vont dans le `settings.json` de Claude Code. Le script ne touche qu'à ses propres hooks
et fait une copie de sauvegarde avant d'écrire.

```bat
node scripts\install-hooks.js            :: montre ce qui serait ajouté
node scripts\install-hooks.js --apply    :: ajoute les hooks à %USERPROFILE%\.claude\settings.json
node scripts\install-hooks.js --remove   :: les retire
```

`--settings <fichier>` vise un autre fichier, par exemple le `.claude\settings.local.json` d'un
seul projet pour essayer.

Les sessions déjà ouvertes prennent les hooks au vol. Pour couper la tour sans rien désinstaller :
variable d'environnement `TOWER_OFF=1`.

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
