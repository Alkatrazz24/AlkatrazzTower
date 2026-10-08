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
| `web/index.html` | la page |
| `scripts/install-hooks.js` | branchement des hooks |
