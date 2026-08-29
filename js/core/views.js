/* ==========================================================================
   views.js — la vue d'une question, partagée par le parcours et l'éditeur.

   L'aperçu du backoffice ne peut pas être une imitation : une imitation
   dérive au premier changement, et ce qu'elle montre finit par ne plus
   être ce que le répondant voit. C'est donc le MÊME rendu, appelé avec
   `interactive: false`.
   ========================================================================== */

import { el } from './ui.js';

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

    el('div', { class: 'options', role: multiple ? 'group' : 'radiogroup' },
      question.options.map((option, i) => el(interactive ? 'button' : 'div', {
        class: 'option' + (chosen.has(option.id) ? ' is-picked' : ''),
        type: interactive ? 'button' : null,
        'data-act': interactive ? 'pick' : null,
        'data-option': interactive ? option.id : null,
        'aria-pressed': interactive && multiple ? String(chosen.has(option.id)) : null,
        role: interactive && !multiple ? 'radio' : null,
        'aria-checked': interactive && !multiple ? String(chosen.has(option.id)) : null,
      }, [
        el('span', { class: 'option__key', text: i < 9 ? String(i + 1) : '·', 'aria-hidden': 'true' }),
        option.image && el('img', { class: 'option__thumb', src: option.image, alt: '', loading: 'lazy' }),
        option.emoji && el('span', { class: 'option__emoji', text: option.emoji, 'aria-hidden': 'true' }),
        el('span', { class: 'option__text', text: option.text || `Réponse ${i + 1}` }),
      ]))),
  ]);
}
