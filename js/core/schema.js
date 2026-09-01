/* ==========================================================================
   schema.js — le modèle d'un questionnaire, ses fabriques, sa validation.
   Ce fichier est la source de vérité de la FORME des données. Le calcul
   des scores vit dans scoring.js, la persistance dans store.js.
   ========================================================================== */

export const SCHEMA_VERSION = 1;

/* Les types d'œuvre proposés dans le backoffice. Purement éditorial :
   une reco dont le type est inconnu s'affiche quand même.               */
export const RECO_TYPES = [
  { id: 'livre',    label: 'Livre',       icon: '📕' },
  { id: 'film',     label: 'Film',        icon: '🎬' },
  { id: 'serie',    label: 'Série',       icon: '📺' },
  { id: 'album',    label: 'Album',       icon: '🎧' },
  { id: 'bd',       label: 'BD',          icon: '🗯️' },
  { id: 'jeu',      label: 'Jeu',         icon: '🎲' },
  { id: 'podcast',  label: 'Podcast',     icon: '🎙️' },
  { id: 'expo',     label: 'Exposition',  icon: '🖼️' },
  { id: 'autre',    label: 'Autre',       icon: '✦' },
];

/* Les glyphes proposés pour les axes. Tous pris dans des blocs Unicode
   servis par les polices système des trois plateformes (Geometric Shapes,
   Miscellaneous Symbols, Dingbats) — vérifié avant ajout. Le champ reste
   libre : n'importe quel caractère ou emoji est accepté à la saisie.    */
export const GLYPHS = [
  '★', '●', '▲', '■', '◆', '♥', '♠', '♣',
  '♦', '✿', '☀', '☾', '✚', '✱', '❖', '▼',
];

/* Palette d'accents retenus : chacun passe le contraste AA sur blanc en
   texte, et supporte du texte blanc en pastille.                        */
export const ACCENTS = [
  '#C8452B', '#B4531E', '#8A6D1F', '#3F7A3A',
  '#2C7A78', '#2E6BA8', '#5B4EA8', '#A03A72',
];

export const RULE_MODES = [
  { id: 'dominant', label: 'Axe dominant', help: "Le profil gagne si cet axe a le plus de points, à lui seul. En cas d’égalité, la règle ne s’applique pas — c’est au « par défaut » de rattraper." },
  { id: 'range',    label: 'Palier sur un axe', help: "Le profil gagne si le score de cet axe est dans l'intervalle." },
  { id: 'total',    label: 'Palier sur le total', help: "Le profil gagne selon la somme de tous les axes." },
  { id: 'fallback', label: 'Par défaut', help: "Filet de sécurité : gagne si aucune autre règle n'a matché." },
];

/* Une image est soit une adresse http(s), soit un chemin relatif du dépôt,
   soit une image intégrée en data: URI. Tout le reste est rejeté — en
   particulier `javascript:` et `data:text/html`, qui seraient exécutables
   si on les laissait arriver dans un attribut src.                       */
export function safeImage(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(text)) return text;
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i.test(text)) return text;
  if (/^(?!\/)[\w./-]+\.(png|jpe?g|webp|gif|avif)(\?[\w=&.-]*)?$/i.test(text)) return text;
  return '';
}

/* Poids approximatif d'une image intégrée, pour l'afficher à l'auteur. */
export function imageWeight(value) {
  if (!String(value || '').startsWith('data:')) return 0;
  const base64 = value.slice(value.indexOf(',') + 1);
  return Math.round(base64.length * 0.75);
}

let counter = 0;
export function uid(prefix = 'x') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* Combien de temps ça prend, en minutes. Une affiche et un écran de départ
   posent la même question — « est-ce que j'ai le temps ? » — et doivent y
   répondre pareil, d'où le calcul ici plutôt qu'à deux endroits.

   Vingt secondes par question : le temps de lire trois réponses évocatrices
   et d'en choisir une, pas celui de cliquer. Jamais moins d'une minute —
   annoncer « 0 minute » ne rassure personne. */
export function dureeEstimee(quiz) {
  return Math.max(1, Math.round((quiz.questions?.length || 0) * 20 / 60));
}

