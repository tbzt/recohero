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
`▲` les triangles. Vous les nommez, vous leur donnez une couleur, vous en
mettez deux ou huit.

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
une phrase de justification, un lien facultatif.

---

## Diffuser un questionnaire

Deux voies, et elles ne servent pas à la même chose.

### Par lien — immédiat, rien à déployer

Le backoffice fabrique une adresse qui **contient le questionnaire entier**,
gzippé dans le fragment d'URL. Vous l'envoyez, la personne répond. Aucun
serveur n'est impliqué, et le fragment ne part jamais chez l'hébergeur.

Compter environ 3 500 caractères pour un questionnaire de huit questions avec
douze recommandations. C'est long pour une URL, mais tous les navigateurs et
toutes les messageries l'acceptent.

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

Sans `CompressionStream`, les liens de partage restent lisibles mais
deviennent nettement plus longs. Tout le reste fonctionne.

Thèmes clair et sombre suivent le système. `prefers-reduced-motion` est
respecté — il est traité une seule fois, au niveau des tokens de durée.

---

## Licence

MIT. Voir [LICENSE](LICENSE).
