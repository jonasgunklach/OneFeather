import { useState } from 'react';
import { ArrowLeft, Upload, Trash2, ShieldCheck, KeyRound, LogOut, Sun, Moon } from 'lucide-react';
import { api, apiSend } from './api';
import { UserAvatar } from './UserAvatar';
import { useTheme, toggleTheme } from './theme';

type CurrentUser = { id: string, name: string, email: string, globalRole: string, twoFactorEnabled?: boolean };

function Card({ title, desc, children }: { title: string, desc?: string, children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--m3-surface)', border: '1px solid var(--m3-border)', borderRadius: '16px', padding: '24px', marginBottom: '20px' }}>
      <h2 style={{ fontSize: '17px', fontWeight: 500, marginBottom: desc ? '2px' : '14px' }}>{title}</h2>
      {desc && <p style={{ fontSize: '13px', color: 'var(--m3-text-secondary)', marginBottom: '16px' }}>{desc}</p>}
      {children}
    </div>
  );
}

export function ProfileView({ currentUser, onClose, onChanged, avatarVersion }: { currentUser: CurrentUser, onClose: () => void, onChanged: () => void, avatarVersion: number }) {
  const theme = useTheme();

  // Avatar
  const uploadAvatar = async (file: File) => {
    const form = new FormData(); form.append('file', file);
    const res = await api('/api/me/avatar', { method: 'POST', body: form });
    if (res.ok) onChanged(); else alert('Could not upload image.');
  };
  const removeAvatar = async () => { await api('/api/me/avatar', { method: 'DELETE' }); onChanged(); };

  // Password
  const [curPw, setCurPw] = useState(''); const [newPw, setNewPw] = useState(''); const [pwMsg, setPwMsg] = useState('');
  const changePassword = async () => {
    setPwMsg('');
    const res = await apiSend('/api/me/password', 'POST', { currentPassword: curPw, newPassword: newPw });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setPwMsg('✓ Password changed'); setCurPw(''); setNewPw(''); }
    else setPwMsg(data.error || 'Failed to change password');
  };

  // 2FA
  const [setup, setSetup] = useState<{ secret: string, otpauth: string } | null>(null);
  const [code, setCode] = useState(''); const [twoMsg, setTwoMsg] = useState('');
  const [disabling, setDisabling] = useState(false); const [disableCode, setDisableCode] = useState('');
  const start2fa = async () => { const res = await apiSend('/api/me/2fa/setup', 'POST'); setSetup(await res.json()); setTwoMsg(''); };
  const enable2fa = async () => {
    const res = await apiSend('/api/me/2fa/enable', 'POST', { code });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setSetup(null); setCode(''); onChanged(); } else setTwoMsg(data.error || 'Invalid code');
  };
  const disable2fa = async () => {
    const res = await apiSend('/api/me/2fa/disable', 'POST', { code: disableCode });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setDisabling(false); setDisableCode(''); onChanged(); } else alert(data.error || 'Failed');
  };

  const signOutOthers = async () => { await apiSend('/api/me/revoke-other-sessions', 'POST'); alert('Signed out of all other devices.'); };

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--m3-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 24px', borderBottom: '1px solid var(--m3-border)', background: 'var(--m3-surface)', position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={onClose} className="m3-small-btn" style={{ border: 'none' }}><ArrowLeft size={18} /> Back</button>
        <h1 style={{ fontSize: '20px', fontWeight: 500 }}>Profile & Account</h1>
      </div>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Identity + avatar */}
        <Card title="Profile">
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <UserAvatar id={currentUser.id} name={currentUser.name} size={72} version={avatarVersion} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '20px', fontWeight: 500 }}>{currentUser.name}</div>
              <div style={{ fontSize: '14px', color: 'var(--m3-text-secondary)' }}>{currentUser.email}</div>
              <div style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', marginTop: '2px' }}>Role: {currentUser.globalRole}{currentUser.globalRole === 'admin' ? ' · managed by your organization' : ''}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <label className="m3-small-btn" style={{ cursor: 'pointer' }}>
                  <Upload size={14} /> Upload photo
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); e.target.value = ''; }} />
                </label>
                <button className="m3-small-btn danger" onClick={removeAvatar}><Trash2 size={14} /> Remove</button>
              </div>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', marginTop: '16px' }}>Your name is set by your organization and can’t be changed here. Contact an admin to update it.</p>
        </Card>

        {/* Appearance */}
        <Card title="Appearance" desc="Choose how OneFeather looks to you.">
          <button className="m3-small-btn" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          </button>
        </Card>

        {/* Password */}
        <Card title="Change password">
          <input className="modal-input" type="password" placeholder="Current password" value={curPw} onChange={e => setCurPw(e.target.value)} style={{ maxWidth: '360px' }} />
          <input className="modal-input" type="password" placeholder="New password (min 6 chars)" value={newPw} onChange={e => setNewPw(e.target.value)} style={{ maxWidth: '360px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px' }}>
            <button className="m3-action-button" disabled={!curPw || newPw.length < 6} onClick={changePassword}><KeyRound size={15} style={{ verticalAlign: '-2px', marginRight: '4px' }} /> Update password</button>
            {pwMsg && <span style={{ fontSize: '13px', color: pwMsg.startsWith('✓') ? '#137333' : '#d93025' }}>{pwMsg}</span>}
          </div>
        </Card>

        {/* 2FA */}
        <Card title="Two-factor authentication" desc="Add a one-time code from an authenticator app (Google Authenticator, 1Password, Authy…) at sign-in.">
          {currentUser.twoFactorEnabled ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#137333', fontWeight: 500 }}><ShieldCheck size={18} /> Two-factor is on</span>
              {!disabling ? (
                <button className="m3-small-btn danger" onClick={() => setDisabling(true)}>Turn off</button>
              ) : (
                <>
                  <input className="modal-input" placeholder="Current code" value={disableCode} onChange={e => setDisableCode(e.target.value)} style={{ maxWidth: '130px', margin: 0, letterSpacing: '3px' }} />
                  <button className="m3-small-btn danger" disabled={disableCode.length !== 6} onClick={disable2fa}>Confirm off</button>
                  <button className="m3-small-btn" onClick={() => { setDisabling(false); setDisableCode(''); }}>Cancel</button>
                </>
              )}
            </div>
          ) : !setup ? (
            <button className="m3-action-button" onClick={start2fa}>Set up two-factor</button>
          ) : (
            <div>
              <p style={{ fontSize: '13px', marginBottom: '8px' }}>1. Add this account to your authenticator app — scan isn’t available yet, so enter the key manually:</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                <code style={{ background: 'var(--m3-surface-2)', padding: '8px 12px', borderRadius: '8px', fontSize: '15px', letterSpacing: '1px', wordBreak: 'break-all' }}>{setup.secret}</code>
                <button className="m3-small-btn" onClick={() => navigator.clipboard.writeText(setup.secret)}>Copy key</button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--m3-text-secondary)', marginBottom: '12px', wordBreak: 'break-all' }}>or use this setup link: <code>{setup.otpauth}</code></p>
              <p style={{ fontSize: '13px', marginBottom: '6px' }}>2. Enter the 6-digit code it shows:</p>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input className="modal-input" placeholder="123456" value={code} onChange={e => setCode(e.target.value)} style={{ maxWidth: '140px', margin: 0, letterSpacing: '3px', fontSize: '16px' }} />
                <button className="m3-action-button" disabled={code.length !== 6} onClick={enable2fa}>Verify & enable</button>
                <button className="m3-small-btn" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
              </div>
              {twoMsg && <div style={{ color: '#d93025', fontSize: '13px', marginTop: '8px' }}>{twoMsg}</div>}
            </div>
          )}
        </Card>

        {/* Sessions */}
        <Card title="Security" desc="Signed in on another device you don’t recognize?">
          <button className="m3-small-btn" onClick={signOutOthers}><LogOut size={14} /> Sign out of all other devices</button>
        </Card>
      </div>
    </div>
  );
}
