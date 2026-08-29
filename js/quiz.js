/* ==========================================================================
   quiz.js — le parcours du répondant.
   Une seule vue à l'écran, un seul état en mémoire, un seul point de
   rendu. La délégation d'évènements est posée une fois sur la scène :
   aucun gestionnaire en ligne dans le HTML.
   ========================================================================== */

import { resolveQuiz } from './core/catalog.js';
import { tally, resolve, ceilings } from './core/scoring.js';
import { RECO_TYPES } from './core/schema.js';
import * as store from './core/store.js';
import { linkFor } from './core/share.js';
import { el, paragraphs, escapeHtml, applyAccent, toast, copy } from './core/ui.js';

const params = new URLSearchParams(location.search);
const isTest = params.has('test');

const dom = {
  bar: document.getElementById('quizbar'),
  title: document.getElementById('quizTitle'),
  tally: document.getElementById('quizTally'),
  progress: document.getElementById('quizProgress'),
  stage: document.getElementById('stage'),
  exit: document.getElementById('exitLink'),
};

const state = {
  quiz: null,
  step: -1,        // -1 = couverture, n = résultat
  answers: {},
  direction: 'forward',
  finished: false,
};

/* --- Démarrage ------------------------------------------------------------ */

boot();

async function boot() {
  try {
    const quiz = await resolveQuiz({ id: params.get('q') });
    if (!quiz) return fail('Questionnaire introuvable.', "Vérifie le lien, ou reviens au kiosque.");
    if (!quiz.questions.length) return fail('Ce questionnaire n’a pas encore de question.', quiz.title);

    state.quiz = quiz;
    document.title = `${quiz.title} — RecoHero`;
    applyAccent(quiz.accent);
    dom.title.textContent = quiz.title;
    dom.bar.hidden = false;

    if (isTest) dom.exit.textContent = '← Retour au backoffice';

    const saved = store.getSession(quiz.id);
    if (saved && !isTest) state.answers = saved.answers || {};

    render();
    window.addEventListener('keydown', onKey);
    dom.stage.addEventListener('click', onStageClick);
  } catch (err) {
    fail('Ce lien de questionnaire n’a pas pu être lu.', err.message);
  }
}

function fail(message, detail) {
  dom.stage.replaceChildren(el('div', { class: 'page page--narrow' }, [
    el('div', { class: 'failure' }, [
      el('div', { class: 'failure__icon', text: '🧭' }),
      el('h1', { text: message }),
      detail && el('p', { class: 'failure__detail', text: detail }),
      el('p', { class: 'navrow', style: { justifyContent: 'center', marginTop: '1.5rem' } }, [
        el('a', { class: 'btn btn--primary', href: 'index.html', text: 'Aller au kiosque' }),
      ]),
    ]),
  ]));
}

/* --- Rendu ---------------------------------------------------------------- */

