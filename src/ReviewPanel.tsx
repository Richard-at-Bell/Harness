import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check } from 'lucide-react';
import { DiffReview } from './DiffReview';
import { iconFor, language } from './filePresentation';
import { readTable } from './fixtures';
import { useSession, useStudio } from './studioContext';
import { toText, validFixturePath } from './workspace';

export const ReviewPanel = memo(function ReviewPanel() {
  const studio = useStudio(), review = useSession(state => state.pending);
  const accepting = useSession(state => state.accepting);
  const [selection, setSelection] = useState<{ review: typeof review; path: string; open: boolean }>({ review: null, path: '', open: false });
  const [texts, setTexts] = useState<{ review: typeof review; path: string; original: string; modified: string } | null>(null);
  const path = selection.review === review ? selection.path : review?.paths[0] || '';
  const open = selection.review === review ? selection.open : true;
  useEffect(() => {
    if (!review || !path) return;
    let active = true;
    async function render(bytes?: Uint8Array) {
      if (!bytes) return '';
      if (!path.endsWith('.xlsx')) return toText(bytes);
      const id = /^fixtures\/([^/]+)\.xlsx$/.exec(path)?.[1];
      if (!id) return 'Binary spreadsheet file';
      try { const table = await readTable(new Map([[path, bytes]]), id); return JSON.stringify({ columns: table.columns, rows: table.rows }, null, 2); }
      catch { return 'Unable to display spreadsheet contents'; }
    }
    Promise.all([render((validFixturePath(path) ? review.fixtureBaseline : review.baseline).get(path)), render((validFixturePath(path) ? review.fixtures : review.files).get(path))]).then(([original, modified]) => { if (active) setTexts({ review, path, original, modified }); });
    return () => { active = false; };
  }, [review, path]);
  if (!review) return null;
  const select = (path: string) => setSelection({ review, path, open: true });
  const accept = () => { studio.turns.accept().catch(studio.report); };
  return <><div className="pending-card"><div className="pending-top"><span><span className="pending-dot" /> REVIEW CHANGES</span><strong>{review.paths.length} {review.paths.length === 1 ? 'file' : 'files'}</strong></div><div className="pending-files">{review.paths.map(path => <button key={path} onClick={() => select(path)}>{iconFor(path)} {path} <ArrowRight size={13} /></button>)}</div><div className="pending-actions"><button disabled={accepting} onClick={() => studio.turns.discard()}>Discard</button><button className="accept" disabled={accepting} onClick={accept}><Check size={14} /> Accept changes</button></div></div>
    {open && texts?.review === review && texts.path === path && createPortal(<DiffReview key={path} path={path} paths={review.paths} original={texts.original} modified={texts.modified} locked={accepting} language={path.endsWith('.xlsx') ? 'json' : language(path)} onPathChange={select} onClose={() => setSelection({ review, path, open: false })} onDiscard={() => studio.turns.discard()} onAccept={accept} />, document.body)}
  </>;
});
