/* ==========================================================================
   admin/panels.js — le dessin des quatre surfaces d'édition + la publication.
   Ces fonctions sont pures : elles reçoivent le questionnaire, elles
   rendent un noeud. Elles ne modifient jamais le modèle — c'est app.js
   qui écoute, applique et redessine.
   ========================================================================== */

import { RECO_TYPES, GLYPHS, ACCENTS, RULE_MODES, slugify, imageWeight } from '../core/schema.js';
import { ceilings } from '../core/scoring.js';
import { el, formatBytes } from '../core/ui.js';

const tool = (act, id, label, glyph, extra = {}) => el('button', {
  class: 'btn btn--icon btn--quiet', type: 'button',
  'data-act': act, 'data-id': id, title: label, 'aria-label': label, text: glyph, ...extra,
});

/* La poignée de déplacement. `aria-hidden` : le chemin accessible est le
   couple de boutons ↑↓, qui reste à côté. */
const grip = (title) => el('span', {
  class: 'grip', title: `Glisser pour déplacer — ${title}`, 'aria-hidden': 'true', text: '⠿',
});

/* Une carte repliée doit rester lisible : sans résumé, une liste de dix
   questions pliées n'est qu'une liste de titres, et on la déplie une par
   une pour retrouver la bonne. */
const fold = (id, folded, what) => el('button', {
  class: 'editor-card__fold', type: 'button',
  'data-act': 'card-fold', 'data-id': id,
  'aria-expanded': String(!folded),
  title: folded ? `Déplier ${what}` : `Replier ${what}`,
  text: folded ? '▸' : '▾',
});

/* Une seule commande, dont le libellé dit ce qu'elle va faire : si tout
   est déjà plié, elle déplie. Deux boutons pour ça seraient un de trop. */
const foldAll = (kind, items, ctx) => {
  if (items.length < 2) return null;
  const allFolded = items.every((item) => ctx.folded?.has(item.id));
  return el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button',
    'data-act': 'fold-all', 'data-id': kind,
    text: allFolded ? '▾ Tout déplier' : '▸ Tout replier',
  });
};

const summary = (parts) => el('span', {
  class: 'editor-card__summary', text: parts.filter(Boolean).join(' · '),
});

const field = (label, control, hint) => el('label', { class: 'field' }, [
  el('span', { class: 'field__label', text: label }),
  control,
  hint && el('span', { class: 'field__hint', text: hint }),
]);

const input = (bind, value, props = {}) => el('input', {
  class: 'input', type: 'text', 'data-bind': bind, value: value ?? '', ...props,
});

const textarea = (bind, value, props = {}) => {
  const node = el('textarea', { class: 'textarea', 'data-bind': bind, ...props });
  node.value = value ?? '';
  return node;
};

const select = (bind, value, options, props = {}) => {
  const node = el('select', { class: 'select', 'data-bind': bind, ...props },
    options.map((o) => el('option', { value: o.value, text: o.label })));
  node.value = value;
  return node;
};

/* Un champ image accepte trois formes : une adresse http(s), un chemin
   relatif du dépôt, ou un fichier du disque que l'on réduit et intègre.
   `kind` choisit l'agressivité de la réduction (cf. IMAGE_LIMITS).      */
const imageField = (label, bind, value, kind = 'cover', hint = '') => {
  const weight = imageWeight(value);
  return el('div', { class: 'field imagefield' }, [
    el('span', { class: 'field__label', text: label }),
    el('div', { class: 'imagefield__row' }, [
      el('span', { class: 'imagefield__preview' + (value ? '' : ' is-empty') },
        [value ? el('img', { src: value, alt: '', loading: 'lazy' }) : el('span', { text: '🖼' })]),
      el('div', { class: 'imagefield__controls' }, [
        input(bind, value, {
          class: 'input input--mono',
          placeholder: 'https://…  ou  img/affiche.jpg',
          'aria-label': `${label} — adresse`,
        }),
        el('div', { class: 'row' }, [
          el('label', { class: 'btn btn--ghost btn--sm' }, [
            '↑ Fichier',
            el('input', {
              type: 'file', accept: 'image/*', style: 'display:none',
              'data-act': 'image-file', 'data-id': bind, 'data-kind': kind,
            }),
          ]),
          value && el('button', {
            class: 'btn btn--quiet btn--sm', type: 'button',
            'data-act': 'image-clear', 'data-id': bind, text: 'Retirer',
          }),
          weight > 0 && el('span', {
            class: 'pill' + (weight > 120000 ? ' pill--warn' : ''),
            title: 'Image intégrée au questionnaire : elle pèse dans le lien de partage.',
            text: `intégrée · ${formatBytes(weight)}`,
          }),
        ]),
      ]),
    ]),
    hint && el('span', { class: 'field__hint', text: hint }),
  ]);
};

