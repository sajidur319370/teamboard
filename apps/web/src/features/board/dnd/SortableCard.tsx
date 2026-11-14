import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { recentlyDragged } from './dragClock';

/**
 * One tab stop per card. Mouse: click opens, drag (6 px+) moves. Touch: long-press moves.
 * Keyboard: Enter opens; Space picks up, arrows move, Space/Enter drops, Escape cancels.
 * Ctrl/⌘+click opens the task in a new tab.
 */
export function SortableCard(props: {
  id: string;
  href: string;
  label: string; // "MOB-12: Fix login"
  disabled: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, active } =
    useSortable({ id: props.id, disabled: props.disabled });

  const open = (e: MouseEvent | KeyboardEvent) => {
    if (recentlyDragged()) return;
    if (e.ctrlKey || e.metaKey) window.open(props.href, '_blank', 'noopener');
    else navigate(props.href);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      // dnd-kit marks a non-draggable item aria-disabled, but a read-only card still OPENS:
      // announcing it as disabled would tell screen readers (and tests) it does nothing.
      aria-disabled={undefined}
      aria-label={props.label}
      aria-roledescription={props.disabled ? 'task' : 'draggable task'}
      onClick={open}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e); // Space: pick up (the KeyboardSensor)
        if (e.key === 'Enter' && !active) open(e); // Enter opens only when nothing is being dragged
      }}
      className={cn(
        'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !props.disabled && 'touch-manipulation',
        isDragging && 'opacity-40',
      )}
    >
      {props.children}
    </div>
  );
}
