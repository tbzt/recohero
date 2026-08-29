/* ==========================================================================
   admin/app.js — le backoffice : état, câblage, sauvegarde.
   Un seul état en mémoire, un seul point de rendu par zone (rail, panneau,
   diagnostic). Toute interaction passe par la délégation sur data-act ou
   par un data-bind : aucun gestionnaire en ligne dans le HTML.
   ========================================================================== */

import { PANELS } from './panels.js';
import {
  makeQuiz, makeAxis, makeQuestion, makeOption, makeResult, makeReco,
  normalize, diagnose, uid, slugify, safeImage, imageWeight,
} from '../core/schema.js';
import { reachability } from '../core/scoring.js';
import { bindSortables } from '../core/sortable.js';
import { questionView } from '../core/views.js';
import { loadPublished, loadEspace, forgetEspace } from '../core/catalog.js';
import * as remote from '../core/remote.js';
import * as store from '../core/store.js';
import { linkFor, encode } from '../core/share.js';
import {
  el, toast, copy, download, applyAccent, debounce, formatDate,
  imageFromFile, formatBytes, IMAGE_LIMITS,
} from '../core/ui.js';

/* --- La porte -------------------------------------------------------------
   SHA-256 de la phrase d'accès. Elle n'est PAS un mécanisme de sécurité :
   sans serveur, il n'y a aucune donnée partagée à protéger, et le code de
   cette page est public. Elle évite d'ouvrir le backoffice par mégarde,
   rien de plus — la porte note ensuite un horodatage dans le localStorage,
   que n'importe qui peut écrire sans connaître la phrase.
   La phrase elle-même n'est pas dans ce dépôt : seule son empreinte l'est.
   Pour la changer, remplacer la constante par le SHA-256 de la nouvelle
   (README, § Backoffice). Mettre la chaîne vide supprime la porte.     */
const PASS_SHA256 = '7afa3390516c3b831bde7acb98a061db9c626524677f643a9f55083c1bc427bc';
const UNLOCK_TTL = 12 * 60 * 60 * 1000;

/* Ces liaisons changent la forme du panneau : il faut le redessiner. */
const RESHAPE = /^(rule:[^:]+:mode|question:[^:]+:type|axis:[^:]+:(glyph|color)|q:accent|.+:image)$/;

const state = {
  quiz: null,
  published: [],
  espace: null,         /* le nom de l'espace partagé, s'il y en a un */
  guardActive: null,    /* la règle anti-écrasement répond-elle ? null = pas su */
  membres: [],          /* l'équipe de l'espace, lisible des seuls membres */
  profils: {},          /* leurs profils, lisibles de l'équipe seule */
  vitrines: {},         /* ce que chacun a choisi de rendre public */
  remote: [],           /* les questionnaires de cet espace */
  remoteSession: null,  /* { email, uid } une fois connecté */
  panel: 'identite',
  reach: null,
  expanded: new Set(),  /* réponses dont le champ image est déplié */
  folded: new Set(),    /* cartes repliées : questions et profils */
  focused: null,        /* question sous le curseur, pour l'aperçu */
  previewOpen: true,
};

const dom = {};

boot();

async function boot() {
  for (const id of ['gate', 'gateForm', 'gatePass', 'shell', 'rail', 'panel',
                    'quizName', 'saveStatus', 'topActions', 'tabbar']) {
    dom[id] = document.getElementById(id);
  }
  state.espace = new URLSearchParams(location.search).get('espace');

  /* Deux portes, et une seule s'ouvre selon l'adresse.

     Sans espace, le backoffice n'édite que des brouillons locaux : la
     phrase d'accès suffit, et elle n'a jamais prétendu à mieux.

     Avec un espace, il y a un vrai compte derrière, avec de vrais droits
     d'écriture. Demander d'abord une phrase partagée puis un compte, ce
     serait deux barrières dont la première est décorative — et ce serait
     apprendre à une équipe qu'un secret d'équipe protège quelque chose.
     Le compte EST la porte.                                            */
  if (state.espace) return gateCompte();

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
  return undefined;
}

/* La porte d'un espace : le compte, et rien d'autre. */
function gateCompte() {
  if (remote.session()) return open();

  const email = el('input', {
    class: 'input', type: 'email', autocomplete: 'username',
    placeholder: 'adresse@exemple.fr', required: true,
  });
  const pass = el('input', {
    class: 'input', type: 'password', autocomplete: 'current-password', required: true,
  });
  const erreur = el('p', { class: 'alerte', hidden: true });
  const valider = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Se connecter' });

  const form = el('form', { class: 'card gate__card stack' }, [
    el('div', { class: 'gate__emoji', text: '⌂' }),
    el('h1', { text: `Espace « ${state.espace} »` }),
    el('p', { class: 'gate__note', style: { marginTop: 0 }, text:
      'Le backoffice de cette équipe. Répondre aux questionnaires ne demande aucun compte — ceci ne sert qu’à publier.' }),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Adresse e-mail' }), email]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Mot de passe' }), pass]),
    erreur,
    valider,
    el('p', { class: 'gate__note' }, [
      'Pas de compte ? Il s’en crée un depuis la console Firebase du projet — ',
      'voir la marche à suivre dans le README, § « Monter son propre espace ».',
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    valider.disabled = true;
    erreur.hidden = true;
    try {
      state.remoteSession = await remote.signIn(email.value.trim(), pass.value);
      dom.gate.hidden = true;
      await open();
      toast(`Connecté — ${state.remoteSession.email}`);
    } catch (err) {
      erreur.textContent = err.message;
      erreur.hidden = false;
      valider.disabled = false;
      pass.value = '';
      pass.focus();
    }
  });

  dom.gate.replaceChildren(form);
  dom.gate.hidden = false;
  email.focus();
  return undefined;
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function open() {
  dom.gate.hidden = true;
  dom.shell.hidden = false;
  state.remoteSession = remote.session();
  [state.published, state.remote] = await Promise.all([
    loadPublished(), loadEspace(state.espace),
  ]);
  const drafts = store.allDrafts();
  if (drafts.length) select(drafts[0].id);

  renderRail();
  renderPanel();
  renderTopbar();

  dom.shell.addEventListener('click', onClick);
  dom.shell.addEventListener('input', onInput);
  dom.shell.addEventListener('change', onChange);
  dom.topActions.addEventListener('click', onClick);
  dom.tabbar.addEventListener('click', onClick);
  dom.quizName.addEventListener('click', onClick);
  window.addEventListener('beforeunload', flush);
  dom.shell.addEventListener('focusin', (event) => {
    const bind = event.target.closest('[data-bind]')?.dataset.bind || '';
    /* Que le curseur soit dans l'énoncé, dans une réponse ou dans une
       pesée, l'identifiant retenu est celui de la question qui les porte :
       c'est elle qu'on veut à l'aperçu. */
    const id = /^(?:question|option|score):([^:]+)/.exec(bind)?.[1];
    if (!id || id === state.focused) return;
    state.focused = id;
    paintPreview();
  });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      /* Rien ne serait perdu sans ça — l'enregistrement est automatique.
         Mais le réflexe est trop ancré pour qu'on laisse le navigateur
         proposer d'enregistrer la page à la place. */
      event.preventDefault();
      flush();
      toast('Enregistré.');
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return;
    /* Dans un champ de saisie, Ctrl+Z appartient au champ : le navigateur
       y défait la frappe, ce qu'aucune pile de notre côté ne ferait mieux. */
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
    undo();
  });
}

