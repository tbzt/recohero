/* ==========================================================================
   affiche.js — l'affiche à coller dans les rayons.

   Le chaînon qui manquait entre le produit et le bâtiment. Un questionnaire
   ne sert à rien s'il faut connaître son adresse : on imprime une feuille,
   on la scotche près des romans policiers, et les gens la scannent.

   Même parti pris que card.js, et pour les mêmes raisons : un canvas, aucune
   bibliothèque, une palette FIGÉE. Une affiche part à l'imprimante — elle ne
   doit pas dépendre du thème clair ou sombre de qui a cliqué sur le bouton.
   Seul l'accent du questionnaire la traverse.

   Format A4 à 150 points par pouce : ce qui sort se pose sur une imprimante
   de bureau sans réglage, et se réduit en A5 sans devenir illisible.
   ========================================================================== */

import { encoder } from './qr.js';
import { dureeEstimee } from './schema.js';

const W = 1240;
const H = 1754;
const PAD = 108;

const PAPIER = '#FBF7F1';
const ENCRE = '#1B1613';
const DOUX = '#6A5F55';
const PALE = '#A2968A';

const SERIF = '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, Palatino, "Liberation Serif", Georgia, serif';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const serif = (taille, graisse = 700, style = '') => `${style} ${graisse} ${taille}px ${SERIF}`.trim();
const sans = (taille, graisse = 400) => `${graisse} ${taille}px ${SANS}`;

function melange(hexA, hexB, part) {
  const lire = (hex) => {
    const v = hex.replace('#', '');
    const plein = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    return [0, 2, 4].map((i) => parseInt(plein.slice(i, i + 2), 16));
  };
  const [a, b] = [lire(hexA), lire(hexB)];
  return `rgb(${a.map((canal, i) => Math.round(canal * part + b[i] * (1 - part))).join(',')})`;
}

function couper(ctx, texte, largeurMax, lignesMax) {
  const mots = String(texte || '').split(/\s+/).filter(Boolean);
  const lignes = [];
  let courante = '';
  for (const mot of mots) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (ctx.measureText(essai).width <= largeurMax || !courante) courante = essai;
    else {
      lignes.push(courante);
      courante = mot;
      if (lignes.length === lignesMax) break;
    }
  }
  if (courante && lignes.length < lignesMax) lignes.push(courante);
  if (lignes.length === lignesMax && mots.join(' ') !== lignes.join(' ')) {
    let derniere = lignes[lignesMax - 1];
    while (derniere.length > 1 && ctx.measureText(`${derniere}…`).width > largeurMax) {
      derniere = derniere.slice(0, -1);
    }
    lignes[lignesMax - 1] = `${derniere}…`;
  }
  return lignes;
}

function ecrire(ctx, lignes, x, y, interligne) {
  let curseur = y;
  for (const ligne of lignes) {
    ctx.fillText(ligne, x, curseur);
    curseur += interligne;
  }
  return curseur;
}

/* Le QR, avec sa marge blanche. Les quatre modules de silence ne sont pas
   décoratifs : sans eux, un lecteur ne trouve pas les bords du symbole. On
   les dessine ici parce que qr.js rend une matrice nue — lui seul ne sait
   pas sur quel fond il atterrit. */
export function dessinerQR(ctx, matrice, taille, x, y, cote) {
  const SILENCE = 4;
  const modules = taille + SILENCE * 2;
  const pas = cote / modules;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, cote, cote);
  ctx.fillStyle = '#000000';
  for (let l = 0; l < taille; l += 1) {
    for (let c = 0; c < taille; c += 1) {
      if (!matrice[l][c]) continue;
      /* Les modules sont peints en coordonnées ENTIÈRES et débordent d'un
         demi-pixel : sur un pas fractionnaire, l'anticrénelage grisonne les
         bords et un lecteur hésite entre deux modules voisins. */
      const px = Math.round(x + (c + SILENCE) * pas);
      const py = Math.round(y + (l + SILENCE) * pas);
      const pw = Math.round(x + (c + SILENCE + 1) * pas) - px;
      const ph = Math.round(y + (l + SILENCE + 1) * pas) - py;
      ctx.fillRect(px, py, pw, ph);
    }
  }
}

/* `adresse` doit être une vraie adresse, durable et courte. Un questionnaire
   qui n'est publié nulle part n'en a pas : son contenu voyage dans le
   fragment, et personne n'imprime trois mille caractères en QR code. C'est
   à l'appelant de le dire avant d'arriver ici. */
export async function rendreAffiche(quiz, adresse, { structure = '', accroche = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const accent = quiz.accent || '#C8452B';
  const profond = melange(accent, ENCRE, 0.76);

  ctx.fillStyle = PAPIER;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 20);

  ctx.textBaseline = 'top';
  let y = PAD + 24;

  if (structure) {
    ctx.font = sans(30, 600);
    ctx.fillStyle = PALE;
    ctx.letterSpacing = '4px';
    ctx.fillText(couper(ctx, structure.toUpperCase(), W - PAD * 2, 1)[0] || '', PAD, y);
    ctx.letterSpacing = '0px';
    y += 62;
  }

  /* L'accroche prime sur le titre : sur un mur, « Quel livre vous
     ressemble ? » arrête quelqu'un, « Questionnaire n° 4 » non. Le titre
     sert de repli parce qu'il existe toujours. */
  ctx.font = serif(96);
  ctx.fillStyle = profond;
  y = ecrire(ctx, couper(ctx, accroche || quiz.title, W - PAD * 2, 3), PAD, y, 108) + 18;

  if (quiz.tagline) {
    ctx.font = serif(40, 400, 'italic');
    ctx.fillStyle = DOUX;
    y = ecrire(ctx, couper(ctx, quiz.tagline, W - PAD * 2, 2), PAD, y, 54) + 16;
  }

  /* Le QR prend ce qui reste, borné : trop petit il ne se scanne pas de
     loin, trop grand il chasse le texte hors de la feuille. */
  const basDuTexte = y + 40;
  const placeRestante = H - basDuTexte - 300;
  const cote = Math.max(420, Math.min(700, placeRestante));
  const qr = encoder(adresse);
  const qrX = (W - cote) / 2;
  dessinerQR(ctx, qr.modules, qr.taille, qrX, basDuTexte, cote);

  y = basDuTexte + cote + 44;

  ctx.textAlign = 'center';
  ctx.font = sans(40, 600);
  ctx.fillStyle = ENCRE;
  ctx.fillText('Scannez avec votre téléphone', W / 2, y);
  y += 58;

  const minutes = dureeEstimee(quiz);
  ctx.font = serif(46, 400, 'italic');
  ctx.fillStyle = accent;
  ctx.fillText(`environ ${minutes} minute${minutes > 1 ? 's' : ''}`, W / 2, y);
  ctx.textAlign = 'left';

  /* La signature, ancrée en bas quoi qu'il arrive au-dessus. */
  ctx.font = sans(26, 600);
  ctx.fillStyle = PALE;
  ctx.fillText('✦ RecoHero', PAD, H - PAD - 10);
  ctx.textAlign = 'right';
  ctx.font = sans(24);
  ctx.fillText(adresse, W - PAD, H - PAD - 8);
  ctx.textAlign = 'left';

  return { canvas, version: qr.version, taille: qr.taille };
}
