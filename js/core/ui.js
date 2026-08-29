/* ==========================================================================
   ui.js — les gestes d'interface partagés. Pas de logique métier ici.
   ========================================================================== */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* Un retour à la ligne dans un champ libre devient un paragraphe.
   Volontairement pas de Markdown : une dépendance de plus pour un gain
   que personne n'a demandé.                                            */
export function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

let toastHost = null;

/* toast('message')                       — une notification simple
   toast('message', 'danger')             — avec une variante
   toast('message', { action: { label, onClick } }) — avec un geste de rattrapage

   Un bandeau porteur d'action reste deux fois plus longtemps : le temps de
   lire, de comprendre qu'on s'est trompé, et d'atteindre le bouton.       */
export function toast(message, options = '') {
  const config = typeof options === 'string' ? { variant: options } : (options || {});
  const { variant = '', action = null } = config;
  const duration = config.duration ?? (action ? 6000 : 2600);

  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }

  const node = el('div', { class: 'toast' + (variant ? ` toast--${variant}` : '') }, [
    el('span', { text: message }),
    action && el('button', {
      class: 'toast__action', type: 'button', text: action.label,
      onClick: () => { dismiss(); action.onClick(); },
    }),
  ]);
  if (action) node.classList.add('toast--actionable');

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    node.style.transition = 'opacity 200ms, transform 200ms';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  };

  toastHost.append(node);
  const timer = setTimeout(dismiss, duration);
  return dismiss;
}

/* Noir ou blanc sur une couleur donnée — luminance relative WCAG. */
export function inkOn(hex) {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (full.length < 6) return '#FFFFFF';
  const channel = (i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.42 ? '#17120F' : '#FFFFFF';
}

/* Un questionnaire ne redéfinit qu'une variable : --accent.
   Tout le reste du thème en découle (cf. foundation.css).              */
export function applyAccent(hex, root = document.documentElement) {
  if (!hex) return;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-ink', inkOn(hex));
}

export function formatDate(timestamp) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(timestamp));
}

export function debounce(fn, delay = 400) {
  let handle = 0;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delay);
  };
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function download(filename, text, mime = 'application/json') {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/* --- Images ---------------------------------------------------------------
   Un fichier choisi sur le disque est réduit puis intégré en data: URI.
   Sans serveur, c'est la seule façon qu'une image survive au partage par
   lien ; en contrepartie elle pèse dans le questionnaire, d'où la
   réduction agressive et le poids affiché à l'auteur.                    */

export const IMAGE_LIMITS = {
  cover:  { max: 1000, quality: 0.72 },  /* couverture de questionnaire, bandeau de profil */
  thumb:  { max: 420,  quality: 0.72 },  /* vignette de reco, image de réponse */
};

export async function imageFromFile(file, { max = 800, quality = 0.72 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Ce fichier n’est pas une image.');

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  /* On garde le plus léger des deux encodages. Un navigateur qui ne sait
     pas produire de WebP renvoie silencieusement du PNG : le test sur le
     préfixe évite de le prendre pour du WebP.                          */
  const webp = canvas.toDataURL('image/webp', quality);
  const jpeg = canvas.toDataURL('image/jpeg', quality);
  const usable = webp.startsWith('data:image/webp') && webp.length < jpeg.length ? webp : jpeg;
  return { dataUri: usable, width, height };
}

export function formatBytes(bytes) {
  if (!bytes) return '0 o';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
