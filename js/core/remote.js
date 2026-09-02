/* ==========================================================================
   remote.js — la base partagée, pour éditer à plusieurs.
   Le seul module qui parle à un serveur. Tout le reste du projet continue
   de fonctionner s'il est absent ou muet : le kiosque sert le dépôt, le
   backoffice édite le localStorage, les liens #k= voyagent seuls.

   Realtime Database, et pas Firestore : son API REST se consomme au simple
   fetch, donc la promesse « aucune dépendance, aucune étape de build »
   tient. Rien n'est importé ici, ni SDK ni polyfill.

   CE QUI EST PUBLIC, ET POURQUOI CE N'EST PAS UN OUBLI
   Les deux constantes ci-dessous sont en clair, et c'est la manière
   normale : dans une application web, la configuration Firebase est un
   identifiant, pas un mot de passe. Elle est lisible dans le trafic réseau
   de n'importe quel visiteur, quoi qu'on fasse. Ce qui protège les données
   est ailleurs — dans les règles de la base, appliquées côté serveur, et
   qui n'accordent l'écriture qu'aux comptes inscrits comme membres d'un
   espace. Le mot de passe, lui, n'est jamais ici : il est tapé par la
   personne, et seul le jeton qui en résulte est conservé.

   Qui reprend ce dépôt remplace ces deux valeurs par les siennes.
   ========================================================================== */

import * as store from './store.js';
import { normaliserVitrine } from './schema.js';

const DB = 'https://recohero-f9cf9-default-rtdb.europe-west1.firebasedatabase.app';
const API_KEY = 'AIzaSyBVWe1ZBdh0IU-6_hJoDCY3YroJz2iyBHc';

const SIGN_IN = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const REFRESH = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;
const SIGN_UP = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
const OOB     = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`;
const UPDATE  = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`;

/* Le jeton dure une heure. On le renouvelle un peu avant l'échéance :
   à la seconde près, une requête partie juste avant expirerait en vol. */
const MARGIN = 5 * 60 * 1000;

export function configured() {
  return Boolean(DB && API_KEY);
}

/* --- Erreurs -----------------------------------------------------------
   Firebase répond des codes en majuscules, utiles au développeur et
   opaques à qui édite un questionnaire. On traduit les seuls qu'une
   personne réelle peut rencontrer, et on laisse passer le reste tel quel
   plutôt que d'inventer un message qui masquerait la cause.           */

const MESSAGES = {
  EMAIL_NOT_FOUND: 'Adresse inconnue.',
  INVALID_PASSWORD: 'Mot de passe incorrect.',
  INVALID_LOGIN_CREDENTIALS: 'Adresse ou mot de passe incorrect.',
  USER_DISABLED: 'Ce compte a été désactivé.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives. Réessaie dans quelques minutes.',
  INVALID_EMAIL: 'Cette adresse n’est pas une adresse e-mail.',
  EMAIL_EXISTS: 'Cette adresse a déjà un compte.',
  UNAUTHORIZED_DOMAIN: 'Ce domaine n’est pas autorisé dans le projet Firebase.',
  INVALID_CONTINUE_URI: 'Adresse de retour invalide.',
  WEAK_PASSWORD: 'Mot de passe trop court : six caractères au minimum.',
  MISSING_PASSWORD: 'Mot de passe manquant.',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'Session trop ancienne. Reconnecte-toi avant de changer ton mot de passe.',
};

function readable(code) {
  return MESSAGES[code] || `La connexion a échoué (${code || 'raison inconnue'}).`;
}

/* --- Session -------------------------------------------------------------
   Conservée par store.js, comme tout le reste : aucun module n'écrit dans
   localStorage de son côté. Le mot de passe n'y entre jamais — seulement
   le jeton, qui expire, et le jeton de renouvellement.                  */

export function session() {
  const saved = store.getRemote();
  return saved?.refreshToken ? { email: saved.email, uid: saved.uid } : null;
}

export function signOut() {
  store.clearRemote();
}

export async function signIn(email, password) {
  let response;
  try {
    response = await fetch(SIGN_IN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
  } catch {
    /* Ici c'est la porte d'entrée : sans ce message, on cherche un mot de
       passe faux là où la requête n'est jamais partie. */
    const err = new Error(
      'Le service de comptes Firebase n’a pas répondu — ce n’est donc pas ton '
      + `mot de passe. ${await pourquoiInjoignable()}`,
    );
    err.code = 'RESEAU';
    throw err;
  }
  const body = await response.json();
  if (!response.ok) throw new Error(readable(body?.error?.message?.split(' ')[0]));

  store.setRemote({
    email: body.email,
    uid: body.localId,
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    expiresAt: Date.now() + Number(body.expiresIn || 3600) * 1000,
  });
  return session();
}

/* Un jeton valide, ou null si personne n'est connecté. Le renouvellement
   est silencieux : c'est la seule façon qu'une session de travail d'une
   après-midi ne se coupe pas au milieu d'une phrase.                   */
async function token() {
  const saved = store.getRemote();
  if (!saved?.refreshToken) return null;
  if (saved.idToken && Date.now() < saved.expiresAt - MARGIN) return saved.idToken;

  const response = await fetch(REFRESH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken }),
  });
  if (!response.ok) {
    /* Jeton révoqué, mot de passe changé, compte supprimé : la session
       n'est plus rattrapable. On la retire plutôt que de la traîner. */
    store.clearRemote();
    return null;
  }
  const body = await response.json();
  store.setRemote({
    ...saved,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  });
  return body.id_token;
}

