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

   Curé ne veut pas dire maigre, et la première version l'était : cent trente
   signes, où l'on cherchait « atelier », « manga », « jeu vidéo » ou
   « premier » sans rien trouver. Un dictionnaire trop court est pire qu'un
   champ libre — il donne l'impression d'avoir cherché. La recherche étant le
   chemin principal (on tape ce qu'on a en tête, on ne parcourt pas la
   grille), le volume ne coûte presque rien à l'usage tant que les mots-clés
   suivent : c'est eux qu'il faut soigner, pas la brièveté de la liste.

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

   Choisis dans les blocs que les polices système servent depuis toujours —
   Geometric Shapes, Dingbats, Miscellaneous Symbols, Arrows, Enclosed
   Alphanumerics — et passés à un banc plutôt qu'à l'œil : chacun est dessiné
   sur un canvas en rouge pur, et l'on vérifie deux choses. Qu'il y ait de
   l'encre, et qu'elle ne ressemble pas au rectangle du caractère manquant
   (sinon aucune police ne le connaît). Et que cette encre soit VRAIMENT
   rouge : un pixel dont le vert ou le bleu s'écarte de l'alpha vient d'une
   police en couleur, c'est-à-dire d'un emoji déguisé — qui imposerait sa
   teinte et refuserait celle de l'axe.

   Le banc a mordu sur trois candidats, dont ⚓ — qui était dans cette liste
   depuis toujours. Sur un axe, l'ancre n'a jamais pris la couleur de l'axe,
   et personne ne l'avait vu : une pastille bleue au milieu de pastilles
   colorées ne ressemble pas à un défaut.

   Ce que le banc NE prouve pas : il ne connaît que les polices de CETTE
   machine. D'où le choix de blocs anciens et largement servis plutôt que de
   caractères récents, et l'écart prudent de ceux dont la présentation par
   défaut diffère d'un système à l'autre (⚕, ⏻).                        */
