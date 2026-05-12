/**
 * QuestionText — smart renderer for all question types.
 *
 * Handles:
 *   - Match-the-following  (encoded as __MATCH__:{col1, col2} suffix)
 *   - Table questions       (lines with ≥2 pipe | separators)
 *   - Image-flag notice     (has_image prop)
 *   - Plain text MCQ        (default: pre-wrap)
 */
import React from 'react';
import { C } from './tokens';

// ── Match data extraction ────────────────────────────────────────────────────

interface MatchData {
  intro: string;
  col1: string[];
  col2: string[];
  col1Header?: string;
  col2Header?: string;
}

const MATCH_PROMPT_RE = /\b(?:match\s+the\s+following|match\s+list\s*[-–]?\s*i\s+with\s+list\s*[-–]?\s*ii|list\s*[-–]?\s*i\b.*\blist\s*[-–]?\s*ii\b)\b/i;
const MATCH_LEFT_RE = /^\s*([A-Da-d])\.\s*(.+?)\s*$/;
const MATCH_RIGHT_RE = /^\s*((?:\d+|[IVXLCDM]+))\.\s*(.+?)\s*$/i;
const MATCH_INLINE_BOTH_RE = /^\s*([A-Da-d])\.\s*(.+?)\s{2,}((?:\d+|[IVXLCDM]+))\.\s*(.+?)\s*$/i;
const MATCH_INLINE_RIGHT_LABEL_ONLY_RE = /^\s*([A-Da-d])\.\s*(.+?)\s+((?:\d+|[IVXLCDM]+))\.\s*$/i;
const MATCH_CONTINUATION_WITH_RIGHT_RE = /^\s*(.+?)\s+((?:\d+|[IVXLCDM]+))\.\s*(.+?)\s*$/i;
const MATCH_END_RE = /^(?:\s*(?:choose|select)\s+the\s+correct|\s*\([1-4]\)\s*[A-D]-|\s*[A-D]\s*[-:]\s*[IVX\d])/i;

function leftDisplayLabel(idx: number): string {
  return String.fromCharCode(97 + idx);
}

function rightDisplayLabel(idx: number): string {
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  return romans[idx] || String(idx + 1);
}

function inferMatchHeaders(intro: string): { intro: string; col1Header: string; col2Header: string } {
  const lines = intro.split('\n').map(l => l.trim()).filter(Boolean);
  let col1Header = 'List I';
  let col2Header = 'List II';
  const kept: string[] = [];

  for (const line of lines) {
    if (/^list\s*[-–]?\s*i\b/i.test(line) || /^column\s*[-–]?\s*i\b/i.test(line)) {
      col1Header = line;
      continue;
    }
    if (/^list\s*[-–]?\s*ii\b/i.test(line) || /^column\s*[-–]?\s*ii\b/i.test(line)) {
      col2Header = line;
      continue;
    }
    if (/common\s+codes/i.test(line) || /^codes?\s*[/:-]/i.test(line) || /^[a-d](?:\s+[a-d]){2,}\s*$/i.test(line)) {
      continue;
    }
    kept.push(line);
  }

  return {
    intro: kept.join('\n').trim(),
    col1Header,
    col2Header,
  };
}

function romanToInt(label: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  for (const ch of label.toUpperCase().split('').reverse()) {
    const value = map[ch] || 0;
    total += value < prev ? -value : value;
    prev = value;
  }
  return total;
}

function rightSortValue(label: string): number {
  if (/^\d+$/.test(label)) return Number(label);
  return romanToInt(label);
}

