import { useEffect, useMemo, useRef, useState } from 'react';
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import {
  useCreateBlockNote,
  SuggestionMenuController,
  ThreadsSidebar,
  BlockNoteViewEditor,
  FloatingComposerController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { filterSuggestionItems } from "@blocknote/core";
import { CommentsExtension, YjsThreadStore, DefaultThreadStoreAuth } from "@blocknote/core/comments";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { MessageSquare } from "lucide-react";
import { schema, colorForId } from "./collab/inlineSpecs";
import { apiGet, apiSend } from "./api";
import { useTheme } from "./theme";
import { DocToolbar } from "./pages/DocToolbar";
import { TEMPLATES } from "./pages/templates";
import { buildAtItems } from "./shared/atMenu";
import { TodoModal } from "./shared/TodoModal";

type CurrentUser = { id: string, name: string };
type Peer = { clientId: number, name: string, color: string, focused: boolean, self: boolean };

export function BlockNoteDoc({ docId, currentUser }: { docId: string, currentUser: CurrentUser }) {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);

  useEffect(() => {
    const p = new HocuspocusProvider({
      url: "ws://localhost:3001/collaboration",
      name: docId,
      token: localStorage.getItem("of_token") || undefined,
    });
    setProvider(p);
    return () => p.destroy();
  }, [docId]);

  if (!provider) return <div style={{ padding: '40px' }}>Connecting to Sync Server…</div>;

  return <BlockNoteInner key={docId} provider={provider} docId={docId} currentUser={currentUser} />;
}

