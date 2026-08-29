/* ==========================================================================
   share.js — un questionnaire entier tient dans une URL.
   C'est ce qui remplace le serveur : on peut envoyer un questionnaire à
   quelqu'un sans rien déployer. Le JSON est gzippé quand le navigateur
   sait le faire (CompressionStream), sinon encodé tel quel — le préfixe
   dit lequel des deux, pour que les liens restent lisibles par tous.
   ========================================================================== */

const GZIP = 'z';   // gzip + base64url
const PLAIN = 'p';  // base64url seul

const canCompress = typeof CompressionStream === 'function'
                 && typeof DecompressionStream === 'function';

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

/* Le questionnaire est allégé avant encodage : les champs vides et les
   scores nuls ne voyagent pas. normalize() les reconstruira à l'arrivée. */
function slim(quiz) {
  return {
    ...quiz,
    updatedAt: undefined,
    image: quiz.image || undefined,
    questions: quiz.questions.map((q) => ({
      ...q,
      hint: q.hint || undefined,
      image: q.image || undefined,
      options: q.options.map((o) => ({
        ...o,
        emoji: o.emoji || undefined,
        image: o.image || undefined,
        scores: Object.fromEntries(Object.entries(o.scores).filter(([, v]) => v !== 0)),
      })),
    })),
    results: quiz.results.map((r) => ({
      ...r,
      subtitle: r.subtitle || undefined,
      emoji: r.emoji || undefined,
      image: r.image || undefined,
      recos: r.recos.map((c) => ({
        ...c,
        creator: c.creator || undefined,
        year: c.year || undefined,
        note: c.note || undefined,
        link: c.link || undefined,
        image: c.image || undefined,
        location: c.location || undefined,
      })),
    })),
  };
}

export async function encode(quiz) {
  const json = JSON.stringify(slim(quiz));
  const bytes = new TextEncoder().encode(json);
  if (!canCompress) return PLAIN + toBase64Url(bytes);
  const gzipped = await pipe(bytes, new CompressionStream('gzip'));
  return GZIP + toBase64Url(gzipped);
}

export async function decode(payload) {
  const kind = payload.slice(0, 1);
  const body = fromBase64Url(payload.slice(1));
  if (kind === GZIP) {
    if (!canCompress) throw new Error('Ce navigateur ne sait pas lire les liens compressés.');
    const plain = await pipe(body, new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  if (kind === PLAIN) return JSON.parse(new TextDecoder().decode(body));
  throw new Error('Lien de questionnaire non reconnu.');
}

/* L'URL complète du parcours pour un questionnaire porté par le lien. */
export async function linkFor(quiz, page = 'quiz.html') {
  const base = new URL(page, location.href);
  base.hash = 'k=' + (await encode(quiz));
  return base.toString();
}

/* Lit un questionnaire depuis le fragment courant, s'il y en a un.
   Le fragment (et non la query) : il ne part jamais au serveur, et il
   ne finit pas dans les journaux d'un hébergeur.                       */
export function payloadFromHash(hash = location.hash) {
  const match = /(?:^|[#&])k=([A-Za-z0-9\-_]+)/.exec(hash || '');
  return match ? match[1] : null;
}