export const GLYPHES = [
  {
    nom: 'Formes',
    signes: [
      ['●', 'rond cercle point plein'],
      ['○', 'rond cercle vide contour'],
      ['◉', 'rond cible œil centre'],
      ['◎', 'rond double anneau cible'],
      ['◍', 'rond hachuré rempli'],
      ['◐', 'demi rond gauche moitié'],
      ['◑', 'demi rond droite moitié'],
      ['◒', 'demi rond bas moitié'],
      ['◓', 'demi rond haut moitié'],
      ['◔', 'quart rond quartier peu'],
      ['◕', 'trois quarts rond beaucoup'],
      ['■', 'carré bloc plein'],
      ['□', 'carré vide contour'],
      ['▣', 'carré double centre'],
      ['▪', 'petit carré plein point'],
      ['▫', 'petit carré vide'],
      ['▬', 'barre trait plein rectangle'],
      ['▮', 'barre verticale bloc'],
      ['▲', 'triangle haut montagne'],
      ['△', 'triangle haut vide'],
      ['▴', 'petit triangle haut'],
      ['▼', 'triangle bas'],
      ['▽', 'triangle bas vide'],
      ['▾', 'petit triangle bas'],
      ['◀', 'triangle gauche retour'],
      ['▶', 'triangle droite lecture avancer'],
      ['◆', 'losange carreau diamant'],
      ['◇', 'losange vide'],
      ['◈', 'losange orné double'],
      ['◊', 'losange fin'],
      ['⬢', 'hexagone ruche'],
      ['⬡', 'hexagone vide'],
      ['⬟', 'pentagone'],
      ['⬠', 'pentagone vide'],
      ['◢', 'coin angle bas droite'],
      ['◤', 'coin angle haut gauche'],
      ['◯', 'grand cercle rond anneau'],
    ],
  },
  {
    nom: 'Étoiles et éclats',
    signes: [
      ['★', 'étoile favori préféré'],
      ['☆', 'étoile vide contour'],
      ['✦', 'éclat étincelle brillant'],
      ['✧', 'éclat vide'],
      ['✩', 'étoile légère contour'],
      ['✪', 'étoile cerclée médaille'],
      ['✫', 'étoile pointillée'],
      ['✬', 'étoile grasse'],
      ['✭', 'étoile ombrée'],
      ['✮', 'étoile creuse'],
      ['✯', 'étoile pivot'],
      ['✰', 'étoile ouverte'],
      ['✱', 'astérisque étoile note'],
      ['✲', 'astérisque ouvert'],
      ['✳', 'astérisque huit branches'],
      ['✴', 'étoile huit branches éclat'],
      ['✵', 'étoile rayonnante'],
      ['✶', 'étoile six branches'],
      ['✷', 'étoile six branches grasse'],
      ['✸', 'étoile huit pointes'],
      ['✹', 'étoile douze branches'],
      ['✺', 'soleil éclat rayonnant'],
      ['✻', 'flocon étoilé'],
      ['✼', 'étoile ouverte centre'],
      ['❂', 'soleil cerclé rayon'],
      ['❃', 'fleur étoilée'],
      ['❉', 'éclat fleuri'],
      ['❊', 'étoile huit pétales'],
      ['❋', 'étoile huit branches pleine'],
      ['❖', 'losange orné ornement'],
      ['✢', 'croix quatre branches'],
      ['✤', 'trèfle croix ornement'],
      ['✥', 'croix fleurie'],
      ['⁂', 'astérisme trois étoiles section'],
    ],
  },
  {
    nom: 'Cœurs, cartes et jeu',
    signes: [
      ['♥', 'cœur amour romance passion'],
      ['♡', 'cœur vide contour amour'],
      ['❤', 'cœur plein amour'],
      ['❥', 'cœur penché flèche'],
      ['❦', 'cœur feuille ornement'],
      ['❧', 'feuille ornement fin de texte'],
      ['♠', 'pique carte jeu'],
      ['♤', 'pique vide carte'],
      ['♣', 'trèfle carte jeu chance'],
      ['♧', 'trèfle vide carte'],
      ['♦', 'carreau carte jeu'],
      ['♢', 'carreau vide carte'],
      ['♔', 'roi échecs stratégie'],
      ['♕', 'reine dame échecs'],
      ['♖', 'tour échecs château'],
      ['♗', 'fou échecs'],
      ['♘', 'cavalier échecs cheval'],
      ['♙', 'pion échecs débuter'],
      ['♚', 'roi noir échecs'],
      ['♛', 'reine noire échecs'],
      ['♞', 'cavalier noir échecs'],
      ['⚀', 'dé un hasard'],
      ['⚁', 'dé deux hasard'],
      ['⚂', 'dé trois hasard'],
      ['⚃', 'dé quatre hasard'],
      ['⚄', 'dé cinq hasard'],
      ['⚅', 'dé six hasard'],
    ],
  },
  {
    nom: 'Nature et saisons',
    signes: [
      ['✿', 'fleur nature jardin'],
      ['❀', 'fleur nature pétale'],
      ['❁', 'fleur ouverte jardin'],
      ['☀', 'soleil été chaleur jour'],
      ['☼', 'soleil rayons blanc'],
      ['☾', 'lune nuit sommeil rêve'],
      ['☽', 'lune croissant nuit'],
      ['☁', 'nuage ciel pluie'],
      ['☂', 'parapluie pluie averse'],
      ['☃', 'bonhomme de neige hiver'],
      ['❄', 'flocon neige hiver froid'],
      ['❅', 'flocon étoilé neige'],
      ['❆', 'flocon lourd neige'],
      ['♨', 'vapeur chaleur source'],
      ['⚘', 'fleur tige botanique'],
      ['☘', 'trèfle chance irlande'],
    ],
  },
  {
    nom: 'Musique et écriture',
    signes: [
      ['♪', 'note musique mélodie'],
      ['♫', 'notes musique chanson'],
      ['♬', 'notes doubles musique'],
      ['♩', 'noire note musique'],
      ['♭', 'bémol musique partition'],
      ['♮', 'bécarre musique partition'],
      ['♯', 'dièse musique partition'],
      ['✎', 'crayon écrire note'],
      ['✏', 'crayon écriture auteur'],
      ['✐', 'crayon haut écrire'],
      ['✑', 'plume crayon rédiger'],
      ['✒', 'plume stylo écriture'],
      ['✁', 'ciseaux découpe atelier'],
      ['✂', 'ciseaux couper bricolage'],
      ['✄', 'ciseaux ligne découper'],
      ['✆', 'téléphone appel'],
      ['✇', 'bobine film pellicule'],
      ['✈', 'avion voyage départ'],
      ['✉', 'enveloppe courrier lettre'],
    ],
  },
  {
    nom: 'Flèches et repères',
    signes: [
      ['→', 'flèche droite suite suivant'],
      ['←', 'flèche gauche retour précédent'],
      ['↑', 'flèche haut monter'],
      ['↓', 'flèche bas descendre'],
      ['↔', 'flèche double horizontal équilibre'],
      ['↕', 'flèche double vertical'],
      ['↺', 'boucle recommencer tourner'],
      ['↻', 'boucle horaire recommencer'],
      ['⇄', 'échange aller retour'],
      ['➤', 'flèche direction pointe'],
      ['➔', 'flèche fine droite'],
      ['➜', 'flèche grasse droite'],
      ['➝', 'flèche fine pointe'],
      ['➞', 'flèche pleine droite'],
      ['➠', 'flèche décorée droite'],
      ['✔', 'coche validé oui juste'],
      ['✓', 'coche légère oui'],
      ['✖', 'croix non refus'],
      ['✗', 'croix biffé barré'],
      ['✘', 'croix grasse non'],
      ['✚', 'croix plus soin santé'],
      ['✛', 'croix ouverte'],
      ['✜', 'croix ancrée'],
      ['⚑', 'drapeau repère marque'],
      ['⚐', 'drapeau vide repère'],
      ['⚙', 'engrenage mécanique technique'],
      ['⌘', 'commande boucle nœud'],
      ['☯', 'équilibre yin yang'],
      ['☮', 'paix pacifisme'],
      ['⌂', 'maison accueil chez soi'],
    ],
  },
  {
    nom: 'Nombres',
    signes: [
      ['①', 'un premier 1'],
      ['②', 'deux second 2'],
      ['③', 'trois 3'],
      ['④', 'quatre 4'],
      ['⑤', 'cinq 5'],
      ['⑥', 'six 6'],
      ['⑦', 'sept 7'],
      ['⑧', 'huit 8'],
      ['⑨', 'neuf 9'],
      ['⑩', 'dix 10'],
      ['❶', 'un plein premier 1'],
      ['❷', 'deux plein 2'],
      ['❸', 'trois plein 3'],
      ['❹', 'quatre plein 4'],
      ['❺', 'cinq plein 5'],
      ['❻', 'six plein 6'],
      ['❼', 'sept plein 7'],
      ['❽', 'huit plein 8'],
      ['❾', 'neuf plein 9'],
      ['❿', 'dix plein 10'],
    ],
  },
  {
    nom: 'Marques de texte',
    signes: [
      ['¶', 'paragraphe texte pied de mouche'],
      ['§', 'section article règle'],
      ['†', 'croix obit note'],
      ['‡', 'double croix note'],
      ['※', 'renvoi note référence'],
      ['‽', 'interrobang surprise question'],
      ['❝', 'guillemet ouvrant citation'],
      ['❞', 'guillemet fermant citation'],
      ['«', 'guillemet français ouvrant citation'],
      ['»', 'guillemet français fermant citation'],
      ['…', 'points de suspension suite'],
      ['—', 'tiret cadratin incise'],
      ['№', 'numéro référence cote'],
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
      ['📔', 'carnet décoré journal intime'],
      ['📓', 'carnet cahier notes'],
      ['📒', 'registre cahier jaune'],
      ['📃', 'page feuille texte'],
      ['📄', 'document feuille page'],
      ['📑', 'onglets signets chapitres'],
      ['🔖', 'marque-page signet'],
      ['🏷️', 'étiquette cote rangement'],
      ['📜', 'parchemin rouleau ancien histoire'],
      ['📰', 'journal presse actualité revue magazine périodique'],
      ['🗞️', 'journal roulé presse revue magazine périodique'],
      ['✍️', 'écrire écriture auteur plume'],
      ['🖋️', 'plume stylo écriture'],
      ['🖊️', 'stylo bille écrire'],
      ['🖍️', 'craie couleur dessiner'],
      ['📝', 'note écrire brouillon'],
      ['📇', 'fichier fiches catalogue'],
      ['🗂️', 'dossiers classement rangement'],
      ['📐', 'équerre mesure géométrie'],
      ['🔤', 'alphabet lettres apprendre lire'],
      ['🈶', 'idéogramme japonais langue'],
      ['🔡', 'minuscules lettres langue'],
    ],
  },
  {
    nom: 'Bulles et imaginaire',
    signes: [
      ['🗯️', 'bande dessinée bulle colère bd album'],
      ['💬', 'bulle dialogue parole discussion'],
      ['🗨️', 'bulle gauche parole'],
      ['💥', 'comics explosion onomatopée boum bd super-héros'],
      ['🌸', 'manga fleur cerisier japon bd'],
      ['🎴', 'cartes japonaises hanafuda japon'],
      ['🦸', 'super-héros comics héroïne'],
      ['🦹', 'super-vilain méchant comics'],
      ['🧛', 'vampire horreur fantastique'],
      ['🧟', 'zombie horreur apocalypse'],
      ['🧜', 'sirène merveilleux conte'],
      ['🧚', 'fée conte merveilleux magie'],
      ['🧝', 'elfe fantasy imaginaire'],
      ['🐉', 'dragon fantasy imaginaire merveilleux'],
      ['🦄', 'licorne merveilleux rêve'],
      ['🧙', 'magicien fantasy magie sorcier'],
      ['🔮', 'boule de cristal divination mystère'],
      ['👽', 'extraterrestre science-fiction'],
      ['🤖', 'robot science-fiction intelligence'],
      ['👾', 'monstre pixel rétro jeu'],
    ],
  },
  {
    nom: 'Écouter et voir',
    signes: [
      ['🎧', 'casque écoute musique podcast audio livre audio texte lu'],
      ['🎵', 'musique note chanson'],
      ['🎶', 'musique notes mélodie'],
      ['🎼', 'partition solfège musique'],
      ['🎸', 'guitare rock musique'],
      ['🎹', 'piano clavier musique classique'],
      ['🎺', 'trompette jazz cuivre'],
      ['🎷', 'saxophone jazz'],
      ['🎻', 'violon classique orchestre'],
      ['🥁', 'batterie percussion rythme'],
      ['🪗', 'accordéon musette bal'],
      ['🎤', 'micro chant karaoké voix'],
      ['🎙️', 'micro studio podcast radio'],
      ['💿', 'disque cd album'],
      ['📀', 'disque dvd'],
      ['📼', 'cassette vidéo vhs archive'],
      ['🎬', 'cinéma film clap réalisateur'],
      ['🎞️', 'pellicule film cinéma'],
      ['📽️', 'projecteur cinéma séance'],
      ['📺', 'télévision série écran'],
      ['📻', 'radio poste écoute'],
      ['🔊', 'son fort haut-parleur écouter'],
      ['📢', 'annonce mégaphone information'],
      ['🎚️', 'réglage curseur son'],
      ['🎨', 'peinture art palette dessin'],
      ['🖼️', 'tableau cadre art musée exposition'],
      ['🖌️', 'pinceau peindre atelier'],
      ['📷', 'photo appareil photographie'],
      ['📸', 'photo flash reportage'],
      ['🎦', 'projection séance cinéma'],
    ],
  },
  {
    nom: 'Jouer',
    signes: [
      ['🎲', 'dé jeu de société hasard ludothèque'],
      ['🎮', 'manette jeu vidéo console'],
      ['🕹️', 'joystick jeu vidéo rétro arcade'],
      ['♟️', 'pion échecs stratégie'],
      ['🧩', 'énigme puzzle jeu réflexion mystère'],
      ['🃏', 'joker carte jeu'],
      ['🀄', 'mahjong tuile jeu'],
      ['🎯', 'cible juste pertinent'],
      ['🎳', 'bowling loisir'],
      ['🪁', 'cerf-volant dehors jeu'],
      ['🧸', 'peluche tout-petit doudou'],
      ['🏓', 'tennis de table sport loisir'],
    ],
  },
  {
    nom: 'Numérique',
    signes: [
      ['💻', 'ordinateur portable numérique ressource en ligne'],
      ['🖥️', 'ordinateur écran poste'],
      ['⌨️', 'clavier saisir taper'],
      ['🖱️', 'souris ordinateur'],
      ['📱', 'téléphone mobile smartphone numérique'],
      ['💾', 'disquette enregistrer sauvegarde'],
      ['🖨️', 'imprimante impression'],
      ['🌐', 'internet web monde en ligne numérique ressource'],
      ['📡', 'antenne réseau diffusion'],
      ['🔌', 'prise branchement électricité'],
      ['🔋', 'batterie énergie autonomie'],
      ['💡', 'idée découverte suggestion'],
      ['🖇️', 'trombone pièce jointe lien'],
      ['🗃️', 'boîte archives fichiers'],
    ],
  },
  {
    nom: 'Genres et ambiances',
    signes: [
      ['🔎', 'polar enquête loupe mystère détective indice'],
      ['🕵️', 'détective enquête polar espion'],
      ['👻', 'fantôme horreur peur épouvante'],
      ['💀', 'crâne mort horreur noir'],
      ['🩸', 'sang thriller horreur'],
      ['🚀', 'fusée science-fiction espace futur'],
      ['🛸', 'soucoupe extraterrestre science-fiction'],
      ['🪐', 'planète espace astronomie science-fiction'],
      ['🌌', 'galaxie espace nuit rêverie'],
      ['🔭', 'télescope astronomie découverte'],
      ['🗡️', 'épée aventure combat chevalier'],
      ['⚔️', 'combat guerre bataille histoire'],
      ['🛡️', 'bouclier protection défense'],
      ['🏰', 'château moyen âge fantasy conte'],
      ['🏺', 'amphore antiquité archéologie histoire'],
      ['💘', 'romance amour sentimental'],
      ['💌', 'lettre d\'amour romance correspondance'],
      ['😂', 'humour rire comédie drôle'],
      ['🤣', 'fou rire humour comédie'],
      ['😢', 'triste drame émotion larmes'],
      ['😱', 'peur suspense thriller angoisse'],
      ['😲', 'surprise rebondissement étonnement'],
      ['🗺️', 'carte voyage aventure exploration'],
      ['🧭', 'boussole voyage direction exploration'],
      ['⚗️', 'science chimie expérience laboratoire'],
      ['🔬', 'science microscope recherche documentaire'],
      ['🧬', 'biologie génétique science'],
      ['🌍', 'monde terre voyage géographie société'],
      ['⏳', 'temps histoire passé sablier patience'],
      ['🕰️', 'horloge ancienne temps mémoire'],
      ['⚖️', 'justice droit société procès'],
      ['🗳️', 'vote élection citoyenneté politique'],
      ['♻️', 'écologie environnement nature planète'],
      ['🧠', 'cerveau réflexion savoir mémoire psychologie'],
      ['🩺', 'médecine santé soin corps'],
    ],
  },
  {
    nom: 'Qui lit',
    signes: [
      ['👶', 'bébé tout-petit crèche'],
      ['🧒', 'enfant jeunesse'],
      ['👧', 'fille enfant jeunesse'],
      ['👦', 'garçon enfant jeunesse'],
      ['🧑', 'adulte personne'],
      ['🧓', 'senior âgé aîné'],
      ['👵', 'grand-mère aînée'],
      ['👴', 'grand-père aîné'],
      ['👨‍👩‍👧', 'famille parents enfants'],
      ['🧑‍🎓', 'étudiant lycéen études'],
      ['👩‍🏫', 'enseignante classe scolaire'],
      ['🧑‍💼', 'professionnel travail bureau'],
      ['👯', 'amis groupe ensemble'],
      ['🤝', 'ensemble collectif partage entraide'],
      ['🙋', 'question main levée participer'],
      ['💭', 'penser réflexion rêverie'],
      ['❤️', 'cœur amour coup de cœur'],
      ['✨', 'magie émerveillement découverte'],
      ['😌', 'apaisé calme douceur'],
      ['🥰', 'tendresse affection douceur'],
      ['🤩', 'enthousiasme émerveillement coup de cœur'],
      ['🤔', 'hésitation question réflexion'],
      ['😴', 'sommeil calme sieste repos'],
      ['🥱', 'ennui bâillement lassitude'],
      ['😤', 'colère révolte indignation'],
      ['🫶', 'affection cœur mains tendresse'],
    ],
  },
  {
    nom: 'Lieux et moments',
    signes: [
      ['🏛️', 'médiathèque bibliothèque institution colonnes musée'],
      ['🏫', 'école scolaire classe'],
      ['🏢', 'immeuble ville bureau'],
      ['🏠', 'maison chez soi cocon'],
      ['🛋️', 'canapé confort cosy détente'],
      ['🛏️', 'lit soir coucher histoire du soir'],
      ['🌳', 'arbre nature parc dehors'],
      ['🏖️', 'plage été vacances soleil'],
      ['⛰️', 'montagne randonnée hauteur'],
      ['🌊', 'mer vague océan large'],
      ['🏝️', 'île évasion voyage'],
      ['🌉', 'pont ville nuit'],
      ['🗼', 'tour monument ville voyage'],
      ['⛺', 'camping dehors aventure'],
      ['🚂', 'train voyage trajet'],
      ['🚌', 'bus bibliobus tournée'],
      ['🚲', 'vélo balade ville'],
      ['✈️', 'avion voyage ailleurs'],
      ['🛶', 'canoë rivière aventure'],
      ['☕', 'café pause chaud matin'],
      ['🍵', 'thé pause calme'],
      ['🕯️', 'bougie veillée douceur soir'],
      ['🌙', 'nuit lune coucher rêve'],
      ['🌞', 'soleil jour été lumière'],
      ['🌅', 'aube lever matin commencement'],
      ['🌆', 'crépuscule soir ville'],
      ['🍂', 'automne feuilles saison'],
      ['⛄', 'hiver neige froid'],
      ['🌷', 'printemps fleur renouveau'],
      ['🌈', 'arc-en-ciel espoir diversité'],
    ],
  },
  {
    nom: 'Rendez-vous et ateliers',
    signes: [
      ['🎪', 'animation atelier spectacle chapiteau rendez-vous programmation'],
      ['🎭', 'théâtre spectacle masques'],
      ['🎉', 'fête événement inauguration'],
      ['🎊', 'fête confettis célébration'],
      ['🎈', 'ballon fête enfance'],
      ['🎁', 'cadeau surprise offrir'],
      ['🎂', 'anniversaire gâteau fête'],
      ['🧶', 'laine tricot atelier'],
      ['🧵', 'fil couture atelier série suite'],
      ['✂️', 'ciseaux découpage bricolage atelier'],
      ['🍿', 'pop-corn séance cinéma'],
      ['📅', 'agenda date rendez-vous'],
      ['📆', 'calendrier programme saison'],
      ['⏰', 'heure horaire rappel'],
      ['🔔', 'cloche annonce rappel'],
      ['🎟️', 'billet entrée réservation'],
      ['🪑', 'chaise atelier salle rencontre'],
      ['🗣️', 'parole rencontre conférence lecture à voix haute'],
    ],
  },
  {
    nom: 'Nature et bestiaire',
    signes: [
      ['🌲', 'sapin forêt nature'],
      ['🌴', 'palmier tropiques ailleurs'],
      ['🌵', 'cactus désert western'],
      ['🍄', 'champignon forêt merveilleux'],
      ['🌻', 'tournesol été jardin'],
      ['🌼', 'marguerite fleur douceur'],
      ['🍀', 'trèfle chance porte-bonheur'],
      ['🐝', 'abeille nature écologie'],
      ['🦋', 'papillon métamorphose légèreté'],
      ['🐈', 'chat compagnon douceur'],
      ['🐕', 'chien compagnon fidélité'],
      ['🦉', 'hibou chouette sagesse nuit'],
      ['🐢', 'tortue lenteur patience'],
      ['🐬', 'dauphin mer animal'],
      ['🐋', 'baleine océan grand large'],
      ['🦊', 'renard rusé conte'],
      ['🐻', 'ours forêt conte'],
      ['🦁', 'lion courage savane'],
      ['🐘', 'éléphant mémoire afrique'],
      ['🐧', 'manchot froid banquise'],
      ['🐴', 'cheval équitation western'],
      ['🐌', 'escargot lenteur détail'],
      ['🕷️', 'araignée peur toile'],
      ['🌱', 'pousse graine commencement'],
    ],
  },
  {
    nom: 'Pause et gourmandise',
    signes: [
      ['🍫', 'chocolat gourmandise douceur'],
      ['🍪', 'biscuit goûter enfance'],
      ['🥐', 'croissant matin français'],
      ['🍎', 'pomme fruit santé école'],
      ['🍕', 'pizza partage convivialité'],
      ['🍷', 'vin soirée adulte'],
      ['🧃', 'jus goûter enfance'],
      ['🍯', 'miel douceur nature'],
      ['🥖', 'pain baguette quotidien'],
      ['🍲', 'cuisine plat recette'],
    ],
  },
  {
    nom: 'Repères',
    signes: [
      ['⭐', 'étoile favori sélection'],
      ['🌟', 'étoile brillante coup de cœur'],
      ['🔥', 'feu tendance populaire'],
      ['🏆', 'prix récompense trophée primé'],
      ['🥇', 'premier médaille or prix'],
      ['🎖️', 'distinction honneur sélection'],
      ['📌', 'punaise épingler important'],
      ['📍', 'lieu repère localisation'],
      ['🧲', 'aimant attirer incontournable'],
      ['🔑', 'clé accès secret'],
      ['🗝️', 'vieille clé mystère accès'],
      ['🚪', 'porte entrée passage'],
      ['✅', 'validé oui fait'],
      ['❓', 'question interrogation'],
      ['❗', 'important attention'],
      ['⚠️', 'avertissement prudence'],
      ['🆕', 'nouveauté nouveau récent'],
      ['🆓', 'gratuit libre accès'],
      ['♿', 'accessibilité handicap accueil'],
      ['🔠', 'gros caractères lecture facile'],
      ['👍', 'recommandé approuvé bien'],
      ['🙌', 'enthousiasme bravo réussite'],
      ['💎', 'pépite trésor rare'],
      ['🧡', 'coup de cœur affection'],
      ['🩷', 'tendresse coup de cœur'],
      ['🎀', 'ruban joli soigné'],
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
  const brut = String(requete || '').trim();
  /* Les mots un par un, et TOUS exigés. La requête était comparée d'un bloc :
     « ressource numérique » ne trouvait rien alors que les deux mots sont dans
     les mots-clés de 🌐, simplement dans l'autre ordre. On ne tape pas la
     formule du catalogue, on tape deux mots qui décrivent ce qu'on cherche —
     et l'ordre où ils viennent n'est pas une information.

     Le défaut ne se voyait pas tant que le dictionnaire était court : on
     trouvait par la grille, faute de trouver par la recherche.

     La ponctuation sépare comme une espace, elle ne se cherche pas : sans
     quoi « animation, atelier » — le libellé même d'un type de reco, qu'on
     recopie sans y penser — ne rendait rien, la virgule restant collée au
     premier mot. */
  if (!brut) return dictionnaire;
  const mots = sansAccent(brut).split(/[^a-z0-9]+/).filter(Boolean);

  const trouves = dictionnaire
    .map((groupe) => ({
      nom: groupe.nom,
      signes: groupe.signes.filter(([signe, cles]) => {
        /* Coller le signe lui-même le retrouve : c'est ainsi qu'on vérifie
           d'un coup d'œil ce qu'un champ contient déjà. Ce test passe AVANT
           les mots, et c'est ce qui le sauve : un emoji collé ne contient
           aucun caractère alphanumérique, donc aucun mot à chercher. */
        if (signe === brut) return true;
        if (!mots.length) return false;
        const sansAcc = sansAccent(cles);
        return mots.every((mot) => sansAcc.includes(mot));
      }),
    }))
    .filter((groupe) => groupe.signes.length > 0);

  /* Une requête sans aucun mot ET sans signe correspondant — de la ponctuation
     seule — n'a rien sur quoi filtrer : on rend le dictionnaire entier plutôt
     qu'un écran vide. Sans ce garde-fou, la coupe sur la ponctuation vidait
     `mots` et le collage d'un emoji rendait les 273 signes au lieu du sien. */
  return (!mots.length && !trouves.length) ? dictionnaire : trouves;
}

/* Les mots-clés d'un signe, pour l'infobulle et pour l'étiquette lue par une
   synthèse vocale : « ✿ » ne se dit pas, « fleur » si.                   */
export function motsDe(dictionnaire, signe) {
  for (const groupe of dictionnaire) {
    for (const [s, mots] of groupe.signes) if (s === signe) return mots;
  }
  return null;
}
