import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { C } from '../lib/tokens';
import type { CatalogSummary, FeedSummary } from '../types';

interface LandingPageProps {
  onLogin: () => void;
  onContinueGuest: () => void;
  catalogSummary: CatalogSummary | null;
  feedSummary: FeedSummary | null;
}

const ORDERED_COMMISSIONS = ['UPSC', 'APPSC', 'TSPSC', 'TSLPRB', 'APSLPRB', 'APHC', 'TSHC', 'SSC'];

function Avatar({ initials, bg, fg, size = 42 }: { initials: string; bg: string; fg: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" aria-hidden="true">
      <circle cx="21" cy="21" r="21" fill={bg} />
      <text x="21" y="26.5" textAnchor="middle" fill={fg} fontSize="13.5" fontWeight="700" fontFamily="Inter, sans-serif">
        {initials}
      </text>
    </svg>
  );
}

function QuestionCardIllustration() {
  return (
    <svg viewBox="0 0 368 448" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Practice question preview" style={{ width: '100%', maxWidth: 368, display: 'block' }}>
      <rect x="6" y="10" width="356" height="432" rx="20" fill="rgba(15,23,42,0.055)" />
      <rect x="0" y="0" width="356" height="432" rx="20" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.5" />

      {/* Badge row */}
      <rect x="16" y="16" width="100" height="24" rx="12" fill="#dbeafe" />
      <text x="66" y="32.5" textAnchor="middle" fill="#1d4ed8" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">UPSC Prelims</text>
      <rect x="124" y="16" width="42" height="24" rx="12" fill="#f0fdf4" />
      <text x="145" y="32.5" textAnchor="middle" fill="#16a34a" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">2024</text>
      <rect x="174" y="16" width="46" height="24" rx="12" fill="#f5f3ff" />
      <text x="197" y="32.5" textAnchor="middle" fill="#7c3aed" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">Polity</text>

      {/* Progress */}
      <rect x="16" y="53" width="324" height="3" rx="1.5" fill="#f1f5f9" />
      <rect x="16" y="53" width="74" height="3" rx="1.5" fill="#2563eb" />
      <text x="16" y="68" fill="#94a3b8" fontSize="10.5" fontFamily="Inter, sans-serif" fontWeight="500">Q 23 of 100</text>

      {/* Question text */}
      <text x="16" y="90" fill="#0f172a" fontSize="13" fontFamily="Inter, sans-serif" fontWeight="700">With reference to Article 32, consider the</text>
      <text x="16" y="107" fill="#0f172a" fontSize="13" fontFamily="Inter, sans-serif" fontWeight="700">following statements:</text>
      <text x="16" y="128" fill="#475569" fontSize="12" fontFamily="Inter, sans-serif">1. It guarantees approach to the Supreme Court for</text>
      <text x="24" y="144" fill="#475569" fontSize="12" fontFamily="Inter, sans-serif">enforcement of Fundamental Rights.</text>
      <text x="16" y="162" fill="#475569" fontSize="12" fontFamily="Inter, sans-serif">2. It can be suspended during a National Emergency.</text>
      <text x="16" y="184" fill="#0f172a" fontSize="12.5" fontFamily="Inter, sans-serif" fontWeight="600">Which of the above is/are correct?</text>

      {/* Option A */}
      <rect x="16" y="196" width="324" height="40" rx="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      <circle cx="40" cy="216" r="10" fill="#e2e8f0" />
      <text x="40" y="220.5" textAnchor="middle" fill="#64748b" fontSize="10.5" fontWeight="700" fontFamily="Inter, sans-serif">A</text>
      <text x="58" y="220" fill="#475569" fontSize="12" fontFamily="Inter, sans-serif">1 only</text>

      {/* Option B — correct */}
      <rect x="16" y="242" width="324" height="40" rx="10" fill="#f0fdf4" stroke="rgba(22,163,74,0.28)" strokeWidth="1.5" />
      <circle cx="40" cy="262" r="10" fill="#16a34a" />
      <text x="40" y="266.5" textAnchor="middle" fill="#ffffff" fontSize="10.5" fontWeight="700" fontFamily="Inter, sans-serif">B</text>
      <text x="58" y="266" fill="#15803d" fontSize="12" fontFamily="Inter, sans-serif" fontWeight="600">1 and 2 both</text>
      <path d="M311 256l4.5 4.5 9-9" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* Option C */}
      <rect x="16" y="288" width="324" height="40" rx="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      <circle cx="40" cy="308" r="10" fill="#e2e8f0" />
      <text x="40" y="312.5" textAnchor="middle" fill="#64748b" fontSize="10.5" fontWeight="700" fontFamily="Inter, sans-serif">C</text>
      <text x="58" y="312" fill="#475569" fontSize="12" fontFamily="Inter, sans-serif">2 only</text>

      {/* Option D */}
      <rect x="16" y="334" width="324" height="40" rx="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
      <circle cx="40" cy="354" r="10" fill="#e2e8f0" />
      <text x="40" y="358.5" textAnchor="middle" fill="#64748b" fontSize="10.5" fontWeight="700" fontFamily="Inter, sans-serif">D</text>
      <text x="58" y="358" fill="#475569" fontSize="12" fontFamily="Inter, sans-serif">Neither 1 nor 2</text>

      {/* Bottom bar */}
      <rect x="16" y="390" width="204" height="36" rx="10" fill="#f0f9ff" stroke="#bae6fd" strokeWidth="1" />
      <text x="118" y="412" textAnchor="middle" fill="#0369a1" fontSize="11.5" fontFamily="Inter, sans-serif" fontWeight="600">View explanation</text>
      <rect x="232" y="390" width="108" height="36" rx="10" fill="#0f172a" />
      <text x="286" y="412" textAnchor="middle" fill="#ffffff" fontSize="12" fontFamily="Inter, sans-serif" fontWeight="700">Next →</text>
    </svg>
  );
}

