import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import {
  ArrowRight, BarChart3, BookOpenCheck, Brain, CheckCircle2,
  Clock, ShieldCheck, Sparkles, TrendingUp, XCircle, Zap,
} from 'lucide-react';
import type { CatalogSummary, FeedSummary } from '../types';

interface LandingPageProps {
  onLogin: () => void;
  catalogSummary: CatalogSummary | null;
  feedSummary: FeedSummary | null;
}

const COMMISSIONS = [
  { key: 'UPSC',    label: 'UPSC',    full: 'Union Public Service Commission',          color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  { key: 'APPSC',   label: 'APPSC',   full: 'AP Public Service Commission',              color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  { key: 'TSPSC',   label: 'TSPSC',   full: 'Telangana State PSC',                       color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  { key: 'APSLPRB', label: 'APSLPRB', full: 'AP State Level Police Recruitment Board',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { key: 'TSLPRB',  label: 'TSLPRB',  full: 'TS State Level Police Recruitment Board',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  { key: 'SSC',     label: 'SSC',     full: 'Staff Selection Commission',                color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
];

const FEATURES = [
  {
    icon: <ShieldCheck size={20} />,
    color: '#3b82f6',
    title: 'Official papers only',
    desc: 'Every single question sourced directly from published official exam papers. Zero generated content, zero filler.',
  },
  {
    icon: <Brain size={20} />,
    color: '#8b5cf6',
    title: 'Pattern Intelligence',
    desc: 'Each question is tagged with its frame (statement-based, assertion-reason), trap (negation, absolute wording), and skill needed — so you know HOW to solve it, not just the answer.',
  },
  {
    icon: <Sparkles size={20} />,
    color: '#14b8a6',
    title: 'AI explanations on every question',
    desc: 'Detailed AI reasoning for why each option is right or wrong, with a specific solve hint tailored to the question type.',
  },
  {
    icon: <BarChart3 size={20} />,
    color: '#f59e0b',
    title: 'Weakness tracking by topic',
    desc: 'Automatic analysis of where you\'re losing marks — down to subtopic level — so your next study session targets the right gaps.',
  },
  {
    icon: <Clock size={20} />,
    color: '#ef4444',
    title: 'Timed mock test mode',
    desc: 'Full-length timed simulations with the actual question mix from any past paper. Builds exam temperament, not just knowledge.',
  },
  {
    icon: <TrendingUp size={20} />,
    color: '#10b981',
    title: 'Year-by-year trend analysis',
    desc: 'See which topics UPSC has repeated across years, which are new additions, and exactly where the examiner\'s focus is shifting.',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Choose your exam & commission',
    desc: 'Pick from UPSC Prelims, APPSC Group I, TSPSC, SSC, or any state police board. Your question bank is filtered instantly.',
  },
  {
    num: '02',
    title: 'Practice real PYQs by topic',
    desc: 'Work through actual past questions organised by subject and topic. Each question shows the exact year and paper it appeared in.',
  },
  {
    num: '03',
    title: 'Track patterns, fix weak areas',
    desc: 'Your dashboard shows which patterns you\'re struggling with and which topics need attention — updated after every session.',
  },
];

const PROBLEMS = [
  'Practise random MCQs that never appeared in actual UPSC papers',
  'Have no idea which topics are high-priority vs rarely tested',
  'Get "correct answer" without understanding why they got it wrong',
  'Can\'t tell if they\'re improving or just getting lucky on familiar questions',
];

const SOLUTIONS = [
  'Practice only questions from actual official papers — every year, every commission',
  'See exactly which topics UPSC tests most, with year-by-year frequency data',
  'Get AI explanations + trap alerts that explain the examiner\'s exact trick',
  'Track accuracy by topic, by pattern type, and across time — no guesswork',
];

const PRICING_FEATURES = [
  '9,700+ questions from official papers',
  'All 6 commissions (UPSC, APPSC, TSPSC, SSC + police boards)',
  'AI explanation on every question',
  'Pattern intelligence tags (pattern, trap, skill)',
  'Topic-wise accuracy tracking',
  'Timed mock test mode',
  'New papers added as they\'re released',
];

const MARQUEE_ITEMS = [
  'UPSC Prelims GS', 'UPSC Mains GS I', 'APPSC Group I',
  'APPSC Group II', 'TSPSC Group I', 'TSPSC Group II',
  'AP Police SI', 'TS Police SI', 'SSC CGL', 'SSC CHSL',
  'APPSC Forest SO', 'AP Panchayat Secretary',
];

// ── SVGs ─────────────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect width="28" height="28" rx="7" fill="rgba(20,184,166,0.18)" />
      <path d="M8 8 L14 13.5 L20 8 L20 20 L14 14.5 L8 20 Z" fill="#14b8a6" />
    </svg>
  );
}

function SectionDivider({ flip = false }: { flip?: boolean }) {
  return (
    <div style={{ lineHeight: 0, transform: flip ? 'scaleX(-1)' : undefined }}>
      <svg viewBox="0 0 1440 32" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%' }}>
        <path d="M0,20 C360,40 1080,0 1440,20 L1440,32 L0,32 Z" fill="rgba(255,255,255,0.03)" />
      </svg>
    </div>
  );
}

function HeroBg() {
  return (
    <div className="lp2-hero-bg" aria-hidden>
      <div className="lp2-orb lp2-orb-1" />
      <div className="lp2-orb lp2-orb-2" />
      <div className="lp2-orb lp2-orb-3" />
      <svg className="lp2-grid-pattern" aria-hidden width="100%" height="100%">
        <defs>
          <pattern id="lp2-dot" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.04)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lp2-dot)" />
      </svg>
    </div>
  );
}

// ── Mock product preview ──────────────────────────────────────────────────────

function ProductMockup({ totalQuestions }: { totalQuestions: number }) {
  return (
    <div className="lp2-mockup-shell">
      {/* Chrome bar */}
      <div className="lp2-mockup-chrome">
        <div className="lp2-mockup-dots">
          <span /><span /><span />
        </div>
        <div className="lp2-mockup-url">pariksha.ai · UPSC Prelims 2023</div>
      </div>

      {/* Question card */}
      <div className="lp2-mockup-body">
        <div className="lp2-mock-q-meta">
          <span className="lp2-mock-tag lp2-mock-tag-blue">UPSC Prelims 2023</span>
          <span className="lp2-mock-tag lp2-mock-tag-purple">History · Q. 14</span>
        </div>
        <p className="lp2-mock-q-text">
          Consider the following statements regarding the Regulating Act of 1773:
          <br /><br />
          1. It was the first step taken by British Parliament to control the East India Company.
          <br />
          2. It established a Supreme Court at Calcutta.
        </p>
        <p className="lp2-mock-q-sub">Which of the above statements is/are correct?</p>
        <div className="lp2-mock-options">
          <div className="lp2-mock-option lp2-mock-option-correct">
            <span className="lp2-mock-opt-label">C</span>
            Both 1 and 2
            <CheckCircle2 size={14} className="lp2-mock-tick" />
          </div>
          {['1 only', '2 only', 'Neither 1 nor 2'].map((o, i) => (
            <div key={i} className="lp2-mock-option">
              <span className="lp2-mock-opt-label">{['A','B','D'][i]}</span>
              {o}
            </div>
          ))}
        </div>

        {/* Pattern tags */}
        <div className="lp2-mock-tags-row">
          <span className="lp2-mock-ptag lp2-mock-ptag-teal">statement-based</span>
          <span className="lp2-mock-ptag lp2-mock-ptag-amber">negation</span>
          <span className="lp2-mock-ptag lp2-mock-ptag-blue">elimination</span>
        </div>

        {/* AI hint */}
        <div className="lp2-mock-hint">
          <Sparkles size={12} />
          Evaluate each statement independently first, then eliminate option codes. Watch the "is/are" — it's asking you to pick BOTH if both are true.
        </div>

        {/* Stats footer */}
        <div className="lp2-mock-footer">
          <span><BookOpenCheck size={11} /> {totalQuestions.toLocaleString()}+ questions</span>
          <span><BarChart3 size={11} /> 6 commissions</span>
          <span><TrendingUp size={11} /> 15+ years</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LandingPage({ onLogin, catalogSummary }: LandingPageProps) {
  const totalQuestions = catalogSummary?.total_questions ?? 9736;
  const commissionMap = catalogSummary?.commission_map ?? {};

  const stepsRef = useRef<HTMLDivElement>(null);
  const stepsInView = useInView(stepsRef, { once: true, margin: '-60px' });
  const pricingRef = useRef<HTMLDivElement>(null);
  const pricingInView = useInView(pricingRef, { once: true, margin: '-60px' });

  return (
    <div className="lp2-shell">

      {/* ── Navbar ── */}
      <header className="lp2-header">
        <div className="lp2-header-inner">
          <a href="#" className="lp2-brand">
            <LogoMark />
            <span className="lp2-brand-name">Pariksha<span className="lp2-brand-dot">.ai</span></span>
          </a>
          <nav className="lp2-nav">
            <a href="#features" className="lp2-nav-link">Features</a>
            <a href="#how" className="lp2-nav-link">How it works</a>
            <a href="#pricing" className="lp2-nav-link">Pricing</a>
          </nav>
          <div className="lp2-header-actions">
            <button className="lp2-btn-ghost-sm" onClick={onLogin}>Sign in</button>
            <button className="lp2-btn-primary-sm" onClick={onLogin}>Get started free</button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="lp2-hero">
        <HeroBg />
        <div className="lp2-hero-inner">
          <motion.div
            className="lp2-hero-text"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="lp2-eyebrow">
              <span className="lp2-eyebrow-dot" />
              India's only PYQ intelligence platform
            </div>

            <h1 className="lp2-h1">
              Every question{' '}
              <span className="lp2-h1-accent">UPSC has ever asked</span>
              {' '}— analysed, explained and tracked.
            </h1>

            <p className="lp2-hero-p">
              {totalQuestions.toLocaleString()}+ real questions from official exam papers. Not generated content.
              AI explanations on every question. Pattern intelligence that reveals exactly how
              examiners think — across UPSC, APPSC, TSPSC, SSC and more.
            </p>

            <div className="lp2-hero-actions">
              <motion.button
                className="lp2-btn-primary"
                onClick={onLogin}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Start free trial <ArrowRight size={16} />
              </motion.button>
              <a href="#pricing" className="lp2-btn-ghost">
                View pricing
              </a>
            </div>

            <div className="lp2-trust-row">
              <div className="lp2-trust-item">
                <CheckCircle2 size={13} color="#14b8a6" />
                No credit card required
              </div>
              <div className="lp2-trust-item">
                <CheckCircle2 size={13} color="#14b8a6" />
                Official papers only
              </div>
              <div className="lp2-trust-item">
                <CheckCircle2 size={13} color="#14b8a6" />
                Cancel anytime
              </div>
            </div>
          </motion.div>

          <motion.div
            className="lp2-hero-visual"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="lp2-hero-glow" />
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ProductMockup totalQuestions={totalQuestions} />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div className="lp2-stats-bar">
        {[
          { num: `${Math.floor(totalQuestions / 100) * 100}+`, label: 'Official PYQs' },
          { num: '6',            label: 'Commissions' },
          { num: '15+',          label: 'Years of papers' },
          { num: '22',           label: 'Pattern types tagged' },
        ].map((s, i) => (
          <div key={i} className="lp2-stat">
            <div className="lp2-stat-num">{s.num}</div>
            <div className="lp2-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Marquee ── */}
      <div className="lp2-marquee-wrap">
        <div className="lp2-marquee-clip">
          <div className="lp2-marquee-track">
            {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
              <span key={i} className="lp2-marquee-item">
                <span className="lp2-marquee-dot" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Problem section ── */}
      <section className="lp2-section lp2-section-alt">
        <div className="lp2-section-inner">
          <div className="lp2-section-head">
            <div className="lp2-eyebrow lp2-eyebrow-amber">The problem</div>
            <h2 className="lp2-h2">Random MCQ practice is why most aspirants fail</h2>
            <p className="lp2-section-p">
              Most aspirants spend hundreds of hours practising questions that UPSC never asked,
              from topics the examiner hasn't touched in a decade.
            </p>
          </div>

          <div className="lp2-comparison-grid">
            {/* Wrong way */}
            <div className="lp2-comparison-col lp2-comparison-bad">
              <div className="lp2-comparison-header">
                <XCircle size={16} color="#ef4444" />
                <span>What most aspirants do</span>
              </div>
              {PROBLEMS.map((p, i) => (
                <div key={i} className="lp2-comparison-item lp2-comparison-item-bad">
                  <XCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                  {p}
                </div>
              ))}
            </div>

            {/* Right way */}
            <div className="lp2-comparison-col lp2-comparison-good">
              <div className="lp2-comparison-header">
                <CheckCircle2 size={16} color="#14b8a6" />
                <span>What Pariksha enables</span>
              </div>
              {SOLUTIONS.map((s, i) => (
                <div key={i} className="lp2-comparison-item lp2-comparison-item-good">
                  <CheckCircle2 size={14} color="#14b8a6" style={{ flexShrink: 0, marginTop: 2 }} />
                  {s}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Pattern Intelligence ── */}
      <section className="lp2-section">
        <div className="lp2-section-inner">
          <div className="lp2-pattern-grid">
            <div className="lp2-pattern-text">
              <div className="lp2-eyebrow">Unique to Pariksha</div>
              <h2 className="lp2-h2 lp2-h2-left">Pattern Intelligence — know HOW to solve it</h2>
              <p className="lp2-section-p lp2-section-p-left">
                Every question is classified with three layers of intelligence. Not just "statement-based"
                — but what trap the examiner set, what cognitive skill you need, and a specific solve hint.
                No other platform does this.
              </p>
              <div className="lp2-pattern-tag-explain">
                {[
                  { label: 'Pattern tag', ex: 'statement-based', color: '#14b8a6', desc: 'How the question is framed' },
                  { label: 'Trap tag',    ex: 'negation',         color: '#f59e0b', desc: 'The examiner\'s trick to watch for' },
                  { label: 'Skill tag',   ex: 'elimination',      color: '#3b82f6', desc: 'The cognitive skill required' },
                ].map((t, i) => (
                  <div key={i} className="lp2-pattern-tag-row">
                    <span className="lp2-pattern-badge" style={{ background: t.color + '20', color: t.color }}>
                      {t.ex}
                    </span>
                    <div>
                      <div className="lp2-pattern-tag-label">{t.label}</div>
                      <div className="lp2-pattern-tag-desc">{t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pattern demo card */}
            <motion.div
              className="lp2-pattern-demo"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6 }}
            >
              <div className="lp2-pd-meta">
                <span className="lp2-pd-exam">UPSC Prelims 2022 · Economy · Q.7</span>
              </div>
              <p className="lp2-pd-q">
                With reference to the Indian economy, consider the following statements:
              </p>
              <p className="lp2-pd-statements">
                1. An increase in Nominal Effective Exchange Rate always indicates currency appreciation.<br />
                2. A decrease in Real Effective Exchange Rate indicates that the country's exports are becoming more expensive.
              </p>
              <p className="lp2-pd-stem">Which of the statements given above is/are correct?</p>
              <div className="lp2-pd-opts">
                {['1 only', '2 only', 'Both 1 and 2', 'Neither 1 nor 2'].map((o, i) => (
                  <div key={i} className={`lp2-pd-opt${i === 3 ? ' lp2-pd-opt-correct' : ''}`}>
                    <span>{['A','B','C','D'][i]}</span> {o}
                    {i === 3 && <CheckCircle2 size={12} />}
                  </div>
                ))}
              </div>
              <div className="lp2-pd-tags">
                <span className="lp2-pd-tag" style={{ background: 'rgba(20,184,166,0.15)', color: '#2dd4bf' }}>statement-based</span>
                <span className="lp2-pd-tag" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>absolute-wording</span>
                <span className="lp2-pd-tag" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>elimination</span>
              </div>
              <div className="lp2-pd-hint">
                <Zap size={12} color="#14b8a6" style={{ flexShrink: 0 }} />
                "Always" is the trap — NEER is nominal and can appreciate or depreciate. Evaluate each statement independently, then the "always" in S1 makes it false.
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="lp2-section lp2-section-alt" id="features">
        <div className="lp2-section-inner">
          <div className="lp2-section-head">
            <div className="lp2-eyebrow">What you get</div>
            <h2 className="lp2-h2">Built for serious UPSC aspirants</h2>
            <p className="lp2-section-p">Not a generic quiz app. Every feature is designed around how UPSC actually tests candidates.</p>
          </div>
          <div className="lp2-features-grid">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                className="lp2-feature-card"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, delay: (i % 3) * 0.08 }}
                whileHover={{ y: -4 }}
              >
                <div className="lp2-feature-icon" style={{ background: f.color + '18', color: f.color }}>
                  {f.icon}
                </div>
                <h3 className="lp2-feature-title">{f.title}</h3>
                <p className="lp2-feature-desc">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Commission coverage ── */}
      <section className="lp2-section">
        <div className="lp2-section-inner">
          <div className="lp2-section-head">
            <div className="lp2-eyebrow">Coverage</div>
            <h2 className="lp2-h2">One subscription. Every commission.</h2>
            <p className="lp2-section-p">No per-exam fees. No subject restrictions. All 6 commissions, every paper, one flat price.</p>
          </div>
          <div className="lp2-commission-grid">
            {COMMISSIONS.map((c, i) => {
              const rawCount = Object.entries(commissionMap)
                .find(([k]) => k.toUpperCase().startsWith(c.key))?.[1];
              const count = typeof rawCount === 'number' ? rawCount : 0;
              return (
                <motion.div
                  key={c.key}
                  className="lp2-commission-card"
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  whileHover={{ y: -3 }}
                  style={{ '--c-color': c.color } as React.CSSProperties}
                >
                  <div className="lp2-commission-accent" style={{ background: c.color }} />
                  <div className="lp2-commission-badge" style={{ background: c.bg, color: c.color }}>{c.label}</div>
                  <div className="lp2-commission-full">{c.full}</div>
                  {count > 0 && (
                    <div className="lp2-commission-count" style={{ color: c.color }}>
                      {count.toLocaleString()} questions
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="lp2-section lp2-section-alt" id="how">
        <div className="lp2-section-inner">
          <div className="lp2-section-head">
            <div className="lp2-eyebrow">How it works</div>
            <h2 className="lp2-h2">Up and running in 2 minutes</h2>
          </div>
          <div className="lp2-steps-grid" ref={stepsRef}>
            {STEPS.map((s, i) => (
              <motion.div
                key={i}
                className="lp2-step"
                initial={{ opacity: 0, y: 24 }}
                animate={stepsInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.14 }}
              >
                <div className="lp2-step-num">{s.num}</div>
                <h3 className="lp2-step-title">{s.title}</h3>
                <p className="lp2-step-desc">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="lp2-section" id="pricing" ref={pricingRef}>
        <div className="lp2-section-inner">
          <div className="lp2-section-head">
            <div className="lp2-eyebrow">Pricing</div>
            <h2 className="lp2-h2">One flat price. Every PYQ. All commissions.</h2>
            <p className="lp2-section-p">No per-exam fees. No subject restrictions. Cancel anytime.</p>
          </div>

          <div className="lp2-pricing-grid">
            {/* 6-month plan */}
            <motion.div
              className="lp2-pricing-card"
              initial={{ opacity: 0, y: 28 }}
              animate={pricingInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <div className="lp2-plan-label">6 Months</div>
              <div className="lp2-plan-price">
                <span className="lp2-plan-currency">₹</span>
                <span className="lp2-plan-amount">499</span>
              </div>
              <div className="lp2-plan-per">₹83 / month · billed once</div>
              <button className="lp2-plan-cta lp2-plan-cta-ghost" onClick={onLogin}>
                Get started
              </button>
              <div className="lp2-plan-divider" />
              <ul className="lp2-plan-features">
                {PRICING_FEATURES.map((f, i) => (
                  <li key={i} className="lp2-plan-feature">
                    <CheckCircle2 size={14} color="#14b8a6" style={{ flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Annual plan */}
            <motion.div
              className="lp2-pricing-card lp2-pricing-card-featured"
              initial={{ opacity: 0, y: 28 }}
              animate={pricingInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.22 }}
            >
              <div className="lp2-plan-best-badge">Best Value · Save ₹99</div>
              <div className="lp2-plan-label lp2-plan-label-white">Annual</div>
              <div className="lp2-plan-price">
                <span className="lp2-plan-currency">₹</span>
                <span className="lp2-plan-amount">899</span>
              </div>
              <div className="lp2-plan-per">₹75 / month · billed once a year</div>
              <button className="lp2-plan-cta lp2-plan-cta-primary" onClick={onLogin}>
                Get best value <ArrowRight size={15} />
              </button>
              <div className="lp2-plan-divider lp2-plan-divider-white" />
              <ul className="lp2-plan-features">
                {PRICING_FEATURES.map((f, i) => (
                  <li key={i} className="lp2-plan-feature lp2-plan-feature-white">
                    <CheckCircle2 size={14} color="#2dd4bf" style={{ flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
                <li className="lp2-plan-feature lp2-plan-feature-white">
                  <CheckCircle2 size={14} color="#2dd4bf" style={{ flexShrink: 0 }} />
                  <strong>Save ₹99 vs 6-month plan</strong>
                </li>
              </ul>
            </motion.div>
          </div>

          <p className="lp2-pricing-note">
            Free trial available — no payment needed to explore. Questions answered before payment are saved.
          </p>
        </div>
      </section>

      <SectionDivider />

      {/* ── Final CTA ── */}
      <section className="lp2-cta-section">
        <div className="lp2-cta-inner">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="lp2-cta-h2">
              Stop practising blind.<br />
              <span className="lp2-h1-accent">Start mastering the actual exam.</span>
            </h2>
            <p className="lp2-cta-p">
              Every minute spent on questions UPSC never asked is a minute wasted.
              Start with what actually appeared.
            </p>
            <motion.button
              className="lp2-btn-primary lp2-btn-primary-lg"
              onClick={onLogin}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
            >
              Start your free trial <ArrowRight size={18} />
            </motion.button>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp2-footer">
        <div className="lp2-footer-inner">
          <div className="lp2-footer-brand">
            <LogoMark />
            <span className="lp2-brand-name" style={{ fontSize: 14 }}>Pariksha.ai</span>
          </div>
          <p className="lp2-footer-p">
            © {new Date().getFullYear()} Pariksha. Real PYQs, AI intelligence — built for serious aspirants.
          </p>
          <div className="lp2-footer-links">
            <a href="#" className="lp2-footer-link">Privacy</a>
            <a href="#" className="lp2-footer-link">Terms</a>
            <a href="#" className="lp2-footer-link">Contact</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
