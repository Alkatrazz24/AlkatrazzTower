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
