import { useState } from 'react';

/**
 * Inline title editor: saves on blur or Enter, Escape cancels.
 * `edit` is null while not editing, so a live update from someone else (Day 15)
 * shows up immediately unless you're in the middle of typing.
 */
export function TitleField(props: {
  value: string;
  readOnly: boolean;
  onSave: (v: string) => void;
}) {
  const [edit, setEdit] = useState<string | null>(null);

  if (props.readOnly) return <h2 className="text-xl font-semibold break-words">{props.value}</h2>;

  const commit = () => {
    const v = (edit ?? '').trim();
    if (edit !== null && v && v !== props.value) props.onSave(v);
    setEdit(null);
  };

  return (
    <input
      aria-label="Title"
      className="w-full rounded-md px-1 py-0.5 text-xl font-semibold outline-none hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-ring"
      value={edit ?? props.value}
      maxLength={200}
      onChange={(e) => setEdit(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation(); // don't close the drawer
          setEdit(null);
          requestAnimationFrame(() => e.currentTarget?.blur());
        }
      }}
    />
  );
}
