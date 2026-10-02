import { sessionRecord, type StudioSession } from './sessionStore';
import { saveReviewChanges, saveSession, type SavedSession } from './workspace';

type Persistence = { saveSession: (session: SavedSession) => Promise<void>; saveReviewChanges: (review: boolean) => Promise<void> };

// Subscribe only after hydration. Session records retain their existing format;
// credentials, stages, notices and runtime resources never enter persistence.
export function persistSession(session: StudioSession, storage: Persistence = { saveSession, saveReviewChanges }, delay = 350) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let dirty = false;
  let last = session.store.getState();
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (!dirty) return queue;
    dirty = false;
    const captured = session.store.getState();
    queue = queue.then(async () => {
      await storage.saveSession(sessionRecord(captured));
      await storage.saveReviewChanges(captured.reviewChanges);
    }).catch(error => session.notice(`Could not save session: ${String(error)}`));
    return queue;
  };
  const unsubscribe = session.store.subscribe(next => {
    const changed = next.chats !== last.chats || next.activeChatId !== last.activeChatId || next.reviewChanges !== last.reviewChanges;
    last = next;
    if (!changed) return;
    dirty = true; clearTimeout(timer); timer = setTimeout(flush, delay);
  });
  return { flush, stop() { unsubscribe(); return flush(); } };
}
