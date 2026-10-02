import { useShallow } from 'zustand/react/shallow';
import { iconFor } from './filePresentation';
import { useWorkspace } from './studioContext';
export function FileList({ selected, onSelect }: { selected: string; onSelect: (path: string) => void }) {
  const paths = useWorkspace(useShallow(state => [...state.files.keys()].sort((a, b) => a.localeCompare(b))));
  return <div className="file-list">{paths.map(path => <button key={path} className={`file-item ${selected === path ? 'selected' : ''}`} onClick={() => onSelect(path)}>{iconFor(path)} <span>{path}</span></button>)}</div>;
}
