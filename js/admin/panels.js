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
      ? el('div', { class: 'editor-list' }, quiz.axes.map((axis, i) => el('div', {
          class: 'axis-row', style: { '--axis': axis.color },
        }, [
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
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'q-add', text: '+ Question' }),
    ]),
    quiz.questions.length
      ? el('div', { class: 'editor-list' }, quiz.questions.map((q, i) => questionCard(quiz, q, i, ctx)))
      : el('div', { class: 'empty' }, [
          el('div', { class: 'empty__icon', text: '❓' }),
          el('p', { text: 'Aucune question pour l’instant.' }),
        ]),
  ]);
}

function questionCard(quiz, question, index, ctx = {}) {
  return el('article', { class: 'editor-card' }, [
    el('header', { class: 'editor-card__head' }, [
      el('span', { class: 'editor-card__index', text: String(index + 1) }),
      el('span', { class: 'editor-card__label', text: question.text || 'Question sans texte' }),
      el('span', { class: 'editor-card__tools' }, [
        tool('q-up', question.id, 'Monter', '↑', { disabled: index === 0 }),
        tool('q-down', question.id, 'Descendre', '↓', { disabled: index === quiz.questions.length - 1 }),
        tool('q-dup', question.id, 'Dupliquer', '⧉'),
        tool('q-del', question.id, 'Supprimer la question', '✕'),
      ]),
    ]),
    el('div', { class: 'editor-card__body stack' }, [
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
        el('div', { class: 'opts' }, question.options.map((option, j) => {
          /* Le champ image d'une réponse se déplie : la ligne est déjà
             dense, et la plupart des questionnaires n'illustrent rien. */
          const open = ctx.expanded?.has(option.id) || Boolean(option.image);
          return el('div', { class: 'opt-wrap' + (open ? ' is-open' : '') }, [
            el('div', { class: 'opt' }, [
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
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'res-add', text: '+ Profil' }),
    ]),
    quiz.results.length
      ? el('div', { class: 'editor-list' }, quiz.results.map((r, i) => resultCard(quiz, r, i, ctx)))
      : el('div', { class: 'empty' }, [
          el('div', { class: 'empty__icon', text: '🎁' }),
          el('p', { text: 'Aucun profil : le parcours ne mène nulle part.' }),
        ]),
  ]);
}

function resultCard(quiz, result, index, ctx) {
  /* Un profil « par défaut » est un filet : qu'il n'attrape jamais rien
     est le cas nominal, pas un défaut. On ne le signale donc que pour
     les règles qui prétendent, elles, se déclencher. */
  const unreachable = result.rule.mode !== 'fallback'
    && ctx.reach && ctx.reach.hit && ctx.reach.hit[result.id] === false;
  const mode = RULE_MODES.find((m) => m.id === result.rule.mode) || RULE_MODES[0];
  const needsAxis = result.rule.mode === 'dominant' || result.rule.mode === 'range';
  const needsRange = result.rule.mode === 'range' || result.rule.mode === 'total';

  return el('article', { class: 'editor-card' }, [
    el('header', { class: 'editor-card__head' }, [
      el('span', { class: 'editor-card__index', text: String(index + 1) }),
      el('span', { class: 'editor-card__label', text: result.title || 'Profil sans titre' }),
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
    el('div', { class: 'editor-card__body stack' }, [
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
        el('div', { class: 'editor-list' }, result.recos.map((reco, j) => el('div', { class: 'reco-edit' }, [
          el('div', { class: 'reco-edit__top' }, [
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

export function publier(quiz, ctx = {}) {
  const file = `${slugify(quiz.title, quiz.id)}.json`;

  return el('section', { class: 'panel' }, [
    head('Diffuser', "Deux façons : un lien, qui ne demande rien à personne ; ou le dépôt, pour que le questionnaire figure au kiosque."),

    el('div', { class: 'card' }, [
      el('div', { class: 'publish-step' }, [
        el('span', { class: 'publish-step__num', text: '1' }),
        el('div', {}, [
          el('h3', { text: 'Par lien — immédiat' }),
          el('p', { text: 'Le questionnaire entier est compressé dans l’adresse. Rien à déployer, rien à héberger : celui qui reçoit le lien peut répondre tout de suite.' }),
          el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
            el('button', { class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'copy-link', text: '⧉ Copier le lien' }),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'test', text: '▷ Tester le parcours' }),
            ctx.linkSize && el('span', { class: 'pill', text: `${ctx.linkSize} caractères` }),
          ]),
        ]),
      ]),

      el('div', { class: 'publish-step' }, [
        el('span', { class: 'publish-step__num', text: '2' }),
        el('div', {}, [
          el('h3', { text: 'Par le dépôt — permanent' }),
          el('p', { text: 'Télécharge le fichier, dépose-le dans quizzes/ du dépôt, puis ajoute son nom à quizzes/index.json. Le questionnaire apparaît alors au kiosque pour tout le monde.' }),
          el('code', { class: 'code', text: `quizzes/${file}` }),
          el('code', { class: 'code', text: `// quizzes/index.json\n[\n  "${file}"\n]` }),
          el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
            el('button', {
              class: 'btn btn--primary btn--sm', type: 'button', 'data-act': 'export',
              title: file, text: '↓ Télécharger le fichier',
            }),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'copy-json', text: '⧉ Copier le JSON' }),
          ]),
        ]),
      ]),

      el('div', { class: 'publish-step' }, [
        el('span', { class: 'publish-step__num', text: '3' }),
        el('div', {}, [
          el('h3', { text: 'Reprendre un questionnaire existant' }),
          el('p', { text: 'Colle ici le JSON d’un questionnaire (ou dépose son fichier) pour l’ouvrir dans l’éditeur en tant que nouveau brouillon.' }),
          el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
            el('label', { class: 'btn btn--ghost btn--sm' }, [
              '↑ Importer un fichier',
              el('input', { type: 'file', accept: '.json,application/json', 'data-act': 'import-file', style: 'display:none' }),
            ]),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-act': 'import-paste', text: '⌨ Coller du JSON' }),
          ]),
        ]),
      ]),
    ]),

    el('div', { class: 'danger-zone' }, [
      el('h3', { text: 'Supprimer ce questionnaire' }),
      el('p', { class: 'panel__hint', style: { marginBottom: 'var(--s-3)' }, text:
        'Le brouillon est effacé de ce navigateur. Un fichier déjà déposé dans le dépôt n’est pas touché.' }),
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
