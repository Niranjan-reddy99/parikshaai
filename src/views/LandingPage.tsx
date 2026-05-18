import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Brain,
  CheckCircle2,
  Clock,
  Layers,
  Play,
  TrendingUp,
} from 'lucide-react';
import type { CatalogSummary, FeedSummary } from '../types';

interface LandingPageProps {
  onLogin: () => void;
  catalogSummary: CatalogSummary | null;
  feedSummary: FeedSummary | null;
}

const ORDERED_COMMISSIONS = ['UPSC', 'APPSC', 'TSPSC', 'APSLPRB', 'TSLPRB', 'SSC'];

const COMMISSION_LABELS: Record<string, string> = {
  UPSC:    'Union Public Service Commission',
  APPSC:   'Andhra Pradesh Public Service Commission',
  TSPSC:   'Telangana State Public Service Commission',
  APSLPRB: 'AP State Level Police Recruitment Board',
  TSLPRB:  'TS State Level Police Recruitment Board',
  SSC:     'Staff Selection Commission',
};

const COMMISSION_COLORS: Record<string, string> = {
  UPSC:    '#1d4ed8',
  APPSC:   '#0f766e',
  TSPSC:   '#7c3aed',
  APSLPRB: '#b45309',
  TSLPRB:  '#dc2626',
  SSC:     '#0369a1',
};

const MARQUEE_ITEMS = [
  'UPSC Prelims', 'UPSC Mains GS', 'APPSC Group I', 'APPSC Group II',
  'TSPSC Group I', 'TSPSC Group II', 'AP Police SI', 'TS Police SI',
  'SSC CGL', 'SSC CHSL', 'AP Panchayat Secretary', 'TS Forest Guard',
];

const FEATURES = [
  {
    icon: <BookOpen size={22} />,
    color: '#1d4ed8',
    bg: 'linear-gradient(135deg,#dbeafe,#e0f2fe)',
    title: 'Real PYQs, not practice sets',
    desc: 'Every question sourced directly from official exam papers — UPSC, APPSC, TSPSC, SSC and police recruitments. No filler, no guesswork.',
  },
  {
    icon: <Brain size={22} />,
    color: '#7c3aed',
    bg: 'linear-gradient(135deg,#ede9fe,#fae8ff)',
    title: 'AI explanation on every question',
    desc: 'Understand WHY each answer is correct — concept, the reasoning, and exactly which trap is built into the question.',
  },
  {
    icon: <BarChart3 size={22} />,
    color: '#0f766e',
    bg: 'linear-gradient(135deg,#ccfbf1,#d1fae5)',
    title: 'Track weak subjects, not just scores',
    desc: 'Accuracy broken down by subject and topic tells you exactly where your next study hour should go.',
  },
  {
    icon: <Clock size={22} />,
    color: '#b45309',
    bg: 'linear-gradient(135deg,#fef3c7,#fed7aa)',
    title: 'Timed mock tests',
    desc: 'Full-length exam simulations with real countdown timer — practice the pressure and format of the actual test.',
  },
  {
    icon: <TrendingUp size={22} />,
    color: '#dc2626',
    bg: 'linear-gradient(135deg,#fee2e2,#fce7f3)',
    title: 'See topic repeat patterns',
    desc: 'Know which subjects UPSC keeps revisiting year after year. Invest study time where it actually counts.',
  },
  {
    icon: <Layers size={22} />,
    color: '#0369a1',
    bg: 'linear-gradient(135deg,#e0f2fe,#dbeafe)',
    title: 'Bookmark and revise',
    desc: 'Save difficult questions with one tap. Build a personal revision list and revisit it any time before the exam.',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Sign in with Google',
    desc: 'One tap, no forms, no credit card. Your progress saves automatically across all your devices.',
  },
  {
    num: '02',
    title: 'Pick your exam and paper',
    desc: 'Choose from UPSC, APPSC, TSPSC, SSC or police papers. Filter by subject or year and jump straight in.',
  },
  {
    num: '03',
    title: 'Practice, analyse, repeat',
    desc: 'Answer, read explanations, track progress — then let weak-area signals guide your next session.',
  },
];

/* ── Decorative / SVG components ── */

function BrandMark({ size = 36, bg = '#10243e' }: { size?: number; bg?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect width="36" height="36" rx="9" fill={bg} />
      <path d="M10 10 L18 16.5 L26 10 L26 26 L18 19.5 L10 26 Z" fill="#14b8a6" />
    </svg>
  );
}

function HeroBg() {
  return (
    <div className="lp-hero-bg" aria-hidden="true">
      <div className="lp-orb lp-orb-1" />
      <div className="lp-orb lp-orb-2" />
      <div className="lp-orb lp-orb-3" />
      <svg className="lp-dot-grid" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
        <defs>
          <pattern id="lp-hero-dot" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="rgba(255,255,255,0.055)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lp-hero-dot)" />
      </svg>
    </div>
  );
}