const head = (title, hint, actions = []) => el('div', {}, [
  el('div', { class: 'panel__head' }, [
    el('h1', { text: title }),
    el('span', { class: 'panel__spacer' }),
    ...actions,
  ]),
  el('p', { class: 'panel__hint', text: hint }),
]);

/* --- 1. Identité ----------------------------------------------------------- */

export function identite(quiz) {
  return el('section', { class: 'panel' }, [
    head('Identité', "Ce que le répondant voit avant de commencer. Le titre et l’emoji servent aussi de vignette au kiosque."),
    el('div', { class: 'card stack' }, [
      el('div', { class: 'grid-2' }, [
        field('Emoji de couverture', input('q:emoji', quiz.emoji, { maxlength: '4', style: 'font-size:1.4rem;text-align:center' })),
        field('Titre', input('q:title', quiz.title, { placeholder: 'Quel roman pour cet été ?' })),
      ]),
      field('Accroche', input('q:tagline', quiz.tagline, { placeholder: 'Une ligne pour donner envie.' }),
        'Affichée en italique sous le titre.'),
      field('Introduction', textarea('q:intro', quiz.intro, { rows: '5', placeholder: 'Deux ou trois phrases pour poser le ton.' }),
        'Une ligne vide sépare deux paragraphes. Rien d’autre n’est interprété.'),
      imageField('Image de couverture', 'q:image', quiz.image, 'cover',
        'Affichée sur l’écran de départ et sur la vignette du kiosque. Facultative.'),
      field('Couleur', el('div', { class: 'swatches' }, [
        ...ACCENTS.map((hex) => el('button', {
          class: 'swatch' + (hex.toLowerCase() === quiz.accent.toLowerCase() ? ' is-active' : ''),
          type: 'button', 'data-act': 'accent', 'data-id': hex,
          style: { background: hex }, title: hex, 'aria-label': `Accent ${hex}`,
        })),
        el('input', { class: 'swatch-input', type: 'color', 'data-bind': 'q:accent', value: quiz.accent, title: 'Couleur libre' }),
      ]), "Elle habille le parcours entier. Le texte posé dessus bascule en noir ou blanc automatiquement."),
    ]),
  ]);
}

/* --- 2. Axes ---------------------------------------------------------------- */

export function axes(quiz) {
  const caps = ceilings(quiz);

  return el('section', { class: 'panel' }, [
    head('Axes', "Les signes que le questionnaire compte : les étoiles, les ronds, les triangles. Chaque réponse en distribue.", [
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'axis-add', text: '+ Axe' }),
    ]),
    quiz.axes.length
      ? el('div', { class: 'editor-list', 'data-sortable': 'axes' }, quiz.axes.map((axis, i) => el('div', {
          class: 'axis-row', style: { '--axis': axis.color },
        }, [
          grip(axis.label || `axe ${i + 1}`),
          el('input', {
            class: 'input axis-row__glyph', 'data-bind': `axis:${axis.id}:glyph`,
            value: axis.glyph, maxlength: '3', list: 'glyphs', 'aria-label': 'Glyphe',
          }),
          input(`axis:${axis.id}:label`, axis.label, { placeholder: `Axe ${i + 1}`, 'aria-label': 'Nom de l’axe' }),
          el('input', {
            class: 'swatch-input', type: 'color', 'data-bind': `axis:${axis.id}:color`,
            value: axis.color, 'aria-label': 'Couleur de l’axe',
          }),
          el('span', { class: 'row' }, [
            el('span', { class: 'pill', text: `max ${caps[axis.id] || 0}` }),
            tool('axis-up', axis.id, 'Monter', '↑', { disabled: i === 0 }),
            tool('axis-down', axis.id, 'Descendre', '↓', { disabled: i === quiz.axes.length - 1 }),
            tool('axis-del', axis.id, 'Supprimer cet axe', '✕'),
          ]),
        ])))
      : el('div', { class: 'empty' }, [
          el('div', { class: 'empty__icon', text: '★' }),
          el('p', { text: 'Aucun axe. Sans axe, il n’y a rien à compter.' }),
        ]),
    el('datalist', { id: 'glyphs' }, GLYPHS.map((g) => el('option', { value: g }))),
    el('p', { class: 'panel__hint', style: { marginTop: 'var(--s-4)' } , text:
      'Supprimer un axe efface aussi les points que les réponses lui donnaient. C’est irréversible.' }),
  ]);
}

