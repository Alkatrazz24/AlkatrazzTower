'use strict';
// Les templates de la tour : id (fichiers web/templates/<id>.js et .css), nom et idee en une phrase.
// engine : moteur commun charge avant le template (web/<engine>/moteur.js et hud.css).
// Lu par web/core.js et par la galerie (web/galerie.html).
window.TOWER_TEMPLATES = [
  { id: 'usine', engine: 'usine', name: 'L\'usine', pitch: 'En plein jour, entre herbe et rivières : la version de base, la plus lisible.' },
  { id: 'nuit', engine: 'usine', name: 'Équipe de nuit', pitch: 'La même usine dans le noir : seules les machines qui tournent, la forge et les alertes s\'allument.' },
  { id: 'plan', engine: 'usine', name: 'Le plan', pitch: 'L\'usine en plan d\'ingénieur, blanc sur bleu : calme, net, sans décor.' },
  { id: 'volcan', engine: 'usine', name: 'Le volcan', pitch: 'Sur une planète de basalte traversée de lave : la forge et les échecs brûlent plus fort.' },
  { id: 'banquise', engine: 'usine', name: 'La banquise', pitch: 'Neige et glace, HUD clair : une machine qui s\'arrête se couvre de givre.' },
];
// Le template montre tant qu'ali n'en a pas choisi un autre.
window.TOWER_DEFAULT = 'usine';