/* --- La base -------------------------------------------------------------
   Un espace = une branche. Les questionnaires d'une médiathèque ne
   croisent jamais ceux d'une autre, et le nom de l'espace vient de
   l'adresse (?espace=…), jamais du code.                              */

/* --- Comptes ---------------------------------------------------------------
   Inviter quelqu'un, sans serveur et sans jamais voir son mot de passe.

   Le compte est créé avec un secret aléatoire qu'on jette aussitôt : il
   n'est ni affiché, ni conservé, ni transmis. La personne reçoit ensuite
   le courriel de réinitialisation de Firebase et choisit le sien. Nous ne
   sommes à aucun moment en possession de ce qui l'authentifie.

   La création de compte est de toute façon ouverte à qui connaît la clé
   publique — elle l'était avant cette fonction. Ce qui donne des droits,
   ce n'est pas d'avoir un compte, c'est de figurer dans les membres de
   l'espace ; et cette liste-là, les règles la gardent.                  */

/* --- Quand le service de comptes ne répond pas -----------------------------
   Les comptes et la base ne vivent PAS sur le même hôte : les comptes sur
   `identitytoolkit.googleapis.com`, la base sur `…firebasedatabase.app`. L'un
   peut être joignable et pas l'autre.

   Le navigateur, lui, ne dit rien d'utile. Un POST vers cet hôte porte un
   `Content-Type: application/json`, ce qui n'est pas une requête « simple » :
   le navigateur envoie d'abord un contrôle préalable (OPTIONS). Si ce
   contrôle est refusé, la vraie requête ne part jamais et Firefox rapporte
   « NetworkError », code d'état null. Refus de clé, filtre réseau, bloqueur :
   les trois donnent exactement la même trace.

   D'où cette sonde. Un GET nu, sans en-tête ajouté, EST une requête simple :
   pas de contrôle préalable, et le corps de la réponse reste lisible là où le
   POST échouait à l'aveugle. Si la clé refuse ce domaine, elle le dit — avec
   le nom du domaine à autoriser.

   Le coût est nul en marche normale : la sonde ne part que sur échec.     */

const SONDE = `https://identitytoolkit.googleapis.com/v1/projects?key=${API_KEY}`;

async function pourquoiInjoignable() {
  let corps = '';
  try {
    const r = await fetch(SONDE);
    if (r.ok) {
      /* La clé accepte ce domaine et l'hôte répond : ce n'est donc ni la clé
         ni le réseau en bloc. Reste ce qui distingue les deux requêtes — le
         contrôle préalable du POST. */
      return 'La clé accepte pourtant ce domaine et le service répond. '
        + 'C’est donc le contrôle préalable (OPTIONS) de la requête qui est '
        + 'refusé : un bloqueur de publicité, un antivirus qui inspecte le '
        + 'HTTPS ou le filtre du réseau en sont les causes habituelles.';
    }
    corps = await r.text();
  } catch {
    return 'La sonde elle-même n’aboutit pas : cet hôte est injoignable depuis '
      + 'ce poste. Un bloqueur de publicité, un antivirus qui inspecte le HTTPS '
      + 'ou le filtre du réseau en sont les causes habituelles.';
  }

  if (/API_KEY_HTTP_REFERRER_BLOCKED|are blocked/i.test(corps)) {
    return `La clé d’API refuse les requêtes venant de « ${location.origin} ». `
      + 'Dans la console Google Cloud → API et services → Identifiants, ouvre la '
      + 'clé du navigateur et ajoute ce domaine à ses restrictions de référent '
      + 'HTTP. Attention : ce réglage-là est distinct des « domaines autorisés » '
      + 'de Firebase Authentication, et c’est celui-ci qui bloque.';
  }
  return `Le service de comptes a répondu une erreur : ${corps.replace(/\s+/g, ' ').slice(0, 200)}`;
}
async function appelIdentityToolkit(url, corps) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
  } catch {
    const err = new Error(
      `Le service de comptes Firebase n’a pas répondu. ${await pourquoiInjoignable()}`,
    );
    err.code = 'RESEAU';
    throw err;
  }
  const data = await response.json();
  if (!response.ok) {
    const code = String(data?.error?.message || '').split(' ')[0];
    const err = new Error(readable(code));
    err.code = code;
    throw err;
  }
  return data;
}

