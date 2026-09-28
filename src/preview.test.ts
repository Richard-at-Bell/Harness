import { describe, expect, it } from 'vitest';
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
});
