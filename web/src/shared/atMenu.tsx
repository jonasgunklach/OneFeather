import { FileText, File as FileIcon, CheckSquare, Bell } from 'lucide-react';
import { apiGet } from '../api';
import { UserAvatar } from '../UserAvatar';

// One @-menu shared by every tool (Pages editor + Chat). It fetches the same data and
// returns the same grouped items; each tool supplies how to *insert* the chosen thing.
export type AtItem = { group: string, key: string, title: string, subtitle?: string, icon: React.ReactNode, run: () => void };

export type AtCallbacks = {
  onPerson: (u: { id: string, name: string, email?: string }) => void;
  onPage: (n: { id: string, name: string }) => void;
  onFile: (n: { id: string, name: string }) => void;
  onTask: (t: { id: string, title: string }) => void;
  onCreateTask: (title: string) => void;   // create a task on the fly and embed it
  onAddTodo: () => void;                    // open the to-do pop-over (specify details inline)
  excludeNodeId?: string;                   // e.g. the current page
};

export async function buildAtItems(query: string, cb: AtCallbacks): Promise<AtItem[]> {
  const q = query.toLowerCase();
  const [dir, home, mine, tasks] = await Promise.all([
    apiGet('/api/directory').catch(() => ({ users: [] })),
    apiGet('/api/nodes?view=home').catch(() => []),
    apiGet('/api/nodes?view=my-drive').catch(() => []),
    apiGet('/api/tasks').catch(() => []),
  ]);
  const items: AtItem[] = [];

  // People
  (dir.users || []).filter((u: any) => u.name.toLowerCase().includes(q)).slice(0, 5).forEach((u: any) =>
    items.push({ group: 'People', key: 'u' + u.id, title: u.name, subtitle: u.email, icon: <UserAvatar id={u.id} name={u.name} size={24} />, run: () => cb.onPerson(u) }));

  // Pages + Files (already access-filtered by the views)
  const nodes = [...home, ...mine].filter((n: any, i: number, a: any[]) => a.findIndex(x => x.id === n.id) === i && n.id !== cb.excludeNodeId);
  nodes.filter((n: any) => n.type === 'document' && n.name.toLowerCase().includes(q)).slice(0, 4).forEach((n: any) =>
    items.push({ group: 'Pages', key: 'p' + n.id, title: n.name, subtitle: 'Page', icon: <FileText size={18} color="#0b57d0" />, run: () => cb.onPage(n) }));
  nodes.filter((n: any) => n.type === 'file' && n.name.toLowerCase().includes(q)).slice(0, 4).forEach((n: any) =>
    items.push({ group: 'Files', key: 'f' + n.id, title: n.name, subtitle: 'File', icon: <FileIcon size={18} color="#5f6368" />, run: () => cb.onFile(n) }));

  // To-dos
  (tasks || []).filter((t: any) => t.title.toLowerCase().includes(q)).slice(0, 3).forEach((t: any) =>
    items.push({ group: 'To-dos', key: 't' + t.id, title: t.title, subtitle: t.status === 'done' ? 'Done' : 'Open', icon: <CheckSquare size={18} color="#1a73e8" />, run: () => cb.onTask(t) }));

  // Actions
  items.push({ group: 'Actions', key: 'add-todo', title: 'Add to-do…', subtitle: 'Specify assignee & due date', icon: <Bell size={18} color="#e8710a" />, run: cb.onAddTodo });
  if (query.trim()) items.push({ group: 'Actions', key: 'create-task', title: `Create to-do “${query.trim()}”`, icon: <CheckSquare size={18} color="#1a73e8" />, run: () => cb.onCreateTask(query.trim()) });

  return items;
}
