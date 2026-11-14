import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

// A fake `apps/web/dist`: index.html + one hashed asset, like a Vite build.
const dist = mkdtempSync(path.join(tmpdir(), 'tb-web-'));
mkdirSync(path.join(dist, 'assets'));
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const app = createApp({ webDist: dist });

describe('single-origin web serving (production)', () => {
  it.each(['/', '/login', '/w/acme/p/MOB/tasks/12', '/invite/some-token'])(
    'SPA route %s → index.html, never cached',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).toContain('id="root"');
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('hashed assets are cached for a year; missing ones are a real 404', async () => {
    const js = await request(app).get('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers['cache-control']).toContain('immutable');
    expect(js.headers['cache-control']).toContain('max-age=31536000');
    expect((await request(app).get('/assets/missing.js')).status).toBe(404);
  });

  it('serves other static files', async () => {
    expect((await request(app).get('/favicon.svg')).status).toBe(200);
  });

  it('unknown API routes are still JSON 404s, not index.html', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('health still works, and helmet sends a CSP that allows only our own origin', async () => {
    expect((await request(app).get('/health')).body).toEqual({ ok: true });
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('the CSP is explicit and strict: no framing, no plugins, no inline or eval scripts', async () => {
    const csp = (await request(app).get('/')).headers['content-security-policy'] as string;
    const directives = Object.fromEntries(
      csp.split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toMatchObject({
      'default-src': "'self'",
      'script-src': "'self'",
      'frame-ancestors': "'none'",
      'object-src': "'none'",
      'base-uri': "'self'",
      'form-action': "'self'",
    });
    expect(directives['connect-src']).toMatch(/^'self' ws:\/\//); // sockets on the same host
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(directives['script-src']).not.toMatch(/unsafe-inline/);
  });

  it('without webDist (dev, tests) nothing is served at /', async () => {
    expect((await request(createApp()).get('/')).status).toBe(404);
  });
});
