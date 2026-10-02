import { describe, expect, it } from 'vitest';
import { createSession } from './sessionStore';
import { persistSession } from './sessionPersistence';
import { newStudioChat, Stage } from './workspace';

function setup() {
  const a = newStudioChat(), b = newStudioChat();
  return { a, b, session: createSession({ version: 2, chats: [a, b], activeChatId: a.id }, true) };
}

describe('chat identity and session lifecycle', () => {
  it('targets a captured answer and preserves unrelated chat/tool references', () => {
    const { a, b, session } = setup();
    const turn = session.begin('Build this', 0)!;
    expect(session.switchChat(b.id)).toBe(false);
    const before = session.store.getState();
    session.text(turn, 'Hello');
    const after = session.store.getState();
    expect(after.chats[1]).toBe(before.chats[1]);
    expect(after.chats[0].tools).toBe(before.chats[0].tools);
    expect(after.chats[0].chat.find(line => line.id === turn.answerId)?.text).toBe('Hello');
    const returnedHistory = [{ nested: { text: 'owned history' } }];
    session.finish(turn, new Stage(new Map(), 0), returnedHistory);
    returnedHistory[0].nested.text = 'mutated by runner';
    expect(session.store.getState().chats[0].agentMessages).toEqual([{ nested: { text: 'owned history' } }]);
    session.switchChat(b.id);
    session.text(turn, 'Late completion');
    expect(session.store.getState().chats.find(chat => chat.id === a.id)?.chat.at(-1)?.text).toBe('Hello');
    expect(session.store.getState().chats[1].chat).toEqual([]);
  });

  it('ignores old callbacks even when an imported chat reuses the same id', () => {
    const { a, session } = setup();
    const turn = session.begin('Old turn', 0)!;
    session.replaceSession({ version: 2, chats: [a], activeChatId: a.id });
    session.text(turn, 'Stale'); session.finish(turn, new Stage(new Map(), 0), ['old history']);
    expect(session.store.getState().chats[0]).toBe(a);
    expect(session.store.getState().pending).toBeNull();
  });

  it('hydrates without writing defaults, serializes saves, flushes and unsubscribes on stop', async () => {
    const { a, session } = setup();
    const saved: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>(done => { release = done; });
    const persistence = persistSession(session, {
      saveSession: async record => { saved.push(record.chats[0].title); if (saved.length === 1) await blocked; },
      saveReviewChanges: async () => {},
    }, 100_000);
    expect(saved).toEqual([]);
    session.renameChat(a.id, 'First'); const first = persistence.flush();
    await Promise.resolve();
    session.renameChat(a.id, 'Second'); const second = persistence.stop();
    session.renameChat(a.id, 'Ignored');
    release(); await Promise.all([first, second]);
    expect(saved).toEqual(['First', 'Second']);
    persistence.start(); persistence.start();
    session.renameChat(a.id, 'After restart');
    await persistence.stop();
    expect(saved).toEqual(['First', 'Second', 'After restart']);
  });
});