/* --- 3. Questions ------------------------------------------------------------ */

export function questions(quiz, ctx = {}) {
  return el('section', { class: 'panel' }, [
    head('Questions', "Une question par écran. Les points de chaque réponse se règlent à droite, un compteur par axe.", [
      foldAll('questions', quiz.questions, ctx),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'q-add', text: '+ Question' }),
    ]),

    /* L'aperçu se remplit depuis app.js et se met à jour à la frappe, sans
       redessiner le panneau — sans quoi le curseur sauterait du champ. */
    el('div', { class: 'preview' + (ctx.previewOpen === false ? ' is-closed' : ''), id: 'questionPreview' }, [
      el('div', { class: 'preview__bar' }, [
        el('span', { class: 'preview__title', text: 'Aperçu' }),
        el('span', { class: 'preview__hint', id: 'previewHint', text: 'Placez le curseur dans une question' }),
        el('span', { class: 'panel__spacer' }),
        el('button', {
          class: 'btn btn--quiet btn--sm', type: 'button', 'data-act': 'preview-toggle',
          text: ctx.previewOpen === false ? 'Afficher' : 'Masquer',
        }),
      ]),
      el('div', { class: 'preview__stage', id: 'previewStage' }),
    ]),
    quiz.questions.length
      ? el('div', { class: 'editor-list', 'data-sortable': 'questions' },
          quiz.questions.map((q, i) => questionCard(quiz, q, i, ctx)))
      : el('div', { class: 'empty' }, [
          el('div', { class: 'empty__icon', text: '❓' }),
          el('p', { text: 'Aucune question pour l’instant.' }),
        ]),
  ]);
}

