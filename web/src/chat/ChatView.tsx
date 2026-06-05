import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Plus, Hash, AtSign, Star, MessageSquare, Send, Paperclip, Smile, Reply, Pencil, Trash2, X, FileText, File as FileIcon, Search } from 'lucide-react';
import { api, apiGet, apiSend, getToken, API_BASE } from '../api';
import { UserAvatar } from '../UserAvatar';
import { FileViewer } from '../files/FileViewer';
import { fileKind } from '../files/fileIcons';
import { useChatSocket } from './useChatSocket';
import { buildAtItems, type AtItem } from '../shared/atMenu';
import { TodoModal } from '../shared/TodoModal';
import { TaskLinkChip } from '../collab/inlineSpecs';

type Room = any; type Msg = any;
const EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥', '✅', '😍', '😢'];
const statusDot: Record<string, string> = { active: '#1e8e3e', away: '#f9ab00', dnd: '#d93025', offline: '#9aa0a6' };

function dayLabel(d: Date) {
  const t = new Date(); const y = new Date(t.getTime() - 86400000);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function ChatView({ currentUser, onClose, onOpenDoc, onBadgeChange }: { currentUser: any, onClose: () => void, onOpenDoc: (id: string) => void, onBadgeChange: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [view, setView] = useState<'room' | 'mentions' | 'starred'>('room');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [mentions, setMentions] = useState<Msg[]>([]);
  const [presence, setPresence] = useState<Record<string, { online: boolean, status: string }>>({});
  const [typing, setTyping] = useState<Record<string, number>>({}); // userId -> expiry
  const [thread, setThread] = useState<Msg | null>(null);
  const [threadMsgs, setThreadMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState(currentUser.chatStatus || 'active');
  const [newChat, setNewChat] = useState(false);
  const [viewerNode, setViewerNode] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const t = setTimeout(() => apiGet(`/api/chat/search?q=${encodeURIComponent(search)}`).then(setSearchResults).catch(() => setSearchResults([])), 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadRooms = useCallback(() => { apiGet('/api/chat/rooms').then(setRooms).catch(() => {}); onBadgeChange(); }, [onBadgeChange]);
  const loadMessages = (rid: string) => apiGet(`/api/chat/rooms/${rid}/messages`).then(setMessages).catch(() => {});
  useEffect(() => { loadRooms(); apiGet('/api/chat/mentions').then(setMentions).catch(() => {}); }, []);

  const upsertMsg = (m: Msg) => setMessages(prev => prev.some(x => x.id === m.id) ? prev.map(x => x.id === m.id ? m : x) : [...prev, m]);

  // Live events
  const send = useChatSocket(useCallback((ev: any) => {
    if (ev.t === 'message') {
      if (ev.roomId === activeId && !ev.message.parentId) upsertMsg(ev.message);
      else if (thread && ev.message.parentId === thread.id) setThreadMsgs(p => p.some(x => x.id === ev.message.id) ? p : [...p, ev.message]);
      loadRooms();
    } else if (ev.t === 'message:edit') {
      setMessages(p => p.map(x => x.id === ev.message.id ? ev.message : x));
      setThreadMsgs(p => p.map(x => x.id === ev.message.id ? ev.message : x));
    } else if (ev.t === 'message:delete') {
      setMessages(p => p.map(x => x.id === ev.messageId ? { ...x, deleted: true, text: '' } : x));
    } else if (ev.t === 'reaction') {
      setMessages(p => p.map(x => x.id === ev.messageId ? { ...x, reactions: ev.reactions } : x));
      setThreadMsgs(p => p.map(x => x.id === ev.messageId ? { ...x, reactions: ev.reactions } : x));
    } else if (ev.t === 'typing') {
      if (ev.roomId === activeId) setTyping(p => ({ ...p, [ev.userId]: Date.now() + 4000 }));
    } else if (ev.t === 'presence') {
      setPresence(p => ({ ...p, [ev.userId]: { online: ev.online, status: ev.status || 'active' } }));
    } else if (ev.t === 'room') {
      loadRooms(); if (ev.roomId === activeId) apiGet(`/api/chat/rooms/${activeId}`).then(setRoom);
    }
  }, [activeId, thread, loadRooms]));

  // open a room
  const openRoom = (rid: string) => {
    setView('room'); setActiveId(rid); setThread(null);
    apiGet(`/api/chat/rooms/${rid}`).then(setRoom);
    loadMessages(rid);
    apiSend(`/api/chat/rooms/${rid}/read`, 'POST').then(loadRooms);
    send({ t: 'read', roomId: rid, lastReadAt: Date.now() });
  };
  useEffect(() => { if (activeId) { const el = scrollRef.current; if (el) setTimeout(() => el.scrollTop = el.scrollHeight, 50); } }, [messages, activeId]);
  // expire typing
  useEffect(() => { const t = setInterval(() => setTyping(p => { const n: any = {}; for (const k in p) if (p[k] > Date.now()) n[k] = p[k]; return n; }), 1500); return () => clearInterval(t); }, []);

  const sendMessage = async (text: string, refs: any, attachments: string[], parentId?: string) => {
    if (!text.trim() && attachments.length === 0) return;
    const res = await apiSend(`/api/chat/rooms/${activeId}/messages`, 'POST', { text, refs, attachments, parentId });
    if (res.ok) { const m = await res.json(); if (parentId) setThreadMsgs(p => [...p, m]); else upsertMsg(m); loadRooms(); }
  };
  const react = (mid: string, emoji: string) => apiSend(`/api/chat/messages/${mid}/react`, 'POST', { emoji });
  const editMsg = (mid: string, text: string) => apiSend(`/api/chat/messages/${mid}`, 'PATCH', { text });
  const delMsg = (mid: string) => api(`/api/chat/messages/${mid}`, { method: 'DELETE' });
  const openThread = (m: Msg) => { setThread(m); apiGet(`/api/chat/messages/${m.id}/replies`).then(setThreadMsgs); };
  const changeStatus = async (s: string) => { setStatus(s); await apiSend('/api/chat/status', 'POST', { status: s }); };
  const toggleStar = async (r: Room) => { await apiSend(`/api/chat/rooms/${r.id}/me`, 'PATCH', { starred: !r.starred }); loadRooms(); };

  const dms = rooms.filter(r => r.type === 'direct');
  const groups = rooms.filter(r => r.type === 'group');
  const spaces = rooms.filter(r => r.type === 'space');
  const starred = rooms.filter(r => r.starred);
  const typers = Object.keys(typing).filter(u => u !== currentUser.id);

  const presenceOf = (uid: string) => presence[uid]?.online ? (presence[uid]?.status || 'active') : 'offline';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--m3-bg)' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: '1px solid var(--m3-border)', background: 'var(--m3-surface)' }}>
        <button onClick={onClose} className="m3-small-btn" style={{ border: 'none' }}><ArrowLeft size={18} /> Back</button>
        <MessageSquare size={20} color="var(--m3-primary)" /><h1 style={{ fontSize: '20px', fontWeight: 500 }}>Chat</h1>
        {/* Search in chat and spaces */}
        <div style={{ position: 'relative', flex: 1, maxWidth: '520px', margin: '0 auto' }}>
          <Search size={16} style={{ position: 'absolute', left: '14px', top: '11px', color: 'var(--m3-text-secondary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search in chat and spaces"
            style={{ width: '100%', padding: '9px 14px 9px 40px', borderRadius: '20px', border: 'none', background: 'var(--m3-surface-container)', color: 'var(--m3-text-primary)', outline: 'none', fontSize: '14px' }} />
          {searchResults && (
            <div style={{ position: 'absolute', left: 0, right: 0, top: '44px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '12px', boxShadow: '0 6px 20px rgba(0,0,0,0.16)', zIndex: 40, maxHeight: '360px', overflowY: 'auto' }}>
              {searchResults.length === 0 && <div style={{ padding: '16px', color: 'var(--m3-text-secondary)', fontSize: '14px' }}>No messages found.</div>}
              {searchResults.map((m: any) => (
                <div key={m.id} className="m3-menu-item" style={{ display: 'flex', gap: '10px' }} onClick={() => { setSearch(''); setSearchResults(null); openRoom(m.roomId); }}>
                  <UserAvatar id={m.senderId} name={m.senderName} size={28} />
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{m.senderName} · {timeLabel(new Date(m.createdAt))}</div><div style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.text}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--m3-surface-container)', borderRadius: '20px', padding: '4px 6px 4px 12px' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusDot[status] }} />
          <select value={status} onChange={e => changeStatus(e.target.value)} style={{ border: 'none', background: 'transparent', fontSize: '14px', fontWeight: 500, color: 'var(--m3-text-primary)', cursor: 'pointer', outline: 'none' }}>
            <option value="active">Active</option><option value="away">Away</option><option value="dnd">Do not disturb</option>
          </select>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Rail */}
        <div style={{ width: '260px', borderRight: '1px solid var(--m3-border)', overflowY: 'auto', padding: '12px 8px', flexShrink: 0 }}>
          <button className="m3-action-button" style={{ width: '100%', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={() => setNewChat(true)}><Plus size={16} /> New chat</button>
          <div className={`m3-nav-item ${view === 'mentions' ? 'active' : ''}`} onClick={() => { setView('mentions'); setActiveId(null); apiGet('/api/chat/mentions').then(setMentions); }}><AtSign size={18} /> Mentions</div>
          <div className={`m3-nav-item ${view === 'starred' ? 'active' : ''}`} onClick={() => { setView('starred'); setActiveId(null); }}><Star size={18} /> Starred</div>

          <RailSection title="Direct messages">
            {dms.length === 0 && <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', padding: '4px 12px' }}>No conversations yet.</div>}
            {dms.map(r => <RoomItem key={r.id} r={r} active={activeId === r.id} presence={presenceOf(r.other?.id)} onClick={() => openRoom(r.id)} onStar={() => toggleStar(r)} />)}
          </RailSection>
          {groups.length > 0 && <RailSection title="Group chats">{groups.map(r => <RoomItem key={r.id} r={r} active={activeId === r.id} onClick={() => openRoom(r.id)} onStar={() => toggleStar(r)} />)}</RailSection>}
          <RailSection title="Spaces">
            {spaces.map(r => <RoomItem key={r.id} r={r} active={activeId === r.id} onClick={() => openRoom(r.id)} onStar={() => toggleStar(r)} />)}
            <div style={{ fontSize: '13px', color: 'var(--m3-primary)', padding: '6px 12px', cursor: 'pointer' }} onClick={() => setNewChat(true)}>+ Create or find a space</div>
          </RailSection>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {view === 'mentions' ? (
              <MentionList items={mentions} onOpenRoom={openRoom} />
            ) : view === 'starred' ? (
              <div style={{ padding: '24px' }}><h2 style={{ fontWeight: 500, marginBottom: '12px' }}>Starred</h2>{starred.length === 0 ? <div style={{ color: 'var(--m3-text-secondary)' }}>Star a conversation to pin it here.</div> : starred.map(r => <RoomItem key={r.id} r={r} active={false} onClick={() => openRoom(r.id)} />)}</div>
            ) : !activeId ? (
              <Welcome name={currentUser.name} onNew={() => setNewChat(true)} />
            ) : (
              <>
                {/* conversation header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', borderBottom: '1px solid var(--m3-border)', background: 'var(--m3-surface)' }}>
                  <div style={{ fontWeight: 600, fontSize: '16px' }}>{room?.title || '…'}</div>
                  {room?.topic && <span style={{ fontSize: '13px', color: 'var(--m3-text-secondary)' }}>{room.topic}</span>}
                  {room?.type !== 'direct' && <span style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>· {room?.members?.length} members</span>}
                  <button className="m3-small-btn" style={{ border: 'none', marginLeft: 'auto' }} onClick={() => { const r = rooms.find(x => x.id === activeId); if (r) toggleStar(r); }} title="Star"><Star size={16} fill={rooms.find(r => r.id === activeId)?.starred ? '#f9ab00' : 'none'} color={rooms.find(r => r.id === activeId)?.starred ? '#f9ab00' : 'currentColor'} /></button>
                </div>
                {/* messages */}
                <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                  {groupByDay(messages).map(([day, msgs]) => (
                    <div key={day}>
                      <div style={{ textAlign: 'center', margin: '12px 0', fontSize: '12px', color: 'var(--m3-text-secondary)' }}><span style={{ background: 'var(--m3-surface-2)', padding: '2px 12px', borderRadius: '12px' }}>{day}</span></div>
                      {msgs.map(m => <MessageRow key={m.id} m={m} me={currentUser.id} onReact={react} onEdit={editMsg} onDelete={delMsg} onThread={openThread} onOpenDoc={onOpenDoc} onOpenFile={setViewerNode} />)}
                    </div>
                  ))}
                  {typers.length > 0 && <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', padding: '4px 0' }}>{typers.map(u => room?.members?.find((m: any) => m.id === u)?.name || 'Someone').join(', ')} typing…</div>}
                </div>
                <Composer currentUserId={currentUser.id} onSend={(t: string, r: any, a: string[]) => sendMessage(t, r, a)} onTyping={() => send({ t: "typing", roomId: activeId })} />
              </>
            )}
          </div>

          {/* Thread panel */}
          {thread && (
            <div style={{ width: '380px', borderLeft: '1px solid var(--m3-border)', display: 'flex', flexDirection: 'column', background: 'var(--m3-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--m3-border)' }}>
                <strong>Thread</strong><button className="m3-small-btn" style={{ border: 'none' }} onClick={() => setThread(null)}><X size={16} /></button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                <MessageRow m={thread} me={currentUser.id} onReact={react} onEdit={editMsg} onDelete={delMsg} onThread={() => {}} onOpenDoc={onOpenDoc} onOpenFile={setViewerNode} compact />
                <div style={{ borderTop: '1px solid var(--m3-border)', margin: '8px 0', paddingTop: '8px', fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{threadMsgs.length} replies</div>
                {threadMsgs.map(m => <MessageRow key={m.id} m={m} me={currentUser.id} onReact={react} onEdit={editMsg} onDelete={delMsg} onThread={() => {}} onOpenDoc={onOpenDoc} onOpenFile={setViewerNode} compact />)}
              </div>
              <Composer currentUserId={currentUser.id} placeholder="Reply in thread…" onSend={(t: string, r: any, a: string[]) => sendMessage(t, r, a, thread.id)} onTyping={() => { }} />
            </div>
          )}
        </div>
      </div>

      {newChat && <NewChatModal currentUser={currentUser} onClose={() => setNewChat(false)} onOpenRoom={(rid: string) => { setNewChat(false); loadRooms(); openRoom(rid); }} />}
      {viewerNode && <FileViewer node={viewerNode} onClose={() => setViewerNode(null)} onDownload={(n) => api(`/api/nodes/${n.id}/download`).then(async r => { const b = await r.blob(); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = n.name; a.click(); })} />}
    </div>
  );
}

function RailSection({ title, children }: any) {
  return <div style={{ marginTop: '14px' }}><div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--m3-text-secondary)', textTransform: 'uppercase', padding: '4px 12px' }}>{title}</div>{children}</div>;
}
function RoomItem({ r, active, onClick, presence, icon, onStar }: any) {
  const [hover, setHover] = useState(false);
  // last-message preview, with a "Sender: " prefix for group/space rooms
  let preview = r.lastMessage?.text || '';
  if (preview && r.type !== 'direct' && r.lastMessage) {
    const sender = r.members?.find((m: any) => m.id === r.lastMessage.senderId);
    preview = `${sender ? sender.name.split(' ')[0] + ': ' : ''}${preview}`;
  }
  const others = (r.members || []).filter((m: any) => m.id !== r.other?.id).slice(0, 2);
  return (
    <div className={`m3-nav-item ${active ? 'active' : ''}`} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ fontSize: '14px', borderRadius: '10px', alignItems: 'center', gap: '10px', padding: '8px 10px' }}>
      {r.type === 'direct'
        ? <span style={{ position: 'relative', flexShrink: 0 }}><UserAvatar id={r.other?.id} name={r.title} size={34} />{presence && presence !== 'offline' && <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: statusDot[presence], border: '2px solid var(--m3-bg)' }} />}</span>
        : r.type === 'space'
          ? (icon || <div style={{ width: 34, height: 34, borderRadius: '8px', background: 'var(--m3-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Hash size={17} /></div>)
          : <span style={{ position: 'relative', width: 34, height: 34, flexShrink: 0, display: 'block' }}>{others.map((m: any, i: number) => <span key={m.id} style={{ position: 'absolute', left: i ? 12 : 0, top: i ? 12 : 0 }}><UserAvatar id={m.id} name={m.name} size={22} /></span>)}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: r.unread ? 700 : 500, color: 'var(--m3-text-primary)' }}>{r.title}</span>
          {r.unread > 0 && <span style={{ background: 'var(--m3-primary)', color: 'white', borderRadius: '10px', fontSize: '11px', padding: '0 6px', minWidth: 18, textAlign: 'center', flexShrink: 0 }}>{r.unread}</span>}
          {!r.unread && (hover || r.starred) && onStar && <span onClick={e => { e.stopPropagation(); onStar(); }} style={{ flexShrink: 0 }}><Star size={14} fill={r.starred ? '#f9ab00' : 'none'} color={r.starred ? '#f9ab00' : 'var(--m3-text-secondary)'} /></span>}
        </div>
        {preview && <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: r.unread ? 600 : 400 }}>{preview}</div>}
      </div>
    </div>
  );
}

function Welcome({ name, onNew }: any) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--m3-text-secondary)' }}>
      <MessageSquare size={48} color="var(--m3-primary)" />
      <h2 style={{ fontSize: '26px', fontWeight: 400, color: 'var(--m3-text-primary)', margin: '16px 0 6px' }}>Welcome, {name}</h2>
      <p>Pick a conversation, or start a new one.</p>
      <button className="m3-action-button" style={{ marginTop: '16px' }} onClick={onNew}>Start a chat</button>
    </div>
  );
}

function groupByDay(msgs: Msg[]): [string, Msg[]][] {
  const out: Record<string, Msg[]> = {};
  for (const m of msgs) { const k = dayLabel(new Date(m.createdAt)); (out[k] = out[k] || []).push(m); }
  return Object.entries(out);
}

function MessageRow({ m, me, onReact, onEdit, onDelete, onThread, onOpenDoc, onOpenFile, compact }: any) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(m.text);
  const [pick, setPick] = useState(false);
  const mine = m.senderId === me;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPick(false); }} style={{ display: 'flex', gap: '10px', padding: '4px 0', position: 'relative' }}>
      <UserAvatar id={m.senderId} name={m.senderName} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>{m.senderName}</span>
          <span style={{ fontSize: '11px', color: 'var(--m3-text-secondary)' }}>{timeLabel(new Date(m.createdAt))}{m.editedAt ? ' (edited)' : ''}</span>
        </div>
        {m.deleted ? <div style={{ fontStyle: 'italic', color: 'var(--m3-text-secondary)', fontSize: '14px' }}>Message deleted</div>
          : editing ? (
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <input className="modal-input" style={{ margin: 0 }} value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onEdit(m.id, editText); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} autoFocus />
              <button className="m3-small-btn" onClick={() => { onEdit(m.id, editText); setEditing(false); }}>Save</button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
              {m.refs && <RefChips refs={m.refs} onOpenDoc={onOpenDoc} onOpenFile={onOpenFile} />}
              {(m.attachments || []).map((id: string) => <Attachment key={id} nodeId={id} onOpenFile={onOpenFile} />)}
            </>
          )}
        {/* reactions */}
        {(m.reactions || []).length > 0 && (
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
            {m.reactions.map((r: any) => <span key={r.emoji} onClick={() => onReact(m.id, r.emoji)} style={{ cursor: 'pointer', fontSize: '12px', background: r.me ? 'var(--m3-primary-container)' : 'var(--m3-surface-2)', border: '1px solid var(--m3-border)', borderRadius: '12px', padding: '0 7px' }}>{r.emoji} {r.count}</span>)}
          </div>
        )}
        {!compact && m.replyCount > 0 && <div onClick={() => onThread(m)} style={{ fontSize: '12px', color: 'var(--m3-primary)', cursor: 'pointer', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}><Reply size={13} /> {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}</div>}
      </div>
      {/* hover actions */}
      {hover && !m.deleted && !editing && (
        <div style={{ position: 'absolute', right: 0, top: '-6px', display: 'flex', gap: '2px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '8px', padding: '2px' }}>
          <button className="m3-small-btn" style={{ border: 'none', padding: '4px' }} onClick={() => setPick(v => !v)} title="React"><Smile size={15} /></button>
          {!compact && <button className="m3-small-btn" style={{ border: 'none', padding: '4px' }} onClick={() => onThread(m)} title="Reply in thread"><Reply size={15} /></button>}
          {mine && <button className="m3-small-btn" style={{ border: 'none', padding: '4px' }} onClick={() => { setEditText(m.text); setEditing(true); }} title="Edit"><Pencil size={15} /></button>}
          {mine && <button className="m3-small-btn danger" style={{ border: 'none', padding: '4px' }} onClick={() => onDelete(m.id)} title="Delete"><Trash2 size={15} /></button>}
        </div>
      )}
      {pick && (
        <div style={{ position: 'absolute', right: 0, top: '24px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.16)', padding: '6px', zIndex: 20, display: 'flex', gap: '2px' }}>
          {EMOJIS.map(e => <span key={e} onClick={() => { onReact(m.id, e); setPick(false); }} style={{ cursor: 'pointer', fontSize: '18px', padding: '2px' }}>{e}</span>)}
        </div>
      )}
    </div>
  );
}

function RefChips({ refs, onOpenDoc, onOpenFile }: any) {
  const chips: any[] = [];
  (refs.pages || []).forEach((p: any) => chips.push({ id: p.id || p, name: p.name || 'Page', kind: 'page' }));
  (refs.files || []).forEach((p: any) => chips.push({ id: p.id || p, name: p.name || 'File', kind: 'file' }));
  (refs.tasks || []).forEach((p: any) => chips.push({ id: p.id || p, name: p.name || 'Task', kind: 'task' }));
  if (chips.length === 0) return null;
  const open = (c: any) => { if (c.kind === 'page') onOpenDoc(c.id); else if (c.kind === 'task') window.dispatchEvent(new CustomEvent('of-open-task', { detail: c.id })); else apiGet(`/api/nodes/${c.id}`).then(onOpenFile).catch(() => {}); };
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
      {chips.map((c, i) => c.kind === 'task'
        ? <TaskLinkChip key={i} taskId={c.id} fallbackTitle={c.name} />
        : (
          <span key={i} onClick={() => open(c)} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'var(--m3-surface-2)', border: '1px solid var(--m3-border)', borderRadius: '8px', padding: '3px 8px', cursor: 'pointer', fontSize: '13px' }}>
            {c.kind === 'page' ? <FileText size={14} color="#0b57d0" /> : <FileIcon size={14} color="#5f6368" />} {c.name}
          </span>
        ))}
    </div>
  );
}

function Attachment({ nodeId, onOpenFile }: any) {
  const [node, setNode] = useState<any>(null);
  useEffect(() => { apiGet(`/api/nodes/${nodeId}`).then(setNode).catch(() => {}); }, [nodeId]);
  if (!node) return null;
  const isImg = fileKind(node.mimeType, node.name) === 'image';
  const src = `${API_BASE}/api/nodes/${node.id}/raw?token=${getToken() || ''}`;
  if (isImg) return <img src={src} alt={node.name} onClick={() => onOpenFile(node)} style={{ maxWidth: '280px', maxHeight: '220px', borderRadius: '8px', marginTop: '6px', cursor: 'pointer', display: 'block' }} />;
  return <span onClick={() => onOpenFile(node)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--m3-surface-2)', border: '1px solid var(--m3-border)', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px', marginTop: '6px' }}><FileIcon size={15} /> {node.name}</span>;
}

