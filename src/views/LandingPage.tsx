import { useRef, useState, useEffect } from 'react';
import { motion, useInView, AnimatePresence } from 'motion/react';
import {
  ArrowRight, BarChart3, BookOpenCheck, Brain, CheckCircle2,
  Clock, Moon, ShieldCheck, Sparkles, Sun, TrendingUp, XCircle, Zap,
} from 'lucide-react';
import type { CatalogSummary, FeedSummary } from '../types';

interface LandingPageProps {
  onLogin: () => void;
  onUpgrade: () => void;
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
  { icon: <ShieldCheck size={22} />, color: '#3b82f6', title: 'Official papers only', desc: 'Every question sourced directly from published official exam papers. Zero generated content, zero filler — ever.' },
  { icon: <Brain size={22} />, color: '#8b5cf6', title: 'Pattern Intelligence', desc: 'Each question tagged with its frame, trap, and skill needed — so you know HOW to solve it, not just the answer.' },
  { icon: <Sparkles size={22} />, color: '#14b8a6', title: 'AI explanations on demand', desc: 'Detailed AI reasoning for why each option is right or wrong, with a specific solve hint tailored to the question type.' },
  { icon: <BarChart3 size={22} />, color: '#f59e0b', title: 'Weakness tracking by topic', desc: 'Auto analysis of where you\'re losing marks — down to subtopic level — so every session targets the right gaps.' },
  { icon: <Clock size={22} />, color: '#ef4444', title: 'Timed mock test mode', desc: 'Full-length timed simulations with the actual question mix from any past paper. Builds exam temperament, not just knowledge.' },
  { icon: <TrendingUp size={22} />, color: '#10b981', title: 'Year-by-year trend analysis', desc: 'See which topics your exam has repeated across years, which are new, and exactly where the examiner\'s focus is shifting.' },
];

const STEPS = [
  { num: '01', icon: '🎯', title: 'Pick your exam', desc: 'Choose from UPSC, APPSC, TSPSC, SSC, APSLPRB, TSLPRB and more. New papers added regularly — your bank grows automatically.' },
  { num: '02', icon: '📚', title: 'Practice real PYQs', desc: 'Work through actual past questions organised by subject and topic. Each shows the exact year and paper it appeared in.' },
  { num: '03', icon: '📊', title: 'Fix weak areas', desc: 'Your dashboard shows which patterns you struggle with and which topics need attention — updated after every session.' },
];

const PROBLEMS = [
  'Practise random MCQs that never appeared in actual official papers',
  'Have no idea which topics are high-priority vs rarely tested',
  'Get "correct answer" without understanding why they got it wrong',
  'Can\'t tell if they\'re improving or just getting lucky on familiar questions',
];

const SOLUTIONS = [
  'Practice only questions from actual official papers — every year, every commission',
  'See exactly which topics your exam tests most, with year-by-year frequency data',
  'Get AI explanations + trap alerts that explain the examiner\'s exact trick',
  'Track accuracy by topic, pattern type, and across time — no guesswork',
];

const PRICING_FEATURES = [
  '9,700+ questions from official papers (growing)',
  'All current commissions — UPSC, APPSC, TSPSC, SSC, APSLPRB, TSLPRB',
  'AI explanation on every question',
  'Pattern intelligence tags (pattern, trap, skill)',
  'Topic-wise accuracy tracking',
  'Timed mock test mode',
  'New exams and papers added as they\'re released',
];

const MARQUEE_ITEMS = [
  'UPSC Prelims GS', 'UPSC CAPF', 'UPSC CDS', 'APPSC Group I',
  'APPSC Group II', 'TSPSC Group I', 'TSPSC Group II',
  'AP Police SI Mains', 'TS Police SI Mains', 'SSC CGL',
  'APPSC Forest SO', 'APPSC AEE', 'TSPSC AEE', 'TSPSC DAO',
  'APPSC EO Grade 3', 'UPSC NDA GS', 'AP High Court',
];

