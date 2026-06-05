import { useEffect, useState } from 'react';
import { Undo2, Redo2, Search, Download, FileText } from 'lucide-react';
import { exportDoc } from './docExport';

function wordCount(blocks: any[]): number {
  let n = 0;
  const walk = (bs: any[]) => {
    for (const b of bs) {
      const content = Array.isArray(b.content) ? b.content : [];
      for (const c of content) if (c.type === 'text' && c.text) n += c.text.trim().split(/\s+/).filter(Boolean).length;
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks || []);
  return n;
}

export function DocToolbar({ editor, title }: { editor: any, title: string }) {
  const [words, setWords] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState('');

  useEffect(() => {
    const update = () => setWords(wordCount(editor.document));
    update();
    const unsub = editor.onChange?.(update);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [editor]);

  // Ensure Cmd/Ctrl+Z works even with collaboration (BlockNote's default binding can break under Yjs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); }
      else if (k === 'y') { e.preventDefault(); editor.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const runFind = () => { if (find.trim() && (window as any).find) (window as any).find(find); };

  const btn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--m3-text-secondary)', display: 'flex', alignItems: 'center', padding: '4px', borderRadius: '6px' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
      <button style={btn} title="Undo (⌘Z)" onClick={() => editor.undo()}><Undo2 size={18} /></button>
      <button style={btn} title="Redo (⌘⇧Z)" onClick={() => editor.redo()}><Redo2 size={18} /></button>
      <button style={btn} title="Find" onClick={() => setFindOpen(v => !v)}><Search size={18} /></button>
      <span style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', margin: '0 6px' }}>{words} words</span>
      <div style={{ position: 'relative' }}>
        <button className="m3-small-btn" onClick={() => setExportOpen(v => !v)} title="Export"><Download size={15} /> Export</button>
        {exportOpen && (
          <div style={{ position: 'absolute', right: 0, top: '36px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.16)', zIndex: 100, minWidth: '170px', overflow: 'hidden' }}>
            {([['pdf', 'PDF (.pdf)'], ['docx', 'Word (.docx)'], ['md', 'Markdown (.md)'], ['html', 'HTML (.html)']] as const).map(([f, label]) => (
              <div key={f} className="m3-menu-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={async () => { setExportOpen(false); try { await exportDoc(editor, f, title); } catch (err) { alert('Export failed: ' + (err as Error).message); } }}>
                <FileText size={15} /> {label}
              </div>
            ))}
          </div>
        )}
      </div>
      {findOpen && (
        <div style={{ position: 'absolute', right: 0, top: '40px', background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.16)', zIndex: 100, padding: '8px', display: 'flex', gap: '6px' }}>
          <input className="modal-input" autoFocus style={{ margin: 0, width: '180px' }} placeholder="Find in page…" value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runFind(); }} />
          <button className="m3-small-btn" onClick={runFind}>Find</button>
        </div>
      )}
    </div>
  );
}
