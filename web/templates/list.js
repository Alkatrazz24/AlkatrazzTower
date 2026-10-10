'use strict';
// Les templates de la tour : id (fichiers web/templates/<id>.js et .css), nom et idee en une phrase.
// Chaque template est une facon de se servir de la tour ; tous dessinent la meme usine en fond
// (engine : moteur charge avant le template, web/<engine>/moteur.js et hud.css). L'ambiance (jour, nuit,
// plan, volcan, banquise) se choisit a part, dans la barre du haut.
// Lu par web/core.js et par la galerie (web/galerie.html).
window.TOWER_TEMPLATES = [
  { id: 'atraiter', engine: 'usine', name: 'À traiter', pitch: 'Une liste de ce qui t\'attend, un bouton par sujet. Liste vide : rien à faire, l\'usine tourne seule.' },
  { id: 'equipe', engine: 'usine', name: 'L\'équipe', pitch: 'Une carte par agent : ce qu\'il fait, depuis quand. Tu en choisis un, la caméra le suit.' },
  { id: 'version', engine: 'usine', name: 'La version', pitch: 'La version à sortir pilote tout : la prochaine étape en grand, puis chaque feature et ses preuves.' },
  { id: 'coupdoeil', engine: 'usine', name: 'Coup d\'œil', pitch: 'Pour un second écran : l\'usine en grand, une phrase qui dit l\'essentiel, des notifications quand ça bouge.' },
  { id: 'clavier', engine: 'usine', name: 'Au clavier', pitch: 'Une barre de commande : tape un nom ou « forge », Entrée fait l\'action.' },
];
// Le template montre tant qu'ali n'en a pas choisi un autre.
window.TOWER_DEFAULT = 'atraiter';
