/* ==========================================================================
   admin/app.js — le backoffice : état, câblage, sauvegarde.
   Un seul état en mémoire, un seul point de rendu par zone (rail, panneau,
   diagnostic). Toute interaction passe par la délégation sur data-act ou
   par un data-bind : aucun gestionnaire en ligne dans le HTML.
   ========================================================================== */

import { PANELS } from './panels.js';
import {
  makeQuiz, makeAxis, makeQuestion, makeOption, makeResult, makeReco,
  normalize, diagnose, uid, slugify,
} from '../core/schema.js';
import { reachability } from '../core/scoring.js';
import { loadPublished } from '../core/catalog.js';
import * as store from '../core/store.js';
import { linkFor, encode } from '../core/share.js';
import { el, toast, copy, download, applyAccent, debounce, formatDate } from '../core/ui.js';

/* --- La porte -------------------------------------------------------------
   SHA-256 de la phrase d'accès. Elle n'est PAS un mécanisme de sécurité :
   sans serveur, il n'y a aucune donnée partagée à protéger, et le code de
   cette page est public. Elle évite d'ouvrir le backoffice par mégarde,
   rien de plus. Phrase livrée : « reco2026 ». Pour la changer, remplacer
   la constante par le SHA-256 de la nouvelle (README, § Backoffice).
   Mettre la chaîne vide supprime la porte.                              */
const PASS_SHA256 = '7afa3390516c3b831bde7acb98a061db9c626524677f643a9f55083c1bc427bc';
const UNLOCK_TTL = 12 * 60 * 60 * 1000;

/* Ces liaisons changent la forme du panneau : il faut le redessiner. */
const RESHAPE = /^(rule:[^:]+:mode|question:[^:]+:type|axis:[^:]+:(glyph|color)|q:accent)$/;

const state = {
  quiz: null,
  published: [],
  panel: 'identite',
  reach: null,
};

const dom = {};

boot();

async function boot() {
  for (const id of ['gate', 'gateForm', 'gatePass', 'shell', 'rail', 'panel',
                    'quizName', 'saveStatus', 'topActions']) {
    dom[id] = document.getElementById(id);
  }

  if (!PASS_SHA256 || store.isUnlocked(UNLOCK_TTL)) return open();

  dom.gate.hidden = false;
  dom.gatePass.focus();
  dom.gateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await sha256(dom.gatePass.value.trim()) !== PASS_SHA256) {
      dom.gatePass.value = '';
      dom.gatePass.setAttribute('aria-invalid', 'true');
      return toast('Phrase incorrecte.', 'danger');
    }
    store.setUnlocked();
    dom.gate.hidden = true;
    open();
  });
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function open() {
  dom.gate.hidden = true;
  dom.shell.hidden = false;

  state.published = await loadPublished();
  const drafts = store.allDrafts();
  if (drafts.length) select(drafts[0].id);

  renderRail();
  renderPanel();
  renderTopbar();

  dom.shell.addEventListener('click', onClick);
  dom.shell.addEventListener('input', onInput);
  dom.shell.addEventListener('change', onChange);
  dom.topActions.addEventListener('click', onClick);
  window.addEventListener('beforeunload', flush);
}

/* --- Rendu ------------------------------------------------------------------ */

function renderTopbar() {
  dom.quizName.textContent = state.quiz ? state.quiz.title : 'Aucun questionnaire ouvert';
  /* Le verrou reste actif même sans questionnaire ouvert. */
  for (const button of dom.topActions.querySelectorAll('[data-act="test"], [data-act="panel"]')) {
    button.disabled = !state.quiz;
  }
}

