# Audit produit & UX — RecoHero

*Rédigé par lecture intégrale du dépôt (js/core, js/admin, js/quiz.js, js/gallery.js, CSS, règles Firebase) et par test en direct du parcours usager et du backoffice (navigateur, mobile 375px). Aucun fichier de code n'a été modifié pour produire ce document.*

*Date : 31 août 2026.*

---

## Comment lire ce document

Il suit les six points de vue demandés (Product Designer, UX ludique, médiation culturelle, recommandation, usager, créateur), mais plutôt que de les séparer en six sections, ils sont croisés à chaque étape — c'est ainsi qu'une équipe les ferait travailler ensemble. Chaque affirmation s'appuie sur un fichier et si possible une ligne ; chaque recommandation dit explicitement ce qu'elle coûte.

Un point de méthode, en amont de tout le reste : **RecoHero est déjà un projet inhabituellement mûr pour son stade.** Ce n'est pas un prototype. Le moteur de scoring est pur et testable, le diagnostic est en continu, l'annulation est profonde, le consentement de crédit est à double niveau, les statistiques évitent le mensonge par petit échantillon, la sécurité anti-écrasement est vérifiée à l'exécution. Rien de ce qui suit n'est un constat de retard technique — c'est un travail de *direction produit* sur un socle solide. Le lire comme une liste de fautes serait un contresens.

Un second principe, tout aussi structurant : **RecoHero s'adresse à des professionnels de la médiation et de l'écriture, pas à des amateurs à encadrer.** Chaque fois qu'une amélioration aurait consisté à glisser l'avis de l'outil entre le bibliothécaire et son public — un gabarit de phrase imposé, un guide de ton prescriptif, un jugement simulé sur « à quoi ressemble un bon lecteur curieux » — elle a été écartée dans ce document, même quand elle était facile à construire techniquement. C'est le cas en §5, §8 et §10, où l'analyse conclut explicitement à ne rien construire, et le dit.

---

## 1. Cartographie du produit actuel

### Architecture

Application statique, trois pages HTML, aucune étape de build, aucune dépendance externe. Le noyau (`js/core/`) est strictement séparé des contrôleurs de page :

```
pages          index.html (kiosque)   quiz.html (parcours)   admin.html (backoffice)
                     │                       │                       │
contrôleurs      gallery.js               quiz.js            admin/app.js + panels.js
                     └───────────────────────┴───────────────────────┘
noyau                              js/core/
        schema · scoring · catalog · share · store · remote · ui · views · card · sortable
```

