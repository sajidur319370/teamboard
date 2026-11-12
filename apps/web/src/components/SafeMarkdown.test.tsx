import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from './SafeMarkdown';

const render = (md: string) => renderToStaticMarkup(<SafeMarkdown>{md}</SafeMarkdown>);

describe('SafeMarkdown (Day 10 "Done when")', () => {
  it('renders Markdown', () => {
    const html = render('# Title\n\n**bold** and [docs](https://example.com)');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('never renders raw HTML from the source', () => {
    const html = render('<b>hi</b> <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  it('turns javascript: links into dead links', () => {
    for (const md of [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x](data:text/html,<b>)',
    ]) {
      const html = render(md);
      expect(html, md).not.toMatch(/href="(javascript|data):/i);
      expect(html.toLowerCase()).not.toContain('javascript:');
    }
  });
});
