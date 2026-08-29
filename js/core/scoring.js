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
  return quiz.results[0] || null;
}

function matches(rule, scores) {
  switch (rule.mode) {
    case 'dominant':
      return scores.leaders.includes(rule.axis);
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

/* Un profil est-il atteignable ? Le backoffice s'en sert pour prévenir
   avant publication qu'une règle ne se déclenchera jamais.
   On explore exhaustivement quand c'est petit, on échantillonne sinon. */

export function reachability(quiz) {
  const questions = quiz.questions.filter((q) => q.options.length);
  if (!questions.length || !quiz.results.length) return {};

  const combos = questions.reduce((n, q) => n * q.options.length, 1);
  const hit = Object.fromEntries(quiz.results.map((r) => [r.id, false]));

  const record = (answers) => {
    const result = resolve(quiz, tally(quiz, answers));
    if (result) hit[result.id] = true;
  };

  if (combos <= 20000) {
    const walk = (index, answers) => {
      if (index === questions.length) return record(answers);
      for (const option of questions[index].options) {
        walk(index + 1, { ...answers, [questions[index].id]: option.id });
      }
    };
    walk(0, {});
  } else {
    for (let i = 0; i < 4000; i += 1) {
      const answers = {};
      for (const q of questions) {
        answers[q.id] = q.options[Math.floor(Math.random() * q.options.length)].id;
      }
      record(answers);
    }
  }

  return { hit, exhaustive: combos <= 20000 };
}
