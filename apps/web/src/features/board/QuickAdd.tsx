import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { useBoardCtx } from './BoardContext';
import { useCreateTask } from './api';

/** FR-BRD-09: type a title, press Enter, the task lands at the bottom of this column. */
export function QuickAdd({ columnId, columnName }: { columnId: string; columnName: string }) {
  const { slug, projectKey } = useBoardCtx();
  const create = useCreateTask(slug, projectKey);
  const [title, setTitle] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        create.mutate(
          { title: t, columnId },
          { onSuccess: () => setTitle(''), onError: (err) => toast.error(err.message) },
        );
      }}
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="+ Add task"
        aria-label={`Add a task to ${columnName}`}
        maxLength={200}
        disabled={create.isPending}
        className="border-dashed bg-transparent shadow-none"
      />
    </form>
  );
}
