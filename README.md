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

Quatre emplacements acceptent une image : la **couverture** du questionnaire
(écran de départ et vignette du kiosque), l'**illustration** d'un profil
(bandeau au-dessus du résultat), la **couverture d'une œuvre** recommandée, et
l'**image d'une réponse** (pour les questions du type « choisissez votre
paysage » — le champ se déplie depuis l'icône 🖼 de la ligne).

Chaque champ accepte trois formes :

| Forme | Exemple | Quand |
|---|---|---|
| Adresse web | `https://…/affiche.jpg` | l'image est déjà en ligne quelque part |
| Chemin du dépôt | `img/affiche.jpg` | vous déposez vos images à côté du questionnaire |
| Fichier intégré | *bouton « ↑ Fichier »* | rien à héberger, l'image voyage avec le questionnaire |

Un fichier choisi sur le disque est **réduit puis ré-encodé** (1000 px pour une
couverture, 420 px pour une vignette, en WebP quand le navigateur sait le
produire) et intégré au questionnaire. Le backoffice affiche son poids et le
signale en orange au-delà de 120 Ko.

Le compromis à connaître : une image intégrée survit à tout — au partage par
lien, à une coupure réseau, à la disparition du site source — mais elle pèse
dans le lien de partage. Une dizaine d'images intégrées le fait passer de
3 500 à plusieurs dizaines de milliers de caractères. Pour un questionnaire
richement illustré, préférez le dossier `quizzes/img/` du dépôt.

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
intégrées et celles du dépôt, elles, s'affichent. Et si un profil a un titre
très long, la carte **retire des recommandations** plutôt que de laisser le
texte mordre sur la signature.

---

## Diffuser un questionnaire

Deux voies, et elles ne servent pas à la même chose.

### Par lien — immédiat, rien à déployer

Le backoffice fabrique une adresse qui **contient le questionnaire entier**,
gzippé dans le fragment d'URL. Vous l'envoyez, la personne répond. Aucun
serveur n'est impliqué, et le fragment ne part jamais chez l'hébergeur.

Compter environ 3 500 caractères pour un questionnaire de huit questions avec
douze recommandations, **sans images intégrées**. C'est long pour une URL, mais
tous les navigateurs et toutes les messageries l'acceptent. Le panneau
« Diffuser » affiche la longueur exacte en direct.

### Par le dépôt — permanent, visible au kiosque

1. Backoffice → **Diffuser** → télécharger le `.json`
2. Déposer le fichier dans `quizzes/`
3. Ajouter son nom à `quizzes/index.json`
4. Commit, push. GitHub Pages fait le reste.

```json
[
  "quel-roman-pour-cet-ete.json",
  "votre-nouveau-questionnaire.json"
]
```

Pour **modifier** un questionnaire déjà publié : le backoffice le liste sous
« Publiés au dépôt », le bouton ✎ en fait une copie locale éditable. Une fois
satisfait, réexportez et écrasez le fichier. Tant que vous n'avez pas poussé,
le kiosque continue de montrer la version du dépôt — c'est voulu : ce que
voient les autres ne change que quand vous le décidez.

---

## Le backoffice

Il s'ouvre sur une phrase d'accès. Phrase livrée : **`reco2026`**.

Cette phrase **ne protège rien**, et c'est assumé : RecoHero est entièrement
statique, il n'existe aucune donnée en ligne à protéger, et le code de la page
est public. Elle évite d'ouvrir le backoffice par mégarde, rien de plus.

Pour la changer, remplacez la constante `PASS_SHA256` en tête de
[`js/admin/app.js`](js/admin/app.js) par l'empreinte de la vôtre :

```bash
printf '%s' 'votre-nouvelle-phrase' | sha256sum
```

Mettre la constante à la chaîne vide supprime la porte.

### Le diagnostic

Le rail de gauche liste en continu ce qui empêche le questionnaire d'être
prêt : question sans texte, réponse vide, axe qui ne reçoit jamais de point,
intervalle inversé, absence de profil par défaut. Chaque ligne est cliquable
et emmène à l'endroit fautif.

Sur le panneau **Profils**, un profil que *aucune* combinaison de réponses ne
peut atteindre est marqué « jamais atteint ». Le calcul est exhaustif tant
qu'il y a moins de 20 000 combinaisons possibles, échantillonné au-delà.

---

## Ce qui est stocké, et où

Rien ne quitte le navigateur. Tout vit dans le `localStorage`, sous le préfixe
`recohero.v1.` :

| Clé | Contenu |
|---|---|
| `drafts` | vos questionnaires en cours d'édition |
| `results` | l'historique de vos résultats (60 derniers) |
| `session` | un parcours interrompu, pour pouvoir le reprendre |
| `unlock` | l'horodatage du déverrouillage du backoffice (12 h) |

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
