import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/client';
import { SafeMarkdown } from '@/components/SafeMarkdown';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

/**
 * Write / Preview Markdown editor with conflict protection (FR-TSK-04).
 * It remembers the task version you STARTED editing from and sends it as expectedVersion,
 * so a long edit never silently overwrites someone else's paragraph.
 */
export function DescriptionEditor(props: {
  value: string;
  version: number;
  onSave: (text: string, expectedVersion: number) => Promise<unknown>;
}) {
  const [edit, setEdit] = useState<string | null>(null); // null = not editing
  const [baseVersion, setBaseVersion] = useState(props.version);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const text = edit ?? props.value;
  const dirty = edit !== null && edit !== props.value;

  const save = async (expected: number) => {
    if (edit === null) return;
    setSaving(true);
    try {
      await props.onSave(edit, expected);
      setEdit(null);
      setConflict(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setConflict(true);
      else toast.error(e instanceof Error ? e.message : "Couldn't save the description");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tabs defaultValue="write">
      <TabsList>
        <TabsTrigger value="write">Write</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="write">
        <Textarea
          aria-label="Description"
          rows={8}
          value={text}
          maxLength={10_000}
          placeholder="Markdown supported: **bold**, lists, [links](https://…)"
          onChange={(e) => {
            if (edit === null) setBaseVersion(props.version); // editing starts from this version
            setEdit(e.target.value);
          }}
        />
      </TabsContent>
      <TabsContent value="preview" className="min-h-24 rounded-md border p-3">
        <SafeMarkdown>{text || '_Nothing to preview_'}</SafeMarkdown>
      </TabsContent>

      {conflict && (
        <div
          role="alert"
          className="mt-2 space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <p>Someone else changed this description while you were editing.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEdit(null); // the drawer already shows their latest version
                setConflict(false);
              }}
            >
              Discard mine, show theirs
            </Button>
            <Button size="sm" onClick={() => save(props.version)} disabled={saving}>
              Keep mine
            </Button>
          </div>
        </div>
      )}

      {!conflict && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={!dirty || saving} onClick={() => save(baseVersion)}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {edit !== null && (
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </Tabs>
  );
}