/* --- Rendu ------------------------------------------------------------------ */

function renderTopbar() {
  const label = state.quiz ? state.quiz.title : 'Aucun questionnaire ouvert';
  dom.quizName.replaceChildren(
    el('span', { class: 'topbar__doc__emoji', text: state.quiz?.emoji || '✦', 'aria-hidden': 'true' }),
    el('span', { class: 'topbar__doc__name', text: label }),
    el('span', { class: 'topbar__doc__caret', text: '▾', 'aria-hidden': 'true' }),
  );
  dom.quizName.title = `${label} — changer de questionnaire`;
  /* Le verrou reste actif même sans questionnaire ouvert. */
  for (const button of dom.topActions.querySelectorAll('[data-act="test"], [data-act="panel"]')) {
    button.disabled = !state.quiz;
  }
}

/* Le diagnostic sait déjà de quelle section vient chaque problème (`where`).
   L'afficher section par section évite d'avoir à lire la liste entière pour
   savoir où aller — et c'est la seule information dont une pastille de
   navigation a besoin. */
function issuesBySection(issues) {
  const map = {};
  for (const issue of issues) {
    const slot = map[issue.where] || (map[issue.where] = { error: 0, warn: 0 });
    slot[issue.level === 'error' ? 'error' : 'warn'] += 1;
  }
  return map;
}

function sectionBadge(counts) {
  if (!counts) return null;
  const total = counts.error + counts.warn;
  if (!total) return null;
  return el('span', {
    class: 'rail__item__badge badge--' + (counts.error ? 'error' : 'warn'),
    title: counts.error ? `${counts.error} à corriger` : `${counts.warn} à vérifier`,
    text: String(total),
  });
}

