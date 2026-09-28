import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageSquareText, Pencil, Plus } from 'lucide-react';
import type { StudioChat } from './workspace';

type Props = {
  chats: StudioChat[];
  activeId: string;
  locked: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
};

export function ChatSwitcher({ chats, activeId, locked, onSelect, onNew, onRename }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const active = chats.find(chat => chat.id === activeId) || chats[0];
  const recent = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div className="chat-switcher" ref={rootRef}>
    <button className="chat-current" aria-expanded={open} aria-label={`Chats, current: ${active.title}`} onClick={() => setOpen(value => !value)}><MessageSquareText size={14} /><span>{active.title}</span><ChevronDown size={13} /></button>
    <button className="chat-new" title="New chat" aria-label="New chat" disabled={locked} onClick={() => { onNew(); setOpen(false); }}><Plus size={16} /></button>
    {open && <div className="chat-menu"><div className="chat-menu-heading"><span>CHATS</span><span>{chats.length}</span></div>
      {locked && <p>Finish the current turn or review its changes to switch chats.</p>}
      <div className="chat-menu-list">{recent.map(chat => <div key={chat.id} className={`chat-menu-row ${chat.id === activeId ? 'active' : ''}`}>
        {editingId === chat.id ? <input autoFocus aria-label="Chat name" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { onRename(chat.id, draft.trim()); setEditingId(null); } if (event.key === 'Escape') setEditingId(null); }} onBlur={() => { onRename(chat.id, draft.trim()); setEditingId(null); }} /> : <button className="chat-menu-select" disabled={locked && chat.id !== activeId} onClick={() => { onSelect(chat.id); setOpen(false); }}><span>{chat.title}</span><small>{chat.chat.length} {chat.chat.length === 1 ? 'message' : 'messages'} · {new Date(chat.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></button>}
        <button className="chat-rename" aria-label={`Rename ${chat.title}`} title="Rename chat" disabled={locked} onClick={() => { setEditingId(chat.id); setDraft(chat.title); }}><Pencil size={12} /></button>
      </div>)}</div>
      <button className="chat-menu-new" disabled={locked} onClick={() => { onNew(); setOpen(false); }}><Plus size={13} /> New chat</button>
    </div>}
  </div>;
}
