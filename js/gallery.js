/* ==========================================================================
   gallery.js — le kiosque. Liste ce qui est jouable, et ce qui a été joué.
   ========================================================================== */

import { loadAll } from './core/catalog.js';
import * as store from './core/store.js';
import { identite as chargerIdentite, presentation as chargerPresentation } from './core/remote.js';
import { normaliserIdentite, normaliserPresentation, grouperLaVitrine } from './core/schema.js';
import { el, formatDate, toast, espaceCourant, avecEspace, garderEspace, applyAccent } from './core/ui.js';

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
  /* L'identité d'abord : elle habille la page avant que la liste
     n'arrive, pour qu'on ne voie pas notre marque céder la place à celle
     de la structure. Un espace sans identité garde la nôtre. */
  if (espace) habiller(normaliserIdentite(await chargerIdentite(espace)));
  const presentation = espace ? normaliserPresentation(await chargerPresentation(espace)) : null;
  renderQuizzes(await loadAll({ espace }), presentation);
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

/* --- L'identité de l'espace ---------------------------------------------------
   Le kiosque d'une médiathèque affichait notre marque, notre accroche et
   notre pied de page : une structure publique qui diffusait ce lien à ses
   usagers diffusait notre identité, pas la sienne.

   Ce que la structure ne remplit pas reste à nous. C'est le bon repli —
   une page anonyme serait pire que la marque d'un outil assumé.        */

function habiller(id) {
  if (!id) return;
  const pose = (elementId, valeur) => {
    const noeud = document.getElementById(elementId);
    if (noeud && valeur) noeud.textContent = valeur;
  };

  document.title = `${id.titre} — questionnaires`;
  if (id.accent) applyAccent(id.accent);

  pose('marqueNom', id.titre);
  pose('marqueAccroche', id.accroche);

  /* Le logo remplace le signe, il ne s'ajoute pas : deux marques côte à
     côte ne feraient qu'une confusion. */
  const signe = document.getElementById('marqueSigne');
  if (signe && id.logo) {
    signe.replaceChildren(el('img', { class: 'brand__logo', src: id.logo, alt: '' }));
  }

  /* La barre du haut appartient au visiteur : on y met la sortie vers le
     site de la structure. Le backoffice, qui ne le concerne pas, se
     replie dans le pied de page — l'équipe le trouve par son adresse, et
     elle l'a. */
  const sortie = document.getElementById('sortieHaut');
  if (sortie && id.retour) {
    sortie.replaceChildren(el('a', {
      class: 'btn btn--ghost btn--sm', href: id.retour.url,
      rel: 'noopener', title: id.retour.libelle, 'aria-label': id.retour.libelle,
      text: `${id.retour.libelle} ↗`,
    }));
  }

  /* Le bandeau dit qui ; le titre dit pourquoi. Sans accroche, le titre
     reprend le nom plutôt que de laisser le nôtre. */
  const titre = document.getElementById('heroTitre');
  if (titre) titre.textContent = id.accroche || id.titre;

  const intro = document.getElementById('heroIntro');
  if (intro && id.intro) {
    intro.textContent = id.intro;
    intro.hidden = false;
  }

  pose('piedTexte', id.pied);
  const lienPied = document.getElementById('piedLien');
  if (lienPied) lienPied.textContent = 'Backoffice';
}

/* L'ordre voulu par l'équipe, puis l'alphabet pour le reste. Un
   identifiant absent de `ordre` n'est pas une erreur : c'est un
   questionnaire publié sans qu'on ait pensé au rangement, et il se range
   après ceux qu'on a rangés. */
function ranger(quizzes, presentation) {
  if (!presentation) return null;
  const visibles = quizzes.filter((q) => !presentation.masques.has(q.id));
  const rang = new Map(presentation.ordre.map((id, i) => [id, i]));
  return visibles.sort((a, b) => {
    const ra = rang.has(a.id) ? rang.get(a.id) : Infinity;
    const rb = rang.has(b.id) ? rang.get(b.id) : Infinity;
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title, 'fr');
  });
}

function renderQuizzes(quizzes, presentation = null) {
  const ranges = ranger(quizzes, presentation);
  if (ranges) quizzes = ranges;

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

  /* Dans un espace rangé, l'ordre est celui de l'équipe. Ailleurs, les
     brouillons d'abord puis l'alphabet, comme depuis toujours. */
  const sorted = ranges || [...quizzes].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'draft' ? -1 : 1;
    return a.title.localeCompare(b.title, 'fr');
  });

  const alaune = presentation?.epingle;
  const groupes = grouperLaVitrine(sorted, presentation);

  /* Douze au plus : au-delà, la cascade devient une attente. Le retard se
     compte sur la vitrine entière et non par groupe, sinon chaque section
     repartirait de zéro et les dernières arriveraient avant les premières. */
  let rang = 0;
  const vignette = (quiz) => {
    const noeud = card(quiz, quiz.id === alaune, Math.min(rang, 12) * 45);
    rang += 1;
    return noeud;
  };

  /* Un seul groupe sans titre : on garde la grille nue d'avant, sans
     enrobage inutile. */
  if (groupes.length === 1 && !groupes[0].titre) {
    dom.grid.replaceChildren(...groupes[0].quizzes.map(vignette));
    dom.grid.classList.remove('quiz-grid--sections');
    return;
  }

  dom.grid.classList.add('quiz-grid--sections');
  dom.grid.replaceChildren(...groupes.map((groupe) => el('div', { class: 'vitrine__groupe' }, [
    groupe.titre && el('h3', { class: 'vitrine__titre', text: groupe.titre }),
    el('div', { class: 'quiz-grid' }, groupe.quizzes.map(vignette)),
  ])));
}

function card(quiz, alaune = false, retard = 0) {
  const questions = quiz.questions.length;
  return el('a', {
    class: 'quiz-card' + (alaune ? ' quiz-card--une' : ''),
    href: avecEspace(`quiz.html?q=${encodeURIComponent(quiz.id)}`),
    style: { '--card-accent': quiz.accent, animationDelay: `${retard}ms` },
  }, [
    /* Le signet : décoratif, donc masqué à la synthèse vocale. */
    el('span', { class: 'quiz-card__signet', 'aria-hidden': 'true' }),
    alaune && el('span', { class: 'quiz-card__une', text: 'À la une' }),
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
