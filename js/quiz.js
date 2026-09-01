/* ==========================================================================
   quiz.js — le parcours du répondant.
   Une seule vue à l'écran, un seul état en mémoire, un seul point de
   rendu. La délégation d'évènements est posée une fois sur la scène :
   aucun gestionnaire en ligne dans le HTML.
   ========================================================================== */

import { resolveQuiz } from './core/catalog.js';
import { vitrines as chargerVitrines, compterParcours, compterDebut } from './core/remote.js';
import { tally, resolve, proximite, indices } from './core/scoring.js';
import { RECO_TYPES, slugify, dureeEstimee } from './core/schema.js';
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

/* Le kiosque d'origine, celui du dépôt ou celui d'un espace : toute sortie
   doit y revenir, sinon le visiteur d'une médiathèque atterrit chez nous. */
const kiosque = avecEspace('index.html', espace);

/* En mode test, la sortie ramène à l'éditeur d'où l'on vient — et à SON
   espace. Le libellé disait « Retour au backoffice » depuis toujours ;
   l'adresse, elle, menait au kiosque. */
const sortie = isTest ? avecEspace('admin.html', espace) : kiosque;

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
    if (saved && !isTest && !isKiosque) state.answers = saved.answers || {};

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
}

let derniersScores = null;

function updateBar() {
  const { quiz, step } = state;
  const answered = Object.keys(state.answers).length;
  const ratio = state.step >= quiz.questions.length
    ? 1
    : Math.min(answered, quiz.questions.length) / quiz.questions.length;
  dom.progress.style.width = `${Math.round(ratio * 100)}%`;

  const scores = tally(quiz, state.answers);
  /* Huit au plus, comme la carte de résultat — et resserrés au-delà de six.
     Le bandeau est collant : ce qu'il prend, le parcours ne l'a plus. */
  const montres = quiz.axes.slice(0, 8);
  dom.tally.classList.toggle('is-dense', montres.length > 6);

  /* Le compteur est une région vivante : le reconstruire à chaque rendu
     le ferait relire à chaque changement d'écran, alors que rien n'a
     changé. On ne le refait que quand les nombres bougent. */
  const empreinte = montres.map((a) => scores.counts[a.id]).join('·') + '|' + scores.leaders.join(',');
  if (empreinte !== derniersScores) {
    derniersScores = empreinte;
    dom.tally.replaceChildren(...montres.map((axis) => el(
    'span',
    { /* Qui mène, pendant qu'on joue. La course est le sujet du
         questionnaire ; jusqu'ici elle ne se lisait qu'à l'arrivée. */
      class: 'tally__axis' + (scores.leaders.includes(axis.id) && scores.best > 0 ? ' is-lead' : ''),
      style: { '--axis': axis.color }, title: axis.label, 'data-axis': axis.id },
    [
      el('span', { class: 'tally__glyph', text: axis.glyph }),
      el('span', { class: 'tally__count', text: String(scores.counts[axis.id]) }),
    ],
    )));
  }
  dom.tally.hidden = step < 0;
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
  if (index === 0) {
    view.append(el('p', { class: 'astuce' }, [
      el('span', { class: 'astuce__clavier', text: 'Touches 1 à 9 pour répondre, ← → pour naviguer' }),
      el('span', { class: 'astuce__tactile', text: 'Balayez pour passer d’une question à l’autre' }),
    ]));
  }

  view.append(el('div', { class: 'navrow' }, [
    el('button', { class: 'btn btn--quiet', type: 'button', 'data-act': 'back', text: '← Précédent' }),
    el('span', { class: 'navrow__spacer' }),
    (multiple || chosen.size) && el('button', {
      class: 'btn btn--primary', type: 'button', 'data-act': 'next',
      text: index + 1 === quiz.questions.length ? 'Voir le résultat' : 'Suivant →',
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

  const recosNode = el('section', { class: 'recos' }, [
    el('div', { class: 'recos__head' }, [
      el('h2', { text: 'À lire, voir, écouter' }),
      el('span', { class: 'pill pill--accent', text: `${profile.recos.length} reco${profile.recos.length > 1 ? 's' : ''}` }),
    ]),
    /* Les recos entrent APRÈS la feuille de score : le résultat se lit
       dans l'ordre où il a été établi — voilà ce que vous avez récolté,
       voilà donc ce qu'on vous propose. */
    el('div', { class: 'recos__list' },
      profile.recos.map((reco, i) => renderReco(reco, i, quiz.axes.length * 55 + 90))),
  ]);

  const node = el('section', { class: 'result' }, [
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
       questionnaire rend inatteignable. Le plafond théorique d'un axe
       suppose qu'on ait répondu dans sa direction à chaque question —
       ce que personne ne fait : sur le questionnaire d'exemple, l'axe
       GAGNANT se remplissait à 54 % en moyenne, et aucun parcours sur
       34 992 n'atteignait 100 %. Le résultat, moment de récompense,
       montrait donc des barres à moitié vides et un « /16 » qui annonçait
       un objectif hors d'atteinte. On rapporte désormais au plus haut
       score obtenu : l'axe qui mène remplit sa barre, les autres se
       situent par rapport à lui. */
    el('div', { class: 'scores' }, (() => {
      const sommet = Math.max(1, ...quiz.axes.map((a) => scores.counts[a.id] || 0));
      return quiz.axes.map((axis, rang) => {
        const value = scores.counts[axis.id];
        return el('div', {
          class: 'score' + (scores.leaders.includes(axis.id) ? ' is-lead' : ''),
          style: { '--axis': axis.color, animationDelay: `${rang * 55}ms` },
        }, [
          el('span', { class: 'score__label' }, [
            el('span', { class: 'glyph', text: axis.glyph }), axis.label,
          ]),
          el('div', { class: 'score__track' }, [
            el('div', {
              class: 'score__fill',
              style: { width: `${Math.round(Math.min(1, Math.max(0, value) / sommet) * 100)}%` },
            }),
          ]),
          el('span', { class: 'score__value', text: String(value) }),
        ]);
      });
    })()),

    /* Ce qui a pesé, entre la récolte et la prescription : le résultat se
       lit alors dans l'ordre où il s'est établi — voilà ce que vous avez
       récolté, voilà ce qui l'a fait pencher, voilà donc ce qu'on vous
       propose. */
    indicesNode(quiz, profile),

    profile.recos.length ? recosNode : null,

    presqueNode(quiz, scores, profile),

    el('div', { class: 'result__actions' }, [
      el('button', { class: 'btn btn--primary', type: 'button', 'data-act': 'card', text: '🖼 Ma carte de résultat' }),
      el('button', { class: 'btn btn--ghost', type: 'button', 'data-act': 'share', text: '⤴ Partager ce questionnaire' }),
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-act': 'restart', text: '↺ Refaire' }),
      !isEmbed && el('a', { class: 'btn btn--quiet', href: kiosque, text: 'Retour au kiosque' }),
    ]),
  ]);

  /* Le remplissage des jauges est une animation CSS, pas un réglage JS
     après coup : la largeur au repos est donc toujours juste, même si
     l'onglet est en arrière-plan quand le résultat est calculé.        */
  return node;
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
   second résultat qui viendrait concurrencer le premier.               */
function presqueNode(quiz, scores, profile) {
  const proche = proximite(quiz, scores, profile);
  if (!proche) return null;

  const ecart = proche.points === 0
    ? 'à égalité'
    : `à ${proche.points} ${proche.axe ? proche.axe.glyph : 'point'}${!proche.axe && proche.points > 1 ? 's' : ''} près`;

  const recos = proche.resultat.recos.filter((r) => r.title.trim()).slice(0, 2);

  return el('section', { class: 'presque' }, [
    el('p', { class: 'presque__intro' }, [
      'Vous n’étiez pas loin de ',
      el('strong', { text: `« ${proche.resultat.title} »` }),
      ` — ${ecart}.`,
    ]),
    proche.resultat.subtitle && el('p', { class: 'presque__sous', text: proche.resultat.subtitle }),
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
    case 'resume':  return go(0);
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

  if (question.type === 'multiple') {
    const current = new Set(state.answers[question.id] || []);
    const ajoute = !current.has(optionId);
    ajoute ? current.add(optionId) : current.delete(optionId);
    if (current.size) state.answers[question.id] = [...current];
    else delete state.answers[question.id];
    persist();
    render();
    /* Cocher fait voler les points ; décocher ne fait rien voler — on ne
       met pas en scène un retrait. Le rendu a lieu avant, pour que le
       bouton visé et le compteur soient à leur place définitive. */
    if (ajoute) {
      const revenu = dom.stage.querySelector(`[data-option="${CSS.escape(optionId)}"]`);
      if (revenu) envoler(revenu, gains);
    }
    return undefined;
  }

  state.answers[question.id] = optionId;
  persist();

  for (const node of dom.stage.querySelectorAll('.option')) {
    node.classList.toggle('is-picked', node === button);
    node.setAttribute('aria-checked', String(node === button));
  }
  button.classList.add('is-confirmed');
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
  const ok = store.saveSession(state.quiz.id, state.answers);
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

async function shareQuiz() {
  /* Un questionnaire qui vit sur un serveur ou dans le dépôt se partage
     par son adresse : elle reste courte, et elle suit les corrections.
     Un brouillon local n'existe nulle part ailleurs : il voyage entier. */
  const addressable = state.quiz.source === 'published' || state.quiz.source === 'remote';
  const url = addressable
    ? new URL(avecEspace(`quiz.html?q=${encodeURIComponent(state.quiz.id)}`, espace), location.href).toString()
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

/* La carte de résultat : on la montre avant de l'enregistrer. Sur mobile
   le partage natif prend le relais quand il accepte des fichiers ; sinon
   on retombe sur un téléchargement, qui marche partout.                */
async function showCard() {
  const scores = tally(state.quiz, state.answers);
  const profile = resolve(state.quiz, scores);
  if (!profile) return;

  let canvas;
  let blob;
  try {
    canvas = await renderResultCard(state.quiz, profile, scores);
    blob = await toBlob(canvas);
  } catch (err) {
    return toast(`Carte impossible à produire : ${err.message}`, 'danger');
  }

  const filename = `recohero-${slugify(profile.title, 'resultat')}.png`;
  const file = new File([blob], filename, { type: 'image/png' });
  const canShareFile = Boolean(navigator.canShare?.({ files: [file] }));

  canvas.className = 'cardview__canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Carte de résultat : ${profile.title}`);

  const dialog = el('dialog', { class: 'modal cardview' }, [
    el('div', { class: 'modal__body' }, [canvas]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-card': 'close', text: 'Fermer' }),
      canShareFile && el('button', { class: 'btn btn--ghost', type: 'button', 'data-card': 'send', text: '⤴ Partager' }),
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
      try {
        await navigator.share({ files: [file], title: profile.title, text: state.quiz.title });
      } catch { /* partage annulé : rien à signaler */ }
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
