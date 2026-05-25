import { useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';

interface AuthModalProps {
  onClose: () => void;
  onGoogleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (name: string, email: string, password: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
}

export function AuthModal({ onClose, onGoogleSignIn, onEmailSignIn, onEmailSignUp, onForgotPassword }: AuthModalProps) {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'reset_sent'>('idle');
  const [error, setError] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');

  const handleGoogle = async () => {
    setStatus('loading');
    try {
      await onGoogleSignIn();
    } catch (e: any) {
      console.error('[Auth] Google sign-in failed:', e?.code, e?.message);
      setError(friendlyError(e?.code));
      setStatus('error');
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!email.trim() || !password) { setError('Email and password are required.'); return; }
    if (tab === 'signup') {
      if (!name.trim()) { setError('Please enter your name.'); return; }
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
      if (password !== confirm) { setError('Passwords do not match.'); return; }
    }
    setStatus('loading');
    try {
      if (tab === 'signin') {
        await onEmailSignIn(email.trim(), password);
      } else {
        await onEmailSignUp(name.trim(), email.trim(), password);
      }
    } catch (e: any) {
      setError(friendlyError(e?.code));
      setStatus('error');
    }
  };

  const handleForgot = async () => {
    if (!forgotEmail.trim()) { setError('Enter your email address.'); return; }
    setStatus('loading');
    try {
      await onForgotPassword(forgotEmail.trim());
      setStatus('reset_sent');
    } catch (e: any) {
      setError(friendlyError(e?.code));
      setStatus('error');
    }
  };

  const switchTab = (t: 'signin' | 'signup') => {
    setTab(t); setError(''); setStatus('idle');
    setName(''); setPassword(''); setConfirm('');
  };

  const isLoading = status === 'loading';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          padding: 28,
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
              {showForgot ? 'Reset password' : tab === 'signin' ? 'Welcome back' : 'Create account'}
            </div>
            {!showForgot && (
              <div style={{ fontSize: 13, color: 'var(--text-tert)', marginTop: 4 }}>
                {tab === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <span
                  onClick={() => { switchTab(tab === 'signin' ? 'signup' : 'signin'); setShowForgot(false); }}
                  style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
                >
                  {tab === 'signin' ? 'Sign up' : 'Sign in'}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-alt)', border: '1px solid var(--border)',
              cursor: 'pointer', color: 'var(--text-tert)', padding: 6, lineHeight: 0,
              borderRadius: 8, flexShrink: 0, marginLeft: 12,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {showForgot ? (
          <>
            {status === 'reset_sent' ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📬</div>
                <div style={{ color: '#16a34a', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Reset email sent!</div>
                <div style={{ color: 'var(--text-sec)', fontSize: 13 }}>Check your inbox and follow the link.</div>
                <button
                  onClick={() => { setShowForgot(false); setStatus('idle'); setError(''); }}
                  style={linkBtnStyle}
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <p style={{ color: 'var(--text-sec)', fontSize: 13.5, marginBottom: 16, lineHeight: 1.55 }}>
                  Enter your email and we'll send a password reset link.
                </p>
                <input
                  type="email"
                  placeholder="Email address"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleForgot()}
                  style={inputStyle}
                />
                {error && <div style={errorStyle}>{error}</div>}
                <button onClick={handleForgot} disabled={isLoading} style={primaryBtnStyle(isLoading)}>
                  {isLoading ? 'Sending…' : 'Send reset link'}
                </button>
                <button onClick={() => { setShowForgot(false); setError(''); setStatus('idle'); }} style={linkBtnStyle}>
                  Back to sign in
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {/* Google button */}
            <button onClick={handleGoogle} disabled={isLoading} style={googleBtnStyle}>
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-tert)', fontWeight: 600, letterSpacing: '0.04em' }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tab === 'signup' && (
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={inputStyle}
                />
              )}
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => tab === 'signin' && e.key === 'Enter' && handleSubmit()}
                style={inputStyle}
              />
              {tab === 'signup' && (
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  style={inputStyle}
                />
              )}
            </div>

            {tab === 'signin' && (
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <span
                  onClick={() => { setShowForgot(true); setError(''); setStatus('idle'); setForgotEmail(email); }}
                  style={{ fontSize: 12.5, color: 'var(--text-tert)', cursor: 'pointer' }}
                >
                  Forgot password?
                </span>
              </div>
            )}

            {error && <div style={{ ...errorStyle, marginTop: 10 }}>{error}</div>}

            <button
              onClick={handleSubmit}
              disabled={isLoading}
              style={{ ...primaryBtnStyle(isLoading), marginTop: 14 }}
            >
              {isLoading ? '…' : tab === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-alt)',
  color: 'var(--text)', fontSize: 13.5,
  fontFamily: 'inherit', outline: 'none',
};

const primaryBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%', padding: '12px', borderRadius: 11, border: 'none',
  background: disabled ? 'rgba(37,99,235,0.5)' : '#2563eb',
  color: '#fff',
  fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background 0.15s',
  opacity: disabled ? 0.7 : 1,
});

const googleBtnStyle: React.CSSProperties = {
  width: '100%', padding: '11px 16px', borderRadius: 11,
  border: '1px solid var(--border)',
  background: 'var(--bg-alt)',
  color: 'var(--text)', fontSize: 13.5, fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  transition: 'background 0.15s',
};

const errorStyle: React.CSSProperties = {
  fontSize: 12.5, color: '#dc2626',
  background: 'rgba(220,38,38,0.06)',
  border: '1px solid rgba(220,38,38,0.18)',
  borderRadius: 8, padding: '8px 12px',
};

const linkBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 14,
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#2563eb', fontSize: 13, fontWeight: 600,
  fontFamily: 'inherit', textAlign: 'center',
};

function friendlyError(code?: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again in a few minutes.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'Sign-in is not enabled for this domain yet. Please try again in a few minutes or contact support.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
