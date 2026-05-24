import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { type View } from '../types';

interface LegalViewProps {
  setView: (v: View) => void;
  initialTab?: 'privacy' | 'terms';
}

const LAST_UPDATED = 'May 24, 2025';
const APP_NAME = 'Pariksha AI';
const COMPANY = 'Pariksha AI';
const CONTACT_EMAIL = 'support@parikshaai.com';
const WEBSITE = 'parikshaai.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 10, letterSpacing: '-0.2px' }}>{title}</h2>
      <div style={{ fontSize: 13.5, color: 'var(--text-sec)', lineHeight: 1.75 }}>{children}</div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 10px' }}>{children}</p>;
}

function UL({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>
      {items.map((item, i) => <li key={i} style={{ marginBottom: 5 }}>{item}</li>)}
    </ul>
  );
}

function PrivacyPolicy() {
  return (
    <>
      <Section title="1. Information We Collect">
        <P>When you use {APP_NAME}, we collect:</P>
        <UL items={[
          'Account information: name and email address provided via Google Sign-In (no passwords stored by us)',
          'Usage data: questions answered, scores, subjects practiced, streaks, and session timestamps',
          'Device information: browser type, operating system, and IP address for security and analytics',
          'Payment information: transaction IDs and subscription status (actual card/UPI details are handled by Razorpay and never stored on our servers)',
        ]} />
      </Section>

      <Section title="2. How We Use Your Information">
        <UL items={[
          'To provide and personalise the platform — showing your progress, weak areas, and recommendations',
          'To process payments and manage your subscription status',
          'To send service emails (e.g. password resets, payment receipts)',
          'To improve the app through aggregated, anonymised analytics',
          'To comply with legal obligations',
        ]} />
        <P>We do not sell your personal information to third parties.</P>
      </Section>

      <Section title="3. Data Storage & Security">
        <P>Your data is stored on Supabase (PostgreSQL) and Firebase servers, both of which implement industry-standard encryption at rest and in transit (TLS 1.2+). Authentication tokens are verified server-side on every request.</P>
        <P>We retain your account data for as long as your account is active. You may request deletion at any time by emailing {CONTACT_EMAIL}.</P>
      </Section>

      <Section title="4. Third-Party Services">
        <P>We use the following third-party services, each with their own privacy policies:</P>
        <UL items={[
          'Google Firebase Authentication — sign-in and identity management',
          'Supabase — database and backend infrastructure',
          'Razorpay — payment processing (PCI-DSS compliant)',
          'Google Gemini API — AI-generated explanations (question text may be sent to Google for processing)',
          'Vercel — frontend hosting',
          'Render — backend hosting',
        ]} />
      </Section>

      <Section title="5. Cookies & Local Storage">
        <P>We use browser localStorage to cache question data and your session preferences (e.g. dark mode, daily goal). No third-party advertising cookies are used.</P>
      </Section>

      <Section title="6. Children's Privacy">
        <P>{APP_NAME} is not directed at children under 13. We do not knowingly collect personal data from children. If you believe a child has provided us data, contact us at {CONTACT_EMAIL}.</P>
      </Section>

      <Section title="7. Your Rights">
        <P>You have the right to access, correct, or delete your personal data. To exercise these rights, email {CONTACT_EMAIL} with your registered email address. We will respond within 30 days.</P>
      </Section>

      <Section title="8. Changes to This Policy">
        <P>We may update this policy from time to time. We will notify you of significant changes via email or an in-app notice. Continued use after changes constitutes acceptance.</P>
      </Section>

      <Section title="9. Contact">
        <P>For any privacy-related questions or requests, contact us at: <strong>{CONTACT_EMAIL}</strong></P>
      </Section>
    </>
  );
}

