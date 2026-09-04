/* ==========================================================================
   admin/app.js — le backoffice : état, câblage, sauvegarde.
   Un seul état en mémoire, un seul point de rendu par zone (rail, panneau,
   diagnostic). Toute interaction passe par la délégation sur data-act ou
   par un data-bind : aucun gestionnaire en ligne dans le HTML.
   ========================================================================== */

import { PANELS, NIVEAUX, diagCarte, poidsHorsEchelle, PETIT_ECHANTILLON } from './panels.js';
import {
  makeQuiz, makeAxis, makeQuestion, makeOption, makeResult, makeReco,
  normalize, diagnose, uid, slugify, safeImage, imageWeight, RECO_TYPES,
  normaliserIdentite, normaliserPresentation, presentationPourLaBase, normaliserVitrine,
} from '../core/schema.js';
import { GLYPHES, EMOJIS, chercher } from '../core/symboles.js';
import { reachability } from '../core/scoring.js';
import { bindSortables } from '../core/sortable.js';
import { questionView, coverView, bannerView, recoView } from '../core/views.js';
import { loadPublished, loadEspace, forgetEspace } from '../core/catalog.js';
import * as remote from '../core/remote.js';
import * as store from '../core/store.js';
import { linkFor, encode } from '../core/share.js';
import { toBlob } from '../core/card.js';
import {
  el, toast, copy, download, downloadBlob, applyAccent, debounce, formatDate,
  imageFromFile, formatBytes, IMAGE_LIMITS, espaceCourant, avecEspace, garderEspace,
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
  gerants: new Set(),   /* ceux que la console protège : ni retirables, ni orphelins */
  membre: null,         /* suis-je de l'équipe ? null = pas encore su */
  invitations: {},      /* adresses conviées, en attente d'être réclamées */
  demandes: {},         /* comptes qui demandent à entrer, en attente d'un avis */
  monEntree: null,      /* { invitation, demande, verifie } quand je ne suis pas membre */
  profils: {},          /* leurs profils, lisibles de l'équipe seule */
  vitrines: {},         /* ce que chacun a choisi de rendre public */
  identite: null,       /* l'apparence publique du kiosque de l'espace */
  corbeille: [],        /* ce qu'on en a retiré, et qu'on peut reprendre */
  presentation: normaliserPresentation(null),   /* l'ordre du kiosque, et ce qu'on en masque */
  stats: {},            /* parcours terminés, par questionnaire et par profil */
  remote: [],           /* les questionnaires de cet espace */
  remoteSession: null,  /* { email, uid } une fois connecté */
  profilPropose: false, /* la proposition de se nommer a déjà été faite, cette fois-ci */
  /* --- Deux niveaux de navigation ------------------------------------------
     Le backoffice n'avait qu'un écran : l'éditeur de questionnaire. Tout ce
     qui relève de l'espace — vitrine, corbeille, identité, fréquentation,
     équipe — vivait dans des dialogues ouverts depuis un bouton du rail. Or
     un dialogue est par construction une parenthèse dans ce qu'on faisait :
     l'espace était donc présenté comme une interruption de l'édition. Il
     avait un bouton, pas un lieu.

     Désormais `espace` est le niveau d'accueil, et `quiz` ce dans quoi on
     entre depuis lui. On travaille DANS un espace, où l'on fait des
     questionnaires — et non sur un questionnaire flanqué de réglages.

     Sans espace partagé, on n'échappe pas au modèle : c'est « Cet
     ordinateur », un espace comme un autre avec moins d'onglets. Le mode
     hors ligne cesse d'être un cas particulier du code pour devenir un cas
     du modèle. */
  vue: 'espace',        /* 'espace' | 'quiz' */
  ongletEspace: 'questionnaires',
  panel: 'identite',
  reach: null,
  expanded: new Set(),  /* réponses dont le champ image est déplié */
  folded: new Set(),    /* cartes repliées : questions et profils */
  focused: null,        /* question sous le curseur, pour l'aperçu */
  previewOpen: true,
  /* Les pesées se posent en mots par défaut. Le mode au point près reste à
     un clic, et devient le seul disponible sur un questionnaire dont les
     valeurs sortent de l'échelle simple. */
  poidsFins: false,
};

const dom = {};

boot();

