import { describe, expect, it } from 'vitest';
import type { runAgent } from './agent';
import { createAgentTurns } from './agentTurns';
import { createSession } from './sessionStore';
import { newStudioChat, toBytes, Workspace } from './workspace';

function setup(runner: typeof runAgent, write: () => Promise<void> = async () => {}) {
  const workspace = new Workspace({ write, remove: async () => {} }, new Map([['index.html', toBytes('Old')]]));
  const chat = newStudioChat();
  const session = createSession({ version: 2, chats: [chat], activeChatId: chat.id }, true);
  let generation = 0;
  const turns = createAgentTurns({ workspace, session, generation: () => generation, flash: () => {}, transact: (captured, operation) => workspace.transaction(writer => { if (captured !== generation) throw new Error('Old workspace'); return operation(writer); }) }, runner);
  return { workspace, session, turns, replace() { generation++; turns.cancel(); session.replaceSession({ version: 2, chats: [chat], activeChatId: chat.id }); } };
}

describe('agent workflow coordination', () => {
  it('prevents discard and duplicate acceptance while a review is being saved', async () => {
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const saving = new Promise<void>(done => { started = done; });
    const context = setup(async (_text, _key, _model, stage) => { stage.write('index.html', 'Accepted'); return { text: 'Done', messages: [] }; }, async () => { started(); await gate; });
    await context.turns.send('Edit', 'key');
    const accepting = context.turns.accept();
    await saving;
    context.turns.discard(); await context.turns.accept();
    expect(context.session.store.getState().pending).not.toBeNull();
    expect(context.session.store.getState().accepting).toBe(true);
    release(); await accepting;
    expect(context.workspace.text('index.html')).toBe('Accepted');
    expect(context.session.store.getState().pending).toBeNull();
    expect(context.session.store.getState().accepting).toBe(false);
  });

  it('ignores delayed text, history and staged completion after replacement', async () => {
    let resume!: () => void;
    const gate = new Promise<void>(done => { resume = done; });
    let started!: () => void;
    const running = new Promise<void>(done => { started = done; });
    const context = setup(async (_text, _key, _model, stage, _history, callbacks) => {
      started(); await gate;
      stage.write('index.html', 'Stale'); callbacks.onText('Stale answer');
      return { text: 'Stale answer', messages: [] };
    });
    const sending = context.turns.send('Edit this', 'memory-key');
    await running; context.replace(); resume(); await sending;
    expect(context.session.store.getState().chats[0].chat).toEqual([]);
    expect(context.session.store.getState().pending).toBeNull();
    expect(context.workspace.text('index.html')).toBe('Old');
  });

  it('retains staged edits on failure and rejects acceptance after a queued workspace change', async () => {
    const context = setup(async (_text, _key, _model, stage) => { stage.write('index.html', 'Review me'); throw new Error('provider failed'); });
    await context.turns.send('Edit', 'key');
    expect(context.session.store.getState().pending?.paths).toEqual(['index.html']);
    expect(context.session.store.getState().chats[0].chat.at(-1)?.text).toContain('provider failed');
    const editing = context.workspace.write('index.html', toBytes('User edit'));
    const acceptance = context.turns.accept();
    await editing;
    await expect(acceptance).rejects.toThrow('project changed');
    expect(context.workspace.text('index.html')).toBe('User edit');
    expect(context.session.store.getState().pending).not.toBeNull();
    context.turns.discard();
    expect(context.session.store.getState().pending).toBeNull();
  });

  it('keeps successful automatic edits after a later agent failure', async () => {
    const context = setup(async (_text, _key, _model, stage, _history, callbacks) => {
      await callbacks.beforeTool?.();
      const before = stage.read('index.html'); stage.write('index.html', 'Applied');
      await callbacks.onChange?.({ path: 'index.html', before, after: stage.read('index.html') });
      throw new Error('later failure');
    });
    context.session.setReview(false);
    await context.turns.send('Edit', 'key');
    expect(context.workspace.text('index.html')).toBe('Applied');
    expect(context.session.store.getState().pending).toBeNull();
    expect(context.session.store.getState().turn).toBeNull();
  });

  it('publishes detached review data and clears review only after acceptance', async () => {
    let workingStage: Parameters<typeof runAgent>[3] | undefined;
    const context = setup(async (_text, _key, _model, stage) => { workingStage = stage; stage.write('index.html', 'Accepted'); return { text: 'Done', messages: [] }; });
    await context.turns.send('Edit', 'key');
    workingStage!.files.get('index.html')!.fill(0);
    await context.turns.accept();
    expect(context.workspace.text('index.html')).toBe('Accepted');
    expect(context.session.store.getState().pending).toBeNull();
  });
});
