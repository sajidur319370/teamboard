import type { KeyboardCoordinateGetter } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

type Rect = { left: number; top: number; width: number; height: number };
export type Coordinates = { x: number; y: number };

/**
 * Where a lifted card goes on ArrowLeft/ArrowRight: into the NEIGHBOURING column, at the
 * same height (clamped into that column). Pure, so it is unit-tested.
 * Returns null when there is no column in that direction.
 */
export function neighbourColumnTarget(
  columns: Rect[], // the column drop areas, in board order
  card: Rect, // where the lifted card is now
  direction: 'left' | 'right',
): Coordinates | null {
  const centre = card.left + card.width / 2;
  const sorted = [...columns].sort((a, b) => a.left - b.left);
  const target =
    direction === 'right'
      ? sorted.find((c) => c.left > centre)
      : [...sorted].reverse().find((c) => c.left + c.width < centre);
  if (!target) return null;
  const maxTop = Math.max(target.top, target.top + target.height - card.height);
  return {
    x: target.left + (target.width - card.width) / 2,
    y: Math.min(Math.max(card.top, target.top), maxTop),
  };
}

/**
 * dnd-kit's sortable keyboard getter moves to the CLOSEST item, which for ArrowRight is
 * often a card in the same column. On a board, left/right must mean "next column".
 * Up/Down keep the default (reorder within the column).
 */
export const boardKeyboardCoordinates =
  (columnIds: () => Set<string>): KeyboardCoordinateGetter =>
  (event, args) => {
    const direction =
      event.code === 'ArrowRight' ? 'right' : event.code === 'ArrowLeft' ? 'left' : null;
    if (!direction) return sortableKeyboardCoordinates(event, args);
    const { collisionRect, droppableRects, droppableContainers } = args.context;
    if (!collisionRect) return undefined;
    const ids = columnIds();
    const columns = droppableContainers
      .getEnabled()
      .filter((c) => ids.has(String(c.id)))
      .flatMap((c) => {
        const r = droppableRects.get(c.id);
        return r ? [r] : [];
      });
    const target = neighbourColumnTarget(columns, collisionRect, direction);
    if (!target) return undefined;
    event.preventDefault();
    return target;
  };
