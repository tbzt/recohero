/* ==========================================================================
   card.js — la carte de résultat, dessinée sur un canvas.
   Ce n'est pas une capture d'écran : c'est une affiche composée pour être
   partagée, au format portrait 4:5. Aucune dépendance — le canvas sait
   déjà écrire du texte, et une bibliothèque de rasterisation du DOM
   coûterait plus cher que ces deux cents lignes.
   ========================================================================== */

import { encoder } from './qr.js';
import { dessinerQR } from './affiche.js';

const W = 1080;
const H = 1350;
const PAD = 88;

/* Le pied de carte : la marque du lieu, l'adresse du questionnaire et son QR.
   Il occupait 62 px quand il ne portait qu'une signature ; il en prend 224
   depuis qu'il porte de quoi refaire le parcours. Rien ne descend au-delà de
   cette ligne : un profil au titre long fait sauter des recommandations, il
   ne se superpose pas au pied. */
const PIED = 224;
const FLOOR = H - PAD - PIED;

/* Palette figée : l'image exportée ne doit pas dépendre du thème de celui
   qui l'a générée. Seul l'accent du questionnaire la traverse.          */
const PAPER = '#FBF7F1';
const INK = '#1B1613';
const MUTED = '#6A5F55';
const FAINT = '#A2968A';

const SERIF = '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, Palatino, "Liberation Serif", Georgia, serif';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const serif = (size, weight = 700, style = '') => `${style} ${weight} ${size}px ${SERIF}`.trim();
const sans = (size, weight = 400) => `${weight} ${size}px ${SANS}`;

