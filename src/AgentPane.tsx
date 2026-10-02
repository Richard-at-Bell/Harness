import { memo, useEffect, useRef, useState } from 'react';
import { ArrowRight, MessageSquareText, PanelRightClose, Send, Sparkles } from 'lucide-react';
import { ActivityPanel } from './ActivityPanel';
import { ChatSwitcher } from './ChatSwitcher';
import { ModelPicker } from './ModelPicker';
import { ReviewPanel } from './ReviewPanel';
import { ReviewToggle } from './ReviewToggle';
import { modelName } from './models';
import { activeChat } from './sessionStore';
import { useGeneration, useSession, useStudio } from './studioContext';

const SessionSwitcher = memo(function SessionSwitcher() {
  const studio = useStudio();
  const chats = useSession(state => state.chats), activeId = useSession(state => state.activeChatId);
  const locked = useSession(state => Boolean(state.turn || state.pending));
  return <ChatSwitcher chats={chats} activeId={activeId} locked={locked} onSelect={studio.session.switchChat} onNew={studio.session.newChat} onRename={studio.session.renameChat} />;
});
const Transcript = memo(function Transcript({ suggest }: { suggest: (prompt: string) => void }) {
  const chat = useSession(state => activeChat(state).chat);
  const busy = useSession(state => Boolean(state.turn));
  const reviewChanges = useSession(state => state.reviewChanges);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat, busy]);
  return <>
    {!chat.length && <div className="empty-chat"><div className="empty-chat-icon"><MessageSquareText size={21} /></div><h2>What should we make?</h2><p>Ask the agent to shape your project. {reviewChanges ? 'Review each turn before applying it.' : 'Edits apply automatically as the agent works.'}</p><div className="suggestions"><button onClick={() => suggest('Add a priority field to tasks and show high-priority tasks first.')}>Add task priorities <ArrowRight size={14} /></button><button onClick={() => suggest('Make the to-do app work well on small screens.')}>Improve mobile layout <ArrowRight size={14} /></button><button onClick={() => suggest('Add a filter for all, open, and completed tasks.')}>Add task filters <ArrowRight size={14} /></button></div></div>}
    {chat.map(line => <div key={line.id} className={`chat-line ${line.role}`}><div className="chat-avatar">{line.role === 'user' ? 'You' : <Sparkles size={14} />}</div><div className="chat-body"><span className="chat-role">{line.role === 'user' ? 'You' : line.model ? modelName(line.model) : 'Agent'}</span><div className="chat-text">{line.text || (busy ? <span className="typing">Thinking<span>…</span></span> : '')}</div></div></div>)}
    <SessionActivity /><ReviewPanel /><div ref={bottom} />
  </>;
});
const SessionActivity = memo(function SessionActivity() { const tools = useSession(state => activeChat(state).tools); return <ActivityPanel tools={tools} />; });

export const AgentPane = memo(function AgentPane({ open, onClose, apiKey, onNeedsKey }: { open: boolean; onClose: () => void; apiKey: string; onNeedsKey: () => void }) {
  const studio = useStudio();
  const activeChatId = useSession(state => state.activeChatId);
  const generation = useGeneration();
  const modelId = useSession(state => activeChat(state).modelId);
  const busy = useSession(state => Boolean(state.turn));
  const locked = useSession(state => Boolean(state.turn || state.pending));
  const reviewChanges = useSession(state => state.reviewChanges);
  const [prompt, setPrompt] = useState('');
  useEffect(() => { setPrompt(''); }, [activeChatId, generation]);
  const send = () => {
    if (!prompt.trim() || busy) return;
    if (!apiKey.trim()) { onNeedsKey(); return; }
    if (locked) { studio.flash('Review the pending change before starting another agent turn.'); return; }
    const text = prompt; setPrompt(''); void studio.turns.send(text, apiKey);
  };
  return <aside className="agent-pane" style={{ display: open ? undefined : 'none' }}><div className="agent-header"><div className="agent-header-top"><div><div className="agent-title"><Sparkles size={16} /> Agent</div><span>Build with your workspace</span></div><button onClick={onClose} title="Hide agent"><PanelRightClose size={18} /></button></div><SessionSwitcher /></div>
    <div className="agent-scroll"><Transcript suggest={setPrompt} /></div>
    <div className="composer"><ReviewToggle enabled={reviewChanges} locked={locked} onChange={studio.session.setReview} /><div className="composer-box"><textarea placeholder="Ask the agent to edit your project…" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} rows={3} /><div className="composer-bottom"><ModelPicker key={activeChatId} modelId={modelId} connected={Boolean(apiKey)} locked={locked} onSelect={studio.session.chooseModel} /><button className="send-button" disabled={!prompt.trim() || busy} onClick={send} title="Send"><Send size={16} /></button></div></div><p id="agent-edit-policy">{reviewChanges ? 'Changes wait for your acceptance.' : 'Edits apply as the agent works.'}{!apiKey && ' Add a key using the key icon to start.'}</p></div>
  </aside>;
});
