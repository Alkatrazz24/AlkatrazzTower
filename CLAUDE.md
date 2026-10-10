# Alkatrazz Tower — consignes pour Claude

## Process de travail

Claude travaille en autonomie complète sur ce dépôt :

1. Une branche par sujet, partie de `main` à jour (`feat/…`, `fix/…`, `docs/…`).
2. `npm test` vert avant chaque push.
3. Push de la branche, puis une pull request en français vers `main`.
4. Ali relit les PR et merge lui-même. Claude ne pousse jamais sur `main` et ne merge jamais.

Pas besoin de demander avant de coder, committer, pousser une branche ou ouvrir une PR. Reste à
signaler avant d'agir : toute modification du `~/.claude/settings.json` global (hors
`scripts/install-hooks.js` déjà validé) ou d'un autre projet que celui-ci.

## Repères

- Spec : [Alkatrazz Tower — Spécification](https://claude.ai/code/artifact/8990f63e-d9bb-4da9-855d-0908465aedaa)
- Aucune dépendance npm, Node 20 ou plus. Le hook doit rester muet, rapide et sortir en 0 quoi qu'il arrive.
- Les sorties de `tower-run` restent en ASCII : la console PowerShell des agents ne lit pas l'UTF-8.

## Voir ce que tu construis

Le serveur MCP `chrome-devtools` (`.mcp.json`) donne un navigateur. Après chaque changement de `web/` :

1. Ouvre la page : la tour en marche sur le PC (http://127.0.0.1:4777), sinon une tour d'essai
   (`TOWER_PORT=4799 TOWER_DATA=<dossier temporaire> npm start`, jamais le `data/` réel) ou `?demo`.
2. Capture d'écran et `take_snapshot`, console (`list_console_messages`) et réseau : zéro erreur,
   zéro avertissement nouveau.
3. Essaie l'action changée comme ali le ferait (clics, clavier), puis corrige ce que tu vois.
4. Pour un changement visuel, vérifie aussi un autre template ou une autre ambiance.

## Skills du projet

`.claude/settings.json` active deux plugins pour ce dépôt seulement (le `~/.claude/settings.json` global
n'est pas touché) :

- `agent-skills` d'Addy Osmani : méthode d'ingénieur (spec, plan, tests, revue). Pour la page web, le skill
  `frontend-ui-engineering` et `browser-testing-with-devtools`.
- `frontend-design` d'Anthropic : direction visuelle de `web/`. La page reste en HTML, CSS et JS sans
  framework ni dépendance npm, même si un skill propose React ou Tailwind.
