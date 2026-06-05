import { useState, useEffect } from 'react';
import { API_BASE } from './api';
import { colorForId } from './collab/inlineSpecs';

// Shows a user's profile picture (served publicly) with a colored-initials fallback.
// `version` busts the browser cache after an avatar is changed.
export function UserAvatar({ id, name, size = 32, version, ring }: { id: string, name: string, size?: number, version?: number, ring?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [id, version]);

  const style: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover',
    ...(ring ? { boxShadow: `0 0 0 2px var(--m3-surface), 0 0 0 4px ${ring}` } : {}),
  };

  if (failed) {
    return (
      <div style={{ ...style, background: colorForId(id), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.42 }}>
        {(name || '?').charAt(0).toUpperCase()}
      </div>
    );
  }
  const src = `${API_BASE}/api/users/${id}/avatar${version ? `?v=${version}` : ''}`;
  return <img src={src} alt={name} style={style} onError={() => setFailed(true)} />;
}
