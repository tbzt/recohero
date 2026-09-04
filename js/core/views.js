/* ==========================================================================
   views.js — les vues du parcours, partagées par le parcours et l'éditeur :
   la question, la couverture, le bandeau de profil, la recommandation.

   L'aperçu du backoffice ne peut pas être une imitation : une imitation
   dérive au premier changement, et ce qu'elle montre finit par ne plus
   être ce que le répondant voit. C'est donc le MÊME rendu, appelé avec
   `interactive: false` — les boutons deviennent des éléments inertes, et
   le titre cesse d'être un <h1> pour ne pas en poser un second dans une
   page qui a déjà le sien.
   ========================================================================== */

import { el, paragraphs, escapeHtml } from './ui.js';
import { RECO_TYPES, dureeEstimee } from './schema.js';

export function questionView(quiz, question, index, options = {}) {
  const {
    chosen = new Set(),
    total = quiz.questions.length,
    interactive = true,
  } = options;

  const multiple = question.type === 'multiple';

  return el('section', { class: 'question' + (interactive ? '' : ' question--static') }, [
    el('p', { class: 'question__meta' }, [
      `Question ${index + 1} / ${total}`,
      multiple && el('span', { class: 'pill', text: 'plusieurs réponses possibles' }),
    ]),

    question.image && el('img', { class: 'question__image', src: question.image, alt: '' }),

    /* Le titre reste un <h1> dans le parcours : c'est là que va le focus au
       changement d'écran. Dans un aperçu, ce serait un second <h1> sur une
       page qui en a déjà un. */
    el(interactive ? 'h1' : 'p', {
      class: 'question__text',
      text: question.text || 'Question sans texte',
    }),

    question.hint && el('p', { class: 'question__hint', text: question.hint }),

    /* `group`, et surtout PAS `radiogroup`. Le rôle radio promet une
       convention que ce parcours ne tient pas : dans un groupe de radios,
       ← et → déplacent la sélection À L'INTÉRIEUR du groupe — ici elles
       changent de question, ce qui est la navigation documentée du
       parcours et le geste que les gens ont appris. Un utilisateur de
       lecteur d'écran qui appliquait la convention annoncée changeait donc
       de question sans l'avoir demandé. Des boutons qui s'annoncent comme
       des boutons ne mentent sur rien, et restent parfaitement
       accessibles : l'état se dit par `aria-pressed`, le groupe est nommé
       par la question elle-même. */
    el('div', {
      class: 'options',
      role: 'group',
      'aria-label': question.text || `Question ${index + 1}`,
    }, question.options.map((option, i) => el(interactive ? 'button' : 'div', {
        class: 'option' + (chosen.has(option.id) ? ' is-picked' : ''),
        type: interactive ? 'button' : null,
        'data-act': interactive ? 'pick' : null,
        'data-option': interactive ? option.id : null,
        'aria-pressed': interactive ? String(chosen.has(option.id)) : null,
      }, [
        el('span', { class: 'option__key', text: i < 9 ? String(i + 1) : '·', 'aria-hidden': 'true' }),
        option.image && el('img', { class: 'option__thumb', src: option.image, alt: '', loading: 'lazy' }),
        option.emoji && el('span', { class: 'option__emoji', text: option.emoji, 'aria-hidden': 'true' }),
        el('span', { class: 'option__text', text: option.text || `Réponse ${i + 1}` }),
      ]))),
  ]);
}

/* --- La couverture ------------------------------------------------------------
   `resumable` et `signature` viennent du parcours, qui seul sait s'il y a
   une session à reprendre et qui a choisi d'être nommé. Dans l'éditeur,
   ni l'un ni l'autre. */