const FAQ_ITEMS = [
  { q: 'Is this only for UPSC aspirants?', a: 'Not at all. ParikshaGPT covers UPSC, APPSC, TSPSC, SSC, APSLPRB, TSLPRB and more. We add new commissions and papers as they\'re released — your subscription includes everything, current and future.' },
  { q: 'Which exams are currently available?', a: 'UPSC (Prelims GS, CAPF, CDS, NDA), APPSC (Group I, II, AEE, Forest SO, EO, Agriculture Officer), TSPSC (Group I, II, III, AEE, DAO, TPBO), SSC (CGL), APSLPRB (SI Mains), TSLPRB (SI Mains, Prelims), AP High Court and several more. The list keeps growing.' },
  { q: 'Are these real official questions or AI-generated?', a: 'Every question is sourced directly from published official exam papers. We never generate or simulate questions. AI is only used for explanations and pattern tagging — the questions themselves are 100% official.' },
  { q: 'What is "Pattern Intelligence" and why does it matter?', a: 'Each question is tagged with three layers: the question frame (e.g. statement-based, assertion-reason), the examiner\'s trap (e.g. absolute wording, negation), and the cognitive skill you need to solve it. This tells you HOW to approach a question type — not just whether your answer was right or wrong.' },
  { q: 'How is ParikshaGPT different from other PYQ apps?', a: 'Most PYQ apps show questions and answers. ParikshaGPT adds AI explanations for every question, pattern tags that decode examiner tricks, topic-level accuracy tracking, timed mock tests with the actual paper\'s question mix, and coverage across multiple state commissions — not just UPSC.' },
  { q: 'Will new papers be added during my subscription?', a: 'Yes. Every new official paper we add is immediately available to all subscribers at no extra charge. There are no per-exam fees ever.' },
  { q: 'Is there a free trial?', a: 'Yes — you can explore the app without entering any payment details. Questions you answer during the trial are saved and carry over when you subscribe.' },
  { q: 'Can I install this as an app on my phone or desktop?', a: 'Yes. ParikshaGPT is a Progressive Web App (PWA). After logging in you\'ll see an "Install App" option. Once installed it opens like a native app, loads faster, and works with poor connectivity. No app store needed.' },
];

// ── SVG Components ──────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <img src="/pwa-192x192.png" alt="" width="30" height="30" aria-hidden />
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
            <circle cx="1" cy="1" r="1" fill="var(--lp-dot-fill)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lp2-dot)" />
      </svg>
    </div>
  );
}

// ── Animated count-up ───────────────────────────────────────────────────────

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const duration = 1600;
    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * to));
      if (progress < 1) requestAnimationFrame(frame);
      else setCount(to);
    };
    requestAnimationFrame(frame);
  }, [inView, to]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// ── Interactive hero demo question ─────────────────────────────────────────

