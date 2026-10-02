import { createStore } from 'zustand/vanilla';
import { copyFiles, newStudioChat, titleForChat, type FileSnapshot, type SavedSession, type Stage, type StudioChat, type ToolLine } from './workspace';

export type Turn = { id: string; chatId: string; answerId: string; generation: number; modelId: string; review: boolean };
export type PendingReview = { turn: Turn; baseRevision: number; files: FileSnapshot; fixtures: FileSnapshot; baseline: FileSnapshot; fixtureBaseline: FileSnapshot; paths: string[] };
export type SessionState = SavedSession & { reviewChanges: boolean; turn: Turn | null; pending: PendingReview | null; accepting: boolean; notice: string };
export const activeChat = (state: SessionState) => state.chats.find(chat => chat.id === state.activeChatId)!;
export const sessionRecord = (state: SessionState): SavedSession => ({ version: 2, chats: state.chats, activeChatId: state.activeChatId });

export function createSession(initial: SavedSession, reviewChanges: boolean) {
  const state = createStore<SessionState>()(() => ({ ...initial, reviewChanges, turn: null, pending: null, accepting: false, notice: '' }));
  const locked = () => Boolean(state.getState().turn || state.getState().pending);
  const updateChat = (id: string, update: (chat: StudioChat) => StudioChat) => state.setState(current => ({
    chats: current.chats.map(chat => chat.id === id ? { ...update(chat), updatedAt: new Date().toISOString() } : chat),
  }));
  const ownsTurn = (turn: Turn) => state.getState().turn === turn;
  const { getState, getInitialState, subscribe } = state;
  return {
    store: { getState, getInitialState, subscribe },
    notice(message: string) { state.setState({ notice: message }); },
    switchChat(id: string) {
      if (locked() || !state.getState().chats.some(chat => chat.id === id)) return false;
      state.setState({ activeChatId: id }); return true;
    },
    newChat() {
      if (locked()) return false;
      const current = state.getState();
      const chat = { ...newStudioChat(activeChat(current).modelId), title: `New chat ${current.chats.length + 1}` };
      state.setState({ chats: [...current.chats, chat], activeChatId: chat.id }); return true;
    },
    renameChat(id: string, title: string) { if (title.trim() && !locked()) updateChat(id, chat => ({ ...chat, title: title.trim() })); },
    chooseModel(modelId: string) {
      if (locked()) return;
      const chat = activeChat(state.getState());
      if (chat.modelId !== modelId) updateChat(chat.id, value => ({ ...value, modelId, agentMessages: [] }));
    },
    setReview(enabled: boolean) { if (!locked()) state.setState({ reviewChanges: enabled }); },
    begin(text: string, generation: number): Turn | null {
      if (locked()) return null;
      const current = state.getState(), chat = activeChat(current);
      const turn: Turn = { id: crypto.randomUUID(), chatId: chat.id, answerId: crypto.randomUUID(), generation, modelId: chat.modelId, review: current.reviewChanges };
      const time = new Date().toISOString();
      state.setState({ turn, chats: current.chats.map(item => item.id !== chat.id ? item : {
        ...chat, updatedAt: time,
        title: !chat.chat.length && /^New chat(?: \d+)?$/.test(chat.title) ? titleForChat(text) : chat.title,
        chat: [...chat.chat, { id: crypto.randomUUID(), role: 'user', text, time }, { id: turn.answerId, role: 'assistant', text: '', time, model: turn.modelId }],
      }) });
      return turn;
    },
    ownsTurn,
    text(turn: Turn, text: string) {
      if (ownsTurn(turn)) updateChat(turn.chatId, chat => ({ ...chat, chat: chat.chat.map(line => line.id === turn.answerId ? { ...line, text } : line) }));
    },
    tool(turn: Turn, line: ToolLine) {
      if (ownsTurn(turn)) updateChat(turn.chatId, chat => ({ ...chat, tools: [...chat.tools.filter(item => item.id !== line.id), line] }));
    },
    finish(turn: Turn, stage: Stage, messages?: unknown[]) {
      if (!ownsTurn(turn)) return;
      const paths = turn.review ? stage.changes() : [];
      const current = state.getState();
      state.setState({ turn: null, pending: paths.length ? { turn, baseRevision: stage.baseRevision, files: copyFiles(stage.files), fixtures: copyFiles(stage.fixtures), baseline: copyFiles(stage.baseline), fixtureBaseline: copyFiles(stage.fixtureBaseline), paths } : null,
        chats: messages ? current.chats.map(chat => chat.id === turn.chatId ? { ...chat, agentMessages: structuredClone(messages) } : chat) : current.chats,
      });
    },
    beginAcceptance(review: PendingReview) {
      if (state.getState().pending !== review || state.getState().accepting) return false;
      state.setState({ accepting: true }); return true;
    },
    endAcceptance(review: PendingReview) { if (state.getState().pending === review) state.setState({ accepting: false }); },
    clearReview(review: PendingReview) { if (state.getState().pending === review) state.setState({ pending: null, accepting: false }); },
    replaceSession(session: SavedSession) { state.setState({ ...session, turn: null, pending: null, accepting: false }); },
    invalidate() {
      const turn = state.getState().turn;
      if (turn) this.text(turn, 'Agent turn ended because the workspace was replaced or closed.');
      state.setState({ turn: null, pending: null, accepting: false });
    },
  };
}
export type StudioSession = ReturnType<typeof createSession>;
