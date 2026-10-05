import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { StudioRuntime } from './studioRuntime';
import type { SessionState } from './sessionStore';
import type { WorkspaceSnapshot } from './workspace';

export const StudioContext = createContext<StudioRuntime | null>(null);
export function useStudio() { const studio = useContext(StudioContext); if (!studio) throw new Error('Studio provider is required'); return studio; }
export function useSession<T>(selector: (state: SessionState) => T): T { return useStore(useStudio().session.store, selector); }
export function useWorkspace<T>(selector: (state: WorkspaceSnapshot) => T): T { return useStore(useStudio().workspace.store, selector); }
export function useGeneration() { return useStore(useStudio().lifecycleStore, state => state.generation); }

export function useLifecycle<T>(selector: (state: import('./studioRuntime').Lifecycle) => T): T { return useStore(useStudio().lifecycleStore, selector); }
