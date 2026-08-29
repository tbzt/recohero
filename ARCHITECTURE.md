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
     catalog · schema · scoring · share · store · ui · card · views · sortable
```

| Module | Responsabilité | Ne fait jamais |
|---|---|---|
| `core/store.js` | **Seul** accès au `localStorage`. Possède le format des clés. | connaître le DOM |
| `core/schema.js` | La forme d'un questionnaire : fabriques, normalisation, diagnostic. | calculer un score |
| `core/scoring.js` | Le comptage, la résolution du profil, la joignabilité. Fonctions **pures**. | lire le DOM, écrire du stockage |
| `core/share.js` | Encodage / décodage d'un questionnaire dans une URL. | valider le contenu |
| `core/catalog.js` | D'où viennent les questionnaires : lien, dépôt, brouillons. | modifier un questionnaire |
| `core/views.js` | La vue d'une question, **partagée** par le parcours et l'aperçu du backoffice. | connaître l'état de l'un ou de l'autre |
| `core/sortable.js` | Réordonner une liste au pointeur. | connaître ce qu'elle contient |
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
espaces/…/quizzes   ─┐   (base partagée, si ?espace=…)
quizzes/*.json       ├─► catalog.loadAll() ─► schema.normalize() ─► en mémoire
store.allDrafts()    │
#k=… (URL)          ─┘
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
- [ ] Un élément piloté par l'attribut `hidden` est contrôlé en **`display`
      calculé**, jamais sur la propriété `.hidden`. `hidden` ne tient que par
      la feuille de l'agent utilisateur : la moindre règle d'auteur posant un
      `display` sur le même élément l'annule, sans erreur ni avertissement.
      `base.css` neutralise le piège une fois pour toutes
      (`[hidden] { display: none !important }`), mais un test qui lit
      `node.hidden` continuera de dire « masqué » sur un élément parfaitement
      visible. Ce défaut est passé en production sur ce projet : le
      backoffice s'ouvrait bien, l'écran de garde restait par-dessus.
- [ ] Une animation qui déplace un élément large est **clippée** par son
      conteneur, sinon elle rend la page scrollable horizontalement pendant
      la transition.
- [ ] Aucun état visuel ne dépend d'un `requestAnimationFrame` : il ne
      s'exécute pas dans un onglet en arrière-plan. La valeur au repos doit
      être juste sans JS ; l'animation est un supplément.
- [ ] Un test automatisé qui mesure une **durée** ment dans un onglet non
      affiché : `setTimeout` y est bridé à ~1 s. Un seuil temporel de 110 ms
      y devient 1000 ms, et le geste testé est rejeté à raison. Faire suivre
      les évènements sans attente plutôt que d'incriminer le code.

---

## Le garde-fou contre l'écrasement

Deux personnes ouvrent le même questionnaire d'un espace. La seconde à publier
effaçait le travail de la première, sans que personne le sache.

**La protection est dans les règles de la base, pas dans le navigateur.**
Comparer les versions côté client n'aurait rien garanti : deux écritures
peuvent se croiser entre la lecture et l'envoi, un onglet resté ouvert ignore
ce qui s'est passé ailleurs, et un défaut de notre code annulerait la
protection en silence. La base, elle, arbitre au moment d'écrire.

Chaque questionnaire porte un compteur `rev`. Publier envoie `rev + 1`, et la
règle exige exactement le suivant :

    newData.child('rev').val() === data.child('rev').val() + 1

Deux personnes parties de `5` : la première écrit `6`, la seconde est refusée.
`updatedBy` porte l'UID de qui a écrit, et la règle vérifie qu'il correspond au
compte connecté — personne ne signe à la place d'un autre. Un questionnaire
antérieur à la règle, sans `rev`, n'est pas bloqué : la première écriture
adopte le compteur.

**Le refus ne se lit pas dans le message.** La base renvoie le même 401 pour
« tu n'es pas membre » et pour « ta révision n'est pas la suivante ». On ne
devine donc pas : on relit le questionnaire distant, et c'est sa révision qui
tranche. Un refus de droits n'est jamais pris pour un conflit.

**Le rang de gérant.** Les membres d'un espace s'invitent et se retirent entre
eux, sans quoi chaque arrivée passerait par le propriétaire. Mais un seul
membre suffirait alors à verrouiller tout le monde dehors. Un compte inscrit
dans `espaces/<nom>/gerants` ne peut être retiré par personne, et cette branche
n'est modifiable que depuis la console : il reste donc toujours quelqu'un pour
rouvrir.

**Et la règle vérifie qu'elle est là.** Une règle qu'on croit posée et qui ne
l'est pas ne se voit nulle part : l'espace a la même apparence, protégé ou non.
Le backoffice tente donc, à la connexion, une écriture qui *doit* être refusée
— réécrire `rev` à sa valeur actuelle, ce qui n'abîme rien si elle passe — et
affiche un bandeau rouge le cas échéant. C'est le même mouvement que partout
ailleurs dans ce projet : rendre la règle mécanique plutôt que mémorielle.

*La marche à suivre en console — poser les règles, inviter, éprouver — vit hors
du dépôt : elle nomme des espaces, des comptes et des écrans qui n'ont pas leur
place dans un dépôt public.*

---

## Cinq pièges payés comptant

**Les listes s'imbriquent.** Les réponses vivent dans les questions, les
recommandations dans les profils. Un `pointerdown` sur une poignée intérieure
remonte donc jusqu'au conteneur extérieur, qui réclamait le geste à son tour
et écrasait celui en cours. `sortable.js` ne prend le geste que si la liste
est le plus proche ancêtre triable de la poignée.

**Les écouteurs de `window` ne se posent qu'une fois.** Le panneau se
redessine à chaque geste de structure ; poser `pointermove` par appel de
`sortable()` en aurait ajouté un par liste et par rendu, sans jamais rien
retirer. L'état du glissement vit au niveau du module, pas de l'appel.

**L'aperçu ne réimplémente rien.** Une imitation dérive au premier changement,
et finit par montrer autre chose que ce que voit le répondant. `views.js` est
appelé par les deux, avec `interactive: false` d'un côté.

**L'évènement `close` d'un `<dialog>` ne porte pas le comportement.** Il n'a
pas été observé dans tous les environnements où ce code tourne, et une action
qui ne se produit jamais ne laisse aucune trace pour le dire : un import par
collage n'importait rien, en silence. `dismiss(dialog, then)` ferme, retire et
exécute explicitement ; l'écouteur `close` ne garde que le ramassage des
fermetures qu'on ne provoque pas soi-même — Échap, clic sur le fond.

**Un import qui ne sait que dupliquer rend la sauvegarde inutile.** `adopt()`
réattribuait un identifiant neuf dès qu'il en rencontrait un déjà présent.
Tant que l'import ne servait qu'à recevoir le modèle d'un tiers, c'était le
bon réflexe. Du jour où l'export d'un catalogue est devenu la seule sauvegarde
d'un espace — la base gratuite n'ayant aucune restauration — ce réflexe rendait
la restauration impossible : douze doublons au lieu de douze originaux. La
question est désormais posée, une fois pour tout un fichier.

Corollaire trouvé au test : le questionnaire ouvert dans l'éditeur était le
seul à ne jamais se restaurer. La sauvegarde différée le réécrivait par-dessus
sa propre restauration, et le compte des remplacements mentait — trois
remplacés, deux restaurés. `adopt()` écrit donc l'état courant, puis lâche
`state.quiz`, avant d'importer quoi que ce soit.

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

## Le mode embarqué

`quiz.html?embed=1` fait vivre le parcours dans l'iframe d'un autre site.
Le mode tient dans `quiz.js` et six lignes de `quiz.css` ; aucun autre module
n'en sait rien.

**La hauteur ne peut pas reposer sur un observateur.** `ResizeObserver` livre
ses rappels à l'étape de peinture : un cadre hors écran, ou un onglet qui ne
compose pas, ne les reçoit jamais — et le questionnaire reste figé à la
hauteur de son écran de chargement. C'est le même piège que le
`requestAnimationFrame` proscrit plus haut, et il a été payé ici aussi : la
première version n'observait que `documentElement` et annonçait 179 px pour
un parcours de 670. La hauteur est donc **annoncée à chaque rendu**, sur le
champ — `getBoundingClientRect()` force le calcul de mise en page, la valeur
est juste tout de suite. Les images, qui arrivent après, le redisent une fois
chacune. L'observateur ne rattrape plus que le reste : l'hôte qui change de
largeur, une police qui se substitue.

**Le protocole est volontairement anonyme.** Deux messages, `recohero:height`
et `recohero:scroll`, sans charge utile sensible, postés à `*` : nous ne
connaissons pas l'origine de l'hôte, et il n'y a rien là-dedans qu'on ne
puisse crier. C'est l'hôte qui rattache un message à un cadre, en comparant
`contentWindow` à `event.source`.

**Ce qui est retiré, et pourquoi seulement cela.** Les sorties vers le kiosque,
et rien d'autre. Un lien qui ramène chez nous depuis le site d'un autre est
une trahison de l'hôte ; la progression et le compteur, eux, sont le parcours
même et restent. Le stockage tiers, bloqué par Safari et cloisonné par Chrome,
n'appelle aucun code : `store.js` encaisse déjà le refus, la reprise de
parcours et l'historique cessent d'exister sans un mot.

---

## Ce que le dépôt sert encore

Un seul fichier de questionnaire, `quizzes/quel-roman-pour-cet-ete.json`, et
son index. C'est **l'exemple**, et rien d'autre : il donne à voir ce que le
format permet, et il fait que le kiosque n'est pas vide au premier abord.

Le dépôt a longtemps été un canal de publication — on déposait un `.json`, une
action d'indexation reconstruisait la liste, le questionnaire paraissait au
kiosque. Les espaces partagés ont rendu ce chemin caduc : il demandait un
accès git que les gens à qui ce projet s'adresse n'ont pas. Publier ne passe
plus par le dépôt, et rien ne régénère plus `quizzes/index.json` — il est
écrit à la main, une fois, parce qu'il ne contient qu'une ligne.

`loadPublished()` reste dans `catalog.js` pour lire cet exemple. Ce n'est plus
une voie de publication ; c'est la vitrine.

## L'espace partagé

`core/remote.js` est le seul module qui parle à un serveur, et le seul qui
puisse être absent sans que rien ne casse : sans `?espace=…` dans l'adresse,
aucune requête ne part, et le projet est exactement ce qu'il était. C'est la
cinquième source de `catalog.js`, pas une refonte.

**Realtime Database, pas Firestore.** La première a une API REST qui se
consomme au simple `fetch` ; la seconde suppose un SDK. Le choix découle
directement de l'interdit sur les dépendances et l'étape de build.

**La configuration est publique, et ce n'est pas une négligence.** URL de base
et clé d'API sont en clair dans le module. Dans une application web, ces
valeurs sont un identifiant, pas un secret : le navigateur du visiteur les
émet à chaque requête, et son onglet Réseau les affiche. Un site statique
public n'a aucune cachette — ni gist, ni secret d'action GitHub, puisque tout
ce qui doit être lu à l'exécution finit dans les fichiers déployés. Toute
tentative de « cacher » la configuration serait un théâtre, et un théâtre
coûteux : il laisserait croire à une protection.

**La protection est ailleurs, et elle est vérifiable.** Les règles
(`firebase.rules.json`) accordent la lecture à tous — c'est ce qui permet de
répondre sans compte — et l'écriture aux seuls comptes inscrits dans
`espaces/$espace/membres`. Cette liste n'est ni lisible ni modifiable depuis
le web : elle ne se touche que depuis la console. Conséquence voulue :
personne ne peut se fabriquer un espace.

Ces règles ont été éprouvées avant qu'une ligne de câblage soit écrite : huit
requêtes anonymes, une seule acceptée (la lecture des questionnaires), sept
refusées — écriture, suppression, lecture des membres, écriture des membres,
lecture de tous les espaces, création d'un espace, lecture de la racine.
C'est l'ordre à garder : les règles d'abord, le code ensuite.

**Le mot de passe ne traverse pas le projet.** Il est saisi dans un formulaire,
échangé contre un jeton par l'API d'authentification, et oublié. Seul le jeton
est conservé — par `store.js`, comme tout le reste, parce qu'aucun module
n'écrit dans `localStorage` de son côté. Il expire en une heure et se
renouvelle en silence : une session de travail d'une après-midi ne doit pas
se couper au milieu d'une phrase.

**Le kiosque d'un espace ne montre que cet espace.** Ni les questionnaires du
dépôt, ni les brouillons locaux — alors même que le kiosque ordinaire montre
les seconds. L'exception est délibérée : celle qui publie doit voir exactement
ce que verra le visiteur, sinon elle ne peut pas relire sa propre page avant
de la diffuser. Un kiosque qui s'embellit pour son auteur ne sert à rien.

---

## Travailler à plusieurs sur ce dossier

Ce dépôt est édité par plusieurs sessions à la fois. Une règle en découle,
et elle a été payée :

**Jamais `git add -A` ni `git commit -a`.** Committer par chemins explicites,
et lire `git status` avant. Le 29 août 2026, un `git add -A` a ramassé le
travail en cours d'une session voisine — une fonctionnalité d'intégration en
iframe, à moitié écrite — et l'a poussé sous un message de commit qui parlait
d'autre chose. Rien n'a été perdu, mais l'historique porte désormais un
commit qui ment sur son contenu.

Le symptôme se voit à ceci : `git diff` montre des lignes supprimées qu'on
n'a jamais écrites. C'est le signe qu'un `HEAD` contient le travail d'un
autre. S'arrêter là, ne rien réécrire, et le dire.

---

## Ce qui n'existe pas, et pourquoi

**Voir les réponses des autres.** Toujours pas, et c'est le choix fondateur.
`core/remote.js` existe désormais et pourrait le porter — `quiz.js` gagnerait
un envoi en fin de parcours — mais personne ne l'a demandé, et cela ferait
entrer des données de visiteurs dans un projet qui n'en collecte aucune.

**Un moteur de Markdown.** Les champs de texte libre acceptent les
paragraphes (une ligne vide en sépare deux) et rien d'autre. Une dépendance
de plus pour un gain que personne n'a demandé.

**Publier par le dépôt.** A existé, et a été retiré. On déposait un `.json`
dans `quizzes/`, une action GitHub reconstruisait l'index, le questionnaire
paraissait au kiosque. Le chemin fonctionnait mais s'adressait à des gens qui
ont un accès git — or ceux à qui ce projet sert, une médiathèque par exemple,
n'en ont pas et n'en auront pas. Les espaces couvrent le besoin sans cette
condition. Laisser les deux aurait fait deux canaux concurrents pour une même
chose, et c'est pire qu'un seul.

**Une étagère de brouillons partagés dans le dépôt.** `quizzes/wip/` a vécu
une demi-journée. L'idée était de se passer un questionnaire inachevé sans le
publier, en s'appuyant sur le fait que l'action d'indexation ne descendait pas
dans les sous-dossiers. Elle tombe avec le reste du chemin git, et pour la
même raison. L'argument qui la sauvait — un filet de sauvegarde versionné,
puisque la base gratuite n'a aucune restauration — était faible : une
sauvegarde qui demande qu'on y pense n'en est pas une, et celle-ci n'a jamais
servi une seule fois. C'est l'export JSON qui porte désormais ce rôle, et il
ne le portera vraiment que si l'import sait **remplacer** au lieu de dupliquer.

**Un système de comptes** *pour répondre*. Hors périmètre, et ça n'a pas
bougé : répondre à un questionnaire ne demande jamais rien. Seul l'auteur qui
publie dans un espace partagé s'authentifie.

**Une étape de build.** Le jour où il en faut une, la promesse « ça tourne
depuis une clé USB » est morte.