export function slugify(text, fallback = 'questionnaire') {
  const slug = String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

/* --- Fabriques ------------------------------------------------------------ */

export function makeAxis(index = 0) {
  return {
    id: uid('axe'),
    glyph: GLYPHS[index % GLYPHS.length],
    label: `Axe ${index + 1}`,
    color: ACCENTS[index % ACCENTS.length],
  };
}

export function makeOption(axes = []) {
  return {
    id: uid('opt'),
    text: '',
    emoji: '',
    image: '',
    scores: Object.fromEntries(axes.map((a) => [a.id, 0])),
  };
}

export function makeQuestion(axes = []) {
  return {
    id: uid('q'),
    text: '',
    hint: '',
    image: '',
    type: 'single',
    options: [makeOption(axes), makeOption(axes)],
  };
}

export function makeReco() {
  return { id: uid('reco'), type: 'livre', title: '', creator: '', year: '', note: '', link: '', image: '', location: '' };
}

export function makeResult(axes = []) {
  return {
    id: uid('res'),
    title: '',
    subtitle: '',
    text: '',
    image: '',
    rule: axes.length
      ? { mode: 'dominant', axis: axes[0].id, min: 0, max: 99 }
      : { mode: 'fallback', axis: null, min: 0, max: 99 },
    recos: [makeReco()],
  };
}

export function makeQuiz(partial = {}) {
  const axes = [makeAxis(0), makeAxis(1), makeAxis(2)];
  return {
    schema: SCHEMA_VERSION,
    id: uid('quiz'),
    title: 'Nouveau questionnaire',
    tagline: '',
    intro: '',
    emoji: '✦',
    image: '',
    accent: ACCENTS[0],
    axes,
    questions: [makeQuestion(axes)],
    results: [makeResult(axes)],
    updatedAt: Date.now(),
    ...partial,
  };
}

/* --- Normalisation --------------------------------------------------------
   Tout questionnaire venant de l'extérieur (fichier, URL, import) passe
   par ici. On répare ce qui est réparable, on ne fait jamais confiance
   à la forme reçue.                                                      */

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Questionnaire illisible.');

  const axes = (Array.isArray(raw.axes) ? raw.axes : [])
    .filter((a) => a && typeof a === 'object')
    .map((a, i) => ({
      id: String(a.id || uid('axe')),
      glyph: String(a.glyph || GLYPHS[i % GLYPHS.length]).slice(0, 4),
      label: String(a.label || `Axe ${i + 1}`).slice(0, 60),
      color: /^#[0-9a-f]{3,8}$/i.test(a.color || '') ? a.color : ACCENTS[i % ACCENTS.length],
    }));

  const axisIds = new Set(axes.map((a) => a.id));

  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .filter((q) => q && typeof q === 'object')
    .map((q) => ({
      id: String(q.id || uid('q')),
      text: String(q.text || ''),
      hint: String(q.hint || ''),
      image: safeImage(q.image),
      type: q.type === 'multiple' ? 'multiple' : 'single',
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o) => o && typeof o === 'object')
        .map((o) => ({
          id: String(o.id || uid('opt')),
          text: String(o.text || ''),
          emoji: String(o.emoji || '').slice(0, 8),
          image: safeImage(o.image),
          scores: Object.fromEntries(
            axes.map((a) => [a.id, clampScore(o.scores?.[a.id])])
          ),
        })),
    }));

  const results = (Array.isArray(raw.results) ? raw.results : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const mode = RULE_MODES.some((m) => m.id === r.rule?.mode) ? r.rule.mode : 'fallback';
      const axis = axisIds.has(r.rule?.axis) ? r.rule.axis : (axes[0]?.id ?? null);
      /* Un profil avait un champ emoji distinct de son titre. Deux champs
         pour une seule idée : l'emoji se met dans le titre, et le titre
         s'affiche tel qu'il est écrit. Les questionnaires déjà saisis ne
         perdent rien — l'emoji est replié dans le titre à la lecture,
         une fois, et le champ disparaît. */
      const titre = String(r.title || '');
      const emojiSeul = String(r.emoji || '').slice(0, 8).trim();
      const titreComplet = emojiSeul && !titre.startsWith(emojiSeul)
        ? `${emojiSeul} ${titre}`.trim()
        : titre;

      return {
        id: String(r.id || uid('res')),
        title: titreComplet,
        subtitle: String(r.subtitle || ''),
        text: String(r.text || ''),
        image: safeImage(r.image),
        rule: {
          mode,
          axis: mode === 'total' || mode === 'fallback' ? null : axis,
          min: Number.isFinite(+r.rule?.min) ? +r.rule.min : 0,
          max: Number.isFinite(+r.rule?.max) ? +r.rule.max : 999,
        },
        recos: (Array.isArray(r.recos) ? r.recos : [])
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            id: String(c.id || uid('reco')),
            type: RECO_TYPES.some((t) => t.id === c.type) ? c.type : 'autre',
            title: String(c.title || ''),
            creator: String(c.creator || ''),
            year: String(c.year || ''),
            note: String(c.note || ''),
            link: /^https?:\/\//i.test(c.link || '') ? c.link : '',
            image: safeImage(c.image),
            /* Où trouver l'œuvre dans le bâtiment : cote, rayon, étage.
               Un champ libre plutôt que deux : chaque établissement a ses
               conventions, et « Jeunesse · R MAN » se lit aussi bien que
               deux cases dont une resterait vide la moitié du temps. */
            location: String(c.location || '').slice(0, 80),
          })),
      };
    });

  return {
    schema: SCHEMA_VERSION,
    id: String(raw.id || uid('quiz')),
    title: String(raw.title || 'Questionnaire sans titre').slice(0, 120),
    tagline: String(raw.tagline || '').slice(0, 180),
    intro: String(raw.intro || ''),
    emoji: String(raw.emoji || '✦').slice(0, 8),
    image: safeImage(raw.image),
    accent: /^#[0-9a-f]{3,8}$/i.test(raw.accent || '') ? raw.accent : ACCENTS[0],
    axes,
    questions,
    results,
    updatedAt: Number.isFinite(+raw.updatedAt) ? +raw.updatedAt : Date.now(),

    /* Le compteur de révision du garde-fou. Il ne sert qu'aux espaces —
       un brouillon local n'a personne avec qui se marcher dessus — mais il
       voyage avec le questionnaire pour survivre à un export/import.
       0 veut dire « jamais publié ». Voir ARCHITECTURE.md. */
    rev: Number.isFinite(+raw.rev) && +raw.rev > 0 ? Math.floor(+raw.rev) : 0,
    updatedBy: String(raw.updatedBy || ''),

    /* Qui est crédité sur CE questionnaire. Le second des deux
       consentements : la personne doit avoir publié sa vitrine, et le
       questionnaire doit la nommer. L'un sans l'autre n'affiche rien. */
    auteurs: (Array.isArray(raw.auteurs) ? raw.auteurs : [])
      .filter((u) => typeof u === 'string' && u)
      .slice(0, 12),
  };
}

