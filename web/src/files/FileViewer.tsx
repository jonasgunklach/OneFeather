import { useEffect, useState } from 'react';
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_BASE, api, getToken } from '../api';
import { fileKind } from './fileIcons';

// Full-screen viewer for a file node: renders the real image/pdf/video/audio/text.
export function FileViewer({ node, onClose, onPrev, onNext, onDownload }: {
  node: any, onClose: () => void, onPrev?: () => void, onNext?: () => void, onDownload: (n: any) => void,
}) {
  const kind = fileKind(node.mimeType, node.name);
  const src = `${API_BASE}/api/nodes/${node.id}/raw?token=${getToken() || ''}`;
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  useEffect(() => {
    if (kind !== 'text') { setText(null); return; }
    setText('Loading…');
    api(`/api/nodes/${node.id}/raw`).then(r => r.text()).then(setText).catch(() => setText('Could not load file.'));
  }, [node.id, kind]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', color: 'white' }}>
        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => onDownload(node)} title="Download" style={vbtn}><Download size={20} /></button>
          <button onClick={onClose} title="Close (Esc)" style={vbtn}><X size={20} /></button>
        </div>
      </div>

      {/* nav arrows */}
      {onPrev && <button onClick={onPrev} title="Previous" style={{ ...arrow, left: '12px' }}><ChevronLeft size={28} /></button>}
      {onNext && <button onClick={onNext} title="Next" style={{ ...arrow, right: '12px' }}><ChevronRight size={28} /></button>}

      {/* content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 60px 30px', overflow: 'hidden' }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {kind === 'image' && <img src={src} alt={node.name} style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '6px' }} />}
          {kind === 'pdf' && <iframe src={src} title={node.name} style={{ width: '80vw', height: '88vh', border: 'none', borderRadius: '6px', background: 'white' }} />}
          {kind === 'video' && <video src={src} controls autoPlay style={{ maxWidth: '85vw', maxHeight: '85vh', borderRadius: '6px' }} />}
          {kind === 'audio' && <div style={{ background: 'var(--m3-surface)', padding: '32px', borderRadius: '12px' }}><audio src={src} controls autoPlay /></div>}
          {kind === 'text' && <pre style={{ background: 'var(--m3-surface)', color: 'var(--m3-text-primary)', padding: '24px', borderRadius: '8px', maxWidth: '80vw', maxHeight: '85vh', overflow: 'auto', fontSize: '13px', whiteSpace: 'pre-wrap' }}>{text}</pre>}
          {kind === 'other' && (
            <div style={{ background: 'var(--m3-surface)', color: 'var(--m3-text-primary)', padding: '40px', borderRadius: '12px', textAlign: 'center' }}>
              <p style={{ marginBottom: '16px' }}>No preview available for this file type.</p>
              <button className="m3-action-button" onClick={() => onDownload(node)}>Download</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const vbtn: React.CSSProperties = { background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const arrow: React.CSSProperties = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '50%', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 };