function recoverFlattenedMatch(text: string): MatchData | null {
  if (!text) return null;

  const left: Array<[string, string]> = [];
  const right: Array<[string, string]> = [];
  const introLines: string[] = [];
  const lines = text.replace(/\t/g, '    ').split('\n').map(l => l.trim()).filter(Boolean);
  let pendingLeftLabel: string | null = null;
  let pendingRightLabel: string | null = null;

  for (const line of lines) {
    if (MATCH_END_RE.test(line)) break;

    if (pendingLeftLabel) {
      const continuation = line.match(MATCH_CONTINUATION_WITH_RIGHT_RE);
      if (continuation) {
        left.push([pendingLeftLabel, continuation[1].trim()]);
        right.push([continuation[2], continuation[3].trim()]);
        pendingLeftLabel = null;
        continue;
      }
      const rightM = line.match(MATCH_RIGHT_RE);
      if (rightM) {
        left.push([pendingLeftLabel, '']);
        right.push([rightM[1], rightM[2].trim()]);
        pendingLeftLabel = null;
        continue;
      }
      left.push([pendingLeftLabel, line.trim()]);
      pendingLeftLabel = null;
      continue;
    }

    if (pendingRightLabel) {
      const rightM = line.match(MATCH_RIGHT_RE);
      if (rightM) {
        right.push([rightM[1], rightM[2].trim()]);
      } else {
        right.push([pendingRightLabel, line.trim()]);
      }
      pendingRightLabel = null;
      continue;
    }

    const both = line.match(MATCH_INLINE_BOTH_RE);
    if (both) {
      left.push([both[1].toUpperCase(), both[2].trim()]);
      right.push([both[3], both[4].trim()]);
      continue;
    }

    const leftWithRightOnly = line.match(MATCH_INLINE_RIGHT_LABEL_ONLY_RE);
    if (leftWithRightOnly) {
      left.push([leftWithRightOnly[1].toUpperCase(), leftWithRightOnly[2].trim()]);
      pendingRightLabel = leftWithRightOnly[3];
      continue;
    }

    const leftM = line.match(MATCH_LEFT_RE);
    if (leftM) {
      const label = leftM[1].toUpperCase();
      const value = leftM[2].trim();
      if (value) {
        const continuation = value.match(MATCH_CONTINUATION_WITH_RIGHT_RE);
        if (continuation) {
          left.push([label, continuation[1].trim()]);
          right.push([continuation[2], continuation[3].trim()]);
        } else {
          const trailingRight = value.match(/^(.*?)\s+((?:\d+|[IVXLCDM]+))\.\s*$/i);
          if (trailingRight) {
            left.push([label, trailingRight[1].trim()]);
            pendingRightLabel = trailingRight[2];
          } else {
            left.push([label, value]);
          }
        }
      } else {
        pendingLeftLabel = label;
      }
      continue;
    }

    const rightM = line.match(MATCH_RIGHT_RE);
    if (rightM) {
      right.push([rightM[1], rightM[2].trim()]);
      continue;
    }

    introLines.push(line);
  }

  const col1 = left.sort((a, b) => a[0].localeCompare(b[0])).map(([, value]) => value);
  const col2 = right.sort((a, b) => rightSortValue(a[0]) - rightSortValue(b[0])).map(([, value]) => value);
  if (col1.length < 2 || col2.length < 2) return null;
  if (!MATCH_PROMPT_RE.test(text) && !/list\s*i\b|word\b|book\b|writer\b|meaning\b/i.test(text)) return null;

  const headerInfo = inferMatchHeaders(introLines.join('\n').trim() || 'Match the following:');

  return {
    intro: headerInfo.intro,
    col1,
    col2,
    col1Header: headerInfo.col1Header,
    col2Header: headerInfo.col2Header,
  };
}

