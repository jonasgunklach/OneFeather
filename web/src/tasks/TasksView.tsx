import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Inbox, CalendarDays, Sun, Send, Hash, Tag, List, Columns, Calendar as CalIcon, X, Trash2, Repeat, MessageSquare } from 'lucide-react';
import { api, apiGet, apiSend } from '../api';
import { UserAvatar } from '../UserAvatar';
import { parseQuickAdd } from './parseQuickAdd';

type Task = any; type Project = any; type Label = any;
type Nav = { kind: 'today' | 'upcoming' | 'inbox' | 'delegated' | 'project' | 'label', id?: string, name?: string };
type Mode = 'list' | 'board' | 'calendar';

const PRIORITY = { 1: { c: '#d93025', l: 'P1' }, 2: { c: '#e8710a', l: 'P2' }, 3: { c: '#1a73e8', l: 'P3' }, 4: { c: '#9aa0a6', l: 'P4' } } as const;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtDue(iso?: string, hasTime?: boolean) {
  if (!iso) return null;
  const d = new Date(iso); const today = startOfDay(new Date()); const day = startOfDay(d);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  let label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (diff === 0) label = 'Today'; else if (diff === 1) label = 'Tomorrow'; else if (diff === -1) label = 'Yesterday';
  else if (diff > 1 && diff < 7) label = d.toLocaleDateString(undefined, { weekday: 'short' });
  if (hasTime) label += ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const overdue = d.getTime() < Date.now() && diff <= 0;
  return { label, overdue, today: diff === 0 };
}

