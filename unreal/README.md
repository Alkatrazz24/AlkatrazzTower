# Plugin Unreal « Alkatrazz Tower »

Un petit plugin d'éditeur (UE 5.8, Win64) qui relie l'éditeur à la tour. Sans la tour, il ne fait
rien de visible : ses requêtes échouent en silence et l'éditeur marche comme avant.

## Ce qu'il apporte

| Dans l'éditeur | Dans la tour |
| --- | --- |
| Bouton **Tour** dans la barre d'outils, onglet **Alkatrazz Tower** (menu Fenêtre > Outils) qui affiche la page | En-tête : map ouverte, PIE en cours, assets non sauvegardés, Live Coding qui compile |
| Notification quand un agent **attend ta réponse**, qu'un build **échoue**, qu'un agent **lance une compilation**, qu'un package réussit ou que la version est validée | — |
| **Live Coding sous le verrou** : une compilation lancée dans l'éditeur (Ctrl+Alt+F11) prend son ticket comme un agent ; s'il y a déjà une compilation, une notification te prévient | Elle apparaît dans la file de la forge et dans l'historique (« Live Coding », patch appliqué, aucun changement ou échec) |
| Ouvrir un asset qu'un agent vient de modifier affiche un avertissement | — |
| — | Chaque asset ajouté, renommé, supprimé ou sauvegardé met la carte du projet à jour en quelques secondes |
| — | Avant un `Build.bat` de la cible Éditeur pendant que l'éditeur est ouvert avec Live Coding, l'agent est prévenu que ça va échouer (code 6) |

## Installer dans un projet

```bat
node scripts\install-plugin.js "C:\chemin\vers\MonJeu.uproject"
```

Le script copie le plugin dans `MonJeu\Plugins\AlkatrazzTower`. Il se compile ensuite avec la cible
Éditeur du projet, éditeur fermé, ou Unreal propose de le compiler à la prochaine ouverture.
`--remove` le retire.

Réglage : la commande console `Tower.Port` (0 = variable `TOWER_PORT`, sinon 4777).

## Compiler le plugin seul

Sans toucher à un projet, pour vérifier qu'il compile :

```bat
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\RunUAT.bat" BuildPlugin -Plugin="%CD%\unreal\AlkatrazzTower\AlkatrazzTower.uplugin" -Package="%TEMP%\tower-plugin-build" -TargetPlatforms=Win64
```

## Limites

- Live Coding n'a pas d'événement « la compilation commence » côté éditeur : le plugin regarde
  `IsCompiling()` chaque seconde. Il ne peut donc pas empêcher une compilation lancée pendant celle
  d'un agent, seulement la mettre dans la file et te prévenir.
- Le résultat d'une compilation Live Coding est déduit du journal `LogLiveCoding` et du patch appliqué.
