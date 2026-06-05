import React, { useState, useEffect } from 'react';
import { Search, HelpCircle, Folder as FolderIcon, FileText, UserCircle2, ShieldAlert, Users, Trash2, Bell, Sun, Moon, X, CheckSquare, Star, Clock, Share2, MessageSquare } from 'lucide-react';
import { BlockNoteDoc } from './BlockNoteDoc';
import { AdminConsole } from './admin/AdminConsole';
import { ProfileView } from './ProfileView';
import { TasksView } from './tasks/TasksView';
import { FilesView, ShareModal, FolderPicker } from './files/FilesView';
import { FileViewer } from './files/FileViewer';
import { ChatView } from './chat/ChatView';
import { UserAvatar } from './UserAvatar';
import { api, apiGet, apiSend, setToken, getToken, API_BASE } from './api';
import { useTheme, toggleTheme } from './theme';
import './index.css';

type CurrentUser = { id: string, name: string, email: string, globalRole: string, hasAvatar?: boolean, twoFactorEnabled?: boolean };
type View = 'home' | 'my-drive' | 'shared-with-me' | 'starred' | 'recent' | 'trash' | 'admin';

// Keeps an editor runtime error from blanking the whole document view (incl. the title/rename bar).
class EditorErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px', color: 'var(--m3-text-secondary)' }}>
          <h3 style={{ color: '#d93025' }}>The editor failed to load.</h3>
          <p style={{ fontSize: '14px' }}>You can still rename this page from the title bar above. Details:</p>
          <pre style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

type Workspace = { name: string, logo: string };