const testimonials = [
  {
    name: 'Rahul Sharma',
    location: 'Delhi',
    result: 'Cleared UPSC Prelims 2025',
    quote: 'I used to just read PDFs. Practicing question by question across 10 years showed me what actually repeats — and what the paper never asks twice.',
    before: 44,
    after: 76,
    initials: 'RS',
    bg: '#dbeafe',
    fg: '#1d4ed8',
  },
  {
    name: 'Divya Reddy',
    location: 'Hyderabad',
    result: 'APPSC Group 1 Mains Qualifier',
    quote: 'State commission papers were scattered all over the place. Having APPSC organized year-by-year made my prep feel manageable, not chaotic.',
    before: 51,
    after: 82,
    initials: 'DR',
    bg: '#dcfce7',
    fg: '#16a34a',
  },
  {
    name: 'Karthik M',
    location: 'Chennai',
    result: 'UPSC Prelims 2025 Qualifier',
    quote: 'Timed mock mode changed how I pace myself. I started finishing sections with 10 minutes to spare instead of leaving 8 questions unanswered.',
    before: 38,
    after: 71,
    initials: 'KM',
    bg: '#fef3c7',
    fg: '#d97706',
  },
];

const PREMIUM_PLANS = [
  { label: 'Quarterly', price: '₹499', period: '3 months', note: 'One active prep cycle' },
  { label: 'Semi-Annual', price: '₹899', period: '6 months', note: 'Best balance', popular: true },
  { label: 'Annual', price: '₹1,499', period: '12 months', note: 'Long revision cycles' },
];

