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
  const response = await fetch(SIGN_IN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
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

async function identite(url, corps) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
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
  const data = await identite(SIGN_UP, {
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
  if (!continueUrl) return identite(OOB, base);

  try {
    return await identite(OOB, { ...base, continueUrl });
  } catch (err) {
    if (err.code !== 'UNAUTHORIZED_DOMAIN' && err.code !== 'INVALID_CONTINUE_URI') throw err;
    console.info('[remote] domaine non autorisé pour le retour : courriel envoyé sans redirection.');
    return identite(OOB, base);
  }
}

/* Changer son propre mot de passe. Firebase renvoie de nouveaux jetons :
   les ignorer déconnecterait la personne au renouvellement suivant. */
export async function changerMotDePasse(motDePasse) {
  const idToken = await token();
  if (!idToken) throw new Error('Il faut être connecté.');
  const data = await identite(UPDATE, { idToken, password: motDePasse, returnSecureToken: true });
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

export async function compterParcours(espace, quizId, resultId) {
  const corps = { total: INCR };
  if (resultId) corps.profils = { [resultId]: INCR };
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
    return (await response.json()) || {};
  } catch {
    return {};
  }
}

/* --- Membres ---------------------------------------------------------------
   La liste qui donne le droit de publier. Lisible des seuls membres, et
   modifiable par eux — sauf pour un gérant, que les règles protègent :
   sans cette exception, un seul membre pourrait verrouiller tout le monde
   dehors, propriétaire compris.                                         */

function branche(espace, nom, rest = '') {
  return `${DB}/espaces/${encodeURIComponent(espace)}/${nom}${rest}.json`;
}

export async function membres(espace) {
  const [liste, gerants] = await Promise.all([
    call(branche(espace, 'membres')).catch(() => null),
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

function path(espace, rest = '') {
  return `${DB}/espaces/${encodeURIComponent(espace)}/quizzes${rest}.json`;
}

/* Le jeton voyage en EN-TÊTE, pas en paramètre d'adresse. Une query string
   se retrouve dans l'historique du navigateur, dans les en-têtes `Referer`
   et dans les journaux de tout intermédiaire — exactement ce que share.js
   évite avec soin pour les questionnaires (« le fragment, et non la
   query »). Le même réflexe des deux côtés. */
async function call(url, options = {}) {
  const auth = await token();
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
  });
  if (response.status === 401) {
    throw new Error('Écriture refusée : ce compte n’est pas membre de cet espace.');
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

export async function deleteQuiz(espace, id) {
  return call(path(espace, `/${encodeURIComponent(id)}`), { method: 'DELETE' });
}
