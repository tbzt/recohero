/* ==========================================================================
   catalog.js — d'où viennent les questionnaires.
   Quatre sources, dans cet ordre de priorité :
     1. le lien   — un questionnaire porté par le fragment d'URL (#k=…)
     2. l'espace  — une base partagée, quand l'adresse porte ?espace=…
     3. le local  — les brouillons du backoffice, dans ce navigateur
     4. l'exemple — quizzes/, servi par le dépôt

   La quatrième n'est plus une voie de publication. Le dépôt a longtemps
   servi de canal — on y déposait un .json, une action reconstruisait
   l'index — mais ce chemin demandait un accès git que les gens à qui ce
   projet s'adresse n'ont pas. Les espaces l'ont remplacé. Il ne reste au
   dépôt qu'un questionnaire d'exemple, pour que le kiosque ne soit pas
   vide au premier abord.
   ========================================================================== */

import { normalize } from './schema.js';
import * as store from './store.js';
import * as remote from './remote.js';
import { decode, payloadFromHash } from './share.js';

const FOLDER = 'quizzes/';

let published = null; // l'index ne bouge pas pendant une visite

/* Le questionnaire d'exemple, servi en fichiers statiques. Rien ne
   régénère plus quizzes/index.json : il est écrit à la main, une fois,
   parce qu'il ne contient qu'une ligne.                                */
export async function loadPublished() {
  if (published) return published;

  try {
    const response = await fetch(`${FOLDER}index.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`index.json : HTTP ${response.status}`);
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('index.json doit contenir un tableau.');

    const loaded = await Promise.all(list.map(async (entry) => {
      const file = typeof entry === 'string' ? entry : entry.file;
      if (!file) return null;
      try {
        const res = await fetch(`${FOLDER}${file}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const quiz = normalize(await res.json());
        return { ...quiz, source: 'published', file };
      } catch (err) {
        console.warn(`[catalog] questionnaire ignoré (${FOLDER}${file}) :`, err.message);
        return null;
      }
    }));

    published = loaded.filter(Boolean);
  } catch (err) {
    /* Pas d'index, ou ouvert en file:// — ce n'est pas une erreur fatale :
       les liens, les brouillons locaux et les espaces continuent de
       fonctionner.                                                     */
    console.info('[catalog] aucun questionnaire d’exemple :', err.message);
    published = [];
  }
  return published;
}

/* --- L'espace partagé ----------------------------------------------------
   La cinquième source, et la seule qui parle à un serveur. Elle n'existe
   que si l'adresse nomme un espace : sans ?espace=…, rien n'est demandé à
   personne et le kiosque reste exactement ce qu'il était.

   Un espace injoignable — réseau coupé, base fermée, nom inconnu — n'est
   pas une erreur fatale : on le signale dans la console et on rend une
   liste vide. Le dépôt et les brouillons locaux continuent de servir. */

let espaceMemo = { name: null, list: null };

export async function loadEspace(espace) {
  if (!espace || !remote.configured()) return [];
  if (espaceMemo.name === espace) return espaceMemo.list;

  let list = [];
  try {
    list = (await remote.loadSpace(espace))
      .map((raw) => {
        try { return { ...normalize(raw), source: 'remote' }; } catch { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    console.info(`[catalog] espace « ${espace} » injoignable :`, err.message);
  }
  espaceMemo = { name: espace, list };
  return list;
}

/* Après une écriture, la mémoïsation ment : le prochain chargement doit
   repartir du serveur. */
export function forgetEspace() { espaceMemo = { name: null, list: null }; }

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
   existe déjà ailleurs est masqué : la source distante ou le dépôt fait foi
   une fois publié. L'étagère `shared` est absente de cette liste, et c'est
   sa raison d'être : partager un questionnaire et le publier redeviennent
   deux gestes.

   Avec ?espace=…, le kiosque est celui de cet espace et de lui seul :
   ni les questionnaires du dépôt, ni les brouillons locaux. C'est ce que
   « chacun son kiosque » veut dire — une médiathèque montre son catalogue,
   pas le nôtre.

   L'absence des brouillons locaux n'est pas un oubli, c'est la condition
   pour que la page soit vérifiable : celle qui publie doit voir exactement
   ce que verra le visiteur, sinon elle ne peut pas relire son propre
   kiosque avant de le diffuser.                                        */
export async function loadAll({ espace = null } = {}) {
  if (espace) return loadEspace(espace);

  const [pub, drafts] = [await loadPublished(), loadDrafts()];
  const publishedIds = new Set(pub.map((q) => q.id));
  return [...pub, ...drafts.filter((d) => !publishedIds.has(d.id))];
}

/* Résolution d'un questionnaire à jouer : lien d'abord, puis identifiant.
   L'espace passe avant le dépôt : si l'adresse en nomme un, c'est son
   catalogue qu'on consulte. */
export async function resolveQuiz({ id = null, espace = null } = {}) {
  const fromLink = await loadFromHash();
  if (fromLink) return fromLink;
  if (!id) return null;

  const draft = store.getDraft(id);
  if (draft) return { ...normalize(draft), source: 'draft' };

  if (espace) {
    const found = (await loadEspace(espace)).find((q) => q.id === id);
    if (found) return found;
  }

  const pub = await loadPublished();
  return pub.find((q) => q.id === id) || null;
}
