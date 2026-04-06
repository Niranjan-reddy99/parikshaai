import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function normalizeSubject(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('polity') || s.includes('constitution') || s.includes('governance') || s.includes('political science')) return 'Polity';
  if (s.includes('history') || s.includes('art') || s.includes('culture') || s.includes('heritage') || s.includes('medieval') || s.includes('ancient') || s.includes('modern')) return 'History';
  if (s.includes('environment') || s.includes('ecology') || s.includes('biodiversity') || s.includes('climate') || s.includes('forest') || s.includes('wildlife')) return 'Environment';
  if (s.includes('geography') || s.includes('geograph')) return 'Geography';
  if (s.includes('economy') || s.includes('economic') || s.includes('finance') || s.includes('budget') || s.includes('banking') || s.includes('market')) return 'Economy';
  if (s.includes('science') || s.includes('tech') || s.includes('space') || s.includes('defence') || s.includes('biology') || s.includes('physics') || s.includes('chemistry') || s.includes('computer')) return 'Science & Tech';
  if (s.includes('current') || s.includes('recent') || s.includes('news')) return 'Current Affairs';
  if (s.includes('english') || s.includes('language') || s.includes('grammar') || s.includes('verbal') || s.includes('comprehension')) return 'English';
  if (s.includes('reasoning') || s.includes('aptitude') || s.includes('quantitative') || s.includes('math') || s.includes('logical') || s.includes('numerical')) return 'Reasoning & Aptitude';
  if (s.includes('social') || s.includes('society') || s.includes('welfare') || s.includes('tribal') || s.includes('caste') || s.includes('women')) return 'Social Issues';
  if (s.includes('general knowledge') || s.includes('gk') || s.includes('general')) return 'General Knowledge';
  const first = raw.split('/')[0].trim();
  return first || 'General Knowledge';
}
