// A drop can be followed by a stray `click` on the card under the pointer. Cards ignore
// clicks for a moment after a drag ends, so a drop never opens the drawer by accident.
let lastDragEnd = 0;

export const markDragEnd = () => {
  lastDragEnd = Date.now();
};

export const recentlyDragged = () => Date.now() - lastDragEnd < 250;