function questionCard(quiz, question, index, ctx = {}) {
  const folded = ctx.folded?.has(question.id);
  /* Les axes que cette question alimente réellement : c'est ce qui permet
     de repérer une question au milieu d'une liste repliée. */
  const fed = quiz.axes.filter((axis) =>
    question.options.some((o) => (o.scores[axis.id] || 0) > 0));

  return el('article', { class: 'editor-card' + (folded ? ' is-folded' : '') }, [
    el('header', { class: 'editor-card__head' }, [
      grip(`question ${index + 1}`),
      fold(question.id, folded, 'la question'),
      el('span', { class: 'editor-card__index', text: String(index + 1) }),
      el('span', { class: 'editor-card__label', text: question.text || 'Question sans texte' }),
      folded && summary([
        `${question.options.length} réponse${question.options.length > 1 ? 's' : ''}`,
        question.type === 'multiple' ? 'choix multiple' : null,
        question.image ? '🖼' : null,
        fed.map((a) => a.glyph).join('') || 'aucun point',
      ]),
      el('span', { class: 'editor-card__tools' }, [
        el('button', {
          class: 'btn btn--icon btn--quiet' + (question.image ? ' is-on' : ''),
          type: 'button', 'data-act': 'opt-image', 'data-id': question.id,
          title: question.image ? 'Cette question a une image' : 'Illustrer cette question',
          'aria-expanded': String(ctx.expanded?.has(question.id) || Boolean(question.image)),
          text: '🖼',
        }),
        tool('q-up', question.id, 'Monter', '↑', { disabled: index === 0 }),
        tool('q-down', question.id, 'Descendre', '↓', { disabled: index === quiz.questions.length - 1 }),
        tool('q-dup', question.id, 'Dupliquer', '⧉'),
        tool('q-del', question.id, 'Supprimer la question', '✕'),
      ]),
    ]),
    !folded && el('div', { class: 'editor-card__body stack' }, [
      (ctx.expanded?.has(question.id) || question.image) && imageField(
        'Image de la question', `question:${question.id}:image`, question.image, 'cover',
        'Affichée au-dessus de l’énoncé, pleine largeur.',
      ),
      field('Question', input(`question:${question.id}:text`, question.text,
        { placeholder: 'Il est 15 h, un dimanche d’août. Tu…' })),
      el('div', { class: 'grid-2' }, [
        field('Précision (facultatif)', input(`question:${question.id}:hint`, question.hint,
          { placeholder: 'Une consigne courte.' })),
        field('Mode de réponse', select(`question:${question.id}:type`, question.type, [
          { value: 'single', label: 'Une seule réponse' },
          { value: 'multiple', label: 'Plusieurs réponses' },
        ]), question.type === 'single' ? 'Enchaîne tout seul après le clic.' : 'Le répondant valide avec « Suivant ».'),
      ]),

      el('div', {}, [
        el('span', { class: 'field__label', text: `Réponses (${question.options.length})` }),
        el('div', { class: 'opts', 'data-sortable': `options:${question.id}` }, question.options.map((option, j) => {
          /* Le champ image d'une réponse se déplie : la ligne est déjà
             dense, et la plupart des questionnaires n'illustrent rien. */
          const open = ctx.expanded?.has(option.id) || Boolean(option.image);
          return el('div', { class: 'opt-wrap' + (open ? ' is-open' : '') }, [
            el('div', { class: 'opt' }, [
              grip(`réponse ${j + 1}`),
              el('input', {
                class: 'input', 'data-bind': `option:${question.id}:${option.id}:emoji`,
                value: option.emoji, maxlength: '4', placeholder: '🙂',
                style: 'text-align:center', 'aria-label': 'Emoji',
              }),
              input(`option:${question.id}:${option.id}:text`, option.text,
                { placeholder: `Réponse ${j + 1}`, 'aria-label': `Réponse ${j + 1}` }),
              el('span', { class: 'scoreset' }, quiz.axes.map((axis) => el('span', {
                class: 'scorechip' + ((option.scores[axis.id] || 0) !== 0 ? ' is-set' : ''),
                style: { '--axis': axis.color }, title: axis.label,
              }, [
                el('span', { class: 'scorechip__glyph', text: axis.glyph }),
                el('input', {
                  class: 'scorechip__input', type: 'number', min: '-9', max: '9', step: '1',
                  'data-bind': `score:${question.id}:${option.id}:${axis.id}`,
                  value: String(option.scores[axis.id] || 0),
                  'aria-label': `Points ${axis.label} pour la réponse ${j + 1}`,
                }),
              ]))),
              el('span', { class: 'editor-card__tools' }, [
                el('button', {
                  class: 'btn btn--icon btn--quiet' + (option.image ? ' is-on' : ''),
                  type: 'button', 'data-act': 'opt-image', 'data-id': option.id,
                  title: option.image ? 'Cette réponse a une image' : 'Illustrer cette réponse',
                  'aria-expanded': String(open), text: option.image ? '🖼' : '🖼',
                }),
                tool('opt-del', `${question.id}|${option.id}`, 'Supprimer la réponse', '✕'),
              ]),
            ]),
            open && el('div', { class: 'opt__detail' }, [
              imageField('Image de la réponse',
                `option:${question.id}:${option.id}:image`, option.image, 'thumb'),
            ]),
          ]);
        })),
        el('div', { class: 'row', style: { marginTop: 'var(--s-2)' } }, [
          el('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            'data-act': 'opt-add', 'data-id': question.id, text: '+ Réponse',
          }),
        ]),
      ]),
    ]),
  ]);
}

/* --- 4. Profils ---------------------------------------------------------------- */