export function coverView(quiz, options = {}) {
  const { interactive = true, resumable = false, signature = null } = options;
  const n = quiz.questions.length;
  const p = quiz.results.length;
  const minutes = dureeEstimee(quiz);

  return el('section', { class: 'cover' + (interactive ? '' : ' cover--static') }, [
    /* La lumière de fin de journée : une lueur chaude et quelques grains
       qui dérivent, derrière le titre. Purement décoratif — masqué aux
       lecteurs d'écran, éteint sous `--ambient`, et rien du parcours n'en
       dépend. */
    el('div', { class: 'cover__lueur', 'aria-hidden': 'true' },
      [0, 1, 2, 3].map(() => el('span', { class: 'cover__mote' }))),
    quiz.image
      ? el('img', { class: 'cover__image', src: quiz.image, alt: '' })
      : el('div', { class: 'cover__emoji', text: quiz.emoji || '✦' }),
    el(interactive ? 'h1' : 'p', { class: 'cover__title', text: quiz.title || 'Questionnaire sans titre' }),
    quiz.tagline && el('p', { class: 'cover__tagline', text: quiz.tagline }),
    quiz.intro && el('div', { class: 'cover__intro', html: paragraphs(quiz.intro) }),
    el('div', { class: 'cover__axes' }, quiz.axes.map((axis, rang) => el(
      'span', {
        class: 'cover__axis',
        /* Le nom de transition fait voyager l'axe vers le compteur du
           bandeau au premier écran. Il n'a de sens que dans le parcours. */
        style: {
          '--axis': axis.color, animationDelay: `${120 + rang * 60}ms`,
          viewTransitionName: interactive ? `axe-${rang}` : null,
        },
      },
      [el('span', { class: 'glyph', text: axis.glyph }), axis.label || `Axe ${rang + 1}`],
    ))),
    el('div', { class: 'cover__actions' }, [
      el(interactive ? 'button' : 'span', {
        class: 'btn btn--primary', type: interactive ? 'button' : null,
        'data-act': interactive ? (resumable ? 'resume' : 'start') : null,
        text: resumable ? 'Reprendre où j’en étais' : 'Commencer',
      }),
      interactive && resumable && el('button', {
        class: 'btn btn--ghost', type: 'button', 'data-act': 'restart', text: 'Repartir de zéro',
      }),
    ]),
    signature,
    /* La durée d'abord : « huit questions » ne dit pas si on a le temps, et
       c'est la seule chose que se demande quelqu'un qui hésite devant une
       tablette — ou devant une affiche, qui annonce la même estimation. */
    el('p', {
      class: 'cover__meta',
      text: `environ ${minutes} minute${minutes > 1 ? 's' : ''} · `
          + `${n} question${n > 1 ? 's' : ''} · `
          + `${p} profil${p > 1 ? 's' : ''} possible${p > 1 ? 's' : ''}`,
    }),
  ]);
}

/* --- Le bandeau de profil -------------------------------------------------------
   Le moment que le parcours entier prépare. Le halo et les étincelles sont
   décoratifs ; quiz.css en règle la cadence par `--apres`. */
export function bannerView(quiz, profile, options = {}) {
  const { interactive = true } = options;
  return el('div', { class: 'result__banner' }, [
    el('div', { class: 'result__halo', 'aria-hidden': 'true' }),
    el('span', { class: 'result__spark', 'aria-hidden': 'true' }),
    el('span', { class: 'result__spark', 'aria-hidden': 'true' }),
    el('span', { class: 'result__spark', 'aria-hidden': 'true' }),
    el('p', { class: 'result__kicker', text: quiz.title }),
    profile.image && el('img', { class: 'result__image', src: profile.image, alt: '' }),
    el(interactive ? 'h1' : 'p', { class: 'result__title', text: profile.title || 'Profil sans titre' }),
    profile.subtitle && el('p', { class: 'result__subtitle', text: profile.subtitle }),
    profile.text && el('div', { class: 'result__text', html: paragraphs(profile.text) }),
  ]);
}

/* --- Une recommandation ---------------------------------------------------------- */
export function recoView(reco, index = 0, retard = 0) {
  const type = RECO_TYPES.find((t) => t.id === reco.type) || RECO_TYPES.at(-1);
  const meta = [reco.creator, reco.year].filter(Boolean).join(' · ');
  const title = reco.link
    ? `<a href="${escapeHtml(reco.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reco.title)} ↗</a>`
    : escapeHtml(reco.title || 'Sans titre');

  return el('article', { class: 'reco', style: { animationDelay: `${retard + index * 70}ms` } }, [
    reco.image
      ? el('img', { class: 'reco__cover', src: reco.image, alt: '', loading: 'lazy' })
      : el('div', { class: 'reco__icon', text: type.icon, title: type.label, 'aria-hidden': 'true' }),
    el('div', {}, [
      el('h3', { class: 'reco__title', html: title }),
      meta && el('p', { class: 'reco__creator', text: meta }),
      reco.note && el('p', { class: 'reco__note', text: reco.note }),
      /* Le seul élément de la reco qui serve une fois debout, dans le
         bâtiment. Il se détache pour ça. */
      reco.location && el('p', { class: 'reco__location' }, [
        el('span', { 'aria-hidden': 'true', text: '📍' }),
        el('span', { text: reco.location }),
      ]),
    ]),
  ]);
}
