# RecoHero

*La reco dont vous êtes le héros.*

Un système de questionnaires à la manière des quiz d'été : on répond, on
récolte des étoiles et des ronds, et on repart avec des recommandations
culturelles — des livres, des films, des disques, ce qu'on veut.

Entièrement statique. Pas de serveur, pas de base de données, pas de compte,
pas de dépendance, pas d'étape de build. Trois pages HTML, du CSS et des
modules ES. Ça tourne sur GitHub Pages comme sur une clé USB.

---

## Les trois surfaces

| Page | À qui | Ce qu'elle fait |
|---|---|---|
| `index.html` | tout le monde | Le kiosque : les questionnaires disponibles, et l'historique de vos propres résultats |
| `quiz.html`  | tout le monde | Le parcours : une question par écran, le compteur qui se remplit, le profil et ses recos |
| `admin.html` | vous | Le backoffice : créer, modifier, dupliquer, diagnostiquer, diffuser |

---

## Comment un questionnaire est fait

Trois briques, et c'est tout.

**Les axes** sont les signes qu'on compte : `★` les étoiles, `●` les ronds,
`▲` les triangles. Vous les nommez, vous leur donnez une couleur, et **vous en
mettez autant que vous voulez** — deux, six, dix. Seize glyphes sont proposés
(`★ ● ▲ ■ ◆ ♥ ♠ ♣ ♦ ✿ ☀ ☾ ✚ ✱ ❖ ▼`), tous servis par les polices système des
trois plateformes, mais le champ est libre : n'importe quel caractère ou
emoji fait l'affaire.

Au-delà de quatre axes, l'éditeur fait passer la rangée de pesées sous la
ligne de réponse plutôt que de la comprimer ; la carte de résultat rétrécit
ses glyphes au-delà de six et en affiche huit au maximum.

**Les questions** proposent des réponses, et chaque réponse distribue des
points aux axes. Une réponse peut donner 2 étoiles, ou 1 étoile et 1 rond, ou
rien du tout. Une question accepte une seule réponse ou plusieurs.

**Les profils** sont les sorties. Chacun se déclenche sur une condition :

| Condition | Se déclenche quand |
|---|---|
| **Axe dominant** | cet axe est celui qui a le plus de points |
| **Palier sur un axe** | le score de cet axe tombe dans l'intervalle |
| **Palier sur le total** | la somme de tous les axes tombe dans l'intervalle |
| **Par défaut** | rien d'autre n'a matché (le filet de sécurité) |

Les profils sont examinés **de haut en bas** : le premier qui matche gagne.
L'ordre dans l'éditeur *est* la priorité. Les « par défaut » passent toujours
en dernier, quelle que soit leur place.

Chaque profil porte ses recommandations : type d'œuvre, titre, auteur, année,
une phrase de justification, un lien facultatif, et une couverture.

---

## Les images

Cinq emplacements acceptent une image : la **couverture** du questionnaire
(écran de départ et vignette du kiosque), l'**illustration d'une question**
(bandeau au-dessus de l'énoncé), l'**image d'une réponse** (pour les questions
du type « choisissez votre paysage »), l'**illustration d'un profil** (bandeau
au-dessus du résultat), et la **couverture d'une œuvre** recommandée.

Pour les questions et les réponses, le champ se déplie depuis l'icône 🖼 —
dans l'en-tête de la carte pour une question, sur la ligne pour une réponse.

Chaque champ accepte trois formes :

| Forme | Exemple | Quand |
|---|---|---|
| Adresse web | `https://…/affiche.jpg` | l'image est déjà en ligne quelque part |
| Chemin relatif | `img/affiche.jpg` | vous maîtrisez le site qui sert la page |
| Fichier intégré | *bouton « ↑ Fichier »* | rien à héberger, l'image voyage avec le questionnaire |