export function resultats(quiz, ctx = {}) {
  return el('section', { class: 'panel' }, [
    head('Profils de sortie', "Ce que le répondant obtient à la fin. Les règles sont examinées de haut en bas : la première qui matche gagne, et « par défaut » passe toujours en dernier.", [
      foldAll('results', quiz.results, ctx),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'res-add', text: '+ Profil' }),
    ]),
    quiz.results.length
      ? el('div', { class: 'editor-list', 'data-sortable': 'results' },
          quiz.results.map((r, i) => resultCard(quiz, r, i, ctx)))
      : el('div', { class: 'empty' }, [
          el('div', { class: 'empty__icon', text: '🎁' }),
          el('p', { text: 'Aucun profil : le parcours ne mène nulle part.' }),
        ]),
  ]);
}

function resultCard(quiz, result, index, ctx) {
  const folded = ctx.folded?.has(result.id);
  /* Un profil « par défaut » est un filet : qu'il n'attrape jamais rien
     est le cas nominal, pas un défaut. On ne le signale donc que pour
     les règles qui prétendent, elles, se déclencher. */
  const unreachable = result.rule.mode !== 'fallback'
    && ctx.reach && ctx.reach.hit && ctx.reach.hit[result.id] === false;
  const mode = RULE_MODES.find((m) => m.id === result.rule.mode) || RULE_MODES[0];
  const needsAxis = result.rule.mode === 'dominant' || result.rule.mode === 'range';
  const needsRange = result.rule.mode === 'range' || result.rule.mode === 'total';

  const axis = quiz.axes.find((a) => a.id === result.rule.axis);
  const condition =
    result.rule.mode === 'dominant' ? `${axis?.glyph || '?'} dominant` :
    result.rule.mode === 'range' ? `${axis?.glyph || '?'} ${result.rule.min}–${result.rule.max}` :
    result.rule.mode === 'total' ? `total ${result.rule.min}–${result.rule.max}` :
    'par défaut';

  return el('article', { class: 'editor-card' + (folded ? ' is-folded' : '') }, [
    el('header', { class: 'editor-card__head' }, [
      grip(`profil ${index + 1}`),
      fold(result.id, folded, 'le profil'),
      el('span', { class: 'editor-card__index', text: String(index + 1) }),
      el('span', { class: 'editor-card__label', text: result.title || 'Profil sans titre' }),
      folded && summary([
        condition,
        `${result.recos.length} reco${result.recos.length > 1 ? 's' : ''}`,
      ]),
      unreachable && el('span', {
        class: 'pill pill--warn', text: 'jamais atteint',
        title: 'Aucune combinaison de réponses ne mène à ce profil.',
      }),
      el('span', { class: 'editor-card__tools' }, [
        tool('res-up', result.id, 'Monter', '↑', { disabled: index === 0 }),
        tool('res-down', result.id, 'Descendre', '↓', { disabled: index === quiz.results.length - 1 }),
        tool('res-dup', result.id, 'Dupliquer', '⧉'),
        tool('res-del', result.id, 'Supprimer le profil', '✕'),
      ]),
    ]),
    !folded && el('div', { class: 'editor-card__body stack' }, [
      el('div', { class: 'grid-2' }, [
        field('Emoji', input(`result:${result.id}:emoji`, result.emoji,
          { maxlength: '4', style: 'font-size:1.3rem;text-align:center' })),
        field('Titre du profil', input(`result:${result.id}:title`, result.title,
          { placeholder: 'Le solaire mélancolique' })),
      ]),
      field('Sous-titre', input(`result:${result.id}:subtitle`, result.subtitle,
        { placeholder: 'Vous aimez que ça finisse mal, mais au soleil.' })),
      field('Texte', textarea(`result:${result.id}:text`, result.text,
        { rows: '3', placeholder: 'Le portrait, en deux phrases.' })),
      imageField('Illustration du profil', `result:${result.id}:image`, result.image, 'cover',
        'Bandeau au-dessus du résultat. Facultative.'),

      el('div', {}, [
        el('span', { class: 'field__label', text: 'Condition de déclenchement' }),
        el('div', { class: 'rule' }, [
          select(`rule:${result.id}:mode`, result.rule.mode,
            RULE_MODES.map((m) => ({ value: m.id, label: m.label })), { 'aria-label': 'Type de règle' }),
          needsAxis && select(`rule:${result.id}:axis`, result.rule.axis || quiz.axes[0]?.id || '',
            quiz.axes.map((a) => ({ value: a.id, label: `${a.glyph} ${a.label}` })), { 'aria-label': 'Axe concerné' }),
          needsRange && el('input', {
            class: 'input', type: 'number', 'data-bind': `rule:${result.id}:min`,
            value: String(result.rule.min), placeholder: 'min', 'aria-label': 'Minimum',
          }),
          needsRange && el('input', {
            class: 'input', type: 'number', 'data-bind': `rule:${result.id}:max`,
            value: String(result.rule.max), placeholder: 'max', 'aria-label': 'Maximum',
          }),
          el('span', { class: 'rule__help', text: mode.help }),
        ]),
      ]),

      el('div', {}, [
        el('span', { class: 'field__label', text: `Recommandations (${result.recos.length})` }),
        el('div', { class: 'editor-list', 'data-sortable': `recos:${result.id}` },
          result.recos.map((reco, j) => el('div', { class: 'reco-edit' }, [
          el('div', { class: 'reco-edit__top' }, [
            grip(`recommandation ${j + 1}`),
            select(`reco:${result.id}:${reco.id}:type`, reco.type,
              RECO_TYPES.map((t) => ({ value: t.id, label: `${t.icon} ${t.label}` })), { 'aria-label': 'Type d’œuvre' }),
            input(`reco:${result.id}:${reco.id}:title`, reco.title,
              { placeholder: `Titre de l’œuvre ${j + 1}`, 'aria-label': 'Titre' }),
            tool('reco-del', `${result.id}|${reco.id}`, 'Retirer cette reco', '✕'),
          ]),
          el('div', { class: 'grid-2' }, [
            input(`reco:${result.id}:${reco.id}:creator`, reco.creator, { placeholder: 'Autrice, réalisateur…', 'aria-label': 'Auteur' }),
            input(`reco:${result.id}:${reco.id}:year`, reco.year, { placeholder: 'Année', 'aria-label': 'Année', maxlength: '9' }),
          ]),
          input(`reco:${result.id}:${reco.id}:note`, reco.note, { placeholder: 'Pourquoi celle-là ? (une phrase)', 'aria-label': 'Note' }),
          input(`reco:${result.id}:${reco.id}:location`, reco.location, {
            placeholder: '📍 Où le trouver ? — Rayon Policier · cote R MAN',
            'aria-label': 'Où trouver cette œuvre', maxlength: '80',
          }),
          input(`reco:${result.id}:${reco.id}:link`, reco.link, { placeholder: 'https://… (facultatif)', 'aria-label': 'Lien', type: 'url' }),
          imageField('Couverture', `reco:${result.id}:${reco.id}:image`, reco.image, 'thumb'),
        ]))),
        el('div', { class: 'row', style: { marginTop: 'var(--s-2)' } }, [
          el('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            'data-act': 'reco-add', 'data-id': result.id, text: '+ Recommandation',
          }),
        ]),
      ]),
    ]),
  ]);
}

