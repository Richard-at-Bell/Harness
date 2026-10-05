import { createContext, useContext, useState, type ReactNode } from 'react';
import { EditorDocuments } from './editorDocuments';
import { TableDocuments } from './tableDocuments';
import { useGeneration, useStudio } from './studioContext';

type Documents = { files: EditorDocuments; tables: TableDocuments };
const DocumentContext = createContext<Documents | null>(null);

// Shared with navigation, but still owned and observed by their editing panes.
// The provider is keyed by workspace generation so replacements drop old drafts.
export function DocumentProvider({ children }: { children: ReactNode }) {
  const studio = useStudio(), generation = useGeneration();
  const [documents] = useState<Documents>(() => ({
    files: new EditorDocuments((path, text, bytes, isCurrent) => studio.saveFile(path, text, generation, { bytes, isCurrent }), studio.report, () => studio.workspace.store.getState().files),
    tables: new TableDocuments(() => studio.workspace.store.getState().fixtures, (table, baseline, convert) => studio.saveTable(table, baseline, generation, convert), studio.report),
  }));
  return <DocumentContext.Provider value={documents}>{children}</DocumentContext.Provider>;
}

export function useDocuments() {
  const documents = useContext(DocumentContext);
  if (!documents) throw new Error('Document provider is required');
  return documents;
}