function renderRail() {
  const drafts = store.allDrafts();
  const draftIds = new Set(drafts.map((q) => q.id));
  const issues = state.quiz ? diagnose(state.quiz) : [];
  const bySection = issuesBySection(issues);

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
      el('div', { class: 'rail__head' }, [el('h2', { text: 'Au kiosque' })]),
      el('div', { class: 'rail__list' }, state.published.map((quiz) => el('div', { class: 'rail__item' }, [
        el('span', { class: 'rail__item__emoji', text: quiz.emoji || '✦' }),
        el('span', { class: 'rail__item__label', text: quiz.title }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          'data-act': 'export-one', 'data-id': quiz.id,
          title: 'Exporter en JSON', text: '↓',
        }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          'data-act': draftIds.has(quiz.id) ? 'select' : 'edit-published', 'data-id': quiz.id,
          title: draftIds.has(quiz.id) ? 'Copie locale déjà ouverte' : 'Reprendre une copie',
          text: draftIds.has(quiz.id) ? '●' : '✎',
        }),
      ]))),
    ]),

    state.remote.length > 0 && el('div', {}, [
      el('div', { class: 'rail__head' }, [el('h2', { text: `Espace « ${state.espace} »` })]),
      el('div', { class: 'rail__list' }, state.remote.map((quiz) => el('div', { class: 'rail__item' }, [
        el('span', { class: 'rail__item__emoji', text: quiz.emoji || '✦' }),
        el('span', { class: 'rail__item__label', text: quiz.title }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          'data-act': 'export-one', 'data-id': quiz.id,
          title: 'Exporter en JSON', text: '↓',
        }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          'data-act': draftIds.has(quiz.id) ? 'select' : 'edit-remote', 'data-id': quiz.id,
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
        sectionBadge(bySection[panel.id]),
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
  renderTabbar(bySection);
}

/* La barre d'onglets ne sert qu'en dessous de 62rem, où le rail passe SOUS
   le panneau : sans elle, changer de section demanderait de faire défiler
   toute la surface d'édition pour remonter. Elle est rendue partout et
   masquée en CSS — une barre construite à la volée au franchissement du
   seuil arriverait toujours trop tard. */
function renderTabbar(bySection) {
  if (!dom.tabbar) return;
  if (!state.quiz) {
    dom.tabbar.replaceChildren();
    return;
  }
  dom.tabbar.replaceChildren(...PANELS.map((panel) => el('button', {
    class: 'tab' + (state.panel === panel.id ? ' is-active' : ''),
    type: 'button', 'data-act': 'panel', 'data-id': panel.id,
    'aria-current': state.panel === panel.id ? 'page' : null,
    /* Le nom n'est affiché que sur l'onglet actif ; les autres ne
       seraient qu'un glyphe pour une synthèse vocale sans ceci. */
    'aria-label': panel.label,
    title: panel.label,
  }, [
    el('span', { class: 'tab__emoji', text: panel.emoji, 'aria-hidden': 'true' }),
    el('span', { class: 'tab__label', text: panel.label }),
    sectionBadge(bySection[panel.id]),
  ])));
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
  const ctx = {
    reach: state.reach, expanded: state.expanded,
    previewOpen: state.previewOpen, folded: state.folded,
  };
  if (panel.id === 'publier') {
    ctx.linkSize = (await encode(state.quiz)).length + 40;
    ctx.espace = state.espace;
    ctx.remoteCount = state.remote.length;
    ctx.remoteSession = state.remoteSession;
    ctx.guardActive = state.guardActive;
    ctx.membres = state.membres;
    ctx.profils = state.profils;
    ctx.vitrines = state.vitrines;
    ctx.inEspace = state.remote.some((q) => q.id === state.quiz.id);
  }

  dom.panel.replaceChildren(panel.render(state.quiz, ctx));
  applyAccent(state.quiz.accent);
  bindSortables(dom.panel, dropped);
  if (panel.id === 'questions') paintPreview();

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

/* --- Annulation -----------------------------------------------------------
   On n'interrompt pas l'auteur pour lui demander s'il est sûr : on fait ce
   qu'il a demandé, et on lui laisse un chemin de retour. Un `confirm()`
   coûte une interruption à chaque geste et ne protège que d'un clic
   distrait — pas du regret, qui vient trois secondes plus tard.

   Seuls les gestes de STRUCTURE sont empilés (ajout, suppression,
   déplacement, duplication). La frappe au clavier ne l'est pas : ce serait
   des centaines d'états pour un service que Ctrl+Z rend déjà dans le champ
   lui-même.                                                              */

const UNDO_DEPTH = 40;
const undoStack = [];

function remember(label) {
  if (!state.quiz) return;
  const snapshot = structuredClone(state.quiz);
  const panel = state.panel;
  pushUndo(label, () => {
    state.quiz = snapshot;
    state.panel = panel;
    flush();
    renderTopbar();
    renderRail();
    renderPanel();
  });
}

function pushUndo(label, apply) {
  undoStack.push({ label, apply });
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
}

function undo() {
  const step = undoStack.pop();
  if (!step) return toast('Rien à annuler.');
  step.apply();
  return toast(`Annulé : ${step.label.toLowerCase()}.`);
}

/* Le geste destructeur : on l'exécute, et on propose le retour. */
function undoable(label, mutate) {
  remember(label);
  mutate();
  flush();
  renderRail();
  renderPanel();
  toast(label, { action: { label: 'Annuler', onClick: undo } });
}

/* --- Aperçu ---------------------------------------------------------------
   Il montre la question sous le curseur, avec le rendu exact du parcours
   (views.js). Il se repeint tout seul à la frappe et ne redessine jamais
   le panneau : un redessin déplacerait le curseur du champ en cours.   */

function paintPreview() {
  const stage = document.getElementById('previewStage');
  const hint = document.getElementById('previewHint');
  if (!stage || !state.quiz) return;

  const index = state.quiz.questions.findIndex((q) => q.id === state.focused);
  if (index < 0) {
    stage.replaceChildren(el('p', { class: 'preview__empty', text: 'Placez le curseur dans une question pour la voir telle que le répondant la verra.' }));
    if (hint) hint.textContent = '';
    return;
  }

  const question = state.quiz.questions[index];
  if (hint) hint.textContent = `question ${index + 1} sur ${state.quiz.questions.length}`;
  stage.replaceChildren(questionView(state.quiz, question, index, { interactive: false }));
}

const repaintPreview = debounce(paintPreview, 140);

/* Le glisser-déposer aboutit ici. Chaque liste déclare ce qu'elle ordonne
   dans `data-sortable` ; on retrouve le tableau, on déplace, on annule
   comme n'importe quel autre geste de structure.                        */
function dropped(key, from, to) {
  const quiz = state.quiz;
  if (!quiz) return;
  const [kind, ownerId] = key.split(':');

  const target =
    kind === 'axes'      ? quiz.axes :
    kind === 'questions' ? quiz.questions :
    kind === 'results'   ? quiz.results :
    kind === 'options'   ? quiz.questions.find((q) => q.id === ownerId)?.options :
    kind === 'recos'     ? quiz.results.find((r) => r.id === ownerId)?.recos :
    null;
  if (!target || from === to) return;

  const labels = {
    axes: 'Axe déplacé', questions: 'Question déplacée', results: 'Profil déplacé',
    options: 'Réponse déplacée', recos: 'Recommandation déplacée',
  };
  remember(labels[kind] || 'Déplacement');
  target.splice(to, 0, target.splice(from, 1)[0]);
  flush();
  renderRail();
  renderPanel();
}

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
  if (state.panel === 'questions') repaintPreview();
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
  const imported = event.target.closest('[data-act="import-file"]');
  if (imported && imported.files?.[0]) return importFile(imported.files[0]);

  const picture = event.target.closest('[data-act="image-file"]');
  if (picture && picture.files?.[0]) {
    attachImage(picture.dataset.id, picture.dataset.kind, picture.files[0]);
    picture.value = '';  /* rechoisir le même fichier doit re-déclencher */
  }
  return undefined;
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
  /* Les champs sont pilotés par data-bind, pas par data-act — sauf la case
     à cocher des crédits, dont le clic EST l'action. */
  if (!trigger) return;
  if (trigger.tagName === 'INPUT' && trigger.dataset.act !== 'crediter') return;
  const { act, id } = trigger.dataset;
  const [ownerId, childId] = (id || '').split('|');
  const quiz = state.quiz;

  const structural = () => { flush(); renderRail(); renderPanel(); };
  /* Un déplacement est annulable mais ne mérite pas de bandeau : son
     effet est déjà sous les yeux de celui qui vient de le provoquer. */
  const reorder = (label, mutate) => { remember(label); mutate(); structural(); };
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
    /* Reprendre une copie. Une seule mécanique, deux étagères : le
       kiosque et l'espace. Garder l'identifiant, c'est pouvoir réécraser
       l'original ; en changer, c'est fabriquer une variante.          */
    case 'edit-published':
    case 'fork-published':
    case 'edit-remote': {
      const shelf = act === 'edit-remote' ? state.remote : state.published;
      const source = shelf.find((q) => q.id === id);
      if (!source) return undefined;
      const copyQuiz = structuredClone({ ...source, source: undefined, file: undefined });
      if (act === 'fork-published') {
        copyQuiz.id = uid('quiz');
        copyQuiz.title = `${source.title} (copie)`;
      }
      store.saveDraft(copyQuiz);
      select(copyQuiz.id);
      toast({
        'edit-published': 'Copie locale ouverte. Le kiosque montre encore l’original.',
        'fork-published': 'Copie créée.',
        'edit-remote': 'Copie locale ouverte. L’espace montre encore la version publiée.',
      }[act]);
      return structural();
    }
    case 'delete-quiz': {
      if (!quiz) return undefined;
      const removed = structuredClone(quiz);
      const panel = state.panel;
      pushUndo('Questionnaire supprimé', () => {
        store.saveDraft(removed);
        select(removed.id);
        state.panel = panel;
        renderRail();
        renderPanel();
      });
      store.deleteDraft(quiz.id);
      state.quiz = null;
      const next = store.allDrafts()[0];
      if (next) select(next.id);
      renderRail();
      renderPanel();
      renderTopbar();
      toast(`« ${removed.title} » supprimé`, { action: { label: 'Annuler', onClick: undo } });
      return undefined;
    }

    case 'accent': {
      quiz.accent = id;
      return structural();
    }

    case 'axis-add': return undoable('Axe ajouté', () => {
      const axis = makeAxis(quiz.axes.length);
      quiz.axes.push(axis);
      for (const q of quiz.questions) for (const o of q.options) o.scores[axis.id] = 0;
    });
    case 'axis-del': return undoable('Axe supprimé', () => {
      quiz.axes = quiz.axes.filter((a) => a.id !== id);
      for (const q of quiz.questions) for (const o of q.options) delete o.scores[id];
      for (const r of quiz.results) {
        if (r.rule.axis === id) { r.rule.mode = 'fallback'; r.rule.axis = null; }
      }
    });
    case 'axis-up':   return reorder('Axe déplacé', () => move(quiz.axes, id, -1));
    case 'axis-down': return reorder('Axe déplacé', () => move(quiz.axes, id, 1));

    case 'q-add': return undoable('Question ajoutée', () => {
      quiz.questions.push(makeQuestion(quiz.axes));
    });
    case 'q-del': return undoable('Question supprimée', () => {
      quiz.questions = quiz.questions.filter((q) => q.id !== id);
    });
    case 'q-dup': return undoable('Question dupliquée', () => {
      const source = byId(quiz.questions, id);
      if (!source) return;
      const clone = structuredClone(source);
      clone.id = uid('q');
      clone.options.forEach((o) => { o.id = uid('opt'); });
      quiz.questions.splice(quiz.questions.indexOf(source) + 1, 0, clone);
    });
    case 'q-up':   return reorder('Question déplacée', () => move(quiz.questions, id, -1));
    case 'q-down': return reorder('Question déplacée', () => move(quiz.questions, id, 1));

    case 'opt-add': return undoable('Réponse ajoutée', () => {
      byId(quiz.questions, id)?.options.push(makeOption(quiz.axes));
    });
    case 'opt-del': {
      const question = byId(quiz.questions, ownerId);
      if (!question) return undefined;
      if (question.options.length <= 2) return toast('Il faut au moins deux réponses.', 'danger');
      return undoable('Réponse supprimée', () => {
        question.options = question.options.filter((o) => o.id !== childId);
      });
    }

    case 'res-add': return undoable('Profil ajouté', () => {
      quiz.results.push(makeResult(quiz.axes));
    });
    case 'res-del': return undoable('Profil supprimé', () => {
      quiz.results = quiz.results.filter((r) => r.id !== id);
    });
    case 'res-dup': return undoable('Profil dupliqué', () => {
      const source = byId(quiz.results, id);
      if (!source) return;
      const clone = structuredClone(source);
      clone.id = uid('res');
      clone.title = `${source.title} (copie)`;
      clone.recos.forEach((c) => { c.id = uid('reco'); });
      quiz.results.splice(quiz.results.indexOf(source) + 1, 0, clone);
    });
    case 'res-up':   return reorder('Profil déplacé', () => move(quiz.results, id, -1));
    case 'res-down': return reorder('Profil déplacé', () => move(quiz.results, id, 1));

    case 'reco-add': return undoable('Recommandation ajoutée', () => {
      byId(quiz.results, id)?.recos.push(makeReco());
    });
    case 'reco-del': return undoable('Recommandation retirée', () => {
      const result = byId(quiz.results, ownerId);
      if (result) result.recos = result.recos.filter((c) => c.id !== childId);
    });

    case 'card-fold': {
      state.folded.has(id) ? state.folded.delete(id) : state.folded.add(id);
      return renderPanel();
    }
    case 'fold-all': {
      const items = id === 'questions' ? quiz.questions : quiz.results;
      const allFolded = items.every((item) => state.folded.has(item.id));
      for (const item of items) {
        allFolded ? state.folded.delete(item.id) : state.folded.add(item.id);
      }
      return renderPanel();
    }
    case 'quiz-menu': return openQuizSheet();
    case 'crediter': {
      const liste = new Set(quiz.auteurs || []);
      liste.has(id) ? liste.delete(id) : liste.add(id);
      remember('Crédits modifiés');
      quiz.auteurs = [...liste];
      return structural();
    }
    case 'mon-profil':       return monProfil();
    case 'inviter':          return inviter();
    case 'membre-retirer':   return retirerMembre(id);
    case 'copier-uid':       return copierUid();
    case 'mon-mot-de-passe': return changerMonMotDePasse();
    case 'export-espace': return exportEspace();
    case 'export-drafts': return exportDrafts();
    case 'export-one':    return exportOne(id);
    case 'preview-toggle': {
      state.previewOpen = !state.previewOpen;
      return renderPanel();
    }
    case 'opt-image': {
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      return renderPanel();
    }
    case 'image-clear': {
      apply(id, '');
      state.expanded.delete(id.split(':').at(-2));
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
    case 'embed':     return showEmbed();
    case 'remote-signin':    return showSignIn();
    case 'remote-signout':   return signOutRemote();
    case 'remote-publish':   return publishRemote();
    case 'remote-unpublish': return unpublishRemote();
    case 'export':    return exportJson();
    case 'copy-json': return copyJson();
    case 'import-paste': return importPaste();
    default: return undefined;
  }
}

/* Un fichier du disque devient une image intégrée au questionnaire :
   réduite, ré-encodée, puis revalidée par safeImage() — on ne fait pas
   davantage confiance à ce que produit le canvas qu'au reste.          */
async function attachImage(bind, kind, file) {
  try {
    const { dataUri, width, height } = await imageFromFile(
      file, IMAGE_LIMITS[kind] || IMAGE_LIMITS.cover,
    );
    const clean = safeImage(dataUri);
    if (!clean) throw new Error('encodage non pris en charge par ce navigateur');

    apply(bind, clean);
    flush();
    renderRail();
    renderPanel();
    toast(`Image intégrée · ${width}×${height} · ${formatBytes(imageWeight(clean))}`);
  } catch (err) {
    toast(`Image refusée : ${err.message}`, 'danger');
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

/* Le sélecteur de questionnaire du bandeau. Sur grand écran le rail rend
   déjà ce service ; sur mobile il est passé sous le panneau, et sans cette
   feuille il faudrait faire défiler tout l'écran d'édition pour changer de
   questionnaire.                                                        */
/* Fermer une boîte de dialogue.

   L'évènement `close` d'un <dialog> est le chemin naturel pour faire le
   ménage, mais y accrocher le COMPORTEMENT est fragile : il n'a pas été
   observé dans tous les environnements où ce code tourne, et une action
   qui ne se produit jamais ne laisse aucune trace pour le dire. On agit
   donc explicitement, et l'écouteur `close` ne garde que le ramassage des
   fermetures qu'on ne provoque pas nous-mêmes — Échap, clic sur le fond. */
function dismiss(dialog, then) {
  dialog.close();
  dialog.remove();
  if (then) then();
}

function openQuizSheet() {
  const drafts = store.allDrafts();

  const ligne = (quiz, act, badge) => el('button', {
    class: 'sheet__row' + (state.quiz?.id === quiz.id ? ' is-active' : ''),
    type: 'button', 'data-act': act, 'data-id': quiz.id,
  }, [
    el('span', { class: 'sheet__emoji', text: quiz.emoji || '✦' }),
    el('span', { class: 'sheet__label', text: quiz.title }),
    badge && el('span', { class: 'pill', text: badge }),
  ]);

  const dialog = el('dialog', { class: 'modal sheet' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Questionnaires' }),
      drafts.length
        ? el('div', { class: 'sheet__list' }, drafts.map((q) => ligne(q, 'select')))
        : el('p', { class: 'panel__hint', text: 'Aucun brouillon dans ce navigateur.' }),
      state.published.length > 0 && el('div', {}, [
        el('span', { class: 'field__label', text: 'Au kiosque' }),
        el('div', { class: 'sheet__list' }, state.published.map((q) => ligne(q, 'edit-published', 'copier'))),
      ]),
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-sheet': 'close', text: 'Fermer' }),
      el('button', { class: 'btn btn--primary', type: 'button', 'data-act': 'new-quiz', text: '+ Nouveau' }),
    ]),
  ]);

  dialog.addEventListener('click', (event) => {
    if (!event.target.closest('[data-act], [data-sheet]')) return;
    const action = event.target.closest('[data-act]');
    dismiss(dialog, () => { if (action) onClick(event); });
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* Nommer quelqu'un de l'équipe. Le profil est lisible des seuls membres,
   ce qui suffit ici : dire « Camille » à un collègue n'expose personne au
   public. Faute de profil, l'identifiant tronqué — dit comme tel plutôt
   que déguisé en nom.                                                   */
function nommer(uid) {
  const p = state.profils?.[uid];
  if (!p) return `un compte sans profil (${uid.slice(0, 8)}…)`;
  return [p.prenom, p.nom].filter(Boolean).join(' ') || `un compte (${uid.slice(0, 8)}…)`;
}

/* --- L'équipe -------------------------------------------------------------- */

async function copierUid() {
  const ok = await copy(state.remoteSession?.uid || '');
  toast(ok ? 'Ton identifiant est copié.' : 'Copie impossible.', ok ? '' : 'danger');
}

/* Mon profil. Deux consentements distincts, et l'interface doit rendre la
   distinction évidente : renseigner son profil le montre à l'ÉQUIPE ;
   cocher la case le montre au MONDE. Le second n'est jamais présélectionné,
   et le décocher efface la vitrine plutôt que d'y poser un drapeau. */
function monProfil() {
  const uid = state.remoteSession?.uid;
  if (!uid) return;
  const actuel = state.profils?.[uid] || {};
  const enVitrine = Boolean(state.vitrines?.[uid]);

  const prenom = el('input', { class: 'input', value: actuel.prenom || '', placeholder: 'Camille' });
  const nom = el('input', { class: 'input', value: actuel.nom || '', placeholder: 'Ndiaye' });
  const poste = el('input', { class: 'input', value: actuel.poste || '', placeholder: 'Responsable du secteur adulte' });
  const photo = el('input', { class: 'input input--mono', value: actuel.image || '', placeholder: 'https://… (facultatif)' });
  const publier = el('input', { type: 'checkbox' });
  publier.checked = enVitrine;

  const erreur = el('p', { class: 'alerte', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Enregistrer' });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Mon profil' }),
      el('p', { class: 'panel__hint', text: 'Renseigné, ton profil te nomme auprès de ton équipe — dans les messages de conflit, par exemple. Il n’est visible que des membres de cet espace.' }),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Prénom' }), prenom]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Nom' }), nom]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Fonction' }), poste]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Photo' }), photo,
        el('span', { class: 'field__hint', text: 'Adresse d’une image. Facultative, et publique si tu coches ci-dessous.' }),
      ]),

      el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [
        el('label', { class: 'row', style: { alignItems: 'flex-start', gap: 'var(--s-3)' } }, [
          publier,
          el('span', {}, [
            el('strong', { text: 'Afficher mon nom publiquement' }),
            el('span', { class: 'field__hint', style: { display: 'block' }, text:
              'Décoché, rien de toi n’est lisible hors de l’équipe — la donnée n’est pas seulement masquée, elle n’est pas publiée. Coché, ton nom, ta fonction et ta photo deviennent visibles de tout visiteur, sur les questionnaires qui te créditent.' }),
          ]),
        ]),
      ]),

      el('p', { class: 'field__hint', text: 'Être crédité demande les deux : que tu coches ici, et que le questionnaire te nomme. L’un sans l’autre n’affiche rien.' }),
      erreur,
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', text: 'Annuler', onClick: () => dismiss(dialog) }),
      valider,
    ]),
  ]);

  valider.addEventListener('click', async () => {
    if (!prenom.value.trim()) {
      erreur.textContent = 'Le prénom est nécessaire — c’est lui qui te nomme auprès de l’équipe.';
      erreur.hidden = false;
      return;
    }
    valider.disabled = true;
    try {
      const profil = {
        prenom: prenom.value.trim(),
        nom: nom.value.trim(),
        poste: poste.value.trim(),
        image: photo.value.trim(),
      };
      await remote.enregistrerProfil(state.espace, uid, profil);
      /* La vitrine ne reprend que ce que la personne a saisi, et n'existe
         que si elle l'a demandé. Décocher efface. */
      await remote.publierVitrine(state.espace, uid, publier.checked ? {
        nom: [profil.prenom, profil.nom].filter(Boolean).join(' '),
        poste: profil.poste || undefined,
        image: profil.image || undefined,
      } : null);
      await refreshEspace();
      dismiss(dialog, () => {
        toast(publier.checked ? 'Profil enregistré et affiché publiquement.' : 'Profil enregistré, visible de l’équipe seule.');
        repaint();
      });
    } catch (err) {
      erreur.textContent = err.message;
      erreur.hidden = false;
      valider.disabled = false;
    }
  });

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  prenom.focus();
}