function stripMatchColumnsFromIntro(raw: string): string {
  // The text before __MATCH__: contains: question stem + optional column headers
  // + flattened A./B./C. and 1./2./3. items. Keep only the stem.
  const lines = raw.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { kept.push(line); continue; }
    // Stop at first match-column item (A./B./C. or numbered)
    if (MATCH_LEFT_RE.test(t) || MATCH_RIGHT_RE.test(t)) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

function parseMatch(text: string): MatchData | null {
  const markerIdx = text.indexOf('__MATCH__:');
  if (markerIdx === -1) return recoverFlattenedMatch(text);
  try {
    const rawIntro = text.slice(0, markerIdx).replace(/\s+$/, '').trim();
    const intro = stripMatchColumnsFromIntro(rawIntro);
    const rest = text.slice(markerIdx + '__MATCH__:'.length).trimStart();
    // Extract only the JSON object using brace counting (ignore trailing text)
    let depth = 0, end = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '{') depth++;
      else if (rest[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const jsonStr = end !== -1 ? rest.slice(0, end) : rest;
    const { col1, col2 } = JSON.parse(jsonStr);
    if (!Array.isArray(col1) || !Array.isArray(col2)) return recoverFlattenedMatch(text);
    const headerInfo = inferMatchHeaders(intro || rawIntro);
    return {
      intro: headerInfo.intro,
      col1,
      col2,
      col1Header: headerInfo.col1Header,
      col2Header: headerInfo.col2Header,
    };
  } catch {
    return recoverFlattenedMatch(text);
  }
}

// ── Table detection ──────────────────────────────────────────────────────────

function parseTable(text: string): string[][] | null {
  const lines = text.split('\n').filter(l => l.includes('|'));
  if (lines.length < 2) return null;
  return lines.map(l =>
    l.split('|').map(c => c.trim()).filter((c, i, arr) =>
      // drop empty first/last cells created by leading/trailing |
      !(c === '' && (i === 0 || i === arr.length - 1))
    )
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MatchTable({ data }: { data: MatchData }) {
  const rows = Math.max(data.col1.length, data.col2.length);
  return (
    <div>
      {data.intro && (
        <p style={{ fontSize: 'inherit', fontWeight: 'inherit', color: C.text,
          lineHeight: 1.7, marginBottom: 12, whiteSpace: 'pre-wrap',
          fontFamily: 'inherit' }}>
          {data.intro}
        </p>
      )}
      <div style={{ overflowX: 'auto', marginBottom: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>{data.col1Header || 'List I'}</th>
              <th style={thStyle}>{data.col2Header || 'List II'}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i}>
                <td style={tdStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8 }}>
                    <span style={matchLabelStyle}>{leftDisplayLabel(i)}.</span>
                    <span>{data.col1[i] ?? ''}</span>
                  </div>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 8 }}>
                    <span style={matchLabelStyle}>{rightDisplayLabel(i)}.</span>
                    <span>{data.col2[i] ?? ''}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PipeTable({ rows }: { rows: string[][] }) {
  if (!rows.length) return null;
  const isHeader = rows.length > 1;
  return (
    <div style={{ overflowX: 'auto', marginBottom: 4 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        {isHeader && (
          <thead>
            <tr>{rows[0].map((cell, i) => <th key={i} style={thStyle}>{cell}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {(isHeader ? rows.slice(1) : rows).map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => <td key={ci} style={tdStyle}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared table styles ──────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'rgba(99,102,241,0.12)',
  border: `1px solid ${C.border}`,
  color: C.textSec,
  fontWeight: 700,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  textAlign: 'left',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 12px',
  border: `1px solid ${C.border}`,
  color: C.text,
  lineHeight: 1.5,
  verticalAlign: 'top',
};

const matchLabelStyle: React.CSSProperties = {
  color: C.textSec,
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

// ── Main export ──────────────────────────────────────────────────────────────

interface QuestionTextProps {
  text: string;
  hasImage?: boolean;
  imageUrl?: string;
  /** fontSize / fontWeight / fontFamily forwarded to the plain-text renderer */
  style?: React.CSSProperties;
}

export function QuestionText({ text, hasImage, imageUrl, style }: QuestionTextProps) {
  const imageBlock = hasImage ? <ImageBlock url={imageUrl} /> : null;

  // 1. Match-the-following — never show image block; the HTML table IS the content.
  const matchData = parseMatch(text);
  if (matchData) {
    return (
      <div style={{ marginBottom: 4 }}>
        <MatchTable data={matchData} />
      </div>
    );
  }

  // 2. Check if text (excluding __MATCH__ lines) has a pipe table
  const tableRows = parseTable(text);
  if (tableRows) {
    const firstPipeLine = text.split('\n').findIndex(l => l.includes('|'));
    const intro = text.split('\n').slice(0, firstPipeLine).join('\n').trim();
    return (
      <div style={{ marginBottom: 4 }}>
        {intro && (
          <p style={{ ...defaultTextStyle, ...style, marginBottom: 10 }}>{intro}</p>
        )}
        <PipeTable rows={tableRows} />
        {imageBlock}
      </div>
    );
  }

  // 3. Plain text (MCQ, Assertion-Reason, Statement-based, etc.)
  return (
    <div>
      <p style={{ ...defaultTextStyle, ...style }}>{text}</p>
      {imageBlock}
    </div>
  );
}

function ImageBlock({ url }: { url?: string }) {
  const [expanded, setExpanded] = React.useState(false);

  if (url) {
    return (
      <div style={{ marginTop: 14 }}>
        <img
          src={url}
          alt="Question diagram"
          onClick={() => setExpanded(e => !e)}
          style={{
            maxWidth: '100%',
            maxHeight: expanded ? 'none' : 280,
            width: '100%',
            objectFit: 'contain',
            objectPosition: 'top left',
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            display: 'block',
            cursor: expanded ? 'zoom-out' : 'zoom-in',
            transition: 'max-height 0.2s ease',
            background: 'rgba(255,255,255,0.03)',
          }}
          onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
        />
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 5, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 10, color: C.textTert, padding: 0, fontFamily: 'inherit',
          }}
        >
          {expanded ? '▲ Collapse' : '▼ Expand diagram'}
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 6, marginTop: 8,
      background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.25)',
      fontSize: 11, color: '#FBBF24', fontWeight: 600 }}>
      📊 This question has a diagram/chart — refer to the original paper.
    </div>
  );
}

const defaultTextStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  lineHeight: 1.7,
  margin: 0,
};