function renderRail() {
  const drafts = store.allDrafts();
  const draftIds = new Set(drafts.map((q) => q.id));
  const issues = state.quiz ? diagnose(state.quiz) : [];

  /* replaceChildren() convertit tout non-noeud en texte : une branche
     éteinte s'afficherait littéralement « null ». On filtre avant. */
  const blocks = [
    el('div', {}, [
      el('div', { class: 'rail__head' }, [
        el('h2', { text: 'Mes questionnaires' }),
        el('span', { class: 'rail__spacer' }),
        el('button', { class: 'btn btn--icon btn--quiet', type: 'button', 'data-act': 'new-quiz', title: 'Nouveau questionnaire', text: '+' }),
      ]),
      drafts.length
        ? el('div', { class: 'rail__list' }, drafts.map((quiz) => el('button', {
            class: 'rail__item' + (state.quiz?.id === quiz.id ? ' is-active' : ''),
            type: 'button', 'data-act': 'select', 'data-id': quiz.id,
          }, [
            el('span', { class: 'rail__item__emoji', text: quiz.emoji || '✦' }),
            el('span', { class: 'rail__item__label', text: quiz.title }),
            el('span', { class: 'rail__item__badge', text: `${quiz.questions?.length ?? 0}q` }),
          ])))
        : el('p', { class: 'panel__hint', style: { fontSize: 'var(--t-xs)' }, text: 'Rien encore. Crée-en un avec le +.' }),
    ]),

    state.published.length > 0 && el('div', {}, [
      el('div', { class: 'rail__head' }, [el('h2', { text: 'Publiés au dépôt' })]),
      el('div', { class: 'rail__list' }, state.published.map((quiz) => el('div', { class: 'rail__item' }, [
        el('span', { class: 'rail__item__emoji', text: quiz.emoji || '✦' }),
        el('span', { class: 'rail__item__label', text: quiz.title }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          'data-act': draftIds.has(quiz.id) ? 'select' : 'edit-published', 'data-id': quiz.id,
          title: draftIds.has(quiz.id) ? 'Copie locale déjà ouverte' : 'Modifier (crée une copie locale)',
          text: draftIds.has(quiz.id) ? '●' : '✎',
        }),
      ]))),
    ]),

    state.quiz && el('div', {}, [
      el('div', { class: 'rail__head' }, [el('h2', { text: 'Sections' })]),
      el('div', { class: 'rail__list' }, PANELS.map((panel) => el('button', {
        class: 'rail__item' + (state.panel === panel.id ? ' is-active' : ''),
        type: 'button', 'data-act': 'panel', 'data-id': panel.id,
      }, [
        el('span', { class: 'rail__item__emoji', text: panel.emoji }),
        el('span', { class: 'rail__item__label', text: panel.label }),
      ]))),
    ]),

    state.quiz && el('div', {}, [
      el('div', { class: 'rail__head' }, [
        el('h2', { text: 'Diagnostic' }),
        el('span', { class: 'rail__spacer' }),
        issues.length
          ? el('span', { class: 'pill ' + (issues.some((i) => i.level === 'error') ? 'pill--danger' : 'pill--warn'), text: String(issues.length) })
          : el('span', { class: 'pill pill--accent', text: 'prêt' }),
      ]),
      issues.length
        ? el('div', { class: 'diag' }, issues.slice(0, 12).map((issue) => el('button', {
            class: `diag__item diag__item--${issue.level === 'error' ? 'error' : 'warn'}`,
            type: 'button', 'data-act': 'panel', 'data-id': issue.where,
          }, [
            el('span', { class: 'diag__mark', text: issue.level === 'error' ? '●' : '▲' }),
            el('span', { text: issue.msg }),
          ])))
        : el('p', { class: 'diag__ok' }, [el('span', { text: '✓' }), el('span', { text: 'Rien à signaler. Prêt à diffuser.' })]),
    ]),
  ];

  dom.rail.replaceChildren(...blocks.filter((node) => node instanceof Node));
}

async function renderPanel() {
  if (!state.quiz) {
    dom.panel.replaceChildren(el('section', { class: 'panel' }, [
      el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon', text: '✦' }),
        el('h2', { text: 'Aucun questionnaire ouvert' }),
        el('p', { style: 'margin-top:.5rem', text: 'Crée un questionnaire vierge, ou pars d’un modèle publié pour aller plus vite.' }),
        el('div', { class: 'row', style: { justifyContent: 'center', marginTop: 'var(--s-5)' } }, [
          el('button', { class: 'btn btn--primary', type: 'button', 'data-act': 'new-quiz', text: '+ Nouveau questionnaire' }),
          state.published[0] && el('button', {
            class: 'btn btn--ghost', type: 'button',
            'data-act': 'fork-published', 'data-id': state.published[0].id,
            text: `Partir de « ${state.published[0].title} »`,
          }),
        ]),
      ]),
    ]));
    return;
  }

  const panel = PANELS.find((p) => p.id === state.panel) || PANELS[0];
  const ctx = { reach: state.reach };
  if (panel.id === 'publier') ctx.linkSize = (await encode(state.quiz)).length + 40;

  dom.panel.replaceChildren(panel.render(state.quiz, ctx));
  applyAccent(state.quiz.accent);

  if (panel.id === 'resultats') scheduleReach();
}