/* Inviter : créer le compte, faire envoyer le courriel, inscrire la
   personne. Le mot de passe initial est un secret aléatoire jeté sur
   place — nous ne sommes à aucun moment en possession de ce qui
   l'authentifie, et c'est elle qui choisira le sien.

   Si l'adresse a déjà un compte, rien côté client ne permet d'en
   retrouver l'identifiant : on le demande, plutôt que d'échouer. */
function inviter() {
  const email = el('input', { class: 'input', type: 'email', placeholder: 'collegue@mediatheque.fr' });
  const uidChamp = el('input', { class: 'input input--mono', placeholder: 'son identifiant, s’il a déjà un compte' });
  const info = el('p', { class: 'panel__hint', hidden: true });
  const erreur = el('p', { class: 'alerte', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Inviter' });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: `Inviter dans « ${state.espace} »` }),
      el('p', { class: 'panel__hint', text: 'La personne reçoit un courriel et choisit son mot de passe elle-même. Tu ne le verras jamais, et RecoHero non plus.' }),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Adresse e-mail' }), email]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Ou son identifiant, si elle a déjà un compte' }),
        uidChamp,
        el('span', { class: 'field__hint', text: 'Elle le trouve dans son backoffice, bouton « Copier mon identifiant ».' }),
      ]),
      info, erreur,
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', text: 'Fermer', onClick: () => dismiss(dialog) }),
      valider,
    ]),
  ]);

  valider.addEventListener('click', async () => {
    const adresse = email.value.trim();
    const uidDonne = uidChamp.value.trim();
    if (!adresse && !uidDonne) return;

    valider.disabled = true;
    erreur.hidden = true;
    info.hidden = true;

    try {
      let cible = uidDonne;
      if (!cible) {
        info.textContent = 'Création du compte…';
        info.hidden = false;
        cible = await remote.creerCompte(adresse);
        /* Ramener la personne dans le bon espace après qu'elle a choisi
           son mot de passe : le nom de l'espace ne peut pas entrer dans
           le texte du courriel, mais il peut entrer dans le lien. */
        const retour = new URL('admin.html', location.href);
        retour.searchParams.set('espace', state.espace);
        await remote.envoyerCourrielMotDePasse(adresse, retour.toString());
      }
      await remote.ajouterMembre(state.espace, cible);
      await refreshEspace();
      dismiss(dialog, () => {
        toast(uidDonne ? 'Membre ajouté.' : `Invitation envoyée à ${adresse}.`);
        repaint();
      });
    } catch (err) {
      if (err.code === 'EMAIL_EXISTS') {
        erreur.textContent = 'Cette adresse a déjà un compte. Demande-lui son identifiant et colle-le dans le second champ — rien ici ne permet de le retrouver.';
        uidChamp.focus();
      } else {
        erreur.textContent = err.message;
      }
      erreur.hidden = false;
      info.hidden = true;
      valider.disabled = false;
    }
  });

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  email.focus();
}

