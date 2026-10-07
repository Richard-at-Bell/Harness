import type { FileSnapshot } from './workspace';
import { toText } from './workspace';
import { seedScript } from './fixtures';

function escapeScript(source: string): string { return source.replaceAll(/<\/script/gi, '<\\/script'); }
function escapeStyle(source: string): string { return source.replaceAll(/<\/style/gi, '<\\/style'); }
function localPath(value: string): string { return value.replace(/^\.\//, '').split(/[?#]/, 1)[0]; }
function mime(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
function dataUrl(files: FileSnapshot, url: string): string | undefined {
  const path = localPath(url);
  const bytes = files.get(path);
  if (!bytes || bytes.byteLength > 2_000_000) return undefined;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime(path)};base64,${btoa(binary)}`;
}
function inlineCss(files: FileSnapshot, css: string): string {
  return css.replace(/url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi, (full, _quote, url) => {
    const embedded = dataUrl(files, url.trim());
    return embedded ? `url("${embedded}")` : full;
  });
}

// srcdoc inherits the Studio's base URL, so native fragment navigation would
// load the Studio inside the frame. Keep same-page anchors in the project.
const fragmentNavigation = `window.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const anchor = event.target?.closest?.('a[href]');
  const href = anchor?.getAttribute('href');
  const target = anchor?.getAttribute('target');
  if (!href?.startsWith('#') || (target && target !== '_self') || anchor.hasAttribute('download')) return;
  event.preventDefault();
  let id;
  try { id = decodeURIComponent(href.slice(1)); } catch { return; }
  if (!id) { window.scrollTo(0, 0); return; }
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
});`;

export async function buildPreview(files: FileSnapshot, fixtures: FileSnapshot, token: string): Promise<string> {
  let html = files.has('index.html') ? toText(files.get('index.html')!) : '<!doctype html><p>No index.html file</p>';
  const seed = await seedScript(fixtures);
  const support = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">\n<script>window.__STUDIO_BRIDGE_TOKEN__=${JSON.stringify(token)};${escapeScript(seed)};window.addEventListener('error',event=>parent.postMessage({kind:'preview.error',token:window.__STUDIO_BRIDGE_TOKEN__,message:event.message},'*'));${fragmentNavigation}</script>`;
  html = html.includes('</head>') ? html.replace('</head>', `${support}</head>`) : support + html;
  html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (full, before, path, after) => {
    const local = localPath(path);
    if (!/stylesheet/i.test(before + after) || !files.has(local)) return full;
    return `<style>${escapeStyle(inlineCss(files, toText(files.get(local)!)))}</style>`;
  });
  html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (full, _before, path) => {
    if (path === 'fixture-seed.js') return '';
    const local = localPath(path);
    if (!files.has(local)) return full;
    return `<script>${escapeScript(toText(files.get(local)!))}</script>`;
  });
  html = html.replace(/(<img\b[^>]*?src=["'])([^"']+)(["'][^>]*>)/gi, (full, before, url, after) => {
    const embedded = dataUrl(files, url);
    return embedded ? `${before}${embedded}${after}` : full;
  });
  return html;
}

export function codeSignature(files: FileSnapshot): string {
  return [...files.entries()].map(([path, bytes]) => {
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return `${path}:${bytes.length}:${hash >>> 0}`;
  }).join('\n');
}
