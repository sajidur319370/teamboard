import Markdown, { defaultUrlTransform } from 'react-markdown';
import { cn } from '@/lib/utils';

/**
 * The ONLY way user Markdown is rendered. Markdown is stored as written (it's text);
 * safety happens here, at render time:
 *  - skipHtml: raw HTML like <b> or <script> in the source is dropped, never rendered
 *  - defaultUrlTransform: javascript:/data:/vbscript: URLs become empty (dead links)
 *  - links open in a new tab without giving that tab access to ours
 */
export function SafeMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose prose-sm max-w-none break-words dark:prose-invert', className)}>
      <Markdown
        skipHtml
        urlTransform={defaultUrlTransform}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
