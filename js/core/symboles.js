/* ==========================================================================
   symboles.js — le dictionnaire des glyphes et des emojis.

   Trois champs du backoffice demandent un signe : le glyphe d'un axe, l'emoji
   de couverture, l'emoji d'une réponse. Les trois étaient des champs libres.
   Un champ libre suppose qu'on sache déjà quoi y mettre, et surtout qu'on
   sache le SAISIR : sur un poste de travail sans pavé emoji, taper ✿ ou 🏛
   demande une table de caractères et de la patience. La liste de suggestions
   qui accompagnait le glyphe d'axe n'aidait qu'à moitié — un datalist ne se
   voit pas tant qu'on n'a pas commencé à taper, et on ne sait pas quoi taper.

   D'où ce dictionnaire, et un choix qui mérite d'être dit : il est CURÉ, pas
   exhaustif. Les quelque trois mille emojis d'Unicode ne rendraient pas le
   choix plus facile, ils le rendraient impossible — et la table complète
   pèserait plus lourd que tout le reste du produit réuni. Ce qui est ici est
   ce dont une médiathèque se sert : des supports, des genres, des lieux, des
   gens, des humeurs.

   Les mots-clés sont en français et servent la recherche. Ils sont volontai-
   rement généreux — « polar » trouve 🔎 comme « enquête » — parce qu'on
   cherche avec le mot qu'on a en tête, pas avec celui qu'un catalogue aurait
   choisi.
   ========================================================================== */

/* --- Les glyphes -----------------------------------------------------------
   Ceux d'un axe, qui se comptent et s'impriment. Ils doivent rester lisibles
   à 12 px dans le compteur et à 25 px sur la carte de résultat, en une seule
   couleur : d'où des formes pleines, sans détail fin, et pas d'emoji ici —
   un emoji porte sa propre couleur et refuserait celle de l'axe.

   Tous vérifiés présents dans les polices de base des trois systèmes
   (Miscellaneous Symbols, Dingbats, Geometric Shapes).                   */
export const GLYPHES = [
  {
    nom: 'Formes',
    signes: [
      ['●', 'rond cercle point plein'],
      ['○', 'rond cercle vide contour'],
      ['■', 'carré bloc plein'],
      ['□', 'carré vide contour'],
      ['▲', 'triangle haut montagne'],
      ['▼', 'triangle bas'],
      ['◆', 'losange carreau diamant'],
      ['◇', 'losange vide'],
      ['⬢', 'hexagone ruche'],
      ['⬟', 'pentagone'],
    ],
  },
  {
    nom: 'Étoiles et éclats',
    signes: [
      ['★', 'étoile favori préféré'],
      ['☆', 'étoile vide contour'],
      ['✦', 'éclat étincelle brillant'],
      ['✧', 'éclat vide'],
      ['✱', 'astérisque étoile note'],
      ['❖', 'losange orné ornement'],
      ['✺', 'soleil éclat rayonnant'],
      ['✵', 'étoile rayonnante'],
    ],
  },
  {
    nom: 'Cartes et cœurs',
    signes: [
      ['♥', 'cœur amour romance passion'],
      ['♠', 'pique carte jeu'],
      ['♣', 'trèfle carte jeu chance'],
      ['♦', 'carreau carte jeu'],
    ],
  },
  {
    nom: 'Nature',
    signes: [
      ['✿', 'fleur nature jardin'],
      ['❀', 'fleur nature pétale'],
      ['☀', 'soleil été chaleur jour'],
      ['☾', 'lune nuit sommeil rêve'],
      ['☁', 'nuage ciel pluie'],
      ['❄', 'flocon neige hiver froid'],
      ['♨', 'vapeur chaleur source'],
    ],
  },
  {
    nom: 'Signes',
    signes: [
      ['✚', 'croix plus soin santé'],
      ['✔', 'coche validé oui juste'],
      ['✖', 'croix non refus'],
      ['❤', 'cœur plein amour'],
      ['➤', 'flèche direction pointe'],
      ['⚑', 'drapeau repère marque'],
      ['⚓', 'ancre mer marine port'],
      ['⚙', 'engrenage mécanique technique'],
      ['⌘', 'commande boucle nœud'],
      ['☯', 'équilibre yin yang'],
    ],
  },
];

