/* ==========================================================================
   quiz.js — le parcours du répondant.
   Une seule vue à l'écran, un seul état en mémoire, un seul point de
   rendu. La délégation d'évènements est posée une fois sur la scène :
   aucun gestionnaire en ligne dans le HTML.
   ========================================================================== */

import { resolveQuiz, loadAll } from './core/catalog.js';
import { vitrines as chargerVitrines, compterParcours, compterDebut, identite as chargerIdentite } from './core/remote.js';
import { tally, resolve, proximite, indices } from './core/scoring.js';
import { RECO_TYPES, slugify, dureeEstimee, normaliserIdentite } from './core/schema.js';
import { questionView } from './core/views.js';
import * as store from './core/store.js';
import { linkFor } from './core/share.js';
import { renderResultCard, toBlob } from './core/card.js';
import { el, paragraphs, escapeHtml, applyAccent, toast, copy, downloadBlob, avecEspace, garderEspace } from './core/ui.js';

const params = new URLSearchParams(location.search);
const isTest = params.has('test');
const isEmbed = params.has('embed');
/* Le mode borne : une tablette posée dans la bibliothèque, en libre accès.
   Il ne change pas le questionnaire, il change ce qu'on fait de la trace —
   voir § « Le mode borne » plus bas. */
const isKiosque = params.has('kiosque');
const espace = params.get('espace');

/* L'apparence publique du lieu. Chargée à l'amorçage quand il y a un espace,
   et seulement lue par la carte de résultat. */
let identiteEspace = null;

/* Le kiosque d'origine, celui du dépôt ou celui d'un espace : toute sortie
   doit y revenir, sinon le visiteur d'une médiathèque atterrit chez nous. */
const kiosque = avecEspace('index.html', espace);

/* En mode test, la sortie ramène à l'éditeur d'où l'on vient — et à SON
   espace. Le libellé disait « Retour au backoffice » depuis toujours ;
   l'adresse, elle, menait au kiosque. */
const sortie = isTest ? avecEspace('admin.html', espace) : kiosque;

/* --- Le compte qui monte ---------------------------------------------------------
   Les jauges du résultat affichent leur nombre en le comptant depuis zéro.
   C'est une animation CSS sur une propriété personnalisée typée : il faut
   l'enregistrer une fois, et le CSS n'a pas de moyen de savoir si c'est
   fait. D'où ce drapeau, posé en classe sur la feuille de score : sans lui,
   le nombre est simplement écrit, et il est juste. */
let compteAnime = false;
try {
  if (window.CSS?.registerProperty) {
    CSS.registerProperty({ name: '--n', syntax: '<integer>', inherits: true, initialValue: 0 });
    compteAnime = true;
  }
} catch { /* non pris en charge : le nombre est là, sans le compte */ }

const dom = {
  bar: document.getElementById('quizbar'),
  title: document.getElementById('quizTitle'),
  tally: document.getElementById('quizTally'),
  progress: document.getElementById('quizProgress'),
  stage: document.getElementById('stage'),
  exit: document.getElementById('exitLink'),
};

const state = {
  /* Les vitrines : ce que chaque auteur a choisi de rendre public. Vide
     par défaut — un crédit sans vitrine n'affiche rien, et c'est le
     comportement voulu, pas une panne. */
  vitrines: {},
  quiz: null,
  step: -1,        // -1 = couverture, n = résultat
  reprise: 0,      // l'étape d'une session retrouvée, 0 si aucune
  answers: {},
  direction: 'forward',
  finished: false,
};

/* --- Démarrage ------------------------------------------------------------ */

boot();

async function boot() {
  try {
    const quiz = await resolveQuiz({ id: params.get('q'), espace });
    if (!quiz) return fail('Questionnaire introuvable.', "Vérifiez le lien, ou revenez au kiosque.");
    if (!quiz.questions.length) return fail('Ce questionnaire n’a pas encore de question.', quiz.title);

    state.quiz = quiz;
    if (espace && quiz.auteurs?.length) state.vitrines = await chargerVitrines(espace);
    /* L'identité du lieu, pour la carte de résultat : c'est le seul objet du
       produit qui sort du bâtiment, et il doit porter le nom de la
       médiathèque. Lecture publique, comme au kiosque. Un échec ne coûte que
       le repli sur notre marque — il n'empêche pas de répondre. */
    if (espace) {
      identiteEspace = await chargerIdentite(espace)
        .then((brute) => normaliserIdentite(brute))
        .catch(() => null);
    }
    document.title = `${quiz.title} — RecoHero`;
    applyAccent(quiz.accent);
    dom.title.textContent = quiz.title;
    dom.bar.hidden = false;

    dom.exit.href = sortie;
    if (isTest) dom.exit.textContent = '← Retour au backoffice';
    garderEspace();
    if (isEmbed) wireEmbed();
    if (isKiosque) wireKiosque();

    /* Sur une borne, il n'y a pas de « plus tard » : le parcours en cours
       appartient à la personne devant l'écran, et la suivante doit trouver
       la couverture, pas les réponses de quelqu'un d'autre. */
    const saved = store.getSession(quiz.id);
    if (saved && !isTest && !isKiosque) {
      state.answers = saved.answers || {};
      /* L'étape où l'on s'est arrêté. Elle n'était pas enregistrée : « Reprendre
         où j'en étais » ramenait à la question 1, c'est-à-dire promettait ce
         que le format des données ne permettait pas. Une session écrite avant
         ce changement n'a pas de `step` — elle reprend au début, comme avant.
         Bornée, parce que le questionnaire a pu raccourcir entre-temps. */
      state.reprise = Math.min(Math.max(0, Number(saved.step) || 0), quiz.questions.length - 1);
    }

    render();
    window.addEventListener('keydown', onKey);
    dom.stage.addEventListener('click', onStageClick);
    wireSwipe();
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
      !isEmbed && el('p', { class: 'navrow', style: { justifyContent: 'center', marginTop: '1.5rem' } }, [
        el('a', { class: 'btn btn--primary', href: kiosque, text: 'Aller au kiosque' }),
      ]),
    ]),
  ]));
}

/* --- Rendu ---------------------------------------------------------------- */

/* La transition de vue est un SUPPLÉMENT, jamais le socle. Le navigateur qui
   ne la connaît pas — ou la personne qui a demandé moins de mouvement — reçoit
   le rendu direct et l'animation d'entrée maison, qui suffit. C'est la règle
   du projet : la valeur au repos doit être juste sans elle.

   Elle apporte ce que `replaceChildren` ne pouvait pas donner : la SORTIE de
   l'écran quittant. Le navigateur photographie l'avant et l'après ; nous
   n'avons aucune position absolue à poser, donc rien qui puisse fausser la
   hauteur annoncée à un site hôte en mode embarqué. */
function render() {
  const transitionnable = typeof document.startViewTransition === 'function'
    && !MOUVEMENT_REDUIT?.matches;

  if (!transitionnable) return dessiner();

  /* Une transition en cours ne doit pas faire attendre la suivante. Sans
     cette coupure, un écran demandé pendant l'animation était mis en file :
     qui enchaîne les réponses au clavier — ou change d'avis — sentait le
     parcours traîner d'un demi-tour à chaque fois. On coupe court, et la
     nouvelle part tout de suite. */
  transitionEnCours?.skipTransition();

  document.documentElement.classList.add('a-la-transition');
  document.documentElement.style.setProperty('--sens', state.direction === 'back' ? '-1' : '1');

  const geste = document.startViewTransition(() => dessiner());
  transitionEnCours = geste;

  const nettoyer = () => {
    if (transitionEnCours !== geste) return;
    transitionEnCours = null;

    /* L'ORDRE EST LE SUJET. `html.a-la-transition` neutralise l'animation
       d'entrée maison le temps que la transition de vue fasse son travail —
       les deux se superposeraient. Mais la classe `view-enter`, elle, restait
       sur l'écran une fois celui-ci posé : retirer `a-la-transition`
       RÉVEILLAIT donc `view-in` sur un contenu déjà arrivé et immobile.

       Chaque question se terminait ainsi par une seconde animation de 460 ms —
       opacité ramenée à zéro, glissement de 22 px — juste après la transition
       de 240 ms qui venait de la poser. C'était ça, le tressautement : pas un
       défaut de la transition, mais une animation de trop derrière elle.

       On désarme donc l'élément AVANT de rendre la main au CSS. */
    for (const vue of dom.stage.querySelectorAll('.view-enter')) {
      vue.classList.remove('view-enter', 'view-enter--back');
    }
    document.documentElement.classList.remove('a-la-transition');
  };

  /* Couper une transition REJETTE ses promesses, et c'est le cas nominal
     ici — on coupe à chaque écran demandé pendant l'animation. Il faut donc
     les traiter toutes les deux : un `.finally()` laisse passer le rejet, et
     le parcours crachait onze rejets non gérés dans la console. Ce n'est pas
     une erreur, c'est le fonctionnement. */
  geste.finished.then(nettoyer, nettoyer);
  geste.ready.catch(() => {});
  return undefined;
}