function render() {
  const { quiz, step } = state;
  const view =
    step < 0 ? renderCover() :
    step >= quiz.questions.length ? renderResult() :
    renderQuestion(quiz.questions[step], step);

  view.classList.add('view-enter');
  if (state.direction === 'back') view.classList.add('view-enter--back');

  dom.stage.replaceChildren(el('div', { class: 'stage__inner page' }, [view]));
  updateBar();

  const heading = dom.stage.querySelector('h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function updateBar() {
  const { quiz, step } = state;
  const answered = Object.keys(state.answers).length;
  const ratio = state.step >= quiz.questions.length
    ? 1
    : Math.min(answered, quiz.questions.length) / quiz.questions.length;
  dom.progress.style.width = `${Math.round(ratio * 100)}%`;

  const scores = tally(quiz, state.answers);
  dom.tally.replaceChildren(...quiz.axes.map((axis) => el(
    'span',
    { class: 'tally__axis', style: { '--axis': axis.color }, title: axis.label, 'data-axis': axis.id },
    [
      el('span', { class: 'tally__glyph', text: axis.glyph }),
      el('span', { class: 'tally__count', text: String(scores.counts[axis.id]) }),
    ],
  )));
  dom.tally.hidden = step < 0;
}

function bump(axisIds) {
  for (const id of axisIds) {
    const node = dom.tally.querySelector(`[data-axis="${CSS.escape(id)}"]`);
    if (!node) continue;
    node.classList.remove('is-bumped');
    void node.offsetWidth; /* redémarre la transition */
    node.classList.add('is-bumped');
    setTimeout(() => node.classList.remove('is-bumped'), 280);
  }
}

/* --- Couverture ------------------------------------------------------------ */

function renderCover() {
  const { quiz } = state;
  const resumable = Object.keys(state.answers).length > 0;

  return el('section', { class: 'cover' }, [
    el('div', { class: 'cover__emoji', text: quiz.emoji || '✦' }),
    el('h1', { class: 'cover__title', text: quiz.title }),
    quiz.tagline && el('p', { class: 'cover__tagline', text: quiz.tagline }),
    quiz.intro && el('div', { class: 'cover__intro', html: paragraphs(quiz.intro) }),
    el('div', { class: 'cover__axes' }, quiz.axes.map((axis) => el(
      'span', { class: 'cover__axis', style: { '--axis': axis.color } },
      [el('span', { class: 'glyph', text: axis.glyph }), axis.label],
    ))),
    el('div', { class: 'cover__actions' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button',
        'data-act': resumable ? 'resume' : 'start',
        text: resumable ? 'Reprendre où j’en étais' : 'Commencer',
      }),
      resumable && el('button', {
        class: 'btn btn--ghost', type: 'button', 'data-act': 'restart', text: 'Repartir de zéro',
      }),
    ]),
    el('p', {
      class: 'cover__meta',
      text: `${quiz.questions.length} question${quiz.questions.length > 1 ? 's' : ''} · `
          + `${quiz.results.length} profil${quiz.results.length > 1 ? 's' : ''} possible`
          + `${quiz.results.length > 1 ? 's' : ''}`,
    }),
    isTest && el('p', { class: 'cover__meta' }, [el('span', { class: 'pill pill--warn', text: 'Mode test — rien n’est enregistré' })]),
  ]);
}

/* --- Question -------------------------------------------------------------- */

function renderQuestion(question, index) {
  const { quiz } = state;
  const picked = state.answers[question.id];
  const chosen = new Set(Array.isArray(picked) ? picked : picked ? [picked] : []);
  const multiple = question.type === 'multiple';

  return el('section', { class: 'question' }, [
    el('p', { class: 'question__meta' }, [
      `Question ${index + 1} / ${quiz.questions.length}`,
      multiple && el('span', { class: 'pill', text: 'plusieurs réponses possibles' }),
    ]),
    el('h1', { class: 'question__text', text: question.text }),
    question.hint && el('p', { class: 'question__hint', text: question.hint }),

    el('div', { class: 'options', role: multiple ? 'group' : 'radiogroup' },
      question.options.map((option, i) => el('button', {
        class: 'option' + (chosen.has(option.id) ? ' is-picked' : ''),
        type: 'button',
        'data-act': 'pick',
        'data-option': option.id,
        'aria-pressed': multiple ? String(chosen.has(option.id)) : null,
        role: multiple ? null : 'radio',
        'aria-checked': multiple ? null : String(chosen.has(option.id)),
      }, [
        el('span', { class: 'option__key', text: i < 9 ? String(i + 1) : '·', 'aria-hidden': 'true' }),
        option.emoji && el('span', { class: 'option__emoji', text: option.emoji, 'aria-hidden': 'true' }),
        el('span', { class: 'option__text', text: option.text }),
      ]))),

    el('div', { class: 'navrow' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-act': 'back', text: '← Précédent' }),
      el('span', { class: 'navrow__spacer' }),
      (multiple || chosen.size) && el('button', {
        class: 'btn btn--primary', type: 'button', 'data-act': 'next',
        text: index + 1 === quiz.questions.length ? 'Voir le résultat' : 'Suivant →',
        'aria-disabled': chosen.size ? null : 'true',
      }),
    ]),
  ]);
}

