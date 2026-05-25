import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { loadRazorpayScript, type RazorpaySuccessResponse } from '../lib/razorpay';
import { API_BASE } from '../lib/api';

interface PremiumGateModalProps {
  freePaperLabel: string;
  onClose: () => void;
}

type Plan = 'monthly' | 'yearly';

const FEATURES = [
  'All previous year papers across every commission',
  'Advanced analytics — accuracy trends, weak-area deep-dives',
  'Unlimited bookmarks and custom practice sets',
  'AI explanations for every question, instantly',
  'Full leaderboard visibility and rank tracking',
  'Unlock all years: 2015 → present for all exams',
];

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const PLANS: Record<Plan, { label: string; price: string; subtext: string; paise: number }> = {
  monthly: { label: 'Monthly', price: '₹149', subtext: 'per month', paise: 14900 },
  yearly:  { label: 'Yearly',  price: '₹999', subtext: 'per year · save 44%', paise: 99900 },
};

export function PremiumGateModal({ freePaperLabel, onClose }: PremiumGateModalProps) {
  const { user, getApiToken, refreshSubscription, handleLogin } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<Plan>('yearly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [hoverClose, setHoverClose] = useState(false);

  const handleUpgrade = async () => {
    if (!user) { handleLogin(); return; }
    setError('');
    setLoading(true);
    try {
      await loadRazorpayScript();
      const token = await getApiToken();
      if (!token) throw new Error('Not authenticated');

      const orderRes = await fetch(`${API_BASE}/payment/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      if (!orderRes.ok) {
        const msg = await orderRes.text().catch(() => 'Order creation failed');
        throw new Error(msg);
      }
      const { order_id, amount, currency, key_id } = (await orderRes.json()) as {
        order_id: string; amount: number; currency: string; key_id: string;
      };

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: key_id,
          amount,
          currency,
          name: 'ParikshaGPT',
          description: `${PLANS[selectedPlan].label} Premium`,
          order_id,
          prefill: {
            name: user.displayName ?? undefined,
            email: user.email ?? undefined,
          },
          theme: { color: '#f59e0b' },
          handler: async (response: RazorpaySuccessResponse) => {
            try {
              const verifyRes = await fetch(`${API_BASE}/payment/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  order_id: response.razorpay_order_id,
                  payment_id: response.razorpay_payment_id,
                  signature: response.razorpay_signature,
                  plan: selectedPlan,
                }),
              });
              if (!verifyRes.ok) throw new Error('Verification failed');
              await refreshSubscription();
              setSuccess(true);
              setTimeout(onClose, 2200);
              resolve();
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          },
          modal: {
            ondismiss: () => {
              setLoading(false);
              resolve();
            },
          },
        });
        rzp.open();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.52)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          borderRadius: 20,
          padding: '32px 32px 24px',
          maxWidth: 460,
          width: '100%',
          boxShadow: '0 24px 64px rgba(0,0,0,0.24)',
          border: '1px solid var(--border)',
          position: 'relative',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          onMouseEnter={() => setHoverClose(true)}
          onMouseLeave={() => setHoverClose(false)}
          aria-label="Close"
          style={{
            position: 'absolute', top: 14, right: 14,
            width: 30, height: 30, borderRadius: '50%',
            background: hoverClose ? 'var(--bg-alt)' : 'transparent',
            border: '1px solid var(--border)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tert)', transition: 'all 0.12s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            boxShadow: '0 8px 24px rgba(245,158,11,0.28)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none" aria-hidden="true">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px', letterSpacing: '-0.3px' }}>
            Unlock Premium Access
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0, lineHeight: 1.6 }}>
            Free plan includes <strong style={{ color: 'var(--text)' }}>{freePaperLabel}</strong> only.
            Upgrade for all{' '}
            <strong style={{ color: 'var(--text)' }}>2,500+ papers</strong> across every exam.
          </p>
        </div>

        {/* Plan picker */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          {(Object.entries(PLANS) as [Plan, typeof PLANS[Plan]][]).map(([key, p]) => (
            <button
              key={key}
              onClick={() => setSelectedPlan(key)}
              style={{
                flex: 1, padding: '12px 10px', borderRadius: 12, cursor: 'pointer',
                border: selectedPlan === key
                  ? '2px solid #f59e0b'
                  : '2px solid var(--border)',
                background: selectedPlan === key ? 'rgba(245,158,11,0.08)' : 'var(--bg-alt)',
                textAlign: 'center', transition: 'all 0.15s', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-sec)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {p.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: selectedPlan === key ? '#d97706' : 'var(--text)' }}>
                {p.price}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
                {p.subtext}
              </div>
              {key === 'yearly' && (
                <div style={{
                  marginTop: 5, fontSize: 10, fontWeight: 700, color: '#16a34a',
                  background: 'var(--green-soft)', borderRadius: 4, padding: '2px 6px', display: 'inline-block',
                }}>
                  BEST VALUE
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Feature list */}
        <div style={{ marginBottom: 18 }}>
          {FEATURES.map((text) => (
            <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
              <span style={{ flexShrink: 0, marginTop: 1, color: '#16a34a', display: 'flex' }}>
                <CheckIcon />
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom: 12, padding: '10px 14px', borderRadius: 8,
            background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)',
            fontSize: 13, color: '#b91c1c',
          }}>
            {error}
          </div>
        )}

        {/* CTA */}
        {success ? (
          <div style={{
            padding: '13px 0', borderRadius: 10,
            background: 'var(--green-soft)', border: '1px solid rgba(16,185,129,0.25)',
            textAlign: 'center', marginBottom: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <span style={{ color: '#16a34a', display: 'flex' }}><CheckIcon /></span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>
              Welcome to Premium! All papers unlocked.
            </span>
          </div>
        ) : (
          <button
            disabled={loading}
            style={{
              width: '100%', padding: '13px 0',
              background: loading ? 'var(--bg-alt)' : 'linear-gradient(135deg, #f59e0b, #d97706)',
              border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              color: loading ? 'var(--text-sec)' : 'white',
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(245,158,11,0.32)',
              marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.15s',
            }}
            onClick={() => void handleUpgrade()}
          >
            {loading ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Processing…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>
                </svg>
                Pay {PLANS[selectedPlan].price} with Razorpay
              </>
            )}
          </button>
        )}

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '10px 0',
            background: 'none', border: 'none',
            fontSize: 13, color: 'var(--text-tert)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Continue with free plan
        </button>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-tert)', margin: '8px 0 0' }}>
          Secured by Razorpay · No auto-renewal · Cancel anytime
        </p>
      </div>
    </div>
  );
}
