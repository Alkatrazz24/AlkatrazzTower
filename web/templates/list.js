'use strict';
// Les templates de la tour : id (fichiers web/templates/<id>.js et .css), nom et idee en une phrase.
// Lu par web/core.js et par la galerie (web/galerie.html).
window.TOWER_TEMPLATES = [
  { id: 'usine', name: 'L\'usine', pitch: 'Un jeu de gestion d\'usine tourne en fond : chaque agent est une machine, les builds roulent sur le tapis jusqu\'à la forge, la version est une fusée à assembler.' },
  { id: 'controle', name: 'Tour de contrôle', pitch: 'Chaque agent est une bande de vol, la forge est la piste : un seul décollage à la fois.' },
  { id: 'essentiel', name: 'Essentiel', pitch: 'Une page claire et calme qui commence par ce qui t\'attend, le reste se lit d\'un coup d\'œil.' },
  { id: 'village', name: 'Le village', pitch: 'La carte du projet en grand, les personnages au travail, la version comme une quête.' },
  { id: 'level0', name: 'Level 0', pitch: 'L\'ambiance de Conquer the Backrooms : néons, papier peint jaune et caméra de surveillance.' },
  { id: 'console', name: 'Console', pitch: 'Des panneaux de terminal pilotés au clavier, comme les sessions Claude Code elles-mêmes.' },
];
// Le template montre tant qu'ali n'en a pas choisi un autre.
window.TOWER_DEFAULT = 'usine';
