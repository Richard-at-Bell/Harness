import { FileCode2, FileSpreadsheet } from 'lucide-react';
export function language(path: string) {
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  return 'plaintext';
}
export function iconFor(path: string) { return path.endsWith('.csv') || path.endsWith('.xlsx') ? <FileSpreadsheet size={15} /> : <FileCode2 size={15} />; }