/* Retirer se défait : c'est une ligne dans une liste, pas une suppression
   de compte. Même règle que partout ailleurs — on agit, on laisse un
   chemin de retour. */
async function retirerMembre(uid) {
  try {
    await remote.retirerMembre(state.espace, uid);
    await refreshEspace();
    repaint();
    toast('Membre retiré de l’espace.', {
      action: {
        label: 'Annuler',
        onClick: async () => {
          await remote.ajouterMembre(state.espace, uid);
          await refreshEspace();
          repaint();
          toast('Membre rétabli.');
        },
      },
    });
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function changerMonMotDePasse() {
  const champ = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const erreur = el('p', { class: 'alerte', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Changer' });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Changer mon mot de passe' }),
      el('p', { class: 'panel__hint', text: 'Six caractères au minimum. Il ne transite que vers Firebase, jamais vers ce site — qui n’a pas de serveur pour le recevoir.' }),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Nouveau mot de passe' }), champ]),
      erreur,
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', text: 'Annuler', onClick: () => dismiss(dialog) }),
      valider,
    ]),
  ]);

  valider.addEventListener('click', async () => {
    if (champ.value.length < 6) {
      erreur.textContent = 'Six caractères au minimum.';
      erreur.hidden = false;
      return;
    }
    valider.disabled = true;
    try {
      await remote.changerMotDePasse(champ.value);
      dismiss(dialog, () => toast('Mot de passe changé.'));
    } catch (err) {
      erreur.textContent = err.message;
      erreur.hidden = false;
      valider.disabled = false;
    }
  });

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  champ.focus();
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