function SectionWave({ fill }: { fill: string }) {
  return (
    <svg className="lp-wave" viewBox="0 0 1440 56" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,28 C240,56 480,0 720,28 C960,56 1200,0 1440,28 L1440,0 L0,0 Z" fill={fill} />
    </svg>
  );
}

function SectionDecorLine() {
  return (
    <svg width="120" height="6" viewBox="0 0 120 6" fill="none" aria-hidden="true" className="lp-decor-line">
      <path
        d="M0 3 Q15 0 30 3 Q45 6 60 3 Q75 0 90 3 Q105 6 120 3"
        stroke="#14b8a6"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function StepConnector({ animate: shouldAnimate }: { animate: boolean }) {
  return (
    <div className="lp-step-conn" aria-hidden="true">
      <svg viewBox="0 0 80 24" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
        <motion.path
          d="M4 12 H68 M56 4 L70 12 L56 20"
          stroke="rgba(20,184,166,0.5)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={shouldAnimate ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
          transition={{ duration: 0.9, delay: 0.5, ease: 'easeInOut' }}
        />
      </svg>
    </div>
  );
}

function HowBgPattern() {
  return (
    <div className="lp-how-pattern" aria-hidden="true">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="lp-diag" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="40" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lp-diag)" />
      </svg>
    </div>
  );
}

function CtaBgDots() {
  return (
    <div className="lp-cta-bg-pattern" aria-hidden="true">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="lp-cta-dot" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.2" cy="1.2" r="1.2" fill="rgba(255,255,255,0.07)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lp-cta-dot)" />
      </svg>
    </div>
  );
}