/* La joignabilité est coûteuse : on la calcule à froid, après le rendu,
   et on ne redessine que si le verdict a changé.                        */
const scheduleReach = debounce(() => {
  if (!state.quiz || state.panel !== 'resultats') return;
  const next = reachability(state.quiz);
  const before = JSON.stringify(state.reach?.hit || {});
  state.reach = next;
  if (JSON.stringify(next.hit || {}) !== before) renderPanel();
}, 500);

/* --- Sauvegarde --------------------------------------------------------------- */

let saveTimer = 0;

function touch() {
  if (!state.quiz) return;
  dom.saveStatus.textContent = 'Enregistrement…';
  dom.saveStatus.classList.add('is-saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

function flush() {
  clearTimeout(saveTimer);
  if (!state.quiz) return;
  const saved = store.saveDraft(state.quiz);
  dom.saveStatus.classList.remove('is-saving');
  dom.saveStatus.textContent = saved
    ? `Enregistré · ${new Date(saved.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : 'Enregistrement impossible (stockage plein ?)';
}

/* --- Liaisons ------------------------------------------------------------------ */

function apply(path, value) {
  const quiz = state.quiz;
  if (!quiz) return;
  const [kind, ...rest] = path.split(':');

  const find = (list, id) => list.find((item) => item.id === id);

  switch (kind) {
    case 'q': {
      quiz[rest[0]] = value;
      break;
    }
    case 'axis': {
      const axis = find(quiz.axes, rest[0]);
      if (axis) axis[rest[1]] = value;
      break;
    }
    case 'question': {
      const question = find(quiz.questions, rest[0]);
      if (question) question[rest[1]] = value;
      break;
    }
    case 'option': {
      const question = find(quiz.questions, rest[0]);
      const option = question && find(question.options, rest[1]);
      if (option) option[rest[2]] = value;
      break;
    }
    case 'score': {
      const question = find(quiz.questions, rest[0]);
      const option = question && find(question.options, rest[1]);
      if (option) {
        const n = Math.round(Number(value));
        option.scores[rest[2]] = Number.isFinite(n) ? Math.max(-9, Math.min(9, n)) : 0;
      }
      break;
    }
    case 'result': {
      const result = find(quiz.results, rest[0]);
      if (result) result[rest[1]] = value;
      break;
    }
    case 'rule': {
      const result = find(quiz.results, rest[0]);
      if (!result) break;
      if (rest[1] === 'min' || rest[1] === 'max') {
        const n = Number(value);
        result.rule[rest[1]] = Number.isFinite(n) ? n : 0;
      } else {
        result.rule[rest[1]] = value;
        if (rest[1] === 'mode') {
          result.rule.axis = (value === 'total' || value === 'fallback') ? null : (result.rule.axis || quiz.axes[0]?.id || null);
        }
      }
      break;
    }
    case 'reco': {
      const result = find(quiz.results, rest[0]);
      const reco = result && find(result.recos, rest[1]);
      if (reco) reco[rest[2]] = value;
      break;
    }
    default: break;
  }
}

function onInput(event) {
  const target = event.target.closest('[data-bind]');
  if (!target) return;

  apply(target.dataset.bind, target.value);
  touch();
  live(target);
  refreshDiag();
}

function onChange(event) {
  const target = event.target.closest('[data-bind]');
  if (target && RESHAPE.test(target.dataset.bind)) {
    apply(target.dataset.bind, target.value);
    flush();
    renderRail();
    renderPanel();
    return;
  }
  const file = event.target.closest('[data-act="import-file"]');
  if (file && file.files?.[0]) importFile(file.files[0]);
}

/* Les retouches qui ne méritent pas un redessin complet : elles gardent
   le curseur là où il est, ce qui est tout l'enjeu d'un champ texte.  */
function live(target) {
  const bind = target.dataset.bind;

  if (bind === 'q:title') {
    dom.quizName.textContent = target.value;
    const railItem = dom.rail.querySelector(`[data-act="select"][data-id="${CSS.escape(state.quiz.id)}"] .rail__item__label`);
    if (railItem) railItem.textContent = target.value;
  }
  if (bind === 'q:accent') applyAccent(target.value);

  if (bind?.startsWith('question:') || bind?.startsWith('result:')) {
    const label = target.closest('.editor-card')?.querySelector('.editor-card__label');
    if (label && /:(text|title)$/.test(bind) && !bind.includes(':subtitle')) {
      const isResult = bind.startsWith('result:');
      if (isResult === bind.endsWith(':title')) {
        label.textContent = target.value || (isResult ? 'Profil sans titre' : 'Question sans texte');
      }
    }
  }
  if (bind?.startsWith('score:')) {
    target.closest('.scorechip')?.classList.toggle('is-set', Number(target.value) !== 0);
  }
}

const refreshDiag = debounce(() => { renderRail(); scheduleReach(); }, 600);

/* --- Actions --------------------------------------------------------------------- */

function onClick(event) {
  const trigger = event.target.closest('[data-act]');
  if (!trigger || trigger.tagName === 'INPUT') return;
  const { act, id } = trigger.dataset;
  const [ownerId, childId] = (id || '').split('|');
  const quiz = state.quiz;

  const structural = () => { flush(); renderRail(); renderPanel(); };
  const byId = (list, key) => list.find((item) => item.id === key);
  const move = (list, key, delta) => {
    const from = list.findIndex((item) => item.id === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
  };

  switch (act) {
    case 'new-quiz': {
      const created = makeQuiz();
      store.saveDraft(created);
      select(created.id);
      state.panel = 'identite';
      return structural();
    }
    case 'select': return (select(id), structural());
    case 'panel': {
      state.panel = PANELS.some((p) => p.id === id) ? id : 'identite';
      return (renderRail(), renderPanel());
    }
    case 'edit-published':
    case 'fork-published': {
      const source = state.published.find((q) => q.id === id);
      if (!source) return undefined;
      const copyQuiz = structuredClone({ ...source, source: undefined });
      if (act === 'fork-published') {
        copyQuiz.id = uid('quiz');
        copyQuiz.title = `${source.title} (copie)`;
      }
      store.saveDraft(copyQuiz);
      select(copyQuiz.id);
      toast(act === 'edit-published'
        ? 'Copie locale ouverte. Le kiosque montre encore la version du dépôt.'
        : 'Copie créée.');
      return structural();
    }
    case 'delete-quiz': {
      if (!quiz || !confirm(`Supprimer « ${quiz.title} » de ce navigateur ?`)) return undefined;
      store.deleteDraft(quiz.id);
      state.quiz = null;
      const next = store.allDrafts()[0];
      if (next) select(next.id);
      toast('Questionnaire supprimé.');
      return structural();
    }

    case 'accent': {
      quiz.accent = id;
      return structural();
    }

    case 'axis-add': {
      const axis = makeAxis(quiz.axes.length);
      quiz.axes.push(axis);
      for (const q of quiz.questions) for (const o of q.options) o.scores[axis.id] = 0;
      return structural();
    }
    case 'axis-del': {
      if (!confirm('Supprimer cet axe ? Les points qu’il recevait sont perdus.')) return undefined;
      quiz.axes = quiz.axes.filter((a) => a.id !== id);
      for (const q of quiz.questions) for (const o of q.options) delete o.scores[id];
      for (const r of quiz.results) {
        if (r.rule.axis === id) { r.rule.mode = 'fallback'; r.rule.axis = null; }
      }
      return structural();
    }
    case 'axis-up':   return (move(quiz.axes, id, -1), structural());
    case 'axis-down': return (move(quiz.axes, id, 1), structural());

    case 'q-add': {
      quiz.questions.push(makeQuestion(quiz.axes));
      return structural();
    }
    case 'q-del': {
      if (!confirm('Supprimer cette question ?')) return undefined;
      quiz.questions = quiz.questions.filter((q) => q.id !== id);
      return structural();
    }
    case 'q-dup': {
      const source = byId(quiz.questions, id);
      if (!source) return undefined;
      const clone = structuredClone(source);
      clone.id = uid('q');
      clone.options.forEach((o) => { o.id = uid('opt'); });
      quiz.questions.splice(quiz.questions.indexOf(source) + 1, 0, clone);
      return structural();
    }
    case 'q-up':   return (move(quiz.questions, id, -1), structural());
    case 'q-down': return (move(quiz.questions, id, 1), structural());

    case 'opt-add': {
      byId(quiz.questions, id)?.options.push(makeOption(quiz.axes));
      return structural();
    }
    case 'opt-del': {
      const question = byId(quiz.questions, ownerId);
      if (!question) return undefined;
      if (question.options.length <= 2) return toast('Il faut au moins deux réponses.', 'danger');
      question.options = question.options.filter((o) => o.id !== childId);
      return structural();
    }

    case 'res-add': {
      quiz.results.push(makeResult(quiz.axes));
      return structural();
    }
    case 'res-del': {
      if (!confirm('Supprimer ce profil et ses recommandations ?')) return undefined;
      quiz.results = quiz.results.filter((r) => r.id !== id);
      return structural();
    }
    case 'res-dup': {
      const source = byId(quiz.results, id);
      if (!source) return undefined;
      const clone = structuredClone(source);
      clone.id = uid('res');
      clone.title = `${source.title} (copie)`;
      clone.recos.forEach((c) => { c.id = uid('reco'); });
      quiz.results.splice(quiz.results.indexOf(source) + 1, 0, clone);
      return structural();
    }
    case 'res-up':   return (move(quiz.results, id, -1), structural());
    case 'res-down': return (move(quiz.results, id, 1), structural());

    case 'reco-add': {
      byId(quiz.results, id)?.recos.push(makeReco());
      return structural();
    }
    case 'reco-del': {
      const result = byId(quiz.results, ownerId);
      if (result) result.recos = result.recos.filter((c) => c.id !== childId);
      return structural();
    }

    case 'lock': {
      flush();
      store.lock();
      location.reload();
      return undefined;
    }
    case 'test':      return testRun();
    case 'copy-link': return copyLink();
    case 'export':    return exportJson();
    case 'copy-json': return copyJson();
    case 'import-paste': return importPaste();
    default: return undefined;
  }
}

function select(id) {
  flush();
  const draft = store.getDraft(id);
  if (!draft) return;
  try {
    state.quiz = normalize(draft);
  } catch {
    return toast('Ce brouillon est illisible.', 'danger');
  }
  state.reach = null;
  renderTopbar();
  dom.saveStatus.textContent = draft.updatedAt ? `Enregistré · ${formatDate(draft.updatedAt)}` : '';
}

/* --- Diffusion --------------------------------------------------------------------- */

async function testRun() {
  flush();
  const url = await linkFor(state.quiz, 'quiz.html');
  window.open(`${url.split('#')[0]}?test=1#${url.split('#')[1]}`, '_blank', 'noopener');
}

async function copyLink() {
  flush();
  const url = await linkFor(state.quiz);
  toast(await copy(url) ? 'Lien copié — il contient tout le questionnaire.' : 'Copie impossible.', '');
}

function payload() {
  const { source, ...clean } = state.quiz;
  return JSON.stringify(clean, null, 2);
}

function exportJson() {
  flush();
  download(`${slugify(state.quiz.title, state.quiz.id)}.json`, payload());
}

async function copyJson() {
  flush();
  toast(await copy(payload()) ? 'JSON copié.' : 'Copie impossible.');
}

function adopt(raw, label) {
  let quiz;
  try {
    quiz = normalize(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (err) {
    return toast(`Import refusé : ${err.message}`, 'danger');
  }
  if (store.getDraft(quiz.id)) {
    quiz.id = uid('quiz');
    quiz.title = `${quiz.title} (importé)`;
  }
  store.saveDraft(quiz);
  select(quiz.id);
  state.panel = 'identite';
  flush();
  renderRail();
  renderPanel();
  toast(`« ${quiz.title} » importé${label ? ` depuis ${label}` : ''}.`);
}

async function importFile(file) {
  try {
    adopt(await file.text(), file.name);
  } catch (err) {
    toast(`Fichier illisible : ${err.message}`, 'danger');
  }
}

function importPaste() {
  const dialog = el('dialog', { class: 'modal' }, [
    el('form', { method: 'dialog' }, [
      el('div', { class: 'modal__body stack' }, [
        el('h2', { text: 'Coller un questionnaire' }),
        el('p', { class: 'panel__hint', text: 'Colle le JSON complet d’un questionnaire RecoHero.' }),
        el('textarea', { class: 'textarea input--mono', rows: '10', placeholder: '{ "title": … }', id: 'pasteArea' }),
      ]),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--ghost', value: 'cancel', text: 'Annuler' }),
        el('button', { class: 'btn btn--primary', value: 'ok', text: 'Importer' }),
      ]),
    ]),
  ]);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    const text = dialog.querySelector('#pasteArea').value.trim();
    if (dialog.returnValue === 'ok' && text) adopt(text, 'le presse-papier');
    dialog.remove();
  });
  dialog.showModal();
}
