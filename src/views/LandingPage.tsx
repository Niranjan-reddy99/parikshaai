import { useMemo, useState, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  LineChart,
  LockKeyhole,
  LogIn,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { C } from '../lib/tokens';
import type { CatalogSummary, FeedSummary } from '../types';

interface LandingPageProps {
  onLogin: () => void;
  onContinueGuest: () => void;
  catalogSummary: CatalogSummary | null;
  feedSummary: FeedSummary | null;
}

const ORDERED_COMMISSIONS = ['UPSC', 'APPSC', 'TSPSC', 'TSLPRB', 'APSLPRB', 'APHC', 'TSHC', 'SSC'];

const sectionTitleStyle: CSSProperties = {
  fontSize: 'clamp(30px, 4vw, 48px)',
  lineHeight: 1.02,
  letterSpacing: '-0.06em',
  fontWeight: 900,
  color: '#0f172a',
  margin: 0,
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: "'DM Mono', monospace",
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: '#0f766e',
  marginBottom: 12,
};

function formatCompact(value: number) {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k+`;
  return `${value}+`;
}

export function LandingPage({
  onLogin,
  onContinueGuest,
  catalogSummary,
  feedSummary,
}: LandingPageProps) {
  const [selectedPremiumPlan, setSelectedPremiumPlan] = useState('Semi-Annual Pro');

  const commissionMap = catalogSummary?.commission_map || {};
  const commissionKeys = Object.keys(commissionMap);
  const totalQuestions = catalogSummary?.total_questions || feedSummary?.total_questions || 6500;
  const examTrackCount =
    Object.values(commissionMap).reduce((sum, exams) => sum + Object.keys(exams || {}).length, 0) || 36;
  const yearCount = Math.max(
    6,
    new Set(
      Object.values(commissionMap).flatMap((exams) =>
        Object.values(exams || {}).flatMap((exam) => exam.years || [])
      )
    ).size
  );
  const topicCount = feedSummary?.subjects.reduce((sum, subject) => sum + subject.topics.length, 0) || 60;
  const featuredCommissions =
    ORDERED_COMMISSIONS.filter((key) => commissionKeys.includes(key)).slice(0, 6).length > 0
      ? ORDERED_COMMISSIONS.filter((key) => commissionKeys.includes(key)).slice(0, 6)
      : ['UPSC', 'APPSC', 'TSPSC', 'APHC', 'TSLPRB', 'SSC'];

  const quickProof = [
    { value: formatCompact(totalQuestions), label: 'questions' },
    { value: `${examTrackCount}+`, label: 'exam tracks' },
    { value: `${topicCount}+`, label: 'topics' },
    { value: `${yearCount}+`, label: 'years' },
  ];

  const productHighlights = [
    {
      icon: Search,
      title: 'Find the right paper fast',
      text: 'Start from commission, then exam, then year. No digging through folders or random PDFs.',
    },
    {
      icon: BookOpen,
      title: 'Practice the way you want',
      text: 'Use question-bank browsing for revision or switch to exam mode when you want a timed run.',
    },
    {
      icon: LineChart,
      title: 'See what needs work',
      text: 'Track weak topics, bookmarks, recent mistakes, and your actual practice pattern over time.',
    },
    {
      icon: ShieldCheck,
      title: 'Keep the learner flow clean',
      text: 'Reviewed answers stay visible. Edge cases like deleted or multiple answers are shown clearly.',
    },
  ];

  const preparationSteps = [
    {
      label: 'Step 1',
      title: 'Choose your exam',
      text: 'Open the commission you enrolled for and move into the exact paper or year you need.',
    },
    {
      label: 'Step 2',
      title: 'Practice by paper or topic',
      text: 'Read one question at a time, use filters, and switch modes without changing your context.',
    },
    {
      label: 'Step 3',
      title: 'Review and revise',
      text: 'Come back through insights, wrong questions, bookmarks, and repeated weak areas.',
    },
  ];

  const freeWorkspaceFeatures = [
    'Browse the commission-wise question bank',
    'Unlock 1 paper in each commission',
    'Use practice mode and exam mode on unlocked papers',
    'Track bookmarks, insights, and streaks after sign-in',
  ];

  const premiumWorkspaceFeatures = [
    'Open all papers and years in the covered archive',
    'Practice and test across the full question bank',
    'Use the app for repeat revision across many papers',
    'Best fit for serious year-wise preparation',
  ];

  const upgradeHighlights = [
    'More papers, not a different app',
    'Same learner flow, but with full archive depth',
    'Useful when your prep needs repeated revision across years',
  ];

  const premiumOptions = [
    {
      name: 'Quarterly Pro',
      price: '₹499',
      original: '₹749',
      period: 'for 3 months',
      save: 'Good for one active prep cycle',
      cta: 'Unlock Quarterly Pro',
    },
    {
      name: 'Semi-Annual Pro',
      price: '₹899',
      original: '₹1499',
      period: 'for 6 months',
      save: 'Best balance for regular prep',
      cta: 'Unlock Semi-Annual Pro',
      popular: true,
    },
    {
      name: 'Annual Pro',
      price: '₹1499',
      original: '₹2999',
      period: 'for 12 months',
      save: 'Best for long revision cycles',
      cta: 'Unlock Annual Pro',
    },
  ];

  const activePremiumOption = useMemo(
    () => premiumOptions.find((option) => option.name === selectedPremiumPlan) || premiumOptions[1],
    [selectedPremiumPlan]
  );

  const scrollToPricing = () => {
    document.getElementById('pricing-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top left, rgba(37,99,235,0.10), transparent 26%), linear-gradient(180deg, #f7fafc 0%, #ffffff 100%)',
        color: C.text,
      }}
    >
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backdropFilter: 'blur(16px)',
          background: 'rgba(248,250,252,0.86)',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #0f172a, #2563eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 900,
                fontSize: 17,
              }}
            >
              P
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 850, letterSpacing: '-0.04em', color: '#0f172a' }}>
                Pariksha
              </div>
              <div style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>
                PYQ practice platform
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              onClick={scrollToPricing}
              style={{
                padding: '10px 14px',
                borderRadius: 999,
                border: `1px solid ${C.border}`,
                background: 'rgba(255,255,255,0.92)',
                color: C.textSec,
                fontWeight: 750,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Pricing
            </button>
            <button
              onClick={onContinueGuest}
              style={{
                padding: '10px 14px',
                borderRadius: 999,
                border: `1px solid ${C.border}`,
                background: 'rgba(255,255,255,0.92)',
                color: C.textSec,
                fontWeight: 750,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Explore Free
            </button>
            <button
              onClick={onLogin}
              style={{
                padding: '10px 16px',
                borderRadius: 999,
                border: 'none',
                background: 'linear-gradient(135deg, #0f766e, #14b8a6)',
                color: '#f8fffd',
                fontWeight: 850,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <LogIn style={{ width: 14, height: 14 }} />
              Continue with Google
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px 80px' }}>
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 28,
            alignItems: 'center',
            marginBottom: 52,
          }}
        >
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <div style={eyebrowStyle}>Previous year questions, made usable</div>
            <h1
              style={{
                fontSize: 'clamp(42px, 7vw, 76px)',
                lineHeight: 0.94,
                letterSpacing: '-0.07em',
                fontWeight: 900,
                color: '#0f172a',
                margin: 0,
                maxWidth: 720,
              }}
            >
              Practice PYQs
              <span style={{ display: 'block', color: '#2563eb' }}>the way you actually prepare.</span>
            </h1>

            <p
              style={{
                fontSize: 17,
                lineHeight: 1.75,
                color: C.textSec,
                maxWidth: 640,
                margin: '18px 0 0',
              }}
            >
              Pick a commission, open the right paper, solve question by question, and use your mistakes to decide what to revise next.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
              <button
                onClick={onLogin}
                style={{
                  padding: '15px 18px',
                  borderRadius: 16,
                  border: 'none',
                  background: 'linear-gradient(135deg, #0f172a, #2563eb)',
                  color: '#fff',
                  fontWeight: 850,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 18px 40px rgba(37,99,235,0.18)',
                }}
              >
                Start practicing
                <ArrowRight style={{ width: 15, height: 15 }} />
              </button>
              <button
                onClick={onContinueGuest}
                style={{
                  padding: '15px 18px',
                  borderRadius: 16,
                  border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,0.92)',
                  color: C.text,
                  fontWeight: 750,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Browse the free version
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24 }}>
              {[
                'Commission-wise question bank',
                'Practice mode and exam mode',
                'Bookmarks, insights, and rankings',
              ].map((item) => (
                <span
                  key={item}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.84)',
                    border: `1px solid ${C.border}`,
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.textSec,
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.08 }}>
            <div
              style={{
                padding: 22,
                borderRadius: 28,
                background: 'rgba(255,255,255,0.94)',
                border: `1px solid ${C.border}`,
                boxShadow: '0 28px 72px rgba(15,23,42,0.08)',
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {['Question Bank', 'Practice', 'Insights'].map((label, index) => (
                  <span
                    key={label}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 999,
                      background: index === 0 ? '#dbeafe' : '#f8fafc',
                      border: `1px solid ${index === 0 ? '#bfdbfe' : C.border}`,
                      color: index === 0 ? '#1d4ed8' : C.textSec,
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              <div
                style={{
                  padding: 18,
                  borderRadius: 22,
                  background: 'linear-gradient(180deg, #ffffff, #f8fbfd)',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ display: 'grid', gap: 12 }}>
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 18,
                      background: '#fff',
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>APPSC Group 1 Prelims</div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#0f766e', background: '#ecfeff', padding: '6px 9px', borderRadius: 999 }}>
                        2025
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.65 }}>
                      Search a paper, open the question list, and move into practice without losing exam context.
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 16,
                      borderRadius: 18,
                      background: 'rgba(240,249,255,0.9)',
                      border: '1px solid rgba(37,99,235,0.16)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                      {['Polity', 'Verified', 'Easy'].map((label, index) => (
                        <span
                          key={label}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            background: index === 0 ? '#dbeafe' : index === 1 ? '#dcfce7' : '#fef3c7',
                            color: index === 0 ? '#1d4ed8' : index === 1 ? '#166534' : '#a16207',
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 850, lineHeight: 1.32, color: '#0f172a', marginBottom: 12 }}>
                      Which principle protects a person from being punished twice for the same offence?
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {['Right to equality', 'Double jeopardy', 'Judicial review', 'Natural justice'].map((option, index) => (
                        <div
                          key={option}
                          style={{
                            padding: '11px 12px',
                            borderRadius: 14,
                            background: index === 1 ? 'rgba(220,252,231,0.8)' : '#fff',
                            border: `1px solid ${index === 1 ? 'rgba(22,163,74,0.22)' : C.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 9,
                              background: index === 1 ? '#16a34a' : '#e2e8f0',
                              color: index === 1 ? '#fff' : '#475569',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            {String.fromCharCode(65 + index)}
                          </div>
                          <span style={{ fontSize: 13.5, color: C.text }}>{option}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 10,
                    }}
                  >
                    {[
                      { label: 'Weak topic', value: 'Modern History' },
                      { label: 'Bookmarks', value: '18 saved' },
                      { label: 'Streak', value: '6 days' },
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          padding: 12,
                          borderRadius: 16,
                          background: '#fff',
                          border: `1px solid ${C.border}`,
                        }}
                      >
                        <div style={{ fontSize: 11, color: C.textTert, marginBottom: 6 }}>{item.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section style={{ marginBottom: 56 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {quickProof.map((item) => (
              <div
                key={item.label}
                style={{
                  padding: '18px 16px',
                  borderRadius: 20,
                  background: 'rgba(255,255,255,0.88)',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontSize: 30, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.06em' }}>
                  {item.value}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textSec, marginTop: 4 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 56 }}>
          <div style={eyebrowStyle}>What you get</div>
          <div style={{ maxWidth: 720, marginBottom: 22 }}>
            <h2 style={sectionTitleStyle}>One product. One clear job.</h2>
            <p style={{ fontSize: 16, lineHeight: 1.78, color: C.textSec, margin: '10px 0 0' }}>
              Pariksha is for learners who want PYQs to feel like a preparation system, not just a pile of scanned papers.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {productHighlights.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                style={{
                  padding: 22,
                  borderRadius: 24,
                  background: 'rgba(255,255,255,0.9)',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 16,
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(15,118,110,0.10))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 14,
                  }}
                >
                  <Icon style={{ width: 22, height: 22, color: '#2563eb' }} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 850, color: '#0f172a', marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: C.textSec }}>{text}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 56 }}>
          <div style={eyebrowStyle}>How it works</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.05fr) minmax(280px, 0.95fr)',
              gap: 18,
              alignItems: 'start',
            }}
          >
            <div
              style={{
                padding: 24,
                borderRadius: 28,
                background: 'rgba(255,255,255,0.92)',
                border: `1px solid ${C.border}`,
              }}
            >
              <h2 style={{ ...sectionTitleStyle, maxWidth: 640 }}>Simple flow. Clear next step.</h2>
              <div style={{ display: 'grid', gap: 14, marginTop: 22 }}>
                {preparationSteps.map((step) => (
                  <div
                    key={step.label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '92px 1fr',
                      gap: 16,
                      alignItems: 'start',
                      padding: '14px 0',
                      borderTop: step.label === 'Step 1' ? 'none' : `1px solid ${C.border}`,
                    }}
                  >
                    <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: '#0f766e', paddingTop: 3 }}>
                      {step.label}
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 850, color: '#0f172a', marginBottom: 6 }}>{step.title}</div>
                      <div style={{ fontSize: 14, lineHeight: 1.72, color: C.textSec }}>{step.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                padding: 24,
                borderRadius: 28,
                background: 'linear-gradient(180deg, rgba(239,246,255,0.92), rgba(255,255,255,0.98))',
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Available across</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                {featuredCommissions.map((commission) => (
                  <span
                    key={commission}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 999,
                      background: '#fff',
                      border: `1px solid ${C.border}`,
                      fontSize: 13,
                      fontWeight: 800,
                      color: '#0f172a',
                    }}
                  >
                    {commission}
                  </span>
                ))}
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                {[
                  {
                    icon: Clock3,
                    text: 'Open a paper and start solving quickly instead of cleaning PDFs yourself.',
                  },
                  {
                    icon: Sparkles,
                    text: 'Use the same product surface for browsing, practicing, and reviewing.',
                  },
                  {
                    icon: LockKeyhole,
                    text: 'Free is enough to understand the workflow. Premium unlocks real depth.',
                  },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 12,
                        background: '#fff',
                        border: `1px solid ${C.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon style={{ width: 16, height: 16, color: '#2563eb' }} />
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.7, color: C.textSec }}>{text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="pricing-section" style={{ marginBottom: 56 }}>
          <div style={eyebrowStyle}>Pricing</div>
          <div style={{ maxWidth: 760, marginBottom: 24 }}>
            <h2 style={sectionTitleStyle}>Start free. Upgrade when you want the full archive.</h2>
            <p style={{ fontSize: 16, lineHeight: 1.78, color: C.textSec, margin: '10px 0 0' }}>
              Free is enough to try the workflow properly. Premium is for serious year-wise preparation.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr)',
              gap: 18,
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'grid', gap: 14 }}>
              <div
                style={{
                  padding: 24,
                  borderRadius: 26,
                  background: 'rgba(255,255,255,0.94)',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr)',
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      padding: 24,
                      borderRadius: 22,
                      background: 'linear-gradient(180deg, rgba(240,253,250,0.92), rgba(255,255,255,0.98))',
                      border: '1px solid rgba(15,118,110,0.16)',
                    }}
                  >
                    <div style={{ display: 'inline-flex', padding: '6px 10px', borderRadius: 999, background: 'rgba(15,118,110,0.12)', color: '#0f766e', fontSize: 11, fontWeight: 800, marginBottom: 10 }}>
                      FREE
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.06em' }}>₹0</div>
                    <div style={{ fontSize: 24, fontWeight: 850, color: '#0f172a', marginTop: 6 }}>Free Workspace</div>
                    <div style={{ fontSize: 15, lineHeight: 1.72, color: C.textSec, marginTop: 10, maxWidth: 720 }}>
                      Good for trying the product and starting with unlocked papers.
                    </div>
                    <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
                      {freeWorkspaceFeatures.map((item) => (
                        <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <CheckCircle2 style={{ width: 16, height: 16, color: '#0f766e', flexShrink: 0, marginTop: 2 }} />
                          <span style={{ fontSize: 15, lineHeight: 1.68, color: C.textSec }}>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 24,
                      borderRadius: 22,
                      background: 'linear-gradient(180deg, rgba(255,247,237,0.96), rgba(255,255,255,0.98))',
                      border: '1px solid rgba(245,158,11,0.18)',
                    }}
                  >
                    <div style={{ display: 'inline-flex', padding: '6px 10px', borderRadius: 999, background: 'rgba(217,119,6,0.14)', color: '#d97706', fontSize: 11, fontWeight: 800, marginBottom: 10 }}>
                      PREMIUM
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.06em' }}>
                      {activePremiumOption.price}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 850, color: '#0f172a', marginTop: 6 }}>Premium Workspace</div>
                    <div style={{ fontSize: 15, lineHeight: 1.72, color: C.textSec, marginTop: 10, maxWidth: 720 }}>
                      Best when you need the full archive for repeat revision and broader coverage.
                    </div>
                    <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
                      {premiumWorkspaceFeatures.map((item) => (
                        <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <CheckCircle2 style={{ width: 16, height: 16, color: '#d97706', flexShrink: 0, marginTop: 2 }} />
                          <span style={{ fontSize: 15, lineHeight: 1.68, color: C.textSec }}>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: 20,
                  borderRadius: 24,
                  background: 'rgba(255,255,255,0.92)',
                  border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 850, color: '#0f172a', marginBottom: 14 }}>
                  What changes when you upgrade
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {upgradeHighlights.map((item) => (
                    <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <CheckCircle2 style={{ width: 16, height: 16, color: '#2563eb', flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 15, lineHeight: 1.68, color: C.textSec }}>{item}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={onContinueGuest}
                  style={{
                    marginTop: 16,
                    padding: '13px 16px',
                    borderRadius: 16,
                    border: `1px solid ${C.border}`,
                    background: '#fff',
                    color: C.text,
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Start with Free
                </button>
              </div>
            </div>

            <div
              style={{
                padding: 24,
                borderRadius: 28,
                background: 'linear-gradient(180deg, rgba(255,247,237,0.96), rgba(255,255,255,0.98))',
                border: '1px solid rgba(245,158,11,0.26)',
                boxShadow: '0 24px 54px rgba(217,119,6,0.10)',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  padding: '7px 12px',
                  borderRadius: 999,
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                Most Popular
              </div>

              <div style={{ display: 'inline-flex', padding: '6px 10px', borderRadius: 999, background: 'rgba(217,119,6,0.14)', color: '#d97706', fontSize: 11, fontWeight: 800, marginBottom: 14 }}>
                Choose a plan
              </div>
              <div style={{ fontSize: 34, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.06em' }}>
                Premium access
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.72, color: C.textSec, marginTop: 10 }}>
                Pick the duration that matches your preparation cycle.
              </div>

              <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
                {premiumOptions.map((option) => {
                  const active = option.name === activePremiumOption.name;
                  return (
                    <button
                      key={option.name}
                      onClick={() => setSelectedPremiumPlan(option.name)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '16px 18px',
                        borderRadius: 20,
                        border: active ? '2px solid #2563eb' : '1px solid rgba(148,163,184,0.24)',
                        background: '#fff',
                        cursor: 'pointer',
                        position: 'relative',
                      }}
                    >
                      {option.popular ? (
                        <span
                          style={{
                            position: 'absolute',
                            top: -10,
                            right: 14,
                            padding: '6px 10px',
                            borderRadius: 999,
                            background: '#2563eb',
                            color: '#fff',
                            fontSize: 10,
                            fontWeight: 900,
                          }}
                        >
                          Most Popular
                        </span>
                      ) : null}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', marginBottom: 6 }}>
                            {option.name}
                          </div>
                          <div style={{ fontSize: 12.5, color: '#15803d', fontWeight: 700 }}>{option.save}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 8 }}>
                            <span style={{ fontSize: 34, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.05em' }}>
                              {option.price}
                            </span>
                            <span style={{ fontSize: 12.5, color: '#94a3b8', textDecoration: 'line-through', fontWeight: 700 }}>
                              {option.original}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: C.textSec }}>{option.period}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={onLogin}
                style={{
                  width: '100%',
                  marginTop: 18,
                  padding: '15px 16px',
                  borderRadius: 18,
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: 'pointer',
                  boxShadow: '0 18px 34px rgba(37,99,235,0.22)',
                }}
              >
                {activePremiumOption.cta}
              </button>
              <div style={{ fontSize: 11.5, color: C.textTert, marginTop: 10, lineHeight: 1.5, textAlign: 'center' }}>
                Launch pricing for early users. Payment flow can plug into this CTA next.
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            padding: '34px 30px',
            borderRadius: 34,
            background: 'linear-gradient(135deg, #0f172a, #102a43 56%, #0f766e)',
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, alignItems: 'center' }}>
            <div>
              <div style={{ ...eyebrowStyle, color: 'rgba(255,255,255,0.72)' }}>Ready to start</div>
              <h2 style={{ fontSize: 'clamp(30px, 5vw, 48px)', lineHeight: 1.02, letterSpacing: '-0.05em', fontWeight: 900, margin: 0 }}>
                Stop collecting papers.
                <span style={{ display: 'block', color: '#5eead4' }}>Start preparing through them.</span>
              </h2>
              <p style={{ fontSize: 16, lineHeight: 1.8, color: 'rgba(248,250,252,0.82)', margin: '14px 0 0', maxWidth: 560 }}>
                Use the free version first, or sign in and build your preparation record from day one.
              </p>
            </div>

            <div
              style={{
                padding: 20,
                borderRadius: 24,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <div style={{ display: 'grid', gap: 12 }}>
                {[
                  `Browse ${commissionKeys.length || featuredCommissions.length} commission tracks`,
                  `Practice across ${topicCount}+ topic buckets`,
                  'Save bookmarks, streaks, and revision signals after sign-in',
                ].map((item) => (
                  <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <BookOpen style={{ width: 16, height: 16, color: '#5eead4', flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(255,255,255,0.88)' }}>{item}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
                <button
                  onClick={onLogin}
                  style={{
                    padding: '13px 16px',
                    borderRadius: 16,
                    border: 'none',
                    background: '#5eead4',
                    color: '#042f2e',
                    fontWeight: 900,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Continue with Google
                </button>
                <button
                  onClick={onContinueGuest}
                  style={{
                    padding: '13px 16px',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.22)',
                    background: 'rgba(255,255,255,0.08)',
                    color: '#fff',
                    fontWeight: 750,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Explore free first
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