/* --- 5. Publication ---------------------------------------------------------------- */

/* Le bloc de l'espace partagé. Il n'apparaît que si l'adresse en nomme un :
   sans ?espace=…, le backoffice est exactement ce qu'il était, et rien ne
   parle à un serveur. */
/* L'équipe de l'espace. Chaque membre peut inviter et retirer — sauf un
   gérant, que les règles de la base protègent. Sans cette exception, un
   seul membre suffirait à verrouiller tout le monde dehors, propriétaire
   compris, et il faudrait la console pour rouvrir.                     */
function equipeBloc(ctx) {
  if (!ctx.remoteSession) return null;
  const moi = ctx.remoteSession.uid;

  return el('div', { style: { marginTop: 'var(--s-5)' } }, [
    el('div', { class: 'section__head', style: { marginBottom: 'var(--s-3)' } }, [
      el('h3', { style: 'font-size:var(--t-base)', text: `Équipe — ${ctx.membres.length} membre${ctx.membres.length > 1 ? 's' : ''}` }),
      el('span', { class: 'section__spacer' }),
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'inviter', text: '+ Inviter' }),
    ]),

    el('div', { class: 'sheet__list' }, ctx.membres.map((m) => el('div', { class: 'sheet__row' }, [
      el('span', { class: 'sheet__emoji', text: m.gerant ? '🔑' : '👤' }),
      el('span', { class: 'sheet__label input--mono', style: 'font-size:var(--t-xs)',
        text: m.uid + (m.uid === moi ? '  — toi' : '') }),
      m.gerant && el('span', { class: 'pill', title: 'Un gérant ne peut être retiré que depuis la console.', text: 'gérant' }),
      !m.gerant && m.uid !== moi && el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        'data-act': 'membre-retirer', 'data-id': m.uid,
        title: 'Retirer de l’espace', text: '✕',
      }),
    ]))),

    el('p', { class: 'field__hint', style: { marginTop: 'var(--s-3)' }, text:
      'Inviter crée le compte et envoie un courriel : la personne choisit son mot de passe elle-même, RecoHero ne le voit jamais. Retirer un membre lui ôte le droit de publier, sans supprimer son compte.' }),

    el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
      el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-act': 'copier-uid', text: '⧉ Copier mon identifiant' }),
      el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-act': 'mon-mot-de-passe', text: '🔒 Changer mon mot de passe' }),
    ]),
  ]);
}