function ProductPreview() {
  const options = [
    'Right to Equality',
    'Right to Constitutional Remedies',
    'Right to Life and Liberty',
    'Right to Education',
  ];

  return (
    <div className="lp-preview-card">
      <div className="lp-preview-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="lp-preview-live-dot" />
          <span className="lp-preview-exam">UPSC Prelims 2024</span>
        </div>
        <span className="lp-preview-qnum">Q 23 / 100</span>
      </div>

      <div className="lp-preview-body">
        <div className="lp-tag-row">
          {[['Polity', 'blue'], ['Statement based', 'amber'], ['Medium', 'green']].map(([label, c]) => (
            <span key={label} className={`lp-tag lp-tag-${c}`}>{label}</span>
          ))}
        </div>

        <p className="lp-preview-question">
          Which constitutional remedy is called the 'heart and soul' of the Constitution, according to Dr. B.R. Ambedkar?
        </p>

        <div className="lp-options">
          {options.map((opt, i) => {
            const correct = i === 1;
            return (
              <div key={opt} className={`lp-option ${correct ? 'lp-option-correct' : ''}`}>
                <span className={`lp-option-badge ${correct ? 'lp-option-badge-correct' : ''}`}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="lp-option-text">{opt}</span>
                {correct && <CheckCircle2 size={15} color="#16a34a" style={{ marginLeft: 'auto', flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>

        <div className="lp-preview-stats">
          {[['72%', 'Accuracy'], ['42s', 'Avg pace'], ['6 days', 'Streak']].map(([val, lbl]) => (
            <div key={lbl} className="lp-preview-stat">
              <strong>{val}</strong>
              <span>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main export ── */

export function LandingPage({ onLogin, catalogSummary, feedSummary }: LandingPageProps) {
  const commissionMap = catalogSummary?.commission_map || {};
  const commissionKeys = Object.keys(commissionMap);
  const totalQ = catalogSummary?.total_questions || feedSummary?.total_questions || 9700;
  const examCount = Object.values(commissionMap).reduce((s, e) => s + Object.keys(e || {}).length, 0) || 36;
  const totalQDisplay = totalQ >= 1000 ? `${(totalQ / 1000).toFixed(1)}k+` : `${totalQ}+`;
  const shown = ORDERED_COMMISSIONS.filter((k) => commissionKeys.includes(k));
  const commissions = shown.length > 0 ? shown : ORDERED_COMMISSIONS;

  const stepsRef = useRef<HTMLDivElement>(null);
  const stepsInView = useInView(stepsRef, { once: true, margin: '-80px' });

  const heroVariants = {
    hidden: { opacity: 0, y: 28 },
    show:   { opacity: 1, y: 0 },
  };

  return (
    <div className="lp-shell">

      {/* ── HEADER ── */}
      <header className="lp-header">
        <div className="lp-header-inner">
          <div className="lp-brand" aria-label="Pariksha home">
            <BrandMark size={36} />
            <span className="lp-brand-name">Pariksha</span>
          </div>

          <nav className="lp-nav-desktop" aria-label="Main navigation">
            <a href="#features" className="lp-nav-link">Features</a>
            <a href="#how" className="lp-nav-link">How it works</a>
            <a href="#exams" className="lp-nav-link">Exams</a>
          </nav>

          <button type="button" className="lp-header-cta" onClick={onLogin}>
            Sign in with Google
            <ArrowRight size={15} />
          </button>
        </div>
      </header>

      <main>

        {/* ── HERO ── */}
        <section className="lp-hero">
          <HeroBg />
          <div className="lp-hero-inner">

            {/* Left copy */}
            <motion.div
              className="lp-hero-copy"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            >
              <motion.div
                className="lp-eyebrow"
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.08, duration: 0.4, ease: 'easeOut' }}
              >
                <BookOpenCheck size={14} />
                For UPSC · APPSC · TSPSC · SSC · Police exams
              </motion.div>

              <h1 className="lp-hero-h1">
                <motion.span
                  style={{ display: 'block' }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
                >
                  Practice every question
                </motion.span>
                <motion.span
                  className="lp-hero-h1-accent"
                  style={{ display: 'block' }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.26, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
                >
                  UPSC has ever asked.
                </motion.span>
              </h1>

              <motion.p
                className="lp-hero-p"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38, duration: 0.5 }}
              >
                {totalQDisplay} real previous-year questions from official exam papers — organised by topic, explained by AI, and tracked so you always know exactly what to study next.
              </motion.p>

              <motion.div
                className="lp-hero-actions"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.46, duration: 0.48 }}
              >
                <button type="button" className="lp-btn-primary" onClick={onLogin}>
                  <Play size={17} />
                  Start practicing free
                </button>
                <button type="button" className="lp-btn-ghost" onClick={onLogin}>
                  Browse question bank
                  <ArrowRight size={15} />
                </button>
              </motion.div>

              <motion.div
                className="lp-hero-trust"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.55 }}
              >
                <div className="lp-trust-stat">
                  <strong>{totalQDisplay}</strong>
                  <span>Real PYQs</span>
                </div>
                <div className="lp-trust-sep" aria-hidden="true" />
                <div className="lp-trust-stat">
                  <strong>{examCount}+</strong>
                  <span>Exam papers</span>
                </div>
                <div className="lp-trust-sep" aria-hidden="true" />
                <div className="lp-trust-stat">
                  <strong>{commissions.length}</strong>
                  <span>Commissions</span>
                </div>
              </motion.div>
            </motion.div>

            {/* Right: Preview + satellite cards */}
            <div className="lp-preview-zone">
              {/* Glow ring behind card */}
              <motion.div
                className="lp-preview-glow"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1.2, delay: 0.2 }}
              />

              {/* Main floating card */}
              <motion.div
                style={{ position: 'relative', zIndex: 2 }}
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                <ProductPreview />
              </motion.div>

              {/* AI explanation satellite */}
              <motion.div
                className="lp-satellite lp-satellite-ai"
                initial={{ opacity: 0, x: -28, y: 10 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ delay: 0.9, duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
              >
                <div className="lp-sat-icon lp-sat-purple">
                  <Brain size={14} />
                </div>
                <div className="lp-sat-body">
                  <strong>AI Explanation</strong>
                  <p>Article 32 gives citizens the right to move the SC directly to enforce Fundamental Rights — the most powerful remedy.</p>
                </div>
              </motion.div>

              {/* Streak badge */}
              <motion.div
                className="lp-satellite lp-satellite-streak"
                initial={{ opacity: 0, scale: 0.6, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 1.1, type: 'spring', stiffness: 200, damping: 17 }}
              >
                <div className="lp-streak-ring" aria-hidden="true" />
                <span className="lp-sat-fire" role="img" aria-label="streak fire">🔥</span>
                <div className="lp-sat-body lp-sat-body-sm">
                  <strong>6 day streak</strong>
                  <span>Keep it up!</span>
                </div>
              </motion.div>
            </div>

          </div>
        </section>

        {/* ── MARQUEE COVERAGE STRIP ── */}
        <div className="lp-coverage" role="complementary" aria-label="Covered exams">
          <span className="lp-coverage-label">Covering:</span>
          <div className="lp-marquee-clip" aria-hidden="true">
            <div className="lp-marquee-track">
              {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
                <span key={`${item}-${i}`} className="lp-coverage-pill">
                  <span className="lp-pill-dot" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── FEATURES ── */}
        <section id="features" className="lp-section lp-bg-white">
          <div className="lp-section-inner">
            <motion.div
              className="lp-section-head"
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.48 }}
            >
              <span className="lp-eyebrow lp-eyebrow-green">Why Pariksha</span>
              <h2 className="lp-section-h2">Built for serious exam preparation</h2>
              <SectionDecorLine />
              <p className="lp-section-p" style={{ marginTop: 20 }}>
                Not a video course. Not a random quiz generator. A focused practice workspace for aspirants done with passive studying.
              </p>
            </motion.div>

            <div className="lp-feature-grid">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  className="lp-feature-card"
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-48px' }}
                  transition={{ duration: 0.36, delay: i * 0.07 }}
                  whileHover={{ y: -5, transition: { duration: 0.2 } }}
                >
                  <motion.div
                    className="lp-feature-icon"
                    style={{ background: f.bg, color: f.color }}
                    whileHover={{ scale: 1.12, rotate: 5, transition: { type: 'spring', stiffness: 320, damping: 14 } }}
                  >
                    {f.icon}
                  </motion.div>
                  <h3 className="lp-feature-title">{f.title}</h3>
                  <p className="lp-feature-desc">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how" className="lp-section lp-bg-ink lp-how-wrap">
          <HowBgPattern />
          <div className="lp-section-inner">
            <motion.div
              className="lp-section-head lp-section-head-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45 }}
            >
              <span className="lp-eyebrow lp-eyebrow-teal">How it works</span>
              <h2 className="lp-section-h2 lp-h2-white">From sign-up to scoring in 3 steps</h2>
            </motion.div>

            <div className="lp-steps-row" ref={stepsRef}>
              {STEPS.flatMap((s, i) => {
                const card = (
                  <motion.div
                    key={s.num}
                    className="lp-step"
                    initial={{ opacity: 0, y: 28 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{ duration: 0.4, delay: i * 0.14 }}
                  >
                    <div className="lp-step-num-wrap">
                      <span className="lp-step-num">{s.num}</span>
                    </div>
                    <h3 className="lp-step-title">{s.title}</h3>
                    <p className="lp-step-desc">{s.desc}</p>
                  </motion.div>
                );
                if (i < STEPS.length - 1) {
                  return [card, <StepConnector key={`conn-${i}`} animate={stepsInView} />];
                }
                return [card];
              })}
            </div>
          </div>
        </section>

        {/* ── EXAM COVERAGE ── */}
        <section id="exams" className="lp-section lp-bg-white">
          <div className="lp-section-inner">
            <motion.div
              className="lp-section-head lp-section-head-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45 }}
            >
              <span className="lp-eyebrow lp-eyebrow-green">Exam coverage</span>
              <h2 className="lp-section-h2">One platform for every major exam</h2>
              <p className="lp-section-p" style={{ marginTop: 14 }}>
                Papers from {examCount}+ official exams across civil services, state PSCs, police recruitment and central government selections.
              </p>
            </motion.div>

            <div className="lp-commission-grid">
              {commissions.map((key, i) => (
                <motion.div
                  key={key}
                  className="lp-commission-card"
                  style={{ '--comm-color': COMMISSION_COLORS[key] || '#10243e' } as React.CSSProperties}
                  initial={{ opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.36, delay: i * 0.07 }}
                  whileHover={{ y: -5, transition: { duration: 0.2 } }}
                >
                  <div
                    className="lp-commission-badge"
                    style={{ background: COMMISSION_COLORS[key] || '#10243e' }}
                  >
                    {key[0]}
                  </div>
                  <div className="lp-commission-abbr">{key}</div>
                  <div className="lp-commission-name">{COMMISSION_LABELS[key] || key}</div>
                  {commissionMap[key] && (
                    <div className="lp-commission-count">
                      {Object.keys(commissionMap[key] || {}).length} papers
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section className="lp-cta-section">
          <SectionWave fill="#ffffff" />
          <CtaBgDots />
          <div className="lp-cta-inner">
            <motion.div
              className="lp-cta-copy"
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45 }}
            >
              <h2 className="lp-cta-h2">Ready to practice smarter?</h2>
              <p className="lp-cta-p">
                Free to start. No credit card. Sign in with Google and begin your first practice session in under a minute.
              </p>
            </motion.div>

            <motion.button
              type="button"
              className="lp-cta-btn"
              onClick={onLogin}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.12 }}
              whileHover={{ scale: 1.04, transition: { duration: 0.15 } }}
              whileTap={{ scale: 0.97 }}
            >
              Continue with Google
              <ArrowRight size={16} />
            </motion.button>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-brand lp-brand-footer" aria-label="Pariksha">
            <BrandMark size={28} bg="#1e2d42" />
            <span className="lp-brand-name lp-brand-name-sm">Pariksha</span>
          </div>
          <p className="lp-footer-p">The focused PYQ practice platform for UPSC and state exam aspirants.</p>
        </div>
      </footer>

    </div>
  );
}
