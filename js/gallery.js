/* ==========================================================================
   gallery.js — le kiosque. Liste ce qui est jouable, et ce qui a été joué.
   ========================================================================== */

import { loadAll } from './core/catalog.js';
import * as store from './core/store.js';
import { el, formatDate, toast, espaceCourant, avecEspace, garderEspace } from './core/ui.js';

/* L'espace vient de l'adresse, jamais du code : une même page sert le
   kiosque du dépôt et celui de n'importe quelle médiathèque. Tout lien
   interne doit le reconduire — cf. ui.js, § « L'espace, dans l'adresse ». */
const espace = espaceCourant();

const dom = {
  grid: document.getElementById('quizGrid'),
  count: document.getElementById('quizCount'),
  history: document.getElementById('history'),
  historySection: document.getElementById('historySection'),
  clear: document.getElementById('clearHistory'),
};

garderEspace();
boot();

async function boot() {
  renderQuizzes(await loadAll({ espace }));
  renderHistory();
  /* Même règle que dans le backoffice : on agit, on laisse un retour.
     L'historique est reconstitué depuis la mémoire, pas depuis le disque. */
  dom.clear.addEventListener('click', () => {
    const saved = store.allResults();
    if (!saved.length) return;
    store.clearResults();
    renderHistory();
    toast('Historique effacé', {
      action: {
        label: 'Annuler',
        onClick: () => {
          for (const entry of [...saved].reverse()) store.addResult(entry);
          renderHistory();
        },
      },
    });
  });
}

function renderQuizzes(quizzes) {
  dom.count.textContent = quizzes.length
    ? `${quizzes.length} questionnaire${quizzes.length > 1 ? 's' : ''}`
    : '';

  if (!quizzes.length) {
    dom.grid.replaceChildren(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', text: '📭' }),
      el('p', { text: 'Aucun questionnaire pour l’instant.' }),
      el('p', {}, [
        'Passez par le ',
        el('a', { href: avecEspace('admin.html'), text: 'backoffice' }),
        ' pour en créer un.',
      ]),
    ]));
    return;
  }

  const sorted = [...quizzes].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'draft' ? -1 : 1;
    return a.title.localeCompare(b.title, 'fr');
  });

  dom.grid.replaceChildren(...sorted.map(card));
}

function card(quiz) {
  const questions = quiz.questions.length;
  return el('a', {
    class: 'quiz-card',
    href: avecEspace(`quiz.html?q=${encodeURIComponent(quiz.id)}`),
    style: { '--card-accent': quiz.accent },
  }, [
    quiz.image && el('img', { class: 'quiz-card__cover', src: quiz.image, alt: '', loading: 'lazy' }),
    el('div', { class: 'quiz-card__top' }, [
      el('span', { class: 'quiz-card__emoji', text: quiz.emoji || '✦', 'aria-hidden': 'true' }),
      el('div', {}, [
        el('h3', { class: 'quiz-card__title', text: quiz.title }),
        quiz.tagline && el('p', { class: 'quiz-card__tagline', text: quiz.tagline }),
      ]),
    ]),
    el('div', { class: 'quiz-card__axes', 'aria-hidden': 'true' },
      quiz.axes.map((a) => el('span', { class: 'glyph', style: { '--axis': a.color }, text: a.glyph }))),
    el('div', { class: 'quiz-card__foot' }, [
      quiz.source === 'draft'
        ? el('span', { class: 'pill pill--warn', text: 'Brouillon local' })
        : el('span', { text: `${questions} question${questions > 1 ? 's' : ''}` }),
      el('span', { class: 'quiz-card__go', text: 'Commencer →' }),
    ]),
  ]);
}

function renderHistory() {
  const results = store.allResults();
  dom.historySection.hidden = results.length === 0;
  if (!results.length) return;

  dom.history.replaceChildren(...results.map((entry) => el('div', {
    class: 'history__row',
    style: { '--accent': entry.accent || 'var(--accent)' },
  }, [
    /* Les résultats d'avant la fusion portent encore leur emoji propre :
       on le sert tant qu'il existe, sinon celui du questionnaire. */
    el('span', { class: 'history__emoji', text: entry.resultEmoji || entry.quizEmoji || '✦' }),
    el('div', { class: 'history__body' }, [
      el('div', { class: 'history__result', text: entry.resultTitle }),
      el('div', { class: 'history__quiz', text: `${entry.quizTitle} · ${formatDate(entry.at)}` }),
    ]),
    el('div', { class: 'tally history__tally' }, (entry.axes || []).map((axis) => el(
      'span', { class: 'tally__axis', style: { '--axis': axis.color }, title: axis.label },
      [
        el('span', { class: 'tally__glyph', text: axis.glyph }),
        el('span', { class: 'tally__count', text: String(entry.counts?.[axis.id] ?? 0) }),
      ],
    ))),
    el('a', {
      class: 'btn btn--quiet btn--sm',
      href: avecEspace(`quiz.html?q=${encodeURIComponent(entry.quizId)}`),
      text: 'Refaire',
    }),
  ])));
}
