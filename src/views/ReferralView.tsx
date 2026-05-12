import { useState, useCallback } from 'react';

interface ReferralViewProps {
  userId: string;
  displayName: string | null;
  email: string | null;
}

function generateReferralCode(uid: string): string {
  return ('PKS' + uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase()).padEnd(8, '0');
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={copy}
      style={{
        padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: copied ? '#16a34a' : '#2563eb', color: '#fff',
        fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
        transition: 'background 0.15s', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

const STEPS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    title: 'Share your code',
    desc: 'Send your unique referral link to friends preparing for UPSC or state exams.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 9.81a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.06 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    ),
    title: 'Friend signs up',
    desc: 'They create an account using your link or enter your code at signup.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
    title: 'Both get rewarded',
    desc: 'You earn 7 days free Pro. Your friend gets 20% off their first subscription.',
  },
];

const MILESTONES = [
  { count: 1,  reward: '7 days Pro' },
  { count: 3,  reward: '1 month Pro' },
  { count: 5,  reward: '₹50 bonus' },
  { count: 10, reward: '₹150 bonus' },
  { count: 25, reward: '₹500 bonus' },
];

export function ReferralView({ userId, displayName, email }: ReferralViewProps) {
  const code = generateReferralCode(userId);
  const shareUrl = `${window.location.origin}?ref=${code}`;
  const [activeTab, setActiveTab] = useState<'overview' | 'milestones'>('overview');

  const shareVia = (channel: string) => {
    const text = `Join me on Pariksha — the best PYQ practice app for UPSC and state exams. Use my code ${code} to get 20% off Pro. ${shareUrl}`;
    const encodedText = encodeURIComponent(text);
    const encodedUrl = encodeURIComponent(shareUrl);

    const urls: Record<string, string> = {
      whatsapp: `https://wa.me/?text=${encodedText}`,
      telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(`Use my code ${code} to get 20% off Pro on Pariksha PYQ Practice.`)}`,
      twitter: `https://twitter.com/intent/tweet?text=${encodedText}`,
    };
    if (urls[channel]) window.open(urls[channel], '_blank', 'noopener,noreferrer');
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px', fontSize: 13.5, fontWeight: active ? 700 : 500,
    color: active ? '#2563eb' : 'var(--text-sec)', background: 'none',
    border: 'none', borderBottom: `2px solid ${active ? '#2563eb' : 'transparent'}`,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.1s, border-color 0.1s',
  });

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', fontFamily: "'Inter', sans-serif" }}>

      {/* ── Hero banner ─────────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 60%, #7c3aed 100%)',
        borderRadius: 16, padding: '32px 36px', marginBottom: 28,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -30, top: -30, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', right: 60, bottom: -40, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 28, position: 'relative', zIndex: 1 }}>
          <div style={{ flexShrink: 0 }}>
            <svg width="72" height="72" viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="40" fill="rgba(255,255,255,0.12)"/>
              <path d="M40 18 L50 35 L65 37 L53 49 L56 64 L40 56 L24 64 L27 49 L15 37 L30 35 Z" fill="#fbbf24" opacity="0.9"/>
              <circle cx="40" cy="40" r="10" fill="rgba(255,255,255,0.15)"/>
              <path d="M34 40 L38 44 L46 36" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.3px' }}>
              Study together. Earn together.
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.6, maxWidth: 420 }}>
              Invite friends to Pariksha. You both win — they get 20% off Pro, you earn free Pro days for every successful referral.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {[
              { value: '20%', label: 'Friend discount' },
              { value: '7d', label: 'Your reward' },
            ].map(({ value, label }) => (
              <div key={label} style={{ textAlign: 'center', padding: '10px 16px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <button style={tabStyle(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>Overview</button>
        <button style={tabStyle(activeTab === 'milestones')} onClick={() => setActiveTab('milestones')}>Milestones</button>
      </div>

      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

          {/* Left — code + share */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Referral code card */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 24px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
                Your Referral Code
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{
                  flex: 1, padding: '12px 16px', background: 'var(--bg-alt)',
                  border: '1px solid var(--border)', borderRadius: 10,
                  fontSize: 22, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--text)',
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                }}>
                  {code}
                </div>
                <CopyButton text={code} label="Copy Code" />
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Referral Link
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  flex: 1, padding: '10px 14px', background: 'var(--bg-alt)',
                  border: '1px solid var(--border)', borderRadius: 10,
                  fontSize: 12.5, color: 'var(--text-sec)', overflow: 'hidden',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  {shareUrl}
                </div>
                <CopyButton text={shareUrl} label="Copy Link" />
              </div>
            </div>

            {/* Share via */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
                Share via
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  {
                    id: 'whatsapp', label: 'WhatsApp', color: '#16a34a', bg: '#dcfce7',
                    icon: (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                      </svg>
                    ),
                  },
                  {
                    id: 'telegram', label: 'Telegram', color: '#0369a1', bg: '#e0f2fe',
                    icon: (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                    ),
                  },
                  {
                    id: 'twitter', label: 'Twitter / X', color: '#0f172a', bg: '#f1f5f9',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    ),
                  },
                ].map(({ id, label, color, bg, icon }) => (
                  <button
                    key={id}
                    onClick={() => shareVia(id)}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--border)',
                      background: 'var(--bg)', cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#94a3b8'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
                      {icon}
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-sec)' }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* How it works */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 18 }}>How it works</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {STEPS.map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                      background: i === 0 ? '#eff6ff' : i === 1 ? '#f5f3ff' : '#f0fdf4',
                      color: i === 0 ? '#2563eb' : i === 1 ? '#7c3aed' : '#16a34a',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {step.icon}
                    </div>
                    <div style={{ paddingTop: 2 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
                        {i + 1}. {step.title}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.6 }}>
                        {step.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right — stats sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 24 }}>

            {/* Your stats */}
            <div style={{ background: 'linear-gradient(135deg, #0f172a, #1e3a8a)', borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                Your Referral Stats
              </div>
              {[
                { label: 'Links shared', value: '0' },
                { label: 'Successful signups', value: '0' },
                { label: 'Pro days earned', value: '0 days' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{value}</span>
                </div>
              ))}
              <div style={{ marginTop: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
                Stats update within 24 hours of a successful signup or purchase.
              </div>
            </div>

            {/* What you get */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>What you both get</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 3 }}>You (referrer)</div>
                  <div style={{ fontSize: 12.5, color: '#166534', lineHeight: 1.5 }}>
                    7 free Pro days per successful referral. Stack them — 3 referrals = 21 days free.
                  </div>
                </div>
                <div style={{ padding: '12px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 3 }}>Your friend</div>
                  <div style={{ fontSize: 12.5, color: '#1e40af', lineHeight: 1.5 }}>
                    20% off their first Pro subscription when they use your code at checkout.
                  </div>
                </div>
              </div>
            </div>

            {/* T&C note */}
            <div style={{ fontSize: 11.5, color: 'var(--text-tert)', lineHeight: 1.7, padding: '0 2px' }}>
              Reward is credited after friend completes a verified purchase. One referral reward per unique friend. Code must be applied before purchase.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'milestones' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 24px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Referral Milestones</div>
            <div style={{ fontSize: 13, color: 'var(--text-tert)', marginBottom: 20 }}>Extra rewards when you hit these numbers in a calendar month.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MILESTONES.map(({ count, reward }, i) => {
                const reached = 0 >= count;
                const colors = ['#ef4444', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed'];
                const bgs = ['#fef2f2', '#fff7ed', '#f0fdf4', '#eff6ff', '#f5f3ff'];
                const borderColors = ['#fecaca', '#fed7aa', '#bbf7d0', '#bfdbfe', '#ddd6fe'];
                return (
                  <div
                    key={count}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: '14px 18px', borderRadius: 12,
                      background: reached ? bgs[i % bgs.length] : 'var(--bg-alt)',
                      border: `1px solid ${reached ? borderColors[i % borderColors.length] : 'var(--border)'}`,
                    }}
                  >
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      background: reached ? colors[i % colors.length] : 'var(--bg-canvas)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 800, color: reached ? '#fff' : 'var(--text-tert)',
                    }}>
                      {count}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
                        {count} successful referral{count > 1 ? 's' : ''}
                      </div>
                      <div style={{ fontSize: 12.5, color: reached ? colors[i % colors.length] : 'var(--text-sec)', fontWeight: reached ? 700 : 400, marginTop: 2 }}>
                        {reward}
                      </div>
                    </div>
                    <div style={{
                      padding: '4px 12px', borderRadius: 20, fontSize: 11.5, fontWeight: 700,
                      background: reached ? colors[i % colors.length] : 'var(--bg-canvas)',
                      color: reached ? '#fff' : 'var(--text-tert)',
                    }}>
                      {reached ? 'Unlocked' : '0 / ' + count}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 18, padding: '14px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 12.5, color: '#1d4ed8', lineHeight: 1.6 }}>
              Milestone rewards stack with per-referral rewards. Reach 5 referrals in May and you get 5 × 7 days Pro + ₹50 extra.
            </div>
          </div>

          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', position: 'sticky', top: 24 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Your code</div>
            <div style={{
              padding: '12px 16px', background: 'var(--bg-alt)', border: '1px solid var(--border)',
              borderRadius: 10, fontSize: 20, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--text)',
              fontFamily: "'SF Mono', 'Fira Code', monospace", marginBottom: 10,
              textAlign: 'center',
            }}>
              {code}
            </div>
            <CopyButton text={shareUrl} label="Copy share link" />
            <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-tert)', lineHeight: 1.7 }}>
              Current referrals: <strong style={{ color: 'var(--text)' }}>0</strong><br />
              Pro days earned: <strong style={{ color: 'var(--text)' }}>0</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