function mix(hexA, hexB, ratio) {
  const parse = (hex) => {
    const v = hex.replace('#', '');
    const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const [a, b] = [parse(hexA), parse(hexB)];
  const out = a.map((chan, i) => Math.round(chan * ratio + b[i] * (1 - ratio)));
  return `rgb(${out.join(',')})`;
}

function wrap(ctx, text, maxWidth, maxLines = 4) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    if (words.join(' ') !== lines.join(' ')) lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function drawLines(ctx, lines, x, y, lineHeight) {
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Une image d'un autre domaine « teinte » le canvas et fait échouer
   `toBlob()` : la carte deviendrait impossible à exporter. Mais un serveur
   qui envoie les en-têtes CORS autorise explicitement la lecture de ses
   pixels — et là, le canvas n'est pas teinté.

   On tente donc, plutôt que de refuser d'avance. `crossOrigin` transforme
   la question en un pari sans risque : le serveur accepte et l'image
   s'affiche dans la carte ; il refuse et le chargement échoue, ce qui
   ramène exactement au comportement d'avant — l'emoji. Sans cet attribut,
   l'image se chargeait mais teintait le canvas, donc même les hébergeurs
   coopératifs étaient perdus.                                            */
function local(src) {
  if (src.startsWith('data:')) return true;
  try {
    return new URL(src, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    /* Jamais sur une image locale : `anonymous` y déclencherait un contrôle
       CORS que notre propre hébergeur n'a aucune raison de satisfaire. */
    if (!local(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* `identite` est celle de l'espace, `url` l'adresse où refaire le parcours.
   Les deux sont facultatives : un brouillon ouvert depuis un lien n'a ni
   l'une ni l'autre, et la carte doit rester juste sans elles. */
export async function renderResultCard(quiz, profile, scores, options = {}) {
  const { identite = null, url = '' } = options;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const accent = quiz.accent || '#C8452B';
  const deep = mix(accent, INK, 0.78);
  const soft = mix(accent, PAPER, 0.12);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 14);

  ctx.textBaseline = 'top';
  let y = PAD + 10;

  /* Le titre du questionnaire, en surtitre discret. */
  ctx.font = sans(26, 600);
  ctx.fillStyle = FAINT;
  ctx.letterSpacing = '3px';
  ctx.fillText(wrap(ctx, quiz.title.toUpperCase(), W - PAD * 2, 1)[0] || '', PAD, y);
  ctx.letterSpacing = '0px';
  y += 64;

  /* Le médaillon : l'illustration du profil si elle est dessinable,
     l'emoji sinon. */
  /* On tente toute image : `loadImage` rend `null` quand l'hébergeur refuse
     la lecture de ses pixels, et le médaillon retombe sur l'emoji. */
  const medallion = profile.image ? await loadImage(profile.image) : null;
  if (medallion) {
    const size = 240;
    ctx.save();
    roundRect(ctx, PAD, y, size, size, 28);
    ctx.clip();
    const scale = Math.max(size / medallion.width, size / medallion.height);
    const dw = medallion.width * scale;
    const dh = medallion.height * scale;
    ctx.drawImage(medallion, PAD + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    ctx.restore();
    y += size + 40;
  } else {
    ctx.font = `128px ${SANS}`;
    ctx.fillStyle = INK;
    ctx.fillText(quiz.emoji || '✦', PAD, y);
    y += 168;
  }

  /* Le nom du profil : la ligne que l'on partage. */
  ctx.font = serif(86);
  ctx.fillStyle = deep;
  y = drawLines(ctx, wrap(ctx, profile.title, W - PAD * 2, 3), PAD, y, 98) + 8;

  if (profile.subtitle && y + 68 <= FLOOR) {
    ctx.font = serif(38, 400, 'italic');
    ctx.fillStyle = MUTED;
    y = drawLines(ctx, wrap(ctx, profile.subtitle, W - PAD * 2, 2), PAD, y, 50) + 18;
  }

  /* La feuille de score : ce qui distingue ce questionnaire d'un sondage. */
  const axes = quiz.axes.slice(0, 10);
  if (axes.length && y + 148 <= FLOOR) {
    const boxH = 96;
    ctx.fillStyle = soft;
    roundRect(ctx, PAD, y, W - PAD * 2, boxH, 20);
    ctx.fill();

    const slot = (W - PAD * 2) / axes.length;
    /* Trois paliers : à dix axes le créneau tombe à 90 px, et un glyphe de
       32 px y frôlerait son voisin. */
    const glyphSize = axes.length > 8 ? 28 : axes.length > 6 ? 32 : 40;
    axes.forEach((axis, i) => {
      const cx = PAD + slot * i + slot / 2;
      ctx.textAlign = 'center';
      ctx.font = `${glyphSize}px ${SERIF}`;
      ctx.fillStyle = axis.color || accent;
      ctx.fillText(axis.glyph, cx, y + 16);
      ctx.font = sans(30, 700);
      ctx.fillStyle = scores.leaders.includes(axis.id) ? INK : MUTED;
      ctx.fillText(String(scores.counts[axis.id] ?? 0), cx, y + 58);
      ctx.textAlign = 'left';
    });
    y += boxH + 52;
  }

  /* Les recommandations : trois au plus, c'est ce qui tient et ce qui se
     retient. */
  const recos = profile.recos.filter((r) => r.title.trim()).slice(0, 3);
  if (recos.length && y + 170 <= FLOOR) {
    ctx.fillStyle = accent;
    ctx.fillRect(PAD, y, W - PAD * 2, 3);
    y += 26;

    ctx.font = sans(24, 700);
    ctx.fillStyle = accent;
    ctx.letterSpacing = '3px';
    ctx.fillText('À LIRE, VOIR, ÉCOUTER', PAD, y);
    ctx.letterSpacing = '0px';
    y += 52;

    for (const reco of recos) {
      /* On n'entame pas une recommandation qu'on ne pourrait pas finir. */
      if (y + 96 > FLOOR) break;
      ctx.font = serif(42);
      ctx.fillStyle = INK;
      y = drawLines(ctx, wrap(ctx, reco.title, W - PAD * 2, 1), PAD, y, 50);

      /* La cote va sur la ligne de méta plutôt que sur une ligne à elle :
         c'est l'information qu'on relit devant les rayons, et la carte est
         justement ce qu'on emporte sur son téléphone. */
      const meta = [reco.creator, reco.year, reco.location].filter(Boolean).join(' · ');
      if (meta) {
        ctx.font = sans(30);
        ctx.fillStyle = MUTED;
        y = drawLines(ctx, wrap(ctx, meta, W - PAD * 2, 1), PAD, y + 4, 40);
      }
      y += 26;
    }
  }

  /* --- Le pied : à qui c'est, et comment le refaire ------------------------
     C'est le seul objet du produit qui SORT du bâtiment. Il portait notre
     marque et notre accroche — la médiathèque avait fait le travail, et la
     carte qu'un lecteur envoie à trois amis nommait un outil que personne ne
     connaît. Elle porte donc le nom du lieu quand il en a un, et le nôtre
     seulement à défaut : la même règle de repli que le kiosque.

     Et elle porte de quoi refaire le parcours. Une carte qui donne envie sans
     dire où aller est une affiche sans adresse. */
  const basPied = H - PAD - PIED;
  const marque = identite?.titre?.trim();
  const cote = 168;

  let qr = null;
  if (url) {
    /* Une adresse trop longue pour un QR de ce format lève : un brouillon
       voyage dans son lien et pèse des kilo-octets. On renonce au carré, pas
       à la carte. */
    try { qr = encoder(url); } catch { qr = null; }
  }

  const largeurTexte = (qr ? W - PAD * 2 - cote - 40 : W - PAD * 2);

  ctx.fillStyle = mix(accent, PAPER, 0.35);
  ctx.fillRect(PAD, basPied, W - PAD * 2, 2);

  let yPied = basPied + 30;
  ctx.font = sans(34, 700);
  ctx.fillStyle = accent;
  drawLines(ctx, wrap(ctx, marque ? `✦ ${marque}` : '✦ RecoHero', largeurTexte, 2), PAD, yPied, 42);
  yPied += marque && wrap(ctx, `✦ ${marque}`, largeurTexte, 2).length > 1 ? 84 : 42;

  if (url) {
    ctx.font = sans(25);
    ctx.fillStyle = MUTED;
    ctx.fillText('Refaire le questionnaire :', PAD, yPied);
    yPied += 34;
    ctx.font = sans(25, 600);
    ctx.fillStyle = FAINT;
    /* Sans le protocole : ce n'est pas une adresse à recopier au clavier,
       c'est un repère à reconnaître sous le carré qu'on va scanner. */
    drawLines(ctx, wrap(ctx, url.replace(/^https?:\/\//, ''), largeurTexte, 2), PAD, yPied, 32);
  }

  if (qr) dessinerQR(ctx, qr.modules, qr.taille, W - PAD - cote, basPied + 28, cote);

  return canvas;
}

export function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Le navigateur n’a pas pu produire l’image.'))),
      'image/png',
    );
  });
}