function TermsOfService() {
  return (
    <>
      <Section title="1. Acceptance of Terms">
        <P>By creating an account or using {APP_NAME} (available at {WEBSITE}), you agree to these Terms of Service. If you do not agree, do not use the service.</P>
      </Section>

      <Section title="2. Description of Service">
        <P>{APP_NAME} is an online exam preparation platform providing access to previous year question (PYQ) papers, AI-generated explanations, analytics, and mock tests for UPSC, APPSC, TSPSC, and other competitive examinations.</P>
      </Section>

      <Section title="3. Account Registration">
        <UL items={[
          'You must sign in using a valid Google account',
          'You are responsible for all activity that occurs under your account',
          'You must not share your account credentials or allow others to access your account',
          'You must provide accurate information and keep it up to date',
        ]} />
      </Section>

      <Section title="4. Free vs Premium Access">
        <P><strong>Free plan:</strong> Access to a limited set of question papers (one paper per exam, as indicated on the platform).</P>
        <P><strong>Premium plan:</strong> Full access to all papers, years, advanced analytics, unlimited bookmarks, and all AI features. Premium access is granted upon successful payment and remains active for the subscribed duration.</P>
        <P>We reserve the right to change the scope of free and premium features with reasonable notice.</P>
      </Section>

      <Section title="5. Payments & Refunds">
        <UL items={[
          'All payments are processed by Razorpay. By making a payment you also agree to Razorpay\'s terms.',
          'Prices are displayed in Indian Rupees (INR) and are inclusive of applicable taxes.',
          'Subscriptions are non-transferable.',
          'Refunds: if you experience a technical failure preventing access, contact us within 7 days of purchase and we will investigate. Refunds are issued at our discretion for verified failures.',
          'No refund is provided for change of mind after access has been granted.',
        ]} />
      </Section>

      <Section title="6. Acceptable Use">
        <P>You agree not to:</P>
        <UL items={[
          'Scrape, copy, or redistribute question content outside the platform',
          'Attempt to reverse-engineer, decompile, or tamper with the service',
          'Use automated bots or scripts to access the platform',
          'Share your account or credentials with others',
          'Use the platform for any unlawful purpose',
        ]} />
        <P>Violation may result in immediate account suspension without refund.</P>
      </Section>

      <Section title="7. Intellectual Property">
        <P>All content on {APP_NAME} — including question banks, UI, AI explanations, and branding — is owned by {COMPANY} or licensed to us. You may not reproduce or distribute it without written permission.</P>
        <P>Previous year questions sourced from official commission publications remain the property of their respective government bodies.</P>
      </Section>

      <Section title="8. Disclaimer of Warranties">
        <P>The service is provided "as is" without warranties of any kind. We do not guarantee that content is error-free, complete, or that the platform will be available without interruption. Use of AI-generated explanations is for learning assistance only — always verify with official sources.</P>
      </Section>

      <Section title="9. Limitation of Liability">
        <P>{COMPANY}'s total liability for any claim arising from use of the service shall not exceed the amount you paid in the 3 months preceding the claim. We are not liable for indirect, consequential, or incidental damages.</P>
      </Section>

      <Section title="10. Governing Law">
        <P>These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in Hyderabad, Telangana.</P>
      </Section>

      <Section title="11. Changes to Terms">
        <P>We may update these terms. Continued use after notice of changes constitutes acceptance. We will always post the effective date at the top of this page.</P>
      </Section>

      <Section title="12. Contact">
        <P>For any questions about these terms, contact us at: <strong>{CONTACT_EMAIL}</strong></P>
      </Section>
    </>
  );
}

export function LegalView({ setView, initialTab = 'privacy' }: LegalViewProps) {
  const [tab, setTab] = useState<'privacy' | 'terms'>(initialTab);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', fontFamily: 'var(--font-sans)', padding: '0 4px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <button
          onClick={() => setView('home')}
          style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            background: 'var(--bg-alt)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-sec)',
          }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} />
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.3px' }}>
            Legal
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-tert)', margin: '2px 0 0' }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, padding: 4, background: 'var(--bg-alt)', borderRadius: 12, border: '1px solid var(--border)', width: 'fit-content' }}>
        {(['privacy', 'terms'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px', borderRadius: 9, border: 'none',
              background: tab === t ? 'var(--bg)' : 'transparent',
              boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
              fontSize: 13, fontWeight: tab === t ? 700 : 500,
              color: tab === t ? 'var(--text)' : 'var(--text-tert)',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {t === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '28px 32px',
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          {tab === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--text-tert)', margin: '0 0 28px' }}>
          Effective date: {LAST_UPDATED} · {APP_NAME} ({WEBSITE})
        </p>

        {tab === 'privacy' ? <PrivacyPolicy /> : <TermsOfService />}
      </div>

      <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--text-tert)' }}>
        Questions? Email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>{CONTACT_EMAIL}</a>
      </div>
    </div>
  );
}