function secretJetable() {
  const octets = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...octets));
}

/* Renvoie l'identifiant du compte créé. Lève une erreur portant le code
   EMAIL_EXISTS si l'adresse en a déjà un — cas courant et pas une panne :
   l'appelant demandera alors son identifiant à la personne, puisque rien
   côté client ne permet de le retrouver.                               */
export async function creerCompte(email) {
  const data = await appelIdentityToolkit(SIGN_UP, {
    email, password: secretJetable(), returnSecureToken: false,
  });
  return data.localId;
}

/* Le modèle de courriel de Firebase n'accepte aucune variable de notre
   cru : seulement %LINK%, %EMAIL%, %APP_NAME% et %DISPLAY_NAME%. Le nom
   de l'espace ne peut donc pas figurer dans le texte.

   Ce qu'on peut faire, c'est ramener la personne au bon endroit une fois
   son mot de passe choisi : `continueUrl` voyage dans le lien d'action et
   Firebase propose de la rediriger dessus. Le domaine doit figurer dans
   les domaines autorisés du projet ; s'il n'y est pas, la demande est
   refusée en bloc — on la refait alors sans, plutôt que de laisser une
   commodité empêcher l'invitation elle-même. */
export async function envoyerCourrielMotDePasse(email, continueUrl = null) {
  const base = { requestType: 'PASSWORD_RESET', email };
  if (!continueUrl) return appelIdentityToolkit(OOB, base);

  try {
    return await appelIdentityToolkit(OOB, { ...base, continueUrl });
  } catch (err) {
    if (err.code !== 'UNAUTHORIZED_DOMAIN' && err.code !== 'INVALID_CONTINUE_URI') throw err;
    console.info('[remote] domaine non autorisé pour le retour : courriel envoyé sans redirection.');
    return appelIdentityToolkit(OOB, base);
  }
}

/* Changer son propre mot de passe. Firebase renvoie de nouveaux jetons :
   les ignorer déconnecterait la personne au renouvellement suivant. */
export async function changerMotDePasse(motDePasse) {
  const idToken = await token();
  if (!idToken) throw new Error('Il faut être connecté.');
  const data = await appelIdentityToolkit(UPDATE, { idToken, password: motDePasse, returnSecureToken: true });
  const saved = store.getRemote();
  store.setRemote({
    ...saved,
    idToken: data.idToken || saved.idToken,
    refreshToken: data.refreshToken || saved.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  });
}

/* --- Les compteurs ----------------------------------------------------------
   Qui répond n'a pas de compte : l'écriture est donc ouverte. Ce qui la
   borne, c'est la règle — chaque écriture doit valoir exactement
   l'ancienne valeur plus un, et `{".sv": {"increment": 1}}` fait faire
   l'addition au serveur, sans lecture préalable ni course entre deux
   répondants simultanés.

   À dire franchement : quelqu'un de déterminé peut répéter l'appel et
   gonfler le compte d'une unité à la fois. C'est un ordre de grandeur, pas
   une mesure d'audience. Sans serveur à nous, il ne peut pas en être
   autrement — et pour savoir si un questionnaire a été fait dix fois ou
   trois cents, l'ordre de grandeur suffit.

   Rien de personnel n'est écrit : ni qui, ni quand, ni depuis où. Deux
   nombres, et c'est tout.                                              */

const INCR = { '.sv': { increment: 1 } };

async function incrementer(espace, quizId, corps) {
  if (!espace || !quizId) return;
  const url = `${DB}/espaces/${encodeURIComponent(espace)}/stats/${encodeURIComponent(quizId)}.json`;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
  } catch {
    /* Un compteur qui échoue ne doit rien casser : le répondant est en
       train de répondre, c'est ce qui compte. */
  }
}

/* Un parcours commencé. Sans lui, on comptait les arrivées sans compter
   les départs : le taux d'achèvement — le seul chiffre qui dise si un
   questionnaire est trop long, ou si sa couverture ne donne pas envie —
   était inconnaissable. Même écriture anonyme, même règle d'incrément,
   même absence de donnée personnelle : un nombre de plus. */
export async function compterDebut(espace, quizId) {
  return incrementer(espace, quizId, { debuts: INCR });
}

/* Realtime Database interdit ces caractères dans une clé. Un identifiant de
   profil qui en contient — un JSON importé à la main, `normalize()` accepte
   n'importe quelle chaîne — ferait échouer le lot entier. */
