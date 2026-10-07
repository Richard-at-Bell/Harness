import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildPreview, codeSignature } from './preview';
import { toBytes, type FileMap } from './workspace';

describe('live preview', () => {
  it('inlines local scripts, styles, and images with an isolated bridge token', async () => {
    const files: FileMap = new Map([
      ['index.html', toBytes('<html><head><link rel="stylesheet" href="styles.css"></head><body><img src="icon.png"><script src="app.js"></script></body></html>')],
      ['styles.css', toBytes('body{background-image:url(icon.png)}')],
      ['app.js', toBytes('window.ready=true')],
      ['icon.png', new Uint8Array([137, 80, 78, 71])],
    ]);
    const doc = await buildPreview(files, new Map(), 'test-token');
    expect(doc).toContain('test-token');
    expect(doc).toContain('window.ready=true');
    expect(doc).toContain('data:image/png;base64,');
    expect(doc).not.toContain('<script src="app.js">');
    const first = codeSignature(files);
    files.set('icon.png', new Uint8Array([137, 80, 78, 72]));
    expect(codeSignature(files)).not.toBe(first);
  });

  it('keeps fragment links inside srcdoc while leaving other navigation to the app', async () => {
    const doc = await buildPreview(new Map([['index.html', toBytes('<html><head></head><body><a href="#meal%20list">Meals</a></body></html>')]]), new Map(), 'token');
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();
    const handlers = new Map<string, (event: object) => void>();
    const getElementById = vi.fn((id: string) => id === 'meal list' ? { scrollIntoView } : null);
    const window = { scrollTo, addEventListener: (name: string, handler: (event: object) => void) => handlers.set(name, handler) };
    runInNewContext(doc.match(/<script>([\s\S]*?)<\/script>/)![1], { window, document: { getElementById } });
    function click(href: string, extra = {}) {
      const preventDefault = vi.fn();
      handlers.get('click')!({ button: 0, target: { closest: () => ({ getAttribute: (name: string) => name === 'href' ? href : null, hasAttribute: () => false }) }, preventDefault, ...extra });
      return preventDefault;
    }
    expect(click('#meal%20list')).toHaveBeenCalledOnce();
    expect(getElementById).toHaveBeenCalledWith('meal list');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(click('#')).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(() => click('#%broken')).not.toThrow();
    expect(click('#missing')).toHaveBeenCalledOnce();
    expect(click('https://example.com/')).not.toHaveBeenCalled();
    expect(click('#meal%20list', { ctrlKey: true })).not.toHaveBeenCalled();
    expect(click('#meal%20list', { defaultPrevented: true })).not.toHaveBeenCalled();
  });
});