/* --- Les emojis ------------------------------------------------------------
   Ceux d'une couverture ou d'une réponse. Ils s'affichent en couleur, à
   grande taille, et n'ont pas à être monochromes.

   Le tri est thématique et non alphabétique : on cherche « quelque chose
   autour du polar », pas « quelque chose qui commence par p ».           */
export const EMOJIS = [
  {
    nom: 'Lire',
    signes: [
      ['📚', 'livres pile lecture bibliothèque collection'],
      ['📖', 'livre ouvert lecture roman'],
      ['📕', 'livre rouge roman'],
      ['📗', 'livre vert'],
      ['📘', 'livre bleu'],
      ['📙', 'livre orange'],
      ['📓', 'carnet cahier notes'],
      ['📔', 'carnet décoré journal intime'],
      ['🔖', 'marque-page signet'],
      ['📜', 'parchemin rouleau ancien histoire'],
      ['📰', 'journal presse actualité'],
      ['✍️', 'écrire écriture auteur plume'],
      ['🖋️', 'plume stylo écriture'],
      ['📝', 'note écrire brouillon'],
    ],
  },
  {
    nom: 'Écouter et voir',
    signes: [
      ['🎧', 'casque écoute musique podcast audio'],
      ['🎵', 'musique note chanson'],
      ['🎶', 'musique notes mélodie'],
      ['🎸', 'guitare rock musique'],
      ['🎹', 'piano clavier musique classique'],
      ['🎺', 'trompette jazz cuivre'],
      ['🥁', 'batterie percussion rythme'],
      ['🎤', 'micro chant karaoké voix'],
      ['💿', 'disque cd album'],
      ['📀', 'disque dvd'],
      ['🎬', 'cinéma film clap réalisateur'],
      ['🎞️', 'pellicule film cinéma'],
      ['📺', 'télévision série écran'],
      ['📻', 'radio poste écoute'],
      ['🎨', 'peinture art palette dessin'],
      ['🖼️', 'tableau cadre art musée'],
      ['📷', 'photo appareil photographie'],
    ],
  },
  {
    nom: 'Genres et ambiances',
    signes: [
      ['🔎', 'polar enquête loupe mystère détective indice'],
      ['🕵️', 'détective enquête polar espion'],
      ['👻', 'fantôme horreur peur épouvante'],
      ['💀', 'crâne mort horreur noir'],
      ['🚀', 'fusée science-fiction espace futur'],
      ['🛸', 'soucoupe extraterrestre science-fiction'],
      ['🐉', 'dragon fantasy imaginaire merveilleux'],
      ['🧙', 'magicien fantasy magie sorcier'],
      ['🗡️', 'épée aventure combat chevalier'],
      ['🏰', 'château moyen âge fantasy conte'],
      ['💘', 'romance amour sentimental'],
      ['😂', 'humour rire comédie drôle'],
      ['😢', 'triste drame émotion larmes'],
      ['😱', 'peur suspense thriller angoisse'],
      ['🧩', 'énigme puzzle jeu réflexion'],
      ['🗺️', 'carte voyage aventure exploration'],
      ['🧭', 'boussole voyage direction exploration'],
      ['⚗️', 'science chimie expérience laboratoire'],
      ['🔬', 'science microscope recherche documentaire'],
      ['🌍', 'monde terre voyage géographie société'],
      ['⏳', 'temps histoire passé sablier patience'],
    ],
  },
  {
    nom: 'Qui lit',
    signes: [
      ['👶', 'bébé tout-petit crèche'],
      ['🧒', 'enfant jeunesse'],
      ['🧑', 'adulte personne'],
      ['🧓', 'senior âgé aîné'],
      ['👨‍👩‍👧', 'famille parents enfants'],
      ['👯', 'amis groupe ensemble'],
      ['🤝', 'ensemble collectif partage entraide'],
      ['💭', 'penser réflexion rêverie'],
      ['🧠', 'cerveau réflexion savoir mémoire'],
      ['❤️', 'cœur amour coup de cœur'],
      ['✨', 'magie émerveillement découverte'],
    ],
  },
  {
    nom: 'Lieux et moments',
    signes: [
      ['🏛️', 'médiathèque bibliothèque institution colonnes'],
      ['🏠', 'maison chez soi cocon'],
      ['🛋️', 'canapé confort cosy détente'],
      ['🌳', 'arbre nature parc dehors'],
      ['🏖️', 'plage été vacances soleil'],
      ['⛰️', 'montagne randonnée hauteur'],
      ['🌊', 'mer vague océan large'],
      ['🚂', 'train voyage trajet'],
      ['☕', 'café pause chaud matin'],
      ['🍵', 'thé pause calme'],
      ['🕯️', 'bougie veillée douceur soir'],
      ['🌙', 'nuit lune coucher rêve'],
      ['🌞', 'soleil jour été lumière'],
      ['🍂', 'automne feuilles saison'],
      ['⛄', 'hiver neige froid'],
      ['🌷', 'printemps fleur renouveau'],
    ],
  },
  {
    nom: 'Repères',
    signes: [
      ['⭐', 'étoile favori sélection'],
      ['🌟', 'étoile brillante coup de cœur'],
      ['🔥', 'feu tendance populaire'],
      ['💡', 'idée découverte suggestion'],
      ['🎁', 'cadeau surprise offrir'],
      ['🏆', 'prix récompense trophée primé'],
      ['🎯', 'cible juste pertinent'],
      ['🔑', 'clé accès secret'],
      ['🧵', 'fil série suite'],
      ['📍', 'lieu repère localisation'],
      ['✅', 'validé oui fait'],
      ['❓', 'question interrogation'],
      ['❗', 'important attention'],
    ],
  },
];

