/* ==========================================================================
   sortable.js — réordonner une liste à la souris et au doigt.

   Pointer Events plutôt que l'API drag-and-drop native : celle-ci ne
   fonctionne pas au tactile, ce qui exclurait la moitié des usages. Une
   centaine de lignes contre une dépendance, et le geste est le même
   partout — souris, doigt, stylet.

   Les boutons ↑↓ restent en place : ils sont le chemin clavier, et ce
   module ne les remplace pas.
   ========================================================================== */

/* Un seul geste peut être en cours à la fois : l'état vit donc au niveau du
   module, et les écouteurs de `window` ne sont posés qu'une fois. Les poser
   par appel de sortable() les ferait s'accumuler à chaque redessin du
   panneau — un par liste et par rendu, sans jamais rien retirer. */
let drag = null;
let wired = false;

/* Bord de déclenchement du défilement automatique, et vitesse maximale. */
const EDGE = 96;
const SPEED = 18;

function gapOf(container) {
  return parseFloat(getComputedStyle(container).rowGap) || 0;
}

/* Tout se mesure en coordonnées de PAGE, pas de fenêtre. Un défilement en
   cours de geste — à la molette, ou par le défilement automatique
   ci-dessous — décalerait sinon toutes les mesures prises au départ. */
function pageY(clientY) {
  return clientY + window.scrollY;
}

function autoScroll() {
  if (!drag) return;
  const { clientY } = drag;
  const above = clientY - EDGE;
  const below = clientY - (window.innerHeight - EDGE);

  let delta = 0;
  if (above < 0) delta = Math.max(-SPEED, (above / EDGE) * SPEED);
  else if (below > 0) delta = Math.min(SPEED, (below / EDGE) * SPEED);

  if (delta) {
    window.scrollBy(0, delta);
    place();
  }
  drag.frame = requestAnimationFrame(autoScroll);
}

function cleanup() {
  if (!drag) return;
  cancelAnimationFrame(drag.frame);
  for (const node of drag.items) node.style.transform = '';
  drag.node.classList.remove('is-dragging');
  drag.container.classList.remove('is-sorting');
  try { drag.handle.releasePointerCapture(drag.pointerId); } catch { /* déjà relâché */ }
  drag = null;
}

function finish(commit) {
  if (!drag) return;
  const { from, to, onDrop } = drag;
  cleanup();
  if (commit && from !== to) onDrop(from, to);
}

function onMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.clientY = event.clientY;
  place();
}

/* Positionne l'élément tiré et écarte les autres. Appelée au mouvement du
   pointeur, mais aussi à chaque image du défilement automatique — car
   alors le pointeur ne bouge pas, et la page si. */
function place() {
  if (!drag) return;

  const dy = pageY(drag.clientY) - drag.startY;
  drag.node.style.transform = `translateY(${dy}px)`;

  /* La cible se lit sur le centre de l'élément tiré, comparé aux milieux
     des autres mesurés une seule fois au départ. Re-mesurer en cours de
     geste ferait osciller la cible entre deux positions, puisque les
     éléments qu'on vient d'écarter ont bougé. */
  const own = drag.rects[drag.from];
  const centre = own.top + own.height / 2 + dy;


  let to = drag.from;
  drag.rects.forEach((rect, i) => {
    if (i === drag.from) return;
    const mid = rect.top + rect.height / 2;
    if (i < drag.from && centre < mid) to = Math.min(to, i);
    if (i > drag.from && centre > mid) to = Math.max(to, i);
  });
  drag.to = to;

  const step = own.height + gapOf(drag.container);
  drag.items.forEach((node, i) => {
    if (i === drag.from) return;
    let shift = 0;
    if (to > drag.from && i > drag.from && i <= to) shift = -step;
    if (to < drag.from && i < drag.from && i >= to) shift = step;
    node.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function wireOnce() {
  if (wired) return;
  wired = true;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', () => finish(true));
  window.addEventListener('pointercancel', () => finish(false));
  window.addEventListener('keydown', (event) => {
    if (drag && event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
}

export function sortable(container, { handle = '.grip', onDrop }) {
  wireOnce();
  if (container.dataset.sortableBound === '1') return;
  container.dataset.sortableBound = '1';

  /* Cet écouteur-ci vit sur le conteneur : il disparaît avec lui au
     prochain rendu, sans rien laisser derrière. */
  container.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const grip = event.target.closest(handle);
    if (!grip || !container.contains(grip)) return;

    /* Les listes s'imbriquent : les réponses vivent dans les questions, les
       recommandations dans les profils. L'évènement remonte donc jusqu'aux
       conteneurs extérieurs, qui le réclameraient à leur tour et
       écraseraient le geste en cours. Seule la liste la plus proche de la
       poignée le prend. */
    if (grip.closest('[data-sortable-bound]') !== container) return;

    const items = [...container.children].filter((n) => n.nodeType === 1);
    const node = items.find((n) => n.contains(grip));
    if (!node) return;

    event.preventDefault();
    grip.setPointerCapture(event.pointerId);

    drag = {
      container, node, handle: grip, onDrop,
      pointerId: event.pointerId,
      from: items.indexOf(node), to: items.indexOf(node),
      startY: pageY(event.clientY),
      clientY: event.clientY,
      frame: 0,
      items,
      rects: items.map((n) => {
        const rect = n.getBoundingClientRect();
        return { top: rect.top + window.scrollY, height: rect.height };
      }),
    };
    node.classList.add('is-dragging');
    container.classList.add('is-sorting');
    drag.frame = requestAnimationFrame(autoScroll);
  });
}

/* Câble toutes les listes d'un panneau. Chaque conteneur déclare ce qu'il
   ordonne dans `data-sortable` ; le panneau n'a rien d'autre à faire.   */
export function bindSortables(root, resolve) {
  for (const container of root.querySelectorAll('[data-sortable]')) {
    const key = container.dataset.sortable;
    sortable(container, { onDrop: (from, to) => resolve(key, from, to) });
  }
}
