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

function path(espace, rest = '') {
  return `${DB}/espaces/${encodeURIComponent(espace)}/quizzes${rest}.json`;
}

async function call(url, options = {}) {
  const auth = await token();
  const response = await fetch(auth ? `${url}?auth=${auth}` : url, options);
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

export async function saveQuiz(espace, quiz) {
  const { source, file, ...clean } = quiz;
  return call(path(espace, `/${encodeURIComponent(quiz.id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...clean, updatedAt: Date.now() }),
  });
}

export async function deleteQuiz(espace, id) {
  return call(path(espace, `/${encodeURIComponent(id)}`), { method: 'DELETE' });
}