async function boot() {
  for (const id of ['gate', 'gateForm', 'gatePass', 'shell', 'rail', 'panel',
                    'quizName', 'saveStatus', 'topActions', 'tabbar',
                    'apercu', 'apercuScene', 'apercuLegende', 'apercuBascule']) {
    dom[id] = document.getElementById(id);
  }
  state.espace = espaceCourant();
  /* La marque du bandeau ramène au kiosque : à celui de l'espace quand on
     y travaille, sinon on quitte l'environnement sans s'en apercevoir. */
  garderEspace();

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
  const erreur = el('p', { class: 'alerte', role: 'alert', hidden: true });
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
  /* On charge le dernier brouillon pour l'avoir sous la main, mais on
     n'ouvre pas son écran : on arrive dans l'espace. Voir d'abord la maison,
     entrer dans un questionnaire ensuite — sans quoi la vitrine, la
     fréquentation et les demandes d'accès restent des choses qu'il faut
     penser à aller chercher. `select()` bascule au niveau du document, on
     revient donc explicitement au niveau du dessus. */
  const drafts = store.allDrafts();
  if (drafts.length) select(drafts[0].id);
  state.vue = 'espace';

  /* Tout ce qui décrit l'espace — l'équipe, les profils, les vitrines, les
     compteurs, l'identité du kiosque, la corbeille — n'était chargé qu'en
     RÉACTION : après une connexion, une invitation, une publication. Qui
     revenait avec une session encore valide ouvrait donc un backoffice où
     l'équipe était vide, l'identité paraissait absente et la corbeille
     comptait zéro. Rien ne le disait, et tout redevenait juste au premier
     geste — ce qui rendait le défaut d'autant plus difficile à voir. */
  if (state.espace && state.remoteSession) await refreshEspace();

  renderRail();
  renderPanel();
  renderTopbar();

  dom.shell.addEventListener('click', onClick);
  dom.shell.addEventListener('input', onInput);
  dom.shell.addEventListener('change', onChange);
  /* La délégation est posée sur des éléments précis, pas sur le document :
     un bouton ajouté dans le bandeau à côté du fil d'Ariane — le retour vers
     l'espace — tombait donc hors de toute écoute. Visible, et inerte.

     Une seule écoute, sur la ligne entière du bandeau : les onglets et les
     actions sont DEDANS, et les écouter en plus faisait répondre deux fois à
     chaque clic. Deux « Mon compte » s'ouvraient l'un sur l'autre, et celui
     du dessous restait derrière la fenêtre choisie dans celui du dessus. */
  dom.quizName.parentElement?.addEventListener('click', onClick);
  window.addEventListener('beforeunload', flush);
  dom.shell.addEventListener('focusin', (event) => {
    const bind = event.target.closest('[data-bind]')?.dataset.bind
      || (event.target.closest('[data-act="pesee"]') && `score:${event.target.closest('[data-act="pesee"]').dataset.id.replaceAll('|', ':')}`)
      || '';
    /* Que le curseur soit dans l'énoncé, dans une réponse ou dans une
       pesée, l'identifiant retenu est celui de la question qui les porte ;
       dans un titre, une règle ou une reco, celui du profil. C'est lui
       qu'on veut au téléphone. */
    const id = /^(?:question|option|score|result|rule|reco):([^:|]+)/.exec(bind)?.[1];
    if (!id || id === state.focused) return;
    state.focused = id;
    paintPreview();
  });
  /* La pesée au clavier : ← → et ↑ ↓ montent et descendent d'un cran. */
  dom.shell.addEventListener('keydown', (event) => {
    const bouton = event.target.closest?.('[data-act="pesee"]');
    if (!bouton) return;
    const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const [qId, oId, aId] = bouton.dataset.id.split('|');
    reglerPesee(bouton, qId, oId, aId, Number(bouton.dataset.niveau) + delta);
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

  proposerMonProfil();
}

/* --- Rendu ------------------------------------------------------------------ */

function renderTopbar() {
  /* Le compte n'appartient pas au questionnaire ouvert : sa place est
     dans la barre, pas dans un panneau d'édition. Hors espace il n'y a pas
     de compte — le verrou tient ce rôle. */
  const compte = dom.topActions.querySelector('[data-act="compte"]');
  if (state.espace && state.remoteSession) {
    const p = state.profils?.[state.remoteSession.uid];
    const nom = (p && [p.prenom, p.nom].filter(Boolean).join(' ')) || state.remoteSession.email;
    if (compte) {
      compte.hidden = false;
      compte.querySelector('.topbar__moi').textContent = nom;
      compte.title = `${nom} — paramètres du compte`;
    }
  } else if (compte) {
    compte.hidden = true;
  }

  /* Le fil d'Ariane dit où l'on est, et il n'y a que deux endroits possibles.
     Au niveau de l'espace, le bandeau porte le nom de l'espace — ce n'est pas
     un bouton de document, c'est l'adresse. Dans un questionnaire, il porte
     les deux : d'où l'on vient, et ce qu'on édite. Sans cela, descendre dans
     un questionnaire faisait disparaître l'espace de l'écran, et il fallait
     se souvenir qu'il existait. */
  const dansUnQuiz = state.vue === 'quiz' && state.quiz;
  dom.quizName.replaceChildren(...(dansUnQuiz
    ? [
      el('span', { class: 'topbar__doc__emoji', text: state.quiz.emoji || '✦', 'aria-hidden': 'true' }),
      el('span', { class: 'topbar__doc__name', text: state.quiz.title }),
      el('span', { class: 'topbar__doc__caret', text: '▾', 'aria-hidden': 'true' }),
    ]
    : [
      el('span', { class: 'topbar__doc__emoji', text: '🗄', 'aria-hidden': 'true' }),
      el('span', { class: 'topbar__doc__name', text: nomDeLEspace() }),
    ]));
  dom.quizName.title = dansUnQuiz
    ? `${state.quiz.title} — changer de questionnaire`
    : nomDeLEspace();

  /* Le retour vers l'espace ne vit que dans un questionnaire. Il est posé à
     côté du fil plutôt que dedans : un bouton qui apparaît et disparaît au
     même endroit qu'un autre finit par se cliquer par erreur. */
  let retour = dom.topActions.parentElement.querySelector('[data-act="retour-espace"]');
  if (dansUnQuiz && !retour) {
    retour = el('button', {
      class: 'btn btn--quiet btn--sm', type: 'button', 'data-act': 'retour-espace',
      title: 'Revenir à l’espace', text: '←',
    });
    dom.quizName.before(retour);
  }
  if (retour) retour.hidden = !dansUnQuiz;
  /* « Tester » et « Diffuser » agissent sur le questionnaire ouvert. Au niveau
     de l'espace il n'y en a pas, et ils restaient là, grisés : deux boutons
     morts qui occupaient la moitié de la barre à l'écran d'accueil, et qui
     lui donnaient l'air de porter des commandes sans objet.

     Ils s'effacent plutôt qu'ils ne se grisent. Rien ne bouge en dessous : le
     ressort de la barre les tient à droite, et l'aide comme le verrou — qui
     valent à tous les niveaux — gardent leur place au bord. */
  /* Le statut d'enregistrement décrit le questionnaire ouvert — « Enregistré ·
     2 septembre ». Au niveau de l'espace on n'édite rien, et il restait
     pourtant là, à décrire un document qu'on ne regarde pas.

     Il ne coûtait rien tant qu'il avait sa ligne à lui. Depuis que la rangée
     d'onglets partage le bandeau, il en prend 204 px — de quoi obliger quatre
     libellés d'onglet à s'élider pendant qu'il annonce une sauvegarde sans
     objet. Même règle que pour « Tester » et « Diffuser » : ce qui appartient
     à l'écran d'un document ne s'affiche pas sur celui du lieu. */
  dom.saveStatus.hidden = !dansUnQuiz;

  for (const button of dom.topActions.querySelectorAll('[data-act="test"], [data-act="panel"]')) {
    /* La VUE, et non la simple présence d'un questionnaire en mémoire :
       remonter à l'espace n'en ferme aucun, et `state.quiz` reste donc garni.
       Ces deux boutons appartiennent à l'écran d'un document, pas à celui du
       lieu qui les contient. */
    button.hidden = !dansUnQuiz;
    button.disabled = !dansUnQuiz;
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

/* « Albertine, hier · v7 ». Sans profil, `nommer()` retombe sur un
   identifiant tronqué, dit comme tel plutôt que déguisé en nom. Une
   publication antérieure au garde-fou n'a ni auteur ni révision : on ne
   dit rien plutôt que d'inventer. */
function signature(quiz) {
  const parts = [];
  if (quiz.updatedBy) parts.push(nommer(quiz.updatedBy));
  if (quiz.updatedAt) parts.push(formatDate(quiz.updatedAt));
  if (quiz.rev > 0) parts.push(`v${quiz.rev}`);
  return parts.join(' · ');
}

function railBadge() {
  const enAttente = Object.keys(state.demandes || {}).length;
  if (enAttente) {
    return el('span', { class: 'rail__item__badge', title: `${enAttente} demande${enAttente > 1 ? 's' : ''} d’accès`, text: String(enAttente) });
  }
  if (state.corbeille.length) return el('span', { class: 'rail__item__badge', text: String(state.corbeille.length) });
  return null;
}

/* Les trois états de quelqu'un qui frappe à la porte. On n'en montre qu'un,
   celui où il en est, avec le seul geste qui l'avance.                   */
function entrerDansLEspace() {
  const e = state.monEntree || {};
  const item = (emoji, titre, signature, act) => el('button', {
    class: 'rail__item', type: 'button', ...(act ? { 'data-act': act } : { disabled: true }),
  }, [
    el('span', { class: 'rail__item__emoji', text: emoji }),
    el('span', { class: 'rail__item__label' }, [
      el('span', { style: { display: 'block' }, text: titre }),
      el('span', { class: 'rail__item__signature', text: signature }),
    ]),
  ]);

  /* Un courriel de vérification peut ne jamais arriver : filtré, rangé dans
     les indésirables, ou retenu par la messagerie de la collectivité. On ne
     peut pas lever l'exigence — c'est elle qui empêche d'entrer sous une
     adresse qu'on ne possède pas — mais on peut poser la sortie juste à côté
     plutôt que de laisser quelqu'un devant une porte muette.

     L'ajout par identifiant ne passe par AUCUNE boîte aux lettres : un membre
     colle ces caractères dans « Inviter » et c'est fait. C'est le seul chemin
     d'entrée qui ne dépend de rien, et il doit donc être lisible là où les
     autres échouent — pas derrière le bouton de compte, que personne ne
     pense à ouvrir quand on vient de lui dire d'aller voir ses courriels. */
  const secours = () => [
    el('p', { class: 'rail__secours', text:
      'Le courriel peut atterrir dans les indésirables. S’il ne vient pas, donne ton identifiant à quelqu’un de l’équipe : il peut t’ajouter sans courriel.' }),
    el('button', { class: 'rail__item', type: 'button', 'data-act': 'copier-uid' }, [
      el('span', { class: 'rail__item__emoji', text: '⧉' }),
      el('span', { class: 'rail__item__label' }, [
        el('span', { style: { display: 'block' }, text: 'Copier mon identifiant' }),
        el('span', { class: 'rail__item__signature', text: 'à transmettre à un membre' }),
      ]),
    ]),
  ];

  if (e.invitation && e.verifie) {
    return [item('✉️', 'Rejoindre cet espace', 'une invitation t’y attend', 'entrer-rejoindre')];
  }
  /* Invité, mais l'adresse n'est pas vérifiée. La règle l'exige, et pour une
     bonne raison : sans elle, n'importe qui s'inscrivant sous l'adresse
     conviée entrerait. On ne peut donc pas passer outre — mais on peut dire
     exactement ce qui manque, plutôt que de refuser sans expliquer. */
  if (e.invitation) {
    return [item('📮', 'Vérifie ton adresse', 'l’invitation t’attend derrière', 'entrer-verifier'), ...secours()];
  }
  if (e.demande) {
    return [item('⏳', 'Demande envoyée', 'l’équipe doit encore l’accepter', null)];
  }
  /* Même exigence que pour les invitations, et pour la même raison. La règle
     de `attente` réclame désormais une adresse confirmée : sans elle,
     n'importe qui pouvait déclarer « direction@ville.fr » sans jamais ouvrir
     cette boîte, et l'équipe lisait une adresse crédible en croyant qu'elle
     avait été vérifiée — c'est ce que l'écran affirmait. Ici comme au-dessus,
     on nomme ce qui manque plutôt que de laisser la base refuser sans dire. */
  if (!e.verifie) {
    return [item('📮', 'Vérifie ton adresse', 'il en faut une confirmée pour demander l’accès', 'entrer-verifier'), ...secours()];
  }
  return [item('🔔', 'Demander l’accès', 'un membre de l’équipe décidera', 'entrer-demander')];
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
        /* Qui a touché à quoi. La donnée existe depuis le garde-fou
           anti-écrasement, qui impose `updatedBy` et `rev` à chaque
           publication — on ne la montrait que dans le message de conflit,
           c'est-à-dire seulement quand ça avait déjà mal tourné. C'est
           pourtant ce qu'une équipe demande en premier. */
        el('span', { class: 'rail__item__label' }, [
          el('span', { style: { display: 'block' }, text: quiz.title }),
          signature(quiz) && el('span', { class: 'rail__item__signature', text: signature(quiz) }),
        ]),
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

    /* Une entrée qui porte son nom. Vitrine, corbeille, identité du kiosque,
       fréquentation et équipe décrivent l'ESPACE, pas le document ouvert —
       et ils ne s'atteignaient que par le bouton de compte, dont le seul
       indice est le prénom de la personne connectée. Rien n'y disait « c'est
       ici que se règle le kiosque de l'équipe », et un réflexe appris dans
       d'autres outils ne s'invente pas.

       Le bouton de compte reste : mot de passe et déconnexion relèvent bien
       de la personne. Mais le kiosque a désormais sa porte, à son nom, au
       même endroit que le reste de la navigation. */
    state.espace && state.remoteSession && state.membre !== false && el('div', {}, [
      el('div', { class: 'rail__head' }, [el('h2', { text: 'Mon espace' })]),
      el('div', { class: 'rail__list' }, [
        el('button', {
          class: 'rail__item', type: 'button', 'data-act': 'espace',
          title: `Questionnaires, vitrine et équipe de « ${state.espace} »`,
        }, [
          el('span', { class: 'rail__item__emoji', text: '🗄' }),
          el('span', { class: 'rail__item__label' }, [
            el('span', { style: { display: 'block' }, text: state.identite?.titre || state.espace }),
            el('span', { class: 'rail__item__signature', text: 'questionnaires, vitrine, équipe' }),
          ]),
          /* Une demande d'accès attend une décision ; la corbeille attend
             seulement qu'on s'en souvienne. Quand les deux ont quelque chose
             à dire, c'est la décision qui prend la pastille. */
          railBadge(),
        ]),
      ]),
    ]),

    /* Connecté, mais pas de cette maison. L'écran ne montrait alors qu'un
       backoffice sans droits, et la feuille d'équipe affirmait « tu es bien
       membre » — le contraire de ce qu'il fallait dire. */
    state.espace && state.remoteSession && state.membre === false && el('div', {}, [
      el('div', { class: 'rail__head' }, [el('h2', { text: 'Cet espace' })]),
      el('div', { class: 'rail__list' }, entrerDansLEspace()),
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
            type: 'button', 'data-act': 'panel', 'data-id': issue.where, 'data-cible': issue.id,
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
/* Les onglets de l'espace. « Cet ordinateur » n'a ni équipe ni fréquentation
   partagée : on ne montre pas des portes qui ne mènent nulle part. */
const ONGLETS_ESPACE = [
  { id: 'questionnaires', label: 'Questionnaires', emoji: '✦', partout: true },
  { id: 'vitrine',        label: 'Vitrine',        emoji: '▦', partout: true },
  { id: 'frequentation',  label: 'Fréquentation',  emoji: '📊', partout: false },
  { id: 'equipe',         label: 'Équipe',         emoji: '👥', partout: false },
];

function ongletsEspace() {
  const partage = Boolean(state.espace && state.remoteSession);
  return ONGLETS_ESPACE.filter((o) => o.partout || partage);
}

/* Le nom de l'endroit où l'on travaille. Sans espace partagé, c'est bien un
   lieu quand même — celui de cette machine — et le dire ainsi vaut mieux que
   de laisser un vide là où les autres lisent le nom de leur médiathèque. */
function nomDeLEspace() {
  if (!state.espace) return 'Cet ordinateur';
  return state.identite?.titre || `Espace « ${state.espace} »`;
}

function renderTabbar(bySection) {
  if (!dom.tabbar) return;
  /* Au niveau de l'espace, ces onglets ne sont pas un pis-aller de petit
     écran : le rail y est masqué, ils sont la seule navigation. Le CSS a
     besoin de le savoir pour les afficher à toute largeur. */
  dom.tabbar.classList.toggle('est-espace', state.vue === 'espace');
  /* Le nom du repère suivait les onglets, pas la vue : au niveau de l'espace,
     la barre navigue entre Questionnaires, Vitrine, Fréquentation et Équipe
     sous une étiquette qui annonçait des sections de questionnaire. C'est le
     seul repère de navigation de cet écran, et on le sautait en le lisant. */
  dom.tabbar.setAttribute('aria-label', state.vue === 'espace'
    ? `Sections de ${nomDeLEspace()}`
    : 'Sections du questionnaire');

  if (state.vue === 'espace') {
    dom.tabbar.replaceChildren(...ongletsEspace().map((o) => el('button', {
      class: 'tab' + (state.ongletEspace === o.id ? ' is-active' : ''),
      type: 'button', 'data-act': 'onglet-espace', 'data-id': o.id,
      'aria-current': state.ongletEspace === o.id ? 'page' : null,
      'aria-label': o.label, title: o.label,
    }, [
      el('span', { class: 'tab__emoji', text: o.emoji, 'aria-hidden': 'true' }),
      el('span', { class: 'tab__label', text: o.label }),
      /* Une demande d'accès attend une décision : elle se signale sur
         l'onglet, comme une anomalie se signale sur sa section. */
      o.id === 'equipe' && Object.keys(state.demandes || {}).length
        ? el('span', { class: 'rail__item__badge', text: String(Object.keys(state.demandes).length) })
        : null,
    ])));
    return;
  }

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

/* La liste des questionnaires, au niveau de l'espace. Deux listes et non
   trois : le catalogue statique du dépôt — « Au kiosque » — ne décrit rien
   d'utile quand on travaille dans un espace, qui a son propre publié. Il
   reste sur « Cet ordinateur », où il EST le kiosque local. */
function panneauQuestionnaires() {
  const drafts = store.allDrafts();
  const draftIds = new Set(drafts.map((q) => q.id));
  const partage = Boolean(state.espace && state.remoteSession);

  /* La carte. Le titre est le bouton, et son pseudo-élément étend la
     surface de clic à la carte entière : la carte porte déjà d'autres
     boutons, et un rôle interactif imbriqué donnerait deux arrêts de
     tabulation sur la même chose. Le nom annoncé est le titre du
     questionnaire, pas « Ouvrir ». */
  const carte = (quiz, primaire, { pastilles = [], actions = [], meta = null } = {}) => {
    const n = quiz.questions?.length ?? 0;
    const m = quiz.results?.length ?? 0;
    return el('div', {
      class: 'fiche-quiz' + (state.quiz?.id === quiz.id ? ' is-ouverte' : ''),
      style: { '--card-accent': quiz.accent },
    }, [
      quiz.image && el('img', { class: 'fiche-quiz__cover', src: quiz.image, alt: '', loading: 'lazy' }),
      el('span', { class: 'fiche-quiz__emoji', 'aria-hidden': 'true', text: quiz.emoji || '✦' }),
      el('button', {
        class: 'fiche-quiz__titre', type: 'button',
        'data-act': primaire, 'data-id': quiz.id, text: quiz.title || 'Questionnaire sans titre',
      }),
      el('span', { class: 'fiche-quiz__meta', text:
        `${n} question${n > 1 ? 's' : ''} · ${m} profil${m > 1 ? 's' : ''}` + (meta ? ` · ${meta}` : '') }),
      signature(quiz) && el('span', { class: 'fiche-quiz__signature', text: signature(quiz) }),
      el('span', { class: 'fiche-quiz__pied' }, [
        ...pastilles,
        el('span', { class: 'section__spacer' }),
        ...actions,
      ]),
    ]);
  };

  const exporter = (quiz) => el('button', {
    class: 'btn btn--icon btn--quiet', type: 'button',
    'data-act': 'export-one', 'data-id': quiz.id, title: 'Exporter en JSON', 'aria-label': 'Exporter en JSON', text: '↓',
  });

  /* La carte vide qui crée. Elle ferme la grille des brouillons, et quand il
     n'y en a aucun, elle est la grille : l'état vide porte le geste. */
  const nouveau = () => el('button', {
    class: 'fiche-quiz fiche-quiz--nouveau', type: 'button', 'data-act': 'new-quiz',
  }, [
    el('span', { class: 'fiche-quiz__plus', 'aria-hidden': 'true', text: '+' }),
    'Nouveau questionnaire',
  ]);

  const liste = (titre, aide, contenu) => el('section', { class: 'panel' }, [
    el('div', { class: 'section__head' }, [
      el('h2', { text: titre }),
      el('span', { class: 'section__spacer' }),
    ]),
    aide && el('p', { class: 'panel__hint', text: aide }),
    contenu,
  ]);

  const enLigne = (id) => partage && state.remote.some((q) => q.id === id);
  const parcours = (id) => {
    const total = state.stats?.[id]?.total || 0;
    return total ? `${total} parcours terminé${total > 1 ? 's' : ''}` : null;
  };

  const blocs = [
    liste('Mes brouillons',
      'Gardés sur cet ordinateur. Rien n’en sort tant que tu ne diffuses pas.',
      el('div', { class: 'grille-quiz' }, [
        ...drafts.map((quiz) => carte(quiz, 'select', { pastilles: [
          state.quiz?.id === quiz.id && el('span', { class: 'pill pill--accent', text: 'ouvert' }),
          enLigne(quiz.id) && el('span', { class: 'pill', text: 'en ligne' }),
        ] })),
        nouveau(),
      ])),
  ];

  if (partage && state.remote.length) {
    blocs.push(liste(`Publiés dans ${nomDeLEspace()}`,
      'Ce que vos usagers voient. Modifier en crée une copie locale ; la version diffusée ne bouge qu’à la prochaine diffusion.',
      /* La carte reprend EXACTEMENT l'action que portait sa ligne, sans en
         inventer une : ouvrir la copie si elle existe, la fabriquer sinon. */
      el('div', { class: 'grille-quiz' }, state.remote.map((quiz) => carte(quiz,
        draftIds.has(quiz.id) ? 'select' : 'edit-remote', {
          meta: parcours(quiz.id),
          pastilles: [
            state.presentation.epingle === quiz.id && el('span', { class: 'pill pill--accent', text: 'à la une' }),
            state.presentation.masques.has(quiz.id) && el('span', { class: 'pill pill--warn', text: 'masqué' }),
            draftIds.has(quiz.id) && el('span', { class: 'pill', text: 'copie en cours' }),
          ],
          actions: [exporter(quiz)],
        })))));
  }

  /* Les retraits, dans l'onglet où l'on cherche les questionnaires — et non
     derrière un bouton d'un onglet « Réglages ». Le commentaire qui les y
     rangeait disait « ce qu'on va rechercher rarement ». C'est faux du métier :
     on travaille à la saison, on rouvre en janvier la Nuit de la lecture de
     l'an dernier et en juin l'été précédent. Ce n'est pas rare, c'est
     cyclique — et c'est le geste le plus rentable de l'outil, reprendre
     plutôt que réécrire. La mémoire de saison d'une équipe n'a rien à faire
     dans un tiroir appelé Réglages. */
  if (partage && state.corbeille.length) {
    const retire = (q) => el('div', { class: 'sheet__row' }, [
      el('span', { class: 'sheet__emoji', text: q.emoji || '✦' }),
      el('span', { class: 'sheet__label' }, [
        el('span', { text: q.title || 'Questionnaire sans titre' }),
        el('span', { class: 'field__hint', style: { display: 'block' }, text:
          `Retiré ${q.supprimeLe ? formatDate(q.supprimeLe) : 'à une date inconnue'}`
          + (q.supprimePar ? ` par ${nommer(q.supprimePar)}` : '') }),
      ]),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button',
        'data-act': 'corbeille-restaurer', 'data-id': q.id, text: '↺ Restaurer' }),
      /* Sorti de sa fenêtre, ce geste est plus facile à atteindre — et il est
         le seul du produit qui ne s'annule pas. Il se peint donc en danger au
         lieu du « ✕ » discret qu'il portait, où il se lisait comme un renvoi
         de la ligne plutôt que comme une destruction. */
      el('button', { class: 'btn btn--icon btn--danger', type: 'button',
        'data-act': 'corbeille-jeter', 'data-id': q.id,
        title: 'Supprimer définitivement — sans retour',
        'aria-label': `Supprimer définitivement « ${q.title || 'Questionnaire sans titre'} » — sans retour`,
        text: '✕' }),
    ]);

    blocs.push(liste('Retirés du kiosque',
      'Restaurer remet en ligne tel quel. La corbeille garde les vingt derniers retraits ; au-delà, le plus ancien s’efface. Seul l’export sauvegarde.',
      el('div', {}, [
        el('div', { class: 'sheet__list' }, state.corbeille.map(retire)),
        el('div', { class: 'row', style: { marginTop: 'var(--s-4)' } }, [
          el('button', { class: 'btn btn--danger btn--sm', type: 'button',
            'data-act': 'corbeille-vider', text: 'Vider la corbeille' }),
        ]),
      ])));
  }

  if (!partage && state.published.length) {
    blocs.push(liste('Au kiosque de ce dépôt',
      'Les questionnaires livrés avec l’application. Modifier en crée une copie locale.',
      el('div', { class: 'grille-quiz' }, state.published.map((quiz) => carte(quiz,
        draftIds.has(quiz.id) ? 'select' : 'edit-published', {
          pastilles: [draftIds.has(quiz.id) && el('span', { class: 'pill', text: 'copie en cours' })],
          actions: [exporter(quiz)],
        })))));
  }

  return blocs;
}

/* L'écran d'espace. Les onglets qui n'ont pas encore leur panneau propre
   rouvrent la feuille existante : le déménagement se fait sans laisser de
   porte condamnée entre-temps. */
function renderEspace() {
  const panneaux = {
    questionnaires: panneauQuestionnaires,
    equipe: contenuEquipe,
    frequentation: contenuFrequentation,
    vitrine: contenuVitrine,
  };
  const construire = panneaux[state.ongletEspace];
  if (construire) {
    dom.panel.replaceChildren(...construire());
    return;
  }

  /* Les cinq onglets ont leur panneau : plus rien ne se replie dans une
     fenêtre. Un onglet inconnu ramène à l'accueil plutôt qu'à un écran vide. */
  state.ongletEspace = 'questionnaires';
  dom.panel.replaceChildren(...panneauQuestionnaires());
}

async function renderPanel() {
  dom.shell?.classList.toggle('est-espace', state.vue === 'espace');
  if (state.vue === 'espace') { paintPreview(); return renderEspace(); }

  if (!state.quiz) {
    paintPreview();
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
        /* Un espace ne se gère pas depuis un questionnaire : arriver ici sur
           un navigateur neuf ne doit pas couper l'équipe de son kiosque. */
        state.espace && state.remoteSession && el('p', { class: 'panel__hint', style: { marginTop: 'var(--s-6)' } }, [
          'Le kiosque de l’espace, sa vitrine, sa corbeille et l’équipe se règlent ailleurs — ',
          'ils ne dépendent pas du questionnaire ouvert.',
        ]),
        state.espace && state.remoteSession && el('div', { class: 'row', style: { justifyContent: 'center', marginTop: 'var(--s-3)' } }, [
          el('button', { class: 'btn btn--ghost', type: 'button', 'data-act': 'espace', text: `🗄 ${state.identite?.titre || state.espace}` }),
        ]),
      ]),
    ]));
    return;
  }

  const panel = PANELS.find((p) => p.id === state.panel) || PANELS[0];
  const ctx = {
    reach: state.reach, expanded: state.expanded,
    previewOpen: state.previewOpen, folded: state.folded,
    poidsFins: state.poidsFins, poidsHorsEchelle: poidsHorsEchelle(state.quiz),
    /* Les constats, pour que chaque carte porte les siens. */
    issues: diagnose(state.quiz),
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
    ctx.stats = state.quiz ? state.stats?.[state.quiz.id] : null;
    ctx.inEspace = state.remote.some((q) => q.id === state.quiz.id);
    ctx.identite = state.identite;
    ctx.corbeille = state.corbeille.length;
    ctx.masques = state.presentation.masques.size;
  }

  /* L'état du questionnaire, au-dessus de tous les panneaux. Les
     compteurs vivaient dans « Profils » : une donnée qui décrit le
     questionnaire entier, rangée dans le panneau qui parle des sorties.
     On ne cherche pas ce qu'on ignore — et quand rien n'a encore été
     compté, la ligne le dit plutôt que de disparaître. */
  dom.panel.replaceChildren(bandeauEtat(ctx), panel.render(state.quiz, ctx));
  applyAccent(state.quiz.accent);
  bindSortables(dom.panel, dropped);
  paintPreview();

  if (panel.id === 'resultats') scheduleReach();
}

function bandeauEtat(ctx) {
  const quiz = state.quiz;
  const soucis = ctx.issues || diagnose(quiz);
  const erreurs = soucis.filter((i) => i.level === 'error').length;
  const enLigne = state.remote.some((q) => q.id === quiz.id);
  const stats = ctx.stats;

  const item = (valeur, libelle, extra = {}) => el('span', { class: 'etat__item', ...extra }, [
    el('strong', { class: 'etat__valeur', text: String(valeur) }),
    el('span', { class: 'etat__libelle', text: libelle }),
  ]);

  return el('div', { class: 'etat' }, [
    item(quiz.questions.length, quiz.questions.length > 1 ? 'questions' : 'question'),
    item(quiz.results.length, quiz.results.length > 1 ? 'profils' : 'profil'),
    item(quiz.axes.length, quiz.axes.length > 1 ? 'axes' : 'axe'),

    el('span', { class: 'etat__sep' }),

    erreurs
      ? el('button', {
          class: 'etat__item etat__item--erreur', type: 'button',
          'data-act': 'panel', 'data-id': soucis.find((i) => i.level === 'error').where,
          'data-cible': soucis.find((i) => i.level === 'error').id,
          title: 'Aller au premier problème',
        }, [
          el('strong', { class: 'etat__valeur', text: String(erreurs) }),
          el('span', { class: 'etat__libelle', text: erreurs > 1 ? 'à corriger' : 'à corriger' }),
        ])
      : el('span', { class: 'etat__item etat__item--ok' }, [
          el('strong', { class: 'etat__valeur', text: '✓' }),
          el('span', { class: 'etat__libelle', text: 'prêt' }),
        ]),

    state.espace && el('span', {
      class: 'etat__item ' + (enLigne ? 'etat__item--ok' : ''),
      title: enLigne ? 'Ce questionnaire est publié dans l’espace.' : 'Ce questionnaire n’est pas encore publié.',
    }, [
      el('strong', { class: 'etat__valeur', text: enLigne ? '⇧' : '—' }),
      el('span', { class: 'etat__libelle', text: enLigne ? 'en ligne' : 'non publié' }),
    ]),

    /* Le compteur ne se cache pas quand il est à zéro : c'est justement
       le moment où il faut savoir qu'il existe. */
    state.espace && enLigne && el('span', {
      class: 'etat__item',
      title: 'Parcours terminés depuis la mise en ligne, reprises comprises : « Refaire » compte un départ ET une arrivée, pour que le taux reste juste. Un ordre de grandeur — rien n’empêche quelqu’un de le gonfler.',
    }, [
      el('strong', { class: 'etat__valeur', text: String(stats?.total || 0) }),
      el('span', { class: 'etat__libelle', text: (stats?.total || 0) > 1 ? 'parcours terminés' : 'parcours terminé' }),
    ]),

    /* Le taux d'achèvement : la seule chose que les compteurs sachent dire
       sur la FORME du questionnaire, et pas seulement sur son audience.
       Trop long, une couverture qui ne donne pas envie, une question qui
       décourage — tout cela se voit ici et nulle part ailleurs.

       Il n'apparaît qu'une fois des départs comptés : les questionnaires
       mis en ligne avant ce compteur n'en ont pas, et afficher « 0 % »
       sur une donnée absente vaudrait moins que se taire. La borne à
       100 % couvre le cas de ceux-là — des arrivées sans départ. */
    state.espace && enLigne && stats?.debuts > 0 && (() => {
      const assez = assezDeDeparts(stats);
      const taux = Math.min(100, Math.round(((stats.total || 0) / stats.debuts) * 100));
      return el('span', {
        class: 'etat__item' + (assez && taux < 50 ? ' etat__item--erreur' : ''),
        title: `${stats.total || 0} parcours terminés sur ${stats.debuts} commencés.`
          + (assez ? '' : TROP_PEU_DE_DEPARTS),
      }, [
        el('strong', { class: 'etat__valeur',
          text: assez ? `${taux} %` : `${stats.total || 0}/${stats.debuts}` }),
        el('span', { class: 'etat__libelle', text: 'terminés' }),
      ]);
    })(),
  ]);
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

/* Chaque entrée porte le questionnaire dont elle vient. Sans cette
   estampille, un Ctrl+Z frappé dans un document réinstallait l'instantané
   d'un AUTRE document : l'éditeur basculait sans prévenir, le `flush()` de
   l'annulation enregistrait le document d'à côté, et la frappe en cours —
   pas encore sortie de la sauvegarde différée de 500 ms — disparaissait
   avec lui. La pile est partagée ; les gestes ne le sont pas. */
function pushUndo(label, apply, quizId = state.quiz?.id ?? null) {
  const step = { label, apply, quizId };
  undoStack.push(step);
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  return step;
}

function remember(label) {
  if (!state.quiz) return null;
  const snapshot = structuredClone(state.quiz);
  const panel = state.panel;
  return pushUndo(label, () => {
    state.quiz = snapshot;
    state.panel = panel;
    flush();
    renderTopbar();
    renderRail();
    renderPanel();
  }, snapshot.id);
}

/* Défaire un geste PRÉCIS : celui que le bandeau propose. Il peut
   appartenir à un questionnaire qu'on vient de quitter — supprimer un
   questionnaire ferme le document et en ouvre un autre — d'où le passage
   par la référence plutôt que par le sommet de la pile. */
function undoStep(step) {
  if (!step) return;
  const at = undoStack.indexOf(step);
  if (at >= 0) undoStack.splice(at, 1);
  step.apply();
  toast(`Annulé : ${step.label.toLowerCase()}.`);
}

/* Ctrl+Z : le geste le plus récent DU QUESTIONNAIRE OUVERT. Les entrées
   des autres documents restent en pile — elles serviront si l'on y
   revient — mais elles ne sont jamais appliquées ici. */
function undo() {
  const courant = state.quiz?.id ?? null;
  const at = undoStack.findLastIndex((step) => step.quizId === courant);
  if (at < 0) return toast('Rien à annuler dans ce questionnaire.');
  const [step] = undoStack.splice(at, 1);
  step.apply();
  return toast(`Annulé : ${step.label.toLowerCase()}.`);
}

/* Le geste destructeur : on l'exécute, et on propose le retour. */
function undoable(label, mutate) {
  const step = remember(label);
  mutate();
  flush();
  renderRail();
  renderPanel();
  toast(label, { action: { label: 'Annuler', onClick: () => undoStep(step) } });
}

/* --- Aperçu ---------------------------------------------------------------
   Il montre la question sous le curseur, avec le rendu exact du parcours
   (views.js). Il se repeint tout seul à la frappe et ne redessine jamais
   le panneau : un redessin déplacerait le curseur du champ en cours.   */

/* --- Le téléphone -------------------------------------------------------------
   Le vrai rendu du parcours, dans un cadre de 375 px à l'échelle, qui suit
   l'onglet et le curseur : la couverture depuis Identité, Axes et Diffuser ;
   la question sous le curseur depuis Questions ; le profil sous le curseur
   depuis Profils, avec ses recommandations. Ce sont les vues de views.js,
   celles-là mêmes que joue quiz.js — pas une imitation. */
function paintPreview() {
  if (!dom.apercu) return;
  const quiz = state.quiz;
  if (!quiz || state.vue !== 'quiz') { dom.apercu.hidden = true; return; }
  dom.apercu.hidden = false;
  dom.apercu.classList.toggle('is-closed', !state.previewOpen);
  dom.apercuBascule.textContent = state.previewOpen ? 'Masquer' : 'Afficher';

  let vue;
  let legende;
  let compteur = false;
  if (state.panel === 'questions' && quiz.questions.length) {
    const index = Math.max(0, quiz.questions.findIndex((q) => q.id === state.focused));
    vue = questionView(quiz, quiz.questions[index], index, { interactive: false });
    legende = `question ${index + 1} sur ${quiz.questions.length}`;
    compteur = true;
  } else if (state.panel === 'resultats' && quiz.results.length) {
    const index = Math.max(0, quiz.results.findIndex((r) => r.id === state.focused));
    const profil = quiz.results[index];
    vue = el('section', { class: 'result result--static' }, [
      bannerView(quiz, profil, { interactive: false }),
      profil.recos.length
        ? el('div', { class: 'recos__list' }, profil.recos.map((reco, i) => recoView(reco, i)))
        : null,
    ]);
    legende = `profil ${index + 1} sur ${quiz.results.length}`;
  } else {
    vue = coverView(quiz, { interactive: false });
    legende = 'la couverture';
  }

  dom.apercuLegende.textContent = legende;
  dom.apercuScene.replaceChildren(
    el('div', { class: 'tel__bandeau', 'aria-hidden': 'true' }, [
      el('span', { class: 'tel__bandeau__titre', text: quiz.title || 'Questionnaire sans titre' }),
      compteur && el('span', { class: 'tally tel__bandeau__tally' }, quiz.axes.slice(0, 10).map((a) => el(
        'span', { class: 'tally__axis', style: { '--axis': a.color } },
        [el('span', { class: 'tally__glyph', text: a.glyph }), el('span', { class: 'tally__count', text: '0' })],
      ))),
    ]),
    el('div', { class: 'tel__scene' }, [vue]),
  );
}

/* Régler une pesée et mettre le bouton à jour sur place : un redessin du
   panneau ferait perdre le focus au bouton qu'on vient de presser. */
function reglerPesee(bouton, qId, oId, aId, niveau) {
  const n = ((niveau % 4) + 4) % 4;
  apply(`score:${qId}:${oId}:${aId}`, n);
  touch();
  bouton.dataset.niveau = String(n);
  bouton.classList.toggle('is-set', n !== 0);
  bouton.setAttribute('aria-valuenow', String(n));
  bouton.setAttribute('aria-valuetext', NIVEAUX[n]);
  const axe = state.quiz?.axes.find((a) => a.id === aId);
  if (axe) bouton.title = `${axe.label} : ${NIVEAUX[n]}`;
  refreshDiag();
}

/* Conduire à une carte depuis le rail : la déplier, l'amener à l'écran,
   poser le curseur dans son premier champ. */
function allerALaCarte(id) {
  const carte = dom.panel.querySelector(`[data-carte="${CSS.escape(id)}"]`);
  if (!carte) return;
  carte.scrollIntoView({ block: 'start', behavior: 'smooth' });
  carte.querySelector('input, textarea, select, [data-act="pesee"]')?.focus({ preventScroll: true });
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

/* Le témoin d'enregistrement n'est PAS une région vivante, et c'est
   délibéré : `touch()` écrit « Enregistrement… » à chaque frappe, une
   région polie annoncerait donc deux phrases par mot tapé. Ce qui mérite
   d'être entendu, c'est l'échec — et une seule fois, comme le parcours le
   fait déjà pour un refus de session. */
let refusEnregistrementSignale = false;

function flush() {
  clearTimeout(saveTimer);
  if (!state.quiz) return;
  const saved = store.saveDraft(state.quiz);
  dom.saveStatus.classList.remove('is-saving');
  dom.saveStatus.textContent = saved
    ? `Enregistré · ${new Date(saved.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : 'Enregistrement impossible (stockage plein ?)';
  if (saved) { refusEnregistrementSignale = false; return; }
  if (refusEnregistrementSignale) return;
  refusEnregistrementSignale = true;
  toast('Ce navigateur refuse d’enregistrer : vos modifications ne sont plus conservées. Exportez ce questionnaire avant de fermer.', 'danger');
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
  repaintPreview();
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

  /* L'en-tête d'une carte dépliée ne porte plus le texte : le champ est le
     titre. Repliée, elle n'a pas de champ. Il n'y a donc plus rien à
     recopier à la frappe. */
  if (bind?.startsWith('score:')) {
    target.closest('.scorechip')?.classList.toggle('is-set', Number(target.value) !== 0);
  }
}

/* Les remarques posées sur les cartes suivent le diagnostic à la frappe,
   sans redessiner le panneau — un redessin ferait sauter le curseur. On
   remplace le bloc de chaque carte, et rien d'autre. */
function rafraichirDiagCartes() {
  if (!state.quiz) return;
  const ctx = { issues: diagnose(state.quiz) };
  for (const carte of dom.panel.querySelectorAll('[data-carte]')) {
    const id = carte.dataset.carte;
    const soucis = ctx.issues.filter((i) => i.id === id);
    carte.classList.toggle('a-corriger', soucis.some((i) => i.level === 'error'));
    carte.classList.toggle('a-verifier', soucis.length > 0 && !soucis.some((i) => i.level === 'error'));
    carte.querySelector(':scope > .diag-carte')?.remove();
    const bloc = diagCarte(ctx, id, carte.classList.contains('is-folded'));
    if (!bloc) continue;
    const tete = carte.querySelector(':scope > .editor-card__head');
    if (tete) tete.after(bloc);
    else carte.append(bloc);
  }
}

const refreshDiag = debounce(() => { renderRail(); rafraichirDiagCartes(); scheduleReach(); }, 600);

/* --- Actions --------------------------------------------------------------------- */

function onClick(event) {
  const trigger = event.target.closest('[data-act]');
  /* Les champs sont pilotés par data-bind, pas par data-act — sauf la case
     à cocher des crédits, dont le clic EST l'action. */
  if (!trigger) return;
  /* Les champs sont pilotés par data-bind, pas par data-act — sauf les cases
     à cocher, dont le clic EST l'action. */
  if (trigger.tagName === 'INPUT' && !['crediter', 'confiance'].includes(trigger.dataset.act)) return;
  const { act, id } = trigger.dataset;
  const [ownerId, childId] = (id || '').split('|');
  const quiz = state.quiz;

  const structural = () => { flush(); renderRail(); renderPanel(); };
  /* Un déplacement est annulable mais ne mérite pas de bandeau : son
     effet est déjà sous les yeux de celui qui vient de le provoquer. */
  const reorder = (label, mutate) => {
    remember(label);
    mutate();
    structural();
    /* `renderPanel()` remplace le panneau entier : le bouton qu'on vient de
       presser n'existe plus, et le focus retombe sur le document. Au clavier,
       remonter une question de trois crans demandait de re-tabuler jusqu'à
       elle entre chaque cran. On repose donc le focus sur le même geste, à sa
       nouvelle place — et sur son jumeau quand il vient de se désactiver,
       c'est-à-dire quand l'élément a atteint le haut ou le bas de la liste. */
    const famille = act.replace(/-(up|down)$/, '');
    const candidats = [...dom.panel.querySelectorAll(`[data-act^="${famille}-"]`)]
      .filter((n) => n.dataset.id === id && /-(up|down)$/.test(n.dataset.act) && !n.disabled);
    (candidats.find((n) => n.dataset.act === act) || candidats[0])
      ?.focus({ preventScroll: true });
  };
  const byId = (list, key) => list.find((item) => item.id === key);
  const move = (list, key, delta) => {
    const from = list.findIndex((item) => item.id === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
  };

  switch (act) {
    case 'new-quiz': return assistantCreation();
    /* Ouvrir remplace le panneau entier : le bouton qu'on vient de presser
       n'existe plus, et le focus retomberait sur <body> — au clavier, on
       repartirait du haut du document. `reorder()` documente déjà ce piège
       pour ses flèches ; il se paie ici aussi, et la souris ne le voit
       jamais. On le repose sur le titre de l'écran ouvert. */
    case 'select': {
      select(id);
      structural();
      const titre = dom.panel.querySelector('h1, h2');
      if (titre) { titre.setAttribute('tabindex', '-1'); titre.focus({ preventScroll: true }); }
      return undefined;
    }
    case 'panel': {
      state.panel = PANELS.some((p) => p.id === id) ? id : 'identite';
      /* Un constat du rail vise un objet : on ouvre sa carte et on y va. */
      const cible = trigger.dataset.cible;
      if (cible) state.folded.delete(cible);
      renderRail();
      return renderPanel().then(() => { if (cible) allerALaCarte(cible); });
    }
    case 'pesee': {
      const [qId, oId, aId] = (id || '').split('|');
      reglerPesee(trigger, qId, oId, aId, Number(trigger.dataset.niveau) + 1);
      return undefined;
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
      const step = pushUndo('Questionnaire supprimé', () => {
        store.saveDraft(removed);
        select(removed.id);
        state.panel = panel;
        renderRail();
        renderPanel();
      }, removed.id);
      store.deleteDraft(quiz.id);
      state.quiz = null;
      const next = store.allDrafts()[0];
      if (next) select(next.id);
      renderRail();
      renderPanel();
      renderTopbar();
      toast(`« ${removed.title} » supprimé`, { action: { label: 'Annuler', onClick: () => undoStep(step) } });
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
      byId(quiz.results, id)?.recos.push(makeReco(quiz.typeParDefaut));
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
    case 'confiance': {
      const result = byId(quiz.results, ownerId);
      const reco = result && byId(result.recos, childId);
      if (!reco) return undefined;
      remember('Coup de cœur modifié');
      reco.confiance = !reco.confiance;
      return structural();
    }
    case 'crediter': {
      const liste = new Set(quiz.auteurs || []);
      liste.has(id) ? liste.delete(id) : liste.add(id);
      remember('Crédits modifiés');
      quiz.auteurs = [...liste];
      return structural();
    }
    case 'aide':             return afficherRaccourcis();
    case 'compte':           return monCompte();
    case 'espace':           return ouvrirLEspace();
    case 'mon-profil':       return monProfil();
    case 'onglet-espace': {
      const vise = ongletsEspace().some((o) => o.id === id) ? id : 'questionnaires';
      if (vise !== 'vitrine' && !quitterLaVitrine()) return undefined;
      state.ongletEspace = vise;
      return allerA('espace');
    }
    case 'retour-espace':    return allerA('espace');
    case 'symbole':          return ouvrirSymboles(id);
    case 'inviter':          return inviter();
    case 'membre-retirer':   return retirerMembre(id);
    case 'fiche-effacer':    return effacerFicheOrpheline(id);
    case 'demande-valider':  return validerDemande(id);
    case 'demande-refuser':  return refuserDemande(id);
    case 'invitation-annuler': return annulerInvitation(id);
    case 'entrer-rejoindre': return rejoindreLEspace();
    case 'entrer-demander':  return demanderLAcces();
    case 'entrer-verifier':  return verifierMonCourriel();
    case 'copier-uid':       return copierUid();
    case 'mon-mot-de-passe': return changerMonMotDePasse();
    case 'corbeille-restaurer': return restaurerDeLaCorbeille(id);
    case 'corbeille-jeter':     return jeterDeLaCorbeille(id);
    case 'corbeille-vider':     return viderLaCorbeille();
    case 'frequentation':
      state.ongletEspace = 'frequentation';
      return allerA('espace');
    case 'vitrine':
      state.ongletEspace = 'vitrine';
      return allerA('espace');
    case 'export-espace': return exportEspace();
    case 'export-drafts': return exportDrafts();
    case 'export-one':    return exportOne(id);
    case 'preview-toggle': {
      state.previewOpen = !state.previewOpen;
      return paintPreview();
    }
    case 'poids-mode': {
      state.poidsFins = !state.poidsFins;
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
    case 'affiche':   return montrerAffiche();
    case 'cotes':     return listeDesCotes();
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

/* --- Choisir un signe ------------------------------------------------------
   Trois champs demandaient un caractère qu'il fallait savoir taper. Sur un
   poste sans pavé emoji, ✿ ou 🏛 supposaient une table de caractères ; la
   liste de suggestions du glyphe d'axe, elle, ne se montrait qu'après avoir
   commencé à écrire — or c'est justement ce qu'on ne sait pas faire.

   Le champ reste libre et modifiable à la main : ce sélecteur ajoute un
   chemin, il n'en ferme aucun. Quelqu'un qui a son propre signe le colle
   comme avant.                                                           */
function ouvrirSymboles(cible) {
  const [bind, mode] = String(cible).split('|');
  choisirSigne({
    mode,
    actuel: valeurLiee(bind),
    poser: (signe) => {
      apply(bind, signe);
      flush();
      renderRail();
      renderPanel();
    },
  });
}

/* Le dictionnaire lui-même, séparé de la liaison au questionnaire. Le
   sélecteur ne servait qu'à des champs `data-bind`, c'est-à-dire au modèle du
   document ouvert ; l'identité de l'espace, elle, vit dans un formulaire à
   part, avec ses propres nœuds et son propre enregistrement. Sans cette
   coupure, lui donner un signe demandait soit de recopier le dictionnaire,
   soit de faire passer l'identité par `apply()` — c'est-à-dire de la ranger
   dans le questionnaire, où elle n'a rien à faire. */
function choisirSigne({ mode, actuel = '', poser: retenir }) {
  const emoji = mode === 'emoji';
  const dictionnaire = emoji ? EMOJIS : GLYPHES;

  const recherche = el('input', {
    class: 'input', type: 'search',
    placeholder: emoji ? 'polar, été, musique…' : 'étoile, cœur, fleur…',
    'aria-label': 'Chercher un signe',
  });
  const grille = el('div', { class: 'stack' });
  const vide = el('p', { class: 'field__hint', hidden: true, text: 'Aucun signe pour cette recherche.' });

  const poser = (signe) => {
    retenir(signe);
    dismiss(dialog);
  };

  const peindre = () => {
    const trouves = chercher(dictionnaire, recherche.value);
    vide.hidden = trouves.length > 0;
    grille.replaceChildren(...trouves.map((groupe) => el('div', {}, [
      el('span', { class: 'field__label', text: groupe.nom }),
      el('div', { class: 'symboles' }, groupe.signes.map(([signe, mots]) => el('button', {
        class: 'symbole' + (signe === actuel ? ' is-on' : ''),
        type: 'button', title: mots,
        /* Le signe seul ne se dit pas à voix haute : c'est le mot-clé qui
           nomme le bouton pour une synthèse vocale. */
        'aria-label': mots,
        'aria-pressed': String(signe === actuel),
        text: signe,
        onClick: () => poser(signe),
      }))),
    ])));
  };

  recherche.addEventListener('input', peindre);
  peindre();

  const dialog = el('dialog', { class: 'modal modal--wide' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: emoji ? 'Choisir un emoji' : 'Choisir un glyphe' }),
      el('p', { class: 'panel__hint', text: emoji
        ? 'Une sélection utile en médiathèque. Le champ reste libre : colle le tien.'
        : 'Des formes lisibles en petit, qui prennent la couleur de l’axe. Le champ reste libre.' }),
      recherche, vide, grille,
    ]),
    el('div', { class: 'modal__actions' }, [
      actuel && el('button', {
        class: 'btn btn--quiet', type: 'button', text: 'Effacer',
        onClick: () => poser(''),
      }),
      el('button', { class: 'btn btn--quiet', type: 'button', text: 'Fermer', onClick: () => dismiss(dialog) }),
    ]),
  ]);

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  recherche.focus();
}

/* Ce que le champ contient à cet instant. On le lit dans le DOM plutôt que
   dans le modèle : la frappe en cours n'y est pas encore écrite, et c'est
   bien ce que la personne voit qu'il faut montrer comme sélectionné. */
function valeurLiee(bind) {
  return document.querySelector(`[data-bind="${CSS.escape(bind)}"]`)?.value?.trim() || '';
}

/* Ouvrir un questionnaire ne doit pas donner huit mille pixels d'un coup.
   On plie donc les listes trop longues — mais « trop longue » ne se compte
   pas en cartes : une carte de profil, avec ses recommandations et leurs
   champs image, fait trois fois la hauteur d'une carte de question.
   Compter les cartes donnait huit questions pliées et quatre profils
   dépliés à huit mille pixels. On estime donc la matière.

   Les constantes viennent de mesures, pas d'intuitions : ~260 px pour
   l'ossature d'une question, ~90 par réponse ; ~420 pour un profil, ~300
   par recommandation. À deux écrans, on plie.                          */
const PLAFOND_DEPLIE = 1600;

function hauteurEstimee(liste, base, parEnfant, enfants) {
  return liste.reduce((total, item) => total + base + parEnfant * (item[enfants]?.length || 0), 0);
}

function plierSiLongue(quiz) {
  state.folded = new Set();
  const listes = [
    [quiz.questions, hauteurEstimee(quiz.questions, 260, 90, 'options')],
    [quiz.results, hauteurEstimee(quiz.results, 420, 300, 'recos')],
  ];
  for (const [liste, hauteur] of listes) {
    if (hauteur > PLAFOND_DEPLIE) for (const item of liste) state.folded.add(item.id);
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
  plierSiLongue(state.quiz);
  state.reach = null;
  /* Ouvrir un questionnaire, c'est descendre d'un niveau — et `select()` est
     le seul chemin pour y entrer. Poser la bascule ici plutôt que chez ses
     six appelants garantit qu'aucun n'oublie de la faire. */
  state.vue = 'quiz';
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

/* Ce que l'outil sait faire et que personne ne peut deviner. Six
   fonctions existaient sans qu'aucune ne soit annoncée nulle part — une
   capacité qu'on ignore n'existe pas. */
function afficherRaccourcis() {
  const ligne = (touches, quoi) => el('div', { class: 'sheet__row' }, [
    el('span', { class: 'raccourci', text: touches }),
    el('span', { class: 'sheet__label', text: quoi }),
  ]);

  const dialog = el('dialog', { class: 'modal sheet' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Raccourcis et gestes' }),

      el('span', { class: 'field__label', text: 'Dans le backoffice' }),
      el('div', { class: 'sheet__list' }, [
        ligne('Ctrl + Z', 'Annuler le dernier geste de structure — ajout, suppression, déplacement'),
        ligne('Ctrl + S', 'Forcer l’enregistrement (il est déjà automatique)'),
        ligne('⠿', 'Glisser pour réordonner : axes, questions, réponses, profils, recommandations'),
        ligne('Échap', 'Renoncer à un déplacement en cours'),
        ligne('▾', 'Replier une carte ; « Tout replier » agit sur la liste entière'),
      ]),

      el('span', { class: 'field__label', style: { marginTop: 'var(--s-4)' }, text: 'Dans le parcours, côté répondant' }),
      el('div', { class: 'sheet__list' }, [
        ligne('1 … 9', 'Choisir une réponse'),
        ligne('← →', 'Question précédente, question suivante'),
        ligne('Entrée', 'Valider et avancer'),
        ligne('Balayer', 'Au doigt : passer d’une question à l’autre'),
      ]),

      el('p', { class: 'field__hint', text: 'Tout se fait aussi à la souris et au clic.' }),
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Fermer', onClick: () => dismiss(dialog) }),
    ]),
  ]);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/* --- Paramètres du compte ---------------------------------------------------
   Tout ce qui concerne la personne connectée et son équipe, réuni hors du
   questionnaire : qui je suis, mon mot de passe, qui d'autre a accès, et
   la sortie. Ces choses ne dépendent pas du questionnaire ouvert, et
   n'avaient donc rien à faire dans le panneau qui sert à le diffuser. */
/* --- Deux objets, deux feuilles ------------------------------------------------
   L'espace et le compte étaient réglés dans la même fenêtre : elle
   s'intitulait « Espace « maupassant » » et contenait « Mot de passe ». Ce
   sont pourtant deux objets sans rapport — l'un appartient à l'équipe et
   survit à tous ses membres, l'autre appartient à une personne et la suit
   d'un espace à l'autre. Les mêler apprenait à chercher les réglages du
   kiosque derrière son propre nom, et rendait illisible ce qu'on partage.

   La coupure suit la propriété, pas la commodité :

     ESPACE — identité du kiosque, vitrine, corbeille, fréquentation, ÉQUIPE.
              Qui peut publier ici est une propriété du lieu, pas de moi.
     COMPTE — mon profil, mon mot de passe, mon identifiant, ma déconnexion.

   Chacune a sa porte : « Mon espace » dans le rail, le bouton nominatif dans
   la barre. Aucune des deux ne renvoie à l'autre — s'il faut un renvoi,
   c'est que la coupure est fausse.                                        */

function feuille(titre, sousTitre, contenu, actions) {
  /* Sans `aria-labelledby`, la feuille s'annonce « dialogue » et rien de
     plus : le titre est à l'écran mais n'est pas le nom du dialogue. Posé
     ici, dans le helper, il couvre toutes celles qui passent par lui. */
  const titreId = uid('titre');
  const dialog = el('dialog', { class: 'modal sheet', 'aria-labelledby': titreId }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { id: titreId, text: titre }),
      sousTitre && el('p', { class: 'panel__hint', text: sousTitre }),
      ...contenu,
    ]),
    el('div', { class: 'modal__actions' }, actions),
  ]);
  dialog.addEventListener('click', (event) => {
    const cible = event.target.closest('[data-act], [data-sheet]');
    if (!cible) return;
    /* La feuille se referme dans tous les cas : ce qu'on ouvre ensuite a sa
       propre fenêtre, et deux modales empilées ne se referment jamais
       proprement. */
    const action = cible.closest('[data-act]');
    dismiss(dialog, () => { if (action) onClick(event); });
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/* Ce qui appartient à la personne. Rien de l'espace n'y figure : le même
   compte peut servir dans plusieurs espaces, et ce profil-là les suit tous. */
function monCompte() {
  if (!state.remoteSession) return undefined;
  const moi = state.remoteSession.uid;
  const monP = state.profils?.[moi];
  const monNom = (monP && [monP.prenom, monP.nom].filter(Boolean).join(' ')) || null;

  return feuille('Mon compte', state.remoteSession.email, [
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'mon-profil',
        text: monNom ? `👤 ${monNom}` : '👤 Renseigner mon profil' }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'mon-mot-de-passe', text: '🔒 Mot de passe' }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'copier-uid', text: '⧉ Mon identifiant' }),
    ]),
    !monNom && el('p', { class: 'field__hint', text:
      'Sans profil, tes collègues te voient comme un identifiant technique.' }),
  ], [
    el('button', { class: 'btn btn--danger btn--sm', type: 'button', 'data-act': 'remote-signout', text: 'Se déconnecter' }),
    el('span', { class: 'section__spacer' }),
    el('button', { class: 'btn btn--quiet', type: 'button', 'data-sheet': 'close', text: 'Fermer' }),
  ]);
}

/* Ce qui appartient à l'équipe. L'équipe elle-même en fait partie : qui peut
   publier ici décrit le lieu, pas la personne connectée. */
/* Les deux files d'attente : ceux qu'on a conviés et qui ne sont pas encore
   venus, ceux qui se sont présentés et attendent un avis. Elles ne
   s'affichent que si elles ont quelque chose à dire — une équipe de trois
   personnes qui n'invite jamais ne doit pas lire deux titres vides à chaque
   ouverture.                                                             */
function filesDAttente() {
  const conviees = Object.entries(state.invitations || {});
  const presentees = Object.entries(state.demandes || {});
  if (!conviees.length && !presentees.length) return [];

  const titre = (texte) => el('h3', {
    style: 'font-size:var(--t-base);margin-top:var(--s-5);margin-bottom:var(--s-2)', text: texte,
  });

  const bloc = [];

  if (presentees.length) {
    bloc.push(titre(`Demandes d’accès — ${presentees.length}`));
    bloc.push(el('div', { class: 'sheet__list' }, presentees.map(([uid, d]) => el('div', { class: 'sheet__row' }, [
      el('span', { class: 'sheet__emoji', text: '🔔' }),
      el('span', { class: 'sheet__label' }, [
        el('span', { text: d?.prenom || 'Sans nom' }),
        el('span', { class: 'field__hint', style: { display: 'block' }, text: d?.courriel || uid }),
      ]),
      el('button', {
        class: 'btn btn--sm btn--primary', type: 'button',
        'data-act': 'demande-valider', 'data-id': uid, text: 'Accepter',
      }),
      el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        'data-act': 'demande-refuser', 'data-id': uid,
        title: 'Refuser cette demande', text: '✕',
      }),
    ]))));
    bloc.push(el('p', { class: 'field__hint', text:
      'Accepter donne le droit de publier ici. L’adresse est celle du compte, pas une saisie libre : la base refuse les demandes venues d’une adresse non confirmée.' }));
  }

  if (conviees.length) {
    bloc.push(titre(`Invitations en attente — ${conviees.length}`));
    bloc.push(el('div', { class: 'sheet__list' }, conviees.map(([clef, inv]) => el('div', { class: 'sheet__row' }, [
      el('span', { class: 'sheet__emoji', text: '✉️' }),
      el('span', { class: 'sheet__label' }, [
        /* La clé est l'adresse dont les points sont devenus des virgules :
           on la remet à l'endroit pour l'afficher. */
        el('span', { text: clef.replace(/,/g, '.') }),
        el('span', { class: 'field__hint', style: { display: 'block' },
          /* `le` est formaté seulement s'il est vraiment une date : sur une
             valeur inattendue, Intl lève et emporterait la feuille entière. */
          text: `conviée par ${nommer(inv?.par)}${Number.isFinite(inv?.le) ? ` · ${formatDate(inv.le)}` : ''}` }),
      ]),
      el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        'data-act': 'invitation-annuler', 'data-id': clef,
        title: 'Retirer cette invitation', text: '✕',
      }),
    ]))));
    bloc.push(el('p', { class: 'field__hint', text:
      'Tant qu’elle n’est pas réclamée, une invitation ne donne aucun droit.' }));
  }

  return bloc;
}

/* Les fiches restées derrière — le passif du correctif précédent.

   Depuis que `retirerMembre()` efface la fiche avec le droit, plus aucune ne
   s'échoue ici. Mais celles laissées AVANT ce changement y sont encore, et
   rien ne les nettoiera : le retrait qui aurait dû les emporter a déjà eu
   lieu. Elles restent lisibles par l'équipe, et leur porteur ne peut plus les
   atteindre — `profils` ne se lit qu'entre membres.

   La règle publiée permet désormais à un membre de les supprimer. Encore
   faut-il les voir : elles se déduisent sans rien demander à la base, un
   profil dont l'uid n'est ni dans `membres` ni dans `gerants` n'ayant plus de
   propriétaire dans cet espace.

   Pas de purge automatique. L'effacement ne se défait pas — la règle interdit
   d'écrire le profil d'autrui, c'est elle qui protège de l'usurpation — et il
   vaut mieux que quelqu'un le déclenche en lisant de qui il s'agit. La
   section disparaît d'elle-même quand il n'y a plus rien à montrer, comme les
   files d'attente. */
function fichesOrphelines() {
  const rattachees = new Set([
    ...(state.membres || []).map((m) => m.uid),
    ...(state.gerants || []),
  ]);
  const restees = Object.entries(state.profils || {}).filter(([uid]) => !rattachees.has(uid));
  if (!restees.length) return [];

  const ligne = ([uid, p]) => {
    const nom = [p?.prenom, p?.nom].filter(Boolean).join(' ');
    return el('div', { class: 'sheet__row' }, [
      el('span', { class: 'sheet__emoji', text: '👤' }),
      el('span', { class: 'sheet__label' }, [
        el('span', { text: nom || `${uid.slice(0, 6)}…`,
          title: nom ? null : uid,
          style: nom ? '' : 'font-family:var(--font-mono);font-size:var(--t-xs)' }),
        p?.poste && el('span', { class: 'field__hint', style: { display: 'block' }, text: p.poste }),
      ]),
      /* Sa vitrine, elle, ne nous appartient pas : elle porte un consentement
         public et crédite un travail fait. On le signale — c'est une chose
         qu'on ne peut apprendre nulle part ailleurs — sans prétendre pouvoir
         y toucher. */
      state.vitrines?.[uid] && el('span', { class: 'pill pill--accent',
        title: 'Encore nommée publiquement sur le kiosque. Elle seule peut l’y retirer.',
        text: 'public' }),
      el('button', {
        class: 'btn btn--icon btn--danger', type: 'button',
        'data-act': 'fiche-effacer', 'data-id': uid,
        title: 'Effacer cette fiche — sans retour',
        'aria-label': `Effacer la fiche de ${nom || 'ce compte'} — sans retour`,
        text: '✕',
      }),
    ]);
  };

  return [
    el('h3', { style: 'font-size:var(--t-base);margin-top:var(--s-5);margin-bottom:var(--s-2)',
      text: `Fiches d’anciens membres — ${restees.length}` }),
    el('div', { class: 'sheet__list' }, restees.map(ligne)),
    el('p', { class: 'field__hint', text:
      'Ces personnes ne font plus partie de l’espace et ne peuvent plus effacer leur fiche elles-mêmes : cet écran ne s’ouvre plus pour elles. Effacer ne se défait pas.' }),
  ];
}

/* L'équipe, en panneau plein écran plutôt qu'en feuille modale. Une liste de
   personnes à admettre ou à retirer n'est pas une parenthèse dans autre
   chose : c'est un des écrans de l'espace. */
function contenuEquipe() {
  const moi = state.remoteSession?.uid;
  if (!moi) {
    return [el('section', { class: 'panel' }, [
      el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon', text: '👥' }),
        el('p', { text: 'Il faut être connecté à un espace pour en voir l’équipe.' }),
      ]),
    ])];
  }

  const ligne = (m) => {
    const p = state.profils?.[m.uid];
    const nom = (p && [p.prenom, p.nom].filter(Boolean).join(' ')) || null;
    return el('div', { class: 'sheet__row' }, [
      el('span', { class: 'sheet__emoji', text: m.gerant ? '🔑' : '👤' }),
      el('span', { class: 'sheet__label' }, [
        /* Vingt-huit caractères de monospace ne désignent personne, et cette
           ligne est celle où l'on retire quelqu'un de l'espace. Six suffisent
           à distinguer deux comptes dans une équipe de médiathèque ; le reste
           est dans l'infobulle pour qui doit vraiment le lire. */
        el('span', { text: (nom || `${m.uid.slice(0, 6)}…`) + (m.uid === moi ? ' — toi' : ''),
          title: nom ? null : m.uid,
          style: nom ? '' : 'font-family:var(--font-mono);font-size:var(--t-xs)' }),
        p?.poste && el('span', { class: 'field__hint', style: { display: 'block' }, text: p.poste }),
        !p && el('span', { class: 'field__hint', style: { display: 'block' }, text: 'sans profil' }),
      ]),
      state.vitrines?.[m.uid] && el('span', { class: 'pill pill--accent',
        title: 'Cette personne a choisi d’être nommée publiquement.', text: 'public' }),
      m.gerant && el('span', { class: 'pill', title: 'Un gérant ne peut être retiré que depuis la console.', text: 'gérant' }),
      !m.gerant && m.uid !== moi && el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        'data-act': 'membre-retirer', 'data-id': m.uid,
        title: 'Retirer de l’espace', text: '✕',
      }),
    ]);
  };

  /* L'équipe se compte toujours au moins à un : la personne connectée en
     fait partie, sans quoi elle ne serait pas là. Un « 0 membre » affiché à
     quelqu'un qui est manifestement membre ne décrit pas l'équipe, il décrit
     une liste qu'on n'a pas su lire. */
  const nombre = Math.max(1, state.membres.length);
  const listeLue = state.membres.length > 0;

  return [
    el('section', { class: 'panel' }, [
      el('div', { class: 'section__head' }, [
        el('h2', { text: `Qui peut publier ici — ${nombre} membre${nombre > 1 ? 's' : ''}` }),
        el('span', { class: 'section__spacer' }),
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'inviter', text: '+ Inviter' }),
      ]),
      listeLue
        ? el('div', { class: 'sheet__list' }, state.membres.map(ligne))
        : el('p', { class: 'alerte', text:
            'La liste des membres n’a pas pu être lue. Recharge la page ; si le message revient, la base ne répond pas.' }),

      ...filesDAttente(),
      ...fichesOrphelines(),

      el('p', { class: 'field__hint', style: { marginTop: 'var(--s-4)' }, text:
        'Inviter envoie un courriel, ou dépose une invitation si l’adresse a déjà un compte. Retirer quelqu’un lui ôte le droit de publier ici, sans toucher à son compte.' }),
    ]),
  ];
}

/* L'espace n'a plus de panneau « Réglages ». Il ne contenait que deux boutons
   ouvrant deux fenêtres, et ses deux contenus sont retournés là où on les
   cherche : la corbeille dans les questionnaires, dont elle est l'archive de
   saison, et l'apparence du kiosque dans la vitrine, dont elle est le cadre.
   Un onglet qui n'est qu'un menu de menus n'est pas une section, c'est un
   détour.

   Ce chemin-ci reste : le bouton « Mon espace » du rail et l'écran vide y
   mènent, et il ouvre maintenant l'accueil de l'espace. */
function ouvrirLEspace() {
  state.ongletEspace = 'questionnaires';
  return allerA('espace');
}


/* --- Les noms d'exemple ------------------------------------------------------
   Un formulaire a besoin d'un nom pour montrer ce qu'il attend. Autant que ce
   soit une recommandation de plus : des autrices, tirées au sort à chaque
   ouverture. Celles qui ont ouvert des portes — la proto-science-fiction avant
   que le mot existe, les pulps, l'âge d'or, la fantasy — et quelques
   françaises qu'on cite trop peu.

   Rien ne l'explique à l'écran, et c'est voulu : qui reconnaît sourit, qui ne
   reconnaît pas voit un nom plausible d'agent de médiathèque. Une note de bas
   de page tuerait les deux.

   Les deux champs viennent du MÊME tirage — un « Ursula Sarrazin » serait un
   bel hommage à personne.                                                */

const AUTRICES = [
  { prenom: 'Margaret',  nom: 'Cavendish' },   // The Blazing World, 1666 — avant le mot
  { prenom: 'Mary',      nom: 'Shelley' },     // Frankenstein, 1818 — l'acte de naissance
  { prenom: 'Catherine', nom: 'Moore' },       // « Shambleau », 1933 — signait C. L. Moore
  { prenom: 'Leigh',     nom: 'Brackett' },    // reine du space opera, et L'Empire contre-attaque
  { prenom: 'Alice',     nom: 'Sheldon' },     // signait James Tiptree Jr., et personne ne le savait
  { prenom: 'Ursula',    nom: 'Le Guin' },     // La Main gauche de la nuit · Terremer
  { prenom: 'Joanna',    nom: 'Russ' },        // L'Autre moitié de l'homme
  { prenom: 'Octavia',   nom: 'Butler' },      // Kindred · La Parabole du semeur
  { prenom: 'Angélica',  nom: 'Gorodischer' }, // Kalpa impérial, que Le Guin a traduite
  { prenom: 'Élisabeth', nom: 'Vonarburg' },   // Chroniques du Pays des Mères
  { prenom: 'Joëlle',    nom: 'Wintrebert' },  // la SF française, depuis les années 1970
  { prenom: 'Albertine', nom: 'Sarrazin' },    // L'Astragale, 1965
  { prenom: 'Violette',  nom: 'Leduc' },       // La Bâtarde
  { prenom: 'Christiane',nom: 'Rochefort' },   // Les Petits Enfants du siècle
  { prenom: 'Anne',      nom: 'Garréta' },     // Sphinx — et l'Oulipo, comme Perec
];

function autriceAuHasard() {
  return AUTRICES[Math.floor(Math.random() * AUTRICES.length)];
}

/* Nommer quelqu'un de l'équipe. Le profil est lisible des seuls membres,
   ce qui suffit ici : dire « Albertine » à un collègue n'expose personne au
   public. Faute de profil, l'identifiant tronqué — dit comme tel plutôt
   que déguisé en nom.                                                   */
function nommer(uid) {
  /* Un identifiant manquant se dit ; il ne fait pas tomber le panneau qui
     l'affichait. Les règles exigent le champ, mais une donnée écrite à la
     main depuis la console n'en sait rien — et un utilitaire d'affichage
     n'est pas le bon endroit pour découvrir ça. */
  if (!uid) return 'quelqu’un dont l’identifiant manque';
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
function monProfil({ accueil = false } = {}) {
  const moi = state.remoteSession?.uid;
  if (!moi) return;
  const actuel = state.profils?.[moi] || {};
  const enVitrine = Boolean(state.vitrines?.[moi]);

  const exemple = autriceAuHasard();
  const prenom = el('input', { class: 'input', value: actuel.prenom || '', placeholder: exemple.prenom });
  const nom = el('input', { class: 'input', value: actuel.nom || '', placeholder: exemple.nom });
  const poste = el('input', { class: 'input', value: actuel.poste || '', placeholder: 'Responsable du secteur adulte' });
  const photo = el('input', { class: 'input input--mono', value: actuel.image || '', placeholder: 'https://… (facultatif)' });
  const publier = el('input', { type: 'checkbox' });
  publier.checked = enVitrine;

  const erreur = el('p', { class: 'alerte', role: 'alert', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Enregistrer' });

  const titreId = uid('titre');
  const titre = el('h2', { id: titreId, text: 'Mon profil' });
  const dialog = el('dialog', { class: 'modal', 'aria-labelledby': titreId }, [
    el('div', { class: 'modal__body stack' }, [
      titre,
      /* Ouverte d'elle-même, la fenêtre doit porter ce qui l'amène.
         L'identifiant tronqué y suffit : c'est exactement ce que l'équipe
         lit à la place d'un nom. */
      el('p', { class: 'panel__hint', text: accueil
        ? `Tu apparais comme « ${moi.slice(0, 8)}… » — dans l’équipe, et sous les questionnaires que tu publies.`
        : 'Te nomme auprès de ton équipe. Visible des seuls membres de cet espace.' }),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Prénom' }), prenom]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Nom' }), nom]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Fonction' }), poste]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Photo' }), photo,
        el('span', { class: 'field__hint', text: 'Adresse d’une image.' }),
      ]),

      el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [
        el('label', { class: 'row', style: { alignItems: 'flex-start', gap: 'var(--s-3)' } }, [
          publier,
          el('span', {}, [
            el('strong', { text: 'Afficher mon nom publiquement' }),
            el('span', { class: 'field__hint', style: { display: 'block' }, text:
              'Coché, ton nom, ta fonction et ta photo deviennent lisibles par toute personne qui connaît le nom de l’espace. Décocher les efface.' }),
            /* Ce que la case promet et ce qu'elle fait ne sont pas tout à
               fait la même chose, et l'écart est celui que la CNIL regarde :
               « mon nom apparaît sous mes questionnaires » d'un côté, « la
               fiche est lisible en bloc, sans compte, à une adresse stable »
               de l'autre. Le dire ici, au moment de cocher. */
          ]),
        ]),
      ]),

      el('p', { class: 'field__hint', text: 'Être crédité demande les deux : cette case, et un questionnaire qui te nomme.' }),
      erreur,
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button',
        text: accueil ? 'Plus tard' : 'Annuler', onClick: () => dismiss(dialog) }),
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
      await remote.enregistrerProfil(state.espace, moi, profil);
      /* La vitrine ne reprend que ce que la personne a saisi, et n'existe
         que si elle l'a demandé. Décocher efface. */
      await remote.publierVitrine(state.espace, moi, publier.checked ? normaliserVitrine({
        nom: [profil.prenom, profil.nom].filter(Boolean).join(' '),
        poste: profil.poste,
        image: profil.image,
      }) : null);
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
  /* Ouverte d'elle-même, la fenêtre commence par son titre : le curseur posé
     dans le prénom fait défiler une fenêtre courte, et la ligne qui dit ce
     qui l'amène sort de l'écran. Le titre prend le focus, la tabulation
     descend dans le formulaire. */
  if (accueil) { titre.setAttribute('tabindex', '-1'); titre.focus({ preventScroll: true }); }
  else prenom.focus();
}

/* Se nommer ne s'atteignait que par le bouton de compte, dont le seul indice
   est l'adresse e-mail de la personne connectée : un profil qu'on ne sait pas
   manquant ne se cherche pas. Faute de l'avoir trouvé, une équipe se lit en
   identifiants tronqués — dans la liste des membres, et sous chaque
   questionnaire qu'elle publie.

   La proposition vient donc à la personne, à l'ouverture, tant qu'elle n'a
   pas de fiche. « Plus tard » referme pour cette fois ; la connexion suivante
   la repose, et sans serveur c'est le seul rappel dont nous disposions. */
function proposerMonProfil() {
  if (state.profilPropose) return;
  const moi = state.remoteSession?.uid;
  /* Membre, et su comme tel : les règles refusent le profil d'un compte qui
     n'est pas de l'équipe, et qui frappe encore à la porte a son propre
     chemin dans le rail. */
  if (!state.espace || !moi || state.membre !== true) return;
  if (state.profils?.[moi]?.prenom) return;
  state.profilPropose = true;
  monProfil({ accueil: true });
}

/* Inviter : créer le compte, faire envoyer le courriel, inscrire la
   personne. Le mot de passe initial est un secret aléatoire jeté sur
   place — nous ne sommes à aucun moment en possession de ce qui
   l'authentifie, et c'est elle qui choisira le sien.

   Si l'adresse a déjà un compte, rien côté client ne permet d'en
   retrouver l'identifiant : on le demande, plutôt que d'échouer. */
function inviter() {
  const invitee = autriceAuHasard();
  const email = el('input', {
    class: 'input', type: 'email',
    placeholder: `${slugify(invitee.prenom).slice(0, 1)}.${slugify(invitee.nom)}@mediatheque.fr`,
  });
  const uidChamp = el('input', { class: 'input input--mono', placeholder: 'son identifiant, s’il a déjà un compte' });
  const info = el('p', { class: 'panel__hint', hidden: true });
  const erreur = el('p', { class: 'alerte', role: 'alert', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Inviter' });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: `Inviter dans « ${state.espace} »` }),
      el('p', { class: 'panel__hint', text: 'La personne reçoit un courriel et choisit son mot de passe elle-même.' }),
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
      /* Deux échecs très différents mènent au même recours.

         EMAIL_EXISTS : le cas le plus banal — un collègue déjà inscrit dans
         un autre espace — était le plus pénible, il fallait lui réclamer
         vingt-huit caractères par un autre canal.

         RESEAU : ce poste ne joint pas le service de comptes. Or déposer une
         invitation n'en a PAS besoin — c'est une écriture dans la base, qui
         répond. Échouer ici reviendrait à refuser le seul geste encore
         possible sous prétexte qu'un autre est impossible. */
      if (err.code === 'EMAIL_EXISTS' || err.code === 'RESEAU') {
        const bloque = err.code === 'RESEAU';
        info.hidden = true;
        try {
          await remote.inviterParCourriel(state.espace, adresse, state.remoteSession.uid);
          await refreshEspace();
          dismiss(dialog, () => {
            /* On ne laisse pas croire que tout s'est bien passé quand une
               moitié a échoué : sans service de comptes, ni la création ni
               le courriel n'ont eu lieu, et l'invitation ne servira qu'à
               quelqu'un qui a déjà un compte. */
            toast(bloque
              ? `Invitation déposée pour ${adresse}. Aucun compte n’a pu être créé ni aucun courriel envoyé depuis ce poste : elle ne servira que si cette personne a déjà un compte RecoHero.`
              : `Invitation déposée pour ${adresse}.`, bloque ? { duration: 9000 } : '');
            repaint();
          });
          return;
        } catch (secondErr) {
          erreur.textContent = bloque
            ? `${err.message} L’invitation n’a pas pu être déposée non plus : ${secondErr.message}`
            : `Cette adresse a déjà un compte, et l’invitation n’a pas pu être déposée : ${secondErr.message} `
              + 'Tu peux encore l’ajouter directement en collant son identifiant dans le second champ.';
          uidChamp.focus();
        }
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
/* Sans « Annuler » : la règle qui autorise ce geste n'autorise QUE la
   suppression, jamais l'écriture du profil d'autrui. Rien ne pourrait le
   rétablir, et proposer un retour qu'on ne tiendrait pas serait pire que de
   n'en proposer aucun. D'où le bouton peint en danger, et la phrase qui le
   dit avant. */
async function effacerFicheOrpheline(uid) {
  const p = state.profils?.[uid];
  const nom = (p && [p.prenom, p.nom].filter(Boolean).join(' ')) || 'La fiche';
  try {
    await remote.effacerProfil(state.espace, uid);
    await refreshEspace();
    repaint();
    toast(`${nom} — fiche effacée.`);
  } catch (err) {
    toast(err.message, 'danger');
  }
  return undefined;
}

async function retirerMembre(uid) {
  const avaitUneFiche = Boolean(state.profils?.[uid]);
  try {
    await remote.retirerMembre(state.espace, uid);
    /* La fiche part avec le droit, et dans cet ordre : la règle n'autorise sa
       suppression QUE lorsque l'uid ne figure plus dans `membres`.

       Sans ça, elle restait. Son porteur ne pouvait plus l'effacer — `profils`
       ne se lit qu'entre membres, l'écran ne s'ouvrait plus pour lui — et
       personne d'autre n'en avait le droit. Un prénom, un nom, une fonction et
       une photo demeuraient lisibles indéfiniment par une équipe dont la
       personne ne faisait plus partie, sans qu'aucun geste ne puisse les
       retirer. Un échec ici ne doit pas défaire le retrait lui-même : le droit
       de publier est ce qui compte, la fiche se rattrapera. */
    if (avaitUneFiche) await remote.effacerProfil(state.espace, uid).catch(() => {});
    await refreshEspace();
    repaint();
    toast(avaitUneFiche ? 'Membre retiré, et sa fiche effacée.' : 'Membre retiré de l’espace.', {
      action: {
        label: 'Annuler',
        onClick: async () => {
          await remote.ajouterMembre(state.espace, uid);
          await refreshEspace();
          repaint();
          /* On ne promet pas ce qu'on ne rend pas : le droit revient, la fiche
             non — la règle interdit d'écrire le profil d'autrui, et c'est elle
             qui empêche de se faire passer pour un collègue. */
          toast(avaitUneFiche
            ? 'Membre rétabli. Sa fiche est à renseigner de nouveau.'
            : 'Membre rétabli.');
        },
      },
    });
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/* Accepter quelqu'un, c'est deux écritures : le droit d'abord, la file
   ensuite. Dans cet ordre — si la seconde échoue, la personne est entrée et
   sa demande traîne, ce qui se répare d'un clic. L'ordre inverse effacerait
   la demande sans donner le droit, et il ne resterait plus trace de rien à
   quoi se raccrocher.                                                    */
async function validerDemande(uid) {
  try {
    await remote.ajouterMembre(state.espace, uid);
    await remote.retirerDemande(state.espace, uid).catch(() => {});
    await refreshEspace();
    repaint();
    toast(`${nommer(uid)} peut publier dans cet espace.`);
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function refuserDemande(uid) {
  const garde = state.demandes?.[uid];
  try {
    await remote.retirerDemande(state.espace, uid);
    await refreshEspace();
    repaint();
    /* Refuser ne dit rien à la personne — la base n'envoie pas de courriel
       et nous n'avons pas de serveur pour le faire. Autant l'écrire : croire
       qu'un refus a été notifié, c'est laisser quelqu'un attendre. */
    toast('Demande écartée. Elle n’en sera pas avertie.', {
      action: garde && {
        label: 'Annuler',
        onClick: async () => {
          await remote.demanderAcces(state.espace, uid, garde).catch(() => {});
          await refreshEspace();
          repaint();
        },
      },
    });
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function annulerInvitation(clef) {
  try {
    await remote.annulerInvitation(state.espace, clef.replace(/,/g, '.'));
    await refreshEspace();
    repaint();
    toast('Invitation retirée.');
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/* --- Entrer, quand on n'est pas encore de la maison ------------------------ */

async function rejoindreLEspace() {
  try {
    await remote.ajouterMembre(state.espace, state.remoteSession.uid);
    await remote.annulerInvitation(state.espace, state.remoteSession.email).catch(() => {});
    await refreshEspace();
    repaint();
    toast('Te voilà chez toi.');
    proposerMonProfil();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/* Une demande arrive chez des gens qui ne savent pas forcément qui vous
   êtes. Un identifiant de vingt-huit caractères ne le leur dira pas : on
   demande un prénom, une fois, et c'est tout ce qu'on demande.          */
function demanderLAcces() {
  const { uid, email } = state.remoteSession;
  const invitee = autriceAuHasard();
  const champ = el('input', {
    class: 'input', value: state.profils?.[uid]?.prenom || '',
    placeholder: invitee.prenom,
  });
  const erreur = el('p', { class: 'alerte', role: 'alert', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Envoyer la demande' });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: `Demander l’accès à « ${state.espace} »` }),
      el('p', { class: 'panel__hint', text:
        `L’équipe verra ta demande en ouvrant l’espace, avec ton prénom et ton adresse (${email}). Elle accepte, ou non — et si elle refuse, tu n’en seras pas averti.` }),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Ton prénom' }), champ]),
      erreur,
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', text: 'Fermer', onClick: () => dismiss(dialog) }),
      valider,
    ]),
  ]);

  valider.addEventListener('click', async () => {
    const prenom = champ.value.trim();
    if (!prenom) { champ.focus(); return; }
    valider.disabled = true;
    erreur.hidden = true;
    try {
      await remote.demanderAcces(state.espace, uid, { prenom, courriel: email });
      await refreshEspace();
      dismiss(dialog, () => {
        toast('Demande envoyée. Un membre de l’équipe la verra en ouvrant l’espace.');
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
  champ.focus();
}

async function verifierMonCourriel() {
  try {
    await remote.envoyerCourrielVerification();
    toast(`Courriel envoyé à ${state.remoteSession.email}. Regarde aussi dans les indésirables.`);
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function changerMonMotDePasse() {
  const champ = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const erreur = el('p', { class: 'alerte', role: 'alert', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Changer' });

  const dialog = el('dialog', { class: 'modal' }, [
    el('div', { class: 'modal__body stack' }, [
      el('h2', { text: 'Changer mon mot de passe' }),
      el('p', { class: 'panel__hint', text: 'Six caractères au minimum. Il ne transite que vers Firebase, jamais vers ce site.' }),
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


/* --- L'apparence publique de l'espace ----------------------------------------
   Ce qu'une médiathèque montre à ses usagers. Sans cette branche, son
   kiosque affiche NOTRE marque — elle diffuse notre identité à son public
   en croyant diffuser la sienne.

   Le titre est le seul champ nécessaire : sans lui il n'y a pas d'identité,
   et le kiosque garde la nôtre, ce qui vaut mieux qu'une page anonyme. */

/* Elle était une fenêtre atteinte depuis un bouton d'un onglet « Réglages » :
   trois clics pour arriver au seul écran qui décide si le kiosque porte le
   nom de la médiathèque ou le nôtre. Une médiathèque dont l'adjointe à la
   culture ouvre le lien et lit « RecoHero » a payé cet enfouissement.

   Elle est maintenant une section de l'onglet Vitrine, où elle a toujours eu
   sa place : la vitrine range ce que le kiosque montre, l'apparence dit à
   quoi il ressemble. Même objet public, même écran.

   Le panneau se garde comme celui de la vitrine, et pour la même raison :
   `repaint()` remplace le DOM, et une saisie en cours ne doit pas disparaître
   parce qu'on a enregistré l'ordre des vignettes juste à côté. */
function sectionApparence() {
  if (state.apparencePanneau) return state.apparencePanneau;
  const actuelle = state.identite || {};

  const titre = el('input', { class: 'input', value: actuelle.titre || '', placeholder: 'Médiathèque Maupassant', maxlength: '80' });
  const accroche = el('input', { class: 'input', value: actuelle.accroche || '', placeholder: 'Trois minutes, et vous repartez avec une idée', maxlength: '160' });
  const intro = el('textarea', { class: 'textarea', rows: '3', placeholder: 'Deux phrases d’accueil, facultatives.', maxlength: '600' });
  intro.value = actuelle.intro || '';
  /* Le signe du bandeau, à défaut de logo. Toutes les structures n'ont pas
     un fichier image sous la main, et le repli était NOTRE ✦ : elles
     diffusaient notre marque en croyant diffuser la leur. Le même
     dictionnaire que partout ailleurs — on ne demande à personne de savoir
     taper un emoji sur un poste de travail. */
  const signe = el('input', {
    class: 'input signe__champ', value: actuelle.emoji || '', maxlength: '4',
    placeholder: '🏛', style: 'text-align:center', 'aria-label': 'Signe du bandeau',
  });
  const signeOuvrir = el('button', {
    class: 'btn btn--icon btn--quiet signe__ouvrir', type: 'button', text: '⊞',
    title: 'Choisir un emoji', 'aria-label': 'Choisir un emoji',
    onClick: () => choisirSigne({
      mode: 'emoji',
      actuel: signe.value.trim(),
      poser: (valeur) => { signe.value = valeur; },
    }),
  });
  const logo = el('input', { class: 'input input--mono', value: actuelle.logo || '', placeholder: 'https://… (facultatif)' });
  const accent = el('input', { class: 'swatch-input', type: 'color', value: actuelle.accent || '#2E6BA8' });
  const retourUrl = el('input', { class: 'input input--mono', value: actuelle.retour?.url || '', placeholder: 'https://mediatheque.fr' });
  const retourLib = el('input', { class: 'input', value: actuelle.retour?.libelle || '', placeholder: 'Retour au site de la médiathèque', maxlength: '60' });
  const pied = el('input', { class: 'input', value: actuelle.pied || '', placeholder: 'Médiathèque Maupassant · Mentions légales', maxlength: '200' });

  const erreur = el('p', { class: 'alerte', role: 'alert', hidden: true });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Enregistrer' });
  const apercu = el('button', { class: 'btn btn--ghost', type: 'button', text: '▷ Voir le kiosque' });

  /* Une seule lecture du formulaire, partagée par l'aperçu et l'enregistrement.
     Normalisée AVANT de servir, comme elle le sera à la lecture : ce qui ne
     passe pas le filtre ne doit ni partir dans la base, ni s'afficher dans un
     aperçu qui prétend montrer le résultat. */
  const lireLeFormulaire = () => normaliserIdentite({
    titre: titre.value, accroche: accroche.value, intro: intro.value,
    emoji: signe.value, logo: logo.value, accent: accent.value, pied: pied.value,
    retour: { url: retourUrl.value.trim(), libelle: retourLib.value },
  });

  const panneau = el('section', { class: 'panel' }, [
    el('div', { class: 'section__head' }, [el('h2', { text: 'Apparence du kiosque' })]),
    el('p', { class: 'panel__hint', text:
      'Ce que voient les usagers en arrivant. Ce qu’on laisse vide reste à RecoHero.' }),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Nom de la structure' }), titre]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Accroche' }), accroche,
      el('span', { class: 'field__hint', text: 'Le grand titre de la page.' }),
    ]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Mot d’accueil' }), intro]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Signe' }),
      el('span', { class: 'signe', style: { maxWidth: '7rem' } }, [signe, signeOuvrir]),
      el('span', { class: 'field__hint', text:
        'Remplace le ✦ de RecoHero dans le bandeau, quand il n’y a pas de logo.' }),
    ]),
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Logo' }), logo,
      el('span', { class: 'field__hint', text:
        'Prend la place du signe. Un SVG en ligne (data:) est refusé : donnez une adresse https, ou un PNG.' }),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Couleur' }),
      el('div', { class: 'row' }, [accent]),
    ]),
    el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [
      el('span', { class: 'field__label', text: 'Lien de retour' }),
      el('span', { class: 'field__hint', style: { display: 'block', marginBottom: 'var(--s-3)' }, text:
        'Remplace le bouton « Backoffice » dans le bandeau.' }),
      retourUrl, el('div', { style: { height: 'var(--s-2)' } }), retourLib,
    ]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Pied de page' }), pied]),
    erreur,
    el('div', { class: 'panel__actions' }, [
      actuelle.titre && el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Rendre l’apparence par défaut',
        onClick: () => enregistrerIdentite(null, valider, erreur) }),
      el('span', { class: 'section__spacer' }),
      apercu,
      valider,
    ]),
    el('p', { class: 'field__hint', text:
      'L’aperçu ouvre le kiosque tel qu’il sera, sans rien enregistrer. La couleur y repeint tout — c’est là qu’on voit si elle tient.' }),
  ]);

  /* L'aperçu ouvre la VRAIE page avec l'identité dans son fragment, comme
     « Tester » ouvre le vrai parcours avec son questionnaire. Un cadre
     embarqué demanderait d'ouvrir `frame-src` dans la politique de sécurité
     de cette page ; une reconstitution dériverait du kiosque au premier
     changement de CSS, et un aperçu qui ment est pire que pas d'aperçu. */
  apercu.addEventListener('click', () => {
    const propre = lireLeFormulaire();
    if (!propre) {
      erreur.textContent = 'Le nom de la structure est nécessaire, même pour un aperçu : sans lui, le kiosque garde le nôtre.';
      erreur.hidden = false;
      return;
    }
    erreur.hidden = true;
    const cible = new URL(avecEspace('index.html', state.espace), location.href);
    cible.hash = `apercu=${encodeURIComponent(JSON.stringify(propre))}`;
    window.open(cible.toString(), '_blank', 'noopener');
  });

  valider.addEventListener('click', () => {
    if (!titre.value.trim()) {
      erreur.textContent = 'Le nom de la structure est nécessaire : c’est lui qui remplace le nôtre.';
      erreur.hidden = false;
      return;
    }
    const propre = lireLeFormulaire();
    if (retourUrl.value.trim() && !propre.retour) {
      erreur.textContent = 'Le lien de retour doit être une adresse complète, en http:// ou https://.';
      erreur.hidden = false;
      return;
    }
    enregistrerIdentite(propre, valider, erreur);
  });

  state.apparencePanneau = panneau;
  return panneau;
}

async function enregistrerIdentite(valeurs, valider, erreur) {
  valider.disabled = true;
  try {
    await remote.enregistrerIdentite(state.espace, valeurs);
    /* `refreshEspace()` jette le panneau gardé : il se rebâtira sur ce qui
       vient d'être enregistré, et non sur ce qu'on avait tapé. */
    await refreshEspace();
    toast(valeurs ? 'Le kiosque porte désormais votre identité.' : 'Le kiosque a repris l’apparence par défaut.');
    repaint();
  } catch (err) {
    erreur.textContent = err.message;
    erreur.hidden = false;
    valider.disabled = false;
  }
}

/* --- La corbeille de l'espace -------------------------------------------------
   Retirer de l'espace déplace ici plutôt que de détruire. C'était le seul
   geste du produit qui ne s'annulait pas, et le dépôt s'en avouait démuni :
   « une suppression dans un espace est définitive, et rien ne la rattrape ».

   Le plafond est tenu à l'écriture, pas par une expiration : sans serveur,
   personne ne fait le ménage à minuit, et une promesse que rien n'exécute
   vaudrait moins que ce plafond-là. */

/* Les trois gestes, sortis de leur fenêtre. Ils vivent maintenant dans le
   panneau des questionnaires, donc ils passent par l'aiguillage délégué
   comme tout le reste : un écouteur posé à la main sur un contenu de panneau
   ne survivrait pas au premier `repaint()`, qui remplace le DOM entier. */
async function restaurerDeLaCorbeille(id) {
  if (!state.remoteSession) return showSignIn();
  try {
    const repris = await remote.restaurerQuiz(state.espace, id);
    await refreshEspace();
    toast(`« ${repris.title} » est de retour sur le kiosque.`);
    repaint();
  } catch (err) {
    toast(err.message, 'danger');
  }
  return undefined;
}

/* Le seul geste du produit qui ne s'annule pas — la corbeille EST le chemin
   de retour des autres, et rien ne rattrape celui-ci. D'où le bouton peint
   en danger plutôt qu'un « ✕ » de renvoi. */
async function jeterDeLaCorbeille(id) {
  if (!state.remoteSession) return showSignIn();
  try {
    await remote.jeterDefinitivement(state.espace, id);
    await refreshEspace();
    toast('Supprimé définitivement.');
    repaint();
  } catch (err) {
    toast(err.message, 'danger');
  }
  return undefined;
}

async function viderLaCorbeille() {
  if (!state.remoteSession) return showSignIn();
  try {
    await remote.viderCorbeille(state.espace);
    await refreshEspace();
    toast('Corbeille vidée.');
    repaint();
  } catch (err) {
    toast(err.message, 'danger');
  }
  return undefined;
}


/* --- La fréquentation de l'espace ---------------------------------------------
   Rien de neuf n'est collecté ici : `debuts`, `total` et la répartition par
   profil sont écrits depuis toujours, questionnaire par questionnaire. Ils
   ne s'affichaient qu'un questionnaire à la fois, dans l'éditeur — donc
   jamais au moment où l'on se demande ce qui marche.

   Ce qu'on se refuse à montrer : une courbe. Les compteurs sont des entiers
   cumulés, sans date. En fabriquer une demanderait d'horodater chaque
   parcours, donc d'écrire QUAND quelqu'un a répondu. Le projet a choisi de
   n'écrire que des nombres ; une jolie courbe ne vaut pas qu'on revienne
   là-dessus.                                                              */

function tauxDe(s) {
  if (!s?.debuts) return null;
  return Math.min(100, Math.round(((s.total || 0) / s.debuts) * 100));
}

/* Le même refus que pour la répartition des profils — sauf qu'il n'était
   appliqué que là. Le taux d'achèvement s'affichait dès le premier départ
   compté, et passait en rouge sous 50 % : un abandon sur deux départs peignait
   une alerte, et le premier chiffre qu'une bibliothécaire voit après sa mise
   en ligne était le moins fiable de tous. Sous le seuil, on montre les deux
   nombres et on ne peint rien. */
function assezDeDeparts(s) {
  return (s?.debuts || 0) >= PETIT_ECHANTILLON;
}

const TROP_PEU_DE_DEPARTS =
  ` Trop peu pour un pourcentage (${PETIT_ECHANTILLON} départs minimum).`;

function contenuFrequentation() {
  if (!state.remoteSession) {
    return [el('section', { class: 'panel' }, [
      el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon', text: '📊' }),
        el('p', { text: 'Il faut être connecté à un espace pour lire sa fréquentation.' }),
      ]),
    ])];
  }

  const lignes = state.remote.map((quiz) => ({ quiz, s: state.stats?.[quiz.id] || {} }))
    .sort((a, b) => (b.s.total || 0) - (a.s.total || 0));

  const cumul = lignes.reduce((acc, { s }) => ({
    debuts: acc.debuts + (s.debuts || 0),
    total: acc.total + (s.total || 0),
  }), { debuts: 0, total: 0 });

  const chiffre = (valeur, libelle) => el('span', { class: 'etat__item' }, [
    el('strong', { class: 'etat__valeur', text: String(valeur) }),
    el('span', { class: 'etat__libelle', text: libelle }),
  ]);

  /* --- La répartition des profils ---------------------------------------------
     « 2 profils jamais atteints » disait qu'il y avait un problème sans dire
     lequel. Or c'est LA question que l'on se pose devant des compteurs : mon
     questionnaire différencie-t-il vraiment, ou renvoie-t-il tout le monde au
     même endroit ?

     Aucune donnée nouvelle n'est collectée : `stats.profils` compte déjà les
     arrivées par profil depuis toujours. Elle ne se voyait simplement pas.

     Deux refus que le projet s'impose déjà ailleurs et qui valent ici. Pas de
     pourcentage sous trente parcours — à sept, « 14 % » désigne une personne :
     on montre alors le nombre brut. Et la jauge se mesure au profil le plus
     servi, pas au total : c'est l'écart ENTRE profils qu'on vient lire. */
  const repartition = ({ quiz, s }) => {
    const total = s.total || 0;
    if (!total || !quiz.results.length) return null;

    const parts = quiz.results.map((r) => ({ r, n: s.profils?.[r.id] || 0 }));
    const assez = total >= PETIT_ECHANTILLON;
    const sommet = Math.max(1, ...parts.map((p) => p.n));
    /* Un profil qui rafle presque tout n'est pas une faute en soi — un
       « par défaut » bien écrit peut légitimement dominer. On le signale
       comme une chose à regarder, pas comme une erreur, et seulement quand
       l'échantillon permet de l'affirmer. */
    const domine = assez && parts.find((p) => p.n / total >= 0.6);

    return el('div', { class: 'freq' }, [
      ...parts.map(({ r, n }) => el('div', { class: 'freq__ligne' + (n ? '' : ' is-jamais') }, [
        el('span', { class: 'freq__nom', text: r.title.trim() || 'Profil sans titre' }),
        el('span', { class: 'freq__barre' }, [
          el('span', { class: 'freq__jauge', style: { width: `${(n / sommet) * 100}%` } }),
        ]),
        el('span', {
          class: 'freq__part',
          title: `${n} parcours sur ${total}`,
          text: n === 0 ? 'jamais' : (assez ? `${Math.round((n / total) * 100)} %` : String(n)),
        }),
      ])),
      !assez && el('p', { class: 'freq__note', text:
        `${total} parcours : trop peu pour des pourcentages, on montre les nombres.` }),
      domine && el('p', { class: 'freq__alerte', text:
        `« ${domine.r.title.trim() || 'Un profil'} » recueille ${Math.round((domine.n / total) * 100)} % des résultats. `
        + 'Les autres sortent rarement — à vérifier du côté des pesées, ou des conditions de déclenchement.' }),
    ]);
  };

  const ligne = ({ quiz, s }) => {
    const taux = tauxDe(s);
    /* Les profils que personne n'atteint : ce que l'auteur cherche
       vraiment quand il regarde des compteurs. On ne le dit que si le
       questionnaire a servi — à zéro parcours, tous les profils sont
       « jamais atteints », et le signaler serait du bruit. */
    const jamais = (s.total || 0) > 0
      ? quiz.results.filter((r) => !(s.profils?.[r.id] > 0)).length
      : 0;

    return el('div', { class: 'freq__bloc' }, [el('div', { class: 'sheet__row' }, [
      el('span', { class: 'sheet__emoji', text: quiz.emoji || '✦' }),
      el('span', { class: 'sheet__label' }, [
        el('span', { text: quiz.title }),
        el('span', { class: 'field__hint', style: { display: 'block' }, text:
          /* « 0 commencé · 12 terminés » se lirait comme une anomalie. Un
             questionnaire mis en ligne avant le comptage des départs n'a
             pas zéro départ : il n'en a aucun de connu. On ne dit alors
             que ce qu'on sait. */
          (s.debuts ? `${s.debuts} commencé${s.debuts > 1 ? 's' : ''} · ` : '')
          + `${s.total || 0} terminé${(s.total || 0) > 1 ? 's' : ''}`
          + (jamais ? ` · ${jamais} profil${jamais > 1 ? 's' : ''} jamais atteint${jamais > 1 ? 's' : ''}` : '') }),
      ]),
      taux === null
        ? el('span', { class: 'pill', title: 'Ce questionnaire a été mis en ligne avant le comptage des départs.', text: '—' })
        : el('span', {
            class: 'pill' + (assezDeDeparts(s) && taux < 50 ? ' pill--warn' : ''),
            title: `${s.total || 0} parcours terminés sur ${s.debuts} commencés.`
              + (assezDeDeparts(s) ? '' : TROP_PEU_DE_DEPARTS),
            text: assezDeDeparts(s) ? `${taux} %` : `${s.total || 0}/${s.debuts}`,
          }),
    ]), repartition({ quiz, s })]);
  };

  const tauxGlobal = tauxDe(cumul);

  /* En lecture seule, donc rien à enregistrer ni à abandonner : le passage en
     panneau ne coûte que la suppression du pied de fenêtre. C'est aussi la
     conversion qui gagne le plus à la largeur — des jauges de répartition
     rognées à 27 rem se lisaient mal. */
  return [el('section', { class: 'panel' }, [
    el('div', { class: 'section__head' }, [el('h2', { text: 'Fréquentation' })]),

    lignes.length ? el('div', { class: 'etat', style: { marginBottom: 'var(--s-4)' } }, [
      chiffre(cumul.debuts, cumul.debuts > 1 ? 'parcours commencés' : 'parcours commencé'),
      chiffre(cumul.total, cumul.total > 1 ? 'terminés' : 'terminé'),
      tauxGlobalItem(tauxGlobal, cumul),
    ].filter(Boolean)) : null,

    lignes.length
      ? el('div', { class: 'sheet__list' }, lignes.map(ligne))
      : el('p', { class: 'panel__hint', text: 'Aucun questionnaire en ligne : rien à compter.' }),

    el('p', { class: 'field__hint', style: { marginTop: 'var(--s-4)' }, text:
      'Un ordre de grandeur : répondre ne demande pas de compte, rien n’empêche de gonfler un compteur. Les essais depuis l’éditeur ne comptent pas.' }),
  ])];
}

/* Le taux global ne s'affiche que si des départs ont été comptés — sinon
   il vaudrait 100 % sur des questionnaires antérieurs au compteur, ce qui
   serait faux et flatteur. */
function tauxGlobalItem(taux, cumul) {
  if (taux === null) return null;
  const assez = assezDeDeparts(cumul);
  return el('span', {
    class: 'etat__item' + (assez && taux < 50 ? ' etat__item--erreur' : ''),
    title: `${cumul.total || 0} parcours terminés sur ${cumul.debuts} commencés.`
      + (assez ? '' : TROP_PEU_DE_DEPARTS),
  }, [
    el('strong', { class: 'etat__valeur',
      text: assez ? `${taux} %` : `${cumul.total || 0}/${cumul.debuts}` }),
    el('span', { class: 'etat__libelle', text: 'terminés' }),
  ]);
}


/* --- La vitrine de l'espace ---------------------------------------------------
   L'ordre des questionnaires sur le kiosque, ceux qu'on en retire sans les
   détruire, et celui qu'on met à la une.

   Retirer de la vitrine n'est PAS dépublier : jusqu'ici, cacher un
   questionnaire saisonnier demandait de le sortir de l'espace, c'est-à-dire
   de le supprimer. Masquer le laisse en ligne, à son adresse, pour qui a le
   lien — il ne figure simplement plus sur la page d'accueil.

   Le glisser-déposer est celui de l'éditeur (`sortable.js`), et les flèches
   ↑↓ restent à côté : c'est le chemin clavier, il ne disparaît pas.      */

/* La vitrine est la seule des cinq à porter une TRANSACTION : on réordonne,
   on masque, on épingle — et rien ne part au kiosque avant « Enregistrer ».
   Réordonner ce que voient les usagers n'est pas une frappe au clavier, ça se
   décide ; l'enregistrement continu de l'éditeur de questionnaire serait ici
   un contresens.

   D'où un pied d'actions collant plutôt qu'un pied de fenêtre, et une
   confirmation si l'on quitte l'onglet sans avoir enregistré. Une fenêtre
   modale retenait au moins tant qu'on ne l'avait pas fermée ; un panneau qui
   perdrait le travail en silence serait une régression.

   Le panneau est construit UNE fois et gardé : `renderPanel()` s'exécute à
   chaque repeinte, et le rebâtir jetterait le brouillon à la première. */
function contenuVitrine() {
  if (!state.remoteSession) {
    return [el('section', { class: 'panel' }, [el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', text: '▦' }),
      el('p', { text: 'Il faut être connecté à un espace pour régler sa vitrine.' }),
    ])])];
  }
  /* L'apparence d'abord : elle décrit le lieu, la vitrine range ce qu'on y
     pose. Et elle doit rester atteignable sans aucun questionnaire en ligne —
     on nomme sa médiathèque avant de publier, pas après. */
  const apparence = sectionApparence();

  if (!state.remote.length) {
    return [apparence, el('section', { class: 'panel' }, [el('div', { class: 'empty' }, [
      el('div', { class: 'empty__icon', text: '▦' }),
      el('p', { text: 'Cet espace n’a aucun questionnaire en ligne : il n’y a pas encore de vitrine à ranger.' }),
    ])])];
  }
  if (state.vitrinePanneau) return [apparence, state.vitrinePanneau];

  /* On travaille sur une copie : tant qu'on n'a pas enregistré, le kiosque
     ne bouge pas. */
  const brouillon = {
    ordre: ordreCourant(),
    masques: new Set(state.presentation.masques),
    epingle: state.presentation.epingle,
    sections: new Map(state.presentation.sections),
  };

  const corps = el('div', { class: 'stack' });
  const valider = el('button', { class: 'btn btn--primary', type: 'button', text: 'Enregistrer' });
  const etat = el('span', { class: 'field__hint' });
  const panneau = el('section', { class: 'panel' }, [
    el('div', { class: 'section__head' }, [el('h2', { text: 'Vitrine du kiosque' })]),
    corps,
    el('div', { class: 'panel__actions' }, [
      el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-vitrine': 'defaut', text: 'Rendre l’ordre alphabétique' }),
      el('span', { class: 'section__spacer' }),
      etat,
      el('button', {
        class: 'btn btn--quiet', type: 'button', text: 'Annuler',
        onClick: () => { state.vitrineSale = false; oublierVitrine(); repaint(); },
      }),
      valider,
    ]),
  ]);

  /* Un brouillon modifié se signale : sans cela, le pied ressemble à celui
     d'un écran déjà à jour, et on quitte sans y penser. */
  const salir = () => {
    state.vitrineSale = true;
    etat.textContent = 'Modifications non enregistrées';
  };

  const dessiner = () => {
    const parId = new Map(state.remote.map((q) => [q.id, q]));
    const liste = brouillon.ordre.map((id) => parId.get(id)).filter(Boolean);

    corps.replaceChildren(
      el('h2', { text: `La vitrine de « ${state.espace} »` }),
      el('p', { class: 'panel__hint', text:
        'L’ordre du kiosque, de haut en bas. Masquer retire de l’accueil sans dépublier : le lien direct répond toujours.' }),

      el('div', { class: 'editor-list', 'data-sortable': 'vitrine' }, liste.flatMap((quiz, i) => {
        const masque = brouillon.masques.has(quiz.id);
        const alaune = brouillon.epingle === quiz.id;
        const titre = brouillon.sections.get(quiz.id);

        /* L'intertitre se pose SUR le questionnaire qui ouvre la section :
           il n'est donc pas une ligne à part dans l'ordre, mais une
           propriété de cette ligne-là. Le glisser-déposer n'a rien à
           apprendre, et l'ordre reste une simple liste d'identifiants. */
        const entete = titre !== undefined ? el('div', { class: 'vitrine__entete' }, [
          el('input', {
            class: 'input', value: titre, maxlength: '60',
            placeholder: 'En ce moment', 'aria-label': 'Intertitre de section',
            'data-vitrine-titre': quiz.id,
          }),
          el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button',
            'data-vitrine': 'section-retirer', 'data-id': quiz.id,
            title: 'Retirer cet intertitre', text: '✕',
          }),
        ]) : null;

        const ligne = el('div', { class: 'sheet__row' + (masque ? ' is-masque' : '') }, [
          el('span', { class: 'grip', title: 'Glisser pour déplacer', 'aria-hidden': 'true', text: '⠿' }),
          el('span', { class: 'sheet__emoji', text: quiz.emoji || '✦' }),
          el('span', { class: 'sheet__label' }, [
            el('span', { text: quiz.title }),
            masque && el('span', { class: 'field__hint', style: { display: 'block' }, text: 'masqué du kiosque' }),
          ]),
          el('button', {
            class: 'btn btn--icon btn--quiet' + (alaune ? ' is-on' : ''),
            type: 'button', 'data-vitrine': 'une', 'data-id': quiz.id,
            title: alaune ? 'Retirer de la une' : 'Mettre à la une',
            'aria-pressed': String(alaune), text: '★',
          }),
          el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button',
            'data-vitrine': 'masquer', 'data-id': quiz.id,
            title: masque ? 'Remettre sur le kiosque' : 'Masquer du kiosque',
            'aria-pressed': String(masque), text: masque ? '◌' : '●',
          }),
          el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button', 'data-vitrine': 'monter', 'data-id': quiz.id,
            title: 'Monter', 'aria-label': 'Monter', text: '↑', ...(i === 0 ? { disabled: true } : {}),
          }),
          el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button', 'data-vitrine': 'descendre', 'data-id': quiz.id,
            title: 'Descendre', 'aria-label': 'Descendre', text: '↓', ...(i === liste.length - 1 ? { disabled: true } : {}),
          }),
          titre === undefined && el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button',
            'data-vitrine': 'section-ouvrir', 'data-id': quiz.id,
            title: 'Ouvrir une section ici', 'aria-label': 'Ouvrir une section ici', text: '§',
          }),
        ]);

        return entete ? [entete, ligne] : [ligne];
      })),

      el('p', { class: 'field__hint', text:
        'Le § ouvre une section : son intertitre coiffe les questionnaires qui suivent, jusqu’au prochain. Un questionnaire publié plus tard se range à la fin.' }),
    );

    bindSortables(corps, (cle, de, vers) => {
      if (cle !== 'vitrine' || de === vers) return;
      brouillon.ordre.splice(vers, 0, brouillon.ordre.splice(de, 1)[0]);
      dessiner();
    });
  };

  const deplacer = (id, delta) => {
    const de = brouillon.ordre.indexOf(id);
    const vers = de + delta;
    if (de < 0 || vers < 0 || vers >= brouillon.ordre.length) return;
    brouillon.ordre.splice(vers, 0, brouillon.ordre.splice(de, 1)[0]);
  };

  panneau.addEventListener('click', async (event) => {
    const cible = event.target.closest('[data-vitrine]');
    if (!cible) return;
    const { vitrine, id } = cible.dataset;

    if (vitrine === 'masquer') {
      brouillon.masques.has(id) ? brouillon.masques.delete(id) : brouillon.masques.add(id);
      /* Un questionnaire masqué ne peut pas être à la une : les deux se
         contrediraient à l'écran, et c'est le masque qui gagnerait. */
      if (brouillon.masques.has(id) && brouillon.epingle === id) brouillon.epingle = null;
      salir(); return dessiner();
    }
    if (vitrine === 'une') {
      brouillon.epingle = brouillon.epingle === id ? null : id;
      if (brouillon.epingle) brouillon.masques.delete(brouillon.epingle);
      salir(); return dessiner();
    }
    if (vitrine === 'monter') { deplacer(id, -1); salir(); return dessiner(); }
    if (vitrine === 'descendre') { deplacer(id, 1); salir(); return dessiner(); }
    if (vitrine === 'section-ouvrir') { brouillon.sections.set(id, ''); salir(); return dessiner(); }
    if (vitrine === 'section-retirer') { brouillon.sections.delete(id); salir(); return dessiner(); }
    if (vitrine === 'defaut') {
      brouillon.ordre = [...state.remote].sort((a, b) => a.title.localeCompare(b.title, 'fr')).map((q) => q.id);
      brouillon.masques = new Set();
      brouillon.epingle = null;
      brouillon.sections = new Map();
      salir(); return dessiner();
    }
    return undefined;
  });

  /* La frappe d'un intertitre ne redessine pas : un redessin déplacerait le
     curseur du champ à chaque lettre. On écrit dans le brouillon, et c'est
     tout — même règle que l'éditeur de questionnaire. */
  corps.addEventListener('input', (event) => {
    const champ = event.target.closest('[data-vitrine-titre]');
    if (!champ) return;
    brouillon.sections.set(champ.dataset.vitrineTitre, champ.value);
    salir();
  });

  valider.addEventListener('click', async () => {
    valider.disabled = true;
    try {
      await remote.enregistrerPresentation(state.espace, presentationPourLaBase(brouillon));
      await refreshEspace();
      state.vitrineSale = false;
      oublierVitrine();
      toast('La vitrine du kiosque est enregistrée.');
      repaint();
    } catch (err) {
      valider.disabled = false;
      toast(err.message, 'danger');
    }
  });

  dessiner();
  state.vitrinePanneau = panneau;
  return [apparence, panneau];
}

/* Jeter le panneau gardé : au prochain passage, il se reconstruit sur les
   données fraîches. Appelé après enregistrement, après abandon, et chaque
   fois que l'espace est rechargé — un brouillon d'ordre bâti sur une liste
   périmée rangerait des questionnaires qui n'existent plus. */
function oublierVitrine() {
  state.vitrinePanneau = null;
  state.vitrineSale = false;
  /* Le formulaire d'apparence se garde pour la même raison et se jette au
     même moment : il tient les valeurs de `state.identite`, et l'espace
     rechargé peut en apporter d'autres. */
  state.apparencePanneau = null;
}

/* L'ordre à éditer : celui qui est enregistré, complété par ce qui a été
   publié depuis — et débarrassé de ce qui n'existe plus. */
function ordreCourant() {
  const presents = new Set(state.remote.map((q) => q.id));
  const connus = state.presentation.ordre.filter((id) => presents.has(id));
  const restants = [...state.remote]
    .filter((q) => !connus.includes(q.id))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
    .map((q) => q.id);
  return [...connus, ...restants];
}

/* --- Diffusion --------------------------------------------------------------------- */

async function testRun() {
  flush();
  const url = await linkFor(state.quiz, 'quiz.html');
  const [adresse, charge] = url.split('#');
  /* L'espace voyage avec l'essai : sans lui, la sortie du parcours de test
     ramènerait au backoffice du dépôt et non à celui de l'équipe. */
  const essai = avecEspace(`${adresse}?test=1`, state.espace);
  window.open(`${essai}#${charge}`, '_blank', 'noopener');
}

/* Deux formes d'adresse, et une seule est supportable à transmettre.

   Un questionnaire SERVI quelque part — au kiosque du dépôt ou dans un espace
   — a une adresse de soixante caractères qui le désigne, et qui suit ses
   corrections. Un brouillon n'existe nulle part ailleurs : son contenu voyage
   dans le fragment, gzippé, et le lien fait alors près de quatre mille
   caractères.

   Cette fonction prenait TOUJOURS la seconde forme, même quand la première
   existait. On copiait 3 695 caractères là où 66 suffisaient — cinquante-six
   fois trop, au-delà de ce qu'une messagerie transporte sans le couper, et
   avec l'allure d'un lien qu'on n'ouvre pas. `embedSnippet()` faisait déjà le
   bon choix quelques lignes plus bas ; c'est la même règle, remontée ici. */
function adresseDuQuestionnaire() {
  const auKiosque = state.published.some((q) => q.id === state.quiz.id);
  const dansLEspace = state.remote.some((q) => q.id === state.quiz.id);
  if (!auKiosque && !dansLEspace) return null;

  const court = new URL(`quiz.html?q=${encodeURIComponent(state.quiz.id)}`, location.href);
  if (dansLEspace) court.searchParams.set('espace', state.espace);
  return court.toString();
}

async function copyLink() {
  flush();
  const court = adresseDuQuestionnaire();
  const url = court || await linkFor(state.quiz);
  const ok = await copy(url);
  if (!ok) return toast('Copie impossible.', 'danger');
  /* On dit LAQUELLE des deux on vient de copier : la différence se voit au
     collage, et une surprise à ce moment-là coûte un envoi raté. */
  return toast(court
    ? 'Lien copié.'
    : 'Lien copié — il emporte tout le questionnaire, d’où sa longueur. Publiez-le pour obtenir une adresse courte.',
    court ? '' : { duration: 7000 });
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
      el('p', { class: 'panel__hint', text: 'Le script ajuste la hauteur du cadre au fil des questions. Sans lui, le parcours défile dans 720 px. En iframe, le navigateur peut refuser le stockage : la reprise et l’historique tombent, le reste tient.' }),
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-embed': 'close', text: 'Fermer' }),
      el('button', { class: 'btn btn--primary', type: 'button', 'data-embed': 'copy', text: 'Copier le code' }),
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

/* Quitter la vitrine avec des modifications en attente demande confirmation.
   La fenêtre modale d'avant retenait tant qu'on ne l'avait pas fermée ; un
   panneau qu'on quitte d'un clic sur un onglet n'a pas ce garde-fou naturel,
   il faut le poser. */
function quitterLaVitrine() {
  if (state.ongletEspace !== 'vitrine' || !state.vitrineSale) return true;
  const partir = window.confirm(
    'La vitrine a des modifications non enregistrées. Les abandonner ?',
  );
  if (partir) oublierVitrine();
  return partir;
}

/* Changer de niveau redessine AUSSI le bandeau : c'est lui qui porte le fil
   d'Ariane et le retour, et `repaint()` ne s'en occupe pas — il a été écrit
   pour un backoffice qui n'avait qu'un seul écran. */
function allerA(vue) {
  state.vue = vue;
  repaint();
  renderTopbar();
}

async function refreshEspace() {
  forgetEspace();
  /* Le brouillon de vitrine est bâti sur `state.remote` : le garder après un
     rechargement rangerait des questionnaires qui ont pu disparaître. */
  oublierVitrine();
  state.remote = await loadEspace(state.espace);
  await releverLAppartenance();
  [state.profils, state.vitrines, state.stats, state.identite, state.corbeille] = await Promise.all([
    state.remoteSession ? remote.profilsEquipe(state.espace).catch(() => ({})) : {},
    remote.vitrines(state.espace),
    state.remoteSession ? remote.stats(state.espace).catch(() => ({})) : {},
    remote.identite(state.espace).then(normaliserIdentite).catch(() => null),
    state.remoteSession ? remote.corbeille(state.espace).catch(() => []) : [],
  ]);
  state.presentation = normaliserPresentation(
    await remote.presentation(state.espace).catch(() => null),
  );
  await verifierGardeFou();
}

/* Suis-je de l'équipe ? La question n'a pas deux réponses mais trois, et
   c'est tout l'enjeu : membre, pas membre, ou pas su. Confondre les deux
   dernières faisait dire au backoffice « tu es bien membre » à quelqu'un qui
   venait de se voir refuser la lecture — un message faux, adressé
   précisément à qui avait besoin d'un message juste.

   Un refus des règles répond « non ». Une panne réseau ne répond rien : on
   laisse alors `membre` à null, et l'écran dit qu'il n'a pas pu lire, sans
   prétendre trancher.                                                   */
async function releverLAppartenance() {
  state.membres = [];
  state.membre = null;
  state.invitations = {};
  state.demandes = {};
  state.monEntree = null;
  if (!state.remoteSession) return;

  try {
    ({ liste: state.membres, gerants: state.gerants } = await remote.membres(state.espace));
    state.membre = true;
  } catch (err) {
    if (!err.refus) return;      /* la base n'a pas répondu : on ne conclut pas */
    state.membre = false;
  }

  if (state.membre) {
    [state.invitations, state.demandes] = await Promise.all([
      remote.invitations(state.espace).catch(() => ({})),
      remote.demandes(state.espace).catch(() => ({})),
    ]);
    return;
  }

  /* Pas membre : reste à savoir par quelle porte cette personne peut
     entrer. Les deux lectures sont permises aux non-membres — chacune ne
     porte que sur soi. */
  const { email, uid } = state.remoteSession;
  const [invitation, demande, verifie] = await Promise.all([
    remote.monInvitation(state.espace, email),
    remote.maDemande(state.espace, uid),
    remote.courrielVerifie().catch(() => false),
  ]);
  state.monEntree = { invitation, demande, verifie };
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
        proposerMonProfil();
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

/* --- L'envoi ------------------------------------------------------------------
   Publier, c'est envoyer. La fiche se plie en avion et part.

   C'est un SUPPLÉMENT, au sens strict du projet : la publication a déjà
   abouti quand la surcouche apparaît, et le bandeau de confirmation dit ce
   qui s'est passé. Si rien de tout ceci ne s'exécute, il ne manque rien.

   Le mouvement réduit se lit ici plutôt qu'en CSS parce qu'il ne s'agit pas
   d'atténuer une animation mais de ne pas construire un objet dont c'est
   la seule raison d'être — même geste que les points qui volent dans le
   parcours.                                                                */
const MOUVEMENT_REDUIT = window.matchMedia?.('(prefers-reduced-motion: reduce)');

/* La géométrie du pliage, calculée sur les dimensions RÉELLES de la carte.

   Elle était figée en pourcentages dans le CSS, pour une feuille de
   150 × 96. Une carte de backoffice n'a ni cette taille ni ce rapport, et
   un pli à 45° n'est à 45° que si les unités des deux axes sont égales :
   tout se recalcule donc à partir de la largeur et de la demi-hauteur.

   `L` est la largeur, `h` la demi-hauteur — la moitié qui se replie. Le
   premier pli rabat un carré de côté `h` ; le second suit la bissectrice,
   qui sort du papier à `L − 2,414 h` (la cotangente de 22,5°).

   D'où la seule condition : il faut `L > 2,414 h`, c'est-à-dire une carte
   plus large que 1,21 fois sa hauteur. En dessous, le second pli sortirait
   du papier — on ne plie pas, plutôt que de plier faux.              */
const ORI_COT_225 = 2.4142;

function oriGeometrie(L, H) {
  const h = H / 2;
  const pc = (x, total) => `${(x / total) * 100}%`;
  const xCoin = L - h;                    /* où le pli 1 coupe le bord haut  */
  const xPli2 = L - ORI_COT_225 * h;      /* où le pli 2 coupe le bord haut  */

  /* Le décalage anti-crénelage PROLONGE l'arête au-delà du coin ; il ne
     déplace pas le coin, sous peine d'ouvrir une fente sur le pli. */
  const d = 1.2;
  const ax = xPli2 + 0.3827 * d;
  const ay = -0.9239 * d;
  const bx = L + ORI_COT_225 * 2;
  const by = h + 2;

  return {
    h,
    coinH: `polygon(100% 0, ${pc(xCoin, L)} 0, 100% 100%)`,
    coinB: `polygon(100% 100%, ${pc(xCoin, L)} 100%, 100% 0)`,
    faceH: `polygon(${pc(xCoin, L)} 0, ${pc(xPli2, L)} 0, 100% 100%)`,
    faceB: `polygon(${pc(xCoin, L)} 100%, ${pc(xPli2, L)} 100%, 100% 0)`,
    panH: `polygon(${pc(ax, L)} ${pc(ay, h)}, ${pc(bx, L)} ${pc(by, h)}, -1% 101%, -1% ${pc(ay, h)})`,
    panB: `polygon(${pc(ax, L)} ${pc(h - ay, h)}, ${pc(bx, L)} ${pc(h - by, h)}, -1% -1%, -1% ${pc(h - ay, h)})`,
    origineCoin: `${pc(L - h / 2, L)} 50%`,
  };
}

/* Chaque morceau porte un CLONE de la vraie carte, posé à la même place :
   la découpe du morceau tranche donc la carte sur le pli, et chaque
   fragment part avec son volet. C'est la carte elle-même qui se plie —
   une feuille de papier qui la représenterait ne serait qu'une image. */
/* Rend une promesse tenue quand le vol est fini et la carte rendue à l'écran.
   Les trois sorties anticipées la rendent DÉJÀ TENUE : l'appelant attend ce
   vol avant de redessiner, et une promesse jamais tenue — chez quelqu'un qui
   a coupé les animations, sur une carte trop carrée — lui gèlerait le
   panneau au lieu de lui épargner un mouvement. */
function envolerLaFiche(carte) {
  if (MOUVEMENT_REDUIT?.matches || !carte) return Promise.resolve();

  const rect = carte.getBoundingClientRect();
  const L = Math.round(rect.width);
  const H = Math.round(rect.height);
  if (!L || !H) return Promise.resolve();

  /* UNE FEUILLE SE PLIE DANS SA LONGUEUR, quelle que soit son orientation.
     Le pliage est décrit une seule fois, dans un repère toujours couché —
     largeur `Lw`, hauteur `Lh` — et c'est le repère qui pivote quand la
     carte est haute. Les cartes de ce backoffice le sont presque toutes :
     celle de l'espace fait 328 × 488. Décrire deux pliages symétriques
     aurait doublé la géométrie et les occasions de la faire diverger.

     Le clone, lui, tourne en sens inverse : le papier bascule, la carte
     reste droite. C'est bien elle qu'on voit se plier, pas une image
     couchée sur le côté. */
  const debout = H > L;
  const Lw = debout ? H : L;
  const Lh = debout ? L : H;
  if (Lw <= ORI_COT_225 * (Lh / 2)) return Promise.resolve();  /* trop carrée */

  const g = oriGeometrie(Lw, Lh);

  const copie = (cote) => {
    const clone = carte.cloneNode(true);
    /* Un clone traîne les identifiants de l'original et ses champs restent
       atteignables au clavier. On les neutralise : cette carte-là n'est
       plus qu'une image de papier. */
    clone.removeAttribute('id');
    for (const n of clone.querySelectorAll('[id]')) n.removeAttribute('id');
    return el('div', {
      class: 'ori-copie',
      style: {
        width: `${L}px`,
        height: `${H}px`,
        top: cote === 'h' ? '0' : `${-g.h}px`,
        ...(debout ? { transformOrigin: '0 0', transform: `translate(0, ${L}px) rotate(-90deg)` } : {}),
      },
    }, [clone]);
  };

  const papier = (cote, forme, clip, extra = '') => el('div', {
    class: `ori-papier ${forme}${extra ? ` ${extra}` : ''}`,
    style: { clipPath: clip },
  }, [copie(cote)]);

  const moitie = (cote) => el('div', {
    class: `ori-moitie ori-moitie--${cote}`,
    style: { height: `${g.h}px`, ...(cote === 'b' ? { top: `${g.h}px` } : {}) },
  }, [
    papier(cote, `ori-pan--${cote}`, cote === 'h' ? g.panH : g.panB),
    el('div', { class: `ori-pli ori-pli--${cote}` }, [
      papier(cote, `ori-face--${cote}`, cote === 'h' ? g.faceH : g.faceB),
      papier(cote, `ori-coin--${cote}`, cote === 'h' ? g.coinH : g.coinB, 'ori-coin'),
    ]),
    el('div', {
      class: `ori-voile ori-voile--${cote}`,
      style: { clipPath: cote === 'h' ? g.panH : g.panB },
    }),
  ]);

  const couche = el('div', { class: 'envoi', 'aria-hidden': 'true', inert: '' }, [
    el('div', {
      class: 'envoi__scene',
      style: { left: `${rect.left}px`, top: `${rect.top}px`, width: `${L}px`, height: `${H}px` },
    }, [
      el('div', { class: 'envoi__ombre' }),
      /* Le pivot porte l'orientation, la feuille garde son animation : deux
         transformations sur le même élément se seraient écrasées. */
      el('div', {
        class: 'ori-pivot',
        style: {
          width: `${Lw}px`, height: `${Lh}px`,
          left: `${(L - Lw) / 2}px`, top: `${(H - Lh) / 2}px`,
          ...(debout ? { transform: 'rotate(90deg)' } : {}),
        },
      }, [
        el('div', { class: 'ori-feuille' }, [moitie('h'), moitie('b')]),
      ]),
    ]),
  ]);
  /* L'origine du pli des coins dépend de la carte : elle se pose après
     coup, sur les deux volets. */
  document.body.append(couche);
  /* La copie prend la place de l'original le temps du vol. Sans ça, on pliait
     une feuille posée sur une carte restée visible : le pli se lisait comme
     un repli sur soi, et non comme un départ. */
  carte.classList.add('est-envolee');
  for (const coin of couche.querySelectorAll('.ori-coin')) {
    coin.style.transformOrigin = g.origineCoin;
  }

  /* On attend la FIN de l'animation la plus longue plutôt qu'un délai
     recopié à la main : une durée écrite deux fois finit toujours par
     diverger. Un filet de sécurité retire la couche quoi qu'il arrive —
     une animation ne progresse pas dans un onglet qui ne compose pas, et
     sa promesse ne se résoudrait alors jamais. */
  const feuille = couche.querySelector('.ori-feuille');
  return new Promise((fini) => {
    let retiree = false;
    const retirer = () => {
      if (retiree) return;
      retiree = true;
      clearTimeout(secours);
      /* La carte revient AVANT que la promesse soit tenue : si la publication
         échoue après l'envol, le panneau n'est jamais redessiné, et une carte
         restée invisible serait un écran mort. */
      carte.classList.remove('est-envolee');
      couche.remove();
      fini();
    };
    const secours = setTimeout(retirer, 6000);
    feuille.getAnimations?.().forEach((a) => a.finished.then(retirer, retirer));
  });
}

/* --- L'assistant de création ---------------------------------------------------
   « + Nouveau questionnaire » ouvrait l'éditeur complet sur un document qui
   s'annonçait déjà en échec : dix lignes de diagnostic, quatre en rouge, et
   des valeurs que personne n'avait choisies — « Nouveau questionnaire »,
   « Axe 1 », « Axe 2 », « Axe 3 ». Le premier écran d'un outil ne devrait pas
   être une liste de fautes qu'on n'a pas commises.

   Trois questions, et pas une de plus. Chacune doit gagner sa place : elle
   remplace une valeur par défaut que l'auteur aurait dû corriger de toute
   façon, et elle porte SES mots, pas les nôtres.

   CE QUE L'ASSISTANT NE FAIT PAS, et c'est le point : il ne rédige rien. Pas
   d'accroche suggérée, pas de question modèle, pas de profil tout écrit. La
   personne devant cet écran fait un métier d'écriture et de médiation ; lui
   souffler ses phrases serait lui dire qu'on le fait mieux qu'elle. On règle
   la charpente, elle écrit.

   Le nombre d'axes est la décision la plus lourde du questionnaire — elle
   commande les profils, les règles et toutes les pesées — et elle se prenait
   en silence, à trois. C'est la seule qu'on insiste pour poser.           */

const AXES_MIN = 2;
/* Dix, soit la palette entière. Au-delà, deux axes partageraient une
   couleur ; l'éditeur, lui, n'a jamais posé de plafond — l'assistant n'est
   qu'un point de départ, et rien n'empêche d'en ajouter ensuite. */
const AXES_MAX = 10;

function assistantCreation() {
  const choix = { type: 'livre', titre: '', axes: ['', '', ''] };
  let etape = 0;

  const corps = el('div', { class: 'modal__body stack' });
  const pied = el('div', { class: 'modal__actions' });
  const dialog = el('dialog', { class: 'modal' }, [corps, pied]);

  const creer = () => {
    const quiz = makeQuiz({
      title: choix.titre.trim() || 'Questionnaire sans titre',
      typeParDefaut: choix.type,
    });
    quiz.axes = choix.axes.map((nom, i) => ({ ...makeAxis(i), label: nom.trim() || `Axe ${i + 1}` }));
    quiz.questions = [makeQuestion(quiz.axes)];
    /* Un seul profil, et c'est le filet. Le défaut ordinaire — « axe
       dominant » sur le premier axe — laisserait sans résultat quiconque
       penche ailleurs, tant qu'il n'y a qu'une sortie. Le filet, lui, est
       juste dès le premier jour et le reste. */
    quiz.results = [{
      ...makeResult([], choix.type),
      rule: { mode: 'fallback', axis: null, min: 0, max: 999 },
    }];

    store.saveDraft(quiz);
    dismiss(dialog, () => {
      select(quiz.id);
      /* On atterrit sur les questions : les axes sont nommés, le titre est
         posé, il ne reste qu'à écrire — c'est là que le travail commence. */
      state.panel = 'questions';
      flush();
      renderRail();
      renderPanel();
      renderTopbar();
      toast(`« ${quiz.title} » est prêt à écrire.`);
    });
  };

  const dessiner = () => {
    corps.replaceChildren();
    pied.replaceChildren();

    corps.append(el('p', { class: 'field__hint', text: `Étape ${etape + 1} sur 3` }));

    if (etape === 0) {
      corps.append(
        el('h2', { text: 'Qu’avez-vous envie de faire découvrir ?' }),
        el('p', { class: 'panel__hint', text: 'Préremplit le type des nouvelles recommandations. Chacune peut en changer.' }),
        el('div', { class: 'row', style: { flexWrap: 'wrap', marginTop: 'var(--s-3)' } },
          RECO_TYPES.filter((t) => t.id !== 'autre').map((t) => el('button', {
            class: 'btn btn--sm ' + (choix.type === t.id ? 'btn--primary' : 'btn--ghost'),
            type: 'button', 'data-pas': 'type', 'data-valeur': t.id,
            text: `${t.icon} ${t.label}`,
          }))),
      );
      pied.append(
        el('button', { class: 'btn btn--quiet', type: 'button', 'data-pas': 'fermer', text: 'Annuler' }),
        el('button', { class: 'btn btn--primary', type: 'button', 'data-pas': 'suivant', text: 'Suivant →' }),
      );
    }

    if (etape === 1) {
      const champ = el('input', {
        class: 'input', value: choix.titre, maxlength: '120',
        placeholder: 'Quel roman pour cet été ?', 'aria-label': 'Titre du questionnaire',
      });
      champ.addEventListener('input', () => { choix.titre = champ.value; });
      champ.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); etape = 2; dessiner(); }
      });
      corps.append(
        el('h2', { text: 'Comment s’appelle-t-il ?' }),
        el('p', { class: 'panel__hint', text: 'Ce que vos usagers verront, sur la vignette comme sur l’affiche.' }),
        el('div', { style: { marginTop: 'var(--s-3)' } }, [champ]),
      );
      pied.append(
        el('button', { class: 'btn btn--quiet', type: 'button', 'data-pas': 'retour', text: '← Retour' }),
        el('button', { class: 'btn btn--primary', type: 'button', 'data-pas': 'suivant', text: 'Suivant →' }),
      );
      setTimeout(() => champ.focus(), 0);
    }

    if (etape === 2) {
      const lignes = el('div', { class: 'stack', style: { marginTop: 'var(--s-3)' } },
        choix.axes.map((nom, i) => {
          const champ = el('input', {
            class: 'input', value: nom, maxlength: '60',
            placeholder: ['Le Ressac', 'Le Grand Large', 'La Loupe', 'La Veilleuse', 'Le Détour', 'Le Fil'][i] || `Tempérament ${i + 1}`,
            'aria-label': `Tempérament ${i + 1}`,
          });
          champ.addEventListener('input', () => { choix.axes[i] = champ.value; });
          return el('div', { class: 'row' }, [
            champ,
            choix.axes.length > AXES_MIN && el('button', {
              class: 'btn btn--icon btn--quiet', type: 'button',
              'data-pas': 'axe-moins', 'data-valeur': String(i),
              title: 'Retirer ce tempérament', text: '✕',
            }),
          ]);
        }));

      corps.append(
        el('h2', { text: 'Quels tempéraments voulez-vous distinguer ?' }),
        el('p', { class: 'panel__hint', text: 'Ce que vos questions vont compter. Deux suffisent ; au-delà de quatre, l’équilibre devient difficile à tenir.' }),
        lignes,
        choix.axes.length < AXES_MAX && el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', 'data-pas': 'axe-plus',
          style: { marginTop: 'var(--s-2)' }, text: '+ Un tempérament',
        }),
      );
      pied.append(
        el('button', { class: 'btn btn--quiet', type: 'button', 'data-pas': 'retour', text: '← Retour' }),
        el('button', { class: 'btn btn--primary', type: 'button', 'data-pas': 'creer', text: 'Créer le questionnaire' }),
      );
    }
  };

  dialog.addEventListener('click', (event) => {
    const pas = event.target.closest('[data-pas]');
    if (!pas) return;
    const { valeur } = pas.dataset;
    switch (pas.dataset.pas) {
      case 'type':      choix.type = valeur; dessiner(); break;
      case 'suivant':   etape += 1; dessiner(); break;
      case 'retour':    etape -= 1; dessiner(); break;
      case 'axe-plus':  choix.axes.push(''); dessiner(); break;
      case 'axe-moins': choix.axes.splice(Number(valeur), 1); dessiner(); break;
      case 'creer':     creer(); break;
      default:          dismiss(dialog); break;
    }
  });
  dialog.addEventListener('close', () => dialog.remove());

  dessiner();
  document.body.append(dialog);
  dialog.showModal();
  return undefined;
}

