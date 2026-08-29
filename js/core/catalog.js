/* ==========================================================================
   catalog.js — d'où viennent les questionnaires.
   Trois sources, dans cet ordre de priorité :
     1. le lien   — un questionnaire porté par le fragment d'URL (#k=…)
     2. le dépôt  — les fichiers de quizzes/, listés par quizzes/index.json
     3. le local  — les brouillons du backoffice, dans ce navigateur
   ========================================================================== */

import { normalize } from './schema.js';
import * as store from './store.js';
import { decode, payloadFromHash } from './share.js';

const INDEX_URL = 'quizzes/index.json';

let published = null; // mémoïsé : l'index ne bouge pas pendant une visite

export async function loadPublished() {
  if (published) return published;

  try {
    const response = await fetch(INDEX_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`index.json : HTTP ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('index.json doit contenir un tableau.');

    const loaded = await Promise.all(list.map(async (entry) => {
      const file = typeof entry === 'string' ? entry : entry.file;
      if (!file) return null;
      try {
        const res = await fetch(`quizzes/${file}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const quiz = normalize(await res.json());
        return { ...quiz, source: 'published', file };
      } catch (err) {
        console.warn(`[catalog] questionnaire ignoré (${file}) :`, err.message);
        return null;
      }
    }));

    published = loaded.filter(Boolean);
  } catch (err) {
    /* Pas d'index, ou ouvert en file:// — ce n'est pas une erreur fatale :
       les brouillons locaux et les liens continuent de fonctionner.    */
    console.info('[catalog] aucun questionnaire publié :', err.message);
    published = [];
  }
  return published;
}

export function loadDrafts() {
  return store.allDrafts().map((quiz) => {
    try {
      return { ...normalize(quiz), source: 'draft', updatedAt: quiz.updatedAt };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function loadFromHash() {
  const payload = payloadFromHash();
  if (!payload) return null;
  const quiz = normalize(await decode(payload));
  return { ...quiz, source: 'link' };
}

/* Le catalogue complet vu par le kiosque. Un brouillon dont l'identifiant
   existe déjà en publié est masqué : le dépôt fait foi une fois publié.  */
export async function loadAll() {
  const [pub, drafts] = [await loadPublished(), loadDrafts()];
  const publishedIds = new Set(pub.map((q) => q.id));
  return [...pub, ...drafts.filter((d) => !publishedIds.has(d.id))];
}

/* Résolution d'un questionnaire à jouer : lien d'abord, puis identifiant. */
export async function resolveQuiz({ id = null } = {}) {
  const fromLink = await loadFromHash();
  if (fromLink) return fromLink;
  if (!id) return null;

  const draft = store.getDraft(id);
  if (draft) return { ...normalize(draft), source: 'draft' };

  const pub = await loadPublished();
  return pub.find((q) => q.id === id) || null;
}