export default function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<View>('home');
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>({ name: 'OneFeather', logo: '' });
  const [profileOpen, setProfileOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatBadgeTick, setChatBadgeTick] = useState(0);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [taskBadgeTick, setTaskBadgeTick] = useState(0);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [userMenu, setUserMenu] = useState(false);
  const [openFileNode, setOpenFileNode] = useState<any | null>(null);
  const inviteToken = new URLSearchParams(window.location.search).get('invite');

  const refreshMe = () => { apiGet<CurrentUser>('/api/auth/me').then(setCurrentUser).catch(() => {}); setAvatarVersion(v => v + 1); };

  const downloadNode = (n: any) => api(`/api/nodes/${n.id}/download`).then(async res => {
    const b = await res.blob(); const url = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = url; a.download = n.name; a.click(); URL.revokeObjectURL(url);
  });

  // Deep link: opening a shared "Copy link" URL (/?open=<nodeId>) routes to the resource.
  useEffect(() => {
    if (!currentUser) return;
    const openId = new URLSearchParams(window.location.search).get('open');
    if (!openId) return;
    apiGet(`/api/nodes/${openId}`).then((n: any) => {
      if (n.type === 'document') setActiveDocId(n.id);
      else if (n.type === 'file') setOpenFileNode(n);
      else setCurrentView('my-drive');
    }).catch(() => alert('You don’t have access to this item, or it no longer exists.'))
      .finally(() => window.history.replaceState({}, '', window.location.pathname));
  }, [currentUser]);

  // Restore session from a stored token on load.
  useEffect(() => {
    apiGet<Workspace>('/api/workspace').then(setWorkspace).catch(() => {});
    const token = getToken();
    if (!token) { setLoading(false); return; }
    apiGet<CurrentUser>('/api/auth/me')
      .then(setCurrentUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setToken(null);
    setCurrentUser(null);
    setActiveDocId(null);
    setCurrentView('home');
  };

  // Cross-document links (the "↗ page" chips inside Pages) dispatch this event to navigate.
  useEffect(() => {
    const openDoc = (e: Event) => setActiveDocId((e as CustomEvent).detail as string);
    const openTask = (e: Event) => { setOpenTaskId((e as CustomEvent).detail as string); setTasksOpen(true); };
    const openFile = (e: Event) => { apiGet(`/api/nodes/${(e as CustomEvent).detail}`).then(setOpenFileNode).catch(() => {}); };
    window.addEventListener('of-open-doc', openDoc);
    window.addEventListener('of-open-task', openTask);
    window.addEventListener('of-open-file', openFile);
    return () => { window.removeEventListener('of-open-doc', openDoc); window.removeEventListener('of-open-task', openTask); window.removeEventListener('of-open-file', openFile); };
  }, []);

  // Accept-invite flow: a fresh visitor opening /?invite=<token> sets up their account.
  if (inviteToken && !currentUser) {
    return <AcceptInvite token={inviteToken} workspace={workspace} onAccepted={(u) => { setLoading(false); setCurrentUser(u); window.history.replaceState({}, '', window.location.pathname); }} />;
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading…</div>;
  if (!currentUser) return <LoginScreen onLogin={setCurrentUser} workspace={workspace} />;

  if (profileOpen) {
    return <ProfileView currentUser={currentUser} avatarVersion={avatarVersion} onChanged={refreshMe} onClose={() => setProfileOpen(false)} />;
  }

  if (tasksOpen) {
    return <TasksView currentUser={currentUser} initialTaskId={openTaskId} onClose={() => { setTasksOpen(false); setOpenTaskId(null); }} onChanged={() => setTaskBadgeTick(t => t + 1)} />;
  }

  if (chatOpen) {
    return <ChatView currentUser={currentUser} onOpenDoc={(id) => { setChatOpen(false); setActiveDocId(id); }} onClose={() => setChatOpen(false)} onBadgeChange={() => setChatBadgeTick(t => t + 1)} />;
  }

  if (activeDocId) {
    return <DocumentView docId={activeDocId} currentUser={currentUser} onClose={() => setActiveDocId(null)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top Bar */}
      <header style={{ display: 'flex', alignItems: 'center', padding: '12px 24px', gap: '24px', background: 'var(--m3-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '230px' }}>
          <img src={workspace.logo || '/logo.svg'} alt="Logo" width="32" height="32" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <span style={{ fontSize: '22px', color: 'var(--m3-text-secondary)', fontWeight: 500 }}>{workspace.name}</span>
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '720px' }}>
            <Search style={{ position: 'absolute', left: '16px', top: '12px', color: 'var(--m3-text-secondary)' }} size={20} />
            <input type="text" placeholder="Search in Files" className="m3-search-bar" style={{ paddingLeft: '48px' }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <ThemeToggle />
          <HelpCircle size={24} color="var(--m3-text-secondary)" cursor="pointer" />
          <NotificationBell onOpenDoc={(id) => setActiveDocId(id)} />
          <TasksButton tick={taskBadgeTick} onOpen={() => setTasksOpen(true)} />
          <ChatButton tick={chatBadgeTick} onOpen={() => setChatOpen(true)} />
          <div style={{ position: 'relative' }}>
            <button onClick={() => setUserMenu(v => !v)} title={currentUser.name} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
              <UserAvatar id={currentUser.id} name={currentUser.name} size={34} version={avatarVersion} />
            </button>
            {userMenu && (
              <div style={{ position: 'absolute', right: 0, top: '44px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, minWidth: '200px', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--m3-border)' }}>
                  <div style={{ fontWeight: 500 }}>{currentUser.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{currentUser.email}</div>
                </div>
                <div className="m3-menu-item" onClick={() => { setUserMenu(false); setProfileOpen(true); }}>Profile &amp; account</div>
                <div className="m3-menu-item" onClick={() => { setUserMenu(false); logout(); }}>Sign out</div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <aside style={{ width: '256px', padding: '16px', background: 'var(--m3-bg)' }}>
          <nav>
            <div className={`m3-nav-item ${currentView === 'home' ? 'active' : ''}`} onClick={() => setCurrentView('home')}>
              <FolderIcon size={20} /> Home
            </div>
            <div className={`m3-nav-item ${currentView === 'my-drive' ? 'active' : ''}`} onClick={() => setCurrentView('my-drive')}>
              <UserCircle2 size={20} /> My Drive
            </div>
            <div className={`m3-nav-item ${currentView === 'shared-with-me' ? 'active' : ''}`} onClick={() => setCurrentView('shared-with-me')}>
              <Users size={20} /> Shared with me
            </div>
            <div className={`m3-nav-item ${currentView === 'recent' ? 'active' : ''}`} onClick={() => setCurrentView('recent')}>
              <Clock size={20} /> Recent
            </div>
            <div className={`m3-nav-item ${currentView === 'starred' ? 'active' : ''}`} onClick={() => setCurrentView('starred')}>
              <Star size={20} /> Starred
            </div>
            <div className={`m3-nav-item ${currentView === 'trash' ? 'active' : ''}`} onClick={() => setCurrentView('trash')}>
              <Trash2 size={20} /> Trash
            </div>
            {currentUser.globalRole === 'admin' && (
              <div className={`m3-nav-item ${currentView === 'admin' ? 'active' : ''}`} onClick={() => setCurrentView('admin')}>
                <ShieldAlert size={20} /> Admin
              </div>
            )}
          </nav>
        </aside>

        {/* Content Area */}
        <main style={{ flex: 1, background: 'var(--m3-surface)', borderRadius: '24px 24px 0 0', margin: '0 16px', overflowY: 'auto' }}>
          {currentView === 'admin' ? (
            <AdminConsole currentUser={currentUser} />
          ) : (
            <FilesView currentUser={currentUser} currentView={currentView} onOpenDoc={setActiveDocId} />
          )}
        </main>
      </div>
      {openFileNode && <FileViewer node={openFileNode} onClose={() => setOpenFileNode(null)} onDownload={downloadNode} />}
    </div>
  );
}

// =====================================
// Theme toggle (light/dark)
// =====================================
function ThemeToggle() {
  const theme = useTheme();
  return (
    <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
      {theme === 'dark' ? <Sun size={22} color="var(--m3-text-secondary)" /> : <Moon size={22} color="var(--m3-text-secondary)" />}
    </button>
  );
}

// =====================================
// Tasks button (header, right of the bell) with a due/overdue badge
// =====================================
function TasksButton({ onOpen, tick }: { onOpen: () => void, tick: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => apiGet('/api/tasks/badge').then((b: any) => setCount((b.today || 0) + (b.overdue || 0))).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [tick]);
  return (
    <button onClick={onOpen} title="Tasks" style={{ background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center' }}>
      <CheckSquare size={22} color="var(--m3-text-secondary)" />
      {count > 0 && <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#1a73e8', color: 'white', borderRadius: '10px', fontSize: '11px', minWidth: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{count}</span>}
    </button>
  );
}

// =====================================
// Chat button (header) with a separate unread badge
// =====================================
function ChatButton({ onOpen, tick }: { onOpen: () => void, tick: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => apiGet('/api/chat/badge').then((b: any) => setCount(b.unread || 0)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [tick]);
  return (
    <button onClick={onOpen} title="Chat" style={{ background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center' }}>
      <MessageSquare size={22} color="var(--m3-text-secondary)" />
      {count > 0 && <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#1e8e3e', color: 'white', borderRadius: '10px', fontSize: '11px', minWidth: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{count}</span>}
    </button>
  );
}

// =====================================
// Login Screen
// =====================================
function LoginScreen({ onLogin, workspace }: { onLogin: (u: CurrentUser) => void, workspace: Workspace }) {
  const [email, setEmail] = useState('alice@onefeather.local');
  const [password, setPassword] = useState('password');
  const [code, setCode] = useState('');
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiSend('/api/auth/login', 'POST', { email, password, code: need2fa ? code : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.twoFactorRequired) { setNeed2fa(true); setError(data.error || ''); return; }
        setError(data.error || 'Invalid email or password');
        return;
      }
      setToken(data.token);
      onLogin(data.user);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--m3-bg)' }}>
      <div style={{ position: 'fixed', top: '16px', right: '16px' }}><ThemeToggle /></div>
      <form onSubmit={submit} style={{ background: 'var(--m3-surface)', padding: '40px', borderRadius: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: '360px' }}>
        {workspace.logo && <img src={workspace.logo} alt="" style={{ height: '40px', marginBottom: '12px' }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
        <h1 style={{ fontWeight: 500, marginBottom: '4px' }}>{workspace.name}</h1>
        <p style={{ color: 'var(--m3-text-secondary)', marginBottom: '24px', fontSize: '14px' }}>Sign in to your workspace</p>
        <input className="modal-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} disabled={need2fa} />
        <input className="modal-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} disabled={need2fa} />
        {need2fa && <input className="modal-input" autoFocus placeholder="6-digit authentication code" value={code} onChange={e => setCode(e.target.value)} style={{ letterSpacing: '3px' }} />}
        {error && <div style={{ color: 'red', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
        <button className="m3-action-button" style={{ width: '100%', marginTop: '20px' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p style={{ color: 'var(--m3-text-secondary)', marginTop: '16px', fontSize: '12px' }}>Demo: alice/bob/admin @onefeather.local · password</p>
      </form>
    </div>
  );
}

// =====================================
// Accept Invite Screen (/?invite=<token>)
// =====================================
function AcceptInvite({ token, workspace, onAccepted }: { token: string, workspace: Workspace, onAccepted: (u: CurrentUser) => void }) {
  const [invite, setInvite] = useState<{ email: string, role: string } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet(`/api/auth/invite/${token}`).then(setInvite).catch(() => setInvalid(true));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await apiSend('/api/auth/accept-invite', 'POST', { token, name, password });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error || 'Could not accept invitation'); return; }
    setToken(data.token);
    onAccepted(data.user);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--m3-bg)' }}>
      <form onSubmit={submit} style={{ background: 'var(--m3-surface)', padding: '40px', borderRadius: '24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: '380px' }}>
        <h1 style={{ fontWeight: 500, marginBottom: '4px' }}>Join {workspace.name}</h1>
        {invalid ? (
          <p style={{ color: 'red', fontSize: '14px', marginTop: '12px' }}>This invitation is invalid or has expired. Ask your admin for a new link.</p>
        ) : !invite ? (
          <p style={{ color: 'var(--m3-text-secondary)', fontSize: '14px' }}>Loading…</p>
        ) : (
          <>
            <p style={{ color: 'var(--m3-text-secondary)', marginBottom: '20px', fontSize: '14px' }}>Setting up the account for <b>{invite.email}</b>.</p>
            <input className="modal-input" placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} />
            <input className="modal-input" type="password" placeholder="Choose a password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} />
            {error && <div style={{ color: 'red', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
            <button className="m3-action-button" style={{ width: '100%', marginTop: '20px' }} disabled={busy || !name || password.length < 6}>
              {busy ? 'Creating account…' : 'Create account & sign in'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

// =====================================
// Document View (Top bar + BlockNote)
// =====================================
function DocumentView({ docId, currentUser, onClose }: { docId: string, currentUser: CurrentUser, onClose: () => void }) {
  const [nodeName, setNodeName] = useState('Loading...');
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved'>('');
  const [path, setPath] = useState<{ id: string, name: string }[]>([]); // ancestors incl. self
  const [shareOpen, setShareOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [icon, setIcon] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [iconPicker, setIconPicker] = useState(false);
  const coverInputRef = React.useRef<HTMLInputElement>(null);
  const ICON_CHOICES = ['📄', '📝', '🚀', '💡', '🗓️', '✅', '📊', '🎯', '🔥', '⭐', '📌', '🧩', '📚', '🛠️'];

  const loadPath = () => apiGet(`/api/nodes/${docId}/path`).then(setPath).catch(() => setPath([]));
  useEffect(() => {
    apiGet(`/api/nodes/${docId}`).then(data => { setNodeName(data.name || 'Untitled'); setIcon(data.icon || null); setCoverKey(data.coverKey || null); }).catch(() => setNodeName('Untitled'));
    loadPath();
  }, [docId]);

  const setPageIcon = async (emoji: string | null) => { setIcon(emoji); setIconPicker(false); await apiSend(`/api/nodes/${docId}`, 'PUT', { icon: emoji }); };
  const uploadCover = async (file: File) => {
    const form = new FormData(); form.append('file', file);
    const res = await api('/api/nodes/upload', { method: 'POST', body: form });
    if (res.ok) { const d = await res.json(); setCoverKey(d.id); await apiSend(`/api/nodes/${docId}`, 'PUT', { coverKey: d.id }); }
  };
  const removeCover = async () => { setCoverKey(null); await apiSend(`/api/nodes/${docId}`, 'PUT', { coverKey: null }); };

  const saveName = async (newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaveState('saving');
    const res = await apiSend(`/api/nodes/${docId}`, 'PUT', { name: trimmed });
    if (res.ok) {
      setNodeName(trimmed);
      setSaveState('saved');
      setTimeout(() => setSaveState(''), 1500);
    } else {
      setSaveState('');
      alert(res.status === 403 ? "You don't have permission to rename this page." : 'Could not rename this page.');
    }
  };

  const moveTo = async (parentId: string | null) => {
    setMoveOpen(false);
    const res = await apiSend(`/api/nodes/${docId}/move`, 'POST', { parentId });
    if (!res.ok) { alert((await res.json()).error || 'Could not move this page.'); return; }
    loadPath();
  };

  // The location is everything above the document itself.
  const location = path.slice(0, -1);
  const locationLabel = location.length ? location.map(p => p.name).join(' › ') : 'My Drive';

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      {coverKey && (
        <div style={{ position: 'relative', height: '140px', flexShrink: 0 }}>
          <img src={`${API_BASE}/api/nodes/${coverKey}/raw?token=${getToken() || ''}`} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <button className="m3-small-btn" style={{ position: 'absolute', top: '10px', right: '10px' }} onClick={removeCover}>Remove cover</button>
        </div>
      )}
      <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--m3-border)', background: 'var(--m3-surface)' }}>
        <div style={{ position: 'relative', marginRight: '12px', flexShrink: 0 }}>
          <button onClick={() => setIconPicker(v => !v)} title="Page icon" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: icon ? '24px' : '20px', lineHeight: 1, padding: 0, display: 'flex' }}>
            {icon || <FileText size={24} color="#0b57d0" />}
          </button>
          {iconPicker && (
            <div style={{ position: 'absolute', top: '34px', left: 0, background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.16)', zIndex: 100, padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px', width: '230px' }}>
              {ICON_CHOICES.map(e => <span key={e} onClick={() => setPageIcon(e)} style={{ cursor: 'pointer', fontSize: '20px', padding: '3px', textAlign: 'center' }}>{e}</span>)}
              {icon && <span onClick={() => setPageIcon(null)} style={{ cursor: 'pointer', fontSize: '12px', gridColumn: '1 / -1', textAlign: 'center', color: 'var(--m3-text-secondary)', paddingTop: '4px' }}>Remove icon</span>}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={nodeName}
            placeholder="Untitled"
            title="Click to rename this page"
            onChange={(e) => setNodeName(e.target.value)}
            onBlur={(e) => saveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
            className="of-title-input"
            style={{ fontSize: '18px', fontWeight: 500, width: '100%', padding: '4px 10px', background: 'transparent', borderRadius: '8px' }}
          />
          <button onClick={() => setMoveOpen(true)} title="Move — change location" style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--m3-text-secondary)', fontSize: '12px', padding: '2px 10px' }}>
            <FolderIcon size={13} /> {locationLabel} {saveState && <span style={{ marginLeft: '8px' }}>{saveState === 'saving' ? '· Saving…' : '· Saved ✓'}</span>}
          </button>
        </div>
        <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadCover(e.target.files[0]); e.target.value = ''; }} />
        {!coverKey && <button onClick={() => coverInputRef.current?.click()} className="m3-small-btn" style={{ marginRight: '10px' }}>Add cover</button>}
        <button onClick={() => setShareOpen(true)} className="m3-small-btn" style={{ marginRight: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}><Share2 size={16} /> Share</button>
        <button onClick={onClose} className="m3-action-button">Return to Files</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <EditorErrorBoundary>
          <BlockNoteDoc docId={docId} currentUser={currentUser} />
        </EditorErrorBoundary>
      </div>
      {shareOpen && <ShareModal nodeId={docId} currentUser={currentUser} onClose={() => setShareOpen(false)} />}
      {moveOpen && <FolderPicker mode="move" onPick={moveTo} onClose={() => setMoveOpen(false)} />}
    </div>
  );
}


// =====================================
// Notification Bell
// =====================================
function NotificationBell({ onOpenDoc }: { onOpenDoc: (id: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  const load = () => apiGet('/api/notifications').then(setItems).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const unread = items.filter(n => !n.read).length;

  const openItem = async (n: any) => {
    await apiSend(`/api/notifications/${n.id}/read`, 'POST');
    setOpen(false);
    load();
    if (n.nodeId) onOpenDoc(n.nodeId);
  };

  const dismiss = async (id: string) => { await api(`/api/notifications/${id}`, { method: 'DELETE' }); load(); };
  const clearAll = async () => { await api('/api/notifications', { method: 'DELETE' }); load(); };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} title="Notifications" style={{ background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Bell size={22} color="var(--m3-text-secondary)" />
        {unread > 0 && <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#d93025', color: 'white', borderRadius: '10px', fontSize: '11px', minWidth: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread}</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '34px', width: '340px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--m3-border)' }}>
            <strong style={{ fontSize: '14px' }}>Notifications</strong>
            {items.length > 0 && <button onClick={clearAll} style={{ background: 'transparent', border: 'none', color: 'var(--m3-primary)', cursor: 'pointer', fontSize: '12px' }}>Clear all</button>}
          </div>
          <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {items.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: 'var(--m3-text-secondary)', fontSize: '14px' }}>No notifications</div>}
            {items.map(n => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 12px 12px 16px', borderBottom: '1px solid var(--m3-border)', background: n.read ? 'var(--m3-surface)' : 'var(--m3-unread)' }}>
                <div onClick={() => openItem(n)} style={{ cursor: 'pointer' }}><UserAvatar id={n.actorId} name={n.actorName || n.actorId} size={32} /></div>
                <div onClick={() => openItem(n)} style={{ flex: 1, cursor: 'pointer' }}>
                  <div style={{ fontSize: '14px' }}>{n.message}</div>
                  <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', marginTop: '2px' }}>{new Date(n.createdAt).toLocaleString()}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); dismiss(n.id); }} title="Dismiss" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--m3-text-secondary)', padding: '2px', display: 'flex' }}>
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
