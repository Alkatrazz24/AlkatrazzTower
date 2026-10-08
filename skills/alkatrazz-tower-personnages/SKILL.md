---
name: alkatrazz-tower-personnages
description: Modifier l'apparence ou le nom d'un personnage de la tour Alkatrazz (les agents Claude Code y sont dessines en personnages facon Minecraft). Utiliser quand l'utilisateur demande de changer, relooker, renommer, personnaliser ou rendre plus joli un personnage ou un agent de la tour, ou dit par exemple "donne un casque a Brique", "fais de l'agent des armes un pirate", "change mon personnage".
---

# Personnages de la tour Alkatrazz

La tour tourne en local sur `http://127.0.0.1:4777`. Chaque agent y est un personnage en pixels. Tu modifies
un personnage par son API, jamais en touchant aux fichiers de la tour.

## 1. Trouver le personnage

```bash
curl -s http://127.0.0.1:4777/api/characters
```

PowerShell : `Invoke-RestMethod http://127.0.0.1:4777/api/characters`

Chaque personnage a `id`, `name`, `role` (titre de session qu'il incarne, peut etre vide), `look` et `agents`
(sessions qui l'utilisent). Si l'utilisateur parle de « toi » ou de « mon agent », prends celui dont `agents`
contient ton propre `session_id` si tu le connais, sinon demande lequel. Si la tour ne repond pas, dis-le :
elle est eteinte (`start-tower.cmd` dans son dossier).

## 2. Le modifier

`POST /api/characters/update` avec `id` (ou `name` pour le retrouver par son nom) et seulement ce qui change :

```bash
curl -s -X POST http://127.0.0.1:4777/api/characters/update -H "Content-Type: application/json" \
  -d '{"name":"Brique","look":{"hat":"casque","hatColor":"#facc15","tool":"pioche"}}'
```

PowerShell :

```powershell
$b = @{ name = 'Brique'; look = @{ hat = 'casque'; hatColor = '#facc15'; tool = 'pioche' } } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4777/api/characters/update -ContentType 'application/json' -Body $b
```

Autres champs : `newName` (renommer, 32 caracteres max), `role` (attacher le personnage a un titre de session),
`randomize: true` (tirer une allure au hasard).

## 3. Ce que `look` accepte

Couleurs : uniquement `#rrggbb`. Champs : `skin`, `hair`, `eyes`, `shirt`, `pants`, `shoes`, `hatColor`,
`accessoryColor`.

| Champ | Valeurs |
| --- | --- |
| `hairStyle` | `court`, `long`, `chauve`, `crete`, `queue` |
| `shirtStyle` | `uni`, `rayures`, `veste`, `salopette` |
| `hat` | `aucun`, `casquette`, `casque`, `couronne`, `bandana`, `chapeau`, `capuche` |
| `accessory` | `aucun`, `lunettes`, `barbe`, `masque`, `casque-audio`, `cache-oeil` |
| `tool` | `aucun`, `pioche`, `marteau`, `cle`, `epee`, `clavier`, `pinceau` |

Une valeur inconnue est ignoree sans erreur : relis la reponse pour verifier ce qui a ete garde.

## 4. Traduire une envie en allure

Choisis des couleurs qui vont ensemble et un ensemble coherent. Exemples :

- pirate : `bandana` rouge, `cache-oeil`, `barbe`, haut `rayures` blanc et bleu, `epee`
- ouvrier du build : `casque` jaune, `salopette` bleue, `marteau`
- testeur : `lunettes`, `veste` grise, `clavier`
- roi du projet : `couronne`, `veste` violette, `epee`

Reponds ensuite en une phrase avec ce que tu as change : la page de la tour se met a jour toute seule.
