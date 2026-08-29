# Le garde-fou contre l'écrasement — comment il tient

*Ce fichier n'est pas de la documentation d'usage : il explique la règle de
base de données, et sert de mode d'emploi pour la poser. Il vit à la racine
parce que la règle et le code doivent changer ensemble, jamais l'un sans
l'autre.*

## Le problème

Deux personnes de la médiathèque ouvrent le même questionnaire. La première
publie, la seconde publie ensuite : le travail de la première disparaît, sans
que personne le sache. Rien dans RecoHero ne l'empêchait.

## Pourquoi la règle est côté base, et pas côté client

On aurait pu comparer les versions dans le navigateur avant d'écrire. Ça
n'aurait rien garanti : deux écritures peuvent se croiser entre la lecture et
l'envoi, un onglet resté ouvert ignore ce qui s'est passé ailleurs, et un
défaut de notre code annulerait la protection en silence.

La base, elle, arbitre au moment de l'écriture. Elle refuse la seconde
écriture même si notre code se trompe.

## Le mécanisme

Chaque questionnaire porte un compteur `rev`. Publier envoie `rev + 1`, et la
règle exige que ce soit exactement le suivant :

    newData.child('rev').val() === data.child('rev').val() + 1

Deux personnes partent de `rev: 5`. La première écrit `6` : accepté. La
seconde écrit `6` aussi, mais la base est déjà à `6` — il faudrait `7`. Elle
est refusée. Le refus vient de la base, pas de notre politesse.

`updatedBy` porte l'UID de qui a écrit, et la règle vérifie qu'il correspond
au compte connecté : personne ne peut signer à la place d'un autre.

Un questionnaire déjà en ligne sans `rev` — il en existe — n'est pas bloqué :
la première écriture adopte le compteur.

## Le rang de gérant

Les membres d'un espace s'invitent et se retirent entre eux. Sans exception,
un seul membre suffirait à verrouiller tout le monde dehors, propriétaire
compris — et il faudrait la console pour rouvrir.

D'où `espaces/<nom>/gerants/<uid>`. Un compte qui y figure ne peut être retiré
des membres par personne : la règle le refuse. Cette branche-là n'est
modifiable que depuis la console, et c'est ce qui la rend fiable.

Un gérant doit figurer **dans les deux listes** : `membres` pour publier,
`gerants` pour être protégé.

## Poser la règle

> ⚠️ **Une seule chose se colle dans la console : le contenu du fichier
> [`firebase.rules.json`](firebase.rules.json).** Rien d'autre de ce document.
> Les blocs plus bas sont des commandes de terminal ; collées dans l'onglet
> Règles, elles produisent un « Parse error » — sans rien casser, Firebase
> refusant d'enregistrer, mais sans rien poser non plus.

Console Firebase → Realtime Database → onglet **Règles** → tout sélectionner,
coller le contenu de `firebase.rules.json` à la place → **Publier**.

Les règles d'accès n'y changent pas : lecture ouverte, écriture réservée aux
membres, `membres` en lecture restreinte et jamais en écriture. Le seul ajout
est la validation de `$quiz`.

## Vérifier qu'elle est bien là

Le backoffice le fait tout seul : à la connexion à un espace, il tente une
écriture qui doit être refusée. Si elle passe, un bandeau rouge le dit dans la
carte Espace. Une règle qu'on croit posée et qui ne l'est pas ne se voit pas
autrement.

### Le contrôle en terminal — facultatif, et surtout pas dans la console

Ces commandes se tapent dans un **terminal**. Elles vérifient les règles
d'accès, que le garde-fou ne modifie pas : elles doivent donc donner le même
résultat avant et après. Elles servent à s'assurer qu'un copier-coller n'a
rien cassé, pas à prouver que le compteur fonctionne.

```bash
DB=https://recohero-f9cf9-default-rtdb.europe-west1.firebasedatabase.app
E=maupassant
curl -s -o /dev/null -w '%{http_code} lecture des questionnaires (200 attendu)\n'  "$DB/espaces/$E/quizzes.json"
curl -s -o /dev/null -w '%{http_code} écriture anonyme (401)\n'        -X PUT  -d '{"x":1}' "$DB/espaces/$E/quizzes/pirate.json"
curl -s -o /dev/null -w '%{http_code} suppression anonyme (401)\n'     -X DELETE          "$DB/espaces/$E/quizzes/pirate.json"
curl -s -o /dev/null -w '%{http_code} lecture des membres (401)\n'                        "$DB/espaces/$E/membres.json"
curl -s -o /dev/null -w '%{http_code} écriture des membres (401)\n'    -X PUT  -d 'true'  "$DB/espaces/$E/membres/pirate.json"
curl -s -o /dev/null -w '%{http_code} lecture de /espaces (401)\n'                        "$DB/espaces.json"
curl -s -o /dev/null -w '%{http_code} création d un espace (401)\n'    -X PUT  -d '{}'    "$DB/espaces/pirate.json"
curl -s -o /dev/null -w '%{http_code} lecture de la racine (401)\n'                       "$DB/.json"
```

Une seule doit passer : la première. Ces huit-là contrôlent les règles
d'**accès**, que le garde-fou ne modifie pas — elles doivent donc donner le
même résultat avant et après. Le compteur, lui, ne se vérifie qu'authentifié :
c'est l'épreuve à deux onglets ci-dessous.

## Éprouver le compteur

Ouvrir le même questionnaire dans deux onglets du backoffice, publier depuis
le premier, puis publier depuis le second sans l'avoir rechargé. Le second
doit être refusé, et le dialogue doit nommer qui a modifié et quand.

Si le second passe, la règle n'est pas active — et le bandeau rouge de la
carte Espace l'aura déjà dit.
