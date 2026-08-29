# Architecture de RecoHero

Ce document dit **où vivent les choses** et **pourquoi elles vivent là**.
Il se lit avant de modifier quoi que ce soit.

---

## Le principe directeur

Le produit tient parce qu'il n'a pas de serveur. Chaque fois qu'une
fonctionnalité semble en réclamer un, la bonne question n'est pas « quel
hébergeur ? » mais « qu'est-ce que le navigateur sait déjà faire ? ».

Le partage de questionnaire en est l'exemple : plutôt qu'une base de données,
l'URL transporte le questionnaire. Ça coûte 3 500 caractères d'adresse et ça
économise un backend, des comptes, des quotas et une facture.

---

## Les couches

Les dépendances descendent, jamais l'inverse. Un module ne connaît que ceux
placés sous lui.

```
   pages          index.html      quiz.html      admin.html
                      │               │               │
   contrôleurs   gallery.js       quiz.js      admin/app.js
                      │               │               │
                      │               │          admin/panels.js
                      └───────────────┴───────────────┘
                                      │
   noyau                         js/core/
              catalog · schema · scoring · share · store · ui · card
```

| Module | Responsabilité | Ne fait jamais |
|---|---|---|
| `core/store.js` | **Seul** accès au `localStorage`. Possède le format des clés. | connaître le DOM |
| `core/schema.js` | La forme d'un questionnaire : fabriques, normalisation, diagnostic. | calculer un score |
| `core/scoring.js` | Le comptage, la résolution du profil, la joignabilité. Fonctions **pures**. | lire le DOM, écrire du stockage |
| `core/share.js` | Encodage / décodage d'un questionnaire dans une URL. | valider le contenu |
| `core/catalog.js` | D'où viennent les questionnaires : lien, dépôt, brouillons. | modifier un questionnaire |
| `core/card.js` | Dessiner la carte de résultat sur un canvas. | lire le DOM de la page |
| `core/ui.js` | Les gestes d'interface : nœud, notification, copie, thème, réduction d'image. | connaître le métier |

---

## Les trois interdits

Non négociables. Une modification qui les viole crée une dette qu'on paiera
plus cher que le temps gagné.

**1. Aucun accès à `localStorage` hors de `core/store.js`.**
Le format `recohero.v1.<clé>` appartient à ce fichier seul. La dérive de
schéma silencieuse est le mode de panne le plus coûteux d'une application
sans serveur : il n'y a pas de migration côté base pour rattraper l'erreur.

**2. Aucun gestionnaire d'évènement en ligne.**
Pas de `onclick=` dans le HTML ni dans une chaîne de template. Tout passe par
la délégation sur un attribut `data-act` (une action) ou `data-bind` (une
liaison de champ), posée une seule fois par zone. Le rendu peut alors
remplacer tout un panneau sans fuite de gestionnaire.

**3. Aucune image n'entre sans passer par `safeImage()`.**
Un champ image accepte trois formes et trois seulement : `http(s)://…`, un
chemin relatif du dépôt, ou un `data:image/…;base64,…`. Tout le reste — au
premier chef `javascript:` et `data:text/html` — est effacé. Le filtre vit
dans `schema.js` et s'applique à la lecture (`normalize`) **comme** à
l'écriture depuis un fichier : on ne fait pas davantage confiance à ce que
produit notre propre canvas qu'à un JSON reçu par lien.

**4. Aucune couleur en dur hors de `css/foundation.css`.**
Un composant consomme des tokens. Un questionnaire ne redéfinit **qu'une**
variable, `--accent` ; tout le reste — teinte douce, filet, version profonde,
couleur du texte posé dessus — en découle par `color-mix()`. C'est ce qui
permet à un questionnaire de changer d'identité en une ligne.

---

## Le flux de données

### Lire un questionnaire

```
quizzes/index.json ─┐
quizzes/*.json      ├─► catalog.loadAll() ─► schema.normalize() ─► en mémoire
store.allDrafts()   │
#k=… (URL)         ─┘
```

`normalize()` est le poste-frontière. **Tout** questionnaire venant de
l'extérieur y passe : un fichier du dépôt, un import, un lien reçu. On répare
ce qui est réparable, on jette ce qui ne l'est pas, on ne fait jamais
confiance à la forme reçue. Un `score` non numérique devient `0`, un lien qui
n'est pas en `http(s)` disparaît, un mode de règle inconnu devient `fallback`.

### Répondre

```
answers { qId → optionId | optionId[] }
   └─► scoring.tally()  ─► { counts par axe, total, leaders }
          └─► scoring.resolve() ─► le profil, et ses recos
```

`tally` et `resolve` sont pures. C'est ce qui permet à `reachability()`
d'explorer *toutes* les combinaisons de réponses possibles pour dire, dans le
backoffice, qu'un profil ne se déclenchera jamais — sans rien jouer.

### Éditer

Le backoffice tient **un seul** questionnaire en mémoire (`state.quiz`), et
deux chemins de mise à jour délibérément distincts :