function BlockNoteInner({ provider, docId, currentUser }: { provider: HocuspocusProvider, docId: string, currentUser: CurrentUser }) {
  const [showComments, setShowComments] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [docName, setDocName] = useState('document');
  useEffect(() => { apiGet(`/api/nodes/${docId}`).then(n => setDocName(n.name || 'document')).catch(() => {}); }, [docId]);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const linkedRef = useRef<Map<string, boolean>>(new Map()); // checklist blockId -> last-known checked
  const theme = useTheme();

  const resolveUsers = useMemo(() => async (userIds: string[]) => {
    const dir = await apiGet('/api/directory');
    return userIds.map((id: string) => {
      const u = dir.users.find((x: any) => x.id === id);
      return { id, username: u?.name || id, avatarUrl: '' };
    });
  }, []);

  // Comment threads live in the same Y.Doc -> they sync + persist via Hocuspocus for free.
  const threadStore = useMemo(
    () => new YjsThreadStore(currentUser.id, provider.document.getMap("threads"), new DefaultThreadStoreAuth(currentUser.id, "editor")),
    [provider, currentUser.id]
  );

  const editor = useCreateBlockNote({
    schema,
    collaboration: {
      provider: provider as any,
      fragment: provider.document.getXmlFragment("document-store"),
      user: { name: currentUser.name, color: colorForId(currentUser.id) },
      showCursorLabels: "always",
    },
    extensions: [CommentsExtension({ threadStore, resolveUsers })],
  } as any);

  // Notify people @mentioned in a comment (and grant them page access). Only the comment's
  // author fires this; pre-existing comments on load are ignored.
  useEffect(() => {
    let dir: any[] = [];
    apiGet('/api/directory').then(d => { dir = d.users; }).catch(() => {});
    const seen = new Set<string>();
    let firstRun = true;
    const extractMentions = (body: any): string[] => {
      const ids = new Set<string>();
      let text = '';
      const walk = (blocks: any[]) => {
        for (const b of (blocks || [])) {
          for (const c of (b.content || [])) {
            if (c.type === 'text' && c.text) text += ' ' + c.text;
            if ((c.type === 'mention' || c.type === 'tag') && c.props?.userId) ids.add(c.props.userId);
          }
          if (b.children?.length) walk(b.children);
        }
      };
      walk(Array.isArray(body) ? body : []);
      const lower = text.toLowerCase();
      for (const u of dir) {
        const first = (u.name || '').split(' ')[0].toLowerCase();
        if (first && (lower.includes('@' + first) || lower.includes('@' + (u.name || '').toLowerCase()))) ids.add(u.id);
      }
      return Array.from(ids);
    };
    const unsub = threadStore.subscribe((threads: Map<string, any>) => {
      threads.forEach((thread: any) => {
        for (const c of (thread.comments || [])) {
          if (!c || seen.has(c.id)) continue;
          seen.add(c.id);
          if (firstRun || c.userId !== currentUser.id || !c.body) continue;
          for (const id of extractMentions(c.body)) {
            if (id === currentUser.id) continue;
            apiSend('/api/notifications', 'POST', { userId: id, type: 'comment', nodeId: docId, message: `${currentUser.name} mentioned you in a comment` });
            apiSend(`/api/nodes/${docId}/grant-collaborator`, 'POST', { userId: id });
          }
        }
      });
      firstRun = false;
    });
    return unsub;
  }, [threadStore, docId, currentUser.id, currentUser.name]);

  // Track whether THIS tab is focused/visible and broadcast it via awareness, so other
  // collaborators can show an "active in this tab" ring (Google-Docs style).
  useEffect(() => {
    const aw: any = provider.awareness;
    if (!aw) return;
    const broadcast = () => aw.setLocalStateField('focused', document.visibilityState === 'visible' && document.hasFocus());
    broadcast();
    window.addEventListener('focus', broadcast);
    window.addEventListener('blur', broadcast);
    document.addEventListener('visibilitychange', broadcast);
    return () => {
      window.removeEventListener('focus', broadcast);
      window.removeEventListener('blur', broadcast);
      document.removeEventListener('visibilitychange', broadcast);
    };
  }, [provider]);

  // Live presence: read awareness states (collaboration sets `user`; we add `focused`).
  useEffect(() => {
    const aw: any = provider.awareness;
    if (!aw) return;
    const update = () => {
      // Dedupe by name; a user is "focused" if ANY of their tabs is focused.
      const byName = new Map<string, Peer>();
      aw.getStates().forEach((s: any, clientId: number) => {
        if (!s?.user?.name) return;
        const existing = byName.get(s.user.name);
        const focused = !!s.focused;
        byName.set(s.user.name, {
          clientId: existing?.clientId ?? clientId,
          name: s.user.name,
          color: s.user.color || '#888',
          focused: (existing?.focused || focused),
          self: existing?.self || clientId === aw.clientID,
        });
      });
      setPeers(Array.from(byName.values()));
    };
    aw.on('change', update);
    update();
    return () => aw.off('change', update);
  }, [provider]);

  // Page -> task sync: when a checklist item linked to a task is (un)checked, update the task.
  useEffect(() => {
    let cancelled = false;
    apiGet(`/api/tasks/by-source?sourceNodeId=${docId}`).then((rows: any[]) => {
      if (cancelled) return;
      rows.forEach(r => { if (r.sourceBlockId) linkedRef.current.set(r.sourceBlockId, r.status === 'done'); });
    }).catch(() => {});
    const collect = (blocks: any[], out: any[] = []): any[] => { for (const b of blocks) { out.push(b); if (b.children?.length) collect(b.children, out); } return out; };
    let timer: any;
    const handle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const b of collect(editor.document as any[])) {
          if (b.type !== 'checkListItem' || !linkedRef.current.has(b.id)) continue;
          const checked = !!b.props?.checked;
          if (linkedRef.current.get(b.id) !== checked) {
            linkedRef.current.set(b.id, checked);
            apiSend('/api/tasks/sync-checklist', 'POST', { sourceBlockId: b.id, checked });
          }
        }
      }, 400);
    };
    const unsub = (editor as any).onChange?.(handle);
    return () => { cancelled = true; clearTimeout(timer); if (typeof unsub === 'function') unsub(); };
  }, [editor, docId]);

  // Click an avatar -> scroll the editor to that collaborator's live cursor.
  const jumpToPeer = (peer: Peer) => {
    const root = editorWrapRef.current;
    if (!root || peer.self) return;
    const carets = Array.from(root.querySelectorAll<HTMLElement>(
      '[class*="collaboration-cursor"], [class*="yjs-cursor"]'
    ));
    // Match by the cursor's label text (the collaborator's name), else by color.
    const target =
      carets.find((el) => (el.textContent || '').trim().includes(peer.name)) ||
      carets.find((el) => {
        const s = el.getAttribute('style') || '';
        return s.toLowerCase().includes(peer.color.toLowerCase());
      });
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Mention a person: insert chip, grant them access, and notify (or auto-assign if in a checklist).
  const mentionPerson = (u: any) => {
    editor.insertInlineContent([{ type: "mention", props: { userId: u.id, name: u.name } } as any, " "]);
    apiSend(`/api/nodes/${docId}/grant-collaborator`, 'POST', { userId: u.id });
    const block: any = editor.getTextCursorPosition().block;
    if (block?.type === 'checkListItem') {
      const text = (block.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim();
      linkedRef.current.set(block.id, !!block.props?.checked);
      apiSend('/api/tasks/from-checklist', 'POST', { assigneeId: u.id, title: text || 'Task from page', sourceNodeId: docId, sourceBlockId: block.id });
    } else {
      apiSend('/api/notifications', 'POST', { userId: u.id, type: 'mention', nodeId: docId, message: `${currentUser.name} mentioned you in a page` });
    }
  };

  const insertChip = (type: string, props: any) => editor.insertInlineContent([{ type, props } as any, ' ']);

  // The unified @ menu — shared with Chat via buildAtItems. The editor supplies how to insert.
  const getUnifiedItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const items = await buildAtItems(query, {
      excludeNodeId: docId,
      onPerson: (u) => mentionPerson(u),
      onPage: (n) => insertChip('pagelink', { nodeId: n.id, name: n.name }),
      onFile: (n) => insertChip('filelink', { nodeId: n.id, name: n.name }),
      onTask: (t) => insertChip('tasklink', { taskId: t.id, title: t.title }),
      onCreateTask: async (title) => { const r = await apiSend('/api/tasks', 'POST', { title }); const { id } = await r.json(); insertChip('tasklink', { taskId: id, title }); },
      onAddTodo: () => setReminderOpen(true),
    });
    return items.map(it => ({ title: it.title, group: it.group, subtext: it.subtitle, icon: it.icon, onItemClick: it.run })) as DefaultReactSuggestionItem[];
  };

  // Insert a task-link chip after the reminder modal creates the task.
  const insertReminderChip = (taskId: string, title: string) => insertChip('tasklink', { taskId, title });

  // Slash (/) menu: BlockNote defaults + a "Templates" group that inserts a template's blocks.
  const getSlashItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const defaults = getDefaultReactSlashMenuItems(editor as any);
    const templateItems = TEMPLATES.filter(t => t.blocks.length).map(t => ({
      title: t.name, group: 'Templates', subtext: t.description, icon: <span style={{ fontSize: '18px' }}>{t.icon}</span>,
      onItemClick: () => {
        const cur: any = editor.getTextCursorPosition().block;
        const empty = !cur?.content || cur.content.length === 0;
        if (empty) editor.replaceBlocks([cur], t.blocks as any);
        else editor.insertBlocks(t.blocks as any, cur, 'after');
      },
    }));
    return filterSuggestionItems([...(defaults as any[]), ...templateItems], query) as DefaultReactSuggestionItem[];
  };

  // Drag-to-resize the comments sidebar.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.min(680, Math.max(260, startW - (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Presence + comments toolbar */}
      <div style={{ padding: '10px 40px', borderBottom: '1px solid var(--m3-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--m3-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex' }}>
            {peers.map((p, i) => (
              <div
                key={p.name}
                onClick={() => jumpToPeer(p)}
                title={`${p.name}${p.self ? ' (you)' : ''} — ${p.focused ? 'active in this tab' : 'away'}`}
                style={{
                  width: '34px', height: '34px', borderRadius: '50%', background: p.color, color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600,
                  marginLeft: i === 0 ? 0 : '-8px', cursor: p.self ? 'default' : 'pointer',
                  // Ring: solid colored ring when active in their tab, faded gray when away.
                  boxShadow: p.focused
                    ? `0 0 0 2px var(--m3-surface), 0 0 0 4px ${p.color}`
                    : `0 0 0 2px var(--m3-surface), 0 0 0 4px var(--m3-border)`,
                  opacity: p.focused ? 1 : 0.55,
                  transition: 'opacity .2s, box-shadow .2s',
                }}
              >
                {p.name.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
          <span style={{ fontSize: '13px', color: 'var(--m3-text-secondary)' }}>
            {peers.length <= 1 ? 'Only you here' : `${peers.length} people here`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <DocToolbar editor={editor} title={docName} />
          <button
            onClick={() => setShowComments(v => !v)}
            className="m3-action-button"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: showComments ? 'var(--m3-primary)' : 'transparent', color: showComments ? 'white' : 'var(--m3-primary)', border: '1px solid var(--m3-primary)' }}
          >
            <MessageSquare size={16} /> Comments
          </button>
        </div>
      </div>

      {/* Editor + optional resizable threads sidebar (both inside BlockNoteView for shared context) */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <BlockNoteView editor={editor as any} theme={theme} renderEditor={false} comments={false} slashMenu={false} style={{ height: '100%' }}>
          <div style={{ display: 'flex', height: '100%' }}>
            <div ref={editorWrapRef} style={{ flex: 1, overflowY: 'auto', background: 'var(--m3-surface)', padding: '40px', minWidth: 0 }}>
              <BlockNoteViewEditor />
            </div>
            {showComments && (
              <>
                {/* drag handle */}
                <div onMouseDown={startResize} style={{ width: '6px', cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid var(--m3-border)' }} />
                <div style={{ width: sidebarWidth, flexShrink: 0, overflowY: 'auto', background: 'var(--m3-surface-2)', padding: '12px 16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--m3-text-secondary)', marginBottom: '8px' }}>Comments</div>
                  <ThreadsSidebar filter="all" sort="position" maxCommentsBeforeCollapse={100} />
                </div>
              </>
            )}
          </div>
          <FloatingComposerController />
          <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
          <SuggestionMenuController triggerCharacter="@" getItems={getUnifiedItems} />
        </BlockNoteView>
      </div>
      {reminderOpen && <TodoModal currentUserId={currentUser.id} sourceNodeId={docId} onClose={() => setReminderOpen(false)} onCreated={insertReminderChip} />}
    </div>
  );
}
