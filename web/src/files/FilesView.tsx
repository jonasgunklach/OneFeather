import { useEffect, useRef, useState } from 'react';
import { Upload, FolderPlus, FilePlus, List, LayoutGrid, MoreVertical, Star, ChevronRight, Download, Share2, FolderInput, Copy as CopyIcon, Pencil, Trash2, Info, X, Lock, Globe, Link2 } from 'lucide-react';
import { api, apiGet, apiSend, getToken, API_BASE } from '../api';
import { useTheme } from '../theme';
import { UserAvatar } from '../UserAvatar';
import { iconFor, formatBytes } from './fileIcons';
import { FileViewer } from './FileViewer';

type Node = any;
type Sort = { key: 'name' | 'createdAt' | 'size', dir: 1 | -1 };

function uploadWithProgress(file: File, parentId: string | null, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/nodes/upload`);
    const token = getToken(); if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    const form = new FormData(); if (parentId) form.append('parentId', parentId); form.append('file', file);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || 'upload failed')));
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send(form);
  });
}

export function FilesView({ currentUser, currentView, onOpenDoc }: { currentUser: any, currentView: string, onOpenDoc: (id: string) => void }) {
  const theme = useTheme();
  const isTrash = currentView === 'trash';
  const [nodes, setNodes] = useState<Node[]>([]);
  const [stack, setStack] = useState<{ id: string, name: string }[]>([]); // breadcrumb below the view root
  const currentFolderId = stack.length ? stack[stack.length - 1].id : null;
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [uploads, setUploads] = useState<{ name: string, p: number }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [viewer, setViewer] = useState<Node | null>(null);
  const [details, setDetails] = useState<Node | null>(null);
  const [menu, setMenu] = useState<{ x: number, y: number, node: Node } | null>(null);
  const [picker, setPicker] = useState<{ mode: 'move' | 'copy', ids: string[] } | null>(null);
  const [shareNodeId, setShareNodeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchNodes = () => {
    const url = currentFolderId && !isTrash ? `/api/nodes?parentId=${currentFolderId}` : `/api/nodes?view=${currentView}`;
    apiGet(url).then(setNodes).catch(console.error);
  };
  useEffect(() => { setStack([]); setSelected(new Set()); }, [currentView]);
  useEffect(() => { fetchNodes(); setSelected(new Set()); }, [currentUser, currentFolderId, currentView]);
  useEffect(() => { const close = () => setMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, []);

  const sorted = [...nodes].sort((a, b) => {
    const folderRank = (n: Node) => (n.type === 'drive' || n.type === 'folder') ? 0 : 1;
    if (folderRank(a) !== folderRank(b)) return folderRank(a) - folderRank(b);
    let av = a[sort.key], bv = b[sort.key];
    if (sort.key === 'name') { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase(); }
    if (sort.key === 'createdAt') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
    av = av ?? 0; bv = bv ?? 0;
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });

  const open = (n: Node) => {
    if (isTrash) return;
    if (n.type === 'drive' || n.type === 'folder') setStack(s => [...s, { id: n.id, name: n.name }]);
    else if (n.type === 'document') onOpenDoc(n.id);
    else setViewer(n);
  };

  const doUpload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const entry = { name: file.name, p: 0 };
      setUploads(u => [...u, entry]);
      try {
        await uploadWithProgress(file, currentFolderId, (p) => setUploads(u => u.map(x => x === entry ? { ...x, p } : x)));
      } catch { alert(`Upload failed: ${file.name}`); }
      setUploads(u => u.filter(x => x !== entry));
    }
    fetchNodes();
  };

  const createNode = async (type: 'folder' | 'document') => {
    setNewMenu(false);
    const res = await apiSend('/api/nodes', 'POST', { name: type === 'folder' ? 'New Folder' : 'New Page', type, parentId: currentFolderId || undefined });
    if (!res.ok) { alert('You need Editor rights here.'); return; }
    const data = await res.json();
    if (type === 'document') onOpenDoc(data.id); else fetchNodes();
  };

  const downloadFile = (n: Node) => {
    api(`/api/nodes/${n.id}/download`).then(async res => {
      if (!res.ok) return alert('Download failed');
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = n.name; a.click(); URL.revokeObjectURL(url);
    });
  };
  const toggleStar = async (n: Node) => { await api(`/api/nodes/${n.id}/star`, { method: n.starred ? 'DELETE' : 'POST' }); fetchNodes(); };
  const moveTo = async (ids: string[], parentId: string | null) => {
    for (const id of ids) { const r = await apiSend(`/api/nodes/${id}/move`, 'POST', { parentId }); if (!r.ok) alert((await r.json()).error || 'Move failed'); }
    setPicker(null); setSelected(new Set()); fetchNodes();
  };
  const copyTo = async (ids: string[], parentId: string | null) => {
    for (const id of ids) await apiSend(`/api/nodes/${id}/copy`, 'POST', { parentId });
    setPicker(null); setSelected(new Set()); fetchNodes();
  };
  const trash = async (ids: string[]) => { for (const id of ids) await api(`/api/nodes/${id}`, { method: 'DELETE' }); setSelected(new Set()); fetchNodes(); };
  const restore = async (id: string) => { await apiSend(`/api/nodes/${id}/restore`, 'POST'); fetchNodes(); };
  const permanentDelete = async (id: string) => { await api(`/api/nodes/${id}/permanent`, { method: 'DELETE' }); setConfirmDeleteId(null); fetchNodes(); };
  const commitRename = async (id: string) => { const name = renameValue.trim(); setRenamingId(null); if (!name) return; const r = await apiSend(`/api/nodes/${id}`, 'PUT', { name }); if (!r.ok) alert((await r.json()).error || 'Rename failed'); fetchNodes(); };

  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const viewTitle = ({ home: 'Home', 'my-drive': 'My Drive', 'shared-with-me': 'Shared with me', trash: 'Trash', starred: 'Starred', recent: 'Recent' } as any)[currentView] || 'Files';
  const files = sorted.filter(n => n.type === 'file' || n.type === 'document');

  // ---- context menu actions builder ----
  const menuActions = (n: Node) => isTrash
    ? [{ label: 'Restore', fn: () => restore(n.id) }, { label: 'Delete forever', danger: true, fn: () => setConfirmDeleteId(n.id) }]
    : [
      ...(n.type === 'file' || n.type === 'document' ? [{ label: 'Open', fn: () => open(n) }] : []),
      ...(n.type === 'file' ? [{ label: 'Download', icon: Download, fn: () => downloadFile(n) }] : []),
      { label: n.starred ? 'Remove star' : 'Add star', icon: Star, fn: () => toggleStar(n) },
      { label: 'Share', icon: Share2, fn: () => setShareNodeId(n.id) },
      { label: 'Move to…', icon: FolderInput, fn: () => setPicker({ mode: 'move', ids: [n.id] }) },
      { label: 'Make a copy', icon: CopyIcon, fn: () => copyTo([n.id], n.parentId || null) },
      { label: 'Rename', icon: Pencil, fn: () => { setRenamingId(n.id); setRenameValue(n.name); } },
      { label: 'Details', icon: Info, fn: () => setDetails(n) },
      { label: 'Move to Trash', icon: Trash2, danger: true, fn: () => trash([n.id]) },
    ];

  return (
    <div
      style={{ padding: '24px', position: 'relative', minHeight: '100%' }}
      onDragOver={e => { if (!isTrash) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files); }}
    >
      {/* Header / toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '22px', fontWeight: 400 }}>
          <span style={{ cursor: stack.length ? 'pointer' : 'default' }} onClick={() => setStack([])}>{viewTitle}</span>
          {stack.map((c, i) => (
            <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ChevronRight size={18} color="var(--m3-text-secondary)" />
              <span style={{ cursor: i < stack.length - 1 ? 'pointer' : 'default' }} onClick={() => setStack(s => s.slice(0, i + 1))}>{c.name}</span>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="m3-small-btn" onClick={() => setViewMode(m => m === 'list' ? 'grid' : 'list')} title="Toggle view">
            {viewMode === 'list' ? <LayoutGrid size={15} /> : <List size={15} />}
          </button>
          <select className="m3-select" value={`${sort.key}:${sort.dir}`} onChange={e => { const [k, d] = e.target.value.split(':'); setSort({ key: k as any, dir: Number(d) as 1 | -1 }); }} title="Sort">
            <option value="name:1">Name ↑</option><option value="name:-1">Name ↓</option>
            <option value="createdAt:-1">Modified (new)</option><option value="createdAt:1">Modified (old)</option>
            <option value="size:-1">Size (big)</option><option value="size:1">Size (small)</option>
          </select>
          {!isTrash && (
            <div style={{ position: 'relative' }}>
              <button className="m3-action-button" onClick={() => setNewMenu(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>+ New</button>
              {newMenu && (
                <div style={{ position: 'absolute', right: 0, top: '42px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.14)', zIndex: 120, minWidth: '180px', overflow: 'hidden' }}>
                  <div className="m3-menu-item" onClick={() => createNode('folder')}><FolderPlus size={16} style={{ verticalAlign: '-3px', marginRight: '8px' }} />New Folder</div>
                  <div className="m3-menu-item" onClick={() => createNode('document')}><FilePlus size={16} style={{ verticalAlign: '-3px', marginRight: '8px' }} />New Page</div>
                  <div className="m3-menu-item" onClick={() => { setNewMenu(false); fileInputRef.current?.click(); }}><Upload size={16} style={{ verticalAlign: '-3px', marginRight: '8px' }} />Upload files</div>
                </div>
              )}
            </div>
          )}
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files?.length) doUpload(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--m3-primary-container)', color: 'var(--m3-on-primary-container)', borderRadius: '12px', padding: '8px 16px', marginBottom: '12px' }}>
          <span style={{ fontWeight: 500 }}>{selected.size} selected</span>
          <button className="m3-small-btn" onClick={() => setPicker({ mode: 'move', ids: [...selected] })}><FolderInput size={14} /> Move</button>
          <button className="m3-small-btn" onClick={() => { [...selected].forEach(id => { const n = nodes.find(x => x.id === id); if (n?.type === 'file') downloadFile(n); }); }}><Download size={14} /> Download</button>
          <button className="m3-small-btn danger" onClick={() => trash([...selected])}><Trash2 size={14} /> Trash</button>
          <button className="m3-small-btn" style={{ marginLeft: 'auto', border: 'none' }} onClick={() => setSelected(new Set())}><X size={14} /></button>
        </div>
      )}

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          {uploads.map((u, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '4px 0' }}>
              <Upload size={14} color="var(--m3-primary)" />
              <span style={{ width: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
              <div style={{ flex: 1, maxWidth: '300px', height: '6px', background: 'var(--m3-surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(u.p * 100)}%`, height: '100%', background: 'var(--m3-primary)', transition: 'width .1s' }} />
              </div>
              <span>{Math.round(u.p * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Body: list or grid */}
      {sorted.length === 0 && uploads.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--m3-text-secondary)' }}>
          {isTrash ? 'Trash is empty.' : 'Drop files here, or use + New to add content.'}
        </div>
      )}

      {viewMode === 'list' && sorted.length > 0 && (
        <div>
          <div className="m3-table-header" style={{ display: 'grid', gridTemplateColumns: '28px 1fr 140px 120px 90px 40px', padding: '0 12px 8px', alignItems: 'center' }}>
            <div></div><div>Name</div><div>Owner</div><div>Modified</div><div>Size</div><div></div>
          </div>
          {sorted.map(n => (
            <FileRow key={n.id} n={n} theme={theme} isTrash={isTrash} selected={selected.has(n.id)}
              renaming={renamingId === n.id} renameValue={renameValue} setRenameValue={setRenameValue} commitRename={commitRename}
              onToggleSel={() => toggleSel(n.id)} onOpen={() => open(n)}
              onMenu={(x: number, y: number) => setMenu({ x, y, node: n })}
              onDropMove={(srcId: string) => moveTo([srcId], n.id)} />
          ))}
        </div>
      )}

      {viewMode === 'grid' && sorted.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px' }}>
          {sorted.map(n => {
            const { Icon, color, fill } = iconFor(n, theme);
            const isFolder = n.type === 'drive' || n.type === 'folder';
            return (
              <div key={n.id} draggable={!isTrash} onDragStart={e => e.dataTransfer.setData('node', n.id)}
                onDragOver={e => { if (isFolder) e.preventDefault(); }} onDrop={e => { if (isFolder) { const id = e.dataTransfer.getData('node'); if (id && id !== n.id) moveTo([id], n.id); } }}
                onClick={() => open(n)} onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, node: n }); }}
                style={{ border: `1px solid ${selected.has(n.id) ? 'var(--m3-primary)' : 'var(--m3-border)'}`, borderRadius: '12px', padding: '16px', cursor: 'pointer', background: 'var(--m3-surface)', position: 'relative' }}>
                <input type="checkbox" checked={selected.has(n.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSel(n.id)} style={{ position: 'absolute', top: '8px', left: '8px' }} />
                {n.starred && <Star size={14} fill="#f9ab00" color="#f9ab00" style={{ position: 'absolute', top: '10px', right: '10px' }} />}
                <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0' }}><Icon size={44} color={color} {...(fill ? { fill: color } : {})} /></div>
                <div style={{ fontSize: '13px', fontWeight: 500, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drag overlay */}
      {dragOver && !isTrash && (
        <div style={{ position: 'absolute', inset: '12px', border: '3px dashed var(--m3-primary)', borderRadius: '16px', background: 'rgba(11,87,208,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 50 }}>
          <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--m3-primary)' }}>Drop files to upload</div>
        </div>
      )}

      {/* Context menu */}
      {menu && (
        <div style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 320), background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '10px', boxShadow: '0 6px 20px rgba(0,0,0,0.18)', zIndex: 300, minWidth: '190px', overflow: 'hidden', padding: '4px 0' }} onClick={e => e.stopPropagation()}>
          {menuActions(menu.node).map((a: any, i: number) => (
            <div key={i} className="m3-menu-item" style={{ color: a.danger ? '#ea4335' : undefined, display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setMenu(null); a.fn(); }}>
              {a.icon ? <a.icon size={15} /> : <span style={{ width: 15 }} />}{a.label}
            </div>
          ))}
        </div>
      )}

      {viewer && <FileViewer node={viewer} onClose={() => setViewer(null)} onDownload={downloadFile}
        onPrev={files.length > 1 ? () => { const i = files.findIndex(f => f.id === viewer.id); setViewer(files[(i - 1 + files.length) % files.length]); } : undefined}
        onNext={files.length > 1 ? () => { const i = files.findIndex(f => f.id === viewer.id); setViewer(files[(i + 1) % files.length]); } : undefined} />}

      {details && <DetailsPanel node={details} theme={theme} onClose={() => setDetails(null)}
        onStar={() => { toggleStar(details); setDetails({ ...details, starred: !details.starred }); }}
        onShare={() => setShareNodeId(details.id)}
        onMove={() => setPicker({ mode: 'move', ids: [details.id] })} />}
      {picker && <FolderPicker mode={picker.mode} onPick={(pid) => picker.mode === 'move' ? moveTo(picker.ids, pid) : copyTo(picker.ids, pid)} onClose={() => setPicker(null)} />}
      {shareNodeId && <ShareModal nodeId={shareNodeId} currentUser={currentUser} onClose={() => setShareNodeId(null)} />}
      {confirmDeleteId && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <h2 style={{ marginBottom: '12px', fontWeight: 500 }}>Delete forever?</h2>
            <p style={{ fontSize: '14px', color: 'var(--m3-text-secondary)', marginBottom: '24px' }}>This permanently deletes the item. This cannot be undone.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)' }} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button className="m3-action-button" style={{ background: '#d93025' }} onClick={() => permanentDelete(confirmDeleteId)}>Delete forever</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FileRow({ n, theme, isTrash, selected, renaming, renameValue, setRenameValue, commitRename, onToggleSel, onOpen, onMenu, onDropMove }: any) {
  const { Icon, color, fill } = iconFor(n, theme);
  const isFolder = n.type === 'drive' || n.type === 'folder';
  return (
    <div className="m3-table-row" style={{ display: 'grid', gridTemplateColumns: '28px 1fr 140px 120px 90px 40px', alignItems: 'center', padding: '8px 12px' }}
      draggable={!isTrash && !renaming} onDragStart={e => e.dataTransfer.setData('node', n.id)}
      onDragOver={e => { if (isFolder && !isTrash) e.preventDefault(); }} onDrop={e => { if (isFolder && !isTrash) { const id = e.dataTransfer.getData('node'); if (id && id !== n.id) onDropMove(id); } }}
      onContextMenu={e => { if (!isTrash) { e.preventDefault(); onMenu(e.clientX, e.clientY); } }}>
      <input type="checkbox" checked={selected} onClick={e => e.stopPropagation()} onChange={onToggleSel} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: 500, minWidth: 0 }} onClick={() => !renaming && onOpen()}>
        <Icon size={22} color={color} {...(fill ? { fill: color } : {})} style={{ flexShrink: 0 }} />
        {renaming ? (
          <input autoFocus value={renameValue} onClick={e => e.stopPropagation()} onChange={e => setRenameValue(e.target.value)} onBlur={() => commitRename(n.id)}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(n.id); if (e.key === 'Escape') commitRename(n.id); }}
            style={{ fontSize: '14px', fontWeight: 500, padding: '4px 8px', border: '1px solid var(--m3-primary)', borderRadius: '6px' }} />
        ) : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>}
        {n.starred && <Star size={14} fill="#f9ab00" color="#f9ab00" style={{ flexShrink: 0 }} />}
      </div>
      <div style={{ color: 'var(--m3-text-secondary)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}><UserAvatar id={n.ownerId} name={n.ownerName || n.ownerId} size={22} /> {n.ownerName || n.ownerId}</div>
      <div style={{ color: 'var(--m3-text-secondary)', fontSize: '13px' }}>{new Date(n.createdAt).toLocaleDateString()}</div>
      <div style={{ color: 'var(--m3-text-secondary)', fontSize: '13px' }}>{n.type === 'file' ? formatBytes(n.size) : '—'}</div>
      <button onClick={e => { e.stopPropagation(); onMenu(e.clientX, e.clientY); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px' }}><MoreVertical size={18} color="var(--m3-text-secondary)" /></button>
    </div>
  );
}

function DetailsPanel({ node, theme, onClose, onStar, onShare, onMove }: any) {
  const { Icon, color, fill } = iconFor(node, theme);
  const [location, setLocation] = useState('…');
  useEffect(() => {
    apiGet(`/api/nodes/${node.id}/path`).then((chain: any[]) => {
      const loc = chain.slice(0, -1);
      setLocation(loc.length ? loc.map(c => c.name).join(' › ') : 'My Drive');
    }).catch(() => setLocation('My Drive'));
  }, [node.id]);
  return (
    <div style={{ position: 'fixed', right: 0, top: 0, height: '100vh', width: '320px', background: 'var(--m3-surface)', borderLeft: '1px solid var(--m3-border)', zIndex: 250, padding: '20px', overflowY: 'auto', boxShadow: '-4px 0 16px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <strong>Details</strong>
        <button className="m3-small-btn" style={{ border: 'none' }} onClick={onClose}><X size={16} /></button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}><Icon size={56} color={color} {...(fill ? { fill: color } : {})} /></div>
      <div style={{ fontWeight: 500, textAlign: 'center', marginBottom: '20px', wordBreak: 'break-word' }}>{node.name}</div>
      {[['Type', node.type === 'file' ? (node.mimeType || 'File') : node.type], ['Location', location], ['Size', node.type === 'file' ? formatBytes(node.size) : '—'], ['Owner', node.ownerName || node.ownerId], ['Created', new Date(node.createdAt).toLocaleString()]].map(([k, v]) => (
        <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--m3-border)', fontSize: '14px' }}>
          <span style={{ color: 'var(--m3-text-secondary)' }}>{k}</span><span style={{ textAlign: 'right', maxWidth: '180px', wordBreak: 'break-word' }}>{v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
        <button className="m3-small-btn" onClick={onShare}><Share2 size={14} /> Share</button>
        <button className="m3-small-btn" onClick={onMove}><FolderInput size={14} /> Move</button>
        <button className="m3-small-btn" onClick={onStar}><Star size={14} fill={node.starred ? '#f9ab00' : 'none'} color={node.starred ? '#f9ab00' : 'currentColor'} /> {node.starred ? 'Starred' : 'Add star'}</button>
      </div>
    </div>
  );
}

export function FolderPicker({ mode, onPick, onClose }: { mode: 'move' | 'copy', onPick: (parentId: string | null) => void, onClose: () => void }) {
  const [folders, setFolders] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { apiGet('/api/nodes?view=folders').then(setFolders).catch(() => setFolders([])); }, []);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <h2 style={{ fontWeight: 500, marginBottom: '12px' }}>{mode === 'move' ? 'Move to' : 'Copy to'}</h2>
        <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--m3-border)', borderRadius: '8px' }}>
          <div className={`m3-menu-item ${sel === null ? '' : ''}`} style={{ background: sel === '__root' ? 'var(--m3-surface-container)' : undefined }} onClick={() => setSel('__root')}>📁 My Drive (top level)</div>
          {folders.map(f => (
            <div key={f.id} className="m3-menu-item" style={{ background: sel === f.id ? 'var(--m3-surface-container)' : undefined, display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => setSel(f.id)}>
              <FolderInput size={15} color="var(--m3-text-secondary)" /> {f.name}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
          <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)' }} onClick={onClose}>Cancel</button>
          <button className="m3-action-button" disabled={!sel} onClick={() => onPick(sel === '__root' ? null : sel)}>{mode === 'move' ? 'Move here' : 'Copy here'}</button>
        </div>
      </div>
    </div>
  );
}

// ===== Share dialog (Google-Drive-style: people + roles + general access + copy link) =====
const ROLES = ['viewer', 'commenter', 'editor', 'manager'];
const ROLE_LABEL: Record<string, string> = { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor', manager: 'Manager' };

export function ShareModal({ nodeId, currentUser, onClose }: { nodeId: string, currentUser?: any, onClose: () => void }) {
  const [node, setNode] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [perms, setPerms] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [wsName, setWsName] = useState('your organization');

  const reload = () => apiGet(`/api/nodes/${nodeId}/permissions`).then(setPerms).catch(() => setError('You need Manager rights to manage sharing.'));
  useEffect(() => {
    apiGet(`/api/nodes/${nodeId}`).then(setNode).catch(() => {});
    apiGet('/api/directory').then(d => { setUsers(d.users); setGroups(d.groups); });
    apiGet('/api/workspace').then((w: any) => setWsName(w.name || 'your organization')).catch(() => {});
    reload();
  }, [nodeId]);

  const userBy = (id: string) => users.find(u => u.id === id);
  const groupBy = (id: string) => groups.find(g => g.id === id);
  const ownerId = node?.ownerId;
  const peoplePerms = perms.filter(p => (p.granteeType === 'user' || p.granteeType === 'group') && p.granteeId !== ownerId);
  const generalMode: 'restricted' | 'workspace' | 'public' =
    perms.some(p => p.granteeType === 'public') ? 'public' : perms.some(p => p.granteeType === 'workspace') ? 'workspace' : 'restricted';
  const generalRole = (perms.find(p => p.granteeType === 'public') || perms.find(p => p.granteeType === 'workspace'))?.role || 'viewer';

  const add = async (granteeType: string, granteeId: string) => {
    await apiSend(`/api/nodes/${nodeId}/permissions`, 'POST', { granteeType, granteeId, role: 'editor' });
    setQuery(''); reload();
  };
  const setRole = async (p: any, role: string) => {
    if (role === '__remove') { await api(`/api/permissions/${p.id}`, { method: 'DELETE' }); }
    else await apiSend(`/api/nodes/${nodeId}/permissions`, 'POST', { granteeType: p.granteeType, granteeId: p.granteeId, role });
    reload();
  };
  const setGeneral = async (mode: 'restricted' | 'workspace' | 'public', role = generalRole) => {
    for (const p of perms) if (p.granteeType === 'public' || p.granteeType === 'workspace') await api(`/api/permissions/${p.id}`, { method: 'DELETE' });
    if (mode === 'workspace') await apiSend(`/api/nodes/${nodeId}/permissions`, 'POST', { granteeType: 'workspace', granteeId: 'workspace', role });
    if (mode === 'public') await apiSend(`/api/nodes/${nodeId}/permissions`, 'POST', { granteeType: 'public', granteeId: 'all', role });
    reload();
  };
  const copyLink = () => { navigator.clipboard.writeText(`${window.location.origin}/?open=${nodeId}`); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  const matches = query.trim() ? [
    ...users.filter(u => u.id !== ownerId && !peoplePerms.some(p => p.granteeType === 'user' && p.granteeId === u.id) && (u.name.toLowerCase().includes(query.toLowerCase()) || (u.email || '').toLowerCase().includes(query.toLowerCase()))).map(u => ({ kind: 'user', id: u.id, title: u.name, sub: u.email })),
    ...groups.filter(g => !peoplePerms.some(p => p.granteeType === 'group' && p.granteeId === g.id) && g.name.toLowerCase().includes(query.toLowerCase())).map(g => ({ kind: 'group', id: g.id, title: g.name, sub: 'Org unit' })),
  ].slice(0, 6) : [];

  const RoleSelect = ({ value, onChange }: { value: string, onChange: (v: string) => void }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ border: 'none', background: 'transparent', color: 'var(--m3-text-primary)', fontSize: '14px', cursor: 'pointer', padding: '4px', borderRadius: '6px' }}>
      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      <option disabled>──────</option>
      <option value="__remove">Remove access</option>
    </select>
  );

  const owner = ownerId === currentUser?.id ? { name: `${currentUser?.name} (you)`, email: currentUser?.email, id: ownerId } : (userBy(ownerId) || { name: ownerId, email: '', id: ownerId });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px', padding: '24px 24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <h2 style={{ fontWeight: 400, fontSize: '22px' }}>Share{node ? ` “${node.name}”` : ''}</h2>
          <button className="m3-small-btn" style={{ border: 'none', padding: '6px' }} onClick={onClose}><X size={18} /></button>
        </div>
        {error && <p style={{ color: 'red', fontSize: '14px', marginBottom: '10px' }}>{error}</p>}

        {/* Add people */}
        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <input autoFocus placeholder="Add people and org units" value={query} onChange={e => setQuery(e.target.value)}
            style={{ width: '100%', padding: '14px', border: '2px solid var(--m3-primary)', borderRadius: '6px', outline: 'none', background: 'var(--m3-surface)', color: 'var(--m3-text-primary)', fontSize: '15px' }} />
          {matches.length > 0 && (
            <div style={{ position: 'absolute', left: 0, right: 0, top: '52px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '8px', boxShadow: '0 6px 18px rgba(0,0,0,0.16)', zIndex: 10, overflow: 'hidden' }}>
              {matches.map(m => (
                <div key={m.kind + m.id} className="m3-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '12px' }} onClick={() => add(m.kind, m.id)}>
                  {m.kind === 'user' ? <UserAvatar id={m.id} name={m.title} size={32} /> : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--m3-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FolderInput size={16} /></div>}
                  <div><div style={{ fontWeight: 500 }}>{m.title}</div><div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{m.sub}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* People with access */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 500 }}>People with access</h3>
          <button className="m3-small-btn" style={{ border: 'none', padding: '6px' }} onClick={copyLink} title="Copy link"><Link2 size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '240px', overflowY: 'auto', marginBottom: '20px' }}>
          {/* Owner */}
          {node && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0' }}>
              <UserAvatar id={owner.id} name={owner.name} size={36} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{owner.name}</div><div style={{ fontSize: '13px', color: 'var(--m3-text-secondary)' }}>{owner.email}</div></div>
              <span style={{ color: 'var(--m3-text-secondary)', fontSize: '14px', paddingRight: '8px' }}>Owner</span>
            </div>
          )}
          {peoplePerms.map(p => {
            const isGroup = p.granteeType === 'group';
            const ent = isGroup ? groupBy(p.granteeId) : userBy(p.granteeId);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0' }}>
                {isGroup ? <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--m3-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FolderInput size={18} /></div> : <UserAvatar id={p.granteeId} name={ent?.name || p.granteeId} size={36} />}
                <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{ent?.name || p.granteeId}</div><div style={{ fontSize: '13px', color: 'var(--m3-text-secondary)' }}>{isGroup ? 'Org unit' : (ent?.email || '')}</div></div>
                <RoleSelect value={p.role} onChange={r => setRole(p, r)} />
              </div>
            );
          })}
        </div>

        {/* General access */}
        <h3 style={{ fontSize: '16px', fontWeight: 500, marginBottom: '10px' }}>General access</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--m3-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {generalMode === 'restricted' ? <Lock size={18} /> : <Globe size={18} color="#1e8e3e" />}
          </div>
          <div style={{ flex: 1 }}>
            <select value={generalMode} onChange={e => setGeneral(e.target.value as any)} style={{ border: 'none', background: 'transparent', fontWeight: 500, fontSize: '14px', color: 'var(--m3-text-primary)', cursor: 'pointer' }}>
              <option value="restricted">Restricted</option>
              <option value="workspace">Anyone in {wsName} with the link</option>
              <option value="public">Anyone with the link</option>
            </select>
            <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', paddingLeft: '4px' }}>
              {generalMode === 'restricted' ? 'Only people with access can open with the link'
                : generalMode === 'workspace' ? `Anyone in ${wsName} who has the link can ${generalRole === 'viewer' ? 'view' : 'edit'}`
                  : `Anyone on the internet with the link can ${generalRole === 'viewer' ? 'view' : 'edit'}`}
            </div>
          </div>
          {generalMode !== 'restricted' && (
            <select value={generalRole} onChange={e => setGeneral(generalMode, e.target.value)} style={{ border: 'none', background: 'transparent', fontSize: '14px', color: 'var(--m3-text-primary)', cursor: 'pointer' }}>
              <option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="editor">Editor</option>
            </select>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)', border: '1px solid var(--m3-primary)', display: 'flex', alignItems: 'center', gap: '8px' }} onClick={copyLink}>
            <Link2 size={16} /> {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button className="m3-action-button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