/* --- Intégration dans un autre site --------------------------------------
   Deux formes d'adresse, et le choix n'est pas cosmétique. Un questionnaire
   déjà dans le dépôt s'embarque par son identifiant : l'embed suit alors le
   dépôt, et ce qui sera poussé demain s'affichera sans retoucher au code
   collé. Un brouillon s'embarque par son contenu : l'embed fige le
   questionnaire tel qu'il est à la seconde où l'auteur copie.

   Le script qui accompagne l'iframe est délibérément sans dépendance et sans
   identifiant : il rattache chaque message au cadre dont il vient en
   comparant `contentWindow` à `event.source`, ce qui reste juste quand la
   page hôte en embarque plusieurs.                                        */

async function embedSnippet() {
  flush();
  /* Deux formes. Si le questionnaire est servi quelque part — au kiosque
     ou dans un espace — l'adresse courte le DÉSIGNE, et l'intégration
     suivra ses mises à jour. Sinon le lien en emporte une copie figée. */
  const auKiosque = state.published.some((q) => q.id === state.quiz.id);
  const dansLEspace = state.remote.some((q) => q.id === state.quiz.id);
  const suivi = auKiosque || dansLEspace;

  const court = new URL(`quiz.html?q=${encodeURIComponent(state.quiz.id)}`, location.href);
  if (dansLEspace) court.searchParams.set('espace', state.espace);
  court.searchParams.set('embed', '1');

  const url = suivi ? court.toString() : await linkFor(state.quiz, 'quiz.html?embed=1');

  const code = `<iframe
  src="${url}"
  title="${state.quiz.title.replace(/"/g, '&quot;')}"
  style="width:100%;height:720px;border:0;display:block"
  allow="web-share"></iframe>
<script>
window.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || typeof data !== 'object') return;
  var frames = document.querySelectorAll('iframe');
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].contentWindow !== event.source) continue;
    if (data.type === 'recohero:height') frames[i].style.height = data.height + 'px';
    if (data.type === 'recohero:scroll') frames[i].scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
});
<\/script>`;

  return { code, published: suivi };
}

async function showEmbed() {
  const { code, published } = await embedSnippet();
  const local = location.protocol === 'file:'
    || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  const area = el('textarea', {
    class: 'textarea input--mono', rows: '10', readonly: true, spellcheck: 'false',
  });
  area.value = code;

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Intégrer dans un autre site' }),
      el('p', { class: 'panel__hint', text: published
        ? 'Ce questionnaire est servi en ligne : le code ci-dessous le désigne, et suivra ses mises à jour sans qu’on y retouche.'
        : 'Ce questionnaire n’est publié nulle part : le code ci-dessous en emporte une copie figée. Le modifier ici ne changera rien à ce qui est déjà collé ailleurs.' }),
      local && el('p', {}, [el('span', {
        class: 'pill pill--warn',
        text: `Adresse locale (${location.host || 'file://'}) — ce code ne marchera que sur cette machine.`,
      })]),
      area,
      el('p', { class: 'panel__hint', text: 'Le script ajuste la hauteur du cadre au fil des questions et remonte la page hôte à chaque écran. Sans lui, le parcours défile dans un cadre de 720 px. Dans une iframe, le navigateur peut refuser le stockage : la reprise d’un parcours interrompu et l’historique ne fonctionnent alors pas, le reste si.' }),
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-embed': 'close', text: 'Fermer' }),
      el('button', { class: 'btn btn--primary', type: 'button', 'data-embed': 'copy', text: '⧉ Copier le code' }),
    ]),
  ]);

  dialog.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-embed]')?.dataset.embed;
    if (!action) return;
    if (action === 'copy') {
      toast(await copy(code) ? 'Code d’intégration copié.' : 'Copie impossible.', '');
      return;
    }
    dismiss(dialog);
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* --- L'espace partagé ------------------------------------------------------
   Le seul endroit du backoffice qui parle à un serveur. Tout y est
   facultatif : sans ?espace=… dans l'adresse, rien de ce qui suit ne
   s'exécute et le backoffice reste ce qu'il a toujours été.

   Le mot de passe ne quitte pas ce formulaire : remote.signIn l'échange
   contre un jeton, et c'est le jeton seul qui est conservé.            */