/* --- Résultat --------------------------------------------------------------- */

function renderResult() {
  const { quiz } = state;
  const scores = tally(quiz, state.answers);
  const profile = resolve(quiz, scores);
  const caps = ceilings(quiz);

  if (!state.finished) {
    state.finished = true;
    store.clearSession(quiz.id);
    if (!isTest && profile) {
      store.addResult({
        quizId: quiz.id, quizTitle: quiz.title, quizEmoji: quiz.emoji,
        accent: quiz.accent, resultTitle: profile.title, resultEmoji: profile.emoji,
        counts: scores.counts,
        axes: quiz.axes.map((a) => ({ id: a.id, glyph: a.glyph, label: a.label, color: a.color })),
      });
    }
  }

  if (!profile) {
    return el('section', { class: 'failure' }, [
      el('h1', { text: 'Aucun profil ne correspond.' }),
      el('p', { text: 'Ce questionnaire n’a pas de profil « par défaut » pour rattraper ce cas.' }),
    ]);
  }

  const recosNode = el('section', { class: 'recos' }, [
    el('div', { class: 'recos__head' }, [
      el('h2', { text: 'À lire, voir, écouter' }),
      el('span', { class: 'pill pill--accent', text: `${profile.recos.length} reco${profile.recos.length > 1 ? 's' : ''}` }),
    ]),
    el('div', { class: 'recos__list' }, profile.recos.map((reco, i) => renderReco(reco, i))),
  ]);

  const node = el('section', { class: 'result' }, [
    el('div', { class: 'result__banner' }, [
      el('p', { class: 'result__kicker', text: quiz.title }),
      el('div', { class: 'result__emoji', text: profile.emoji || quiz.emoji || '✦' }),
      el('h1', { class: 'result__title', text: profile.title }),
      profile.subtitle && el('p', { class: 'result__subtitle', text: profile.subtitle }),
      profile.text && el('div', { class: 'result__text', html: paragraphs(profile.text) }),
    ]),

    el('div', { class: 'scores' }, quiz.axes.map((axis) => {
      const value = scores.counts[axis.id];
      const cap = Math.max(caps[axis.id] || 0, value, 1);
      return el('div', {
        class: 'score' + (scores.leaders.includes(axis.id) ? ' is-lead' : ''),
        style: { '--axis': axis.color },
      }, [
        el('span', { class: 'score__label' }, [
          el('span', { class: 'glyph', text: axis.glyph }), axis.label,
        ]),
        el('div', { class: 'score__track' }, [
          el('div', {
            class: 'score__fill',
            style: { width: `${Math.round(Math.min(1, Math.max(0, value) / cap) * 100)}%` },
          }),
        ]),
        el('span', { class: 'score__value', text: `${value}/${cap}` }),
      ]);
    })),

    profile.recos.length ? recosNode : null,

    el('div', { class: 'result__actions' }, [
      el('button', { class: 'btn btn--primary', type: 'button', 'data-act': 'restart', text: '↺ Refaire' }),
      el('button', { class: 'btn btn--ghost', type: 'button', 'data-act': 'share', text: '⤴ Partager ce questionnaire' }),
      el('a', { class: 'btn btn--quiet', href: 'index.html', text: 'Retour au kiosque' }),
    ]),
  ]);

  /* Le remplissage des jauges est une animation CSS, pas un réglage JS
     après coup : la largeur au repos est donc toujours juste, même si
     l'onglet est en arrière-plan quand le résultat est calculé.        */
  return node;
}