function espaceCard(ctx) {
  if (!ctx.espace) return null;

  return el('div', { class: 'card' }, [
    el('div', { class: 'publish-step' }, [
      el('span', { class: 'publish-step__num', text: '⌂' }),
      el('div', {}, [
        el('h3', { text: `Espace « ${ctx.espace} »` }),
        ctx.remoteSession
          ? el('div', {}, [
              el('p', { text: 'Publier dépose le questionnaire dans l’espace : il paraît aussitôt sur son kiosque, pour tout le monde, sans que personne ait à se connecter pour y répondre.' }),
              el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
                el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'remote-publish', text: '⇧ Publier dans l’espace' }),
                ctx.inEspace && el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'remote-unpublish', text: '⌫ Retirer de l’espace' }),
                el('span', { class: 'section__spacer' }),
                el('span', { class: 'pill', text: ctx.remoteSession.email }),
                el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-act': 'remote-signout', text: 'Se déconnecter' }),
              ]),
              /* Une règle de base de données absente ne se voit nulle
                 part : l'espace a exactement la même apparence, protégé ou
                 non. C'est pourquoi ce bandeau existe, et pourquoi il est
                 en rouge — il annonce que deux personnes peuvent s'effacer
                 mutuellement sans le savoir. */
              ctx.guardActive === false && el('p', { class: 'alerte' }, [
                el('strong', { text: 'Protection contre l’écrasement inactive. ' }),
                'La base a accepté une écriture qu’elle aurait dû refuser : la règle n’est pas publiée. ',
                'Deux personnes qui modifient le même questionnaire peuvent s’effacer l’une l’autre. ',
                'La règle est à publier depuis la console de la base.',
              ]),

              /* Le seul filet de cet espace : la base gratuite n'offre
                 aucune restauration. Le bouton est donc au même niveau que
                 « Publier », pas relégué en bas de page. */
              el('p', { class: 'panel__hint', style: { marginTop: 'var(--s-4)' }, text:
                'Cet espace n’a pas de corbeille ni de restauration : une suppression y est définitive. L’export du catalogue est la seule sauvegarde possible — un fichier daté, réimportable tel quel.' }),
              el('div', { class: 'row', style: { marginTop: 'var(--s-2)' } }, [
                el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'export-espace', text: '↓ Exporter tout l’espace' }),
                ctx.remoteCount ? el('span', { class: 'pill', text: `${ctx.remoteCount} questionnaire${ctx.remoteCount > 1 ? 's' : ''}` }) : null,
              ]),

              equipeBloc(ctx),

              el('div', { class: 'row', style: { display: 'none' } }, [
              ]),
            ])
          : el('div', {}, [
              el('p', { text: 'Connecte-toi pour publier dans cet espace. C’est le seul moment où un mot de passe est demandé — les visiteurs qui répondent n’ont besoin de rien.' }),
              el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
                el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'remote-signin', text: '→ Se connecter' }),
              ]),
            ]),
      ]),
    ]),
  ]);
}

