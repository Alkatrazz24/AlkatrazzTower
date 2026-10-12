'use strict';
// Les templates de la tour : id (fichiers web/templates/<id>.js et .css), nom et idee en une phrase.
// « Conversations » (moteur appli) est l'application ; les autres sont l'ancienne interface en jeu, qui dessine
// la tour en fond (une salle par session), gardee le temps de comparer. engine : moteur charge avant le template,
// web/<engine>/moteur.js et hud.css.
// Lu par web/core.js et par la galerie (web/galerie.html).
window.TOWER_TEMPLATES = [
  { id: 'conversations', engine: 'appli', name: 'Conversations', pitch: 'La tour comme une messagerie : le Chef, le Conseil et chaque session sont des conversations ; à droite, ce qui t\'attend et la santé du projet.' },
  { id: 'atraiter', engine: 'usine', name: 'À traiter', pitch: 'Une liste de ce qui t\'attend, un bouton par sujet. Liste vide : rien à faire, la tour tourne seule.' },
  { id: 'equipe', engine: 'usine', name: 'L\'équipe', pitch: 'Une carte par agent : ce qu\'il fait, depuis quand. Tu en choisis un, la caméra va à sa salle.' },
  { id: 'version', engine: 'usine', name: 'La version', pitch: 'La version à sortir pilote tout : la prochaine étape en grand, puis chaque feature et ses preuves.' },
  { id: 'coupdoeil', engine: 'usine', name: 'Coup d\'œil', pitch: 'Pour un second écran : la tour en grand, une phrase qui dit l\'essentiel, des notifications quand ça bouge.' },
  { id: 'clavier', engine: 'usine', name: 'Au clavier', pitch: 'Une barre de commande : tape un nom ou « forge », Entrée fait l\'action.' },
];
// Le template montre tant qu'ali n'en a pas choisi un autre.
window.TOWER_DEFAULT = 'conversations';