function HeroDemoCard({ onLogin }: { onLogin: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const correct = 'C';
  const revealed = selected !== null;

  const opts = [
    { key: 'A', text: '1 only' },
    { key: 'B', text: '2 only' },
    { key: 'C', text: 'Both 1 and 2' },
    { key: 'D', text: 'Neither 1 nor 2' },
  ];

  return (
    <div className="lp2-demo-card">
      {/* Header */}
      <div className="lp2-demo-header">
        <span className="lp2-demo-badge lp2-demo-badge-blue">UPSC Prelims 2023</span>
        <span className="lp2-demo-badge lp2-demo-badge-purple">History · Q.14</span>
        {!revealed && <span className="lp2-demo-live-pill"><span className="lp2-live-dot" />Try it</span>}
      </div>

      {/* Question */}
      <p className="lp2-demo-q">
        Consider the following statements regarding the Regulating Act of 1773:
      </p>
      <div className="lp2-demo-stmts">
        <div className="lp2-demo-stmt"><span>1.</span> It was the first step taken by British Parliament to control the East India Company.</div>
        <div className="lp2-demo-stmt"><span>2.</span> It established a Supreme Court at Calcutta.</div>
      </div>
      <p className="lp2-demo-stem">Which of the statements given above is/are correct?</p>

      {/* Options */}
      <div className="lp2-demo-opts">
        {opts.map(o => {
          const isCorrect = o.key === correct;
          const isSelected = selected === o.key;
          let cls = 'lp2-demo-opt';
          if (revealed) cls += isCorrect ? ' lp2-demo-opt-correct' : isSelected ? ' lp2-demo-opt-wrong' : ' lp2-demo-opt-dim';
          return (
            <button key={o.key} className={cls} onClick={() => !revealed && setSelected(o.key)}>
              <span className="lp2-demo-key">{o.key}</span>
              <span className="lp2-demo-opt-text">{o.text}</span>
              {revealed && isCorrect && <CheckCircle2 size={14} className="lp2-demo-result-icon" />}
              {revealed && isSelected && !isCorrect && <XCircle size={14} className="lp2-demo-result-icon lp2-demo-result-wrong" />}
            </button>
          );
        })}
      </div>

      {/* Explanation reveal */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            key="exp"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            className="lp2-demo-exp"
          >
            <Sparkles size={13} className="lp2-demo-exp-icon" />
            <span>Both are correct. The Regulating Act 1773 was the first parliamentary intervention into Company affairs and established India's first Supreme Court at Calcutta.</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pattern tags */}
      {revealed && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="lp2-demo-tags">
          <span className="lp2-mock-ptag lp2-mock-ptag-teal">statement-based</span>
          <span className="lp2-mock-ptag lp2-mock-ptag-amber">elimination</span>
          <span className="lp2-mock-ptag lp2-mock-ptag-blue">is/are trap</span>
        </motion.div>
      )}

      {/* Footer */}
      <div className="lp2-demo-footer">
        {!revealed
          ? <span className="lp2-demo-hint-text">← Select an option to see the answer & explanation</span>
          : (
            <motion.button
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="lp2-demo-unlock-btn"
              onClick={onLogin}
            >
              Practice 9,700+ questions like this <ArrowRight size={14} />
            </motion.button>
          )
        }
      </div>
    </div>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────────

function FaqList() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {FAQ_ITEMS.map((item, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-30px' }}
          transition={{ duration: 0.35, delay: i * 0.04 }}
          style={{
            borderRadius: 12,
            border: `1px solid ${open === i ? 'rgba(20,184,166,0.4)' : 'var(--lp-border-card)'}`,
            background: open === i ? 'var(--lp-faq-bg-open)' : 'var(--lp-card-bg)',
            overflow: 'hidden',
            transition: 'border-color 0.2s, background 0.2s',
            boxShadow: open === i ? '0 0 0 3px rgba(20,184,166,0.06)' : 'none',
          }}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{
              width: '100%', textAlign: 'left', background: 'none', border: 'none',
              padding: '16px 20px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--lp-text-1)', lineHeight: 1.45 }}>
              {item.q}
            </span>
            <span style={{
              flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
              background: open === i ? 'rgba(20,184,166,0.15)' : 'var(--lp-faq-icon-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: open === i ? '#14b8a6' : 'var(--lp-text-4)',
              fontSize: 18, fontWeight: 300, lineHeight: 1,
              transition: 'all 0.22s',
              transform: open === i ? 'rotate(45deg)' : 'none',
            }}>+</span>
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ padding: '0 20px 18px', fontSize: 13.5, color: 'var(--lp-text-3)', lineHeight: 1.75 }}>
                  {item.a}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function LandingPage({ onLogin, onUpgrade, catalogSummary }: LandingPageProps) {
  const totalQuestions = catalogSummary?.total_questions ?? 9736;
  const commissionMap = catalogSummary?.commission_map ?? {};

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return (localStorage.getItem('lp-theme') as 'light' | 'dark') || 'light'; } catch { return 'light'; }
  });
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem('lp-theme', next); } catch { /* ignore */ }
  };

  const stepsRef = useRef<HTMLDivElement>(null);
  const stepsInView = useInView(stepsRef, { once: true, margin: '-60px' });
  const pricingRef = useRef<HTMLDivElement>(null);
  const pricingInView = useInView(pricingRef, { once: true, margin: '-60px' });

  return (
    <div className="lp2-shell" data-theme={theme}>

      {/* ── Navbar ── */}
      <header className="lp2-header">
        <div className="lp2-header-inner">
          <a href="#" className="lp2-brand">
            <LogoMark />
            <span className="lp2-brand-name">Pariksha<span className="lp2-brand-dot">GPT</span></span>
          </a>
          <nav className="lp2-nav">
            <a href="#features" className="lp2-nav-link">Features</a>
            <a href="#how" className="lp2-nav-link">How it works</a>
            <a href="#pricing" className="lp2-nav-link">Pricing</a>
          </nav>
          <div className="lp2-header-actions">
            <button className="lp2-btn-icon-sm" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <button className="lp2-btn-ghost-sm" onClick={onLogin}>Sign in</button>
            <button className="lp2-btn-primary-sm" onClick={onLogin}>Get started free</button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="lp2-hero">
        <HeroBg />
        <div className="lp2-hero-inner">

          {/* Left: text */}
          <motion.div
            className="lp2-hero-text"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="lp2-eyebrow">
              <span className="lp2-eyebrow-dot" />
              India's only multi-commission PYQ intelligence platform
            </div>

            <h1 className="lp2-h1">
              Every official PYQ —{' '}
              <span className="lp2-h1-accent">analysed, explained</span>
              {' '}and tracked.
            </h1>

            <p className="lp2-hero-p">
              {totalQuestions.toLocaleString()}+ real questions from official exam papers.
              AI explanations on every question. Covers UPSC, APPSC, TSPSC, SSC, APSLPRB, TSLPRB
              — with more exams added as they're released.
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
              <a href="#pricing" className="lp2-btn-ghost">View pricing</a>
            </div>

            <div className="lp2-trust-row">
              {['No credit card required', 'Official papers only', 'Cancel anytime'].map(t => (
                <div key={t} className="lp2-trust-item">
                  <CheckCircle2 size={12} color="#14b8a6" />
                  {t}
                </div>
              ))}
            </div>

            {/* Mini stat row under trust badges */}
            <div className="lp2-hero-stats-mini">
              <div className="lp2-hero-stat-mini">
                <span className="lp2-hero-stat-mini-num">{Math.floor(totalQuestions / 1000)}k+</span>
                <span className="lp2-hero-stat-mini-label">Official PYQs</span>
              </div>
              <div className="lp2-hero-stat-sep" />
              <div className="lp2-hero-stat-mini">
                <span className="lp2-hero-stat-mini-num">6+</span>
                <span className="lp2-hero-stat-mini-label">Commissions</span>
              </div>
              <div className="lp2-hero-stat-sep" />
              <div className="lp2-hero-stat-mini">
                <span className="lp2-hero-stat-mini-num">15+</span>
                <span className="lp2-hero-stat-mini-label">Years of papers</span>
              </div>
            </div>
          </motion.div>

          {/* Right: interactive demo */}
          <motion.div
            className="lp2-hero-visual"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="lp2-hero-glow" />
            <HeroDemoCard onLogin={onLogin} />
          </motion.div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div className="lp2-stats-bar">
        {[
          { to: Math.floor(totalQuestions / 100) * 100, suffix: '+', label: 'Official PYQs' },
          { to: 6, suffix: '+',  label: 'Commissions & growing' },
          { to: 15, suffix: '+', label: 'Years of papers' },
          { to: 22, suffix: '',  label: 'Pattern types tagged' },
        ].map((s, i) => (
          <div key={i} className="lp2-stat">
            <div className="lp2-stat-num"><CountUp to={s.to} suffix={s.suffix} /></div>
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
              Most aspirants spend hundreds of hours on questions the examiner never asked,
              from topics that haven't appeared in a decade — for the wrong exam entirely.
            </p>
          </div>

          <div className="lp2-comparison-grid">
            <motion.div
              className="lp2-comparison-col lp2-comparison-bad"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.5 }}
            >
              <div className="lp2-comparison-header">
                <XCircle size={16} color="#ef4444" />
                <span>What most aspirants do</span>
              </div>
              {PROBLEMS.map((p, i) => (
                <div key={i} className="lp2-comparison-item lp2-comparison-item-bad">
                  <XCircle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                  {p}
                </div>
              ))}
            </motion.div>

            <motion.div
              className="lp2-comparison-col lp2-comparison-good"
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <div className="lp2-comparison-header">
                <CheckCircle2 size={16} color="#14b8a6" />
                <span>What ParikshaGPT enables</span>
              </div>
              {SOLUTIONS.map((s, i) => (
                <div key={i} className="lp2-comparison-item lp2-comparison-item-good">
                  <CheckCircle2 size={13} color="#14b8a6" style={{ flexShrink: 0, marginTop: 2 }} />
                  {s}
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Pattern Intelligence ── */}
      <section className="lp2-section">
        <div className="lp2-section-inner">
          <div className="lp2-pattern-grid">
            <div className="lp2-pattern-text">
              <div className="lp2-eyebrow">Unique to ParikshaGPT</div>
              <h2 className="lp2-h2 lp2-h2-left">Pattern Intelligence — know HOW to solve it</h2>
              <p className="lp2-section-p lp2-section-p-left">
                Every question is classified with three layers of intelligence. Not just "statement-based"
                — but what trap the examiner set, what cognitive skill you need, and a specific solve hint.
                No other platform does this.
              </p>
              <div className="lp2-pattern-tag-explain">
                {[
                  { label: 'Pattern tag', ex: 'statement-based', color: '#14b8a6', desc: 'How the question is framed' },
                  { label: 'Trap tag',    ex: 'negation',         color: '#f59e0b', desc: "The examiner's trick to watch for" },
                  { label: 'Skill tag',   ex: 'elimination',      color: '#3b82f6', desc: 'The cognitive skill required' },
                ].map((t, i) => (
                  <div key={i} className="lp2-pattern-tag-row">
                    <span className="lp2-pattern-badge" style={{ background: t.color + '20', color: t.color }}>{t.ex}</span>
                    <div>
                      <div className="lp2-pattern-tag-label">{t.label}</div>
                      <div className="lp2-pattern-tag-desc">{t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <motion.div
              className="lp2-pattern-demo"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6 }}
            >
              <div className="lp2-pd-meta"><span className="lp2-pd-exam">UPSC Prelims 2022 · Economy · Q.7</span></div>
              <p className="lp2-pd-q">With reference to the Indian economy, consider the following statements:</p>
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
                <span className="lp2-pd-tag lp2-pd-tag-teal">statement-based</span>
                <span className="lp2-pd-tag lp2-pd-tag-amber">absolute-wording</span>
                <span className="lp2-pd-tag lp2-pd-tag-blue">elimination</span>
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
            <h2 className="lp2-h2">Built for serious government exam aspirants</h2>
            <p className="lp2-section-p">Not a generic quiz app. Every feature is designed around how official examiners actually test — across every commission we cover.</p>
          </div>
          <div className="lp2-features-grid">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                className="lp2-feature-card"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
                whileHover={{ y: -5, transition: { duration: 0.2 } }}
              >
                <div className="lp2-feature-icon-wrap" style={{ background: f.color + '15', borderColor: f.color + '30' }}>
                  <div style={{ color: f.color }}>{f.icon}</div>
                </div>
                <h3 className="lp2-feature-title">{f.title}</h3>
                <p className="lp2-feature-desc">{f.desc}</p>
                <div className="lp2-feature-accent-line" style={{ background: f.color }} />
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
            <h2 className="lp2-h2">One subscription. Every commission. Keeps growing.</h2>
            <p className="lp2-section-p">No per-exam fees. No subject restrictions. Access every paper we have, and every new exam added in the future.</p>
          </div>
          <div className="lp2-commission-grid">
            {COMMISSIONS.map((c, i) => {
              const rawCount = Object.entries(commissionMap).find(([k]) => k.toUpperCase().startsWith(c.key))?.[1];
              const count = typeof rawCount === 'number' ? rawCount : 0;
              return (
                <motion.div
                  key={c.key}
                  className="lp2-commission-card"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, delay: i * 0.07 }}
                  style={{ '--c-color': c.color } as React.CSSProperties}
                >
                  <div className="lp2-commission-accent" style={{ background: c.color }} />
                  <div className="lp2-commission-logo" style={{ background: c.bg, color: c.color }}>
                    {c.label}
                  </div>
                  <div className="lp2-commission-abbr" style={{ color: c.color }}>{c.label}</div>
                  <div className="lp2-commission-full">{c.full}</div>
                  {count > 0 && (
                    <div className="lp2-commission-count">
                      {count.toLocaleString()}+ questions
                    </div>
                  )}
                </motion.div>
              );
            })}
            <motion.div
              className="lp2-commission-card"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: COMMISSIONS.length * 0.07 }}
              style={{ '--c-color': '#94a3b8', opacity: 0.65 } as React.CSSProperties}
            >
              <div className="lp2-commission-accent" style={{ background: '#94a3b8' }} />
              <div className="lp2-commission-logo" style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>+</div>
              <div className="lp2-commission-abbr" style={{ color: 'var(--lp-text-3)' }}>More</div>
              <div className="lp2-commission-full">More commissions and exams being added continuously</div>
              <div className="lp2-commission-count" style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>All included</div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="lp2-section lp2-section-alt" id="how">
        <div className="lp2-section-inner">
          <div className="lp2-section-head">
            <div className="lp2-eyebrow">How it works</div>
            <h2 className="lp2-h2">Pick your exam. Start practising. See results.</h2>
          </div>
          <div className="lp2-steps-grid" ref={stepsRef}>
            {STEPS.map((s, i) => (
              <motion.div
                key={i}
                className="lp2-step"
                initial={{ opacity: 0, y: 24 }}
                animate={stepsInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.15 }}
              >
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className="lp2-step-connector">
                    <svg width="100%" height="2" viewBox="0 0 100 2" preserveAspectRatio="none">
                      <line x1="0" y1="1" x2="100" y2="1" stroke="var(--lp-step-line)" strokeWidth="1.5" strokeDasharray="4 3" />
                    </svg>
                    <ArrowRight size={14} className="lp2-step-arrow" />
                  </div>
                )}
                <div className="lp2-step-icon-wrap">
                  <span className="lp2-step-emoji">{s.icon}</span>
                </div>
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
            <motion.div className="lp2-pricing-card"
              initial={{ opacity: 0, y: 28 }} animate={pricingInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 }}>
              <div className="lp2-plan-label">6 Months</div>
              <div className="lp2-plan-price">
                <span className="lp2-plan-currency">₹</span>
                <span className="lp2-plan-amount">499</span>
              </div>
              <div className="lp2-plan-per">₹83 / month · billed once</div>
              <button className="lp2-plan-cta lp2-plan-cta-ghost" onClick={onUpgrade}>Get started</button>
              <div className="lp2-plan-divider" />
              <ul className="lp2-plan-features">
                {PRICING_FEATURES.map((f, i) => (
                  <li key={i} className="lp2-plan-feature">
                    <CheckCircle2 size={13} color="#14b8a6" style={{ flexShrink: 0 }} />{f}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div className="lp2-pricing-card lp2-pricing-card-featured"
              initial={{ opacity: 0, y: 28 }} animate={pricingInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.2 }}>
              <div className="lp2-plan-best-badge">Best Value · Save ₹99</div>
              <div className="lp2-plan-label lp2-plan-label-white">Annual</div>
              <div className="lp2-plan-price">
                <span className="lp2-plan-currency">₹</span>
                <span className="lp2-plan-amount">899</span>
              </div>
              <div className="lp2-plan-per">₹75 / month · billed once a year</div>
              <button className="lp2-plan-cta lp2-plan-cta-primary" onClick={onUpgrade}>
                Get best value <ArrowRight size={15} />
              </button>
              <div className="lp2-plan-divider lp2-plan-divider-white" />
              <ul className="lp2-plan-features">
                {PRICING_FEATURES.map((f, i) => (
                  <li key={i} className="lp2-plan-feature lp2-plan-feature-white">
                    <CheckCircle2 size={13} color="#2dd4bf" style={{ flexShrink: 0 }} />{f}
                  </li>
                ))}
                <li className="lp2-plan-feature lp2-plan-feature-white">
                  <CheckCircle2 size={13} color="#2dd4bf" style={{ flexShrink: 0 }} />
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

      {/* ── FAQ ── */}
      <section className="lp2-section lp2-section-alt" id="faq">
        <div className="lp2-section-inner">
          <div className="lp2-section-head">
            <div className="lp2-eyebrow">FAQ</div>
            <h2 className="lp2-h2">Frequently Asked Questions</h2>
            <p className="lp2-section-p">Everything you need to know before you start.</p>
          </div>
          <FaqList />
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="lp2-cta-section">
        {/* Decorative SVG arc */}
        <svg className="lp2-cta-arc" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden>
          <path d="M0,60 C360,110 1080,10 1440,60 L1440,0 L0,0 Z" fill="var(--lp-bg-alt)" />
        </svg>
        <div className="lp2-cta-inner">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            style={{ textAlign: 'center' }}
          >
            {/* Shield icon */}
            <div className="lp2-cta-icon">
              <BookOpenCheck size={32} color="#14b8a6" />
            </div>
            <h2 className="lp2-cta-h2">
              Stop practising blind.<br />
              <span className="lp2-h1-accent">Start practising what actually appeared.</span>
            </h2>
            <p className="lp2-cta-p">
              Every minute spent on questions your exam never asked is a minute wasted.
              Real papers. Real patterns. Every commission.
            </p>
            <motion.button
              className="lp2-btn-primary lp2-btn-primary-lg"
              onClick={onLogin}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
            >
              Start your free trial <ArrowRight size={18} />
            </motion.button>
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--lp-text-4)' }}>
              No credit card · Cancel anytime · Free questions saved automatically
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp2-footer">
        <div className="lp2-footer-inner">
          <div className="lp2-footer-brand">
            <LogoMark />
            <span className="lp2-brand-name" style={{ fontSize: 13 }}>ParikshaGPT</span>
          </div>
          <p className="lp2-footer-p">
            © {new Date().getFullYear()} ParikshaGPT. Real PYQs, AI intelligence — UPSC, APPSC, TSPSC, SSC and growing.
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