function repaint() { flush(); renderRail(); renderPanel(); }

async function refreshEspace() {
  forgetEspace();
  state.remote = await loadEspace(state.espace);
  state.membres = state.remoteSession
    ? await remote.membres(state.espace).catch(() => [])
    : [];
  [state.profils, state.vitrines] = await Promise.all([
    state.remoteSession ? remote.profilsEquipe(state.espace).catch(() => ({})) : {},
    remote.vitrines(state.espace),
  ]);
  await verifierGardeFou();
}

/* Poser une règle de base de données et croire qu'elle est là sont deux
   choses. On tente donc une écriture qui doit être refusée, et on le dit
   si elle passe. Sans ça, un espace non protégé ressemble trait pour
   trait à un espace protégé — jusqu'au jour où deux personnes publient. */
async function verifierGardeFou() {
  if (!state.espace || !state.remoteSession || !state.remote.length) return;
  /* Une fois par session suffit : la réponse ne change pas entre deux
     publications, et refreshEspace() est appelé après chacune. */
  if (state.guardActive !== null) return;
  state.guardActive = await remote.guardActive(state.espace, state.remote[0]);
}

function showSignIn() {
  const email = el('input', {
    class: 'input', type: 'email', autocomplete: 'username',
    placeholder: 'adresse@exemple.fr',
  });
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const erreur = el('p', { class: 'panel__hint', style: { color: 'var(--danger)' }, hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Se connecter' });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: `Se connecter à « ${state.espace} »` }),
      el('p', { class: 'panel__hint', text: 'Ces identifiants ne servent qu’à publier. Répondre aux questionnaires n’en demande aucun.' }),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Adresse e-mail' }), email]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Mot de passe' }), pass]),
      erreur,
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', {
        class: 'btn btn--quiet', type: 'button', text: 'Annuler',
        onClick: () => dismiss(dialog),
      }),
      valider,
    ]),
  ]);

  const tenter = async () => {
    if (!email.value.trim() || !pass.value) return;
    valider.disabled = true;
    erreur.hidden = true;
    try {
      state.remoteSession = await remote.signIn(email.value.trim(), pass.value);
      await refreshEspace();
      dismiss(dialog, () => {
        toast(`Connecté — ${state.remoteSession.email}`);
        repaint();
      });
    } catch (err) {
      erreur.textContent = err.message;
      erreur.hidden = false;
      valider.disabled = false;
      pass.value = '';
      pass.focus();
    }
  };

  valider.addEventListener('click', tenter);
  for (const field of [email, pass]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); tenter(); }
    });
  }

  document.body.append(dialog);
  dialog.showModal();
  email.focus();
}

async function signOutRemote() {
  remote.signOut();
  state.remoteSession = null;
  if (state.espace) {
    /* On revient à la porte : rester dans un backoffice d'espace sans
       compte n'offre rien à faire et laisse croire à une session. */
    location.reload();
    return;
  }
  await refreshEspace();
  toast('Déconnecté de l’espace.');
  repaint();
}

async function publishRemote() {
  flush();
  if (!state.remoteSession) return showSignIn();

  const problemes = diagnose(state.quiz).filter((i) => i.level === 'error');
  if (problemes.length) {
    return toast(`${problemes.length} problème${problemes.length > 1 ? 's' : ''} à corriger avant de publier.`, 'danger');
  }

  try {
    state.quiz.rev = await remote.saveQuiz(state.espace, state.quiz);
    state.quiz.updatedBy = state.remoteSession.uid;
    flush();
    await refreshEspace();
    toast(`« ${state.quiz.title} » est en ligne dans l’espace.`);
    repaint();
  } catch (err) {
    if (err.name === 'ConflitError') return resoudreConflit(err.distant);
    toast(err.message, 'danger');
  }
  return undefined;
}

/* Quelqu'un a publié entre le moment où ce questionnaire a été ouvert et
   maintenant. On ne choisit pas à la place de l'auteur : on lui dit qui, on
   lui dit quand, et on lui laisse les deux issues. Écraser reste possible —
   le garde-fou est là contre l'accident, pas contre la volonté.        */
async function resoudreConflit(distant) {
  const quand = distant.updatedAt
    ? formatDate(distant.updatedAt)
    : 'à une date inconnue';
  /* Sans profils de compte, on n'a que l'identifiant technique. Le dire
     ainsi vaut mieux que de laisser croire à un bug. */
  const qui = distant.updatedBy
    ? (distant.updatedBy === state.remoteSession?.uid
        ? 'toi, depuis un autre onglet ou un autre appareil'
        : nommer(distant.updatedBy))
    : 'un compte inconnu';

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Publication refusée — la version en ligne a changé' }),
      el('p', { text: `« ${distant.title} » a été modifié par ${qui}, ${quand}. Publier ta version maintenant effacerait ce travail-là.` }),
      el('p', { class: 'panel__hint', text: 'Reprendre la version en ligne l’ouvre dans l’éditeur, à côté de la tienne, pour que tu compares avant de décider. Écraser publie ta version telle quelle : l’autre est alors perdue.' }),
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', text: 'Annuler',
        onClick: () => dismiss(dialog) }),
      el('button', { class: 'btn btn--danger', type: 'button', text: 'Écraser quand même',
        onClick: () => dismiss(dialog, () => forcerPublication(distant)) }),
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Voir la version en ligne',
        onClick: () => dismiss(dialog, () => reprendreDistant(distant)) }),
    ]),
  ]);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* Écraser, c'est repartir de la révision réelle — pas la contourner. La
   base accepte alors, puisqu'on lui donne bien le numéro suivant. */