export function TasksView({ currentUser, initialTaskId, onClose, onChanged }: { currentUser: any, initialTaskId?: string | null, onClose: () => void, onChanged: () => void }) {
  const [nav, setNav] = useState<Nav>({ kind: 'today' });
  const [mode, setMode] = useState<Mode>('list');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [quick, setQuick] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const [readOnly, setReadOnly] = useState<any | null>(null);

  // Opened via a task-link chip in a page: focus that task (or show a read-only summary if it's someone else's).
  useEffect(() => {
    if (!initialTaskId) return;
    apiGet(`/api/tasks/${initialTaskId}/summary`).then((sum: any) => {
      if (sum.ownerId === currentUser.id) {
        apiGet('/api/tasks').then((all: Task[]) => { const t = all.find(x => x.id === initialTaskId); if (t) { setNav({ kind: 'inbox' }); setSelected(t); } else setReadOnly(sum); });
      } else setReadOnly(sum);
    }).catch(() => {});
  }, [initialTaskId]);

  const loadMeta = () => {
    apiGet('/api/task-projects').then(setProjects).catch(() => {});
    apiGet('/api/task-labels').then(setLabels).catch(() => {});
  };
  const loadTasks = () => {
    let url = '/api/tasks?';
    if (nav.kind === 'project') url += `projectId=${nav.id}`;
    else if (nav.kind === 'label') url += `label=${nav.id}`;
    else url += `view=${nav.kind}`;
    apiGet(url).then(setTasks).catch(() => {});
  };
  useEffect(loadMeta, []);
  useEffect(() => { loadTasks(); setMode(m => (nav.kind === 'today' || nav.kind === 'upcoming' || nav.kind === 'delegated') && m !== 'list' ? m : m); }, [nav]);

  const refresh = () => { loadTasks(); onChanged(); };

  // Resolve project/label names from quick-add into ids (create if missing).
  const resolveProject = async (name?: string) => {
    if (!name) return nav.kind === 'project' ? nav.id : undefined;
    const hit = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const res = await apiSend('/api/task-projects', 'POST', { name }); const { id } = await res.json(); loadMeta(); return id;
  };
  const resolveLabels = async (names: string[]) => {
    const ids: string[] = [];
    for (const n of names) {
      const hit = labels.find(l => l.name.toLowerCase() === n.toLowerCase());
      if (hit) ids.push(hit.id);
      else { const res = await apiSend('/api/task-labels', 'POST', { name: n }); const { id } = await res.json(); ids.push(id); }
    }
    if (names.length) loadMeta();
    return ids;
  };

  const addQuick = async (presetDue?: number) => {
    if (!quick.trim()) return;
    const p = parseQuickAdd(quick);
    const projectId = await resolveProject(p.projectName);
    const labelIds = await resolveLabels(p.labelNames);
    await apiSend('/api/tasks', 'POST', {
      title: p.title, priority: p.priority, dueAt: p.dueAt ?? presetDue, dueHasTime: p.dueHasTime,
      recurrence: p.recurrence, projectId, labelIds,
    });
    setQuick(''); refresh();
  };

  const toggle = async (t: Task) => { await apiSend(`/api/tasks/${t.id}/${t.status === 'done' ? 'reopen' : 'complete'}`, 'POST'); refresh(); };

  const title = nav.kind === 'project' ? projects.find(p => p.id === nav.id)?.name
    : nav.kind === 'label' ? `@${labels.find(l => l.id === nav.id)?.name || ''}`
      : ({ today: 'Today', upcoming: 'Upcoming', inbox: 'Inbox', delegated: 'Delegated to me' } as any)[nav.kind];

  const navItem = (n: Nav, icon: any, label: string, count?: number) => (
    <div className={`m3-nav-item ${nav.kind === n.kind && nav.id === n.id ? 'active' : ''}`} onClick={() => { setNav(n); setSelected(null); }} style={{ fontSize: '14px', justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>{icon} {label}</span>
      {count ? <span style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{count}</span> : null}
    </div>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--m3-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', borderBottom: '1px solid var(--m3-border)', background: 'var(--m3-surface)' }}>
        <button onClick={onClose} className="m3-small-btn" style={{ border: 'none' }}><ArrowLeft size={18} /> Back</button>
        <h1 style={{ fontSize: '20px', fontWeight: 500 }}>Tasks</h1>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left nav */}
        <div style={{ width: '240px', borderRight: '1px solid var(--m3-border)', padding: '12px 8px', overflowY: 'auto', flexShrink: 0 }}>
          {navItem({ kind: 'today' }, <Sun size={18} />, 'Today')}
          {navItem({ kind: 'upcoming' }, <CalendarDays size={18} />, 'Upcoming')}
          {navItem({ kind: 'inbox' }, <Inbox size={18} />, 'Inbox')}
          {navItem({ kind: 'delegated' }, <Send size={18} />, 'Delegated to me')}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 12px 4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--m3-text-secondary)', textTransform: 'uppercase' }}>Projects</span>
            <button className="m3-small-btn" style={{ padding: '2px 8px' }} onClick={async () => { await apiSend('/api/task-projects', 'POST', { name: 'New Project' }); loadMeta(); }}><Plus size={13} /></button>
          </div>
          {projects.map(p => (
            <div key={p.id} className={`m3-nav-item ${nav.kind === 'project' && nav.id === p.id ? 'active' : ''}`} onClick={() => { setNav({ kind: 'project', id: p.id }); setSelected(null); }} style={{ fontSize: '14px' }}>
              <Hash size={16} color={p.color} /> {p.name}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 12px 4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--m3-text-secondary)', textTransform: 'uppercase' }}>Labels</span>
            <button className="m3-small-btn" style={{ padding: '2px 8px' }} onClick={async () => { await apiSend('/api/task-labels', 'POST', { name: 'label' }); loadMeta(); }}><Plus size={13} /></button>
          </div>
          {labels.map(l => (
            <div key={l.id} className={`m3-nav-item ${nav.kind === 'label' && nav.id === l.id ? 'active' : ''}`} onClick={() => { setNav({ kind: 'label', id: l.id }); setSelected(null); }} style={{ fontSize: '14px' }}>
              <Tag size={16} color={l.color} /> {l.name}
            </div>
          ))}
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: 500 }}>{title}</h2>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className={`m3-small-btn ${mode === 'list' ? 'primary' : ''}`} onClick={() => setMode('list')}><List size={14} /> List</button>
                <button className={`m3-small-btn ${mode === 'board' ? 'primary' : ''}`} onClick={() => setMode('board')}><Columns size={14} /> Board</button>
                <button className={`m3-small-btn ${mode === 'calendar' ? 'primary' : ''}`} onClick={() => setMode('calendar')}><CalIcon size={14} /> Calendar</button>
              </div>
            </div>

            {/* Quick add */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input className="modal-input" style={{ margin: 0, flex: 1 }} placeholder='Add a task — try "Review specs tomorrow 5pm p1 #Eng @urgent"'
                value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addQuick(); }} />
              <button className="m3-action-button" onClick={() => addQuick()}><Plus size={15} style={{ verticalAlign: '-2px' }} /> Add</button>
            </div>

            {mode === 'list' && <ListView tasks={tasks} projects={projects} onToggle={toggle} onSelect={setSelected} />}
            {mode === 'board' && <BoardView nav={nav} tasks={tasks} projects={projects} onToggle={toggle} onSelect={setSelected} onChanged={refresh} />}
            {mode === 'calendar' && <CalendarView tasks={tasks} onSelect={setSelected} onAddOnDay={(ms: number) => { setQuick(q => q || 'New task'); addQuick(ms); }} />}
          </div>

          {selected && <TaskDetail task={selected} projects={projects} labels={labels} currentUser={currentUser} onClose={() => setSelected(null)} onChanged={refresh} />}
        </div>
      </div>

      {readOnly && (
        <div className="modal-overlay" onClick={() => setReadOnly(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ fontWeight: 500, marginBottom: '8px' }}>{readOnly.title}</h2>
            <p style={{ fontSize: '14px', color: 'var(--m3-text-secondary)', marginBottom: '16px' }}>
              This task belongs to <b>{readOnly.ownerName}</b>. Status: <b>{readOnly.status === 'done' ? 'Completed' : 'Open'}</b>
              {readOnly.dueAt ? ` · due ${new Date(readOnly.dueAt).toLocaleDateString()}` : ''}.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="m3-action-button" onClick={() => setReadOnly(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- List ----------
function ListView({ tasks, projects, onToggle, onSelect }: any) {
  if (tasks.length === 0) return <div style={{ color: 'var(--m3-text-secondary)', padding: '40px 0' }}>Nothing here. Add a task above.</div>;
  return (
    <div>{tasks.map((t: Task) => <TaskRow key={t.id} t={t} projects={projects} onToggle={onToggle} onSelect={onSelect} />)}</div>
  );
}

function TaskRow({ t, projects, onToggle, onSelect }: any) {
  const due = fmtDue(t.dueAt, t.dueHasTime);
  const proj = projects.find((p: any) => p.id === t.projectId);
  return (
    <div className="m3-table-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 8px' }} onClick={() => onSelect(t)}>
      <button onClick={e => { e.stopPropagation(); onToggle(t); }} title="Complete" style={{ width: '20px', height: '20px', borderRadius: '50%', border: `2px solid ${PRIORITY[t.priority as 1].c}`, background: t.status === 'done' ? PRIORITY[t.priority as 1].c : 'transparent', cursor: 'pointer', flexShrink: 0, color: 'white', fontSize: '12px', lineHeight: '16px' }}>{t.status === 'done' ? '✓' : ''}</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--m3-text-secondary)' : 'inherit' }}>{t.title}</div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '3px', flexWrap: 'wrap' }}>
          {due && <span style={{ fontSize: '12px', color: due.overdue ? '#d93025' : due.today ? '#137333' : 'var(--m3-text-secondary)' }}>{due.label}</span>}
          {t.recurrence && <Repeat size={12} color="var(--m3-text-secondary)" />}
          {t.subtaskCount > 0 && <span style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>☑ {t.subtaskDone}/{t.subtaskCount}</span>}
          {(t.labels || []).map((l: any) => <span key={l.id} style={{ fontSize: '11px', color: l.color }}>@{l.name}</span>)}
          {proj && <span style={{ fontSize: '11px', color: 'var(--m3-text-secondary)' }}># {proj.name}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------- Board ----------
function BoardView({ nav, tasks, projects, onToggle, onSelect, onChanged }: any) {
  // In a project: columns = sections (+ No section). Otherwise: columns by priority.
  const project = nav.kind === 'project' ? projects.find((p: any) => p.id === nav.id) : null;
  const columns = project
    ? [{ id: null, name: 'No section' }, ...(project.sections || []).map((s: any) => ({ id: s.id, name: s.name }))]
    : [1, 2, 3, 4].map(p => ({ id: p, name: PRIORITY[p as 1].l }));
  const colOf = (t: Task) => project ? (t.sectionId || null) : t.priority;
  const drop = async (t: Task, colId: any) => { await apiSend(`/api/tasks/${t.id}`, 'PATCH', project ? { sectionId: colId } : { priority: colId }); onChanged(); };

  return (
    <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', alignItems: 'flex-start' }}>
      {columns.map(col => (
        <div key={String(col.id)} onDragOver={e => e.preventDefault()} onDrop={e => { const id = e.dataTransfer.getData('task'); const t = tasks.find((x: Task) => x.id === id); if (t) drop(t, col.id); }}
          style={{ width: '260px', flexShrink: 0, background: 'var(--m3-surface-2)', borderRadius: '12px', padding: '12px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>{col.name}</div>
          {tasks.filter((t: Task) => colOf(t) === col.id).map((t: Task) => (
            <div key={t.id} draggable onDragStart={e => e.dataTransfer.setData('task', t.id)} onClick={() => onSelect(t)}
              style={{ background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '8px', padding: '10px', marginBottom: '8px', cursor: 'grab' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <button onClick={e => { e.stopPropagation(); onToggle(t); }} style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${PRIORITY[t.priority as 1].c}`, background: t.status === 'done' ? PRIORITY[t.priority as 1].c : 'transparent', cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ fontSize: '14px', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
              </div>
            </div>
          ))}
          {project && <button className="m3-small-btn" style={{ width: '100%', marginTop: '4px' }} onClick={async () => { await apiSend('/api/task-sections', 'POST', { projectId: project.id, name: 'New section' }); onChanged(); }} hidden={col.id !== null}>+ Section</button>}
        </div>
      ))}
    </div>
  );
}

// ---------- Calendar ----------
function CalendarView({ tasks, onSelect, onAddOnDay }: any) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const first = new Date(month); const startPad = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  const tasksOn = (day: Date) => tasks.filter((t: Task) => t.dueAt && startOfDay(new Date(t.dueAt)).getTime() === startOfDay(day).getTime());

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <button className="m3-small-btn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>‹</button>
        <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button className="m3-small-btn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', textAlign: 'center', fontWeight: 600 }}>{d}</div>)}
        {cells.map((day, i) => (
          <div key={i} onClick={() => day && onAddOnDay(day.getTime())} style={{ minHeight: '92px', border: '1px solid var(--m3-border)', borderRadius: '8px', padding: '4px', background: day && startOfDay(day).getTime() === startOfDay(new Date()).getTime() ? 'var(--m3-unread)' : 'var(--m3-surface)', cursor: day ? 'pointer' : 'default' }}>
            {day && <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>{day.getDate()}</div>}
            {day && tasksOn(day).map((t: Task) => (
              <div key={t.id} onClick={e => { e.stopPropagation(); onSelect(t); }} style={{ fontSize: '11px', background: 'var(--m3-surface-2)', borderLeft: `3px solid ${PRIORITY[t.priority as 1].c}`, borderRadius: '4px', padding: '2px 4px', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Detail panel ----------
function TaskDetail({ task, projects, labels, currentUser, onClose, onChanged }: any) {
  const [t, setT] = useState<Task>(task);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [newSub, setNewSub] = useState(''); const [newComment, setNewComment] = useState('');
  useEffect(() => { setT(task); loadSub(); loadComments(); }, [task.id]);
  const loadSub = () => apiGet(`/api/tasks/${task.id}/subtasks`).then(setSubtasks).catch(() => {});
  const loadComments = () => apiGet(`/api/tasks/${task.id}/comments`).then(setComments).catch(() => {});

  const save = async (patch: any) => { setT({ ...t, ...patch }); await apiSend(`/api/tasks/${t.id}`, 'PATCH', patch); onChanged(); };
  const labelIds = (t.labels || []).map((l: any) => l.id);

  return (
    <div style={{ width: '380px', flexShrink: 0, borderLeft: '1px solid var(--m3-border)', background: 'var(--m3-surface)', overflowY: 'auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <strong>Task</strong>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="m3-small-btn danger" onClick={async () => { await api(`/api/tasks/${t.id}`, { method: 'DELETE' }); onChanged(); onClose(); }}><Trash2 size={14} /></button>
          <button className="m3-small-btn" style={{ border: 'none' }} onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <input className="modal-input" value={t.title} onChange={e => setT({ ...t, title: e.target.value })} onBlur={e => save({ title: e.target.value })} style={{ fontSize: '16px', fontWeight: 500 }} />
      <textarea className="modal-input" placeholder="Description" value={t.description || ''} onChange={e => setT({ ...t, description: e.target.value })} onBlur={e => save({ description: e.target.value })} rows={3} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
        <label style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>Priority
          <select className="m3-select" style={{ width: '100%', marginTop: '4px' }} value={t.priority} onChange={e => save({ priority: Number(e.target.value) })}>
            {[1, 2, 3, 4].map(p => <option key={p} value={p}>{PRIORITY[p as 1].l}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>Due
          <input type="date" className="m3-select" style={{ width: '100%', marginTop: '4px' }} value={t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : ''} onChange={e => save({ dueAt: e.target.value ? new Date(e.target.value).getTime() : null })} />
        </label>
        <label style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>Project
          <select className="m3-select" style={{ width: '100%', marginTop: '4px' }} value={t.projectId || ''} onChange={e => save({ projectId: e.target.value || null })}>
            <option value="">Inbox</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '12px', color: 'var(--m3-text-secondary)' }}>Repeat
          <select className="m3-select" style={{ width: '100%', marginTop: '4px' }} value={t.recurrence || ''} onChange={e => save({ recurrence: e.target.value || null })}>
            <option value="">None</option><option value="daily">Daily</option><option value="weekday">Every weekday</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: '14px' }}>
        <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', marginBottom: '4px' }}>Labels</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {labels.map((l: any) => {
            const on = labelIds.includes(l.id);
            return <button key={l.id} className="m3-small-btn" style={{ borderColor: on ? l.color : undefined, color: on ? l.color : undefined }}
              onClick={() => save({ labelIds: on ? labelIds.filter((x: string) => x !== l.id) : [...labelIds, l.id] })}>@{l.name}</button>;
          })}
        </div>
      </div>

      {t.createdBy && t.createdBy !== currentUser.id && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', fontSize: '13px', color: 'var(--m3-text-secondary)' }}>
          <UserAvatar id={t.createdBy} name={t.createdBy} size={22} /> Assigned to you from a page
        </div>
      )}

      {/* Subtasks */}
      <div style={{ marginTop: '18px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Sub-tasks</div>
        {subtasks.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' }}>
            <button onClick={async () => { await apiSend(`/api/tasks/${s.id}/${s.status === 'done' ? 'reopen' : 'complete'}`, 'POST'); loadSub(); onChanged(); }} style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--m3-text-secondary)', background: s.status === 'done' ? 'var(--m3-text-secondary)' : 'transparent', cursor: 'pointer', flexShrink: 0 }} />
            <span style={{ fontSize: '14px', textDecoration: s.status === 'done' ? 'line-through' : 'none' }}>{s.title}</span>
          </div>
        ))}
        <input className="modal-input" placeholder="+ Add sub-task" value={newSub} onChange={e => setNewSub(e.target.value)}
          onKeyDown={async e => { if (e.key === 'Enter' && newSub.trim()) { await apiSend('/api/tasks', 'POST', { title: newSub.trim(), parentTaskId: t.id }); setNewSub(''); loadSub(); onChanged(); } }} />
      </div>

      {/* Comments */}
      <div style={{ marginTop: '18px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}><MessageSquare size={14} /> Comments</div>
        {comments.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: '8px', padding: '6px 0' }}>
            <UserAvatar id={c.authorId} name={c.authorName} size={26} />
            <div><div style={{ fontSize: '13px' }}><b>{c.authorName}</b> <span style={{ color: 'var(--m3-text-secondary)', fontSize: '11px' }}>{new Date(c.createdAt).toLocaleString()}</span></div><div style={{ fontSize: '14px' }}>{c.text}</div></div>
          </div>
        ))}
        <input className="modal-input" placeholder="Write a comment…" value={newComment} onChange={e => setNewComment(e.target.value)}
          onKeyDown={async e => { if (e.key === 'Enter' && newComment.trim()) { await apiSend(`/api/tasks/${t.id}/comments`, 'POST', { text: newComment.trim() }); setNewComment(''); loadComments(); } }} />
      </div>
    </div>
  );
}
