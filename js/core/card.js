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
   Rien ne descend au-delà de sa ligne : un profil au titre long fait sauter
   des recommandations, il ne se superpose pas au pied.

   DEUX hauteurs, et c'est le QR qui tranche. Le pied a besoin de 224 px
   lorsqu'il porte un carré de 168 ; il n'en prend que 62 quand il ne porte
   qu'une signature — sa hauteur d'origine, avant que la carte n'emporte de
   quoi refaire le parcours. Réserver 224 dans les deux cas coûtait 162 px de
   blanc, soit deux recommandations, sur toutes les cartes SANS carré : celles
   d'un brouillon, dont le lien porte le questionnaire entier et dépasse ce
   qu'un QR de ce format sait encoder. Ce sont précisément les cartes qui
   avaient le moins à montrer. */
const PIED = 224;
const PIED_NU = 68;   /* filet + air + UNE ligne ; la seconde s'ajoute si besoin */

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

/* Couper au CARACTÈRE ce qu'aucun espace ne permet de couper. Le canvas
   n'ayant pas de débordement, une chaîne trop large ne se voit pas : elle se
   peint par-dessus ses voisines, puis dans le vide. */
function couper(ctx, text, maxWidth) {
  let coupe = String(text || '');
  if (ctx.measureText(coupe).width <= maxWidth) return coupe;
  while (coupe.length > 1 && ctx.measureText(`${coupe}…`).width > maxWidth) {
    coupe = coupe.slice(0, -1);
  }
  return `${coupe}…`;
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
  /* La boucle ci-dessus accepte un mot plus large que la ligne : il faut bien
     poser quelque chose, et `|| !current` s'en charge. Ce mot se dessinait
     alors à sa largeur entière, hors du cadre. Une adresse de questionnaire
     mesurait 1 024 px pour 696 px disponibles — elle traversait le QR code et
     sortait de la carte par la droite, sur toutes les cartes produites depuis
     que le pied porte une adresse. Un mot n'ayant pas d'espace où se couper,
     on le coupe au caractère. */
  return lines.map((line) => couper(ctx, line, maxWidth));
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

  /* Le carré se calcule AVANT de composer, parce que c'est lui qui décide de
     la hauteur du pied, donc de la place laissée au corps. Une adresse trop
     longue pour un QR de ce format lève : un brouillon voyage dans son lien
     et pèse des kilo-octets. On renonce au carré, pas à la carte. */
  let qr = null;
  if (url) {
    try { qr = encoder(url); } catch { qr = null; }
  }

  const cote = 168;
  const marque = identite?.titre?.trim();
  /* Le signe de la structure, à défaut le nôtre. Une médiathèque sans fichier
     de logo signait la carte de son public avec notre étoile. */
  const signe = identite?.emoji?.trim() || '✦';
  const largeurTexte = qr ? W - PAD * 2 - cote - 40 : W - PAD * 2;

  /* La signature est mesurée ici et non plus bas : sans carré, c'est ELLE qui
     donne sa hauteur au pied — une ligne ou deux, on ne réserve que ce qu'on
     va poser. */
  ctx.font = sans(34, 700);
  const lignesMarque = wrap(ctx, marque ? `${signe} ${marque}` : '✦ RecoHero', largeurTexte, 2);
  const hauteurPied = qr ? PIED : PIED_NU + (lignesMarque.length - 1) * 44;
  const plancher = H - PAD - hauteurPied;

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
    y += 156;
  }

  /* Le nom du profil : la ligne que l'on partage. */
  ctx.font = serif(86);
  ctx.fillStyle = deep;
  y = drawLines(ctx, wrap(ctx, profile.title, W - PAD * 2, 3), PAD, y, 98) + 8;

  if (profile.subtitle && y + 68 <= plancher) {
    ctx.font = serif(38, 400, 'italic');
    ctx.fillStyle = MUTED;
    y = drawLines(ctx, wrap(ctx, profile.subtitle, W - PAD * 2, 2), PAD, y, 50) + 18;
  }

  /* La feuille de score : ce qui distingue ce questionnaire d'un sondage. */
  const axes = quiz.axes.slice(0, 10);
  if (axes.length && y + 148 <= plancher) {
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
    y += boxH + 40;
  }

  /* Les recommandations : trois au plus, c'est ce qui tient et ce qui se
     retient. */
  const recos = profile.recos.filter((r) => r.title.trim()).slice(0, 3);
  if (recos.length && y + 160 <= plancher) {
    ctx.fillStyle = accent;
    ctx.fillRect(PAD, y, W - PAD * 2, 3);
    y += 24;

    ctx.font = sans(24, 700);
    ctx.fillStyle = accent;
    ctx.letterSpacing = '3px';
    ctx.fillText('À LIRE, VOIR, ÉCOUTER', PAD, y);
    ctx.letterSpacing = '0px';
    y += 46;

    for (const reco of recos) {
      /* La cote va sur la ligne de méta plutôt que sur une ligne à elle :
         c'est l'information qu'on relit devant les rayons, et la carte est
         justement ce qu'on emporte sur son téléphone. */
      const meta = [reco.creator, reco.year, reco.location].filter(Boolean).join(' · ');

      /* On n'entame pas une recommandation qu'on ne pourrait pas finir — mais
         on mesure ce qu'elle demande VRAIMENT au lieu de réserver un forfait.
         Le forfait valait 96 px là où une reco en prend 86 : la deuxième
         sautait pour six pixels, et laissait à sa place un trou de quatre-
         vingt-dix. Une carte annonçait trois titres et en montrait un. */
      const besoin = 48 + (meta ? 38 : 0);
      if (y + besoin > plancher) break;

      ctx.font = serif(42);
      ctx.fillStyle = INK;
      y = drawLines(ctx, wrap(ctx, reco.title, W - PAD * 2, 1), PAD, y, 48);

      if (meta) {
        ctx.font = sans(30);
        ctx.fillStyle = MUTED;
        y = drawLines(ctx, wrap(ctx, meta, W - PAD * 2, 1), PAD, y + 2, 36);
      }
      y += 20;
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
  const basPied = plancher;
  const yQR = basPied + 28;

  ctx.fillStyle = mix(accent, PAPER, 0.35);
  ctx.fillRect(PAD, basPied, W - PAD * 2, 2);

  if (qr) dessinerQR(ctx, qr.modules, qr.taille, W - PAD - cote, yQR, cote);

  /* --- L'adresse, et quand on la tait -------------------------------------
     Elle ne s'imprime QUE s'il y a un carré à scanner, et ce n'est pas une
     coquetterie : l'encodeur ne lève que sur une adresse trop longue pour ce
     format, c'est-à-dire exactement sur un lien porteur — celui qui
     transporte le questionnaire entier faute d'être publié quelque part.
     Quatre mille caractères de base64 que personne ne recopiera, et qui ne
     désignent rien à l'œil. Sans carré, la carte garde la marque et se tait.

     Quand elle s'imprime, ce n'est pas pour être recopiée au clavier —
     personne ne tape « ?q=quel-roman-pour-cet-ete » — c'est un repère qui dit
     chez qui l'on va. D'où l'hôte seul dès que le chemin ne tient pas sur la
     ligne : un nom de domaine entier vaut mieux qu'un chemin coupé au
     milieu. */
  ctx.font = sans(26, 600);
  const adresse = qr ? adresseLisible(ctx, url, largeurTexte) : '';

  /* Le bloc de texte se centre sur le carré au lieu de partir du filet. Calé
     en haut, il laissait le QR dépasser seul de quarante pixels sous la
     dernière ligne — le pied paraissait bancal sans qu'on voie pourquoi. */
  const hauteurBloc = lignesMarque.length * 44 + (adresse ? 64 : 0);
  let yPied = qr ? yQR + Math.max(0, Math.round((cote - hauteurBloc) / 2)) : basPied + 22;

  ctx.font = sans(34, 700);
  ctx.fillStyle = accent;
  yPied = drawLines(ctx, lignesMarque, PAD, yPied, 44);

  if (adresse) {
    yPied += 6;
    ctx.font = sans(23, 600);
    ctx.fillStyle = FAINT;
    ctx.letterSpacing = '2px';
    ctx.fillText('SCANNEZ POUR LE FAIRE', PAD, yPied);
    ctx.letterSpacing = '0px';
    yPied += 30;
    ctx.font = sans(26, 600);
    ctx.fillStyle = MUTED;
    ctx.fillText(adresse, PAD, yPied);
  }

  return canvas;
}

/* L'adresse réduite à ce qui se lit. On tente le chemin complet ; s'il ne
   tient pas, l'hôte seul ; s'il ne tient toujours pas — un sous-domaine à
   rallonge — on coupe au caractère plutôt que de déborder. */
function adresseLisible(ctx, url, largeurMax) {
  let hote;
  let complet;
  try {
    const adr = new URL(url);
    hote = adr.host.replace(/^www\./, '');
    complet = (hote + adr.pathname + adr.search).replace(/\/$/, '');
  } catch {
    complet = String(url).replace(/^https?:\/\//, '');
    hote = complet;
  }
  if (ctx.measureText(complet).width <= largeurMax) return complet;
  if (ctx.measureText(hote).width <= largeurMax) return hote;

  /* Un hôte qui ne tient pas se coupe par la GAUCHE, et non par la droite :
     ce qui identifie une adresse est à sa FIN — le domaine — tandis que son
     début porte les sous-domaines techniques. « questionnaires.reseau-des-… »
     ne dit chez qui l'on va ; « …grand-paris-seine-ouest.fr » le dit. */
  const morceaux = hote.split('.');
  while (morceaux.length > 2) {
    morceaux.shift();
    const reduit = `…${morceaux.join('.')}`;
    if (ctx.measureText(reduit).width <= largeurMax) return reduit;
  }
  return couper(ctx, morceaux.join('.'), largeurMax);
}

export function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Le navigateur n’a pas pu produire l’image.'))),
      'image/png',
    );
  });
}
