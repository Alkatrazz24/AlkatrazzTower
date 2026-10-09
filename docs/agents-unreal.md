# Agents Claude Code sur Unreal Engine 5 : ce qui aide vraiment

Recherche faite le 9 octobre 2026 pour UE 5.8. Chaque point renvoie à sa source.

## Ce que la tour fait déjà pour toi

- **Doc d'abord** : au début de chaque session sur un projet Unreal, le hook de la tour donne à l'agent
  la règle « vérifier dans la doc officielle avant d'agir », les liens de la doc épinglés sur la version
  du projet (`?application_version=5.8`) et le chemin des en-têtes du moteur installé.
  La fiche de l'agent montre ensuite s'il a vraiment consulté la doc ou les en-têtes.
- **Un build à la fois** et **tests vérifiés dans le journal** (le code de sortie
  d'`UnrealEditor-Cmd` ment, la tour lit les lignes `Test Completed`).

## La doc officielle

- Tout est sous `https://dev.epicgames.com/documentation/en-us/unreal-engine/<page>` ; sans paramètre on
  obtient la dernière version, `?application_version=5.8` épingle la tienne.
  [Accueil 5.8](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-8-documentation),
  [API C++](https://dev.epicgames.com/documentation/en-us/unreal-engine/API).
- Pas de `llms.txt` ni de version Markdown des pages : les agents lisent les pages HTML avec WebFetch.
- L'API C++ est générée depuis les sources : les **en-têtes installés**
  (`C:\Program Files\Epic Games\UE_5.8\Engine\Source` et `Engine\Plugins`) donnent les signatures exactes
  de ta version. Les `.cpp` privés du moteur ne sont pas installés.

## Recommandations

1. **Donner à l'agent une vérification qu'il peut lancer lui-même** (compilation, tests) plutôt que
   des consignes : c'est le conseil numéro un d'Anthropic.
   [Best practices](https://code.claude.com/docs/en/best-practices)
2. **CLAUDE.md court** : commandes, pièges, conventions, et des liens vers la doc plutôt que la doc
   elle-même. Les connaissances utiles de temps en temps vont dans des skills, les règles à respecter
   toujours dans des hooks. (même source)
3. **Unreal MCP d'Epic (5.8, expérimental)** : déjà présent dans ton moteur
   (`Engine\Plugins\Experimental\ModelContextProtocol`). La commande
   `ModelContextProtocol.GenerateClientConfig ClaudeCode` écrit le `.mcp.json`. Attention : les appels
   passent un par un sur le thread de jeu, donc **plusieurs agents ne doivent pas piloter le même
   éditeur en même temps**, ce que ton verrou `editeur.txt` fait déjà.
   [Doc Unreal MCP](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-mcp-in-unreal-editor)
4. **Éditeur ouvert** : `Build.bat` échoue (code 6) quand Live Coding est actif. Live Coding suffit pour
   le corps des fonctions ; une nouvelle `UFUNCTION`, `UPROPERTY` ou classe demande de fermer l'éditeur
   et de recompiler. [Forum](https://forums.unrealengine.com/t/build-bat-fails-exited-with-code-6/237526)
5. **Blueprints** : ce sont des `.uasset` binaires, l'agent ne les voit qu'à travers le MCP. Les agents
   sont les plus fiables sur du C++ bien cadré.
   [Ludus](https://ludusengine.com/blog/claude-code-for-unreal-engine)

## Skills et plugins Unreal existants

| Nom | Ce qu'il apporte | État chez toi |
| --- | --- | --- |
| [Unreal Engine Skills for Claude Code](https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin) (Epic) | skills `unreal-mcp`, `create-toolset`, `unreal-skill`, conventions UE au démarrage | activé dans le projet CTB |
| [quodsoler/unreal-engine-skills](https://github.com/quodsoler/unreal-engine-skills) | 31 skills `ue-*` (C++, Build.cs, GAS, Enhanced Input, tests, réseau, StateTree, Mass) annoncés vérifiés sur les en-têtes 5.8 | installé pour tous les agents dans `~/.claude/skills` le 9 octobre 2026 (commit f3742d7, licence MIT, uniquement du Markdown) |
| [dstn2000/claude-unreal-engine-skill](https://github.com/dstn2000/claude-unreal-engine-skill) | découverte du projet, Enhanced Input, GAS, Blueprint/C++ | pas installé |

Les skills tiers s'exécutent avec les droits de tes agents : à relire avant de les installer.