Un fichier choisi sur le disque est **réduit puis ré-encodé** (1000 px pour une
couverture, 420 px pour une vignette, en WebP quand le navigateur sait le
produire) et intégré au questionnaire. Le backoffice affiche son poids et le
signale en orange au-delà de 120 Ko.

Le compromis à connaître : une image intégrée survit à tout — au partage par
lien, à une coupure réseau, à la disparition du site source — mais elle pèse.
Une dizaine d'images intégrées fait passer un lien de partage de 3 500 à
plusieurs dizaines de milliers de caractères.

**Le chemin relatif se résout contre l'adresse de la page, pas contre le
questionnaire.** Si vous publiez dans un espace partagé sur le site de
quelqu'un d'autre, `img/affiche.jpg` ira chercher le fichier chez lui, où il
n'est pas. Dans ce cas, il n'y a que deux formes utilisables : l'adresse web
complète, ou le fichier intégré. Le chemin relatif est réservé à qui déploie
son propre site.

Toute image est passée au filtre : seules les trois formes ci-dessus sont
acceptées. Une adresse `javascript:`, un `data:text/html` ou une URL en `//`
sont silencieusement effacés à la lecture du questionnaire.

---

## La carte de résultat

À la fin du parcours, le bouton **« 🖼 Ma carte de résultat »** compose une
affiche 1080 × 1350 (format portrait 4:5, celui des stories) : le titre du
questionnaire, l'illustration ou l'emoji du profil, son nom, sa devise, la
feuille de score avec les glyphes, et jusqu'à trois recommandations.

Ce n'est pas une capture d'écran : c'est un visuel dessiné pour être partagé,
sans aucune bibliothèque — le canvas du navigateur suffit. Sur mobile, le
partage natif prend le relais quand il accepte les fichiers ; ailleurs, la
carte se télécharge en PNG.

