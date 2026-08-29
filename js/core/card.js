/* ==========================================================================
   card.js — la carte de résultat, dessinée sur un canvas.
   Ce n'est pas une capture d'écran : c'est une affiche composée pour être
   partagée, au format portrait 4:5. Aucune dépendance — le canvas sait
   déjà écrire du texte, et une bibliothèque de rasterisation du DOM
   coûterait plus cher que ces deux cents lignes.
   ========================================================================== */

const W = 1080;
const H = 1350;
const PAD = 88;

/* La signature est ancrée en bas. Rien ne descend au-delà de cette ligne :
   un profil au titre long fait sauter des recommandations, il ne se
   superpose pas à la signature. */
const FLOOR = H - PAD - 62;

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

/* Une image distante « salit » le canvas et fait échouer toBlob(). On ne
   dessine donc que ce qui est certainement lisible : une image intégrée
   en data: URI, ou un fichier du même hébergeur. Sinon on retombe sur
   l'emoji, sans le dire — la carte reste correcte.                     */
function isSafeToDraw(src) {
  if (!src) return false;
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
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderResultCard(quiz, profile, scores) {
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
  const medallion = isSafeToDraw(profile.image) ? await loadImage(profile.image) : null;
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
  const axes = quiz.axes.slice(0, 8);
  if (axes.length && y + 148 <= FLOOR) {
    const boxH = 96;
    ctx.fillStyle = soft;
    roundRect(ctx, PAD, y, W - PAD * 2, boxH, 20);
    ctx.fill();

    const slot = (W - PAD * 2) / axes.length;
    const glyphSize = axes.length > 6 ? 32 : 40;
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

  /* La signature, ancrée en bas quoi qu'il arrive au-dessus. */
  ctx.font = sans(26, 600);
  ctx.fillStyle = accent;
  ctx.fillText('✦ RecoHero', PAD, H - PAD - 34);
  ctx.font = sans(26);
  ctx.fillStyle = FAINT;
  ctx.fillText('la reco dont vous êtes le héros', PAD + ctx.measureText('✦ RecoHero').width + 40, H - PAD - 34);

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
