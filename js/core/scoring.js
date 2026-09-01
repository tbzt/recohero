/* ==========================================================================
   scoring.js — du jeu de réponses au profil de sortie.
   Fonctions pures : aucune lecture du DOM, aucune écriture de stockage.
   C'est ce qui permet au backoffice de simuler un parcours sans le jouer.
   ========================================================================== */

/* answers : { [questionId]: optionId | optionId[] } */

export function tally(quiz, answers) {
  const counts = Object.fromEntries(quiz.axes.map((a) => [a.id, 0]));

  for (const question of quiz.questions) {
    const picked = answers[question.id];
    if (picked == null) continue;
    const ids = Array.isArray(picked) ? picked : [picked];
    for (const optionId of ids) {
      const option = question.options.find((o) => o.id === optionId);
      if (!option) continue;
      for (const axis of quiz.axes) {
        counts[axis.id] += option.scores[axis.id] || 0;
      }
    }
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const best = Math.max(-Infinity, ...Object.values(counts));
  const leaders = quiz.axes.filter((a) => counts[a.id] === best).map((a) => a.id);

  return { counts, total, best: Number.isFinite(best) ? best : 0, leaders };
}

/* Résolution : la première règle qui matche gagne, dans l'ordre où les
   profils sont rangés dans le backoffice. Ce détail est visible dans
   l'éditeur — l'ordre des profils EST la priorité, et on le dit.
   Les « fallback » sont examinés en dernier, quelle que soit leur place. */

export function resolve(quiz, scores) {
  const ranked = [...quiz.results].filter((r) => r.rule.mode !== 'fallback');
  const fallbacks = quiz.results.filter((r) => r.rule.mode === 'fallback');

  for (const result of [...ranked, ...fallbacks]) {
    if (matches(result.rule, scores)) return result;
  }

  /* Rien n'a matché : on rend `null`, et le parcours affiche son écran
     « aucun profil ne correspond ». Servir `results[0]` — ce qui se
     faisait ici — donnait au répondant un profil dont la condition est
     explicitement FAUSSE, sans que rien ne le signale : ni à lui, ni à
     l'auteur, dont l'écran d'échec restait alors du code mort. Un
     questionnaire sans filet doit se voir, pas se rattraper en douce. */
  return null;
}

function matches(rule, scores) {
  switch (rule.mode) {
    case 'dominant':
      /* Un axe à égalité ne domine pas — c'est ce que dit le mot, et c'est
         ce qu'attend l'auteur qui écrit un profil d'indécis. La règle
         acceptait auparavant tout axe FIGURANT parmi les leaders : l'ex
         æquo était donc tranché par l'ordre de la liste, et le profil
         « par défaut » écrit pour ce cas-là ne sortait jamais. */
      return scores.leaders.length === 1 && scores.leaders[0] === rule.axis;
    case 'range': {
      const value = scores.counts[rule.axis] ?? 0;
      return value >= rule.min && value <= rule.max;
    }
    case 'total':
      return scores.total >= rule.min && scores.total <= rule.max;
    case 'fallback':
      return true;
    default:
      return false;
  }
}

/* Le score maximal atteignable par axe, pour dimensionner les jauges.
   Sur une question à choix unique, c'est le meilleur choix ; sur une
   question à choix multiple, c'est la somme des choix positifs.        */

export function ceilings(quiz) {
  const max = Object.fromEntries(quiz.axes.map((a) => [a.id, 0]));

  for (const question of quiz.questions) {
    for (const axis of quiz.axes) {
      const values = question.options.map((o) => o.scores[axis.id] || 0);
      if (!values.length) continue;
      max[axis.id] += question.type === 'multiple'
        ? values.filter((v) => v > 0).reduce((s, v) => s + v, 0)
        : Math.max(...values);
    }
  }
  return max;
}

/* --- La proximité -----------------------------------------------------------
   « Vous avez eu ça, mais vous n'étiez pas loin de ça. »

   Encore faut-il que ce soit vrai. On mesure donc, pour chaque profil
   écarté, de COMBIEN il a été manqué — dans l'unité du questionnaire, des
   points d'axe — et on ne propose le plus proche que si l'écart est petit
   au regard de ce qui était en jeu.

   Un filet « par défaut » n'est jamais une quasi-réussite : il attrape
   tout, il ne se rate pas. Il est écarté.                               */

function ecart(regle, scores, plafonds) {
  switch (regle.mode) {
    case 'dominant': {
      /* Combien de points il aurait fallu de plus sur cet axe pour qu'il
         mène. Zéro veut dire à égalité — manqué de rien du tout. */
      const value = scores.counts[regle.axis] ?? 0;
      return { points: Math.max(0, scores.best - value), axis: regle.axis };
    }
    case 'range': {
      const value = scores.counts[regle.axis] ?? 0;
      if (value < regle.min) return { points: regle.min - value, axis: regle.axis };
      if (value > regle.max) return { points: value - regle.max, axis: regle.axis };
      return { points: 0, axis: regle.axis };
    }
    case 'total': {
      if (scores.total < regle.min) return { points: regle.min - scores.total, axis: null };
      if (scores.total > regle.max) return { points: scores.total - regle.max, axis: null };
      return { points: 0, axis: null };
    }
    default:
      return null;   // le filet ne se rate pas
  }
}

export function proximite(quiz, scores, gagnant) {
  const plafonds = ceilings(quiz);

  const candidats = quiz.results
    .filter((r) => r !== gagnant && r.rule.mode !== 'fallback' && r.title.trim())
    .map((r) => ({ resultat: r, ...(ecart(r.rule, scores, plafonds) || {}) }))
    .filter((c) => Number.isFinite(c.points))
    .sort((a, b) => a.points - b.points);

  const meilleur = candidats[0];
  if (!meilleur) return null;

  /* Le seuil suit l'échelle du questionnaire : deux points d'écart ne
     veulent pas dire la même chose sur un axe qui plafonne à 6 et sur un
     qui plafonne à 40. En dessous de deux points, on affiche toujours —
     c'est un quasi ex æquo quelle que soit l'échelle. */
  const plafond = meilleur.axis ? (plafonds[meilleur.axis] || 0)
                                : Object.values(plafonds).reduce((a, b) => a + b, 0);
  const seuil = Math.max(2, Math.ceil(plafond * 0.15));
  if (meilleur.points > seuil) return null;

  return {
    resultat: meilleur.resultat,
    points: meilleur.points,
    axe: meilleur.axis ? quiz.axes.find((a) => a.id === meilleur.axis) : null,
  };
}

/* --- Ce qui a pesé -------------------------------------------------------------
   Le résultat disait QUOI sans jamais dire POURQUOI. Le texte du profil
   décrit une sensibilité générale, la feuille de score donne des nombres,
   mais rien ne reliait le verdict aux choix qu'on venait de faire — et une
   recommandation qu'on ne peut pas rattacher à soi se lit comme une sortie
   de machine.

   On rend donc au répondant SES propres réponses, celles qui ont poussé le
   plus fort dans la direction retenue. Rien n'est inventé ni reformulé : ce
   sont les phrases écrites par la bibliothécaire, et les points sont ceux
   qui ont réellement servi au calcul.

   L'axe qui décide dépend de la règle. « Axe dominant » et « palier sur un
   axe » en nomment un : c'est celui-là qu'on regarde. « Palier sur le total »
   et « par défaut » n'en nomment aucun — pour eux, ce qui compte est ce qui
   a le plus rapporté, toutes couleurs confondues. Prétendre le contraire
   serait désigner un coupable au hasard.                                  */

export function indices(quiz, answers, resultat, combien = 3) {
  const nomme = resultat?.rule?.mode === 'dominant' || resultat?.rule?.mode === 'range';
  const axeId = nomme ? resultat.rule.axis : null;

  const retenus = [];
  quiz.questions.forEach((question, rang) => {
    const choisi = answers[question.id];
    if (choisi == null) return;
    for (const optionId of Array.isArray(choisi) ? choisi : [choisi]) {
      const option = question.options.find((o) => o.id === optionId);
      if (!option) continue;
      /* Sur le total, seuls les apports POSITIFS comptent : une réponse qui
         retire des points n'a mené nulle part, elle a éloigné. */
      const points = axeId
        ? (option.scores[axeId] || 0)
        : Object.values(option.scores).reduce((s, v) => s + Math.max(0, v), 0);
      if (points > 0) retenus.push({ question, option, points, rang });
    }
  });

  /* On choisit sur les points, on affiche dans l'ordre du parcours : « vous
     avez dit ceci, puis cela » se relit, un classement décroissant non. */
  const meilleurs = [...retenus]
    .sort((a, b) => b.points - a.points)
    .slice(0, combien)
    .sort((a, b) => a.rang - b.rang);

  /* Un seul choix n'est pas un faisceau d'indices, c'est une anecdote. */
  if (meilleurs.length < 2) return null;

  return {
    axe: axeId ? quiz.axes.find((a) => a.id === axeId) || null : null,
    choix: meilleurs,
  };
}

/* Un profil est-il atteignable ? Le backoffice s'en sert pour prévenir
   avant publication qu'une règle ne se déclenchera jamais.
   On explore exhaustivement quand c'est petit, on échantillonne sinon.

   Le nombre de réponses possibles n'est PAS le nombre d'options : sur une
   question à choix multiple, le répondant coche n'importe quelle
   combinaison non vide, soit 2^n − 1. L'exploration n'essayait qu'une
   option à la fois — un profil qu'on n'atteignait qu'en cochant deux cases
   était donc annoncé « jamais atteint », et l'auteur envoyé réparer une
   règle qui marchait. Un faux positif de diagnostic coûte plus cher qu'un
   silence : il apprend à ignorer la pastille, y compris quand elle a
   raison.                                                               */

const PLAFOND_EXHAUSTIF = 20000;

function nombreDeChoix(question) {
  return question.type === 'multiple'
    ? 2 ** question.options.length - 1
    : question.options.length;
}

/* Les choix eux-mêmes. N'est appelé que sur la branche exhaustive, où le
   plafond garantit qu'aucune question n'en porte des millions. */
function choixPossibles(question) {
  const ids = question.options.map((o) => o.id);
  if (question.type !== 'multiple') return ids;
  const combinaisons = [];
  for (let masque = 1; masque < (1 << ids.length); masque += 1) {
    combinaisons.push(ids.filter((_, i) => masque & (1 << i)));
  }
  return combinaisons;
}

/* Un choix au hasard, sans énumérer : chaque option est prise à pile ou
   face, ce qui tire uniformément parmi les combinaisons — et on rejette
   la seule que le parcours interdit, la sélection vide. */
function choixAuHasard(question) {
  if (question.type !== 'multiple') {
    return question.options[Math.floor(Math.random() * question.options.length)].id;
  }
  let pris = [];
  while (!pris.length) {
    pris = question.options.filter(() => Math.random() < 0.5).map((o) => o.id);
  }
  return pris;
}

export function reachability(quiz) {
  const questions = quiz.questions.filter((q) => q.options.length);
  if (!questions.length || !quiz.results.length) return {};

  const combos = questions.reduce((n, q) => n * nombreDeChoix(q), 1);
  const exhaustive = combos <= PLAFOND_EXHAUSTIF;
  const hit = Object.fromEntries(quiz.results.map((r) => [r.id, false]));

  const record = (answers) => {
    const result = resolve(quiz, tally(quiz, answers));
    if (result) hit[result.id] = true;
  };

  if (exhaustive) {
    const parQuestion = questions.map(choixPossibles);
    const walk = (index, answers) => {
      if (index === questions.length) return record(answers);
      for (const choix of parQuestion[index]) {
        walk(index + 1, { ...answers, [questions[index].id]: choix });
      }
    };
    walk(0, {});
  } else {
    for (let i = 0; i < 4000; i += 1) {
      const answers = {};
      for (const q of questions) answers[q.id] = choixAuHasard(q);
      record(answers);
    }
  }

  return { hit, exhaustive };
}