Deux limites à connaître. Une image de profil hébergée sur un **autre domaine**
ne peut pas être dessinée dans la carte (le navigateur interdirait alors
l'export) : la carte retombe sur l'emoji, sans rien casser. Les images
intégrées et celles du même site, elles, s'affichent. Et si un profil a un titre
très long, la carte **retire des recommandations** plutôt que de laisser le
texte mordre sur la signature.

---

## Diffuser un questionnaire

Trois voies, et elles ne servent pas à la même chose.

### Par lien — immédiat, rien à déployer

Le backoffice fabrique une adresse qui **contient le questionnaire entier**,
gzippé dans le fragment d'URL. Vous l'envoyez, la personne répond. Aucun
serveur n'est impliqué, et le fragment ne part jamais chez l'hébergeur.

Compter environ 3 500 caractères pour un questionnaire de huit questions avec
douze recommandations, **sans images intégrées**. C'est long pour une URL, mais
tous les navigateurs et toutes les messageries l'acceptent. Le panneau
« Diffuser » affiche la longueur exacte en direct.

### Par un espace partagé — permanent, à plusieurs

Le lien va d'une personne à une personne, et il fige le questionnaire au
moment où on le copie. Pour qu'une équipe — une médiathèque, par exemple —
publie durablement et à plusieurs, RecoHero sait parler à une **base
partagée** : une Realtime Database Firebase, en REST pur, sans SDK ni étape de
build.

Rien de tout cela ne demande git. C'est le point : les gens à qui ce projet
sert n'ont pas de dépôt, et n'en auront pas.

Un **espace** est une équipe et son catalogue. Il se nomme dans l'adresse :

| Adresse | Qui | Ce qui se passe |
|---|---|---|
| `…/?espace=maupassant` | tout le monde | Le kiosque de cette équipe, et lui seul. On répond **sans compte**. |
| `…/admin.html?espace=maupassant` | l'équipe | Le backoffice. Demande une adresse et un mot de passe, une fois. |

Le kiosque d'un espace ne montre **que** cet espace : ni les questionnaires du
dépôt, ni les brouillons locaux. Ce n'est pas un oubli — c'est la condition
pour que celle qui publie voie exactement ce que verra le visiteur.

Une fois connecté, le panneau **Diffuser** gagne « ⇧ Publier dans l'espace ».
Le questionnaire paraît aussitôt sur le kiosque de l'équipe. « ⌫ Retirer de
l'espace » l'en enlève sans toucher à la copie locale.

#### Ce qui est public, et pourquoi ce n'est pas un oubli

Les deux constantes en tête de [`js/core/remote.js`](js/core/remote.js) — URL
de la base et clé d'API — sont **en clair, et c'est la manière normale**. Dans
une application web, la configuration Firebase est un identifiant, pas un mot
de passe : elle est lisible dans le trafic réseau de n'importe quel visiteur,
quoi qu'on fasse. Aucune cachette n'existe pour un site statique public — un
gist, un secret d'action GitHub, tout finit dans le navigateur du visiteur ou
dans les fichiers déployés.

Ce qui protège les données est ailleurs : dans les **règles** de la base
([`firebase.rules.json`](firebase.rules.json)), appliquées côté serveur.
Lecture ouverte à tous, écriture réservée aux comptes inscrits comme membres
de l'espace. Le mot de passe, lui, n'est nulle part dans le dépôt : il est tapé
par la personne, et seul le jeton qui en résulte est conservé — il expire, et
se renouvelle tout seul tant que la session dure.

#### Monter son propre espace

Pour une structure qui veut son autonomie complète, sans dépendre de personne :

1. Créer un projet sur `console.firebase.google.com` (Analytics : non).
2. **Realtime Database** — pas Firestore : c'est celle qui a une API REST
   utilisable au simple `fetch`. Emplacement `europe-west1`, **définitif**.
3. **Authentication → E-mail/Mot de passe**, activer le premier interrupteur
   seulement. Créer un utilisateur par personne, noter son UID.
4. Coller [`firebase.rules.json`](firebase.rules.json) dans l'onglet Règles.
5. Créer `espaces/<nom>/membres/<UID>` à `true`, pour chaque personne.
6. Remplacer `DB` et `API_KEY` en tête de
   [`js/core/remote.js`](js/core/remote.js).

Créer un espace passe toujours par la console : les règles interdisent d'en
fabriquer un depuis le web. C'est voulu.

---

### Par intégration — dans la page de quelqu'un d'autre

Backoffice → **Diffuser** → **⧉ Code d'intégration**. Le dialogue produit une
`<iframe>` et le court script qui l'accompagne ; on colle les deux dans la page
hôte, et le questionnaire s'y déroule sans que le visiteur quitte le site.

L'adresse produite prend l'une de deux formes, et le dialogue dit laquelle :

| Le questionnaire est… | L'adresse porte… | Conséquence |
|---|---|---|
| déjà dans le dépôt | son identifiant (`?q=…`) | l'intégration suit le dépôt : ce que vous pousserez demain s'affichera sans retoucher au code collé |
| encore un brouillon | son contenu (`#k=…`) | l'intégration fige le questionnaire tel qu'il est à la seconde où vous copiez |

Le paramètre qui fait tout est `embed=1`. Il change deux choses, et deux
seulement. **Les sorties disparaissent** — le « ← Kiosque » du bandeau, le
« Retour au kiosque » du résultat : sur le site d'un autre, ces liens éjectent
le visiteur. Le bandeau reste, lui : il porte la progression et le compteur,
qui sont le parcours même. Et **la hauteur est annoncée à la page hôte**, qui
seule peut redimensionner le cadre — sans quoi le parcours défilerait dans un
hublot de 720 px.

Le script fourni écoute deux messages, et rien d'autre :

| Message | Ce que fait l'hôte |
|---|---|
| `recohero:height` | ajuste la hauteur du cadre |
| `recohero:scroll` | remonte la page sur le cadre au changement d'écran |

Il rattache chaque message au cadre dont il vient en comparant `contentWindow`
à `event.source` : plusieurs questionnaires peuvent cohabiter sur la même page.

Deux limites à connaître. Dans une iframe tierce, Safari **bloque** le stockage
et Chrome le **cloisonne** : la reprise d'un parcours interrompu et l'historique
cessent alors de fonctionner, silencieusement — le questionnaire, lui, marche
intégralement. Et le partage natif de la carte de résultat réclame
`allow="web-share"` sur l'iframe ; le code fourni le pose déjà.

Enfin, le piège du travail en local : l'adresse est construite à partir de
**celle de la page où vous êtes**. Un code d'intégration copié depuis
`localhost` contient `localhost` et ne marchera nulle part ailleurs. Le
dialogue le signale en orange le cas échéant ; générez-le depuis l'adresse
publique du site.

---

## L'édition au quotidien

**Rien ne demande confirmation, tout s'annule.** Supprimer une question, un
axe, un profil ou même un questionnaire entier se fait sans boîte de dialogue :
un bandeau propose « Annuler » pendant six secondes, et `Ctrl+Z` remonte la
pile des quarante derniers gestes de structure. La frappe au clavier n'y est
pas empilée — le `Ctrl+Z` du champ lui-même fait déjà ce travail, mieux.

**Tout se réordonne au glisser-déposer**, à la souris comme au doigt : les
axes, les questions, les réponses, les profils, les recommandations. La
poignée est le `⠿` à gauche. Les flèches ↑↓ restent à côté : c'est le chemin
clavier, et il ne disparaît pas. `Échap` en cours de geste annule le
déplacement. Le défilement suit tout seul quand on approche d'un bord.

**Un aperçu montre la question sous le curseur**, en haut du panneau, telle
que le répondant la verra — même code de rendu, pas une imitation qui
dériverait. Il se met à jour à la frappe, sans jamais déplacer le curseur du
champ. Le bouton « Masquer » le replie.

**Les questions et les profils se replient**, un par un ou tous ensemble. Une
carte repliée montre l'essentiel — nombre de réponses, choix multiple, image,
et les glyphes des axes qu'elle alimente — ce qui suffit à la reconnaître et à
la déplacer. C'est aussi ce qui rend le glisser-déposer praticable sur un long
questionnaire : on tire cinquante pixels au lieu de deux mille.

**Sur téléphone, une barre d'onglets collante** remplace la navigation du
rail, qui passe sous la surface d'édition. Le nom du questionnaire, dans le
bandeau, ouvre la liste pour en changer.

**Chaque section porte le nombre de problèmes** que le diagnostic y a trouvés,
en rouge s'il faut corriger, en orange s'il faut vérifier.

`Ctrl+S` force l'enregistrement, `Ctrl+Z` annule le dernier geste de structure.

---

## Le backoffice

Il s'ouvre sur une phrase d'accès. **Elle n'est pas publiée ici** — seule son
empreinte SHA-256 figure dans le code, dans la constante `PASS_SHA256` en tête
de [`js/admin/app.js`](js/admin/app.js). Gardez la vôtre dans un gestionnaire
de mots de passe : ce dépôt ne la contient nulle part.

Cette phrase **ne protège rien**, et c'est assumé : RecoHero est entièrement
statique, il n'existe aucune donnée en ligne à protéger, et le code de la page
est public. Elle évite d'ouvrir le backoffice par mégarde, rien de plus.

Il faut être précis sur ce « rien ». La porte ne compare la phrase qu'une fois,
puis note un horodatage dans le `localStorage` du visiteur — qui peut l'écrire
lui-même depuis la console, sans jamais connaître la phrase. Une empreinte
imprenable n'y changerait rien. Ce que le backoffice ouvre, de toute façon,
c'est le stockage de celui qui l'ouvre : il n'atteint ni vos questionnaires,
ni la publication, ni les réponses de qui que ce soit.

Pour poser la vôtre, remplacez la constante par son empreinte :

```bash
printf '%s' 'votre-nouvelle-phrase' | sha256sum
```

Mettre la constante à la chaîne vide supprime la porte.

Une phrase déjà écrite en clair dans un commit y reste : l'historique ne
s'efface pas en modifiant le fichier. Si la vôtre a été publiée un jour, la
seule façon de refermer est d'en choisir une autre.

### Le diagnostic

Le rail de gauche liste en continu ce qui empêche le questionnaire d'être
prêt : question sans texte, réponse vide, axe qui ne reçoit jamais de point,
intervalle inversé, absence de profil par défaut. Chaque ligne est cliquable
et emmène à l'endroit fautif.

Sur le panneau **Profils**, un profil que *aucune* combinaison de réponses ne
peut atteindre est marqué « jamais atteint ». Le calcul est exhaustif tant
qu'il y a moins de 20 000 combinaisons possibles, échantillonné au-delà.

---

## Naviguer dans le parcours

Au clavier : les touches `1` à `9` choisissent une réponse, `Entrée` avance,
`←` et `→` reculent et avancent.

Au doigt : on balaie horizontalement. Un geste trop court, trop oblique ou
trop lent est ignoré — c'est le rapport entre l'écart horizontal et vertical
qui fait le tri, pour qu'un défilement du pouce un peu de travers ne change
pas de question. À la souris, le balayage est délibérément inactif : un
glissement horizontal y veut dire « sélectionner du texte ».

---

## Ce qui est stocké, et où

Rien ne quitte le navigateur. Tout vit dans le `localStorage`, sous le préfixe
`recohero.v1.` :

| Clé | Contenu |
|---|---|
| `drafts` | vos questionnaires en cours d'édition |
| `results` | l'historique de vos résultats (60 derniers) |
| `session` | un parcours interrompu, pour pouvoir le reprendre |
| `remote`  | le jeton de la base partagée — jamais le mot de passe |
| `unlock` | l'horodatage du déverrouillage du backoffice (12 h) |

Embarqué dans le site d'un autre (`embed=1`), rien ne change à cette liste —
sauf que le navigateur peut refuser le stockage tiers. Le refus est encaissé
sans erreur : `drafts`, `results` et `session` deviennent simplement muets.

Il n'y a **aucun moyen de voir les réponses des autres** : c'est une
conséquence directe du choix « pas de serveur ». Si ce besoin apparaît un
jour, il faudra ajouter une base externe — voir la note en fin
d'[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Faire tourner en local

Un serveur statique suffit. Il en faut un vrai : les modules ES et le
chargement de `quizzes/index.json` ne fonctionnent pas en `file://`.

```bash
python3 -m http.server 8137
```

Puis <http://localhost:8137>.

---

## Compatibilité

Navigateurs à jour, desktop et mobile. Les fonctions modernes utilisées et
leur seuil : `color-mix()` (Chrome 111, Firefox 113, Safari 16.2),
`CompressionStream` pour les liens de partage (Chrome 80, Firefox 113,
Safari 16.4), `structuredClone`, `<dialog>`.

L'intégration en iframe demande `postMessage` (universel) et `ResizeObserver`
(Chrome 64, Firefox 69, Safari 13.1) — ce dernier n'est qu'un supplément : la
hauteur est annoncée à chaque écran sans lui.

S'y ajoutent, pour les fonctions récentes : `createImageBitmap` et l'encodage
WebP du canvas pour intégrer une image depuis un fichier ; `navigator.share`
avec fichiers pour envoyer la carte de résultat depuis un mobile.

Aucune n'est indispensable. Sans `CompressionStream`, les liens de partage
restent lisibles mais deviennent nettement plus longs. Sans partage natif de
fichier, la carte se télécharge. Tout le reste fonctionne.

Thèmes clair et sombre suivent le système. `prefers-reduced-motion` est
respecté — il est traité une seule fois, au niveau des tokens de durée.

---

## Licence

MIT. Voir [LICENSE](LICENSE).
