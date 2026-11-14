import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { TaskCardDto } from '@teamboard/shared';
import type { Columns } from '../grouping';
import { markDragEnd } from './dragClock';
import { boardKeyboardCoordinates } from './keyboard';
import { computeDrop, findColumn, previewMove, type MoveVars } from './dropLogic';

interface Props {
  columns: Columns; // from the query cache, already filtered + sorted
  onMove: (v: MoveVars) => void;
  renderColumns: (cols: Columns) => ReactNode;
  renderOverlay: (task: TaskCardDto) => ReactNode;
  taskLabel: (taskId: string) => string; // "MOB-12" for screen-reader announcements
  columnName: (columnId: string) => string;
}

/**
 * Owns the drag. While dragging it renders from a FROZEN copy of the columns, so a live
 * update (Day 15) can't yank cards out from under the cursor (FR-ORD-13). The API is
 * called ONCE, on drop, and not at all for a drop where the card started.
 */
export function BoardDnd(props: Props) {
  const [dragCols, setDragCols] = useState<Columns | null>(null);
  const [startCols, setStartCols] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const view = dragCols ?? props.columns;
  // Read at key-press time (a ref), so the sensor needn't be rebuilt when columns change.
  const columnIds = useRef(new Set<string>());
  useLayoutEffect(() => {
    columnIds.current = new Set(Object.keys(props.columns));
  }, [props.columns]);
  // eslint-disable-next-line react-hooks/refs -- read lazily, on a key press, not during render
  const [coordinateGetter] = useState(() => boardKeyboardCoordinates(() => columnIds.current));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a click isn't a drag
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), // long-press
    useSensor(KeyboardSensor, {
      coordinateGetter, // Left/Right = next column, Up/Down = reorder
      // Enter is NOT a start key (dnd-kit's default): Enter opens the card instead.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter', 'Tab'] },
    }),
  );

  const reset = () => {
    setDragCols(null);
    setStartCols(null);
    setActiveId(null);
    markDragEnd();
  };

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDragCols(props.columns);
    setStartCols(props.columns);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setDragCols((prev) => (prev ? previewMove(prev, String(active.id), String(over.id)) : prev));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const cols = dragCols;
    const start = startCols;
    reset();
    if (!over || !cols || !start) return;
    const vars = computeDrop(start, cols, String(active.id), String(over.id));
    if (vars) props.onMove(vars);
  }

  /** "column In Progress, position 3 of 5" */
  const where = (overId: string, cols: Columns) => {
    const col = findColumn(overId, cols);
    if (!col) return '';
    const list = cols[col]!;
    const i = list.findIndex((t) => t.id === overId);
    const pos = i === -1 ? list.length + 1 : i + 1;
    return `column ${props.columnName(col)}, position ${pos} of ${Math.max(list.length, pos)}`;
  };

  const active = activeId
    ? Object.values(view)
        .flat()
        .find((t) => t.id === activeId)
    : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners} // works best for multi-column boards
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'To pick up a task, press Space. Use the arrow keys to move it, Space to drop, Escape to cancel. Press Enter to open it.',
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${props.taskLabel(String(active.id))}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${props.taskLabel(String(active.id))} is over ${where(String(over.id), view)}.`
              : '',
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${props.taskLabel(String(active.id))} in ${where(String(over.id), view)}.`
              : 'Drop cancelled.',
          onDragCancel: ({ active }) => `Cancelled moving ${props.taskLabel(String(active.id))}.`,
        },
      }}
    >
      {props.renderColumns(view)}
      <DragOverlay>{active ? props.renderOverlay(active) : null}</DragOverlay>
    </DndContext>
  );
}