/* --- L'identité d'un espace --------------------------------------------------
   Une médiathèque met son nom, sa couleur, son logo et le lien vers son
   propre site ; le kiosque s'habille avec. La branche est lisible de tous
   — le kiosque public en a besoin — donc elle passe par le même
   poste-frontière que le reste : une identité venue de la base n'est pas
   plus digne de confiance qu'un questionnaire reçu par lien.

   `titre` est le seul champ nécessaire. Sans lui, il n'y a pas d'identité
   du tout, et le kiosque garde la nôtre — ce qui est le bon repli : mieux
   vaut notre marque qu'une page anonyme.                                */

export const IDENTITE_VIDE = {
  titre: '', accroche: '', accent: '', logo: '', intro: '',
  retour: { libelle: '', url: '' }, pied: '',
};

export function normaliserIdentite(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const titre = String(raw.titre || '').slice(0, 80).trim();
  if (!titre) return null;

  const url = /^https?:\/\/[^\s"'<>]+$/i.test(raw.retour?.url || '') ? raw.retour.url : '';

  return {
    titre,
    accroche: String(raw.accroche || '').slice(0, 160),
    /* Même validation que l'accent d'un questionnaire : tout le thème en
       découle par color-mix, une valeur folle déteindrait sur la page. */
    accent: /^#[0-9a-f]{3,8}$/i.test(raw.accent || '') ? raw.accent : '',
    logo: safeImage(raw.logo),
    intro: String(raw.intro || '').slice(0, 600),
    /* Un lien de retour sans adresse n'est pas un lien ; une adresse sans
       libellé se nomme toute seule. */
    retour: url ? { libelle: String(raw.retour.libelle || '').slice(0, 60) || 'Retour au site', url } : null,
    pied: String(raw.pied || '').slice(0, 200),
  };
}

/* --- La présentation du kiosque ----------------------------------------------
   L'ordre des questionnaires, ceux qu'on retire de la vitrine sans les
   détruire, et celui qu'on met à la une. Lisible de tous — le kiosque
   public s'en sert — donc filtré comme le reste.

   Un identifiant absent de `ordre` se range APRÈS les autres,
   alphabétiquement : publier ne demande donc pas de penser au rangement, et
   la liste ne casse pas quand un identifiant disparaît.               */

export function normaliserPresentation(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const identifiant = (v) => (typeof v === 'string' && v ? v.slice(0, 80) : null);

  const ordre = (Array.isArray(source.ordre) ? source.ordre : [])
    .map(identifiant).filter(Boolean).slice(0, 200);

  /* Les masques arrivent en objet depuis la base ; on n'en garde que les
     clés vraies. Un `false` traîné ne veut rien dire de plus qu'une
     absence, et deux façons de dire non en feraient une de trop. */
  const masques = new Set(
    Object.entries(source.masques && typeof source.masques === 'object' ? source.masques : {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .filter(Boolean),
  );

  return { ordre, masques, epingle: identifiant(source.epingle) };
}

/* L'inverse, pour l'écriture : Set et null ne traversent pas JSON, et une
   branche vide vaut mieux qu'une branche pleine de faux. */
export function presentationPourLaBase({ ordre = [], masques = new Set(), epingle = null }) {
  const corps = {};
  if (ordre.length) corps.ordre = ordre;
  if (masques.size) corps.masques = Object.fromEntries([...masques].map((id) => [id, true]));
  if (epingle) corps.epingle = epingle;
  return Object.keys(corps).length ? corps : null;
}

function clampScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-9, Math.min(9, n));
}

/* --- Diagnostic -----------------------------------------------------------
   Renvoie une liste de problèmes classés. Le backoffice l'affiche en
   continu : un questionnaire n'est jamais « invalide », il est
   « pas encore prêt », et on dit précisément pourquoi.                   */

export function diagnose(quiz) {
  const issues = [];
  const err = (msg, where) => issues.push({ level: 'error', msg, where });
  const warn = (msg, where) => issues.push({ level: 'warn', msg, where });

  if (!quiz.title.trim()) err('Le questionnaire n’a pas de titre.', 'identite');
  if (!quiz.axes.length) err('Aucun axe : il n’y a rien à compter.', 'axes');
  if (!quiz.questions.length) err('Aucune question.', 'questions');
  if (!quiz.results.length) err('Aucun profil de sortie.', 'resultats');

  const labels = new Set();
  quiz.axes.forEach((a) => {
    if (!a.label.trim()) warn('Un axe n’a pas de nom.', 'axes');
    if (labels.has(a.label.trim().toLowerCase())) {
      warn(`Deux axes s’appellent « ${a.label} ».`, 'axes');
    }
    labels.add(a.label.trim().toLowerCase());
  });

  quiz.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.text.trim()) err(`Question ${n} : le texte est vide.`, 'questions');
    if (q.options.length < 2) err(`Question ${n} : il faut au moins deux réponses.`, 'questions');
    q.options.forEach((o, j) => {
      if (!o.text.trim()) err(`Question ${n}, réponse ${j + 1} : texte vide.`, 'questions');
    });
    const anyPoint = q.options.some((o) => Object.values(o.scores).some((v) => v !== 0));
    if (!anyPoint && q.options.length) {
      warn(`Question ${n} : aucune réponse ne rapporte de point, elle n’influence rien.`, 'questions');
    }
  });

  /* Un axe qui ne reçoit jamais de point ne peut pas être dominant. */
  quiz.axes.forEach((a) => {
    const reachable = quiz.questions.some((q) => q.options.some((o) => (o.scores[a.id] || 0) > 0));
    if (!reachable) warn(`L’axe « ${a.label} » ne reçoit de point nulle part.`, 'axes');
  });

  quiz.results.forEach((r, i) => {
    const n = i + 1;
    if (!r.title.trim()) err(`Profil ${n} : pas de titre.`, 'resultats');
    if (!r.recos.length) warn(`Profil ${n} : aucune recommandation.`, 'resultats');
    r.recos.forEach((c, j) => {
      if (!c.title.trim()) warn(`Profil ${n}, reco ${j + 1} : pas de titre.`, 'resultats');
    });
    if (r.rule.mode === 'range' && r.rule.min > r.rule.max) {
      err(`Profil ${n} : intervalle inversé (min > max).`, 'resultats');
    }
  });

  /* La même œuvre dans deux profils n'est pas une faute : un roman peut
     convenir à deux tempéraments, et un bibliothécaire peut le vouloir.
     Mais c'est bien plus souvent un copier-coller oublié — et deux personnes
     aux réponses opposées repartent alors avec la même liste, ce qui vide le
     questionnaire de son sens. On le signale, on ne l'interdit pas.

     La comparaison se fait sur le titre seul, sans l'auteur : deux fiches
     de la même œuvre se saisissent rarement à l'identique. */
  const parTitre = new Map();
  quiz.results.forEach((r, i) => {
    const nomDuProfil = r.title.trim() || `Profil ${i + 1}`;
    const vusIci = new Set();
    for (const c of r.recos) {
      const cle = c.title.trim().toLowerCase();
      if (!cle || vusIci.has(cle)) continue;
      vusIci.add(cle);
      if (!parTitre.has(cle)) parTitre.set(cle, { titre: c.title.trim(), profils: [] });
      parTitre.get(cle).profils.push(nomDuProfil);
    }
  });
  for (const { titre, profils } of parTitre.values()) {
    if (profils.length > 1) {
      warn(`« ${titre} » est recommandé par ${profils.length} profils (${profils.join(', ')}). Voulu, ou oublié ?`, 'resultats');
    }
  }

  if (quiz.results.length && !quiz.results.some((r) => r.rule.mode === 'fallback')) {
    warn('Aucun profil « par défaut » : un répondant dont aucune règle ne se déclenche n’obtiendra aucun résultat. Une égalité entre deux axes suffit.', 'resultats');
  }

  return issues;
}
