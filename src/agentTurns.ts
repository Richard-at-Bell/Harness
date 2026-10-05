import { runAgent } from './agent';
import { applyAgentChange } from './agentChanges';
import { activeChat, type StudioSession } from './sessionStore';
import { copyFiles, type Workspace, type WorkspaceWriter } from './workspace';

export type TurnContext = {
  workspace: Workspace;
  session: StudioSession;
  generation: () => number;
  transact: <T>(generation: number, operation: (writer: WorkspaceWriter) => Promise<T>) => Promise<T>;
  flash: (message: string) => void;
  isAvailable?: () => boolean;
};

export function createAgentTurns(context: TurnContext, runner = runAgent) {
  const { workspace, session } = context;
  let abort: AbortController | null = null;
  return {
    cancel() { abort?.abort(); session.invalidate(); },
    async send(text: string, key: string) {
      text = text.trim();
      if (!text || !key.trim() || context.isAvailable?.() === false) return false;
      // Capture identity, mode and model before any asynchronous work.
      const prior = activeChat(session.store.getState()).agentMessages;
      const turn = session.begin(text, context.generation());
      if (!turn) return false;
      const controller = new AbortController(); abort = controller;
      const valid = () => session.ownsTurn(turn) && turn.generation === context.generation() && !controller.signal.aborted;
      const check = () => { if (!valid()) throw new Error('Agent turn no longer belongs to this workspace'); };
      let stage = workspace.stage();
      let applied = 0;
      try {
        stage = await context.transact(turn.generation, async writer => { check(); return writer.stage(); });
        const outcome = await runner(text, key.trim(), turn.modelId, stage, prior, {
          signal: controller.signal,
          onText: value => { if (valid()) session.text(turn, value); },
          onTool: line => { if (valid()) session.tool(turn, line); },
          beforeTool: async () => {
            check();
            if (!turn.review) await context.transact(turn.generation, async writer => { check(); stage.files = writer.snapshot(); stage.fixtures = writer.fixtureSnapshot(); });
          },
          onChange: turn.review ? undefined : change => context.transact(turn.generation, async writer => {
            check(); if (await applyAgentChange(writer, change)) applied++;
          }),
        });
        if (valid()) {
          session.text(turn, outcome.text || 'Done.');
          session.finish(turn, stage, outcome.messages);
          if (applied) context.flash('Agent changes applied automatically.');
        }
      } catch (error) {
        if (valid()) {
          session.text(turn, `Agent error: ${String(error instanceof Error ? error.message : error)}`);
          session.finish(turn, stage);
        }
      } finally { if (abort === controller) abort = null; }
      return true;
    },
    async accept() {
      const review = session.store.getState().pending;
      if (!review || !session.beginAcceptance(review)) return;
      try {
        await context.transact(review.turn.generation, async writer => {
          if (session.store.getState().pending !== review) throw new Error('This review is no longer pending');
          if (writer.revision !== review.baseRevision) throw new Error('The project changed during this turn. Discard the staged change and ask the agent to retry.');
          await writer.replace(copyFiles(review.files), copyFiles(review.fixtures));
        });
        session.clearReview(review);
        context.flash('Agent changes accepted.');
      } finally { session.endAcceptance(review); }
    },
    discard() {
      const review = session.store.getState().pending;
      if (review && !session.store.getState().accepting) { session.clearReview(review); context.flash('Agent changes discarded.'); }
    },
  };
}