function renderReco(reco, index) {
  const type = RECO_TYPES.find((t) => t.id === reco.type) || RECO_TYPES.at(-1);
  const meta = [reco.creator, reco.year].filter(Boolean).join(' · ');
  const title = reco.link
    ? `<a href="${escapeHtml(reco.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reco.title)} ↗</a>`
    : escapeHtml(reco.title);

  return el('article', { class: 'reco', style: { animationDelay: `${index * 70}ms` } }, [
    el('div', { class: 'reco__icon', text: type.icon, title: type.label, 'aria-hidden': 'true' }),
    el('div', {}, [
      el('h3', { class: 'reco__title', html: title }),
      meta && el('p', { class: 'reco__creator', text: meta }),
      reco.note && el('p', { class: 'reco__note', text: reco.note }),
    ]),
  ]);
}

/* --- Interactions ----------------------------------------------------------- */

function onStageClick(event) {
  const trigger = event.target.closest('[data-act]');
  if (!trigger || !dom.stage.contains(trigger)) return;

  switch (trigger.dataset.act) {
    case 'start':
    case 'resume':  return go(0);
    case 'restart': return restart();
    case 'back':    return go(state.step - 1);
    case 'next':    return advance();
    case 'share':   return shareQuiz();
    case 'pick':    return pick(trigger);
    default:        return undefined;
  }
}

function pick(button) {
  const question = state.quiz.questions[state.step];
  if (!question) return;
  const optionId = button.dataset.option;
  const option = question.options.find((o) => o.id === optionId);
  const gained = option ? state.quiz.axes.filter((a) => (option.scores[a.id] || 0) > 0).map((a) => a.id) : [];

  if (question.type === 'multiple') {
    const current = new Set(state.answers[question.id] || []);
    current.has(optionId) ? current.delete(optionId) : current.add(optionId);
    if (current.size) state.answers[question.id] = [...current];
    else delete state.answers[question.id];
    persist();
    return render();
  }

  state.answers[question.id] = optionId;
  persist();

  for (const node of dom.stage.querySelectorAll('.option')) {
    node.classList.toggle('is-picked', node === button);
    node.setAttribute('aria-checked', String(node === button));
  }
  button.classList.add('is-confirmed');
  updateBar();
  bump(gained);

  /* Un temps de respiration avant d'enchaîner : assez pour voir le
     compteur bouger, assez court pour que ça reste fluide.            */
  setTimeout(() => advance(), 340);
}

function advance() {
  const question = state.quiz.questions[state.step];
  if (question && state.answers[question.id] == null) {
    return toast('Choisis au moins une réponse.', 'danger');
  }
  return go(state.step + 1);
}

function go(step) {
  const max = state.quiz.questions.length;
  state.direction = step < state.step ? 'back' : 'forward';
  state.step = Math.max(-1, Math.min(step, max));
  render();
}

function restart() {
  state.answers = {};
  state.finished = false;
  state.step = 0;
  state.direction = 'forward';
  store.clearSession(state.quiz.id);
  render();
}

function persist() {
  if (!isTest) store.saveSession(state.quiz.id, state.answers);
}

async function shareQuiz() {
  const url = state.quiz.source === 'published'
    ? new URL(`quiz.html?q=${encodeURIComponent(state.quiz.id)}`, location.href).toString()
    : await linkFor(state.quiz);
  if (navigator.share) {
    try {
      await navigator.share({ title: state.quiz.title, url });
      return;
    } catch { /* partage annulé : on retombe sur le presse-papier */ }
  }
  const ok = await copy(url);
  toast(ok ? 'Lien copié.' : 'Copie impossible.', ok ? '' : 'danger');
}

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (/^[1-9]$/.test(event.key)) {
    const buttons = dom.stage.querySelectorAll('.option');
    const target = buttons[Number(event.key) - 1];
    if (target) { event.preventDefault(); target.click(); }
    return;
  }
  if (event.key === 'Enter') {
    const next = dom.stage.querySelector('[data-act="next"], [data-act="start"], [data-act="resume"]');
    if (next) { event.preventDefault(); next.click(); }
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
    if (state.step > -1) { event.preventDefault(); go(state.step - 1); }
  }
  if (event.key === 'ArrowRight' && state.step > -1) {
    event.preventDefault();
    advance();
  }
}
