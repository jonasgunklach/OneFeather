import { useEffect, useState } from 'react';
import { LayoutDashboard, Users as UsersIcon, Network, Mail, ScrollText, Settings as SettingsIcon, MoreVertical, Plus, Copy, ChevronRight, ChevronDown, FolderPlus, Folder as FolderIcon } from 'lucide-react';
import { api, apiGet, apiSend } from '../api';
import { useTheme } from '../theme';
import { UserAvatar } from '../UserAvatar';

type CurrentUser = { id: string, name: string, email: string, globalRole: string };
type Tab = 'dashboard' | 'people' | 'orgchart' | 'invitations' | 'audit' | 'settings';

const TABS: { id: Tab, label: string, icon: any }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'people', label: 'People', icon: UsersIcon },
  { id: 'orgchart', label: 'Org Chart', icon: Network },
  { id: 'invitations', label: 'Invitations', icon: Mail },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function Avatar({ id, name, size = 32 }: { id: string, name: string, size?: number }) {
  return <UserAvatar id={id} name={name} size={size} />;
}

type BadgeVariant = 'neutral' | 'blue' | 'green' | 'red' | 'amber';
const BADGE_COLORS: Record<BadgeVariant, { light: [string, string], dark: [string, string] }> = {
  // [background, text]
  neutral: { light: ['#f1f3f4', '#3c4043'], dark: ['#33363a', '#c7cace'] },
  blue: { light: ['#e8f0fe', '#0b57d0'], dark: ['#0d2b4e', '#a8c7fa'] },
  green: { light: ['#e6f4ea', '#137333'], dark: ['#0f2e1c', '#81c995'] },
  red: { light: ['#fce8e6', '#b3261e'], dark: ['#3b1411', '#f2b8b5'] },
  amber: { light: ['#fff4d6', '#9a6700'], dark: ['#352a0a', '#fdd663'] },
};

function Badge({ text, variant = 'neutral' }: { text: string, variant?: BadgeVariant }) {
  const theme = useTheme();
  const [bg, color] = BADGE_COLORS[variant][theme === 'dark' ? 'dark' : 'light'];
  return <span style={{ fontSize: '12px', fontWeight: 600, color, background: bg, padding: '2px 8px', borderRadius: '10px' }}>{text}</span>;
}

function formatBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function AdminConsole({ currentUser }: { currentUser: CurrentUser }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  if (currentUser.globalRole !== 'admin') return <div style={{ padding: '40px' }}>Access Denied.</div>;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: '200px', borderRight: '1px solid var(--m3-border)', padding: '16px 8px', flexShrink: 0 }}>
        <h2 style={{ fontSize: '14px', color: 'var(--m3-text-secondary)', padding: '0 12px 12px', fontWeight: 600 }}>ADMIN</h2>
        {TABS.map(t => (
          <div key={t.id} className={`m3-nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} style={{ fontSize: '14px' }}>
            <t.icon size={18} /> {t.label}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'people' && <People currentUser={currentUser} />}
        {tab === 'orgchart' && <OrgChart />}
        {tab === 'invitations' && <Invitations />}
        {tab === 'audit' && <Audit />}
        {tab === 'settings' && <SettingsTab />}
      </div>
      <PasswordPrompt />
    </div>
  );
}

// ---------------- Dashboard ----------------
function Dashboard() {
  const [s, setS] = useState<any>(null);
  useEffect(() => { apiGet('/api/admin/stats').then(setS).catch(() => {}); }, []);
  if (!s) return <div>Loading…</div>;
  const cards = [
    { label: 'Users', value: s.users, sub: `${s.activeUsers} active · ${s.suspendedUsers} suspended` },
    { label: 'Pending invites', value: s.pendingInvites },
    { label: 'Org units', value: s.groups },
    { label: 'Documents', value: s.nodes.document + s.nodes.file, sub: `${s.nodes.document} pages · ${s.nodes.file} files` },
    { label: 'Storage used', value: formatBytes(s.storageBytes) },
  ];
  return (
    <div>
      <h1 style={{ fontWeight: 400, marginBottom: '24px' }}>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: 'var(--m3-bg)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ fontSize: '13px', color: 'var(--m3-text-secondary)' }}>{c.label}</div>
            <div style={{ fontSize: '30px', fontWeight: 500, margin: '4px 0' }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{c.sub}</div>}
          </div>
        ))}
      </div>
      <h2 style={{ fontWeight: 500, fontSize: '18px', marginBottom: '12px' }}>Recent activity</h2>
      <div style={{ background: 'var(--m3-bg)', borderRadius: '16px', padding: '8px 16px' }}>
        {(s.recentActivity || []).length === 0 && <div style={{ padding: '16px', color: 'var(--m3-text-secondary)' }}>No activity yet.</div>}
        {(s.recentActivity || []).map((a: any) => (
          <div key={a.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--m3-border)', fontSize: '14px', display: 'flex', justifyContent: 'space-between' }}>
            <span><b>{a.action}</b> {a.targetType ? `· ${a.targetType}` : ''}</span>
            <span style={{ color: 'var(--m3-text-secondary)', fontSize: '12px' }}>{new Date(a.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- People ----------------
function People({ currentUser }: { currentUser: CurrentUser }) {
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [confirm, setConfirm] = useState<{ msg: string, action: () => void } | null>(null);

  const load = () => {
    apiGet(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(setUsers).catch(() => {});
    apiGet('/api/admin/groups').then(setGroups).catch(() => {});
  };
  useEffect(() => { load(); }, [search]);
  const groupName = (id: string) => groups.find(g => g.id === id)?.name || id;

  const patch = async (id: string, body: any) => {
    const res = await apiSend(`/api/admin/users/${id}`, 'PATCH', body);
    if (!res.ok) alert((await res.json()).error || 'Failed');
    setMenuId(null); load();
  };
  const resetPw = async (id: string) => {
    const newPw = await inlinePassword(); // modal-based; avoids window.prompt
    if (!newPw) return;
    const res = await apiSend(`/api/admin/users/${id}/reset-password`, 'POST', { password: newPw });
    alert(res.ok ? 'Password reset. The user must sign in again.' : ((await res.json()).error || 'Failed'));
    setMenuId(null);
  };
  const forceSignout = async (id: string) => { await apiSend(`/api/admin/users/${id}/revoke-sessions`, 'POST'); setMenuId(null); alert('Signed out of all sessions.'); };
  const del = (u: any) => setConfirm({
    msg: `Delete ${u.name}? Their files & pages stay but show no owner. This cannot be undone.`,
    action: async () => { const r = await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); if (!r.ok) alert((await r.json()).error || 'Failed'); setConfirm(null); load(); },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ fontWeight: 400 }}>People</h1>
        <button className="m3-action-button" onClick={() => setShowInvite(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Plus size={16} /> Invite people</button>
      </div>
      <input className="modal-input" placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: '360px' }} />

      <div className="m3-table-header" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 40px', padding: '8px 12px', marginTop: '12px' }}>
        <div>User</div><div>Role</div><div>Status</div><div></div>
      </div>
      {users.map(u => (
        <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 40px', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--m3-border)', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Avatar id={u.id} name={u.name} />
            <div>
              <div style={{ fontWeight: 500 }}>{u.name}{u.id === currentUser.id && <span style={{ color: 'var(--m3-text-secondary)', fontWeight: 400 }}> (you)</span>}</div>
              <div style={{ fontSize: '13px', color: 'var(--m3-text-secondary)' }}>{u.email}</div>
              {u.groupIds?.length > 0 && <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>{u.groupIds.map((g: string) => <Badge key={g} text={groupName(g)} variant="neutral" />)}</div>}
            </div>
          </div>
          <div>{u.globalRole === 'admin' ? <Badge text="Admin" variant="blue" /> : <Badge text="Member" variant="neutral" />}</div>
          <div>{u.status === 'suspended' ? <Badge text="Suspended" variant="red" /> : <Badge text="Active" variant="green" />}</div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setMenuId(menuId === u.id ? null : u.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px' }}><MoreVertical size={18} /></button>
            {menuId === u.id && (
              <div style={{ position: 'absolute', right: 0, top: '36px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 100, minWidth: '190px' }}>
                <div className="m3-menu-item" onClick={() => patch(u.id, { globalRole: u.globalRole === 'admin' ? 'member' : 'admin' })}>{u.globalRole === 'admin' ? 'Demote to member' : 'Make admin'}</div>
                <div className="m3-menu-item" onClick={() => patch(u.id, { status: u.status === 'suspended' ? 'active' : 'suspended' })}>{u.status === 'suspended' ? 'Reactivate' : 'Suspend'}</div>
                <div className="m3-menu-item" onClick={() => resetPw(u.id)}>Reset password</div>
                <div className="m3-menu-item" onClick={() => forceSignout(u.id)}>Force sign-out</div>
                <div className="m3-menu-item" style={{ color: 'red' }} onClick={() => { setMenuId(null); del(u); }}>Delete</div>
              </div>
            )}
          </div>
        </div>
      ))}

      {showInvite && <InviteModal groups={groups} onClose={() => { setShowInvite(false); }} />}
      {confirm && <ConfirmModal msg={confirm.msg} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// Tiny modal-based password entry (avoids window.prompt, which is blocked in some browsers).
let _pwResolver: ((v: string | null) => void) | null = null;
function inlinePassword(): Promise<string | null> {
  return new Promise((resolve) => { _pwResolver = resolve; window.dispatchEvent(new CustomEvent('of-ask-password')); });
}

function InviteModal({ groups, onClose }: { groups: any[], onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    setError('');
    const res = await apiSend('/api/admin/invitations', 'POST', { email, role, groupIds });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Failed'); return; }
    setLink(`${window.location.origin}/?invite=${data.token}`);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <h2 style={{ marginBottom: '16px', fontWeight: 500 }}>Invite people</h2>
        {!link ? (
          <>
            <input className="modal-input" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
            <select className="modal-input" value={role} onChange={e => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <div style={{ fontSize: '13px', color: 'var(--m3-text-secondary)', margin: '8px 0 4px' }}>Add to org units</div>
            <div style={{ maxHeight: '140px', overflowY: 'auto', border: '1px solid var(--m3-border)', borderRadius: '8px', padding: '8px' }}>
              {groups.map(g => (
                <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px', fontSize: '14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={groupIds.includes(g.id)} onChange={e => setGroupIds(p => e.target.checked ? [...p, g.id] : p.filter(x => x !== g.id))} />
                  {g.name}
                </label>
              ))}
            </div>
            {error && <div style={{ color: 'red', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)' }} onClick={onClose}>Cancel</button>
              <button className="m3-action-button" onClick={create}>Create invite</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '14px', color: 'var(--m3-text-secondary)', marginBottom: '12px' }}>Share this link with the new user. It expires in 7 days.</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="modal-input" readOnly value={link} style={{ flex: 1 }} onFocus={e => e.target.select()} />
              <button className="m3-action-button" onClick={() => navigator.clipboard.writeText(link)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Copy size={16} /> Copy</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="m3-action-button" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- Org Chart ----------------
const ACCESS_ROLES = ['viewer', 'commenter', 'editor', 'manager'];

function OrgChart() {
  const [groups, setGroups] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [members, setMembers] = useState<Record<string, any[]>>({});
  const [resources, setResources] = useState<Record<string, any[]>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [confirm, setConfirm] = useState<{ msg: string, action: () => void } | null>(null);
  const [folderFor, setFolderFor] = useState<any | null>(null);

  const load = () => { apiGet('/api/admin/groups').then(setGroups).catch(() => {}); apiGet('/api/admin/users').then(setUsers).catch(() => {}); };
  useEffect(() => { load(); }, []);

  const loadMembers = (id: string) => apiGet(`/api/admin/groups/${id}/members`).then(m => setMembers(p => ({ ...p, [id]: m })));
  const loadResources = (id: string) => apiGet(`/api/admin/groups/${id}/resources`).then(r => setResources(p => ({ ...p, [id]: r })));
  const toggle = (id: string) => { const open = !expanded[id]; setExpanded(p => ({ ...p, [id]: open })); if (open) { loadMembers(id); loadResources(id); } };

  const addGroup = async (parentId: string | null) => { await apiSend('/api/admin/groups', 'POST', { name: 'New Org Unit', parentId }); load(); };
  const reparent = async (id: string, parentId: string) => { const r = await apiSend(`/api/admin/groups/${id}`, 'PATCH', { parentId: parentId || null }); if (!r.ok) alert((await r.json()).error || 'Failed'); load(); };
  const rename = async (id: string) => { setRenaming(null); if (renameVal.trim()) { await apiSend(`/api/admin/groups/${id}`, 'PATCH', { name: renameVal.trim() }); load(); } };
  const delGroup = (g: any) => setConfirm({ msg: `Delete "${g.name}"? Its sub-units move up a level and members are removed from it.`, action: async () => { await api(`/api/admin/groups/${g.id}`, { method: 'DELETE' }); setConfirm(null); load(); } });
  const addMember = async (gid: string, userId: string) => { if (!userId) return; await apiSend(`/api/admin/groups/${gid}/members`, 'POST', { userId }); loadMembers(gid); load(); };
  const removeMember = async (gid: string, userId: string) => { await api(`/api/admin/groups/${gid}/members/${userId}`, { method: 'DELETE' }); loadMembers(gid); load(); };
  const changeAccess = async (nodeId: string, gid: string, role: string) => { await apiSend(`/api/nodes/${nodeId}/permissions`, 'POST', { granteeType: 'group', granteeId: gid, role }); loadResources(gid); };
  const removeAccess = async (permId: string, gid: string) => { await api(`/api/permissions/${permId}`, { method: 'DELETE' }); loadResources(gid); };

  const childrenOf = (pid: string | null) => groups.filter(g => (g.parentId || null) === pid);

  const renderNode = (g: any, depth: number): any => (
    <div key={g.id}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 8px', paddingLeft: depth * 24 + 8, borderBottom: '1px solid var(--m3-border)' }}>
        <button onClick={() => toggle(g.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--m3-text-secondary)', display: 'flex' }}>
          {expanded[g.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <Network size={16} color="var(--m3-text-secondary)" />
        {renaming === g.id ? (
          <input autoFocus className="modal-input" value={renameVal} onChange={e => setRenameVal(e.target.value)} onBlur={() => rename(g.id)} onKeyDown={e => { if (e.key === 'Enter') rename(g.id); if (e.key === 'Escape') setRenaming(null); }} style={{ margin: 0, maxWidth: '220px', padding: '6px 10px' }} />
        ) : (
          <span style={{ fontWeight: 500, cursor: 'text' }} onClick={() => { setRenaming(g.id); setRenameVal(g.name); }}>{g.name}</span>
        )}
        <Badge text={`${g.memberCount} member${g.memberCount === 1 ? '' : 's'}`} variant="neutral" />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select className="m3-select" value={g.parentId || ''} onChange={e => reparent(g.id, e.target.value)} title="Move under">
            <option value="">Top level</option>
            {groups.filter(o => o.id !== g.id).map(o => <option key={o.id} value={o.id}>↳ {o.name}</option>)}
          </select>
          <button className="m3-small-btn" onClick={() => setFolderFor(g)}><FolderPlus size={14} /> Folder</button>
          <button className="m3-small-btn" onClick={() => addGroup(g.id)}><Plus size={14} /> Sub-unit</button>
          <button className="m3-small-btn danger" onClick={() => delGroup(g)}>Delete</button>
        </div>
      </div>
      {expanded[g.id] && (
        <div style={{ paddingLeft: depth * 24 + 46, paddingRight: '8px', paddingBottom: '12px', background: 'var(--m3-surface-2)' }}>
          {/* Members */}
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--m3-text-secondary)', textTransform: 'uppercase', padding: '10px 0 4px' }}>Members</div>
          {(members[g.id] || []).length === 0 && <div style={{ fontSize: '13px', color: 'var(--m3-text-secondary)', padding: '2px 0' }}>No members yet.</div>}
          {(members[g.id] || []).map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
              <Avatar id={m.id} name={m.name} size={24} />
              <span style={{ fontSize: '14px' }}>{m.name}</span>
              <span style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{m.email}</span>
              <button className="m3-small-btn danger" style={{ marginLeft: '8px', padding: '3px 10px' }} onClick={() => removeMember(g.id, m.id)}>Remove</button>
            </div>
          ))}
          <select className="m3-select" value="" onChange={e => { addMember(g.id, e.target.value); e.target.value = ''; }} style={{ marginTop: '8px' }}>
            <option value="">+ Add member…</option>
            {users.filter(u => !(members[g.id] || []).some(m => m.id === u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>

          {/* Shared folders */}
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--m3-text-secondary)', textTransform: 'uppercase', padding: '14px 0 4px' }}>Shared folders</div>
          {(resources[g.id] || []).length === 0 && <div style={{ fontSize: '13px', color: 'var(--m3-text-secondary)', padding: '2px 0' }}>No shared folders for this unit yet.</div>}
          {(resources[g.id] || []).map(r => (
            <div key={r.permId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
              <FolderIcon size={18} color="var(--m3-text-secondary)" />
              <span style={{ fontSize: '14px' }}>{r.name}</span>
              <select className="m3-select" value={r.role} onChange={e => changeAccess(r.id, g.id, e.target.value)} title="Access level">
                {ACCESS_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
              </select>
              <button className="m3-small-btn danger" style={{ padding: '3px 10px' }} onClick={() => removeAccess(r.permId, g.id)}>Remove access</button>
            </div>
          ))}
          <button className="m3-small-btn" style={{ marginTop: '8px' }} onClick={() => setFolderFor(g)}><FolderPlus size={14} /> New shared folder</button>
        </div>
      )}
      {childrenOf(g.id).map(c => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ fontWeight: 400 }}>Org Chart</h1>
        <button className="m3-action-button" onClick={() => addGroup(null)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Plus size={16} /> New top-level unit</button>
      </div>
      <div style={{ background: 'var(--m3-surface)', borderRadius: '12px', border: '1px solid var(--m3-border)', overflow: 'hidden' }}>
        {childrenOf(null).map(g => renderNode(g, 0))}
        {groups.length === 0 && <div style={{ padding: '24px', color: 'var(--m3-text-secondary)' }}>No org units yet.</div>}
      </div>
      {confirm && <ConfirmModal msg={confirm.msg} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />}
      {folderFor && <FolderModal group={folderFor} onClose={() => setFolderFor(null)} onCreated={() => { const g = folderFor; setFolderFor(null); setExpanded(p => ({ ...p, [g.id]: true })); loadResources(g.id); }} />}
    </div>
  );
}

// Modal: create a shared folder for an org unit and set the group's access level.
function FolderModal({ group, onClose, onCreated }: { group: any, onClose: () => void, onCreated: () => void }) {
  const [name, setName] = useState(`${group.name} Shared`);
  const [role, setRole] = useState('editor');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const res = await apiSend(`/api/admin/groups/${group.id}/folder`, 'POST', { name, role });
    setBusy(false);
    if (!res.ok) { alert((await res.json()).error || 'Failed'); return; }
    onCreated();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <h2 style={{ fontWeight: 500, marginBottom: '6px' }}>New shared folder</h2>
        <p style={{ fontSize: '14px', color: 'var(--m3-text-secondary)', marginBottom: '16px' }}>Everyone in <b>{group.name}</b> (and its sub-units) gets access. It appears under their “Shared with me”.</p>
        <label style={{ fontSize: '13px', fontWeight: 500 }}>Folder name</label>
        <input className="modal-input" value={name} onChange={e => setName(e.target.value)} />
        <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginTop: '12px' }}>Access level for this unit</label>
        <select className="modal-input" value={role} onChange={e => setRole(e.target.value)}>
          <option value="viewer">Viewer — can view</option>
          <option value="commenter">Commenter — can comment</option>
          <option value="editor">Editor — can edit & add files</option>
          <option value="manager">Manager — full control</option>
        </select>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
          <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)' }} onClick={onClose}>Cancel</button>
          <button className="m3-action-button" disabled={busy || !name.trim()} onClick={create}>{busy ? 'Creating…' : 'Create folder'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Invitations ----------------
function Invitations() {
  const [invites, setInvites] = useState<any[]>([]);
  const load = () => apiGet('/api/admin/invitations').then(setInvites).catch(() => {});
  useEffect(() => { load(); }, []);
  const revoke = async (id: string) => { await api(`/api/admin/invitations/${id}`, { method: 'DELETE' }); load(); };
  const linkFor = (t: string) => `${window.location.origin}/?invite=${t}`;

  return (
    <div>
      <h1 style={{ fontWeight: 400, marginBottom: '20px' }}>Invitations</h1>
      <div className="m3-table-header" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.4fr', padding: '8px 12px' }}>
        <div>Email</div><div>Role</div><div>Status</div><div></div>
      </div>
      {invites.length === 0 && <div style={{ padding: '24px', color: 'var(--m3-text-secondary)' }}>No invitations yet. Invite people from the People tab.</div>}
      {invites.map(i => (
        <div key={i.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.4fr', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--m3-border)' }}>
          <div style={{ fontWeight: 500 }}>{i.email}</div>
          <div style={{ fontSize: '14px' }}>{i.role}</div>
          <div>
            {i.status === 'pending' && <Badge text="Pending" variant="amber" />}
            {i.status === 'accepted' && <Badge text="Accepted" variant="green" />}
            {i.status === 'revoked' && <Badge text="Revoked" variant="red" />}
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {i.status === 'pending' && <>
              <button className="m3-menu-item" style={{ padding: '4px 10px' }} onClick={() => navigator.clipboard.writeText(linkFor(i.token))}><Copy size={14} /> Copy link</button>
              <button className="m3-menu-item" style={{ padding: '4px 10px', color: 'red' }} onClick={() => revoke(i.id)}>Revoke</button>
            </>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Audit ----------------
function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { apiGet('/api/admin/audit').then(setRows).catch(() => {}); apiGet('/api/admin/users').then(setUsers).catch(() => {}); }, []);
  const actorName = (id: string) => users.find(u => u.id === id)?.name || id;
  return (
    <div>
      <h1 style={{ fontWeight: 400, marginBottom: '20px' }}>Audit Log</h1>
      <div className="m3-table-header" style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1.5fr 1.2fr', padding: '8px 12px' }}>
        <div>Actor</div><div>Action</div><div>Target</div><div>When</div>
      </div>
      {rows.length === 0 && <div style={{ padding: '24px', color: 'var(--m3-text-secondary)' }}>No audit entries yet.</div>}
      {rows.map(a => (
        <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1.5fr 1.2fr', padding: '10px 12px', borderBottom: '1px solid var(--m3-border)', fontSize: '14px' }}>
          <div>{actorName(a.actorId)}</div>
          <div style={{ fontWeight: 500 }}>{a.action}</div>
          <div style={{ color: 'var(--m3-text-secondary)' }}>{a.targetType ? `${a.targetType}: ${a.targetId}` : '—'}</div>
          <div style={{ color: 'var(--m3-text-secondary)', fontSize: '13px' }}>{new Date(a.createdAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Settings ----------------
function SettingsTab() {
  const [s, setS] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { apiGet('/api/admin/settings').then(setS).catch(() => {}); }, []);
  const set = (k: string, v: string) => setS(p => ({ ...p, [k]: v }));
  const save = async () => { await apiSend('/api/admin/settings', 'PUT', s); setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const field = (key: string, label: string, hint?: string) => (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>{label}</label>
      <input className="modal-input" style={{ maxWidth: '420px', margin: 0 }} value={s[key] || ''} onChange={e => set(key, e.target.value)} />
      {hint && <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', marginTop: '4px' }}>{hint}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: '480px' }}>
      <h1 style={{ fontWeight: 400, marginBottom: '24px' }}>Workspace Settings</h1>
      {field('workspaceName', 'Workspace name', 'Shown on the login screen and top bar.')}
      {field('workspaceLogo', 'Logo URL', 'An image URL shown next to the workspace name.')}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>Default role for new users</label>
        <select className="modal-input" style={{ maxWidth: '420px', margin: 0 }} value={s.defaultRole || 'member'} onChange={e => set('defaultRole', e.target.value)}>
          <option value="member">Member</option><option value="admin">Admin</option>
        </select>
      </div>
      {field('allowedDomains', 'Allowed invite domains', 'Comma-separated, e.g. acme.com, acme.org. Leave blank to allow any.')}
      <button className="m3-action-button" onClick={save}>{saved ? 'Saved ✓' : 'Save settings'}</button>
    </div>
  );
}

// ---------------- Shared dialogs ----------------
function ConfirmModal({ msg, onConfirm, onCancel }: { msg: string, onConfirm: () => void, onCancel: () => void }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <p style={{ fontSize: '15px', marginBottom: '24px' }}>{msg}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)' }} onClick={onCancel}>Cancel</button>
          <button className="m3-action-button" style={{ background: '#d93025' }} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// Password-entry modal mounted once at the console root, driven by inlinePassword().
export function PasswordPrompt() {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  useEffect(() => {
    const h = () => { setVal(''); setOpen(true); };
    window.addEventListener('of-ask-password', h);
    return () => window.removeEventListener('of-ask-password', h);
  }, []);
  const finish = (v: string | null) => { setOpen(false); _pwResolver?.(v); _pwResolver = null; };
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={() => finish(null)}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <h2 style={{ fontWeight: 500, marginBottom: '12px' }}>Set a new password</h2>
        <input className="modal-input" type="text" autoFocus placeholder="New password (min 6 chars)" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && val.length >= 6) finish(val); }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
          <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)' }} onClick={() => finish(null)}>Cancel</button>
          <button className="m3-action-button" disabled={val.length < 6} onClick={() => finish(val)}>Set password</button>
        </div>
      </div>
    </div>
  );
}
