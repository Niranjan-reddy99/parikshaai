import { motion } from 'motion/react';
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Layers3,
  Play,
  Search,
  Target,
} from 'lucide-react';
import type { CatalogSummary, FeedSummary } from '../types';

interface LandingPageProps {
  onLogin: () => void;
  onContinueGuest: () => void;
  catalogSummary: CatalogSummary | null;
  feedSummary: FeedSummary | null;
}

const ORDERED_COMMISSIONS = ['UPSC', 'APPSC', 'TSPSC', 'APSLPRB', 'TSLPRB', 'SSC'];

const buttonBase: React.CSSProperties = {
  height: 42,
  borderRadius: 8,
  fontSize: 13.5,
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  whiteSpace: 'nowrap',
};

function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: '#10243e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: size * 0.54,
          height: size * 0.36,
          background: '#5eead4',
          clipPath: 'polygon(0 0, 50% 36%, 100% 0, 100% 100%, 50% 64%, 0 100%)',
        }}
      />
    </div>
  );
}

function ProductPreview() {
  const options = ['Directive Principles', 'Fundamental Rights', 'Emergency provisions', 'Federal relations'];

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: 0.08 }}
      style={{
        border: '1px solid #dce4ee',
        borderRadius: 8,
        background: '#ffffff',
        boxShadow: '0 24px 54px rgba(15, 23, 42, 0.12)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minHeight: 44,
          borderBottom: '1px solid #e5edf5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 14px',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: '#16a34a' }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: '#132238' }}>UPSC Prelims 2024</span>
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748b' }}>Q 23 / 100</span>
      </div>

      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {['Polity', 'Statement based', 'Medium'].map((label, index) => (
            <span
              key={label}
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                color: index === 1 ? '#854d0e' : index === 2 ? '#166534' : '#1d4ed8',
                background: index === 1 ? '#fef3c7' : index === 2 ? '#dcfce7' : '#dbeafe',
              }}
            >
              {label}
            </span>
          ))}
        </div>

        <h2 style={{ fontSize: 18, lineHeight: 1.35, fontWeight: 800, color: '#10243e', margin: '0 0 16px' }}>
          Which constitutional remedy is called the heart and soul of the Constitution?
        </h2>

        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {options.map((option, index) => {
            const selected = index === 1;
            return (
              <div
                key={option}
                style={{
                  minHeight: 42,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  borderRadius: 8,
                  border: `1px solid ${selected ? '#86efac' : '#e5edf5'}`,
                  background: selected ? '#f0fdf4' : '#f8fafc',
                  padding: '0 12px',
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 99,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: selected ? '#16a34a' : '#e2e8f0',
                    color: selected ? '#ffffff' : '#475569',
                    fontSize: 11,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {String.fromCharCode(65 + index)}
                </span>
                <span style={{ fontSize: 13, color: selected ? '#166534' : '#334155', fontWeight: selected ? 700 : 600 }}>
                  {option}
                </span>
                {selected && <CheckCircle2 size={16} color="#16a34a" style={{ marginLeft: 'auto' }} />}
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          {[
            { label: 'Accuracy', value: '72%' },
            { label: 'Pace', value: '42s' },
            { label: 'Streak', value: '6d' },
          ].map((item) => (
            <div key={item.label} style={{ border: '1px solid #e5edf5', borderRadius: 8, padding: '10px 8px', background: '#fbfdff' }}>
              <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 3 }}>{item.label}</div>
              <div style={{ fontSize: 16, color: '#10243e', fontWeight: 900 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function LandingPage({ onLogin, onContinueGuest, catalogSummary, feedSummary }: LandingPageProps) {
  const commissionMap = catalogSummary?.commission_map || {};
  const commissionKeys = Object.keys(commissionMap);
  const totalQ = catalogSummary?.total_questions || feedSummary?.total_questions || 6500;
  const examCount = Object.values(commissionMap).reduce((sum, exams) => sum + Object.keys(exams || {}).length, 0) || 36;
  const displayCommissions = ORDERED_COMMISSIONS.filter((key) => commissionKeys.includes(key));
  const shownCommissions = displayCommissions.length > 0 ? displayCommissions : ORDERED_COMMISSIONS;
  const totalQDisplay = totalQ >= 1000 ? `${(totalQ / 1000).toFixed(1)}k+` : `${totalQ}+`;

  return (
    <div className="landing-shell">
      <header className="landing-clean-header">
        <div className="landing-clean-header-inner">
          <button
            type="button"
            onClick={onContinueGuest}
            aria-label="Open Pariksha"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <BrandMark />
            <span style={{ fontSize: 18, fontWeight: 900, color: '#10243e' }}>Pariksha</span>
          </button>

          <div className="landing-header-actions">
            <button
              type="button"
              onClick={onContinueGuest}
              style={{
                ...buttonBase,
                padding: '0 15px',
                border: '1px solid #dce4ee',
                background: '#ffffff',
                color: '#10243e',
              }}
            >
              Explore
            </button>
            <button
              type="button"
              onClick={onLogin}
              style={{
                ...buttonBase,
                padding: '0 17px',
                border: '1px solid #10243e',
                background: '#10243e',
                color: '#ffffff',
              }}
            >
              Sign in
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-product-hero">
          <div className="landing-hero-copy">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, color: '#0f766e', fontSize: 12, fontWeight: 800 }}>
                <BookOpenCheck size={16} />
                PYQ practice for serious exam prep
              </div>
              <h1>
                Know what to practice next.
              </h1>
              <p>
                Pariksha turns previous year questions into a focused practice workspace for UPSC, APPSC, TSPSC, police, SSC and banking exams.
              </p>

              <div className="landing-hero-actions">
                <button
                  type="button"
                  onClick={onLogin}
                  style={{
                    ...buttonBase,
                    height: 48,
                    padding: '0 20px',
                    border: '1px solid #10243e',
                    background: '#10243e',
                    color: '#ffffff',
                    fontSize: 14,
                  }}
                >
                  Start practicing
                  <Play size={16} />
                </button>
                <button
                  type="button"
                  onClick={onContinueGuest}
                  style={{
                    ...buttonBase,
                    height: 48,
                    padding: '0 18px',
                    border: '1px solid #dce4ee',
                    background: '#ffffff',
                    color: '#10243e',
                    fontSize: 14,
                  }}
                >
                  Browse question bank
                </button>
              </div>
            </motion.div>
          </div>

          <div className="landing-preview-wrap">
            <ProductPreview />
          </div>
        </section>

        <section className="landing-stat-strip" aria-label="Pariksha coverage">
          {[
            { value: totalQDisplay, label: 'PYQs ready' },
            { value: `${examCount}+`, label: 'exam tracks' },
            { value: 'Practice + mock', label: 'study modes' },
            { value: 'Progress', label: 'weak-area signals' },
          ].map((item) => (
            <div key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </section>

        <section className="landing-section">
          <div className="landing-section-head">
            <span>Product focus</span>
            <h2>Simple enough to use daily. Sharp enough to guide revision.</h2>
          </div>

          <div className="landing-feature-grid">
            {[
              {
                icon: <Search size={20} />,
                title: 'Find the right paper fast',
                desc: 'Browse by commission, exam and year without digging through scattered PDFs.',
              },
              {
                icon: <Target size={20} />,
                title: 'Practice with intent',
                desc: 'Move question by question, check explanations, and save what needs revision.',
              },
              {
                icon: <BarChart3 size={20} />,
                title: 'See useful progress',
                desc: 'Focus on weak subjects, recent mistakes and pace instead of dashboard clutter.',
              },
            ].map((feature) => (
              <motion.div
                key={feature.title}
                className="landing-feature-card"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.28 }}
              >
                <div>{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="landing-flow-section">
          <div className="landing-section-head">
            <span>Daily flow</span>
            <h2>Open, practice, understand, come back stronger.</h2>
          </div>

          <div className="landing-flow-list">
            {[
              { icon: <Layers3 size={18} />, title: 'Choose an exam', text: shownCommissions.slice(0, 4).join(', ') },
              { icon: <BookOpenCheck size={18} />, title: 'Solve PYQs', text: 'Practice mode or timed mock' },
              { icon: <Clock3 size={18} />, title: 'Review immediately', text: 'Answer, explanation and bookmark' },
              { icon: <Target size={18} />, title: 'Focus next', text: 'Weak areas stay visible' },
            ].map((step) => (
              <div key={step.title} className="landing-flow-item">
                <div>{step.icon}</div>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-final-cta">
          <div>
            <h2>Start with one paper today.</h2>
            <p>No heavy setup. Open the question bank and begin practicing.</p>
          </div>
          <div>
            <button type="button" onClick={onLogin}>
              Continue with Google
              <ArrowRight size={15} />
            </button>
            <button type="button" onClick={onContinueGuest}>
              Explore first
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
