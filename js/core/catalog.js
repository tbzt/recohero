/* ==========================================================================
   catalog.js — d'où viennent les questionnaires.
   Quatre sources, dans cet ordre de priorité :
     1. le lien    — un questionnaire porté par le fragment d'URL (#k=…)
     2. le dépôt   — les fichiers de quizzes/, listés par quizzes/index.json
     3. le local   — les brouillons du backoffice, dans ce navigateur
     4. l'étagère  — les brouillons partagés de quizzes/wip/

   La quatrième est réservée au backoffice, et c'est tout l'intérêt :
   déposer dans quizzes/ veut dire publier, et il n'existait aucun endroit
   du dépôt où deux personnes puissent se passer un questionnaire inachevé.
   Le sous-dossier en est un parce que le workflow d'indexation ne descend
   pas dedans (`find -maxdepth 1`) : rien de ce qui s'y trouve n'atteint
   quizzes/index.json, donc jamais le kiosque.

   Ce n'est pas une cachette pour autant. Les fichiers restent servis par
   l'hébergeur, donc lisibles de qui va les chercher : l'étagère décide de
   ce qui est *montré*, pas de ce qui est accessible. Sans serveur, il ne
   peut pas en être autrement — une étagère que le navigateur sait lire est
   une étagère publique.
   ========================================================================== */

import { normalize } from './schema.js';
import * as store from './store.js';
import { decode, payloadFromHash } from './share.js';

/* Chaque étagère est un dossier et son index. Les deux se lisent pareil :
   une seule fonction, deux appels.                                      */
const SHELVES = {
  published: 'quizzes/',
  shared:    'quizzes/wip/',
};

const memo = { published: null, shared: null }; // l'index ne bouge pas pendant une visite

async function loadShelf(source) {
  if (memo[source]) return memo[source];
  const folder = SHELVES[source];

  try {
    const response = await fetch(`${folder}index.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`index.json : HTTP ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('index.json doit contenir un tableau.');

    const loaded = await Promise.all(list.map(async (entry) => {
      const file = typeof entry === 'string' ? entry : entry.file;
      if (!file) return null;
      try {
        const res = await fetch(`${folder}${file}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const quiz = normalize(await res.json());
        return { ...quiz, source, file };
      } catch (err) {
        console.warn(`[catalog] questionnaire ignoré (${folder}${file}) :`, err.message);
        return null;
      }
    }));

    memo[source] = loaded.filter(Boolean);
  } catch (err) {
    /* Pas d'index, ou ouvert en file:// — ce n'est pas une erreur fatale :
       les brouillons locaux et les liens continuent de fonctionner. Une
       étagère de brouillons absente est même le cas ordinaire.        */
    console.info(`[catalog] étagère « ${source} » vide :`, err.message);
    memo[source] = [];
  }
  return memo[source];
}

export function loadPublished() { return loadShelf('published'); }

/* Les brouillons partagés du dépôt. Le kiosque ne les voit jamais — ni par
   loadAll(), ni par resolveQuiz() : un identifiant deviné ne doit pas
   suffire à ouvrir un questionnaire que personne n'a décidé de publier. */
export function loadShared() { return loadShelf('shared'); }

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
   existe déjà en publié est masqué : le dépôt fait foi une fois publié.
   L'étagère `shared` est absente de cette liste, et c'est sa raison d'être :
   partager un questionnaire et le publier redeviennent deux gestes.     */
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