let transitionEnCours = null;

function dessiner() {
  const { quiz, step } = state;
  const view =
    step < 0 ? renderCover() :
    step >= quiz.questions.length ? renderResult() :
    renderQuestion(quiz.questions[step], step);

  view.classList.add('view-enter');
  if (state.direction === 'back') view.classList.add('view-enter--back');

  dom.stage.replaceChildren(el('div', { class: 'stage__inner page' }, [view]));

  /* L'ambiance d'une question illustrée : la même image, floutée, en fond
     de scène. Décorative, éteinte sous `--ambient`. */
  const courante = step >= 0 && step < quiz.questions.length ? quiz.questions[step] : null;
  if (courante?.image) {
    dom.stage.prepend(el('div', {
      class: 'stage__fond', 'aria-hidden': 'true',
      style: { backgroundImage: `url("${courante.image.replace(/["\\]/g, '')}")` },
    }));
  }
  updateBar();

  const heading = dom.stage.querySelector('h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  /* Embarqué et auto-dimensionné, le cadre n'a pas de défilement interne :
     remonter est l'affaire de la page hôte. Jamais au premier rendu — le
     seul chargement de l'embed happerait la page vers lui.             */
  if (!isEmbed) window.scrollTo(0, 0);
  else {
    measureEmbed();
    if (!firstPaint) window.parent.postMessage({ type: 'recohero:scroll' }, EMBED_TARGET);
  }
  firstPaint = false;

  /* Après le rendu, jamais pendant : le catalogue arrive quand il arrive, et
     le résultat n'a pas à l'attendre. */
  if (step >= quiz.questions.length) { suite(quiz); apercuCarte(quiz); }
}

let derniersScores = null;

function updateBar() {
  const { quiz, step } = state;
  const answered = Object.keys(state.answers).length;
  const ratio = state.step >= quiz.questions.length
    ? 1
    : Math.min(answered, quiz.questions.length) / quiz.questions.length;
  dom.progress.style.width = `${Math.round(ratio * 100)}%`;
  /* Un trait par question : la barre se lit comme les pastilles d'une
     story, et le CSS découpe la piste d'après ce nombre. */
  dom.progress.parentElement?.style.setProperty('--n', String(quiz.questions.length));
  dom.bar.classList.toggle('est-derniere', step === quiz.questions.length - 1);

  const scores = tally(quiz, state.answers);
  /* Dix au plus, comme la carte de résultat — et resserrés au-delà de six.
     Le bandeau est collant : ce qu'il prend, le parcours ne l'a plus. */
  const montres = quiz.axes.slice(0, 10);
  dom.tally.classList.toggle('is-dense', montres.length > 6);

  /* Sur téléphone, le CSS empile déjà le nombre sous le glyphe, ce qui rend
     un axe deux fois plus étroit. Empilé, le compteur tient à côté du titre
     jusqu'à cinq axes ; au-delà il lui faut la ligne entière.

     Le seuil est ici et non en CSS parce qu'une requête de média ne sait pas
     compter les axes ; et il ne s'applique qu'au téléphone, ce que le CSS,
     lui, sait décider. Chacun tranche ce qu'il peut voir. */
  dom.tally.parentElement?.classList.toggle('is-empile', montres.length > 5);

  /* Le compteur est une région vivante : le reconstruire à chaque rendu
     le ferait relire à chaque changement d'écran, alors que rien n'a
     changé. On ne le refait que quand les nombres bougent. */
  const empreinte = montres.map((a) => scores.counts[a.id]).join('·') + '|' + scores.leaders.join(',');
  if (empreinte !== derniersScores) {
    derniersScores = empreinte;
    dom.tally.replaceChildren(...montres.map((axis, rang) => el(
    'span',
    { /* Qui mène, pendant qu'on joue. La course est le sujet du
         questionnaire ; jusqu'ici elle ne se lisait qu'à l'arrivée. */
      class: 'tally__axis' + (scores.leaders.includes(axis.id) && scores.best > 0 ? ' is-lead' : ''),
      /* Le même nom que la pastille de la couverture et que la jauge du
         résultat : la transition de vue fait VOYAGER l'axe d'un écran à
         l'autre au lieu de le faire réapparaître. Le rang, pas
         l'identifiant : un nom de transition doit être un identifiant CSS
         valide, et un identifiant d'axe peut être n'importe quoi. */
      style: { '--axis': axis.color, viewTransitionName: `axe-${rang}` },
      title: axis.label, 'data-axis': axis.id },
    [
      /* Le glyphe est un signe, pas un mot : lu à voix haute, « puce » ne dit
         rien de l'axe, et le compteur — qui est une région vivante — annonçait
         « puce zéro, étoile deux, triangle zéro » à chaque réponse. Le nom
         n'existait que dans `title`, qui n'entre pas dans le nom accessible.
         Le glyphe passe donc en décoratif et le nom devient du texte, masqué
         à l'œil seulement. La course entre axes est le sujet du
         questionnaire : elle doit s'entendre. */
      el('span', { class: 'tally__glyph', text: axis.glyph, 'aria-hidden': 'true' }),
      el('span', { class: 'visually-hidden', text: `${axis.label} : ` }),
      el('span', { class: 'tally__count', text: String(scores.counts[axis.id]) }),
    ],
    )));
  }
  /* Caché sur la couverture, et caché sur le résultat : les jauges y
     prennent le relais, et un même axe ne peut pas porter son nom de
     transition à deux endroits de la même page. */
  dom.tally.hidden = step < 0 || step >= quiz.questions.length;
}

/* --- Les points qui volent ---------------------------------------------------
   De la réponse touchée jusqu'à son axe, dans le bandeau. Rien de l'état
   n'en dépend : le compteur est déjà juste quand le premier point décolle,
   et si l'animation ne s'exécute pas — mouvement réduit, onglet en
   arrière-plan, navigateur sans Web Animations — le parcours est
   rigoureusement identique. C'est la règle du projet : la valeur au repos
   doit être juste sans JS, l'animation est un supplément.             */

const MOUVEMENT_REDUIT = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const POINTS_MAX = 4;    /* un +9 ne doit pas gicler neuf fois */
const VOL_MS = 240;

let couche = null;

function envoler(depuis, gains) {
  if (MOUVEMENT_REDUIT?.matches || typeof Element.prototype.animate !== 'function') {
    return bump(gains.map((g) => g.axe.id));
  }

  const depart = depuis.getBoundingClientRect();
  if (!couche) {
    couche = el('div', { class: 'vol', 'aria-hidden': 'true' });
    document.body.append(couche);
  }

  for (const { axe, points } of gains) {
    const cible = dom.tally.querySelector(`[data-axis="${CSS.escape(axe.id)}"] .tally__glyph`);
    if (!cible) { bump([axe.id]); continue; }
    const arrivee = cible.getBoundingClientRect();

    const combien = Math.min(points, POINTS_MAX);
    for (let i = 0; i < combien; i += 1) {
      const x0 = depart.left + depart.width * (0.18 + 0.1 * i);
      const y0 = depart.top + depart.height / 2;
      const x1 = arrivee.left + arrivee.width / 2;
      const y1 = arrivee.top + arrivee.height / 2;

      const point = el('span', {
        class: 'vol__point', text: axe.glyph, style: { '--axis': axe.color },
      });
      couche.append(point);

      const geste = point.animate([
        { transform: `translate(${x0}px, ${y0}px) scale(0.6)`, opacity: 0 },
        { transform: `translate(${x0 + (x1 - x0) * 0.25}px, ${y0 - 26}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${x1}px, ${y1}px) scale(0.7)`, opacity: 0.9 },
      ], { duration: VOL_MS + i * 70, easing: 'cubic-bezier(0.32, 0, 0.24, 1)', fill: 'forwards' });

      /* Le compteur réagit quand le point ARRIVE, pas quand il part.

         Mais l'arrivée ne peut pas reposer sur `finished` SEUL : une
         animation ne progresse pas dans un onglet qui ne compose pas, la
         promesse ne se résout alors jamais, et le glyphe resterait dans le
         document indéfiniment. C'est le même interdit que le
         `requestAnimationFrame` proscrit dans ARCHITECTURE.md, et il se
         paie ici aussi. Un délai de secours ferme donc le geste, quoi
         qu'il arrive ; `atterrir` ne s'exécute qu'une fois. */
      let pose = false;
      const atterrir = () => {
        if (pose) return;
        pose = true;
        clearTimeout(secours);
        point.remove();
        bump([axe.id]);
      };
      const secours = setTimeout(atterrir, VOL_MS + i * 70 + 400);
      geste.finished.then(atterrir, atterrir);
    }
  }
  return undefined;
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
    /* La lumière de fin de journée : une lueur chaude et quelques grains
       qui dérivent, derrière le titre. Purement décoratif — masqué aux
       lecteurs d'écran, éteint sous `--ambient`, et rien du parcours n'en
       dépend. */
    el('div', { class: 'cover__lueur', 'aria-hidden': 'true' },
      [0, 1, 2, 3].map(() => el('span', { class: 'cover__mote' }))),
    quiz.image
      ? el('img', { class: 'cover__image', src: quiz.image, alt: '' })
      : el('div', { class: 'cover__emoji', text: quiz.emoji || '✦' }),
    el('h1', { class: 'cover__title', text: quiz.title }),
    quiz.tagline && el('p', { class: 'cover__tagline', text: quiz.tagline }),
    quiz.intro && el('div', { class: 'cover__intro', html: paragraphs(quiz.intro) }),
    el('div', { class: 'cover__axes' }, quiz.axes.map((axis, rang) => el(
      'span', {
        class: 'cover__axis',
        style: { '--axis': axis.color, animationDelay: `${120 + rang * 60}ms` },
      },
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
    signature(quiz),
    /* La durée d'abord : « huit questions » ne dit pas si on a le temps, et
       c'est la seule chose que se demande quelqu'un qui hésite devant une
       tablette — ou devant une affiche, qui annonce la même estimation. */
    el('p', {
      class: 'cover__meta',
      text: `environ ${dureeEstimee(quiz)} minute${dureeEstimee(quiz) > 1 ? 's' : ''} · `
          + `${quiz.questions.length} question${quiz.questions.length > 1 ? 's' : ''} · `
          + `${quiz.results.length} profil${quiz.results.length > 1 ? 's' : ''} possible`
          + `${quiz.results.length > 1 ? 's' : ''}`,
    }),
    isTest && el('p', { class: 'cover__meta' }, [el('span', { class: 'pill pill--warn', text: 'Mode test — rien n’est enregistré' })]),
  ]);
}

/* Les auteurs crédités, et seulement ceux qui ont choisi d'être nommés.
   Un crédit sans vitrine ne produit rien : la donnée publique n'existe
   pas, il n'y a donc rien à filtrer côté client — c'est la base qui n'a
   jamais eu ce nom.                                                     */
function signature(quiz) {
  const nommes = (quiz.auteurs || [])
    .map((uid) => state.vitrines[uid])
    .filter(Boolean);
  if (!nommes.length) return null;

  return el('div', { class: 'signature' }, [
    el('span', { class: 'signature__intro', text: nommes.length > 1 ? 'Un questionnaire de' : 'Un questionnaire de' }),
    ...nommes.map((v) => el('span', { class: 'signature__auteur' }, [
      v.image && el('img', { class: 'signature__photo', src: v.image, alt: '', loading: 'lazy' }),
      el('span', {}, [
        el('span', { class: 'signature__nom', text: v.nom }),
        v.poste && el('span', { class: 'signature__poste', text: v.poste }),
      ]),
    ])),
  ]);
}

/* --- Question -------------------------------------------------------------- */

function renderQuestion(question, index) {
  const { quiz } = state;
  const picked = state.answers[question.id];
  const chosen = new Set(Array.isArray(picked) ? picked : picked ? [picked] : []);
  const multiple = question.type === 'multiple';

  /* La vue elle-même est partagée avec l'aperçu du backoffice (views.js) :
     ce que l'auteur voit en éditant est littéralement ce que le répondant
     verra. Seule la barre de navigation est propre au parcours. */
  const view = questionView(quiz, question, index, { chosen, total: quiz.questions.length });

  /* Les touches et le balayage existent depuis toujours et rien ne les
     annonçait. Une mention sur la première question seulement : passé ce
     point, ou bien la personne s'en sert, ou bien elle a choisi de ne pas
     s'en servir — et la répéter serait du bruit. */
  /* Hors du flux, et c'est tout l'objet du changement. Posée dans la colonne,
     elle ajoutait 97 px à la seule première question : la vue étant centrée
     verticalement, le titre descendait de 48 px en passant à la deuxième, et
     la transition faisait son fondu entre deux positions différentes. C'est
     ce saut qu'on voyait comme un tressautement. Elle se pose donc au bas de
     la scène, où elle ne pousse rien. */
  if (index === 0) {
    view.append(el('p', { class: 'astuce astuce--pose' }, [
      el('span', { class: 'astuce__clavier', text: 'Touches 1 à 9 pour répondre, ← → pour naviguer' }),
      el('span', { class: 'astuce__tactile', text: 'Balayez pour passer d’une question à l’autre' }),
    ]));
  }

  /* Une question à choix multiple n'enchaîne pas toute seule, et rien ne le
     disait. Après sept questions qui avancent d'elles-mêmes, la huitième
     paraît ne pas répondre au clic : on coche, il ne se passe rien, et on
     attend. Le bouton porte donc la consigne au lieu d'un « Suivant » qui
     suppose qu'on ait deviné qu'il faut le presser. */
  if (multiple) {
    view.append(el('p', { class: 'astuce', text:
      'Cochez tout ce qui vous tente, puis validez.' }));
  }

  const dernier = index + 1 === quiz.questions.length;
  view.append(el('div', { class: 'navrow' }, [
    el('button', { class: 'btn btn--quiet', type: 'button', 'data-act': 'back', text: '← Précédent' }),
    el('span', { class: 'navrow__spacer' }),
    (multiple || chosen.size) && el('button', {
      class: 'btn btn--primary', type: 'button', 'data-act': 'next',
      text: multiple && !chosen.size
        ? 'Choisissez au moins une réponse'
        : (dernier ? 'Voir le résultat' : 'Suivant →'),
      'aria-disabled': chosen.size ? null : 'true',
    }),
  ]));

  return view;
}

/* --- Résultat --------------------------------------------------------------- */

function renderResult() {
  const { quiz } = state;
  const scores = tally(quiz, state.answers);
  const profile = resolve(quiz, scores);

  if (!state.finished) {
    state.finished = true;
    store.clearSession(quiz.id);
    /* Une fois par parcours terminé, jamais en mode test : compter les
       essais de l'auteur fausserait la seule chose que le compteur sait
       dire. L'appel n'est pas attendu — le résultat s'affiche d'abord. */
    /* La borne compte, elle : ce sont de vrais répondants. Seuls les essais
       de l'auteur fausseraient la mesure. */
    if (espace && !isTest) compterParcours(espace, quiz.id, profile?.id);
    /* L'historique, en revanche, n'a rien à faire sur un poste partagé : il
       montrerait à la personne suivante ce que la précédente a obtenu. */
    if (!isTest && !isKiosque && profile) {
      store.addResult({
        quizId: quiz.id, quizTitle: quiz.title, quizEmoji: quiz.emoji,
        accent: quiz.accent, resultTitle: profile.title,
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

  /* Le calcul d'un côté, le coup de cœur de l'autre. Une œuvre glissée
     « parce qu'on y tient » n'a pas la même autorité qu'une œuvre que les
     réponses ont désignée : les mélanger ferait passer un choix personnel
     pour une conséquence, et abîmerait la confiance dans les deux. */
  const calculees = profile.recos.filter((r) => !r.confiance);
  const coeur = profile.recos.filter((r) => r.confiance);

  /* --- Le dépouillement ------------------------------------------------------
     Le résultat arrivait d'un bloc, le nom du profil en premier : tout était
     dit avant qu'on ait regardé. Il se lit maintenant dans l'ordre où il
     s'est établi. D'abord la récolte : les jauges se déposent une à une, le
     nombre monte, le glyphe qui mène grossit. Puis le profil, avec son halo.
     Puis, en descendant, ce qui l'a fait pencher et ce qu'on propose.

     `--apres` est le temps du premier temps : c'est lui que le CSS attend
     avant d'allumer le profil. Il dépend du nombre d'axes, que seul le JS
     connaît. Sous mouvement réduit, tous les jetons tombent à 1 ms et
     l'ordre au repos reste le bon. */
  const apres = Math.min(quiz.axes.length, 10) * 140 + 520;
  const retard = apres + 300;

  const recosNode = el('section', { class: 'recos' }, [
    el('div', { class: 'recos__head' }, [
      el('h2', { text: 'À lire, voir, écouter' }),
      el('span', { class: 'pill pill--accent', text: `${calculees.length} reco${calculees.length > 1 ? 's' : ''}` }),
    ]),
    /* Les recos entrent APRÈS la feuille de score : le résultat se lit
       dans l'ordre où il a été établi — voilà ce que vous avez récolté,
       voilà donc ce qu'on vous propose. */
    el('div', { class: 'recos__list' },
      calculees.map((reco, i) => renderReco(reco, i, retard))),

    coeur.length && el('div', { class: 'recos__coeur' }, [
      el('p', { class: 'recos__coeur__intro', text: coeur.length > 1
        ? 'Et parce qu’on y tient, quoi qu’en dise le compteur :'
        : 'Et parce qu’on y tient, quoi qu’en dise le compteur :' }),
      el('div', { class: 'recos__list' },
        coeur.map((reco, i) => renderReco(reco, calculees.length + i, retard))),
    ]),
  ]);

  const sommet = Math.max(1, ...quiz.axes.map((a) => scores.counts[a.id] || 0));
  const depouillement = el('div', { class: 'scores' + (compteAnime ? ' est-compte' : '') }, [
    el('p', { class: 'scores__kicker', text: 'Votre récolte' }),
    ...quiz.axes.map((axis, rang) => {
      const value = scores.counts[axis.id];
      return el('div', {
        class: 'score' + (scores.leaders.includes(axis.id) ? ' is-lead' : ''),
        /* `--retard` cadence la ligne, sa jauge, son compte et sa couronne ;
           le nom de transition reprend celui du compteur du bandeau, qui
           vient de disparaître : l'axe descend à sa place. */
        style: { '--axis': axis.color, '--retard': `${rang * 140}ms`, viewTransitionName: `axe-${rang}` },
      }, [
        el('span', { class: 'score__label' }, [
          el('span', { class: 'glyph', text: axis.glyph, 'aria-hidden': 'true' }),
          axis.label,
          /* Le nombre, lu une fois avec son axe. Le compteur visible est
             décoratif : il compte depuis zéro, et une synthèse vocale n'a
             pas à suivre un chiffre qui change. */
          el('span', { class: 'visually-hidden', text: ` : ${value}` }),
        ]),
        el('div', { class: 'score__track' }, [
          el('div', {
            class: 'score__fill',
            style: { width: `${Math.round(Math.min(1, Math.max(0, value) / sommet) * 100)}%` },
          }),
        ]),
        el('span', { class: 'score__value', 'aria-hidden': 'true', style: { '--n': String(value) } }, [
          el('span', { class: 'score__chiffre', text: String(value) }),
        ]),
      ]);
    }),
  ]);

  const node = el('section', { class: 'result', style: { '--apres': `${apres}ms` } }, [
    depouillement,

    el('div', { class: 'result__banner' }, [
      /* Le halo qui s'allume derrière le profil, et trois étincelles.
         Décoratif : le résultat se lit exactement pareil sans eux. */
      el('div', { class: 'result__halo', 'aria-hidden': 'true' }),
      el('span', { class: 'result__spark', 'aria-hidden': 'true' }),
      el('span', { class: 'result__spark', 'aria-hidden': 'true' }),
      el('span', { class: 'result__spark', 'aria-hidden': 'true' }),
      el('p', { class: 'result__kicker', text: quiz.title }),
      profile.image && el('img', { class: 'result__image', src: profile.image, alt: '' }),
      el('h1', { class: 'result__title', text: profile.title }),
      profile.subtitle && el('p', { class: 'result__subtitle', text: profile.subtitle }),
      profile.text && el('div', { class: 'result__text', html: paragraphs(profile.text) }),
    ]),

    /* La jauge se lit d'un axe à l'autre, pas contre un plafond que le
       questionnaire rend inatteignable (voir `sommet`, plus haut) : l'axe
       qui mène remplit sa barre, les autres se situent par rapport à lui.
       Sur le questionnaire d'exemple, l'axe gagnant ne remplissait qu'à
       54 % en moyenne un plafond théorique qu'aucun des 34 992 parcours
       n'atteignait. */

    /* La carte à emporter, montrée à l'instant de la révélation et non au
       bout de trois écrans. Vide tant que le canvas n'a pas répondu, et
       `apercuCarte()` la remplit après le rendu. */
    el('section', { class: 'carte' }),

    /* Ce qui a pesé, entre la récolte et la prescription : le résultat se
       lit alors dans l'ordre où il s'est établi — voilà ce que vous avez
       récolté, voilà ce qui l'a fait pencher, voilà donc ce qu'on vous
       propose. */
    indicesNode(quiz, profile),

    profile.recos.length ? recosNode : null,


    presqueNode(quiz, scores, profile),

    /* Rempli après coup, quand le catalogue a répondu — voir `suite()`. */
    el('section', { class: 'suite' }),

    /* Deux rangées : ce qu'on emporte (la carte, le partage), puis ce qu'on
       fait ensuite. Sur téléphone la première colle au bas de l'écran. */
    el('div', { class: 'result__actions result__actions--primaires' }, [
      el('button', { class: 'btn btn--primary', type: 'button', 'data-act': 'card', text: '🖼 Ma carte de résultat' }),
      el('button', { class: 'btn btn--ghost', type: 'button', 'data-act': 'share', text: '⤴ Partager ce questionnaire' }),
    ]),
    el('div', { class: 'result__actions result__actions--suite' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-act': 'restart', text: '↺ Refaire' }),
      /* `isKiosque` autant qu'`isEmbed`. Sur une borne, le bandeau a perdu
         sa sortie (`wireKiosque`), mais celle-ci restait — et `avecEspace()`
         reconduit l'espace, jamais le mode. Un doigt ici sortait la tablette
         du mode borne pour la journée : la session et l'historique se
         remettaient à s'écrire, et le kiosque montrait à l'usager suivant
         les résultats de tous les précédents. */
      !isEmbed && !isKiosque && el('a', { class: 'btn btn--quiet', href: kiosque, text: 'Retour au kiosque' }),
    ]),
  ]);

  /* Le remplissage des jauges est une animation CSS, pas un réglage JS
     après coup : la largeur au repos est donc toujours juste, même si
     l'onglet est en arrière-plan quand le résultat est calculé.        */
  return node;
}

/* --- La carte, en vignette ---------------------------------------------------
   Le bouton « Ma carte de résultat » était le geste principal de l'écran et
   il vivait tout en bas. La carte se dessine maintenant après le rendu,
   sans faire attendre le résultat, et se pose en vignette sous le profil :
   on voit ce qu'on va emporter. Un tap ouvre la grande. Jamais sur une
   borne, où la carte n'a pas de sens. Si le canvas échoue, le bloc reste
   vide et le bouton du bas fait le travail comme avant. */
async function apercuCarte(quiz) {
  if (isKiosque) return;
  const cible = dom.stage.querySelector('.carte');
  if (!cible) return;
  const scores = tally(quiz, state.answers);
  const profile = resolve(quiz, scores);
  if (!profile) return;

  const url = await adresseDuParcours().catch(() => '');
  let canvas;
  try {
    canvas = await renderResultCard(quiz, profile, scores, { identite: identiteEspace, url });
  } catch { return; }
  if (!cible.isConnected) return;

  canvas.className = 'carte__apercu';
  canvas.setAttribute('aria-hidden', 'true');
  cible.replaceChildren(el('button', { class: 'carte__bouton', type: 'button', 'data-act': 'card' }, [
    canvas,
    el('span', { class: 'carte__corps' }, [
      el('span', { class: 'carte__titre', text: 'Votre carte de résultat' }),
      el('span', { class: 'carte__sous', text: 'À enregistrer, ou à partager.' }),
    ]),
    el('span', { class: 'carte__fleche', 'aria-hidden': 'true', text: '→' }),
  ]));
}

/* --- Et après ? -----------------------------------------------------------------
   Le résultat laissait devant « Refaire » et « Retour au kiosque ». Or c'est
   précisément l'instant où l'envie est là : quelqu'un qui vient de recevoir
   trois livres qui lui ressemblent est disposé à en essayer un autre, et on
   lui demandait de retourner chercher lui-même.

   Deux au plus, et jamais le questionnaire qu'on vient de finir. Le catalogue
   est chargé APRÈS l'affichage du résultat : la récompense ne doit pas
   attendre une requête réseau, et si celle-ci échoue il ne manque rien.

   Ni en mode embarqué — on n'emmène pas ailleurs le visiteur du site d'un
   tiers — ni sur une borne, dont le QR code désigne un questionnaire précis
   et qui doit revenir à celui-là. */
async function suite(quiz) {
  if (isEmbed || isKiosque) return;
  const cible = dom.stage.querySelector('.suite');
  if (!cible) return;

  const autres = (await loadAll({ espace }).catch(() => []))
    .filter((q) => q.id !== quiz.id && q.questions?.length)
    .slice(0, 2);
  if (!autres.length || !cible.isConnected) return;

  cible.replaceChildren(
    el('p', { class: 'suite__intro', text: 'Envie d’en essayer un autre ?' }),
    el('div', { class: 'suite__liste' }, autres.map((q) => el('a', {
      class: 'suite__carte',
      href: avecEspace(`quiz.html?q=${encodeURIComponent(q.id)}`, espace),
      style: { '--card-accent': q.accent },
    }, [
      el('span', { class: 'suite__emoji', text: q.emoji || '✦', 'aria-hidden': 'true' }),
      el('span', { class: 'suite__corps' }, [
        el('span', { class: 'suite__nom', text: q.title }),
        q.tagline && el('span', { class: 'suite__accroche', text: q.tagline }),
      ]),
      el('span', { class: 'suite__fleche', text: '→', 'aria-hidden': 'true' }),
    ]))),
  );
}

/* Les réponses qui ont poussé le plus fort vers ce profil, rendues telles
   que le répondant les a choisies.

   Une seule fois, et pas sous chaque recommandation. L'audit proposait une
   ligne d'explication par œuvre ; mais toutes les recommandations d'un
   profil ont exactement la même cause — le profil — et la même phrase
   répétée trois fois de suite cesse d'être une explication pour devenir du
   bruit. Un faisceau d'indices, posé une fois avant la liste, dit la même
   chose et se lit. */
function indicesNode(quiz, profile) {
  const trouve = indices(quiz, state.answers, profile);
  if (!trouve) return null;

  /* « vers » et non « du côté de ». Le nom d'un axe est du texte libre :
     « Le Grand Large », « La Loupe », « Curiosité ». Toute préposition qui
     se contracte devant un article — de, à — produit « du côté de Le Grand
     Large ». « vers » ne se contracte jamais, quel que soit le nom écrit. */
  const titre = trouve.axe
    ? ['Ce qui vous a mené vers ', el('strong', { text: trouve.axe.label })]
    : ['Ce qui a pesé'];

  return el('section', { class: 'indices' }, [
    el('p', { class: 'indices__intro' }, titre),
    el('ul', { class: 'indices__liste' }, trouve.choix.map(({ option, points }) => el('li', {}, [
      el('span', { class: 'indices__reponse', text: option.text }),
      trouve.axe && el('span', {
        class: 'indices__poids',
        style: { '--axis': trouve.axe.color },
        text: `+${points} ${trouve.axe.glyph}`,
      }),
    ]))),
  ]);
}

/* « Vous n'étiez pas loin de… ». Ne s'affiche que si c'est vrai — la
   mesure est dans scoring.js, et elle rend null plutôt que d'inventer une
   quasi-réussite. On donne l'écart en points d'axe : « à 2 ★ près » dit
   quelque chose de concret, là où « vous étiez proche » ne dit rien.

   Deux recommandations au plus : c'est une porte entrouverte, pas un
   second résultat qui viendrait concurrencer le premier.

   Quand plusieurs profils sont à la même distance, on les nomme tous et on
   n'affiche AUCUNE recommandation : en montrer celles d'un seul refarait,
   un cran plus bas, le choix arbitraire que `proximite` vient de cesser de
   faire.                                                                */
function presqueNode(quiz, scores, profile) {
  const proche = proximite(quiz, scores, profile);
  if (!proche) return null;

  const plusieurs = proche.resultats.length > 1;
  const seul = plusieurs ? null : proche.resultats[0];

  const ecart = proche.points === 0
    ? 'à égalité'
    : `à ${proche.points} ${proche.axe ? proche.axe.glyph : 'point'}${!proche.axe && proche.points > 1 ? 's' : ''} près`;

  const intro = !plusieurs ? 'Vous n’étiez pas loin de '
    : proche.points === 0 ? 'Vous étiez à égalité avec '
    : 'Vous étiez à la même distance de ';
  /* « à égale distance de A et B — à égalité » se répéterait. */
  const queue = plusieurs && proche.points === 0 ? '.' : ` — ${ecart}.`;

  const noms = proche.resultats.map((r) => el('strong', { text: `« ${r.title} »` }));
  const liste = noms.flatMap((n, i) => (
    i === 0 ? [n] : [i === noms.length - 1 ? ' et ' : ', ', n]
  ));

  const recos = seul ? seul.recos.filter((r) => r.title.trim()).slice(0, 2) : [];

  return el('section', { class: 'presque' }, [
    el('p', { class: 'presque__intro' }, [intro, ...liste, queue]),
    seul?.subtitle && el('p', { class: 'presque__sous', text: seul.subtitle }),
    recos.length && el('ul', { class: 'presque__recos' }, recos.map((r) => el('li', {}, [
      el('span', { class: 'presque__titre', text: r.title }),
      r.creator && el('span', { class: 'presque__auteur', text: ` — ${r.creator}` }),
      r.location && el('span', { class: 'presque__cote', text: ` · 📍 ${r.location}` }),
    ]))),
  ]);
}

function renderReco(reco, index, retard = 0) {
  const type = RECO_TYPES.find((t) => t.id === reco.type) || RECO_TYPES.at(-1);
  const meta = [reco.creator, reco.year].filter(Boolean).join(' · ');
  const title = reco.link
    ? `<a href="${escapeHtml(reco.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reco.title)} ↗</a>`
    : escapeHtml(reco.title);

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

/* --- Interactions ----------------------------------------------------------- */

/* Le rendez-vous de l'avancée automatique. Au niveau du module : il n'y
   en a jamais qu'un en attente, et toute navigation explicite le périme. */
let attenteAvance = 0;

function onStageClick(event) {
  const trigger = event.target.closest('[data-act]');
  if (!trigger || !dom.stage.contains(trigger)) return;

  switch (trigger.dataset.act) {
    case 'start':   return demarrer();
    case 'resume':  return go(state.reprise);
    case 'restart': return restart();
    case 'back':    return go(state.step - 1);
    case 'next':    return advance();
    case 'share':   return shareQuiz();
    case 'card':    return showCard();
    case 'pick':    return pick(trigger);
    default:        return undefined;
  }
}

function pick(button) {
  const question = state.quiz.questions[state.step];
  if (!question) return;
  const optionId = button.dataset.option;
  const option = question.options.find((o) => o.id === optionId);

  /* Le bouton n'appartient pas à l'écran courant : on l'ignore.
     `render()` passe par `startViewTransition`, qui est ASYNCHRONE. `go()`
     avance `state.step` tout de suite, mais le DOM ne se remplace qu'au
     moment où le navigateur exécute la transition. Entre les deux, les
     boutons de l'écran quittant sont encore là et encore cliquables, alors
     que `state.step` désigne déjà la question suivante.

     Un clic dans cette fenêtre — un répondant rapide, ou les touches 1 à 9
     enchaînées — écrivait l'identifiant de l'ANCIENNE option sous la
     NOUVELLE question. Le comptage l'ignorait, faute de retrouver l'option ;
     mais `advance()`, lui, voyait une réponse non nulle et laissait passer.
     La personne sautait une question sans le savoir, et repartait avec un
     résultat établi sur sept réponses au lieu de huit. */
  if (!option) return;

  const gains = state.quiz.axes
    .map((axe) => ({ axe, points: option.scores[axe.id] || 0 }))
    .filter((g) => g.points > 0);

  vibrer();

  if (question.type === 'multiple') {
    const current = new Set(state.answers[question.id] || []);
    const ajoute = !current.has(optionId);
    ajoute ? current.add(optionId) : current.delete(optionId);
    if (current.size) state.answers[question.id] = [...current];
    else delete state.answers[question.id];
    persist();

    /* Cocher une case n'est pas changer d'écran. Ici passait un `render()`
       complet — donc `startViewTransition`, donc l'écran entier qui glisse de
       26 px et se refond pour un ✓. C'était le geste le plus heurté du
       parcours, et le seul où l'on coche plusieurs fois de suite.

       On met à jour ce qui a changé, et rien d'autre : le bouton, son état
       annoncé, et le libellé de validation qui dépend du nombre de coches. */
    button.classList.toggle('is-picked', ajoute);
    button.setAttribute('aria-pressed', String(ajoute));
    if (ajoute) {
      button.classList.remove('is-confirmed');
      void button.offsetWidth;          /* redémarre l'animation de confirmation */
      button.classList.add('is-confirmed');
    }

    const valider = dom.stage.querySelector('[data-act="next"]');
    if (valider) {
      const dernier = state.step + 1 === state.quiz.questions.length;
      valider.textContent = current.size
        ? (dernier ? 'Voir le résultat' : 'Suivant →')
        : 'Choisissez au moins une réponse';
      if (current.size) valider.removeAttribute('aria-disabled');
      else valider.setAttribute('aria-disabled', 'true');
    }
    updateBar();

    /* Décocher ne fait rien voler : on ne met pas en scène un retrait. */
    if (ajoute) { marquerLeGain(button, gains); envoler(button, gains); }
    else marquerLeGain(button, []);
    return undefined;
  }

  state.answers[question.id] = optionId;
  persist();

  for (const node of dom.stage.querySelectorAll('.option')) {
    node.classList.toggle('is-picked', node === button);
    /* `aria-pressed`, et pas `aria-checked` : ces options sont des boutons
       (views.js explique pourquoi elles ne sont pas un radiogroup), et un
       bouton ne porte pas `aria-checked` — les deux ensemble se
       contredisaient. On repose ici le même attribut que le rendu, pour que
       l'état soit juste avant le repaint des 340 ms. */
    node.setAttribute('aria-pressed', String(node === button));
  }
  button.classList.add('is-confirmed');
  for (const node of dom.stage.querySelectorAll('.option')) marquerLeGain(node, node === button ? gains : []);
  updateBar();
  envoler(button, gains);

  /* Un temps de respiration avant d'enchaîner : assez pour voir le
     compteur bouger, assez court pour que ça reste fluide.

     Le différé est REPRIS, jamais empilé. Changer d'avis pendant ces
     340 ms est le geste le plus normal d'un questionnaire de goût :
     deux clics programmaient deux avancées, la seconde arrivait sur une
     question encore vide, et le parcours reprochait au répondant de
     n'avoir pas répondu — alors qu'il avait répondu deux fois. */
  clearTimeout(attenteAvance);
  attenteAvance = setTimeout(() => advance(), 340);
}

/* Ce que la réponse vient de rapporter, écrit sur elle : « +2 ● ». Les
   points qui volent le montrent en mouvement ; ceci le laisse lisible
   pendant le temps de respiration, et sur un écran qui n'anime pas. */
function marquerLeGain(button, gains) {
  for (const vieux of button.querySelectorAll('.option__gain')) vieux.remove();
  for (const { axe, points } of gains) {
    button.append(el('span', {
      class: 'option__gain', 'aria-hidden': 'true',
      style: { '--axis': axe.color }, text: `+${points} ${axe.glyph}`,
    }));
  }
}

/* Un retour dans la main, là où il existe. Huit millisecondes : un tic,
   pas un bourdonnement. Sans moteur, l'appel ne fait rien. Sans geste de
   la personne — une réponse au clavier synthétisée, un test — le navigateur
   refuse et le dit en erreur dans la console : on ne demande pas. */
function vibrer() {
  if (!navigator.userActivation?.hasBeenActive) return;
  try { navigator.vibrate?.(8); } catch { /* rien à signaler */ }
}

function advance() {
  const question = state.quiz.questions[state.step];
  if (question && state.answers[question.id] == null) {
    /* Un constat, pas une réprimande : le répondant n'a rien fait de mal,
       il manque une réponse. */
    return toast('Il manque une réponse à cette question.', 'danger');
  }
  return go(state.step + 1);
}

function go(step) {
  /* On change d'écran : une avancée encore en attente vise l'écran d'avant
     et n'a plus lieu d'être. */
  clearTimeout(attenteAvance);
  const max = state.quiz.questions.length;
  state.direction = step < state.step ? 'back' : 'forward';
  state.step = Math.max(-1, Math.min(step, max));
  render();
}

/* Un départ compté, pour que le nombre d'arrivées veuille dire quelque
   chose. « Reprendre » n'en est pas un — le départ a déjà été compté au
   parcours précédent ; « Refaire » en est un, puisque l'arrivée sera
   comptée elle aussi. Les deux compteurs doivent recenser les mêmes
   évènements, sans quoi le taux qu'on en tire ne veut rien dire. */
function demarrer() {
  if (espace && !isTest) compterDebut(espace, state.quiz.id);
  return go(0);
}

function restart() {
  state.answers = {};
  state.finished = false;
  state.step = 0;
  state.direction = 'forward';
  store.clearSession(state.quiz.id);
  if (espace && !isTest) compterDebut(espace, state.quiz.id);
  render();
}

/* Une seule fois par visite : répéter l'avertissement à chaque réponse
   serait pire que le silence. Embarqué, on ne dit rien — Safari bloque le
   stockage tiers et Chrome le cloisonne, c'est attendu et documenté. */
let refusSignale = false;

function persist() {
  if (isTest || isKiosque) return;
  const ok = store.saveSession(state.quiz.id, state.answers, state.step);
  if (ok || refusSignale || isEmbed) return;
  refusSignale = true;
  toast('Ce navigateur refuse d’enregistrer : vous ne pourrez pas reprendre ce parcours plus tard.', 'danger');
}

/* --- Mode embarqué -----------------------------------------------------------
   `?embed=1` : le parcours vit dans l'iframe d'un autre site. Deux choses
   changent, deux seulement.

   Les sorties disparaissent. Un « ← Kiosque » dans un cadre de 720 px éjecte
   le visiteur du site qui l'accueille vers le nôtre : c'est le contraire de
   ce qui lui est promis. Le bandeau, lui, reste — il porte la progression et
   le compteur, qui sont le parcours même, pas de la navigation.

   La hauteur est annoncée à la page hôte, qui seule peut redimensionner le
   cadre. Sans cela le parcours défile dans un hublot. Le protocole tient en
   deux messages sans charge utile sensible — une hauteur, une demande de
   remontée — d'où le `*` : nous ne connaissons pas l'origine de l'hôte, et
   il n'y a rien là-dedans qu'on ne puisse crier.

   Rien n'est désactivé par ailleurs. Le stockage tiers est bloqué par Safari
   et cloisonné par Chrome : store.js encaisse le refus sans broncher, la
   reprise de parcours et l'historique cessent simplement d'exister.       */

/* --- Le mode borne -------------------------------------------------------------
   `?kiosque=1` : une tablette posée dans la bibliothèque, que personne ne
   surveille. Le questionnaire ne change pas d'un mot ; ce qui change, c'est
   ce qu'on fait de la trace et de l'attente.

   Trois choses, et trois seulement.

   RIEN NE RESTE. Ni parcours repris, ni historique de résultats : sur un
   poste partagé, ces deux conforts deviennent une fuite — la personne
   suivante lirait ce que la précédente a obtenu. Les compteurs de l'espace,
   eux, continuent : ce sont de vrais répondants, et ils ne disent ni qui ni
   quand.

   L'ÉCRAN SE REND. Après un temps sans geste, le parcours revient à sa
   couverture et oublie les réponses. Sans cela, une borne passe sa journée
   sur le résultat de la première personne du matin.

   ON NE S'ÉCHAPPE PAS. La sortie vers le kiosque disparaît, comme en mode
   embarqué : un usager n'a pas à se retrouver ailleurs, et l'équipe n'a pas
   à retrouver la tablette sur une autre page.

   Rien de tout ceci n'est un réglage à mémoriser : le mode tient dans
   l'adresse, donc dans le QR code qu'on imprime.                          */

/* Le délai se règle dans l'adresse : `?kiosque=1` pour la valeur par défaut,
   `?kiosque=45` pour quarante-cinq secondes. Une salle d'étude silencieuse et
   un hall de passage n'attendent pas pareil, et c'est le genre de réglage
   qu'on veut pouvoir changer en réimprimant un QR code plutôt qu'en
   retouchant du code. Hors bornes raisonnables, on retombe sur la valeur par
   défaut : une borne qui se rend au bout d'une seconde ne servirait
   personne, et une qui attend une heure ne se rend jamais. */
const KIOSQUE_DEFAUT = 90;
const KIOSQUE_MIN = 15;
const KIOSQUE_MAX = 600;

function delaiDeRepos() {
  const demande = Number.parseInt(params.get('kiosque'), 10);
  const valide = Number.isFinite(demande) && demande >= KIOSQUE_MIN && demande <= KIOSQUE_MAX;
  return (valide ? demande : KIOSQUE_DEFAUT) * 1000;
}

const KIOSQUE_REPOS = delaiDeRepos();
let kiosqueMinuteur = 0;

function wireKiosque() {
  document.documentElement.classList.add('is-kiosque');
  dom.exit.remove();

  /* On écoute en phase de CAPTURE, sur le document : un geste avalé plus
     bas — le balayage qui annule son propre clic, par exemple — reste un
     signe de vie et doit repousser l'échéance.

     `click` et `focusin` ne font pas doublon avec les événements de
     pointeur, et les oublier a un coût précis : une commande vocale, un
     contacteur ou certaines activations de lecteur d'écran produisent un
     clic SANS `pointerdown`. Sans ces deux-là, ces personnes-là — et elles
     seules — se faisaient renvoyer à la couverture en pleine réponse. */
  for (const geste of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'click', 'focusin']) {
    document.addEventListener(geste, repousserRepos, { capture: true, passive: true });
  }
  repousserRepos();
}

function repousserRepos() {
  clearTimeout(kiosqueMinuteur);
  kiosqueMinuteur = setTimeout(rendreLEcran, KIOSQUE_REPOS);
}

/* Déjà sur la couverture et rien de commencé : il n'y a rien à rendre, et
   remettre la vue à zéro toutes les 90 secondes ferait clignoter une borne
   que personne ne regarde. */
function rendreLEcran() {
  if (state.step < 0 && !Object.keys(state.answers).length) return repousserRepos();
  state.answers = {};
  state.finished = false;
  state.step = -1;
  state.direction = 'back';
  store.clearSession(state.quiz.id);
  render();
  return repousserRepos();
}

const EMBED_TARGET = '*';
let firstPaint = true;
let lastHeight = 0;

function wireEmbed() {
  document.documentElement.classList.add('is-embed');
  dom.exit.remove();
  /* L'observateur est un supplément, jamais le socle : il ne rattrape que
     ce que personne n'a annoncé — l'hôte qui change de largeur, une police
     qui se substitue. Il ne peut pas porter la mesure à lui seul, car ses
     rappels sont livrés à l'étape de peinture, et un cadre hors écran ne
     peint pas. Même raison que le `requestAnimationFrame` proscrit
     (ARCHITECTURE.md) : la valeur au repos doit être juste sans lui.   */
  new ResizeObserver(postHeight).observe(document.body);
  postHeight();
}

/* Appelé à chaque rendu, sur le champ : la vue vient de changer en entier,
   et `getBoundingClientRect` force le calcul de mise en page — la hauteur
   est donc juste tout de suite, sans attendre une peinture. Les images,
   elles, arrivent après ; chacune rallonge la page, et chacune le dira. */
function measureEmbed() {
  postHeight();
  for (const image of dom.stage.querySelectorAll('img')) {
    if (!image.complete) image.addEventListener('load', postHeight, { once: true });
  }
}

function postHeight() {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height === lastHeight) return;
  lastHeight = height;
  window.parent.postMessage({ type: 'recohero:height', height }, EMBED_TARGET);
}

/* Un questionnaire qui vit sur un serveur ou dans le dépôt se partage par son
   adresse : elle reste courte, et elle suit les corrections. Un brouillon
   local n'existe nulle part ailleurs : il voyage entier, dans son lien. */
async function adresseDuParcours() {
  const addressable = state.quiz.source === 'published' || state.quiz.source === 'remote';
  return addressable
    ? new URL(avecEspace(`quiz.html?q=${encodeURIComponent(state.quiz.id)}`, espace), location.href).toString()
    : linkFor(state.quiz);
}

async function shareQuiz() {
  const url = await adresseDuParcours();
  return menuPartage({ url, titre: state.quiz.title });
}

/* --- Le partage --------------------------------------------------------------
   `navigator.share` est la bonne porte quand elle existe : elle ouvre la
   feuille du système, qui connaît les applications réellement installées et
   gère SMS, messageries et réseaux sans que nous ayons à les nommer. Elle
   n'existe pas sur la plupart des navigateurs de bureau — et c'est là qu'on
   partage un lien à ses collègues.

   D'où les deux étages : la feuille du système en premier quand elle est là,
   et des destinations nommées en dessous. On ne liste que ce qui s'ouvre par
   une simple adresse : pas de script tiers, pas de bouton officiel, rien qui
   pisterait le répondant. Un lien reste un lien.                          */
const DESTINATIONS = [
  { id: 'whatsapp', label: 'WhatsApp', emoji: '💬',
    lien: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}` },
  { id: 'sms', label: 'SMS', emoji: '✉️',
    lien: (u, t) => `sms:?&body=${encodeURIComponent(`${t} ${u}`)}` },
  { id: 'mail', label: 'Courriel', emoji: '📧',
    lien: (u, t) => `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(`${t}\n\n${u}`)}` },
  { id: 'facebook', label: 'Facebook', emoji: '🔵',
    lien: (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  { id: 'x', label: 'X', emoji: '✖️',
    lien: (u, t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}` },
  { id: 'bluesky', label: 'Bluesky', emoji: '🦋',
    lien: (u, t) => `https://bsky.app/intent/compose?text=${encodeURIComponent(`${t} ${u}`)}` },
];

/* Un lien qui PORTE le questionnaire au lieu de le désigner : le contenu
   entier, gzippé, dans le fragment. Près de quatre mille caractères là où une
   adresse servie en fait soixante.

   On ne peut pas le raccourcir — il n'y a pas de serveur pour ranger une
   correspondance entre un code court et un contenu, et c'est le prix assumé
   de la promesse « un questionnaire tient dans une URL ». Mais on peut cesser
   de le proposer aux canaux qui le maltraitent : un SMS s'arrête à cent
   soixante caractères, les réseaux tronquent, et un mur de caractères
   aléatoires dans une conversation ne se lit pas comme un lien de médiathèque
   — il se lit comme une tentative d'hameçonnage, et personne ne l'ouvre.

   Restent les deux voies qui transportent une longue adresse sans la
   toucher : le presse-papier et le courriel. */
const estUnLienPorteur = (url) => url.includes('#k=');

function menuPartage({ url, titre, fichier = null }) {
  const porteur = estUnLienPorteur(url);
  const destinations = porteur
    ? DESTINATIONS.filter((d) => d.id === 'mail')
    : DESTINATIONS;

  const dialog = el('dialog', { class: 'modal partage' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Partager' }),

      porteur
        ? el('p', { class: 'partage__note', text:
            `Ce questionnaire n’est publié nulle part : son lien l’emporte en entier, d’où ses ${url.length} caractères. Les messageries et les réseaux le couperaient — il se copie, ou s’envoie par courriel.` })
        : el('p', { class: 'partage__url', text: url.replace(/^https?:\/\//, '') }),

      navigator.share && el('button', {
        class: 'btn btn--primary btn--block', type: 'button', 'data-partage': 'systeme',
        text: '⤴ Partager…',
      }),

      el('div', { class: 'partage__grille' }, destinations.map((d) => el('a', {
        class: 'partage__cible', href: d.lien(url, titre),
        target: '_blank', rel: 'noopener noreferrer',
      }, [
        el('span', { class: 'partage__emoji', 'aria-hidden': 'true', text: d.emoji }),
        el('span', { text: d.label }),
      ]))),

      el('button', {
        class: 'btn btn--ghost btn--block', type: 'button', 'data-partage': 'copier',
        text: '⧉ Copier le lien',
      }),
    ]),
    el('div', { class: 'modal__actions' }, [
      el('span', { class: 'section__spacer' }),
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-partage': 'fermer', text: 'Fermer' }),
    ]),
  ]);

  dialog.addEventListener('click', async (event) => {
    /* Un lien de destination n'est pas une action : on le laisse s'ouvrir et
       on referme derrière lui. */
    if (event.target.closest('.partage__cible')) { dialog.close(); return; }
    const action = event.target.closest('[data-partage]')?.dataset.partage;
    if (!action) return;
    if (action === 'systeme') {
      try {
        await navigator.share(fichier && navigator.canShare?.({ files: [fichier] })
          ? { files: [fichier], title: titre, text: titre }
          : { title: titre, url });
      } catch { /* partage annulé : rien à signaler */ }
      return;
    }
    if (action === 'copier') {
      const ok = await copy(url);
      toast(ok ? 'Lien copié.' : 'Copie impossible.', ok ? '' : 'danger');
    }
    dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* La carte de résultat : on la montre avant de l'enregistrer. Sur mobile
   le partage natif prend le relais quand il accepte des fichiers ; sinon
   on retombe sur un téléchargement, qui marche partout.                */
async function showCard() {
  const scores = tally(state.quiz, state.answers);
  const profile = resolve(state.quiz, scores);
  if (!profile) return;

  let canvas;
  let blob;
  const url = await adresseDuParcours().catch(() => '');
  try {
    canvas = await renderResultCard(state.quiz, profile, scores, { identite: identiteEspace, url });
    blob = await toBlob(canvas);
  } catch (err) {
    return toast(`Carte impossible à produire : ${err.message}`, 'danger');
  }

  const filename = `recohero-${slugify(profile.title, 'resultat')}.png`;
  const file = new File([blob], filename, { type: 'image/png' });

  canvas.className = 'cardview__canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Carte de résultat : ${profile.title}`);

  const dialog = el('dialog', { class: 'modal cardview' }, [
    el('div', { class: 'modal__body' }, [canvas]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-card': 'close', text: 'Fermer' }),
      el('button', { class: 'btn btn--ghost', type: 'button', 'data-card': 'send', text: '⤴ Partager' }),
      el('button', { class: 'btn btn--primary', type: 'button', 'data-card': 'save', text: '↓ Enregistrer' }),
    ]),
  ]);

  dialog.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-card]')?.dataset.card;
    if (!action) return;
    if (action === 'save') {
      downloadBlob(filename, blob);
      toast('Carte enregistrée.');
    }
    if (action === 'send') {
      /* Même menu que pour le questionnaire : la feuille du système quand elle
         existe — c'est la seule qui sait envoyer l'IMAGE — et les destinations
         nommées en dessous, qui ne portent que le lien. */
      dialog.close();
      menuPartage({ url, titre: `${profile.title} — ${state.quiz.title}`, fichier: file });
      return;
    }
    dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* Le balayage : réservé au tactile. À la souris, un glissement horizontal
   veut dire « sélectionner du texte », et le détourner serait hostile.  */
function wireSwipe() {
  let start = null;

  dom.stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    start = { x: event.clientX, y: event.clientY, at: Date.now() };
  });

  dom.stage.addEventListener('pointerup', (event) => {
    if (!start || event.pointerType === 'mouse') return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = Date.now() - start.at;
    start = null;

    /* Trois conditions : assez loin, assez horizontal, et pas interminable.
       C'est le RAPPORT dx/dy qui fait le gros du tri — sans lui, un
       défilement du pouce un peu oblique changerait de question. La durée
       n'écarte que le glissement lent et hésitant ; 900 ms laisse la place
       à un geste posé, ce que 700 refusait déjà à certains. */
    if (elapsed > 900 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return;

    /* Le geste va produire un `click` sur la réponse survolée : on
       l'avale, sinon balayer depuis une réponse la sélectionnerait. */
    const swallow = (click) => { click.stopPropagation(); click.preventDefault(); };
    dom.stage.addEventListener('click', swallow, { capture: true });
    setTimeout(() => dom.stage.removeEventListener('click', swallow, { capture: true }), 120);

    if (state.step < 0) return;
    if (dx < 0) advance();
    else go(state.step - 1);
  });

  dom.stage.addEventListener('pointercancel', () => { start = null; });
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
