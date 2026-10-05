import { sessionRecord, type StudioSession } from './sessionStore';
import type { SavedSession } from './workspace';

type Persistence = { identity?: () => string; saveSession: (session: SavedSession, identity?: string) => Promise<void>; saveReviewChanges: (review: boolean, identity?: string) => Promise<void> };

// Subscribe only after hydration. Session records retain their existing format;
// credentials, stages, notices and runtime resources never enter persistence.
export function persistSession(session: StudioSession, storage: Persistence, delay = 350) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let dirty = false;
  let last = session.store.getState();
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (!dirty) return queue;
    dirty = false;
    const captured = session.store.getState(), identity = storage.identity?.();
    queue = queue.then(async () => {
      await storage.saveSession(sessionRecord(captured), identity);
      await storage.saveReviewChanges(captured.reviewChanges, identity);
    }).catch(error => session.notice(`Could not save session: ${String(error)}`));
    return queue;
  };
  let unsubscribe: (() => void) | undefined;
  const start = () => {
    if (unsubscribe) return;
    last = session.store.getState();
    unsubscribe = session.store.subscribe(next => {
      const changed = next.chats !== last.chats || next.activeChatId !== last.activeChatId || next.reviewChanges !== last.reviewChanges;
      last = next;
      if (!changed) return;
      dirty = true; clearTimeout(timer); timer = setTimeout(flush, delay);
    });
  };
  start();
  return { start, flush, stop() { unsubscribe?.(); unsubscribe = undefined; return flush(); } };
}