/* --- La liste des cotes -------------------------------------------------------
   Ce qu'on emporte dans les rayons avant d'ouvrir. Le champ `location` est
   saisi dans l'éditeur et n'apparaissait NULLE PART ailleurs dans le
   backoffice — il ne ressortait qu'au dos du parcours, chez l'usager. Or
   c'est le seul champ qui transforme une recommandation en prêt : si le
   document n'est pas en rayon, le kiosque envoie quelqu'un vers une étagère
   vide, et personne dans l'équipe ne peut le savoir sans rouvrir chaque
   recommandation.

   Ce n'est PAS une image, contrairement à l'affiche : une cote se relit, se
   copie, se coche au crayon. Du texte, donc, imprimable tel quel.

   Ce que la liste ne fait pas : juger. Elle ne dit pas qu'il « manque » des
   cotes ni qu'un questionnaire serait incomplet — elle sépare ce qui en a de
   ce qui n'en a pas, et c'est à la personne de décider si ça compte. Une
   recommandation d'exposition ou de podcast n'a aucune raison d'en porter. */
function listeDesCotes() {
  flush();
  const quiz = state.quiz;
  if (!quiz) return undefined;

  let total = 0;
  let cotees = 0;

  const ligne = (reco) => {
    const cote = reco.location?.trim();
    total += 1;
    if (cote) cotees += 1;
    const type = RECO_TYPES.find((t) => t.id === reco.type);
    const meta = [reco.creator, reco.year].filter(Boolean).join(', ');
    return el('tr', { class: cote ? null : 'cotes__orpheline' }, [
      el('td', { class: 'cotes__cote', text: cote || '—' }),
      el('td', {}, [
        el('span', { class: 'cotes__titre', text: reco.title || 'Sans titre' }),
        meta && el('span', { class: 'cotes__meta', text: ` — ${meta}` }),
      ]),
      el('td', { class: 'cotes__type', text: type ? type.label : '' }),
    ]);
  };

  const groupes = (quiz.results || []).map((profil) => {
    const recos = (profil.recos || []).filter((r) => r.title?.trim());
    if (!recos.length) return null;
    return el('section', { class: 'cotes__groupe' }, [
      /* Pas de glyphe par défaut : selon d'où vient le questionnaire, l'emoji
         du profil vit dans son champ ou déjà dans son titre. Un repli sur ✦
         affichait « ✦ 🌊 L'amateur de fins douces ». */
      el('h3', { class: 'cotes__profil', text:
        [profil.emoji, profil.title || 'Profil sans titre'].filter(Boolean).join(' ') }),
      el('table', { class: 'cotes__table' }, [
        el('tbody', {}, recos.map(ligne)),
      ]),
    ]);
  }).filter(Boolean);

  const corps = el('div', { class: 'modal__body stack' }, [
    el('h2', { text: `Cotes — ${quiz.title}` }),
    ...groupes,
  ]);

  /* Le récapitulatif se calcule EN construisant les lignes : il se pose donc
     après, quand les compteurs ont vu passer toutes les recommandations. */
  corps.append(groupes.length
    ? el('p', { class: 'cotes__bilan', text:
        `${total} recommandation${total > 1 ? 's' : ''} · ${cotees} avec cote`
        + (total > cotees ? ` · ${total - cotees} sans` : '') })
    : el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon', text: '🏷' }),
        el('p', { text: 'Aucune recommandation dans ce questionnaire : il n’y a pas encore de rayon à préparer.' }),
      ]));

  const dialog = el('dialog', { class: 'modal cotes' }, [
    corps,
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-cotes': 'close', text: 'Fermer' }),
      el('span', { class: 'section__spacer' }),
      groupes.length && el('button', { class: 'btn btn--primary', type: 'button', 'data-cotes': 'print', text: '🖨 Imprimer' }),
    ]),
  ]);

  dialog.addEventListener('click', (event) => {
    const action = event.target.closest('[data-cotes]')?.dataset.cotes;
    if (!action) return;
    if (action === 'print') { window.print(); return; }
    dismiss(dialog);
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return undefined;
}

/* --- L'affiche ----------------------------------------------------------------
   Elle renvoie vers une adresse DURABLE, et c'est la seule condition. Un
   brouillon local n'en a pas : son contenu voyage dans le fragment de l'URL,
   et trois mille caractères ne rentrent pas dans un QR code — ni sur un mur.
   On le dit avant, plutôt que de produire une affiche qui ne marchera pas. */
async function montrerAffiche() {
  flush();
  const quiz = state.quiz;
  if (!quiz) return undefined;

  const servi = state.remote.some((q) => q.id === quiz.id)
             || state.published.some((q) => q.id === quiz.id);
  if (!servi) {
    return toast('Publiez d’abord ce questionnaire : une affiche a besoin d’une adresse qui dure.', 'danger');
  }

  const adresse = new URL(
    avecEspace(`quiz.html?q=${encodeURIComponent(quiz.id)}`, state.espace),
    location.href,
  ).toString();

  let rendu;
  try {
    const { rendreAffiche } = await import('../core/affiche.js');
    rendu = await rendreAffiche(quiz, adresse, {
      structure: state.identite?.titre || '',
      accroche: quiz.tagline || quiz.title,
    });
  } catch (err) {
    return toast(`Affiche impossible à produire : ${err.message}`, 'danger');
  }

  const blob = await toBlob(rendu.canvas);
  const fichier = `affiche-${slugify(quiz.title, 'questionnaire')}.png`;

  rendu.canvas.className = 'cardview__canvas';
  rendu.canvas.setAttribute('role', 'img');
  rendu.canvas.setAttribute('aria-label', `Affiche pour « ${quiz.title} »`);

  const dialog = el('dialog', { class: 'modal cardview' }, [
    el('div', { class: 'modal__body' }, [
      rendu.canvas,
      /* L'adresse en clair sous l'image : c'est elle qui est dans le QR, et
         personne ne peut la relire dans les modules. Une affiche qui pointe
         au mauvais endroit ne se voit qu'une fois collée. */
      el('p', { class: 'panel__hint', style: { marginTop: 'var(--s-3)' } }, [
        'Le QR code mène à ', el('code', { class: 'code', text: adresse }), '.',
      ]),
      localhostAlerte(adresse),
    ]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-affiche': 'close', text: 'Fermer' }),
      el('button', { class: 'btn btn--primary', type: 'button', 'data-affiche': 'save', text: '↓ Enregistrer le PNG' }),
    ]),
  ]);

  dialog.addEventListener('click', (event) => {
    const action = event.target.closest('[data-affiche]')?.dataset.affiche;
    if (!action) return;
    if (action === 'save') {
      downloadBlob(fichier, blob);
      toast('Affiche enregistrée. Format A4, à imprimer tel quel.');
      return;
    }
    dismiss(dialog);
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return undefined;
}

/* Le piège du travail en local, déjà connu du code d'intégration : une
   adresse en localhost ne mène nulle part une fois l'affiche imprimée. */
function localhostAlerte(adresse) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(adresse)) return null;
  return el('p', { class: 'alerte', style: { marginTop: 'var(--s-2)' } }, [
    'Cette adresse est locale : l’affiche ne marchera que sur cette machine. ',
    'Reproduisez-la depuis l’adresse publique du site.',
  ]);
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
    /* L'envol part AVANT le rafraîchissement de l'espace : celui-ci
       redessine le panneau, et le geste doit accompagner la publication,
       pas la rattraper une seconde plus tard.

       Mais le redessin, lui, doit ATTENDRE la fin du vol. `refreshEspace()`
       enchaîne huit allers-retours, puis `repaint()` remplace le panneau —
       une carte neuve et pleinement visible réapparaissait donc au milieu
       d'une animation de 2,6 s, ce qu'aucun masquage au départ ne pouvait
       rattraper. Le réseau court pendant le vol, seul le redessin patiente,
       et le bandeau de confirmation ne fait attendre personne.

       Ce qui s'envole est la FICHE du questionnaire, en tête du panneau —
       pas la carte de l'espace, qui portait le bouton et qu'on pliait faute
       de mieux. Le geste dit maintenant ce qu'il fait : cette fiche-là part
       vers les usagers. */
    const envol = envolerLaFiche(dom.panel.querySelector('.fiche'));
    await refreshEspace();
    toast(`« ${state.quiz.title} » est en ligne dans l’espace.`);
    await envol;
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
      el('p', { class: 'panel__hint', text: 'Reprendre ouvre la version en ligne à côté de la tienne, pour comparer. Écraser publie la tienne et perd l’autre.' }),
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
    toast(`« ${titre} » retiré de l’espace — il part à la corbeille, et ta copie locale est intacte.`, {
      action: { label: 'Annuler', onClick: async () => {
        try {
          await remote.restaurerQuiz(state.espace, state.quiz.id);
          await refreshEspace();
          repaint();
          toast(`« ${titre} » est de retour sur le kiosque.`);
        } catch (err) { toast(err.message, 'danger'); }
      } },
    });
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
        el('p', { class: 'panel__hint', text: 'Remplacer écrase ta copie locale — la voie pour restaurer une sauvegarde. Une variante garde les deux.' }),
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

  /* Les instantanés d'avant l'import décrivent des questionnaires que
     l'import vient peut-être de remplacer. Les défaire annulerait la
     restauration elle-même. */
  undoStack.length = 0;

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
