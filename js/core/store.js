/* ==========================================================================
   store.js — le SEUL accès à localStorage du projet.
   Loi : aucun autre module ne touche localStorage. Le format des clés
   appartient à ce fichier seul. La dérive de schéma silencieuse est le
   mode de panne le plus coûteux ; il n'y a qu'une porte d'entrée.
   ========================================================================== */

const PREFIX = 'recohero.v1.';

const KEY = {
  drafts:  PREFIX + 'drafts',   // { [quizId]: quiz }  — les brouillons du backoffice
  results: PREFIX + 'results',  // [ resultEntry ]     — l'historique de réponses
  session: PREFIX + 'session',  // { [quizId]: { answers, at } } — parcours en cours
  unlock:  PREFIX + 'unlock',   // horodatage du déverrouillage du backoffice
};

const MAX_RESULTS = 60;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (err) {
    console.warn('[store] lecture illisible, valeur ignorée :', key, err);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('[store] écriture refusée :', key, err);
    return false;
  }
}

/* --- Brouillons ---------------------------------------------------------- */

export function allDrafts() {
  const map = read(KEY.drafts, {});
  return Object.values(map).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getDraft(id) {
  return read(KEY.drafts, {})[id] || null;
}

export function saveDraft(quiz) {
  const map = read(KEY.drafts, {});
  map[quiz.id] = { ...quiz, updatedAt: Date.now() };
  return write(KEY.drafts, map) ? map[quiz.id] : null;
}

export function deleteDraft(id) {
  const map = read(KEY.drafts, {});
  delete map[id];
  write(KEY.drafts, map);
}

/* --- Historique de résultats --------------------------------------------- */

export function allResults() {
  return read(KEY.results, []);
}

export function addResult(entry) {
  const list = read(KEY.results, []);
  list.unshift({ ...entry, at: Date.now() });
  write(KEY.results, list.slice(0, MAX_RESULTS));
}

export function clearResults() {
  write(KEY.results, []);
}

/* --- Parcours en cours ---------------------------------------------------- */

export function getSession(quizId) {
  return read(KEY.session, {})[quizId] || null;
}

export function saveSession(quizId, answers) {
  const map = read(KEY.session, {});
  map[quizId] = { answers, at: Date.now() };
  write(KEY.session, map);
}

export function clearSession(quizId) {
  const map = read(KEY.session, {});
  delete map[quizId];
  write(KEY.session, map);
}

/* --- Déverrouillage du backoffice -----------------------------------------
   Purement cosmétique : sans serveur, rien de secret n'est protégé.
   Cela évite seulement d'ouvrir le backoffice par accident.               */

export function isUnlocked(ttlMs) {
  const at = read(KEY.unlock, 0);
  return typeof at === 'number' && Date.now() - at < ttlMs;
}

export function setUnlocked() { write(KEY.unlock, Date.now()); }
export function lock() { write(KEY.unlock, 0); }