async function forcerPublication(distant) {
  state.quiz.rev = Number(distant.rev) || 0;
  try {
    state.quiz.rev = await remote.saveQuiz(state.espace, state.quiz);
    state.quiz.updatedBy = state.remoteSession.uid;
    flush();
    await refreshEspace();
    toast('Ta version a écrasé celle qui était en ligne.');
    repaint();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function reprendreDistant(distant) {
  const copie = normalize({ ...distant, id: uid('quiz'), title: `${distant.title} (version en ligne)` });
  store.saveDraft(copie);
  select(copie.id);
  flush();
  renderRail();
  renderPanel();
  toast('Version en ligne ouverte à côté de la tienne.');
}

async function unpublishRemote() {
  if (!state.remoteSession) return showSignIn();
  const titre = state.quiz.title;

  try {
    await remote.deleteQuiz(state.espace, state.quiz.id);
    await refreshEspace();
    toast(`« ${titre} » retiré de l’espace. Ta copie locale est intacte.`);
    repaint();
  } catch (err) {
    toast(err.message, 'danger');
  }
  return undefined;
}

function payload(quiz = state.quiz) {
  const { source, file, ...clean } = quiz;
  return JSON.stringify(clean, null, 2);
}

/* --- Sauvegarde et restauration -------------------------------------------
   L'export d'un questionnaire sert à passer un modèle à quelqu'un. L'export
   d'un catalogue entier sert à autre chose : c'est la SEULE sauvegarde d'un
   espace, la base gratuite n'ayant aucune restauration.

   D'où l'enveloppe qui se décrit elle-même — dans six mois, un fichier nu
   ne dirait plus d'où il vient — et surtout d'où l'import qui sait
   remplacer. Un import qui ne sait que dupliquer rend la restauration
   impossible : on obtiendrait douze doublons au lieu des douze originaux,
   et la sauvegarde n'en serait pas une.                                  */

function bundle(quizzes, espace = null) {
  return JSON.stringify({
    recohero: 1,
    espace,
    exporteLe: new Date().toISOString(),
    quizzes: quizzes.map((q) => { const { source, file, ...clean } = q; return clean; }),
  }, null, 2);
}

function horodatage() {
  return new Date().toISOString().slice(0, 10);
}

function exportEspace() {
  if (!state.remote.length) return toast('Cet espace est vide.', 'danger');
  download(`recohero-${slugify(state.espace, 'espace')}-${horodatage()}.json`,
           bundle(state.remote, state.espace));
  toast(`${state.remote.length} questionnaire(s) exporté(s).`);
}

function exportDrafts() {
  flush();
  const drafts = store.allDrafts();
  if (!drafts.length) return toast('Aucun brouillon à exporter.', 'danger');
  download(`recohero-brouillons-${horodatage()}.json`, bundle(drafts));
  toast(`${drafts.length} brouillon(s) exporté(s).`);
}

function exportOne(id) {
  const source = state.remote.find((q) => q.id === id) || state.published.find((q) => q.id === id);
  if (!source) return undefined;
  download(`${slugify(source.title, source.id)}.json`, payload(source));
  return toast(`« ${source.title} » exporté.`);
}

/* Que faire des questionnaires déjà présents en local. Posée UNE fois pour
   tout un fichier : douze questions successives pour une restauration
   seraient une punition, pas une sécurité. */
function askCollision(count) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'modal' }, [
      el('div', { class: 'modal__body stack' }, [
        el('h2', { text: count > 1 ? `${count} questionnaires existent déjà` : 'Ce questionnaire existe déjà' }),
        el('p', { text: count > 1
          ? `Ce fichier contient ${count} questionnaires que tu as déjà en brouillon, sous le même identifiant.`
          : 'Tu as déjà un brouillon portant le même identifiant.' }),
        el('p', { class: 'panel__hint', text: 'Remplacer écrase ta copie locale — c’est ce qu’il faut pour restaurer une sauvegarde. Créer une variante garde les deux, avec un identifiant neuf.' }),
      ]),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--quiet', type: 'button', text: 'Annuler',
          onClick: () => dismiss(dialog, () => resolve(null)) }),
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Créer une variante',
          onClick: () => dismiss(dialog, () => resolve('variante')) }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Remplacer ma copie',
          onClick: () => dismiss(dialog, () => resolve('remplacer')) }),
      ]),
    ]);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  });
}

function exportJson() {
  flush();
  download(`${slugify(state.quiz.title, state.quiz.id)}.json`, payload());
}

async function copyJson() {
  flush();
  toast(await copy(payload()) ? 'JSON copié.' : 'Copie impossible.');
}

/* Accepte les deux formes : un questionnaire seul — ce que deux créateurs
   s'échangent — ou une enveloppe de catalogue, ce qu'on restaure. */
async function adopt(raw, label) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    return toast(`Import refusé : fichier illisible (${err.message}).`, 'danger');
  }

  const brut = Array.isArray(data?.quizzes) ? data.quizzes
             : Array.isArray(data) ? data
             : [data];
  if (!brut.length) return toast('Import refusé : ce fichier ne contient aucun questionnaire.', 'danger');

  let entrants;
  try {
    entrants = brut.map((q) => normalize(q));
  } catch (err) {
    return toast(`Import refusé : ${err.message}`, 'danger');
  }

  const collisions = entrants.filter((q) => store.getDraft(q.id));
  let choix = 'remplacer';
  if (collisions.length) {
    choix = await askCollision(collisions.length);
    if (!choix) return toast('Import annulé.');
  }

  /* Écrire l'état courant AVANT d'importer, puis lâcher le questionnaire
     en mémoire. Sans ça, le seul qui ne se restaure jamais est celui qu'on
     a sous les yeux : la sauvegarde différée le réécrirait par-dessus sa
     propre restauration, et le compte des remplacements mentirait. */
  flush();
  state.quiz = null;

  for (const quiz of entrants) {
    if (choix === 'variante' && store.getDraft(quiz.id)) {
      quiz.id = uid('quiz');
      quiz.title = `${quiz.title} (variante)`;
    }
    store.saveDraft(quiz);
  }

  select(entrants[0].id);
  state.panel = 'identite';
  flush();
  renderRail();
  renderPanel();

  const source = label ? ` depuis ${label}` : '';
  const remplaces = choix === 'remplacer' ? collisions.length : 0;
  return toast(entrants.length > 1
    ? `${entrants.length} questionnaires importés${source}${remplaces ? `, dont ${remplaces} remplacé(s)` : ''}.`
    : `« ${entrants[0].title} » importé${source}${remplaces ? ' — copie locale remplacée' : ''}.`);
}

async function importFile(file) {
  try {
    adopt(await file.text(), file.name);
  } catch (err) {
    toast(`Fichier illisible : ${err.message}`, 'danger');
  }
}

function importPaste() {
  const area = el('textarea', {
    class: 'textarea input--mono', rows: '10', placeholder: '{ "title": … }',
    'aria-label': 'JSON du questionnaire',
  });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Coller un questionnaire' }),
      el('p', { class: 'panel__hint', text: 'Colle le JSON complet d’un questionnaire RecoHero.' }),
      area,
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', {
        class: 'btn btn--ghost', type: 'button', text: 'Annuler',
        onClick: () => dismiss(dialog),
      }),
      el('button', {
        class: 'btn btn--primary', type: 'button', text: 'Importer',
        onClick: () => {
          const text = area.value.trim();
          dismiss(dialog, () => { if (text) adopt(text, 'le presse-papier'); });
        },
      }),
    ]),
  ]);

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  area.focus();
}
