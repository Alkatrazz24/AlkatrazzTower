'use strict';
// Le nom de la salle d'une session : ce qu'elle fait, pour qu'on s'y retrouve d'un coup d'oeil.
//   1. le nom que tu lui as donne dans la tour ;
//   2. la tache lancee depuis le panneau Taches ;
//   3. le titre de la session dans Claude Code (/rename, ou celui qu'il a genere) ;
//   4. sa premiere demande, resumee en quelques mots ;
//   5. a defaut, le projet ou le dossier.

const MAX = 48;

// Les mots de politesse et de liaison du debut ne disent rien de la demande.
const FILLER = /^(?:(?:ok(?:ay)?|bon|alors|salut|hello|hey|coucho?u|bonjour|stp|svp|donc|et|euh|bah|ben|du coup|mtn|maintenant|tu peux|peux[- ]tu|est-ce que tu peux|j'aimerais que tu|je veux que tu|il faut|faut|please|can you)\b[\s,.:;!]*)+/i;

function shortAsk(prompt, max = MAX) {
  let s = String(prompt || '').replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(FILLER, '');
  // la premiere phrase suffit
  const end = s.search(/[.!?\n](\s|$)/);
  if (end > 8) s = s.slice(0, end);
  s = s.replace(/[\s,]+(?:stp|svp|merci|please|thanks)[\s.!]*$/i, '');
  if (s.length > max) {
    const cut = s.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    s = (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:'-]+$/, '') + '…';
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const folder = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

function salleOf(a) {
  if (!a) return '';
  if (a.label) return a.label;
  if (a.task && a.task.title) return a.task.title;
  if (a.title) return a.title;
  if (a.sessionName) return a.sessionName;
  const ask = shortAsk(a.firstPrompt || a.prompt);
  if (ask) return ask;
  return a.project ? `Session sur ${a.project.name}` : folder(a.cwd) ? `Session dans ${folder(a.cwd)}` : 'Session';
}

module.exports = { salleOf, shortAsk, MAX };
