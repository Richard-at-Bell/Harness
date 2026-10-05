import { useShallow } from 'zustand/react/shallow';
import { useStore } from 'zustand';
import { useDocuments } from './documentContext';
import { iconFor } from './filePresentation';
import { useWorkspace } from './studioContext';
export function FileList({ selected, onSelect }: { selected: string; onSelect: (path: string) => void }) {
  const acceptedPaths = useWorkspace(useShallow(state => [...state.files.keys()]));
  const accepted = new Set(acceptedPaths);
  const { files: documents } = useDocuments();
  const drafts = useStore(documents.store, useShallow(state => [...state.drafts.keys()].filter(path => !accepted.has(path))));
  const paths = [...acceptedPaths, ...drafts].sort((a, b) => a.localeCompare(b));
  return <div className="file-list">{paths.map(path => <button key={path} className={`file-item ${selected === path ? 'selected' : ''}`} onClick={() => onSelect(path)}>{iconFor(path)} <span>{path}{!accepted.has(path) && <small className="removed-draft">Deleted · draft</small>}</span></button>)}</div>;
}
