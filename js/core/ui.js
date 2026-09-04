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
    else if (key === 'style' && typeof value === 'object') applyStyle(node, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  /* `0` est écarté au même titre que `false` et `null`. Le patron
     `liste.length && el(…)` rend le nombre 0 quand la liste est vide, et
     `String(0)` l'imprimait tel quel : un « 0 » nu au bord de la barre de
     navigation, à l'endroit précis où « Suivant → » va apparaître, et un
     second entre les recommandations et la proximité. Aucun appelant ne
     passe un enfant numérique — les nombres affichés passent tous par
     `String(...)` en amont. */
  for (const child of [].concat(children)) {
    if (child == null || child === false || child === 0) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* Les propriétés personnalisées ne passent PAS par l'affectation directe :
   `style['--axis'] = c` — ce que fait Object.assign — crée une propriété
   JavaScript ordinaire que le moteur de style ignore, sans erreur ni
   avertissement. Il faut setProperty().

   Ce silence a coûté cher : chaque `--axis` posé depuis un rendu était
   inerte, et TOUS les glyphes du produit retombaient sur `var(--accent)`.
   Les axes ont une couleur dans le modèle, un sélecteur de couleur dans
   l'éditeur, une place dans le format — et pas un pixel à l'écran. Seule
   la carte de résultat les montrait, parce qu'elle peint sur un canvas et
   ne passe pas par le CSS. */
function applyStyle(node, declarations) {
  for (const [prop, value] of Object.entries(declarations)) {
    if (value == null) continue;
    if (prop.startsWith('--')) node.style.setProperty(prop, String(value));
    else node.style[prop] = value;
  }
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
    /* Le geste de sortie est en CSS (.est-partie) : un style en ligne
       ignorait les jetons de mouvement, mouvement réduit compris. */
    node.classList.add('est-partie');
    setTimeout(() => node.remove(), 260);
  };

  toastHost.append(node);
  const timer = setTimeout(dismiss, duration);
  return dismiss;
}

/* Noir ou blanc sur une couleur donnée — luminance relative WCAG. */
function luminance(hex) {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (full.length < 6) return null;
  const channel = (i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function inkOn(hex) {
  const l = luminance(hex);
  if (l === null) return '#FFFFFF';
  return l > 0.42 ? '#17120F' : '#FFFFFF';
}

/* Le rapport de contraste de l'accent avec le blanc, qui est exactement
   `--surface` du thème clair (#FFFFFF) — la carte sur laquelle l'anneau de
   focus se dessine. C'est le cas qui casse, et il ne se voit pas au moment
   du choix : `--focus` VAUT `--accent` (foundation.css:152), donc un accent
   clair rend l'anneau invisible dans tout le questionnaire, et les jauges
   avec lui. `inkOn` ne rattrape que le texte posé SUR l'accent, qui bascule
   en noir ou blanc ; l'anneau et les filets, eux, n'ont pas de repli.

   Mesure vérifiée contre l'audit d'accessibilité du 1er septembre 2026 :
   #C8452B → 4,84 · #FFD400 → 1,43 · #7ED321 → 1,87 · #00E5FF → 1,54.

   Le fond de page `--bg` (#FBF7F1) est un rien plus sombre : le rapport y
   est légèrement inférieur. Ce qu'on mesure ici est donc l'hypothèse la
   plus favorable — un accent qui échoue ici échoue partout. */
export function contrasteSurBlanc(hex) {
  const l = luminance(hex);
  return l === null ? null : Math.round((1.05 / (l + 0.05)) * 100) / 100;
}

/* Un questionnaire ne redéfinit qu'une variable : --accent.
   Tout le reste du thème en découle (cf. foundation.css).              */
export function applyAccent(hex, root = document.documentElement) {
  if (!hex) return;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-ink', inkOn(hex));
}

/* --- L'espace, dans l'adresse ------------------------------------------------
   Le nom de l'espace vient de l'adresse, et il doit y rester. Un lien
   interne qui l'oublie fait changer de catalogue sans le dire : on partait
   du kiosque d'une médiathèque, on se retrouve sur le nôtre, et rien à
   l'écran n'explique pourquoi les questionnaires ne sont plus les mêmes.

   Le retour arrière du navigateur n'a besoin d'aucun traitement : dès lors
   que chaque navigation emporte le paramètre, l'historique le contient.

   C'est de l'adressage et non du métier — ces fonctions ne savent d'un
   espace que ceci : il se nomme dans la query.                          */

export function espaceCourant(recherche = location.search) {
  return new URLSearchParams(recherche).get('espace');
}

export function avecEspace(url, espace = espaceCourant()) {
  if (!espace || !url) return url;
  /* Jamais chez les autres : le nom de l'espace n'a rien à faire dans
     l'adresse d'un tiers. Une reco pointe vers un catalogue, un éditeur,
     une notice — aucun n'a à savoir d'où vient le visiteur.

     Le tri se fait sur l'ORIGINE, pas sur la forme : nos propres adresses
     sont parfois absolues — le lien de test que fabrique le backoffice en
     est une — et les écarter sur le seul motif qu'elles portent un schéma
     leur ferait perdre l'espace. */
  const texte = String(url);
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(texte)) {
    try {
      if (new URL(texte, location.href).origin !== location.origin) return url;
    } catch {
      return url;
    }
  }
  const [chemin, fragment] = texte.split('#');
  /* Une ancre seule ne désigne pas une page : lui poser une query la
     ferait quitter celle où l'on est. */
  if (!chemin) return url;
  if (/[?&]espace=/.test(chemin)) return url;
  const separateur = chemin.includes('?') ? '&' : '?';
  const complet = `${chemin}${separateur}espace=${encodeURIComponent(espace)}`;
  return fragment === undefined ? complet : `${complet}#${fragment}`;
}

/* Les liens écrits en dur dans le HTML : la marque, « Backoffice », le pied
   de page. Ceux que le rendu fabrique passent par avecEspace() à la
   construction. On ne touche qu'aux adresses relatives — un lien externe,
   un `mailto:` ou une ancre n'ont rien à voir avec notre catalogue. */
export function garderEspace(racine = document) {
  const espace = espaceCourant();
  if (!espace) return;
  for (const lien of racine.querySelectorAll('a[href]')) {
    const href = lien.getAttribute('href');
    if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
    lien.setAttribute('href', avecEspace(href, espace));
  }
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