export function publier(quiz, ctx = {}) {
  const file = `${slugify(quiz.title, quiz.id)}.json`;

  return el('section', { class: 'panel' }, [
    head('Diffuser', "Un lien, qui ne demande rien à personne ; un espace partagé, pour publier à plusieurs ; un fichier, pour se passer un modèle de la main à la main."),

    espaceCard(ctx),

    el('div', { class: 'card' }, [
      el('div', { class: 'publish-step' }, [
        el('span', { class: 'publish-step__num', text: '1' }),
        el('div', {}, [
          el('h3', { text: 'Par lien — immédiat' }),
          el('p', { text: 'Le questionnaire entier est compressé dans l’adresse. Rien à déployer, rien à héberger : celui qui reçoit le lien peut répondre tout de suite. Le même lien s’intègre dans une page d’un autre site.' }),
          el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
            el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'copy-link', text: '⧉ Copier le lien' }),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'test', text: '▷ Tester le parcours' }),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'embed', text: '⧉ Code d’intégration' }),
            ctx.linkSize && el('span', { class: 'pill', text: `${ctx.linkSize} caractères` }),
          ]),
        ]),
      ]),

      /* Le fichier est ce qui circule entre auteurs : un lien se répond,
         un fichier se reprend et se modifie. C'est la seule voie qui
         transporte un questionnaire ÉDITABLE d'une personne à l'autre. */
      el('div', { class: 'publish-step' }, [
        el('span', { class: 'publish-step__num', text: '2' }),
        el('div', {}, [
          el('h3', { text: 'Par fichier — pour se passer un modèle' }),
          el('p', { text: 'Le fichier JSON contient tout : questions, axes, profils, recommandations, images intégrées. Qui le reçoit l’ouvre dans son propre backoffice et le modifie à sa guise. C’est la voie pour partir du questionnaire de quelqu’un d’autre plutôt que de la page blanche.' }),
          el('code', { class: 'code', text: file }),
          el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
            el('button', {
              class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'export',
              title: file, text: '↓ Exporter le fichier',
            }),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'copy-json', text: '⧉ Copier le JSON' }),
          ]),
          el('p', { class: 'panel__hint', style: { marginTop: 'var(--s-4)' }, text: 'Dans l’autre sens — reprendre le modèle de quelqu’un :' }),
          el('div', { class: 'row', style: { marginTop: 'var(--s-2)' } }, [
            el('label', { class: 'btn btn--ghost btn--sm' }, [
              '↑ Importer un fichier',
              el('input', { type: 'file', accept: '.json,application/json', 'data-act': 'import-file', style: 'display:none' }),
            ]),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'import-paste', text: '⌨ Coller du JSON' }),
          ]),
          el('p', { class: 'field__hint', text: 'Un fichier peut contenir un questionnaire ou un catalogue entier. Si l’import trouve des identifiants déjà présents, il demande une fois s’il faut remplacer tes copies — c’est ce qui permet de restaurer une sauvegarde — ou en faire des variantes.' }),
          el('div', { class: 'row', style: { marginTop: 'var(--s-4)' } }, [
            el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-act': 'export-drafts', text: '↓ Exporter tous mes brouillons' }),
            el('span', { class: 'field__hint', text: 'Les brouillons ne vivent que dans ce navigateur.' }),
          ]),
        ]),
      ]),
    ]),

    el('div', { class: 'danger-zone' }, [
      el('h3', { text: 'Supprimer ce questionnaire' }),
      el('p', { class: 'panel__hint', style: { marginBottom: 'var(--s-3)' }, text:
        'Le brouillon est effacé de ce navigateur. Un fichier déjà exporté, un lien déjà envoyé et une version déjà publiée dans un espace ne sont pas touchés.' }),
      el('button', { class: 'btn btn--danger btn--sm', type: 'button', 'data-act': 'delete-quiz', text: 'Supprimer définitivement' }),
    ]),
  ]);
}

export const PANELS = [
  { id: 'identite',  label: 'Identité',  emoji: '✦', render: identite },
  { id: 'axes',      label: 'Axes',      emoji: '★', render: axes },
  { id: 'questions', label: 'Questions', emoji: '❓', render: questions },
  { id: 'resultats', label: 'Profils',   emoji: '🎁', render: resultats },
  { id: 'publier',   label: 'Diffuser',  emoji: '⤴', render: publier },
];
