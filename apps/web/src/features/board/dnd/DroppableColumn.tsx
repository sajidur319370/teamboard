import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';

/** A column's card list: sortable, and droppable even when EMPTY (needs a min-height). */
export function DroppableColumn(props: { id: string; taskIds: string[]; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  return (
    <SortableContext id={props.id} items={props.taskIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto rounded-md px-2 pb-2 transition-colors',
          isOver && 'bg-primary/5',
        )}
      >
        {props.children}
      </div>
    </SortableContext>
  );
}