const CLE_INVALIDE = /[.$#[\]\/]/;

export async function compterParcours(espace, quizId, resultId) {
  const corps = { total: INCR };
  /* `profils/<id>` en clé, et NON `{ profils: { <id>: … } }`. Un PATCH traite
     ses clés de premier niveau comme des CHEMINS et un objet imbriqué comme
     une valeur entière : la seconde forme visait `stats/<quiz>/profils`, qui
     n'a aucune règle d'écriture — seul `$profil` en a une. Le chemin était
     refusé, et comme un PATCH est atomique, `total` tombait avec lui. Le
     taux d'achèvement ne comptait donc rien, en silence : `incrementer` ne
     rattrape que le rejet réseau, pas une réponse d'erreur. Elle écrasait au
     passage les compteurs de tous les autres profils.

     Si l'identifiant ne peut pas être une clé, on compte le parcours sans le
     profil plutôt que de ne rien compter du tout. */
  if (resultId && !CLE_INVALIDE.test(resultId)) corps[`profils/${resultId}`] = INCR;
  return incrementer(espace, quizId, corps);
}

export async function stats(espace) {
  if (!espace) return {};
  return (await call(branche(espace, 'stats')).catch(() => null)) || {};
}

/* --- Profils ----------------------------------------------------------------
   Deux branches, et la séparation EST la protection.

   `profils` est lisible des seuls membres : l'équipe se reconnaît entre
   elle, et un refus de publication peut nommer quelqu'un sans exposer son
   identité au monde.

   `vitrines` est lisible de tous. Choisir de ne pas se montrer ne pose pas
   un drapeau que le client devrait honorer : la donnée n'y est simplement
   pas écrite. Un prénom, une photo et une fonction d'agent d'une structure
   publique, sur un site public, ne se confient pas à la bonne volonté
   d'un bout de JavaScript.                                              */

export async function monProfil(espace, uid) {
  const data = await call(branche(espace, 'profils', `/${encodeURIComponent(uid)}`)).catch(() => null);
  return data || null;
}

export async function profilsEquipe(espace) {
  return (await call(branche(espace, 'profils')).catch(() => null)) || {};
}

/* Effacer la fiche de quelqu'un qui n'est plus de l'équipe. La règle ne
   l'autorise QUE dans ce sens et QUE dans ce cas : un membre peut supprimer —
   jamais écrire — le profil d'un uid qui ne figure plus dans `membres`. Il
   faut donc retirer le droit AVANT d'appeler ceci, sans quoi la base refuse.

   Elle ne sert pas au ménage : elle sert à ce que quelqu'un qui part cesse
   d'être décrit dans un espace où il n'entre plus, et qu'il n'ait pas à le
   demander à une équipe dont il ne fait plus partie. */
export async function effacerProfil(espace, uid) {
  return call(branche(espace, 'profils', `/${encodeURIComponent(uid)}`), { method: 'DELETE' });
}

export async function enregistrerProfil(espace, uid, profil) {
  return call(branche(espace, 'profils', `/${encodeURIComponent(uid)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profil),
  });
}

/* Publier sa vitrine, ou la retirer. Retirer efface la branche : après
   coup, il ne reste rien à lire, pas même un drapeau à faux. */
export async function publierVitrine(espace, uid, vitrine) {
  const url = branche(espace, 'vitrines', `/${encodeURIComponent(uid)}`);
  if (!vitrine) return call(url, { method: 'DELETE' });
  return call(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vitrine),
  });
}

/* Les vitrines se lisent sans compte : c'est le parcours public qui les
   affiche. On passe donc par un fetch nu, sans jeton. */
export async function vitrines(espace) {
  if (!espace) return {};
  try {
    const response = await fetch(branche(espace, 'vitrines'));
    if (!response.ok) return {};
    const brut = (await response.json()) || {};
    /* À la lecture comme à l'écriture : c'était la seule branche externe du
       produit qui n'avait pas de poste-frontière. Une vitrine qui ne passe
       pas le filtre est jetée, pas réparée à moitié. */
    return Object.fromEntries(
      Object.entries(brut)
        .map(([uid, v]) => [uid, normaliserVitrine(v)])
        .filter(([, v]) => v),
    );
  } catch {
    return {};
  }
}

/* --- L'identité de l'espace --------------------------------------------------
   Lue sans compte : c'est le kiosque public qui l'affiche, et il n'en a
   pas. Écrite par les membres. Effacer la branche rend au kiosque son
   apparence par défaut — il n'y a pas de « désactiver », il y a « rien ».
   Même raisonnement que les vitrines : ce qui n'est pas écrit ne peut pas
   être mal lu.                                                          */

export async function identite(espace) {
  if (!espace) return null;
  try {
    const response = await fetch(branche(espace, 'identite'));
    if (!response.ok) return null;
    return (await response.json()) || null;
  } catch {
    /* Base injoignable : le kiosque garde son apparence par défaut plutôt
       que de ne pas s'afficher. */
    return null;
  }
}

export async function enregistrerIdentite(espace, valeurs) {
  const url = branche(espace, 'identite');
  if (!valeurs) return call(url, { method: 'DELETE' });
  return call(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(valeurs),
  });
}

/* --- La présentation du kiosque ----------------------------------------------
   Lue sans compte, comme l'identité : c'est le kiosque public qui s'en sert.
   Écrite par les membres. Une branche absente vaut « ordre alphabétique,
   rien de masqué » — le comportement d'avant, qui reste le défaut. */

export async function presentation(espace) {
  if (!espace) return null;
  try {
    const response = await fetch(branche(espace, 'presentation'));
    if (!response.ok) return null;
    return (await response.json()) || null;
  } catch {
    return null;
  }
}

export async function enregistrerPresentation(espace, corps) {
  const url = branche(espace, 'presentation');
  if (!corps) return call(url, { method: 'DELETE' });
  return call(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
}

/* --- La corbeille -------------------------------------------------------------
   Retirer de l'espace ne détruit plus : cela déplace. Le dépôt s'avouait
   démuni sur ce point — « une suppression dans un espace est définitive, et
   rien ne la rattrape » — alors que le produit entier repose sur la loi
   inverse : rien ne demande confirmation, tout s'annule.

   Sans serveur, personne ne fait le ménage à minuit : la corbeille est
   donc bornée à l'écriture, et le plus ancien sort quand le plafond est
   atteint. Une expiration promise que rien n'exécuterait vaudrait moins
   que ce plafond visible.                                               */

const CORBEILLE_MAX = 20;

export async function corbeille(espace) {
  const data = await call(branche(espace, 'corbeille')).catch(() => null);
  return Object.values(data || {}).sort((a, b) => (b.supprimeLe || 0) - (a.supprimeLe || 0));
}

function ligneCorbeille(espace, id) {
  return branche(espace, 'corbeille', `/${encodeURIComponent(id)}`);
}

export async function viderCorbeille(espace) {
  return call(branche(espace, 'corbeille'), { method: 'DELETE' });
}

export async function jeterDefinitivement(espace, id) {
  return call(ligneCorbeille(espace, id), { method: 'DELETE' });
}

/* Remettre en ligne. La règle de révision accepte le retour : la branche
   `quizzes` n'a plus ce questionnaire, donc `data` n'existe pas, et c'est
   le premier terme de la validation qui s'applique — une révision
   supérieure ou égale à 1 suffit. */
export async function restaurerQuiz(espace, id) {
  const items = await corbeille(espace);
  const trouve = items.find((q) => q.id === id);
  if (!trouve) throw new Error('Ce questionnaire n’est plus dans la corbeille.');
  const { supprimeLe, supprimePar, ...quiz } = trouve;
  /* `updatedBy` reprend celui qui restaure, pas celui qui avait publié.
     La règle l'exige — `quizzes/$quiz/updatedBy` valide
     `newData.val() === auth.uid` — et rendre la ligne telle quelle faisait
     donc échouer la restauration pour tout le monde sauf le dernier
     publieur : c'est-à-dire précisément dans le cas qui justifie une
     corbeille, quand ce n'est pas la même personne qui a publié et qui a
     retiré, ou quand celle qui a publié est partie. Le message affiché
     parlait alors d'appartenance à l'espace, ce qui envoyait chercher au
     mauvais endroit.

     C'est aussi ce que la ligne doit dire : restaurer est une publication,
     faite par quelqu'un, un jour donné. `updatedAt` suit, sans quoi le rail
     afficherait un nom et une date qui ne décrivent pas le même geste. */
  const auth = session();
  await call(path(espace, `/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...quiz,
      rev: Math.max(1, Number(quiz.rev) || 1),
      updatedBy: auth?.uid || quiz.updatedBy || '',
      updatedAt: Date.now(),
    }),
  });
  await jeterDefinitivement(espace, id);
  return quiz;
}