export function LandingPage({ onLogin, onContinueGuest, catalogSummary, feedSummary }: LandingPageProps) {
  const [selectedPlan, setSelectedPlan] = useState(1);

  const commissionMap = catalogSummary?.commission_map || {};
  const commissionKeys = Object.keys(commissionMap);
  const totalQ = catalogSummary?.total_questions || feedSummary?.total_questions || 6500;
  const examCount = Object.values(commissionMap).reduce((s, e) => s + Object.keys(e || {}).length, 0) || 36;
  const featuredCommissions = ORDERED_COMMISSIONS.filter(k => commissionKeys.includes(k)).slice(0, 6);
  const displayCommissions = featuredCommissions.length > 0 ? featuredCommissions : ['UPSC', 'APPSC', 'TSPSC', 'APHC', 'TSLPRB', 'SSC'];

  const totalQDisplay = totalQ >= 1000 ? `${(totalQ / 1000).toFixed(1)}k+` : `${totalQ}+`;

  return (
    <div className="landing-shell">

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'rgba(248,250,252,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <div className="landing-header-inner" style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="#0f172a" />
              <path d="M9 22V10l7 4 7-4v12l-7-4z" fill="#5eead4" />
            </svg>
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.04em', color: '#0f172a' }}>Pariksha</span>
          </div>
          <nav className="landing-nav-actions">
            <button
              onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
              style={{ padding: '8px 14px', border: 'none', background: 'none', color: '#475569', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', borderRadius: 8 }}
            >
              Pricing
            </button>
            <button
              onClick={onContinueGuest}
              style={{ padding: '8px 16px', border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', borderRadius: 8 }}
            >
              Try free
            </button>
            <button
              onClick={onLogin}
              style={{ padding: '8px 18px', border: 'none', background: '#0f172a', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7 }}
            >
              Sign in
              <ArrowRight size={13} />
            </button>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 80px' }}>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="landing-hero">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0f766e', marginBottom: 16 }}>
              Previous year questions, made usable
            </div>
            <h1 style={{
              fontSize: 'clamp(38px, 5.5vw, 60px)',
              lineHeight: 1.05,
              letterSpacing: '-0.06em',
              fontWeight: 900,
              color: '#0f172a',
              margin: '0 0 18px',
            }}>
              Practice every PYQ<br />
              <span style={{ color: '#2563eb' }}>the way toppers do.</span>
            </h1>
            <p style={{ fontSize: 17, lineHeight: 1.72, color: '#475569', maxWidth: 480, margin: '0 0 28px' }}>
              Pick your commission, open any paper from 2011 to 2025, and practice question by question — with explanations, bookmarks, and progress tracking.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
              <button
                onClick={onLogin}
                style={{ padding: '14px 22px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 8px 24px rgba(15,23,42,0.18)' }}
              >
                Start practicing free
                <ArrowRight size={15} />
              </button>
              <button
                onClick={onContinueGuest}
                style={{ padding: '14px 22px', background: '#fff', color: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Browse without login
              </button>
            </div>
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
              {[
                { n: totalQDisplay, label: 'questions' },
                { n: `${examCount}+`, label: 'exam tracks' },
                { n: '15+', label: 'years covered' },
                { n: `${displayCommissions.length}`, label: 'commissions' },
              ].map(({ n, label }) => (
                <div key={label}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.04em', lineHeight: 1 }}>{n}</div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            style={{ display: 'flex', justifyContent: 'center' }}
          >
            <div style={{
              background: 'linear-gradient(160deg, #e0f2fe 0%, #f0fdf4 100%)',
              borderRadius: 28,
              padding: '20px 20px 12px',
              boxShadow: '0 24px 64px rgba(15,23,42,0.1)',
              maxWidth: 400,
              width: '100%',
            }}>
              <QuestionCardIllustration />
            </div>
          </motion.div>
        </section>

        {/* ── Commission strip ─────────────────────────────────────────────── */}
        <section style={{ borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '18px 0', marginBottom: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginRight: 4 }}>Covers:</span>
            {displayCommissions.map(c => (
              <span key={c} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 999, fontSize: 12.5, fontWeight: 700, color: '#374151' }}>{c}</span>
            ))}
            {commissionKeys.length > displayCommissions.length && (
              <span style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 600 }}>+{commissionKeys.length - displayCommissions.length} more</span>
            )}
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0f766e', marginBottom: 10 }}>What you get</div>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 900, letterSpacing: '-0.05em', color: '#0f172a', margin: 0 }}>
              One place for all your PYQ practice.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {[
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                  </svg>
                ),
                title: 'Papers organized, not scattered',
                desc: 'Every paper by commission, exam, and year. No more hunting through Google Drive folders or PDFs.',
              },
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                ),
                title: 'Practice mode and timed mock',
                desc: 'Go through questions with explanations at your own pace, or simulate the real exam with a 2-hour timer.',
              },
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18"/><polyline points="7 14 11 10 15 13 21 7"/>
                  </svg>
                ),
                title: 'Track what needs work',
                desc: 'See accuracy by subject and topic. Bookmark hard questions. Come back to them when you revise.',
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} style={{ padding: '24px 22px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18 }}>
                <div style={{ width: 46, height: 46, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  {icon}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: '#475569' }}>{desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Testimonials ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0f766e', marginBottom: 10 }}>Results</div>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 900, letterSpacing: '-0.05em', color: '#0f172a', margin: 0 }}>
              What consistent practice looks like.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {testimonials.map(t => (
              <div key={t.name} style={{ padding: '24px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <p style={{ fontSize: 15, lineHeight: 1.72, color: '#1e293b', margin: 0, fontStyle: 'italic' }}>
                  "{t.quote}"
                </p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar initials={t.initials} bg={t.bg} fg={t.fg} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{t.result}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 3 }}>Accuracy</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>{t.before}%</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>→</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#16a34a' }}>{t.after}%</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────────────── */}
        <section id="pricing" style={{ marginBottom: 72 }}>
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0f766e', marginBottom: 10 }}>Pricing</div>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 900, letterSpacing: '-0.05em', color: '#0f172a', margin: 0 }}>
              Start free. No card needed.
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
            {/* Free */}
            <div style={{ padding: '28px 26px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 12 }}>Free</div>
              <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-0.06em', color: '#0f172a', marginBottom: 4 }}>₹0</div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 22 }}>No account needed to start</div>
              {[
                'Browse all commissions and exams',
                'Open 1 paper per commission',
                'Practice and exam mode on unlocked papers',
                'Track bookmarks and streaks after sign-in',
              ].map(f => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 11 }}>
                  <CheckCircle2 size={15} color="#0f766e" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 14, lineHeight: 1.6, color: '#374151' }}>{f}</span>
                </div>
              ))}
              <button
                onClick={onContinueGuest}
                style={{ marginTop: 20, width: '100%', padding: '13px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 14, fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}
              >
                Start browsing free
              </button>
            </div>

            {/* Pro */}
            <div style={{ padding: '28px 26px', background: '#0f172a', border: 'none', borderRadius: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8' }}>Pro</div>
                <span style={{ padding: '4px 10px', background: '#5eead4', color: '#042f2e', fontSize: 11, fontWeight: 800, borderRadius: 999 }}>LAUNCH PRICING</span>
              </div>
              <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-0.06em', color: '#fff', marginBottom: 4 }}>{PREMIUM_PLANS[selectedPlan].price}</div>
              <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 18 }}>{PREMIUM_PLANS[selectedPlan].period} · {PREMIUM_PLANS[selectedPlan].note}</div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
                {PREMIUM_PLANS.map((p, i) => (
                  <button
                    key={p.label}
                    onClick={() => setSelectedPlan(i)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      background: selectedPlan === i ? '#5eead4' : 'rgba(255,255,255,0.08)',
                      color: selectedPlan === i ? '#042f2e' : '#94a3b8',
                      border: 'none',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {[
                'Full archive — all papers and years',
                'Unlimited practice and mock exams',
                'Bookmarks, insights, leaderboard',
                'Best for year-wise repeat revision',
              ].map(f => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 11 }}>
                  <CheckCircle2 size={15} color="#5eead4" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 14, lineHeight: 1.6, color: '#cbd5e1' }}>{f}</span>
                </div>
              ))}
              <button
                onClick={onLogin}
                style={{ marginTop: 20, width: '100%', padding: '14px', background: '#5eead4', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, color: '#042f2e', cursor: 'pointer' }}
              >
                Get Pro access
              </button>
            </div>
          </div>
        </section>

        {/* ── CTA footer ──────────────────────────────────────────────────── */}
        <section style={{
          padding: '44px 36px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 56%, #0f766e 100%)',
          borderRadius: 28,
          color: '#f8fafc',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 28,
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: 900, letterSpacing: '-0.05em', margin: '0 0 12px', lineHeight: 1.1 }}>
              Stop collecting papers.
              <span style={{ display: 'block', color: '#5eead4' }}>Start practicing through them.</span>
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.72, color: 'rgba(248,250,252,0.72)', margin: 0, maxWidth: 420 }}>
              Free access is enough to understand how it works. Sign in when you're ready to track your progress.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={onLogin}
              style={{ width: '100%', padding: '15px', background: '#5eead4', border: 'none', borderRadius: 14, fontSize: 14.5, fontWeight: 800, color: '#042f2e', cursor: 'pointer' }}
            >
              Continue with Google
            </button>
            <button
              onClick={onContinueGuest}
              style={{ width: '100%', padding: '15px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 14, fontSize: 14.5, fontWeight: 700, color: '#f8fafc', cursor: 'pointer' }}
            >
              Explore without signing in
            </button>
          </div>
        </section>

        <footer style={{ marginTop: 48, paddingTop: 28, borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="#0f172a" />
              <path d="M9 22V10l7 4 7-4v12l-7-4z" fill="#5eead4" />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Pariksha</span>
          </div>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>PYQ practice for Indian government exams</span>
        </footer>
      </main>
    </div>
  );
}
