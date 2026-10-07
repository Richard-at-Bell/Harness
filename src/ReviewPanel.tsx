import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check } from 'lucide-react';
import { DiffReview } from './DiffReview';
import { iconFor, language } from './filePresentation';
import { datasetMeaning } from './datasets';
import { readTable } from './fixtures';
import { useSession, useStudio } from './studioContext';
import { toText, validFixturePath, type FileSnapshot } from './workspace';

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
    async function render(files: FileSnapshot) {
      const bytes = files.get(path);
      if (!bytes) return '';
      if (!validFixturePath(path)) return toText(bytes);
      const stem = path.replace(/\.(csv|xlsx|dataset\.json)$/, '');
      const source = [...files.keys()].find(p => p === stem + '.csv' || p === stem + '.xlsx');
      if (!source) return toText(bytes);
      const metadata = files.get(stem + '.dataset.json');
      const id = metadata ? JSON.parse(toText(metadata)).definition.id : stem.slice(9);
      try { return JSON.stringify(datasetMeaning(await readTable(files, id)), null, 2); }
      catch (error) { return `Unable to display dataset: ${String(error)}`; }
    }
    Promise.all([render(validFixturePath(path) ? review.fixtureBaseline : review.baseline), render(validFixturePath(path) ? review.fixtures : review.files)]).then(([original, modified]) => { if (active) setTexts({ review, path, original, modified }); });
    return () => { active = false; };
  }, [review, path]);
  if (!review) return null;
  const select = (path: string) => setSelection({ review, path, open: true });
  const accept = () => { studio.turns.accept().catch(studio.report); };
  return <><div className="pending-card"><div className="pending-top"><span><span className="pending-dot" /> REVIEW CHANGES</span><strong>{review.paths.length} {review.paths.length === 1 ? 'file' : 'files'}</strong></div><div className="pending-files">{review.paths.map(path => <button key={path} onClick={() => select(path)}>{iconFor(path)} {path} <ArrowRight size={13} /></button>)}</div><div className="pending-actions"><button disabled={accepting} onClick={() => studio.turns.discard()}>Discard</button><button className="accept" disabled={accepting} onClick={accept}><Check size={14} /> Accept changes</button></div></div>
    {open && texts?.review === review && texts.path === path && createPortal(<DiffReview key={path} path={path} paths={review.paths} original={texts.original} modified={texts.modified} locked={accepting} language={validFixturePath(path) ? 'json' : language(path)} onPathChange={select} onClose={() => setSelection({ review, path, open: false })} onDiscard={() => studio.turns.discard()} onAccept={accept} />, document.body)}
  </>;
});