- **Saisie de texte** (`input`) → on écrit dans le modèle, on planifie la
  sauvegarde, on retouche à la main les quelques éléments dépendants (le
  titre dans la barre, l'étiquette de la carte). **Pas de redessin** : c'est
  ce qui garde le curseur là où il est.
- **Changement de forme** (`change` sur un mode de règle, un type de
  question, une couleur d'axe ; tout `data-act`) → on écrit, on sauvegarde,
  on **redessine** le panneau entier.

La liste `RESHAPE` en tête de `admin/app.js` énumère les liaisons du second
type. Y ajouter une entrée est le bon réflexe quand un champ doit en faire
apparaître un autre.

La sauvegarde est différée de 500 ms et forcée (`flush()`) avant toute action
qui lit le questionnaire ailleurs : export, lien, test, changement de
questionnaire, fermeture de l'onglet.

---

## Le CSS

Quatre fichiers dans un ordre qui ne change pas.

| Fichier | Contient | Sélecteurs autorisés |
|---|---|---|
| `foundation.css` | les tokens : couleur, typo, espace, mouvement, z-index | `:root` uniquement |
| `base.css` | la remise à zéro, les éléments nus, les primitives de page | éléments, `.page`, `.stack` |
| `components.css` | ce qui sert à **au moins deux** pages | classes de composant |
| `gallery` / `quiz` / `admin.css` | ce qui ne sert qu'à cette page | classes de page |

Un composant qui n'apparaît que sur une page n'a rien à faire dans
`components.css`. Un composant copié une deuxième fois dans un CSS de page
doit remonter dans `components.css`.

`prefers-reduced-motion` et `prefers-color-scheme` sont traités **une seule
fois**, dans `foundation.css`, au niveau des variables. Aucun composant ne
redéclare ces media queries.

### La checklist avant de pousser du CSS

- [ ] Mesuré à **320 px** et **375 px** de large. `documentElement.scrollWidth` ne dépasse
      pas `clientWidth`. Les items de grille et de flex qui contiennent du
      texte ou un `<input>` portent `min-width: 0` — sans quoi c'est
      l'**ancêtre** qui déborde, pas l'élément fautif, et on cherche au
      mauvais endroit. Ce piège a été payé trois fois sur ce projet : les
      lignes d'historique, les colonnes du backoffice, et les étapes du
      panneau « Diffuser ». Il ne se voit qu'avec du contenu long — un
      questionnaire de test au titre bref ne le déclenche jamais.
- [ ] Aucun libellé de bouton ne porte de chaîne insécable longue (un nom de
      fichier, une URL). `white-space: nowrap` la rend plus large que
      l'écran, et aucun `min-width` ne rattrape ça.
- [ ] Tout contrôle actionnable fait au moins `--tap` (44 px). Une dérogation
      à `--tap-sm` se justifie en commentaire.
- [ ] Aucune valeur d'espacement hors de l'échelle base 4.
- [ ] Aucun texte sous 12 px.
- [ ] Vérifié en thème sombre.
- [ ] Une animation qui déplace un élément large est **clippée** par son
      conteneur, sinon elle rend la page scrollable horizontalement pendant
      la transition.
- [ ] Aucun état visuel ne dépend d'un `requestAnimationFrame` : il ne
      s'exécute pas dans un onglet en arrière-plan. La valeur au repos doit
      être juste sans JS ; l'animation est un supplément.

---

## La carte de résultat

`core/card.js` compose une affiche 1080 × 1350 sur un canvas. Aucune
bibliothèque : rasteriser le DOM coûterait une dépendance de plusieurs
centaines de kilo-octets pour un résultat qu'on ne contrôlerait pas.

Deux contraintes structurent le fichier.

**Le plancher.** La signature est ancrée en bas. Une constante `FLOOR` marque
la limite au-dessus de laquelle tout doit tenir, et chaque bloc facultatif
(sous-titre, feuille de score, recommandations) vérifie qu'il a la place
*avant* de se dessiner. Un profil au titre de trois lignes perd des
recommandations ; il ne mord jamais sur la signature. Vérifié par
échantillonnage de pixels, pas par estimation.

**Le canvas teinté.** Dessiner une image d'un autre domaine rend le canvas
« teinté » et fait échouer `toBlob()` — la carte deviendrait impossible à
exporter. `isSafeToDraw()` n'accepte donc qu'un `data:` URI ou une image du
même hébergeur, et la carte retombe sur l'emoji sinon. Cet échec-là est
silencieux **par choix** : l'auteur n'y peut rien au moment où le répondant
appuie sur le bouton.

---

## Ce qui n'existe pas, et pourquoi

**Voir les réponses des autres.** Impossible sans serveur, et c'est le choix
fondateur. Si le besoin apparaît, la marche à suivre la plus économe serait
une base externe (Firebase Realtime Database, comme le projet Bingo) branchée
sur un unique nouveau module `core/remote.js` : `catalog.js` gagnerait une
quatrième source, `quiz.js` un envoi en fin de parcours, et rien d'autre ne
bougerait. Les couches sont dessinées pour que ce soit vrai.

**Un moteur de Markdown.** Les champs de texte libre acceptent les
paragraphes (une ligne vide en sépare deux) et rien d'autre. Une dépendance
de plus pour un gain que personne n'a demandé.

**Un système de comptes.** Demandé explicitement comme hors périmètre.

**Une étape de build.** Le jour où il en faut une, la promesse « ça tourne
depuis une clé USB » est morte.