function MentionList({ items, onOpenRoom }: any) {
  return (
    <div style={{ padding: '24px', overflowY: 'auto' }}>
      <h2 style={{ fontWeight: 500, marginBottom: '12px' }}>Mentions</h2>
      {items.length === 0 && <div style={{ color: 'var(--m3-text-secondary)' }}>No one has @mentioned you yet.</div>}
      {items.map((m: any) => (
        <div key={m.id} onClick={() => onOpenRoom(m.roomId)} style={{ display: 'flex', gap: '10px', padding: '10px', borderBottom: '1px solid var(--m3-border)', cursor: 'pointer' }}>
          <UserAvatar id={m.senderId} name={m.senderName} size={34} />
          <div><div style={{ fontSize: '13px' }}><b>{m.senderName}</b> in <b>{m.roomName}</b> · {timeLabel(new Date(m.createdAt))}</div><div style={{ fontSize: '14px' }}>{m.text}</div></div>
        </div>
      ))}
    </div>
  );
}

// Composer with the SHARED unified @ menu (people / pages / files / to-dos + "Add to-do" pop-over).
function Composer({ onSend, onTyping, placeholder, currentUserId }: any) {
  const [text, setText] = useState('');
  const [refs, setRefs] = useState<any>({ users: [], pages: [], files: [], tasks: [] });
  const [attachments, setAttachments] = useState<string[]>([]);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [results, setResults] = useState<AtItem[]>([]);
  const [emoji, setEmoji] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onChange = (v: string) => {
    setText(v); onTyping();
    const word = v.split(/\s/).pop() || '';
    setAtQuery(word.startsWith('@') ? word.slice(1) : null);
  };
  const replaceLastToken = (str: string) => {
    setText(prev => { const w = prev.split(/(\s)/); for (let i = w.length - 1; i >= 0; i--) { if (w[i].trim()) { w[i] = str; break; } } return w.join('') + ' '; });
    setAtQuery(null);
  };
  const addRef = (kind: 'pages' | 'files' | 'tasks', id: string, name: string) => setRefs((p: any) => ({ ...p, [kind]: [...p[kind], { id, name }] }));

  useEffect(() => {
    if (atQuery === null) { setResults([]); return; }
    let live = true;
    buildAtItems(atQuery, {
      onPerson: (u) => { replaceLastToken('@' + u.name); setRefs((p: any) => ({ ...p, users: [...p.users, u.id] })); },
      onPage: (n) => { replaceLastToken(n.name); addRef('pages', n.id, n.name); },
      onFile: (n) => { replaceLastToken(n.name); addRef('files', n.id, n.name); },
      onTask: (t) => { replaceLastToken(t.title); addRef('tasks', t.id, t.title); },
      onCreateTask: async (title) => { const r = await apiSend('/api/tasks', 'POST', { title }); const { id } = await r.json(); replaceLastToken(title); addRef('tasks', id, title); },
      onAddTodo: () => { setAtQuery(null); replaceLastToken(''); setTodoOpen(true); },
    }).then(items => { if (live) setResults(items); });
    return () => { live = false; };
  }, [atQuery]);

  const grouped = results.reduce((acc: Record<string, AtItem[]>, it) => { (acc[it.group] = acc[it.group] || []).push(it); return acc; }, {});

  const attach = async (file: File) => {
    const form = new FormData(); form.append('file', file);
    const res = await api('/api/nodes/upload', { method: 'POST', body: form });
    if (res.ok) { const d = await res.json(); setAttachments(a => [...a, d.id]); }
  };
  const submit = () => { onSend(text, refs, attachments); setText(''); setRefs({ users: [], pages: [], files: [], tasks: [] }); setAttachments([]); setAtQuery(null); };

  return (
    <div style={{ borderTop: '1px solid var(--m3-border)', padding: '12px 16px', background: 'var(--m3-surface)', position: 'relative' }}>
      {atQuery !== null && results.length > 0 && (
        <div style={{ position: 'absolute', bottom: '70px', left: '16px', right: '16px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.14)', maxHeight: '300px', overflowY: 'auto', zIndex: 30 }}>
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--m3-text-secondary)', textTransform: 'uppercase', padding: '8px 14px 2px' }}>{group}</div>
              {items.map(it => (
                <div key={it.key} className="m3-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => it.run()}>
                  {it.icon}<span>{it.title}</span>{it.subtitle && <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--m3-text-secondary)' }}>{it.subtitle}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {attachments.length > 0 && <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>{attachments.map(id => <span key={id} style={{ fontSize: '12px', background: 'var(--m3-surface-2)', borderRadius: '8px', padding: '3px 8px' }}>📎 attached <X size={11} style={{ cursor: 'pointer', verticalAlign: '-1px' }} onClick={() => setAttachments(a => a.filter(x => x !== id))} /></span>)}</div>}
      {emoji && <div style={{ position: 'absolute', bottom: '70px', right: '60px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '10px', padding: '6px', zIndex: 30, display: 'flex', gap: '2px', flexWrap: 'wrap', width: '180px' }}>{EMOJIS.map(e => <span key={e} onClick={() => { setText(t => t + e); setEmoji(false); }} style={{ cursor: 'pointer', fontSize: '20px', padding: '2px' }}>{e}</span>)}</div>}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) attach(e.target.files[0]); e.target.value = ''; }} />
        <button className="m3-small-btn" style={{ border: 'none' }} onClick={() => fileRef.current?.click()} title="Attach"><Paperclip size={18} /></button>
        <button className="m3-small-btn" style={{ border: 'none' }} onClick={() => setEmoji(v => !v)} title="Emoji"><Smile size={18} /></button>
        <textarea value={text} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'Message…  (@ for people, pages, files, to-dos)'} rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && atQuery === null) { e.preventDefault(); submit(); } }}
          style={{ flex: 1, resize: 'none', border: '1px solid var(--m3-border)', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', fontFamily: 'inherit', background: 'var(--m3-surface)', color: 'var(--m3-text-primary)', outline: 'none', maxHeight: '120px' }} />
        <button className="m3-action-button" onClick={submit} style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0 }}><Send size={16} /></button>
      </div>
      {todoOpen && <TodoModal currentUserId={currentUserId} onClose={() => setTodoOpen(false)} onCreated={(id, title) => addRef('tasks', id, title)} />}
    </div>
  );
}

function NewChatModal({ currentUser, onClose, onOpenRoom }: any) {
  const [tab, setTab] = useState<'people' | 'space'>('people');
  const [users, setUsers] = useState<any[]>([]);
  const [spaces, setSpaces] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [spaceName, setSpaceName] = useState('');
  useEffect(() => { apiGet('/api/directory').then(d => setUsers(d.users.filter((u: any) => u.id !== currentUser.id))); apiGet('/api/chat/spaces').then(setSpaces); }, []);
  const startDm = async (uid: string) => { const r = await apiSend('/api/chat/dm', 'POST', { userId: uid }); const { id } = await r.json(); onOpenRoom(id); };
  const startGroup = async () => { const r = await apiSend('/api/chat/rooms', 'POST', { type: 'group', name: selected.map(id => users.find(u => u.id === id)?.name).join(', '), memberIds: selected }); const { id } = await r.json(); onOpenRoom(id); };
  const createSpace = async () => { const r = await apiSend('/api/chat/rooms', 'POST', { type: 'space', name: spaceName || 'New Space', visibility: 'public' }); const { id } = await r.json(); onOpenRoom(id); };
  const joinSpace = async (id: string) => { await apiSend(`/api/chat/rooms/${id}/join`, 'POST'); onOpenRoom(id); };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button className={`m3-small-btn ${tab === 'people' ? 'primary' : ''}`} onClick={() => setTab('people')}>People</button>
          <button className={`m3-small-btn ${tab === 'space' ? 'primary' : ''}`} onClick={() => setTab('space')}>Spaces</button>
        </div>
        {tab === 'people' ? (
          <>
            <input className="modal-input" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
            {selected.length > 0 && <button className="m3-action-button" style={{ width: '100%', margin: '10px 0' }} onClick={startGroup}>Start group chat with {selected.length}</button>}
            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              {users.filter(u => u.name.toLowerCase().includes(q.toLowerCase())).map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', borderRadius: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.includes(u.id)} onChange={e => setSelected(s => e.target.checked ? [...s, u.id] : s.filter(x => x !== u.id))} />
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => startDm(u.id)}>
                    <UserAvatar id={u.id} name={u.name} size={32} /><div><div style={{ fontWeight: 500 }}>{u.name}</div><div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{u.email}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input className="modal-input" style={{ margin: 0 }} placeholder="New space name" value={spaceName} onChange={e => setSpaceName(e.target.value)} />
              <button className="m3-action-button" onClick={createSpace}>Create</button>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--m3-text-secondary)', margin: '8px 0' }}>Browse spaces</div>
            <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
              {spaces.length === 0 && <div style={{ color: 'var(--m3-text-secondary)', fontSize: '14px' }}>No public spaces yet.</div>}
              {spaces.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px' }}>
                  <Hash size={18} color="var(--m3-text-secondary)" />
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{s.name}</div><div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{s.members} members</div></div>
                  <button className="m3-small-btn" onClick={() => joinSpace(s.id)}>{s.joined ? 'Open' : 'Join'}</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