/* Cherche dans un dictionnaire. Insensible à la casse et aux accents, parce
   que « medi » doit trouver « médiathèque » : on ne tape pas ses accents
   quand on cherche vite. Le signe lui-même est comparé aussi — coller un
   emoji dans la recherche le retrouve.                                   */
function sansAccent(texte) {
  /* Les ligatures d'abord, et ce n'est pas un détail : Unicode ne décompose
     PAS « œ ». Ni NFD ni NFKD n'en font « oe » — c'est une lettre à part
     entière, pas un e accentué. Sans cette ligne, « coeur » ne trouvait rien
     alors que le mot-clé était « cœur », et personne ne tape « œ ».

     Les diacritiques ensuite, par leur point de code plutôt que collés dans
     la classe : un caractère combinant écrit littéralement dans une source
     est invisible à la relecture. */
  return texte
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function chercher(dictionnaire, requete) {
  const q = sansAccent(String(requete || '').trim());
  if (!q) return dictionnaire;
  return dictionnaire
    .map((groupe) => ({
      nom: groupe.nom,
      signes: groupe.signes.filter(([signe, mots]) => signe === requete.trim() || sansAccent(mots).includes(q)),
    }))
    .filter((groupe) => groupe.signes.length > 0);
}

/* Les mots-clés d'un signe, pour l'infobulle et pour l'étiquette lue par une
   synthèse vocale : « ✿ » ne se dit pas, « fleur » si.                   */
export function motsDe(dictionnaire, signe) {
  for (const groupe of dictionnaire) {
    for (const [s, mots] of groupe.signes) if (s === signe) return mots;
  }
  return null;
}