/* --- Membres ---------------------------------------------------------------
   La liste qui donne le droit de publier. Lisible des seuls membres, et
   modifiable par eux — sauf pour un gérant, que les règles protègent :
   sans cette exception, un seul membre pourrait verrouiller tout le monde
   dehors, propriétaire compris.                                         */

function branche(espace, nom, rest = '') {
  return `${DB}/espaces/${encodeURIComponent(espace)}/${nom}${rest}.json`;
}

/* La lecture de `membres` REMONTE son erreur, au lieu de rendre une liste
   vide. Les deux cas se ressemblaient et ne veulent pas dire la même chose :
   une liste vide décrit une équipe, un refus décrit quelqu'un qui n'est pas
   encore de la maison. Confondre les deux faisait dire au backoffice « tu es
   bien membre » à qui ne l'était pas. `gerants` reste tolérant : son absence
   ne coûte qu'une couronne à côté d'un nom.                             */
export async function membres(espace) {
  const [liste, gerants] = await Promise.all([
    call(branche(espace, 'membres')),
    call(branche(espace, 'gerants')).catch(() => null),
  ]);
  const proteges = new Set(Object.keys(gerants || {}));
  return Object.keys(liste || {}).map((uid) => ({ uid, gerant: proteges.has(uid) }));
}