- **`store.js`** : seul point d'accès à `localStorage` (préfixe `recohero.v1.`). Tout vit dans le navigateur : brouillons, historique de résultats (60 derniers), session en cours, jeton de connexion à l'espace.
- **`schema.js`** : forme des données, fabriques (`makeQuiz`, `makeAxis`…), normalisation défensive (`normalize()` — tout ce qui vient de l'extérieur y passe et ce qui n'est pas sûr est réparé ou jeté), diagnostic (`diagnose()`).
- **`scoring.js`** : fonctions pures — comptage (`tally`), résolution du profil (`resolve`, première règle qui matche gagne, ordre = priorité), proximité (`proximite`, le « vous n'étiez pas loin de… »), et joignabilité (`reachability`, exploration exhaustive ou échantillonnée pour détecter un profil impossible à atteindre).
- **`catalog.js`** : quatre sources de questionnaires — le lien (`#k=…`), un espace partagé (`?espace=…`), les brouillons locaux, l'exemple du dépôt.
- **`remote.js`** (626 lignes) : le seul module qui parle à un serveur — une Realtime Database Firebase en REST pur, uniquement si `?espace=` est présent. Sans ce paramètre, zéro requête ne part.
- **`card.js`** : compose la carte de résultat (1080×1350) sur un `<canvas>`, sans bibliothèque.

### Modèle de données (vu dans `quizzes/quel-roman-pour-cet-ete.json`)

Un questionnaire = `axes[]` (glyphe, nom, couleur) + `questions[]` (texte, type single/multiple, `options[]` avec un texte et un objet `scores{axeId: points}`) + `results[]` (titre, sous-titre, texte, `rule{mode, axis, min, max}`, `recos[]` avec type/titre/auteur/année/note/lien/image/**localisation physique** — `location`, ex. « Jeunesse · R MAN »).

Quatre modes de règle : **axe dominant** (cet axe seul en tête), **palier sur un axe**, **palier sur le total**, **par défaut** (filet de sécurité, toujours évalué en dernier). Une égalité entre deux axes ne déclenche *aucune* règle « dominant » — c'est un choix produit assumé et documenté : l'indécision est un profil à part entière, pas un cas d'erreur.

### Le modèle « Espace » — déjà largement construit

Ce que le brief appelle « Espaces » **existe déjà**, et c'est plus riche que ce à quoi on s'attendrait d'un projet statique sans backend propriétaire :

- Une équipe (`espaces/<nom>/membres`, plus des `gerants` intouchables sauf par la console Firebase) partage un catalogue (`espaces/<nom>/quizzes`) protégé par des règles serveur (garde-fou anti-écrasement par compteur de révision, vérifié à l'exécution par une écriture-sonde).
- Une identité publique personnalisable (nom, accroche, logo, couleur, lien de retour, pied de page) qui habille tout le kiosque de l'équipe.
- Une **vitrine** : ordre par glisser-déposer, « à la une », « masquer sans dépublier ».
- Une **corbeille** d'espace (20 derniers retraits, restaurable).
- Une **fréquentation** agrégée (parcours commencés/terminés/profils jamais atteints), avec des garde-fous statistiques réels (pas de pourcentage sous 30 réponses, pas de courbe dans le temps faute de date stockée).
- Un double consentement RGPD-conscient pour la signature d'un questionnaire (l'auteur doit rendre sa fiche publique **et** être coché sur ce questionnaire précis).

Ce que ce modèle **n'a pas** : une notion de sous-collection thématique à l'intérieur d'un espace (voir §14), une granularité de rôle au-delà de membre/gérant, un flux de validation avant publication, un mode « kiosque physique ». J'y reviens en détail en §14 et §6-9.

### Flux Création → Publication → Découverte → Questionnaire → Résultat → Prescription → Partage

```
Backoffice (admin.html)
  Créer / éditer un brouillon (localStorage, ce navigateur)
        │
        ├─ Publier dans un espace (Firebase, équipe) ──► Vitrine de l'espace (index.html?espace=…)
        ├─ Copier un lien (questionnaire entier compressé dans l'URL)
        ├─ Exporter un fichier JSON
        └─ Générer un code d'intégration (iframe)
                                                                  │
                                                                  ▼
                                                     Kiosque (grille de cartes)
                                                                  │
                                                                  ▼
                                              Parcours (quiz.html) : couverture → questions → résultat
                                                                  │
                                                  Profil + score + recommandations + « vous n'étiez pas loin de… »
                                                                  │
                                              Carte de résultat (canvas, PNG) · Partage natif/lien · Retour au kiosque
```

---

## 2. Audit du parcours usager (testé en direct, mobile 375 px)

### Avant le questionnaire — pourquoi commencer ?

Écran de couverture testé : emoji, titre, accroche, intro en deux courts paragraphes, les trois axes affichés d'emblée avec leur glyphe et leur couleur, bouton **« Commencer »**, puis un repère discret « 8 questions · 4 profils possibles ». C'est court, ça se lit en un regard, et montrer les axes *avant* de jouer (« Le Ressac / Le Grand Large / La Loupe ») pique déjà la curiosité sans expliquer ce qu'ils veulent dire — c'est le bon dosage de mystère.

**Ce qui manque à cet instant précis** : rien ne dit *combien de temps* ça prend. « 8 questions » ne traduit pas un effort en durée perçue — un usager de bibliothèque pressé (ou devant une tablette publique, avec quelqu'un derrière lui) veut savoir « 3 minutes » avant de s'engager. Le brief le demande explicitement pour l'affiche kiosque (§14D) — c'est un signal qui devrait déjà être sur cet écran-là, pas seulement sur l'affiche physique.

**Rien ne dit non plus ce que le répondant va y gagner en un mot.** « La reco dont vous êtes le héros » (marque globale) est jouée, mais localement l'intro reste neutre (« Ce questionnaire ne cherche pas à savoir si vous avez bon goût… »). C'est un bon texte, mais il n'y a pas de promesse explicite de récompense (« reparttez avec 3 livres qui vous ressemblent »).

### Pendant — pourquoi continuer ?

Testé avec deux parcours réels (un extrême, un mixte). Ce qui fonctionne très bien :

- **Le rythme est automatique** : un clic sur une réponse à choix unique déclenche une animation (les points « volent » vers le compteur d'axe dans le bandeau) puis avance seul après 340 ms. C'est un vrai geste de jeu, pas un formulaire — proche du quiz de magazine papier, en mieux.
- **Le compteur d'axes est visible en permanence**, avec l'axe en tête surligné (« on court », dixit `ARCHITECTURE.md`). Le suspense se construit question après question.
- **Les touches 1-9 et le balayage tactile** fonctionnent, et ne sont annoncés qu'une fois (à la question 1) pour ne pas polluer l'écran ensuite.
- Aucune friction technique observée : navigation avant/arrière fluide, changement d'avis sur une réponse pris en compte avant l'avancée automatique.

**Point de friction identifié en test réel** : sur une question à choix multiple, il n'y a **aucune indication visuelle qu'il faut cliquer sur « Suivant »** plutôt que d'attendre l'avancée automatique — le comportement change de mode sans signal fort (le texte du bouton dit juste « Suivant → » ou « Voir le résultat », identique visuellement à un bouton normal). Un usager habitué à l'auto-avance des 7 premières questions peut hésiter ou taper à côté à la question 8.

### À la fin — pourquoi croire au résultat ?

Le résultat teste bien : titre + sous-titre + texte de profil, puis feuille de score (jauges relatives au meilleur axe, pas à un plafond théorique jamais atteint — bon choix, documenté et justifié dans `ARCHITECTURE.md`), puis recommandations, puis **« Vous n'étiez pas loin de… »** quand c'est statistiquement vrai (`proximite()` renvoie `null` sinon — pas de fausse quasi-victoire).

C'est un vrai point fort produit : la mécanique de « proximité » observée en test (« Vous n'étiez pas loin de « Le partant » — à 2 ★ près ») est *exactement* ce que le brief demande en §4F (« évidentes / proches / surprenantes »armé pour la moitié du problème) — **elle existe déjà, mais elle n'est pas nommée comme un principe produit et n'est pas étendue** (voir §4 et §9).

**Ce qui manque pour « croire au résultat »** : le texte de profil explique une *sensibilité générale* mais ne relie jamais explicitement un choix de réponse précis au résultat (« vous avez choisi X, c'est ce qui a fait pencher la balance »). Le brief demande ce lien en §4E — il n'existe pas aujourd'hui, ni au niveau du profil, ni au niveau de chaque recommandation individuelle.

### Après — pourquoi regarder les prescriptions ?

Chaque reco affiche type/titre/auteur/année/note éditoriale, et — détail précieux pour un usage en bibliothèque réelle — la **localisation physique** (`reco.location`, ex. « Rayon Policier · cote R MAN »), affichée avec un 📍. C'est un détail rare et juste : ça anticipe le moment où l'usager, après avoir répondu sur son téléphone, se retrouve devant les rayonnages.

**Ce qui manque** : la « note » de chaque recommandation est une phrase éditoriale figée par l'auteur (« Court, brûlant, et écrit comme on se souvient : par éclats. ») — excellente en soi, mais elle ne varie jamais selon les réponses du visiteur. Deux personnes qui obtiennent le même profil verront exactement le même texte de justification pour chaque livre. C'est le point faible principal de l'explicabilité (voir §9).

### Ensuite — pourquoi partager ou refaire ?

La carte de résultat (canvas, 1080×1350, format story) est un vrai objet de partage soigné : titre du questionnaire, médaillon (image ou emoji), nom du profil en gros, feuille de score avec glyphes, jusqu'à 3 recos, signature « ✦ RecoHero ». Le partage natif (mobile) ou le téléchargement PNG fonctionnent sans bibliothèque. C'est un des meilleurs éléments du produit — voir §11 pour l'exploiter davantage.

Bouton « ↺ Refaire » présent, mais pas d'incitation explicite à essayer *un autre* questionnaire du même kiosque après un résultat (pas de « Envie d'un autre voyage ? » avec 2-3 cartes suggérées) — un usager qui vient de vivre une bonne expérience est laissé devant deux boutons (refaire / kiosque) plutôt que guidé vers la suite logique.

### Un défaut de fond observé en test, à corriger indépendamment de toute refonte

En testant le kiosque sans espace (`index.html`), **un brouillon local inachevé (« Nouveau questionnaire », sans titre réel, sans questions valides) apparaît dans la grille publique**, à côté du questionnaire réellement publié — étiqueté « Brouillon local », donc honnêtement signalé, mais visuellement indiscernable d'une vraie proposition pour un usager qui ne sait pas ce qu'est un « brouillon ». C'est le comportement documenté et voulu de `catalog.js` en mode solo (sans espace), mais c'est un risque réel dès qu'un ordinateur de bibliothèque sert à la fois de poste d'édition et de poste public sans qu'un espace Firebase ait été configuré — un scénario que le brief anticipe précisément (§14, bibliothèque qui commence sans compte).

---

## 3. Repenser le « test de personnalité »

Bonne nouvelle : **le produit a déjà évité le piège lexical le plus grave.** Nulle part dans le code, l'interface ou le README le mot « personnalité » n'apparaît. Le vocabulaire déjà en place — « questionnaire », « profil », « portrait » implicite, « la reco dont vous êtes le héros » — s'approche déjà d'un jeu de découverte plutôt que d'un instrument de diagnostic. C'est un point de départ solide, pas un chantier de zéro.

Ce qui reste ambigu :

- Le mot **« profil »**, employé partout en interne (`state.results`, l'UI de l'éditeur), a une connotation d'évaluation de la personne plus que de l'envie du moment. C'est un mot d'outil, pas un mot d'expérience — il ne fuit heureusement jamais côté répondant (le résultat dit « 🧭 Le partant », pas « votre profil est : Le partant »).
- Les phrases de couverture (« Ce questionnaire ne cherche pas à savoir si vous avez bon goût ») font déjà, dans l'exemple, le travail de désamorçage que demande le brief — mais c'est au bon vouloir de chaque auteur de questionnaire de l'écrire ainsi. Rien dans l'éditeur ne guide vers ce ton (voir §6).

**Recommandation de formulation** : ne pas remplacer « questionnaire » par un mot générique unique et figé pour tout le produit (« test », « portrait », « boussole » sonneraient tous un peu forcés en macro-libellé permanent). Réserver un vocabulaire de **catégorie d'expérience**, au choix de l'auteur au moment de la création (§7, étape 1) :
- *Trouver mon prochain livre* → ton pratique, proche de la recommandation.
- *Sortir de mes habitudes* → ton d'exploration, proche de « boussole ».
- *Portrait culturel du moment* → ton plus ludique et affectif, proche de « test » mais assumé comme jeu.

Le mot affiché au visiteur ne serait alors jamais « test » ni « questionnaire » de façon générique, mais dérivé du choix de l'auteur : « Faites le portrait », « Explorez », « Trouvez votre... ». Coût : quasi nul (un champ `intention` sur le questionnaire, une bibliothèque de formulations de bouton « Commencer » substituée selon ce champ).

---

## 4. Le résultat comme récompense — architecture actuelle et cible

État des lieux, brique par brique du brief :

**A. Le profil** — Existe, avec emoji + titre mémorable (« 🧭 Le partant »). Fonctionne bien. Recommandation : garantir dans le diagnostic (`diagnose()`, déjà extensible) qu'un profil sans emoji distinctif est signalé — aujourd'hui seul « pas de titre » est vérifié.

**B. Le portrait** — Existe (`subtitle` + `text`). Bon niveau de qualité dans l'exemple.

**C. Les indices** — **N'existe pas.** Rien ne montre au répondant *quelles réponses* ont le plus pesé dans le résultat. C'est pourtant calculable sans changer le modèle de données : `tally()` connaît déjà, par question, la contribution de chaque réponse choisie à l'axe gagnant. Un simple post-traitement (« vos réponses aux questions 3 et 6 ont le plus compté ») rendrait le résultat plus crédible sans toucher au moteur de scoring. Effort : faible, valeur : haute (répond directement à l'attente n°4 du brief et au problème d'explicabilité, §9).

**D. Les prescriptions** — Existent, bien formées, avec la localisation physique en prime.

**E. L'explication (« pourquoi celle-ci »)** — **Existe seulement au niveau du profil, pas de la recommandation.** Chaque reco a une `note` éditoriale statique mais aucune ne dit « parce que vous avez choisi X ». C'est le manque le plus net de la section résultat. Recommandation : réutiliser le même calcul que pour les « indices » (C) — associer chaque reco à l'axe qui l'a fait gagner, puis relier cet axe à la ou les réponses qui l'ont le plus nourri, et l'afficher en une ligne discrète sous chaque recommandation (« Parce que vous avez surtout coché : Le Grand Large »). Pas de nouvelle donnée à saisir par l'auteur — uniquement un affichage dérivé du scoring existant.

**F. La découverte (évidentes / proches / surprenantes / « faites-nous confiance »)** — **Partiellement construite et sous-exploitée.** `proximite()` fait déjà tout le travail technique du « proche » (un profil presque atteint, avec seuil calibré sur l'échelle du questionnaire). Il n'existe en revanche :
- aucune notion de recommandation « évidente vs surprenante » *à l'intérieur* d'un même profil (les 3 recos d'un profil sont de rang égal, alors que le brief demande une hiérarchie assumée) ;
- aucune mécanique de type « faites-nous confiance » (une reco volontairement hors-profil, poussée par l'équipe indépendamment du score).

C'est pertinent pour la prescription culturelle — un bibliothécaire *veut* pouvoir glisser un coup de cœur qui sort du calcul. Recommandation légère : ajouter un champ optionnel `confiance: boolean` sur une reco (« Ajouter en confiance, hors calcul »), affiché en dernier avec un habillage visuel distinct (« Et parce qu'on y tient : … »). Coût : un booléen dans le schéma + une ligne d'affichage, aucune refonte du moteur.

---

## 5. Transformer le questionnaire en expérience

Le modèle actuel de question (texte + options texte/emoji/image) est déjà capable de tout ce que demande le brief — questions narratives, dilemmes, choix d'images — car le champ `text` accepte n'importe quelle formulation et `image` existe déjà par option (« paysage à choisir »). **Ce n'est donc pas un manque technique.** Le questionnaire d'exemple (« Il est 15h un dimanche d'août, vous… ») prouve déjà, en situation, ce que le format permet — sans qu'aucune ligne de code particulière n'ait été nécessaire pour l'écrire ainsi.

**Ce document ne recommande pas de bibliothèque de gabarits de formulation intégrée à l'éditeur** (un menu « Situation / Dilemme / Association / Cochez tout » proposé à chaque question). Un bibliothécaire qui rédige un questionnaire fait un travail d'écriture et de médiation — c'est son métier, pas un manque à combler par des cases à cocher. Un menu de formulations imposé à chaque ajout de question risquerait de standardiser un ton que le produit gagne au contraire à laisser incarné, et de laisser entendre à un professionnel qu'on sait mieux que lui comment s'adresser à son public.

Le seul levier qui vaille la peine, et qui existe déjà sans rien à construire : pouvoir repartir d'un questionnaire réussi — l'exemple du dépôt ou celui d'un collègue — plutôt que d'un champ vide (voir §6, « Import/export comme substitut de template »). C'est une inspiration qu'on va chercher soi-même, pas une suggestion que l'outil impose à chaque question.

---

## 6. Audit du créateur (bibliothécaire non technique)

### Ce qui se passe à l'ouverture d'un questionnaire vierge (testé en direct)

Cliquer sur « + Nouveau questionnaire » ouvre directement l'éditeur complet, sur le panneau Identité, avec :
- Titre : *Nouveau questionnaire*
- 3 axes déjà créés, nommés littéralement **« Axe 1 », « Axe 2 », « Axe 3 »**
- 1 question vide, 2 réponses vides
- 1 profil vide, règle par défaut « axe dominant » sur Axe 1
- **10 problèmes de diagnostic déjà affichés**, dont 4 erreurs rouges

C'est le constat central de cette section : **il n'y a aucun état intermédiaire entre « rien » et « l'éditeur complet, déjà en échec ».** Un bibliothécaire qui découvre l'outil est accueilli par une liste rouge avant d'avoir rien fait. Le diagnostic est un excellent outil *pendant* l'édition (voir plus bas) — c'est un mauvais premier écran.

### Le vocabulaire technique, précisément

Confirmé en lisant `panels.js` et en testant le panneau Axes/Questions/Résultats :

- **Axes** : bien traduit — « Les signes que le questionnaire compte : les étoiles, les ronds, les triangles. » Glyphe, nom, couleur. Compréhensible sans explication.
- **Poids des réponses** : **non traduit**. Chaque réponse affiche une rangée de « puces » (une par axe), chacune contenant un simple `<input type="number" min="-9" max="9">`. Le bibliothécaire saisit littéralement un chiffre de -9 à 9 par axe par réponse. C'est exactement le `réponse A → +3 curiosité` que le brief signale comme trop technique — habillé d'une puce colorée avec le glyphe de l'axe, mais toujours un nombre brut à choisir sans échelle qualitative.
- **Règles de profil** : bien traduites en surface (« Axe dominant », « Palier sur un axe », « Palier sur le total », « Par défaut », chacune avec une phrase d'aide claire — « Filet de sécurité : gagne si aucune autre règle n'a matché. ») — mais les champs `min`/`max` en dessous restent des nombres bruts sans rappel d'unité, et le mot anglicisé « matche » s'est glissé dans une interface autrement très soignée en français.
- **« Condition de déclenchement »** est le terme-chapeau au-dessus du sélecteur de règle — correct, un peu abstrait pour un premier contact.

**Verdict sur la question posée par le brief** (« un bibliothécaire comprend-il intuitivement axes/poids/scores/profils/règles ? ») : les *concepts nommés* (axe, profil, condition) sont bien traduits. Le *geste concret le plus fréquent* — attribuer des points à chaque réponse, des dizaines de fois par questionnaire — reste un geste de tableur, pas un geste métier.

### Abstraction recommandée pour la saisie des poids

Remplacer (ou proposer en alternative, avec bascule) le nombre brut par une échelle qualitative à 4 niveaux, mappée en interne sur les mêmes valeurs numériques :

| Libellé affiché | Valeur interne |
|---|---|
| — | 0 |
| Un peu | 1 |
| Beaucoup | 2 |
| Complètement | 3 |

Au-delà de 3, un bibliothécaire dépasse rarement le besoin réel (l'exemple fourni n'utilise que 1 et 2). Un bouton « Voir en points » resterait disponible pour l'auteur avancé qui veut du -9/+9 fin. **Aucune migration de données nécessaire** : le champ reste un entier, seule la représentation change. C'est l'amélioration à plus fort rapport valeur/effort de tout l'audit créateur.

### Ce qui fonctionne déjà remarquablement pour un public non technique

À mettre au crédit du produit, sans réserve :
- **Rien ne demande confirmation, tout s'annule** — testé : suppression d'axe, de question, de questionnaire, toutes réversibles par un bandeau « Annuler » (6 secondes) et `Ctrl+Z` (40 gestes de structure).
- **L'aperçu en direct** (`views.js` partagé entre éditeur et parcours réel) élimine tout risque de divergence entre ce que l'auteur voit et ce que le visiteur verra.
- **Le diagnostic en continu**, avec pastilles par section et clic direct vers le problème, est un vrai filet de sécurité pédagogique — une fois passé le choc du premier écran.
- **Le placeholder « 📍 Où le trouver ? — Rayon Policier · cote R MAN »** sur le champ de localisation d'une reco est un détail qui montre une vraie connaissance du métier de bibliothécaire, pas une fonctionnalité générique.

### Les réglages de l'espace sont injoignables sans deviner où cliquer

Testé en direct : une fois un questionnaire ouvert, il n'existe **aucune entrée nommée « Espace » ou « Kiosque »** dans le rail de gauche (« Sections » ne liste que Identité / Axes / Questions / Résultats / Diffuser). Tout ce qui décrit l'espace lui-même — la vitrine (ordre, à la une, masquer), la corbeille, l'identité publique du kiosque, la fréquentation, l'équipe — vit derrière un unique petit bouton du bandeau, `👤 {prénom}`, dont le seul indice visuel est le nom de la personne connectée. Rien dans son libellé ne dit « c'est ici que se règle le kiosque de l'équipe ».

Le code documente lui-même la raison de ce choix (`ARCHITECTURE.md`, § « Un espace ne se règle pas depuis un questionnaire ») : ces réglages ont d'abord vécu dans le panneau « Diffuser », ce qui les rendait inatteignables tant qu'aucun questionnaire n'était ouvert — un vrai problème, corrigé en les déplaçant vers le compte. **Mais le correctif a déplacé le problème plutôt que de le résoudre entièrement** : atteignable depuis n'importe où, la fonctionnalité reste devinable nulle part. Un bibliothécaire qui cherche « où personnaliser mon kiosque » n'a aucune raison de penser à cliquer sur son propre nom — ce réflexe n'est acquis que dans des outils où le menu de compte contient *aussi* les réglages d'équipe (Slack, Notion), une convention qu'un public non technique n'a pas forcément intériorisée.

Recommandation : donner à ces réglages une entrée visible et nommée — un bloc « Mon espace » ou « Kiosque de l'équipe » dans le rail, à côté de « Sections », plutôt qu'un repli exclusif sur l'avatar de compte. Le bouton de compte peut continuer d'exister pour le mot de passe et la déconnexion — mais la vitrine, la corbeille et l'identité publique méritent une porte d'entrée à leur propre nom. Effort : faible (un bloc de rail supplémentaire pointant vers la feuille modale déjà écrite, `parametresCompte()`).

### Import/export comme substitut de template

Aujourd'hui, la seule façon de ne pas partir d'une page blanche est de dupliquer (« fork ») l'exemple publié ou un questionnaire déjà partagé en JSON. Ça fonctionne, mais ce n'est pas *découvrable* pour un premier bibliothécaire seul devant l'outil sans collègue déjà équipé — voir §7.

---

## 7. Assistant de création — ce qui vaut la peine, ce qui n'en vaut pas

Le brief propose une séquence en 6 étapes. Après lecture du code, voici ce qui, précisément, mérite d'être construit et ce qui ferait « usine à gaz » :

**À construire (assistant court, 4 écrans, pas 6)** :

1. **« Qu'avez-vous envie de faire découvrir ? »** — un choix visuel simple (Livres / BD / Films / Musique / Mélange), qui ne fait qu'une chose : préremplir le premier type de recommandation par défaut (`RECO_TYPES` existe déjà) et suggérer un ton de couverture.
2. **« Quel type de découverte ? »** — les intentions déjà proposées en §3 (trouver son prochain livre / sortir de ses habitudes / portrait du moment). Ce choix ne crée aucune donnée obligatoire — il sélectionne juste un jeu de textes-modèles pour la couverture et le bouton d'entrée.
3. **« Combien de tempéraments voulez-vous distinguer ? »** — un curseur 2 à 6, qui appelle `makeAxis()` en boucle (déjà la fabrique existante) et ouvre directement sur le panneau Axes pour les nommer, plutôt que sur « Axe 1/2/3 » muets.
4. **Atterrissage direct sur le panneau Questions**, avec la première question vide comme aujourd'hui — l'assistant configure la structure (axes, ton de couverture), jamais le contenu des questions elles-mêmes, qui reste entièrement la plume du bibliothécaire (voir §5).

Après ces 4 écrans, l'auteur se retrouve exactement dans l'éditeur actuel — rien n'est dupliqué, rien n'est cousu à part. L'assistant *paramètre* `makeQuiz()` au lieu de le laisser produire ses valeurs par défaut muettes.

**À ne pas construire** : un assistant qui rédige les questions ou les recommandations à la place du bibliothécaire, ou qui impose un nombre de questions/profils fixe. Le brief le dit lui-même : pas d'usine à gaz. Le contenu culturel doit rester la voix du bibliothécaire, jamais un gabarit qui l'écrit pour lui.

Effort estimé : modéré (un nouvel écran modal en 4 étapes dans `admin/app.js`, aucune modification du schéma). Valeur : haute — c'est la réponse directe au problème n°1 identifié en §13.

---

## 8. Simulateur de publics — analysé, et délibérément écarté

Techniquement, c'est la proposition la plus facile à construire de tout ce document. `scoring.js` est composé de fonctions pures (`tally`, `resolve`, `proximite`) qui prennent un jeu de réponses en entrée et rendent un résultat, sans jouer aucun écran, et `reachability()` s'en sert déjà pour simuler des milliers de parcours en une fraction de seconde afin de détecter les profils inatteignables. Générer des réponses selon des personas fictifs et les faire passer dans ce même moteur ne demanderait donc, techniquement, presque rien de neuf.

**Ce document ne le recommande pas, et la raison compte plus que la faisabilité.** Un « lecteur curieux type » ou un « lecteur fidèle à ses habitudes » inventé par l'outil serait nécessairement une caricature — exactement le risque que le brief identifie lui-même pour l'expert médiation culturelle (« risque de réduire les goûts culturels à des catégories caricaturales »). Faire juger un questionnaire par des personnages fabriqués par RecoHero, c'est faire porter au produit une opinion sur ce à quoi ressemble « un lecteur éclectique » — une opinion qui n'est pas la sienne à avoir. Le bibliothécaire qui écrit un questionnaire connaît déjà son public, ses habitués, ses silences ; un simulateur qui lui dirait « votre profil B ne sort jamais pour un lecteur curieux » évaluerait son travail à l'aune d'un public imaginaire inventé à sa place — avec le risque réel de lui faire sentir que son jugement professionnel est mis en doute par un algorithme.

**Ce qui existe déjà couvre le même besoin, et plus honnêtement :**
- La joignabilité (`reachability()`, déjà en place) répond à une question *structurelle*, pas éditoriale — « cette règle peut-elle mathématiquement se déclencher ? » — sans jamais prétendre juger si un profil est plausible pour un vrai public.
- Le panneau Fréquentation, une fois le questionnaire publié, mesure de *vrais* usagers plutôt que des personas inventés. C'est la bonne source de vérité, et elle existe déjà — voir §9 pour l'enrichir d'une alerte de déséquilibre, qui répond au même besoin sans simuler personne.

Recommandation : ne rien construire ici. Si un signal de qualité manque avant publication, le bon chemin est de rendre plus visibles les outils déjà en place (diagnostic, joignabilité, puis les vraies statistiques après publication) plutôt que d'en ajouter un qui parle au nom d'un public que l'outil aurait imaginé.

---

## 9. Qualité des recommandations — la question centrale

Reformulée : **RecoHero recommande-t-il, ou traduit-il un score en liste ?** Après lecture du moteur et test de deux parcours réels, la réponse est nuancée :

**Ce qui va déjà dans le bon sens** :
- La résolution par « premier profil qui matche, dans l'ordre de l'éditeur » donne à l'auteur un contrôle total et lisible sur la hiérarchie de ses profils — pas de boîte noire.
- Le mécanisme de proximité (§2, §4F) évite mécaniquement le sentiment de verdict unique et sec.
- Le diagnostic « profil jamais atteint » (`reachability`) empêche déjà, en partie, qu'un profil existe sans jamais pouvoir sortir — un vrai garde-fou de qualité, déjà en place.

**Ce qui manque réellement** :
1. **Aucune diversité intra-profil imposée ni suggérée.** Rien n'empêche (ni ne signale) que les 3 recommandations d'un même profil soient trois variations du même sous-genre — c'est entièrement laissé à la discipline éditoriale de l'auteur, sans aide de l'outil.
2. **Aucune détection d'œuvre dupliquée entre profils.** Une même recommandation peut apparaître mot pour mot dans deux profils sans qu'aucun diagnostic ne le signale — ce serait pourtant un signal utile (« cette œuvre convient à plusieurs profils : est-ce voulu, ou un manque d'imagination sur l'un des deux ? »), directement dans l'esprit de la question posée par le brief.
3. **La justification (`note`) est statique**, jamais reliée aux réponses (déjà traité en §4E) — c'est la racine du sentiment possible de recommandation mécanique.
4. **Pas de mesure de la variance réelle des résultats** dans le panneau Fréquentation : les stats existantes disent « combien de fois ce profil est sorti », ce qui *pourrait* déjà signaler qu'un questionnaire est mal équilibré (90 % des réponses tombent sur un seul profil) — mais rien n'attire l'attention de l'auteur sur ce cas précis. C'est une extension quasi gratuite du panneau Fréquentation existant : un seuil visuel (« ce profil concentre X % des résultats — vérifiez l'équilibre de vos axes »).

Recommandation prioritaire, par ordre de rapport effort/valeur : (1) l'alerte de déséquilibre en Fréquentation (quasi gratuite, données déjà collectées), (2) la détection de titre dupliqué entre profils (un simple diagnostic supplémentaire dans `diagnose()`), (3) le lien réponse→recommandation de §4E. Les trois s'appuient sur de vraies données — le scoring réel, l'usage réel — plutôt que sur un jugement simulé ; voir §8 pour pourquoi ce choix est délibéré.

---

## 10. Identité du produit

Verdict après lecture de `foundation.css`, `card.js`, et test visuel : **le produit ne ressemble ni à un générateur de quiz générique ni à un outil informatique froid.** C'est déjà une réussite trop peu mise en valeur dans ce document jusqu'ici — il faut le dire clairement : la direction visuelle actuelle est la bonne base, pas un problème à résoudre.

Preuves concrètes :
- Palette « papier » chaude (`#FBF7F1`), encre presque noire plutôt que gris pur, une seule couleur d'accent par questionnaire dont tout le reste dérive par `color-mix()` — c'est une identité de collection éditoriale, pas de SaaS.
- Typographie à deux familles : une serif éditoriale (« Iowan Old Style », Palatino…) pour les titres et les résultats, une sans-serif pour le fonctionnel — exactement la convention d'un objet imprimé de qualité (magazine, catalogue de médiathèque), reprise jusque dans la carte de résultat générée en canvas.
- Le mouvement est écrit comme un principe éditorial et non décoratif (« on récolte », « on court », « on révèle », « on emporte » — quatre moments nommés dans `ARCHITECTURE.md`), pas une liste de transitions CSS.
- Le vocabulaire produit (« kiosque », « vitrine », « corbeille », « fréquentation », « diffuser ») emprunte déjà au monde de la bibliothèque et du commerce culturel plutôt qu'au vocabulaire SaaS (« dashboard », « workspace », « analytics »).

**Ce qui reste à consolider, pas à réinventer** :
- Le ton éditorial dépend entièrement de qui écrit le questionnaire, et c'est très bien ainsi : c'est un métier d'écriture, pas une case à uniformiser (voir §5).
- Le mot « matche » (§6) est la seule fausse note relevée dans un ensemble de copy autrement très tenu.
- Aucune illustration originale n'existe (l'identité repose entièrement sur la typographie, la couleur et les glyphes) — c'est cohérent avec la contrainte « pas de dépendance, pas de build », donc à ne pas changer : ajouter une bibliothèque d'illustrations casserait la promesse technique pour un gain esthétique marginal.

**Direction pour la suite** : ne pas chercher un « restylage plus moderne » (le brief l'exclut explicitement, à raison — la direction actuelle est déjà distinctive), et ne pas chercher non plus à uniformiser le ton par un guide prescriptif intégré à l'éditeur. La variance de qualité de rédaction d'un questionnaire à l'autre est le prix normal de laisser chaque bibliothécaire écrire avec sa propre voix — un guide de ton actif dans l'outil risquerait de se lire comme une correction permanente du travail d'un professionnel. Le seul levier à garder est passif et déjà disponible : l'exemple fourni reste visible et duplicable, pour qui veut s'en inspirer sans que l'outil le lui impose.

---

## 11. Viralité et partage

La carte de résultat (§2, §4) est déjà l'objet exact que demande le brief : un visuel pensé pour donner envie de dire « je suis [profil], et toi ? ». Elle fonctionne, elle est testée, elle ne dépend d'aucune bibliothèque.

Ce qui limite aujourd'hui son potentiel viral, sans jamais transformer le produit en réseau social (ce que le brief exclut à raison) :

- **Aucune invitation directe à comparer.** Le résultat propose « Refaire », pas « Envoyer ce test à quelqu'un pour comparer vos profils ». Un lien de partage existe déjà (`shareQuiz()`, natif ou copié) — il suffirait d'un texte d'accompagnement orienté comparaison plutôt que générique (« [Prénom] a obtenu Le partant. Et vous ? » au lieu d'un partage de lien nu) pour actionner ce ressort sans construire de fonctionnalité sociale nouvelle.
- **La carte échoue silencieusement sur une image de profil hébergée ailleurs** (canvas « sali », documenté dans `card.js`) — techniquement justifié et déjà maîtrisé (repli sur l'emoji), mais ça veut dire qu'un questionnaire dont l'auteur a mis une belle illustration de profil hébergée à l'extérieur produira une carte plus pauvre que prévu, sans que l'auteur le sache avant publication. Un avertissement au moment de l'ajout d'une image de profil non intégrée (« Cette image n'apparaîtra pas sur la carte de résultat, seul l'emoji le fera ») fermerait cet écart de confiance à cout quasi nul.
- **Pas d'affichage optimisé pour l'écran de bibliothèque** (voir §14D-E) — un kiosque physique est aussi un vecteur viral (quelqu'un scanne un QR code affiché parce qu'il a vu quelqu'un d'autre le faire), et ce chemin n'existe pas encore.

---

## 12. Architecture — ce qu'il ne faut pas casser

Confirmation explicite, après lecture complète du noyau : **aucune des recommandations de ce document ne requiert de renoncer à une seule des qualités listées dans le brief.** Le tableau suivant le vérifie point par point :

| Qualité à préserver | Compatible avec les recommandations ? |
|---|---|
| Application statique, sans build | Oui — assistant de création, vocabulaire qualitatif des poids, alertes de diversité, entrée d'espace dans le rail : tout est du JavaScript de plus dans les modules existants |
| Faible dépendance | Oui — aucune recommandation n'introduit de bibliothèque externe |
| Pas de compte usager obligatoire | Oui — rien ne touche au parcours répondant, qui reste anonyme |
| Déploiement simple, compatible GitHub Pages | Oui — aucune recommandation ne requiert de backend nouveau ; l'espace Firebase existant suffit à tout ce qui est proposé, y compris les évolutions du modèle Kiosque (§14) |
| Intégration iframe dans un site de bibliothèque | Oui — non affectée |

Le seul point du brief qui *pourrait* pousser vers plus de complexité serveur est la granularité de rôle (éditeur/relecteur/validation, §6 et §14G) — traité en §14 avec un principe explicite de minimalisme.

---

## 13. Priorisation

### Les 10 problèmes les plus importants

| # | Problème | Preuve | Impact usager | Impact bibliothécaire | Difficulté | Priorité |
|---|---|---|---|---|---|---|
| 1 | Aucun état intermédiaire entre « rien » et l'éditeur complet en échec (10 diagnostics rouges à l'ouverture) | Test direct : `makeQuiz()` défaut « Axe 1/2/3 », 4 erreurs immédiates | Aucun (indirect) | Fort — intimidation au premier contact | Modéré | **Haute** |
| 2 | Saisie des poids en nombres bruts (-9 à 9) sans échelle qualitative | `panels.js`, `scorechip` : `<input type="number">` | Aucun (indirect) | Fort — geste de tableur répété des dizaines de fois | Faible | **Haute** |
| 3 | Aucune explication liant une réponse précise à une recommandation précise | `renderReco()` dans `quiz.js` : note statique | Fort — sentiment de mécanique plutôt que d'écoute | Modéré | Modéré | **Haute** |
| 4 | Les réglages de l'espace (vitrine, corbeille, identité du kiosque, fréquentation) ne sont atteignables que par un clic sur le bouton de compte (`👤 {prénom}`) — aucune entrée nommée « Espace »/« Kiosque » dans le rail | Test direct : rail « Sections » = Identité/Axes/Questions/Résultats/Diffuser seulement ; `parametresCompte()` est l'unique point d'entrée | Aucun (indirect) | Fort — fonctionnalité entière peu découvrable | Faible | **Haute** |
| 5 | Pas de sous-structuration du kiosque d'un espace (une seule vitrine plate) | `presentation` = ordre/masques/épingle, pas de collections | Modéré — porte d'entrée peu éditorialisée | Fort pour un établissement à plusieurs questionnaires | Modéré | **Haute** |
| 6 | Brouillon non publié visible dans le kiosque public hors espace | Test direct sur `index.html` : carte « Nouveau questionnaire · Brouillon local » | Modéré — confusion, image peu professionnelle | Modéré | Faible | **Moyenne** |
| 7 | Aucun mode kiosque physique (pas de remise à zéro, pas d'écran de veille) | Absent de `quiz.js`/`gallery.js` | Fort en usage borne publique (confidentialité, disponibilité) | Fort pour un déploiement en salle | Modéré | **Haute** |
| 8 | Permission binaire membre/gérant, aucune validation avant publication | `firebase.rules.json` : deux niveaux seulement | Indirect | Fort pour une équipe/réseau élargi | Modéré (règles serveur à faire évoluer) | **Moyenne** |
| 9 | Invitation d'un collègue déjà inscrit exige un UID copié à la main | Rapporté du code : *« rien ici ne permet de le retrouver »* | Aucun | Fort — friction d'onboarding d'équipe | Modéré (nécessite une résolution email→UID côté serveur) | **Moyenne** |
| 10 | Copie contradictoire sur la permanence de la corbeille d'espace | Deux messages contradictoires relevés dans `panels.js` et `app.js` | Aucun | Modéré — érosion de confiance dans le filet de sécurité | Très faible (correction de texte) | **Haute** (rapport effort/valeur) |

### Les 10 améliorations les plus importantes (impact usager × valeur métier × effort)

| # | Amélioration | Pourquoi elle prime | Effort |
|---|---|---|---|
| 1 | Échelle qualitative pour les poids de réponse (« Un peu / Beaucoup / Complètement ») | Résout le problème n°2, quasi gratuite, aucune migration de données | Très faible |
| 2 | Corriger la copie contradictoire sur la corbeille d'espace | Résout le problème n°10, confiance dans le produit | Très faible |
| 3 | Entrée nommée « Mon espace » / « Kiosque de l'équipe » dans le rail, en plus du bouton de compte | Résout n°4, réutilise la feuille modale déjà écrite (`parametresCompte()`), aucune nouvelle donnée | Très faible |
| 4 | Assistant de création en 4 écrans (contenu → intention → nombre d'axes → panneau Questions) | Résout n°1, ne duplique aucun code, paramètre `makeQuiz()` existant sans jamais écrire à la place de l'auteur | Modéré |
| 5 | Lien explicite réponse → recommandation (« Parce que vous avez surtout coché… ») | Résout n°3, dérivé du scoring déjà calculé, aucune saisie supplémentaire pour l'auteur | Faible à modéré |
| 6 | Retirer les brouillons non publiés du kiosque public hors espace (ou les marquer bien plus distinctement / borne d'inaptitude au diagnostic) | Résout n°6, évite le pire scénario de déploiement improvisé | Faible |
| 7 | Mode kiosque physique (`?kiosque=1` : gros boutons, retour auto après inactivité, nettoyage de session, affiche + QR générés en un clic) | Résout n°7, ouvre l'usage borne publique que le brief place au centre | Modéré |
| 8 | Vitrine en sections éditoriales nommées (« En ce moment », collections) au lieu d'une grille plate | Résout n°5 sans nouvelle hiérarchie de permissions (voir §14) | Modéré |
| 9 | Alerte de déséquilibre des profils + détection de titre dupliqué entre profils, dans Fréquentation et le diagnostic | Prolonge des données déjà collectées, répond à la question centrale du brief en §9 | Faible |
| 10 | Statut « à valider » optionnel avant publication, pour les espaces qui l'activent | Résout n°8 pour les grandes équipes sans l'imposer aux petites | Modéré (règles serveur) |

---

## 14. Le modèle Kiosque et les Espaces

### Ce qu'un Espace représente réellement aujourd'hui

Après lecture complète de `remote.js`, `firebase.rules.json`, `schema.js` (identité/présentation) et du panneau Diffuser : **un Espace, dans le code actuel, est déjà exactement ce que le brief appelle un Espace** — une équipe (`membres`/`gerants`), un catalogue partagé, une identité publique, une vitrine, une corbeille, des statistiques. Ce n'est pas à construire, c'est à *étendre*.

Ce qu'un Espace n'a **pas** aujourd'hui, et que le brief appelle « Kiosque » : une notion de regroupement thématique *à l'intérieur* de l'espace. Concrètement, `espaces/<nom>/quizzes` est une collection plate ; `presentation` (ordre/masques/épingle) organise cette collection plate, mais ne la découpe pas en sous-ensembles nommés. **Aujourd'hui, un Espace = un Kiosque**, au sens où sa vitrine publique (`index.html?espace=…`) est déjà, littéralement, ce que le brief décrit comme un kiosque : un nom, une identité visuelle, une description, plusieurs questionnaires, une page d'accueil, une URL publique, une intégration iframe possible, des statistiques agrégées. La liste du brief (§14B) est cochée quasi entièrement — seule « une sélection de prescriptions » (une vitrine d'œuvres indépendante des questionnaires) manque vraiment.

### Réponse directe aux douze questions stratégiques du brief

**1. Qu'est-ce qu'un Espace ?** Une équipe et son catalogue partagé — c'est déjà le cas dans le code, et c'est la bonne définition à garder : l'unité de collaboration et de permission, pas l'unité d'affichage public.

**2. Qu'est-ce qu'un Kiosque ?** Aujourd'hui, c'est un synonyme de la vitrine publique d'un Espace — pas une entité séparée. La recommandation de cet audit (détaillée ci-dessous) est de le garder ainsi *comme concept d'affichage*, mais de l'enrichir de sections éditoriales, plutôt que d'en faire un troisième niveau hiérarchique.

**3. Différence entre un Kiosque et une simple page qui regroupe des questionnaires ?** Aujourd'hui, il n'y en a structurellement aucune — c'est exactement une page qui regroupe des questionnaires, avec une identité visuelle en plus. Le brief a raison de vouloir plus (une page qui *raconte* une sélection plutôt qu'une page qui *liste* un catalogue) — voir la proposition de sections éditoriales, §14 plus bas.

**4. Pourquoi un bibliothécaire aurait-il besoin d'un Kiosque ?** Parce qu'une médiathèque a plusieurs portes d'entrée culturelles (romans, BD, films, coups de cœur du mois) et qu'aujourd'hui, toutes ces portes atterrissent sur la même grille indifférenciée. Le besoin réel n'est pas un nouveau niveau de permission — c'est un besoin *éditorial* d'organiser l'affichage.

**5. Comment un Kiosque fonctionne-t-il en bibliothèque physique ?** N'existe pas aujourd'hui (voir n°7 du classement des problèmes) — recommandation détaillée ci-dessous (mode kiosque, affiche/QR générés).

**6. Comment une équipe travaille-t-elle ensemble ?** Déjà construit : membres invités par email ou UID, publication libre à tout membre, garde-fou anti-écrasement vérifié à l'exécution, corbeille partagée, historique minimal de qui a publié quoi et quand (`updatedBy`/`rev`). Ce qui manque : une granularité de rôle et un flux de validation (voir n°7).

**7. Quel est le minimum de gestion des droits nécessaire ?** Le modèle binaire actuel (membre/gérant) suffit à une équipe de bibliothèque unique. Il ne suffit plus dès qu'un réseau de médiathèques partage un espace : là, un statut optionnel « brouillon soumis / validé » — pas un rôle supplémentaire, juste un champ d'état sur le questionnaire — couvre le besoin sans réintroduire de complexité de permission. Recommandation : ne pas créer de troisième rôle utilisateur ; créer un statut de document (`enAttente` / `publié`), activable par espace.

**8. Comment gérer brouillon/publication ?** Déjà bien fait : brouillon local (ce navigateur) → publication explicite dans l'espace → visible sur le kiosque. Le seul trou est le n°6 du classement (brouillons visibles hors espace).

**9. Comment éviter de rendre RecoHero trop complexe ?** En refusant d'empiler une troisième entité hiérarchique (Espace → Kiosque → Expérience) quand une extension du modèle `presentation` existant (sections nommées au lieu d'une liste plate) couvre le même besoin produit avec une fraction du coût — voir la recommandation d'architecture ci-dessous.

**10. Quelle architecture pour étendre à plusieurs bibliothèques/réseaux ?** Un espace = une équipe = un catalogue = un compte de facturation/hébergement Firebase implicite. Pour un réseau de 8 médiathèques, deux options : (a) un espace unique partagé par les 8 équipes, avec des sections de vitrine par site — le plus simple, le plus proche de l'existant ; (b) 8 espaces distincts avec un mécanisme léger de duplication/partage de questionnaires entre eux (déjà possible aujourd'hui *manuellement* par export/import JSON — voir §14 ci-dessous pour une version assistée). Recommandation : ne construire (b) qu'au moment où un vrai réseau le demande — ce n'est pas un besoin observable dans le code actuel, seulement une anticipation du brief.

**11. Comment préserver « pas de compte pour l'usager » ?** Intégralement préservé par toutes les recommandations de ce document — aucune ne touche au parcours répondant, qui reste, et doit rester, anonyme et sans friction.

**12. Quelles données conserver ou non sur une borne publique ?** Aujourd'hui, rien n'est traité spécifiquement (`localStorage` du poste s'accumule comme sur n'importe quel navigateur personnel — historique de résultats, session en cours). C'est le cœur de la recommandation de mode kiosque ci-dessous.

### Recommandation d'architecture cible

**Ne pas introduire de troisième niveau hiérarchique rigide (Espace → Kiosque → Expérience) avec ses propres permissions et sa propre entité Firebase.** Trois raisons concrètes, tirées de la lecture du code :

1. Le modèle `presentation` (ordre/masques/épingle) existe déjà et couvre 80 % du besoin éditorial exprimé au §14C-I du brief — l'étendre coûte une fraction de ce que coûterait une nouvelle entité avec ses propres règles Firebase, sa propre UI de gestion, ses propres URLs.
2. Une nouvelle entité « Kiosque » distincte de l'Espace poserait immédiatement la question de permission (qui peut créer un kiosque ? qui peut y ranger un questionnaire d'un autre auteur ?) — une question que le modèle actuel n'a pas, précisément parce que l'espace et sa vitrine ne font qu'un.
3. Le besoin du réseau à 8 médiathèques (§14H du brief) n'est pas démontré par l'usage actuel du produit — anticiper une architecture pour un cas non observé est le contraire du principe directeur du brief lui-même (« ne pas complexifier inutilement »).

**Architecture cible proposée :**

```
COMPTE (identifiant Firebase, une personne)
   │
   └── ESPACE  (= l'équipe + son catalogue + son identité publique = le Kiosque)
         │
         ├── Équipe (membres, gérants)
         │
         ├── Vitrine publique du Kiosque
         │     ├── Sections éditoriales nommées (NOUVEAU — « En ce moment »,
         │     │     « 3 romans pour voyager », etc. — extension légère de
         │     │     `presentation`, un questionnaire peut appartenir à 0, 1
         │     │     ou plusieurs sections)
         │     ├── Questionnaires (à la une / rangés / masqués — existant)
         │     └── Mode kiosque physique (NOUVEAU — `?kiosque=1` par
         │           questionnaire ou par vitrine entière)
         │
         ├── Corbeille (existant)
         ├── Fréquentation (existant, à enrichir §9)
         └── Statut de document optionnel (NOUVEAU — brouillon soumis /
               publié, activable par espace, pour les équipes élargies)
```

Le mot « Kiosque » désigne donc, dans cette cible, **la vitrine publique de l'Espace elle-même** — enrichie, pas une nouvelle case dans l'organigramme. C'est fidèle à la fois au code existant et au principe directeur du brief.

Un point d'exécution compte autant que le modèle de données : cette vitrine et ces réglages doivent être **atteignables par une entrée nommée dans la navigation du backoffice**, pas seulement par un clic sur le bouton de compte — voir §6 pour le constat testé en direct (le meilleur modèle du monde ne sert à rien si son point d'entrée ressemble à un réglage personnel plutôt qu'à la vitrine de l'équipe).

**Pour le cas du réseau à 8 médiathèques**, si et quand il se présente vraiment : un mécanisme de duplication assistée entre espaces (un bouton « Dupliquer vers un autre espace » dans le panneau Diffuser, qui automatise l'export/import JSON déjà existant plutôt que de le laisser manuel) couvre le besoin de mutualisation sans fusionner les catalogues ni les permissions. Coût de complexité : quasi nul, car il ne fait qu'assembler deux fonctions déjà écrites (`exportOne`, `importPaste`).

### Le mode Kiosque physique — proposition détaillée

Répond directement à §14D-E du brief. Techniquement, c'est un troisième mode d'URL au même niveau que `?embed=1` et `?test=1`, déjà un patron établi dans `quiz.js` :

- `?kiosque=1` sur `quiz.html` ou `index.html` :
  - Gros boutons, cibles tactiles élargies (le token `--tap` existe déjà dans `foundation.css`, il suffit de l'augmenter dans ce mode).
  - **Retour automatique à l'accueil après un délai d'inactivité** (ex. 90 secondes sans interaction sur l'écran de résultat) — un simple minuteur remis à zéro à chaque interaction, comme le fait déjà `attenteAvance` pour l'avancée automatique.
  - **Nettoyage de session à la sortie** : ne pas écrire dans l'historique de résultats (`store.addResult`) en mode kiosque, exactement comme le mode `isTest` le fait déjà pour ne pas fausser les statistiques.
  - **QR code pour poursuivre sur son téléphone** plutôt que de forcer le partage depuis la tablette elle-même — génération d'un QR pointant vers l'URL normale du questionnaire (pas le mode kiosque), affichable en fin de parcours.
- **Générateur d'affiche** dans le panneau Diffuser : un bouton qui compose, sur le même principe que `card.js` (canvas, sans dépendance), une affiche imprimable — titre accrocheur, QR code, durée estimée — au format demandé par le brief (« QUEL LIVRE VOUS RESSEMBLE ? [QR] 3 minutes »). Réutilise directement l'infrastructure de rendu canvas déjà écrite pour la carte de résultat.

Effort : modéré (nouveau mode d'URL + minuteur d'inactivité + un second export canvas de type affiche). Aucune donnée serveur nouvelle. Valeur : haute — c'est le chaînon manquant entre le produit numérique et l'usage physique en bibliothèque que tout le brief présuppose.

---

## Vision produit — RecoHero 2.0 (une page)

RecoHero n'est pas un générateur de quiz. C'est un **outil de médiation culturelle** qui donne à une équipe de bibliothèque les moyens de construire, en quelques heures et sans compétence technique, une expérience de découverte que ses usagers ont envie de vivre — et de recommencer.

Ce que RecoHero 2.0 change, sans rien renier de RecoHero aujourd'hui :

**Pour l'usager**, l'expérience reste un jeu de découverte, jamais un formulaire : elle promet un temps court, elle explique honnêtement pourquoi elle recommande ce qu'elle recommande, et elle sait dire « vous n'étiez pas loin d'autre chose » plutôt que de trancher sec. Le résultat se partage parce qu'il donne envie de se reconnaître dedans, pas parce qu'un bouton le propose.

**Pour le bibliothécaire qui découvre l'outil**, la première rencontre n'est plus une liste rouge de dix problèmes mais quatre questions simples qui aboutissent déjà à un questionnaire qui *ressemble à quelque chose*. Régler le poids d'une réponse, c'est dire « un peu » ou « beaucoup », pas taper un chiffre entre -9 et 9. L'outil configure la structure et se tait sur le contenu : jamais de gabarit de phrase, jamais de guide de ton, jamais de jugement simulé sur ce à quoi devrait ressembler « un bon lecteur curieux » — cette voix-là reste la sienne, du premier mot à la dernière recommandation.

**Pour l'équipe**, l'espace partagé qui existe déjà devient la vitrine éditoriale d'un établissement — pas une liste plate de questionnaires, mais une sélection qui se construit et se raconte, aussi facilement qu'on range une table de nouveautés, et qu'on retrouve depuis une entrée qui porte son nom plutôt que derrière l'avatar de son propre compte. Une équipe plus grande peut choisir un mode « à valider avant publication » sans que ça devienne obligatoire pour la petite équipe qui n'en a pas besoin.

**Pour la bibliothèque, physiquement**, RecoHero devient déployable : une affiche avec un QR code se génère en un clic, une tablette en libre accès revient toute seule à l'accueil et ne garde la trace de personne, et le lien qu'on scanne dans les rayons continue le parcours sur son propre téléphone.

Rien de tout cela ne casse ce qui fait la force actuelle du produit : statique, léger, sans compte usager, déployable sur GitHub Pages ou une clé USB. La médiation culturelle mérite un outil sérieux qui ne se prend pas au sérieux — c'est déjà la promesse de RecoHero. Cette version la tient jusqu'au bout du parcours, de la première ouverture du backoffice jusqu'à l'affiche collée à côté des rayonnages.

---

## Roadmap en 3 phases

### Phase 1 — Rendre l'expérience usager excellente

- Corriger la copie contradictoire sur la corbeille d'espace (§13, n°10).
- Lien explicite réponse → recommandation, sous chaque reco (§4E, §13 n°5).
- « Indices » du profil : quelles réponses ont le plus pesé (§4C).
- Alerte de déséquilibre des profils + détection de titre dupliqué entre profils, dans le diagnostic (§9).
- Retirer ou distinguer bien plus fortement les brouillons non publiés du kiosque public hors espace (§13, n°6).
- Mode kiosque physique : `?kiosque=1`, retour automatique, nettoyage de session, QR de poursuite (§14).
- Générateur d'affiche imprimable (§14).
- Texte de durée estimée sur l'écran de couverture (§2).

### Phase 2 — Rendre la création excellente pour les bibliothécaires

- Échelle qualitative des poids de réponse, avec bascule vers les valeurs numériques (§6, §13 n°1).
- Entrée nommée « Mon espace » dans le rail du backoffice, plutôt que le seul bouton de compte (§6, §13 n°3-4).
- Assistant de création en 4 écrans, limité à la structure (type de contenu, intention, nombre d'axes) — jamais au contenu des questions, qui reste la plume du bibliothécaire (§7, §13 n°4 amélioration).
- Réduction de la friction d'invitation (email → résolution automatique plutôt que copier-coller d'UID) (§13, n°9).

### Phase 3 — Rendre RecoHero extensible à différents types de prescriptions et à plusieurs bibliothèques

- Vitrine en sections éditoriales nommées, extension du modèle `presentation` existant (§14).
- Statut optionnel « à valider avant publication », activable par espace (§14, réponse à la question 7).
- Mécanisme de duplication assistée entre espaces, pour les réseaux de plusieurs bibliothèques (§14).
- Champ « ajouté en confiance, hors calcul » sur une recommandation (§4F).
- Extension du champ `location` et des types de recommandation à mesure que d'autres contenus culturels (jeux, expositions, podcasts — déjà listés dans `RECO_TYPES`) se généralisent dans l'usage réel.

---

*Fin de l'audit. Aucun fichier de code n'a été modifié pour le produire.*
