import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { apiGet, apiSend } from '../api';

// Shared "add to-do" pop-over used wherever the @ menu lives (Pages + Chat). Creates a real
// Task (optionally assigned to someone, with a due date) and hands back its id to embed a chip.
export function TodoModal({ currentUserId, sourceNodeId, onClose, onCreated }: {
  currentUserId: string, sourceNodeId?: string, onClose: () => void, onCreated: (taskId: string, title: string) => void,
}) {
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [due, setDue] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiGet('/api/directory').then(d => setUsers(d.users)).catch(() => {}); }, []);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const res = await apiSend('/api/tasks/assign', 'POST', { assigneeId, title: title.trim(), dueAt: due ? new Date(due).getTime() : null, sourceNodeId });
    const { id } = await res.json();
    setBusy(false);
    onCreated(id, title.trim());
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <h2 style={{ fontWeight: 500, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Bell size={18} color="#e8710a" /> Add to-do</h2>
        <input className="modal-input" autoFocus placeholder="What needs doing?" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} />
        <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginTop: '12px' }}>Assign to</label>
        <select className="modal-input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
          <option value={currentUserId}>Me</option>
          {users.filter(u => u.id !== currentUserId).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginTop: '12px' }}>Due (optional)</label>
        <input className="modal-input" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
          <button className="m3-action-button" style={{ background: 'transparent', color: 'var(--m3-primary)' }} onClick={onClose}>Cancel</button>
          <button className="m3-action-button" disabled={busy || !title.trim()} onClick={create}>{busy ? 'Adding…' : 'Add to-do'}</button>
        </div>
      </div>
    </div>
  );
}