export async function ajouterMembre(espace, uid) {
  return call(branche(espace, 'membres', `/${encodeURIComponent(uid)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: 'true',
  });
}

export async function retirerMembre(espace, uid) {
  return call(branche(espace, 'membres', `/${encodeURIComponent(uid)}`), { method: 'DELETE' });
}

/* --- Les deux portes -------------------------------------------------------
   Jusqu'ici, inviter quelqu'un qui avait DÉJÀ un compte demandait son
   identifiant — une chaîne de vingt-huit caractères, à lui réclamer par un
   autre canal, à recopier sans faute. Une invitation ne devrait pas coûter
   ça.

   Deux portes, donc, et elles ne s'ouvrent pas dans le même sens :

     invitations  l'équipe pose une adresse, la personne se sert. C'est
                  l'équipe qui décide, la personne n'a qu'à venir.

     attente      la personne se signale, l'équipe valide. C'est la
                  personne qui demande, l'équipe qui décide.

   Ce qui tient l'ensemble, c'est `email_verified`. N'importe qui peut créer
   un compte Firebase avec n'importe quelle adresse : sans cette
   vérification, poser une invitation pour « direction@mediatheque.fr »
   reviendrait à laisser entrer le premier qui aurait l'idée de s'inscrire
   sous ce nom. La règle l'exige, et c'est elle qui fait la différence entre
   une invitation et une porte ouverte.

   Et « à valider » vit dans sa PROPRE branche, pas comme une valeur dans
   `membres` : toutes les règles de l'espace testent `membres/<uid>.exists()`.
   Un compte en attente rangé dans `membres` existerait — donc publierait.
   La séparation n'est pas du rangement, c'est le contrôle lui-même.     */

/* Une clé Realtime Database ne peut pas contenir de point ; l'adresse en est
   pleine. La règle fait la même substitution de son côté — les deux calculs
   doivent rester d'accord, c'est pourquoi il n'y en a qu'un ici.        */
export function clefCourriel(email) {
  return String(email || '').trim().toLowerCase().replace(/\./g, ',');
}

/* Le jeton d'identité PORTE déjà `email_verified` — c'est exactement le
   champ que lit la règle. Le décoder coûte moins qu'un aller-retour vers
   `accounts:lookup`, et surtout on lit ce que la base lira, pas une
   réponse d'une autre requête qui pourrait diverger. La signature n'est pas
   vérifiée, et n'a pas à l'être : on ne s'accorde aucun droit ici, on
   prépare seulement un message juste pour la personne. C'est la base qui
   tranche.                                                              */
function charge(jeton) {
  try {
    const b64 = jeton.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const octets = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(octets));
  } catch {
    return null;
  }
}

export async function courrielVerifie() {
  const jeton = await token();
  if (!jeton) return false;
  return charge(jeton)?.email_verified === true;
}

export async function envoyerCourrielVerification() {
  const idToken = await token();
  if (!idToken) throw new Error('Il faut être connecté.');
  return appelIdentityToolkit(OOB, { requestType: 'VERIFY_EMAIL', idToken });
}

export async function invitations(espace) {
  return (await call(branche(espace, 'invitations')).catch(() => null)) || {};
}

export async function inviterParCourriel(espace, email, par) {
  return call(branche(espace, 'invitations', `/${encodeURIComponent(clefCourriel(email))}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ par, le: Date.now() }),
  });
}

export async function annulerInvitation(espace, email) {
  return call(branche(espace, 'invitations', `/${encodeURIComponent(clefCourriel(email))}`), { method: 'DELETE' });
}

/* Ma propre invitation. La règle n'autorise cette lecture qu'à qui porte
   l'adresse et l'a vérifiée : un refus n'est donc pas une panne, c'est la
   réponse « rien pour toi ». */
export async function monInvitation(espace, email) {
  if (!espace || !email) return null;
  return call(branche(espace, 'invitations', `/${encodeURIComponent(clefCourriel(email))}`)).catch(() => null);
}

export async function demanderAcces(espace, uid, corps) {
  return call(branche(espace, 'attente', `/${encodeURIComponent(uid)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...corps, le: Date.now() }),
  });
}

export async function demandes(espace) {
  return (await call(branche(espace, 'attente')).catch(() => null)) || {};
}

export async function maDemande(espace, uid) {
  if (!espace || !uid) return null;
  return call(branche(espace, 'attente', `/${encodeURIComponent(uid)}`)).catch(() => null);
}

export async function retirerDemande(espace, uid) {
  return call(branche(espace, 'attente', `/${encodeURIComponent(uid)}`), { method: 'DELETE' });
}

function path(espace, rest = '') {
  return `${DB}/espaces/${encodeURIComponent(espace)}/quizzes${rest}.json`;
}

/* --- Comment le jeton voyage ----------------------------------------------
   En PARAMÈTRE `?auth=`, et non dans un en-tête `Authorization: Bearer`.
   Ce n'est pas un choix de confort : c'est le seul mode que l'API REST de
   Realtime Database accepte pour un jeton d'identité Firebase.

   Elle reconnaît deux authentifications, et elles ne sont pas
   interchangeables :

     ?auth=<jeton d'identité>          → celui que produit signInWithPassword
     Authorization: Bearer <jeton>     → un jeton d'ACCÈS OAuth2, celui d'un
                                          compte de service

   Une version précédente envoyait le jeton d'identité dans l'en-tête Bearer,
   pour fermer une fuite réelle — une query finit dans les journaux. La base
   tentait alors de le lire comme un jeton OAuth2, échouait, et répondait
   `"Unauthorized request."` — et non `"Permission denied"`, puisque les
   règles n'étaient jamais atteintes. AUCUNE REQUÊTE AUTHENTIFIÉE NE
   FONCTIONNAIT : ni lire les membres, ni publier, ni enregistrer une
   identité, une vitrine ou une corbeille.

   Le défaut avait survécu parce qu'il avait été éprouvé avec un jeton
   VOLONTAIREMENT INVALIDE — cas où les deux modes échouent pareil, et où
   rien ne pouvait donc le révéler. Mesuré le 1er septembre 2026, même
   jeton, même URL, même seconde :

     A) en-tête Bearer → 401  { "error": "Unauthorized request." }
     B) ?auth=         → 200  la liste des membres

   LE COÛT EST ASSUMÉ. Le jeton reparaît dans l'adresse, donc dans les
   journaux de la base. Il n'entre pas dans l'historique du navigateur — ce
   sont des `fetch`, pas des navigations — ni dans un `Referer` vers un
   tiers. Et il expire en une heure. Un espace partagé qui ne fonctionne
   pas du tout coûte plus cher que cette exposition-là, et l'API ne laisse
   pas d'autre porte à une application sans serveur.

   Effet de bord, dans le bon sens cette fois : `?auth=<périmé>` est IGNORÉ
   plutôt que rejeté, donc une lecture publique passe malgré un jeton mort.
   La résilience que l'en-tête avait fait perdre revient d'elle-même.    */

function avecJeton(url, jeton) {
  if (!jeton) return url;
  return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(jeton)}`;
}

function estUneLecture(options) {
  const methode = (options.method || 'GET').toUpperCase();
  return methode === 'GET';
}

/* La base répond 401 pour deux choses différentes, et le corps les
   distingue. On ne jette le jeton que quand c'est LUI qui est refusé :
   sur un refus de règle, il est parfaitement valide, et l'effacer
   provoquait un renouvellement inutile à chaque tentative. */
function jetonRefuse(corps) {
  return !/permission denied/i.test(corps || '');
}

async function call(url, options = {}) {
  const auth = await token();
  const envoyer = (jeton) => fetch(avecJeton(url, jeton), options);

  let response = await envoyer(auth);
  let corps = '';

  if (response.status === 401) {
    corps = await response.clone().text().catch(() => '');

    if (auth && jetonRefuse(corps)) {
      /* Le jeton est suspect : on le retire du cache pour forcer un
         renouvellement au prochain appel, sans toucher au renouvellement
         lui-même — la personne reste connectée. */
      const saved = store.getRemote();
      if (saved) store.setRemote({ ...saved, idToken: null, expiresAt: 0 });
      /* Une LECTURE refusée est retentée sans jeton : si la branche est
         publique, elle répond, et c'était bien le jeton le fautif. Une
         ÉCRITURE refusée reste refusée — là il faut vraiment un compte, et
         réessayer sans en serait un mensonge. */
      if (estUneLecture(options)) {
        response = await envoyer(null);
        if (response.status === 401) corps = await response.clone().text().catch(() => '');
      }
    }
  }

  /* Un 401 a DEUX causes, et ce message n'en affirmait qu'une.
     ARCHITECTURE.md le notait déjà : « un jeton invalide mais non expiré
     fait échouer même les lectures publiques, et le message parle alors
     d'appartenance à l'espace au lieu de dire la vérité ».

     La base ne dit pas laquelle : elle renvoie le même 401 pour « tu n'es
     pas membre » et pour « ton jeton ne vaut plus rien ». On ne devine
     donc pas — on nomme les deux, et on affiche l'identifiant que cette
     session utilise RÉELLEMENT. C'est lui qu'il faut comparer à la branche
     `membres`, et un message qui l'affiche épargne une heure de recherche
     à côté de la plaque : croire que l'UID est le bon parce qu'il n'a pas
     changé dans les données ne dit rien de celui que le jeton porte. */
  if (response.status === 401) {
    if (!auth) throw new Error('Il faut être connecté pour cela.');
    const session = store.getRemote();
    const qui = session?.email ? `${session.email} — identifiant ${session.uid}` : `identifiant ${session?.uid}`;
    /* Le corps distingue les deux refus, et il n'y a plus lieu de deviner :
       « Permission denied » vient des règles, donc de l'appartenance ;
       « Unauthorized request. » vient du jeton lui-même. */
    const err = new Error(jetonRefuse(corps)
      ? `La base n’a pas accepté la session de ${qui}. Reconnecte-toi.`
      : `Refusé par les règles pour ${qui}. Ce compte ne figure pas dans les membres de cet espace, `
        + 'ou la règle interdit cette écriture.');
    /* La base a répondu, et elle a dit non. À distinguer d'un appel qui
       n'aboutit pas : « tu n'es pas membre » et « le réseau est tombé » se
       ressemblent depuis l'appelant, et se disent très différemment à
       quelqu'un qui attend d'entrer. */
    err.refus = true;
    err.regles = !jetonRefuse(corps);
    throw err;
  }
  if (!response.ok) throw new Error(`La base a répondu ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

/* La lecture est ouverte à tous : c'est ce qui permet à n'importe qui de
   répondre sans compte. Une branche vide répond `null`, pas une erreur. */
export async function loadSpace(espace) {
  const data = await call(path(espace));
  return data ? Object.values(data) : [];
}

/* --- Le garde-fou contre l'écrasement -------------------------------------
   Publier envoie `rev + 1`, et la règle de la base exige que ce soit
   exactement le suivant. Deux personnes parties de la même version ne
   peuvent donc pas publier l'une après l'autre : la seconde est refusée
   par la BASE, pas par notre politesse — ce qui protège même d'un défaut
   de notre côté. Le raisonnement complet est dans ARCHITECTURE.md,
   § « Le garde-fou contre l'écrasement ».                              */

export class ConflitError extends Error {
  constructor(distant) {
    super('Ce questionnaire a été modifié depuis que tu l’as ouvert.');
    this.name = 'ConflitError';
    this.distant = distant;
  }
}

async function lireQuiz(espace, id) {
  const url = `${DB}/espaces/${encodeURIComponent(espace)}/quizzes/${encodeURIComponent(id)}.json`;
  const response = await fetch(url);
  return response.ok ? response.json() : null;
}

export async function saveQuiz(espace, quiz) {
  const { source, file, ...clean } = quiz;
  const auth = session();
  const corps = {
    ...clean,
    rev: (Number(quiz.rev) || 0) + 1,
    updatedBy: auth?.uid || '',
    updatedAt: Date.now(),
  };

  try {
    await call(path(espace, `/${encodeURIComponent(quiz.id)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
    return corps.rev;
  } catch (err) {
    /* La base renvoie le même 401 pour « tu n'es pas membre » et pour
       « ta révision n'est pas la suivante ». On ne devine pas d'après le
       message : on relit, et c'est la version distante qui tranche. */
    const distant = await lireQuiz(espace, quiz.id);
    if (distant && (Number(distant.rev) || 0) !== (Number(quiz.rev) || 0)) {
      throw new ConflitError(distant);
    }
    throw err;
  }
}

/* Une règle qu'on croit posée et qui ne l'est pas ne se voit pas. On tente
   donc une écriture qui DOIT être refusée : réécrire `rev` à sa valeur
   actuelle. Si elle passe, la règle est absente — et rien n'est abîmé,
   puisqu'on a réécrit la même valeur.                                   */
export async function guardActive(espace, quiz) {
  if (!quiz || !session()) return null;
  try {
    await call(path(espace, `/${encodeURIComponent(quiz.id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: Number(quiz.rev) || 0 }),
    });
    return false;   // acceptée : la règle n'est pas en place
  } catch {
    return true;    // refusée : la règle fait son travail
  }
}

/* Retirer de l'espace : on dépose dans la corbeille AVANT d'effacer. Si le
   dépôt échoue, on n'efface pas — perdre le questionnaire en croyant le
   ranger serait exactement le défaut qu'on corrige. */
export async function deleteQuiz(espace, id) {
  const distant = await lireQuiz(espace, id);
  if (distant) {
    const auth = session();
    await call(ligneCorbeille(espace, id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...distant, supprimeLe: Date.now(), supprimePar: auth?.uid || '' }),
    });
    await elaguerCorbeille(espace);
  }
  return call(path(espace, `/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

/* Le plafond, appliqué après chaque dépôt. Un échec ici ne doit rien
   casser : la corbeille sera simplement plus longue que prévu. */
async function elaguerCorbeille(espace) {
  try {
    const items = await corbeille(espace);
    for (const vieux of items.slice(CORBEILLE_MAX)) {
      await jeterDefinitivement(espace, vieux.id);
    }
  } catch { /* tant pis : mieux vaut une corbeille trop longue que vide */ }
}
