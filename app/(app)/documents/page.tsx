'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { extractClausesRuleBased, NUMBERING_SCHEMAS } from '@/lib/ruleBasedExtractor';
import type { ExtractedClause } from '@/lib/ruleBasedExtractor';
import { CANONICAL_CLAUSE_TYPES } from '@/lib/clauseTypes';
import { createBrowserClient } from '@supabase/ssr';
import { CONTRACT_TYPE_CATEGORIES, CONTRACT_TYPE_OPTIONS } from '@/lib/documentProfiles';
import { getCustomDocumentTypes, saveCustomDocumentType, labelToDocTypeValue } from '@/lib/customDocumentTypes';
import { DEFAULT_COUNTERPARTY_TYPES, getCustomCounterpartyTypes, saveCustomCounterpartyType } from '@/lib/customCounterpartyTypes';
import { VENDOR_TYPE_OPTIONS } from '@/lib/vendorTypes';
import { matchesBooleanQuery, extractPositiveTerms } from '@/lib/booleanSearch';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  REQUIREMENT_EFFECT_LABELS, DERIVATION_LABELS,
} from '@/lib/clauses/clauseCategories';
import BulkDocumentUploadModal from '@/components/upload/BulkDocumentUploadModal';
import { US_STATES, COUNTRIES } from '@/lib/geoOptions';
import { ClientSearchDropdown } from '@/components/ui/ClientSearchDropdown';
import { BgcTypeEditor } from '@/components/ui/BgcTypeEditor';
import { normalizeBgcRequirements, BGC_TYPES_WITH_JURISDICTION } from '@/lib/bgcTypeOptions';
import { CounterpartySearchSelect, type CounterpartyOption } from '@/components/ui/CounterpartySearchSelect';
import { fetchDocumentsCached, invalidateDocumentsCache, fetchClausesCached, invalidateClausesCache } from '@/lib/clientDataCache';
import {
  CONTRACTS, CLAUSES, contractStatus,
  type Contract, type Clause,
} from '@/lib/mockData';

// ─── Constants ────────────────────────────────────────────────────────────────

const OBLIGATION_COLORS: Record<string, string> = {
  insurance_notice:        '#a78bfa',
  indemnity:               '#f87171',
  confidentiality:         '#60a5fa',
  payment:                 '#34d399',
  termination:             '#fb923c',
  limitation_of_liability: '#f59e0b',
  governing_law:           '#94a3b8',
  dispute_resolution:      '#22d3ee',
  force_majeure:           '#a3e635',
  warranty:                '#e879f9',
  other:                   '#64748b',
};

const OBLIGATION_LABELS: Record<string, string> = {
  insurance_notice:        'Insurance Notice',
  indemnity:               'Indemnity',
  confidentiality:         'Confidentiality',
  payment:                 'Payment',
  termination:             'Termination',
  limitation_of_liability: 'Limitation of Liability',
  governing_law:           'Governing Law',
  dispute_resolution:      'Dispute Resolution',
  force_majeure:           'Force Majeure',
  warranty:                'Warranty',
  other:                   'Other',
};

const OBLIGATION_TYPES = Object.keys(OBLIGATION_COLORS);

function obligationColor(type: string) {
  return OBLIGATION_COLORS[type] || OBLIGATION_COLORS.other;
}

function ObligationBadge({ type }: { type: string }) {
  const color = obligationColor(type);
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 99,
      fontSize: '0.65rem',
      fontWeight: 600,
      textTransform: 'uppercase',
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      whiteSpace: 'nowrap',
    }}>
      {OBLIGATION_LABELS[type] || type.replace(/_/g, ' ')}
    </span>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#34d399' : pct >= 50 ? '#f59e0b' : '#f87171';
  return (
    <span style={{ fontSize: '0.72rem', color, fontWeight: 600 }}>{pct}%</span>
  );
}

// ─── Document preview with highlighted clauses ────────────────────────────────

interface PreviewPanelProps {
  doc: any;
  clauses: any[];
  onClose: () => void;
  onClauseClick?: (clause: any) => void;
  width?: number;
  isDragging?: boolean;
  onDragStart?: (e: React.MouseEvent) => void;
}

// Stable iframe component — updates src imperatively to prevent remount / new-window
function IframePdf({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (ref.current && src && ref.current.src !== src) ref.current.src = src;
  }, [src]);
  return <iframe ref={ref} src={src} title={title} style={{ flex: 1, border: 'none', width: '100%', minHeight: 0, display: 'block' }} />;
}

// Small Levenshtein distance for near-miss word matching in the fuzzy aligner below.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// Normalizes text for exact-content matching between a clause's stored
// clause_text and the document's raw body: unifies smart quotes/dashes and
// collapses all whitespace runs to single spaces, while keeping a map back
// to original character offsets so a normalized match translates into an
// exact original-text char range.
function normalizeForMatch(s: string): { norm: string; map: number[] } {
  const map: number[] = [];
  let norm = '';
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (ch === '‘' || ch === '’' || ch === 'ʼ') ch = "'";
    else if (ch === '“' || ch === '”') ch = '"';
    else if (ch === '–' || ch === '—' || ch === '−') ch = '-';
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      norm += ' '; map.push(i); prevSpace = true;
    } else {
      norm += ch.toLowerCase(); map.push(i); prevSpace = false;
    }
  }
  while (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
  return { norm, map };
}

interface WordToken { start: number; end: number; norm: string }

function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const norm = m[0].toLowerCase().replace(/[^\w]/g, '');
    if (norm) tokens.push({ start: m.index, end: m.index + m[0].length, norm });
  }
  return tokens;
}

// Anchored fuzzy alignment: locates the best-matching run of `tokens` for
// `clauseWords`, tolerating extra words interleaved in the document text
// (e.g. an inline sub-item heading like "1.1 Term of Contract:" that the
// clause extractor dropped but the raw document still contains) as well as
// occasional dropped/substituted words.
function findFuzzySpan(tokens: WordToken[], clauseWords: string[]): [number, number] | null {
  const k = clauseWords.length;
  if (!k || !tokens.length) return null;
  const first = clauseWords[0];
  let anchors: number[] = [];
  for (let i = 0; i < tokens.length; i++) if (tokens[i].norm === first) anchors.push(i);
  if (anchors.length === 0) {
    for (let i = 0; i < tokens.length; i++) {
      if (Math.abs(tokens[i].norm.length - first.length) <= 1 && levenshtein(tokens[i].norm, first) <= 1) anchors.push(i);
    }
  }
  // Skip budget is capped, NOT scaled proportionally to clause length — legal
  // boilerplate (recitals, preamble) reuses the same common short words
  // ("the", "of", "this", "Agreement") as the clause body, so a loose
  // proportional slack lets the aligner drift far from the real clause,
  // sporadically matching those common words across unrelated paragraphs.
  // A tight, capped budget still tolerates a few dropped sub-item headings
  // without letting the match wander.
  const skipBudget = Math.min(30, Math.max(5, Math.ceil(k * 0.15)));
  let bestScore = 0, bestStart = -1, bestEnd = -1;
  for (const a of anchors) {
    let ci = 0, skipped = 0, matched = 0, lastMatchIdx = a, t = a;
    while (ci < k && skipped <= skipBudget && t < tokens.length) {
      if (tokens[t].norm === clauseWords[ci]) { matched++; ci++; lastMatchIdx = t; t++; continue; }
      if (ci + 1 < k && tokens[t].norm === clauseWords[ci + 1]) { matched++; ci += 2; lastMatchIdx = t; t++; continue; }
      skipped++; t++;
    }
    // Penalize skips directly in the score (matched / (k + skipped), not
    // matched / k) — otherwise a coincidental earlier anchor that happens to
    // reach the same final match count as the true anchor (just by skipping
    // a few more boilerplate words to get there) TIES with it, and the first
    // anchor tried (leftmost, i.e. wrong) would win the tie by default.
    // Penalizing skip count makes the tightest-fitting anchor win outright.
    const score = matched / (k + skipped);
    if (score > bestScore) { bestScore = score; bestStart = a; bestEnd = lastMatchIdx; }
  }
  if (bestStart < 0 || bestScore < 0.7) return null;
  return [tokens[bestStart].start, tokens[bestEnd].end];
}

// Locates the exact original-text char range covered by `clauseText` inside
// `text` so the full clause — every word of it — can be highlighted. Order
// of attempts: normalized (whitespace/quote-tolerant) exact match → fuzzy
// word alignment (tolerates dropped sub-item headings) → stored
// char_start/char_end as a last resort.
function locateClauseSpan(text: string, clauseText: string, hintStart: number, hintEnd: number): [number, number] | null {
  if (!text || !clauseText) return null;
  const { norm: normText, map } = normalizeForMatch(text);
  const { norm: normClause } = normalizeForMatch(clauseText);
  if (normClause) {
    const occurrences: number[] = [];
    let from = 0;
    while (true) {
      const idx = normText.indexOf(normClause, from);
      if (idx === -1) break;
      occurrences.push(idx);
      from = idx + 1;
    }
    if (occurrences.length) {
      let best = occurrences[0];
      if (hintStart >= 0) {
        let bestDist = Infinity;
        for (const o of occurrences) {
          const d = Math.abs(map[o] - hintStart);
          if (d < bestDist) { bestDist = d; best = o; }
        }
      }
      return [map[best], map[best + normClause.length - 1] + 1];
    }
  }
  const tokens = tokenizeWords(text);
  const clauseWords = (clauseText.match(/\S+/g) || []).map(w => w.toLowerCase().replace(/[^\w]/g, '')).filter(Boolean);
  const fuzzy = findFuzzySpan(tokens, clauseWords);
  if (fuzzy) return fuzzy;
  if (hintStart >= 0 && hintEnd > hintStart && hintEnd <= text.length) return [hintStart, hintEnd];
  return null;
}

// ── Dedicated clause document viewer ──────────────────────────────────────────
// Opens as a side panel, fetches file_text, finds the clause, highlights + scrolls to it.
function ClauseDocViewerPanel({ clause, docs, onClose }: {
  clause: any;
  docs: any[];
  onClose: () => void;
}) {
  const docId: string = clause.document_id || '';
  const docRecord = docs.find((d: any) => d.document_id === docId);

  const [fileText, setFileText] = useState<string>('');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLElement | null>(null);

  // Which rendering the panel shows — both the reconstructed, highlighted
  // text and the original PDF are kept available (each independently
  // searchable) whenever the document has both; the toggle just switches
  // which one is visible.
  const [viewMode, setViewMode] = useState<'text' | 'pdf'>('text');
  const viewModeDefaultedForDoc = useRef<string>('');

  // Free-text search within the document — independent of the clause highlight
  const [search, setSearch] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const currentMatchRef = useRef<HTMLElement | null>(null);

  // PDF-mode search — seeds the browser's native PDF find with the clause
  // text so the clause's words get highlighted inline, the same way the
  // Clause Library's other document viewer does it.
  const [pdfSearch, setPdfSearch] = useState('');
  const [pdfSearchCommit, setPdfSearchCommit] = useState('');
  useEffect(() => {
    const snippet = (clause.clause_text || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    setPdfSearch(snippet); setPdfSearchCommit(snippet);
  }, [clause.clause_id]);

  useEffect(() => {
    if (!docId) return;
    // Guards against a stale fetch generation (React Strict Mode's dev-only
    // double-invoke, or rapidly switching clauses) clobbering more recent
    // state after the effect has already moved on to a different doc.
    let cancelled = false;
    setLoading(true); setFileText(''); setFileUrl(null); markRef.current = null;
    viewModeDefaultedForDoc.current = '';

    // Fetch PDF URL in parallel
    fetch(`/api/documents/${docId}/file`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setFileUrl(d?.url || null); })
      .catch(() => {});

    // Fetch file_text: docs-list rows no longer carry it (the list API strips
    // it), so fetch the single full row; fall back to the uploads record.
    const cached = docRecord?.file_text;
    if (cached) { setFileText(cached); setLoading(false); return () => { cancelled = true; }; }
    fetch(`/api/documents?document_id=${encodeURIComponent(docId)}`)
      .then(r => r.json())
      .then(d => {
        const text = d?.documents?.[0]?.file_text || '';
        if (text) { if (!cancelled) setFileText(text); return null; }
        return fetch('/api/documents/uploads')
          .then(r => r.json())
          .then(u => {
            const up = (u.uploads || []).find((x: any) => x.document_id === docId);
            if (!cancelled) setFileText(up?.file_text || '');
          });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [docId]);

  // Pick a default view once we know what's available for this doc: text
  // first (it carries the precise clause highlight), PDF if there's no
  // stored text. Only decided once per doc — afterward the toggle is fully
  // user-controlled — but if the chosen side turns out to have nothing to
  // show (e.g. the PDF fetch fails after text was found empty), fall back
  // to whichever side does have content.
  useEffect(() => {
    if (loading) return;
    if (viewModeDefaultedForDoc.current !== docId) {
      viewModeDefaultedForDoc.current = docId;
      setViewMode(fileText ? 'text' : 'pdf');
      return;
    }
    if (viewMode === 'text' && !fileText && fileUrl) setViewMode('pdf');
    if (viewMode === 'pdf' && !fileUrl && fileText) setViewMode('text');
  }, [docId, loading, fileText, fileUrl, viewMode]);

  const isPdfMode = viewMode === 'pdf' && !!fileUrl;

  // Auto-scroll to highlighted clause after text loads
  useEffect(() => {
    if (isPdfMode || loading || !fileText) return;
    const timer = setTimeout(() => {
      markRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, 80);
    return () => clearTimeout(timer);
  }, [loading, fileText, clause.clause_id, isPdfMode]);

  // Find clause position: use char_start/char_end or fall back to a
  // whitespace/quote-tolerant + fuzzy word-alignment search (handles both
  // reformatted whitespace AND inline sub-item headings the extractor
  // dropped from clause_text but which are still present in the raw text).
  const clauseText = (clause.clause_text || '').trim();
  const hintStart = typeof clause.char_start === 'number' ? clause.char_start : -1;
  const hintEnd = typeof clause.char_end === 'number' ? clause.char_end : -1;
  const span = useMemo(
    () => (!isPdfMode && fileText ? locateClauseSpan(fileText, clauseText, hintStart, hintEnd) : null),
    [isPdfMode, fileText, clauseText, hintStart, hintEnd]
  );
  const cStart = span ? span[0] : -1;
  const cEnd = span ? span[1] : -1;

  // Find all search matches in the raw document text
  const searchTerm = search.trim().toLowerCase();
  const searchLen = searchTerm.length;
  const searchMatches: number[] = [];
  if (!isPdfMode && fileText && searchLen > 0) {
    const lower = fileText.toLowerCase();
    let si = 0;
    while (si < lower.length) {
      const found = lower.indexOf(searchTerm, si);
      if (found === -1) break;
      searchMatches.push(found);
      si = found + searchLen;
    }
  }
  const totalMatches = searchMatches.length;
  const curMatchIdx = totalMatches ? Math.min(matchIdx, totalMatches - 1) : 0;

  useEffect(() => { setMatchIdx(0); }, [searchTerm]);
  useEffect(() => {
    currentMatchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [curMatchIdx, searchTerm]);

  // Build text segments, merging clause-highlight boundaries with search-match boundaries
  type Seg = { start: number; end: number; isClause: boolean; matchNo: number };
  const segs: Seg[] = [];
  if (!isPdfMode && fileText) {
    const boundaries = new Set<number>([0, fileText.length]);
    if (cStart >= 0) { boundaries.add(cStart); boundaries.add(cEnd); }
    for (const pos of searchMatches) { boundaries.add(pos); boundaries.add(Math.min(pos + searchLen, fileText.length)); }
    const pts = [...boundaries].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i], e = pts[i + 1];
      if (s === e) continue;
      const mid = (s + e) / 2;
      const matchNo = searchLen > 0 ? searchMatches.findIndex(pos => mid >= pos && mid < pos + searchLen) : -1;
      const isClause = cStart >= 0 && mid >= cStart && mid < cEnd;
      segs.push({ start: s, end: e, isClause, matchNo });
    }
  }

  const PAGE: React.CSSProperties = {
    background: '#fff', margin: '0 auto', maxWidth: 560, width: '100%',
    padding: '48px 56px', boxShadow: '0 2px 20px rgba(0,0,0,0.55)', borderRadius: 2,
    fontSize: '0.83rem', lineHeight: 1.85, color: '#1a1a1a',
    fontFamily: '"Times New Roman", Times, Georgia, serif',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxSizing: 'border-box',
  };

  const iframeSrc = fileUrl
    ? (pdfSearchCommit.trim() ? `${fileUrl}#search=${encodeURIComponent(pdfSearchCommit.trim())}` : fileUrl)
    : '';

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 520, borderLeft: '1px solid var(--border-color)', background: '#09090f', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 25 }}>
      {/* Header */}
      <div style={{ padding: '8px 14px 8px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'var(--bg-elevated)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(167,139,250,0.55)', marginBottom: 1 }}>Contract Document</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {docRecord?.title || docId}
          </div>
        </div>
        {fileText && fileUrl && (
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 5, padding: 2, flexShrink: 0 }}>
            <button onClick={() => setViewMode('text')}
              style={{ fontSize: '0.65rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', background: viewMode === 'text' ? 'rgba(224,170,255,0.2)' : 'none', color: viewMode === 'text' ? '#e0aaff' : 'var(--text-muted)' }}>
              Text
            </button>
            <button onClick={() => setViewMode('pdf')}
              style={{ fontSize: '0.65rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', background: viewMode === 'pdf' ? 'rgba(224,170,255,0.2)' : 'none', color: viewMode === 'pdf' ? '#e0aaff' : 'var(--text-muted)' }}>
              PDF
            </button>
          </div>
        )}
        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab"
            style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.45)', textDecoration: 'none', border: '1px solid var(--border-color)', borderRadius: 3, padding: '2px 6px', flexShrink: 0, lineHeight: 1.4 }}>
            ↗
          </a>
        )}
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>

      {/* Search bar — PDF mode searches the native inline viewer; text mode
          searches the reconstructed document text below */}
      {isPdfMode && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: 'var(--bg-elevated)' }}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(148,163,184,0.5)', lineHeight: 1 }}>⌕</span>
          <input
            value={pdfSearch}
            onChange={e => setPdfSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') setPdfSearchCommit(pdfSearch.trim());
              if (e.key === 'Escape') { setPdfSearch(''); setPdfSearchCommit(''); }
            }}
            placeholder="Search PDF (Enter)"
            style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 5, outline: 'none', color: 'var(--text-primary)', fontSize: '0.75rem', padding: '4px 8px', fontFamily: 'inherit' }}
          />
        </div>
      )}
      {!isPdfMode && !loading && fileText && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: 'var(--bg-elevated)' }}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(148,163,184,0.5)', lineHeight: 1 }}>⌕</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') setMatchIdx(i => totalMatches ? (i >= totalMatches - 1 ? 0 : i + 1) : 0);
              if (e.key === 'Escape') setSearch('');
            }}
            placeholder="Search document text…"
            style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 5, outline: 'none', color: 'var(--text-primary)', fontSize: '0.75rem', padding: '4px 8px', fontFamily: 'inherit' }}
          />
          {search.trim() && (
            <>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {totalMatches ? `${curMatchIdx + 1}/${totalMatches}` : '0/0'}
              </span>
              <button onClick={() => setMatchIdx(i => i <= 0 ? totalMatches - 1 : i - 1)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: '0.6rem', lineHeight: 1 }}>▲</button>
              <button onClick={() => setMatchIdx(i => i >= totalMatches - 1 ? 0 : i + 1)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: '0.6rem', lineHeight: 1 }}>▼</button>
              <button onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.45)', cursor: 'pointer', padding: '0 2px', fontSize: '0.7rem', lineHeight: 1 }}>×</button>
            </>
          )}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', gap: 8 }}>
          Loading document…
        </div>
      ) : isPdfMode ? (
        // Keyed on iframeSrc (not the imperative-src IframePdf helper used
        // elsewhere): a search-term change only differs by URL fragment, and
        // Chrome's PDF viewer only re-parses "#search=" on a real navigation
        // — reassigning .src in place leaves the old search results showing.
        // Remounting forces that fresh navigation so search actually re-runs.
        <iframe key={iframeSrc} src={iframeSrc} title={docRecord?.title || docId || 'Document'} style={{ flex: 1, border: 'none', width: '100%', minHeight: 0 }} />
      ) : !fileText ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No document text available</span>
        </div>
      ) : (
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', background: '#111118', padding: '20px 14px' }}>
          <div style={PAGE}>
            {segs.map((seg, i) => {
              const segText = fileText.slice(seg.start, seg.end);
              if (seg.matchNo !== -1) {
                const isCurrent = seg.matchNo === curMatchIdx;
                return (
                  <mark key={i}
                    ref={isCurrent ? el => { currentMatchRef.current = el; } : undefined}
                    style={{ background: isCurrent ? '#c77dff' : '#f3d9ff', color: '#111', borderRadius: 2, padding: '0 1px' }}>
                    {segText}
                  </mark>
                );
              }
              if (seg.isClause) {
                return (
                  <mark key={i}
                    ref={el => { if (el) markRef.current = el; }}
                    style={{ background: 'rgba(224,170,255,0.35)', color: '#4a1942', borderRadius: 3, outline: '2px solid rgba(224,170,255,0.7)', outlineOffset: 2, padding: '0 1px' }}>
                    {segText}
                  </mark>
                );
              }
              return <span key={i}>{segText}</span>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentPreviewPanel({ doc, clauses, onClose, onClauseClick, width = 420, isDragging = false, onDragStart }: PreviewPanelProps) {
  // Check Supabase Storage for the original file
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileChecked, setFileChecked] = useState(false);

  useEffect(() => {
    setFileUrl(null);
    setFileChecked(false);
    if (!doc.document_id) { setFileChecked(true); return; }
    fetch(`/api/documents/${doc.document_id}/file`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then(data => { setFileUrl(data.url || null); setFileChecked(true); })
      .catch(() => { setFileUrl(null); setFileChecked(true); });
  }, [doc.document_id]);

  // Some older/legacy documents have a stored PDF but no extracted text (the search
  // bar has nothing to search without it). When that happens, pull the PDF bytes from
  // storage and run the same text-extraction pipeline used on upload, then cache the
  // result on the document row so this only ever runs once per document.
  const [extractedText, setExtractedText] = useState('');
  const [extractingText, setExtractingText] = useState(false);
  useEffect(() => { setExtractedText(''); }, [doc.document_id]);
  useEffect(() => {
    if (doc.file_text || !fileUrl || extractedText || extractingText) return;
    let cancelled = false;
    setExtractingText(true);
    fetch(fileUrl)
      .then(r => r.blob())
      .then(blob => {
        const fd = new FormData();
        fd.append('file', blob, (doc.title || doc.document_id || 'document') + '.pdf');
        return fetch('/api/documents/preview-text', { method: 'POST', body: fd });
      })
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data?.text) return;
        setExtractedText(data.text);
        if (doc.document_id) {
          fetch('/api/documents', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document_id: doc.document_id, file_text: data.text }),
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setExtractingText(false); });
    return () => { cancelled = true; };
  }, [fileUrl, doc.file_text, doc.document_id]);

  const text: string = doc.file_text || extractedText;

  // Re-attach the original file for documents whose upload never reached
  // Storage (older fire-and-forget upload paths) — without this there's no way
  // to fix a document short of recreating it.
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [attaching, setAttaching] = useState(false);
  const handleAttach = async (file: File) => {
    if (!doc.document_id) return;
    setAttaching(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/documents/${doc.document_id}/file`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`File upload failed: ${err.error || `HTTP ${res.status}`}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.url) { setFileUrl(data.url); setShowOriginalPdf(true); }
    } catch (e: any) {
      alert(`File upload failed: ${e?.message || 'network error'}`);
    } finally {
      setAttaching(false);
    }
  };

  // Manual override to view the original PDF inline (in this same panel) instead
  // of the extracted text — never opens a new tab/window.
  const [showOriginalPdf, setShowOriginalPdf] = useState(false);
  useEffect(() => { setShowOriginalPdf(false); }, [doc.document_id]);

  // Prefer our own rendered text — it supports real search (highlight + auto-scroll
  // + prev/next), which a cross-origin native PDF iframe cannot be driven to do from
  // here. Only fall back to the raw PDF iframe when no extracted text is available,
  // or the user explicitly asked to see the original PDF.
  const isPdfMode = showOriginalPdf || (!!fileUrl && !text);
  const activeClause = clauses[0] || null;

  // PDF search: pre-filled with clause text snippet, updates iframe on Enter
  const [pdfSearch, setPdfSearch] = useState('');
  const [pdfSearchCommit, setPdfSearchCommit] = useState('');

  useEffect(() => {
    const snippet = activeClause?.clause_text
      ? activeClause.clause_text.trim().replace(/\s+/g, ' ').slice(0, 60)
      : '';
    setPdfSearch(snippet);
    setPdfSearchCommit(snippet);
  }, [activeClause?.clause_id]);

  // Text-mode state
  const [zoom, setZoom] = useState(100);
  const [search, setSearch] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const currentMatchRef = useRef<HTMLElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const firstClauseRef = useRef<HTMLElement | null>(null);

  // Pre-fill text search with clause snippet when char positions aren't available
  useEffect(() => {
    if (!activeClause) return;
    const hasCharPos = typeof activeClause.char_start === 'number' && typeof activeClause.char_end === 'number' && activeClause.char_end > activeClause.char_start;
    if (!hasCharPos && activeClause.clause_text) {
      setSearch(activeClause.clause_text.trim().replace(/\s+/g, ' ').slice(0, 80));
    } else {
      setSearch('');
    }
  }, [activeClause?.clause_id]);

  // Auto-scroll to first highlighted clause in text mode
  useEffect(() => {
    if (firstClauseRef.current && scrollAreaRef.current) {
      const top = firstClauseRef.current.offsetTop;
      scrollAreaRef.current.scrollTop = Math.max(0, top - 120);
    }
  }, [doc.document_id, activeClause?.clause_id]);

  const searchTerm = search.trim().toLowerCase();
  const searchLen = searchTerm.length;
  const searchMatches: number[] = [];
  if (!isPdfMode && searchLen > 0) {
    const lower = text.toLowerCase();
    let si = 0;
    while (si < lower.length) {
      const found = lower.indexOf(searchTerm, si);
      if (found === -1) break;
      searchMatches.push(found);
      si = found + searchLen;
    }
  }
  const totalMatches = searchMatches.length;
  const curIdx = totalMatches ? Math.min(matchIdx, totalMatches - 1) : 0;

  useEffect(() => { setMatchIdx(0); }, [searchTerm]);
  useEffect(() => {
    currentMatchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [curIdx, searchTerm]);

  const sortedClauses = [...clauses]
    .filter(c => typeof c.char_start === 'number' && typeof c.char_end === 'number' && c.char_end > c.char_start)
    .sort((a, b) => a.char_start - b.char_start);

  interface DocSeg { start: number; end: number; clause?: any; matchNo: number }
  const segments: DocSeg[] = [];
  if (!isPdfMode && text) {
    const boundaries = new Set<number>([0, text.length]);
    for (const c of sortedClauses) { boundaries.add(c.char_start); boundaries.add(Math.min(c.char_end, text.length)); }
    if (searchLen > 0) {
      for (const pos of searchMatches) { boundaries.add(pos); boundaries.add(Math.min(pos + searchLen, text.length)); }
    }
    const pts = [...boundaries].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i], e = pts[i + 1], mid = (s + e) / 2;
      const matchNo = searchLen > 0 ? searchMatches.findIndex(pos => mid >= pos && mid < pos + searchLen) : -1;
      const clause = matchNo === -1 ? sortedClauses.find(c => mid >= c.char_start && mid < c.char_end) : undefined;
      segments.push({ start: s, end: e, clause, matchNo });
    }
  }

  const pageWidth = Math.max(300, Math.round(560 * zoom / 100));

  // iframe src — load with initial clause search, never remount on subsequent searches
  const initialSrc = useRef('');
  const iframeSrc = fileUrl
    ? pdfSearchCommit.trim()
      ? `${fileUrl}#search=${encodeURIComponent(pdfSearchCommit.trim())}`
      : fileUrl
    : '';
  if (iframeSrc && !initialSrc.current) initialSrc.current = iframeSrc;

  return (
    <div style={{ height: '100%', width: '100%', borderLeft: isDragging ? '3px solid #7c3aed' : '1px solid var(--border-color)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {/* Drag handle */}
      <div onMouseDown={onDragStart} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 10, background: isDragging ? 'rgba(124,58,237,0.4)' : 'transparent' }}
        onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.25)'; }}
        onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      />

      {/* Toolbar */}
      <div style={{ padding: '7px 14px 7px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'var(--bg-elevated)' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {doc.title || doc.document_id || 'Document'}
        </span>
        {extractingText && (
          <span style={{ fontSize: '0.65rem', color: 'rgba(167,139,250,0.7)', flexShrink: 0, whiteSpace: 'nowrap' }}>Preparing search…</span>
        )}
        {/* Search — always shown; PDF mode commits on Enter and reloads iframe */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,0.05)', border: `1px solid ${isPdfMode && pdfSearchCommit ? 'rgba(245,158,11,0.5)' : 'var(--border-color)'}`, borderRadius: 5, padding: '3px 7px', flexShrink: 0 }}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(148,163,184,0.5)', lineHeight: 1 }}>⌕</span>
          {isPdfMode ? (
            <input
              value={pdfSearch}
              onChange={e => setPdfSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') setPdfSearchCommit(pdfSearch.trim());
                if (e.key === 'Escape') { setPdfSearch(''); setPdfSearchCommit(''); }
              }}
              placeholder="Search doc (Enter)"
              style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.72rem', width: 108, fontFamily: 'inherit' }}
            />
          ) : (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') setMatchIdx(i => totalMatches ? (i >= totalMatches - 1 ? 0 : i + 1) : 0);
                if (e.key === 'Escape') setSearch('');
              }}
              placeholder="Search"
              style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.72rem', width: 88, fontFamily: 'inherit' }}
            />
          )}
          {isPdfMode ? (
            pdfSearchCommit && (
              <button onClick={() => { setPdfSearch(''); setPdfSearchCommit(''); }}
                style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.45)', cursor: 'pointer', padding: '0 2px', fontSize: '0.7rem', lineHeight: 1 }}>×</button>
            )
          ) : (
            search.trim() && (
              <>
                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', borderLeft: '1px solid var(--border-color)', paddingLeft: 5 }}>
                  {totalMatches ? `${curIdx + 1}/${totalMatches}` : '0/0'}
                </span>
                <button onClick={() => setMatchIdx(i => i <= 0 ? totalMatches - 1 : i - 1)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 1px', fontSize: '0.55rem', lineHeight: 1 }}>▲</button>
                <button onClick={() => setMatchIdx(i => i >= totalMatches - 1 ? 0 : i + 1)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 1px', fontSize: '0.55rem', lineHeight: 1 }}>▼</button>
              </>
            )
          )}
        </div>
        {/* Zoom (text mode only) */}
        {!isPdfMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <button onClick={() => setZoom(z => Math.max(50, z - 10))}
              style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer', width: 18, height: 18, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>−</button>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: 34, textAlign: 'center' }}>{zoom}%</span>
            <button onClick={() => setZoom(z => Math.min(200, z + 10))}
              style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer', width: 18, height: 18, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>+</button>
          </div>
        )}
        {fileUrl && text && (
          <button onClick={() => setShowOriginalPdf(v => !v)}
            style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.6)', background: 'none', border: '1px solid var(--border-color)', borderRadius: 3, padding: '2px 6px', flexShrink: 0, lineHeight: 1.4, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            title="View the original PDF in this panel — never opens a new tab">
            {isPdfMode ? 'View Extracted Text' : 'View Original PDF'}
          </button>
        )}
        {fileChecked && !fileUrl && doc.document_id && (
          <>
            <input ref={attachInputRef} type="file" accept=".pdf,.docx,.doc,.txt" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleAttach(f); e.target.value = ''; }} />
            <button onClick={() => attachInputRef.current?.click()} disabled={attaching}
              style={{ fontSize: '0.65rem', color: '#a78bfa', background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 3, padding: '2px 6px', flexShrink: 0, lineHeight: 1.4, cursor: attaching ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              title="Upload the original file — its Storage copy is missing">
              {attaching ? 'Attaching…' : 'Attach file'}
            </button>
          </>
        )}
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>

      {/* Document area */}
      {!fileChecked ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', gap: 8 }}>
          <span style={{ opacity: 0.5 }}>Loading…</span>
        </div>
      ) : isPdfMode ? (
        <IframePdf src={iframeSrc} title={doc.title || doc.document_id || 'Document'} />
      ) : !text ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', gap: 10 }}>
          <span>No document text or file available</span>
          {fileChecked && !fileUrl && doc.document_id && (
            <button onClick={() => attachInputRef.current?.click()} disabled={attaching}
              style={{ fontSize: '0.72rem', color: '#a78bfa', background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 5, padding: '5px 12px', cursor: attaching ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {attaching ? 'Attaching…' : 'Attach original file'}
            </button>
          )}
        </div>
      ) : (
        <div ref={scrollAreaRef} style={{ flex: 1, overflow: 'auto', background: '#111118', padding: '20px 16px' }}>
          {/* White page */}
          <div style={{
            background: '#ffffff',
            margin: '0 auto',
            width: pageWidth,
            maxWidth: '100%',
            padding: `${Math.round(56 * zoom / 100)}px ${Math.round(64 * zoom / 100)}px`,
            boxShadow: '0 2px 20px rgba(0,0,0,0.6)',
            borderRadius: 2,
            fontSize: `${(zoom / 100) * 0.83}rem`,
            lineHeight: 1.85,
            color: '#1a1a1a',
            fontFamily: '"Times New Roman", Times, Georgia, serif',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            boxSizing: 'border-box',
          } as React.CSSProperties}>
            {segments.map((seg, i) => {
              const segText = text.slice(seg.start, seg.end);
              if (seg.matchNo !== -1) {
                const isCurrent = seg.matchNo === curIdx;
                return (
                  <mark key={i}
                    ref={isCurrent ? el => { currentMatchRef.current = el; } : undefined}
                    style={{ background: isCurrent ? '#f59e0b' : '#fde68a', color: '#111', borderRadius: 2, padding: '0 1px' }}>
                    {segText}
                  </mark>
                );
              }
              if (seg.clause) {
                const isActive = seg.clause.clause_id === activeClause?.clause_id;
                return (
                  <mark key={i}
                    ref={isActive ? (el => { if (el && !firstClauseRef.current) firstClauseRef.current = el; }) : undefined}
                    onClick={() => onClauseClick?.(seg.clause)}
                    title={OBLIGATION_LABELS[seg.clause.obligation_type] || seg.clause.obligation_type || ''}
                    style={{ background: isActive ? 'rgba(251,191,36,0.45)' : obligationColor(seg.clause.obligation_type) + '28', borderBottom: `2px solid ${isActive ? '#fbbf24' : obligationColor(seg.clause.obligation_type)}`, outline: isActive ? '2px solid rgba(251,191,36,0.6)' : 'none', outlineOffset: 1, cursor: 'pointer', borderRadius: 2, color: 'inherit' }}>
                    {segText}
                  </mark>
                );
              }
              return <span key={i}>{segText}</span>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document History Panel ───────────────────────────────────────────────────

function DocumentHistoryPanel({ doc, allDocs, docOverrides, setDocOverrides, onClose, width = 340, isDragging = false, onDragStart }: {
  doc: any;
  allDocs: any[];
  docOverrides: Map<string, any>;
  setDocOverrides: React.Dispatch<React.SetStateAction<Map<string, any>>>;
  onClose: () => void;
  width?: number;
  isDragging?: boolean;
  onDragStart?: (e: React.MouseEvent) => void;
}) {
  const merged = (d: any) => ({ ...d, ...(docOverrides.get(d.document_id) || {}) });
  const thisDoc = merged(doc);

  const parentDoc = allDocs.find(d => d.document_id === thisDoc.parent_doc_id);
  const childDocs = allDocs.filter(d => {
    const m = merged(d);
    return m.parent_doc_id === doc.document_id;
  });

  // Timeline
  const timeline: Array<{id: string; date: string; event_type: string}> = thisDoc.doc_timeline || [];
  const sortedTimeline = [...timeline].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Link form state
  const [linkParentId, setLinkParentId] = useState(thisDoc.parent_doc_id || '');
  const [linkRelation, setLinkRelation] = useState(thisDoc.doc_relation || 'Amendment');
  const [tlDate, setTlDate] = useState(new Date().toISOString().slice(0, 10));
  const [tlType, setTlType] = useState('Amendment Executed');

  const applyLink = () => {
    if (!linkParentId) return;
    setDocOverrides(prev => {
      const next = new Map(prev);
      next.set(doc.document_id, { ...(next.get(doc.document_id) || {}), parent_doc_id: linkParentId, doc_relation: linkRelation });
      return next;
    });
  };

  const addTimelineEvent = () => {
    const evt = { id: `tl-${Date.now()}`, date: tlDate, event_type: tlType };
    const newTl = [...timeline, evt];
    setDocOverrides(prev => {
      const next = new Map(prev);
      next.set(doc.document_id, { ...(next.get(doc.document_id) || {}), doc_timeline: newTl });
      return next;
    });
  };

  const DOC_RELATION_TYPES = ['Amendment', 'Addendum', 'Exhibit', 'Renewal', 'Assignment', 'Termination'];
  const TL_EVENT_TYPES = ['Uploaded', 'Effective', 'Amendment Executed', 'Renewed', 'Countersigned', 'Assigned', 'Expired', 'Terminated', 'Under Review'];

  const INP: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.78rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{
      height: '100%', width: '100%', borderLeft: isDragging ? '3px solid #7c3aed' : '3px solid var(--primary-accent)',
      background: 'linear-gradient(180deg, #0e0b18 0%, #090910 100%)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
    }}>
      <div onMouseDown={onDragStart} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 10, background: isDragging ? 'rgba(124,58,237,0.5)' : 'transparent' }} onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.3)'; }} onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'transparent'; }} />
      {/* Header */}
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(196,181,253,0.45)', marginBottom: 4 }}>Document History</div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thisDoc.title || thisDoc.document_id}</div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(148,163,184,0.45)', marginTop: 2, textTransform: 'capitalize' }}>
              {thisDoc.document_type?.replace(/_/g, ' ')} {thisDoc.entity_name ? `· ${thisDoc.entity_name}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.45)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 0 0 12px', flexShrink: 0 }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>

        {/* Document chain */}
        {(parentDoc || childDocs.length > 0 || thisDoc.doc_relation) && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.4)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Document Chain</div>
            {parentDoc && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 6 }}>
                <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', flexShrink: 0 }}>Parent</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{parentDoc.title || parentDoc.document_id}</span>
              </div>
            )}
            {thisDoc.doc_relation && (
              <div style={{ fontSize: '0.7rem', color: 'rgba(196,181,253,0.55)', marginBottom: 4, paddingLeft: 4 }}>↳ This document is an <strong style={{ color: '#a78bfa' }}>{thisDoc.doc_relation}</strong></div>
            )}
            {childDocs.map(child => {
              const mc = merged(child);
              return (
                <div key={child.document_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, marginBottom: 4, marginLeft: 12 }}>
                  <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3, background: 'rgba(110,231,183,0.1)', color: '#6ee7b7', fontWeight: 600, textTransform: 'uppercase', flexShrink: 0 }}>{mc.doc_relation || 'Related'}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.title || child.document_id}</span>
                  <span style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.3)' }}>{child.effective_date || ''}</span>
                </div>
              );
            })}
          </div>
        )}


        {/* Timeline */}
        <div>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.4)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Document Timeline</div>

          {sortedTimeline.length > 0 ? (
            <div style={{ position: 'relative', paddingLeft: 22, marginBottom: 14 }}>
              <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.06)' }} />
              {sortedTimeline.map((evt, i) => (
                <div key={evt.id} style={{ position: 'relative', marginBottom: 12 }}>
                  <div style={{ position: 'absolute', left: -18, top: 8, width: 8, height: 8, borderRadius: '50%', background: i === 0 ? '#c4b5fd' : 'rgba(196,181,253,0.3)', border: '2px solid #090910' }} />
                  <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '8px 11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: '0.6rem', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{evt.event_type}</span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: 'rgba(148,163,184,0.35)' }}>{new Date(evt.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.74rem', color: 'rgba(148,163,184,0.28)', fontStyle: 'italic', marginBottom: 14, paddingLeft: 4 }}>No events recorded</div>
          )}

          {/* Add event form */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 7 }}>
            <input type="date" value={tlDate} onChange={e => setTlDate(e.target.value)} style={INP} />
            <select value={tlType} onChange={e => setTlType(e.target.value)} style={INP}>
              {TL_EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button onClick={addTimelineEvent} style={{ width: '100%', padding: '7px', borderRadius: 5, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Add Event
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Doc type config ──────────────────────────────────────────────────────────

// CONTRACT_TYPE_CATEGORIES and CONTRACT_TYPE_OPTIONS imported from @/lib/documentProfiles
const _CONTRACT_TYPE_CATEGORIES_PLACEHOLDER = [
  { label: 'Employment & Labor', options: [
    ['employment_agreement',            'Employment Agreement'],
    ['executive_employment_agreement',  'Executive Employment Agreement'],
    ['employee_nda',                    'Non-Disclosure Agreement (Employee NDA)'],
    ['non_compete_agreement',           'Non-Compete Agreement'],
    ['non_solicitation_agreement',      'Non-Solicitation Agreement'],
    ['separation_agreement',            'Separation Agreement'],
    ['severance_agreement',             'Severance Agreement'],
    ['consulting_agreement',            'Consulting Agreement'],
    ['independent_contractor_agreement','Independent Contractor Agreement'],
    ['staffing_agreement',              'Staffing Agreement'],
    ['collective_bargaining_agreement', 'Collective Bargaining Agreement'],
    ['employee_handbook_policy',        'Employee Handbook Policy'],
    ['commission_agreement',            'Commission Agreement'],
    ['bonus_agreement',                 'Bonus Agreement'],
  ]},
  { label: 'Technology & Software', options: [
    ['software_license_agreement',      'Software License Agreement'],
    ['saas_agreement',                  'SaaS Agreement'],
    ['software_development_agreement',  'Software Development Agreement'],
    ['technology_transfer_agreement',   'Technology Transfer Agreement'],
    ['source_code_license_agreement',   'Source Code License Agreement'],
    ['api_license_agreement',           'API License Agreement'],
    ['eula',                            'End User License Agreement (EULA)'],
    ['maintenance_support_agreement',   'Maintenance and Support Agreement'],
    ['system_integration_agreement',    'System Integration Agreement'],
    ['cloud_services_agreement',        'Cloud Services Agreement'],
    ['hosting_agreement',               'Hosting Agreement'],
    ['data_license_agreement',          'Data License Agreement'],
    ['open_source_license',             'Open Source License'],
  ]},
  { label: 'Intellectual Property', options: [
    ['patent_license_agreement',        'Patent License Agreement'],
    ['trademark_license_agreement',     'Trademark License Agreement'],
    ['copyright_license_agreement',     'Copyright License Agreement'],
    ['ip_assignment_agreement',         'IP Assignment Agreement'],
    ['co_development_agreement',        'Co-Development Agreement'],
    ['research_development_agreement',  'Research and Development Agreement'],
    ['joint_development_agreement',     'Joint Development Agreement'],
    ['trade_secret_agreement',          'Trade Secret Agreement'],
    ['franchise_agreement_ip',          'Franchise Agreement (IP-based)'],
    ['know_how_license',                'Know-How License'],
  ]},
  { label: 'Commercial & Sales', options: [
    ['msa',                             'Master Services Agreement (MSA)'],
    ['nda',                             'NDA — Non-Disclosure Agreement'],
	['transportation coordination service agreement', 'Transportation Coordinaton Service Agreement'],
    ['service_agreement',               'Service Agreement'],
    ['distribution_agreement',          'Distribution Agreement'],
    ['reseller_agreement',              'Reseller Agreement'],
    ['sales_agreement',                 'Sales Agreement'],
    ['purchase_order',                  'Purchase Order'],
    ['supply_agreement',                'Supply Agreement'],
    ['vendor_agreement',                'Service Provider Agreement'],
    ['marketing_agreement',             'Marketing Agreement'],
    ['advertising_agreement',           'Advertising Agreement'],
    ['sponsorship_agreement',           'Sponsorship Agreement'],
    ['co_marketing_agreement',          'Co-Marketing Agreement'],
    ['letter_of_intent',                'Letter of Intent (LOI)'],
    ['memorandum_of_understanding',     'Memorandum of Understanding (MOU)'],
    ['term_sheet',                      'Term Sheet'],
    ['general_contract',                'General Contract'],
  ]},
  { label: 'Real Estate & Property', options: [
    ['commercial_lease_agreement',      'Commercial Lease Agreement'],
    ['master_lease',                    'Master Lease Agreement'],
    ['lease_agreement',                 'Lease Agreement'],
    ['ground_lease',                    'Ground Lease'],
    ['sublease_agreement',              'Sublease Agreement'],
    ['lease_amendment',                 'Lease Amendment'],
    ['property_management_agreement',   'Property Management Agreement'],
    ['real_estate_purchase_agreement',  'Real Estate Purchase Agreement'],
    ['option_to_purchase',              'Option to Purchase'],
    ['easement_agreement',              'Easement Agreement'],
    ['right_of_way_agreement',          'Right of Way Agreement'],
    ['construction_loan_agreement',     'Construction Loan Agreement'],
    ['development_agreement',           'Development Agreement'],
  ]},
  { label: 'Finance & Lending', options: [
    ['loan_agreement',                  'Loan Agreement'],
    ['credit_agreement',                'Credit Agreement'],
    ['promissory_note',                 'Promissory Note'],
    ['security_agreement',              'Security Agreement'],
    ['pledge_agreement',                'Pledge Agreement'],
    ['guarantee_agreement',             'Guarantee Agreement'],
    ['line_of_credit_agreement',        'Line of Credit Agreement'],
    ['syndicated_loan_agreement',       'Syndicated Loan Agreement'],
    ['bridge_loan_agreement',           'Bridge Loan Agreement'],
    ['mezzanine_financing_agreement',   'Mezzanine Financing Agreement'],
    ['bond_indenture',                  'Bond Indenture'],
    ['debt_restructuring_agreement',    'Debt Restructuring Agreement'],
    ['loan_covenant',                   'Loan / Debt Covenant'],
  ]},
  { label: 'Corporate & M&A', options: [
    ['merger_agreement',                'Merger Agreement'],
    ['acquisition_agreement',           'Acquisition Agreement'],
    ['stock_purchase_agreement',        'Stock Purchase Agreement'],
    ['asset_purchase_agreement',        'Asset Purchase Agreement'],
    ['share_exchange_agreement',        'Share Exchange Agreement'],
    ['business_combination_agreement',  'Business Combination Agreement'],
    ['letter_of_intent_ma',             'Letter of Intent (M&A)'],
    ['ma_nda',                          'Confidentiality Agreement (M&A NDA)'],
    ['transition_services_agreement',   'Transition Services Agreement'],
    ['escrow_agreement',                'Escrow Agreement'],
  ]},
  { label: 'Investment & Venture', options: [
    ['venture_capital_agreement',       'Venture Capital Agreement'],
    ['term_sheet_vc',                   'Term Sheet (VC)'],
    ['shareholders_agreement',          'Shareholders Agreement'],
    ['investor_rights_agreement',       'Investor Rights Agreement'],
    ['convertible_note_agreement',      'Convertible Note Agreement'],
    ['safe_agreement',                  'SAFE Agreement'],
    ['co_investment_agreement',         'Co-Investment Agreement'],
    ['lp_agreement',                    'LP Agreement (Limited Partnership)'],
    ['gp_agreement',                    'GP Agreement (General Partnership)'],
    ['fund_formation_documents',        'Fund Formation Documents'],
  ]},
  { label: 'Professional Services', options: [
    ['subcontractor_agreement',         'Subcontractor Agreement'],
    ['project_management_agreement',    'Project Management Agreement'],
    ['advisory_agreement',              'Advisory Agreement'],
    ['management_consulting_agreement', 'Management Consulting Agreement'],
    ['management_agreement',            'Management Agreement'],
    ['legal_services_agreement',        'Legal Services Agreement'],
    ['accounting_services_agreement',   'Accounting Services Agreement'],
    ['engineering_services_agreement',  'Engineering Services Agreement'],
    ['architecture_agreement',          'Architecture Agreement'],
    ['it_services_agreement',           'IT Services Agreement'],
    ['marketing_services_agreement',    'Marketing Services Agreement'],
    ['event_management_agreement',      'Event Management Agreement'],
  ]},
  { label: 'Media & Entertainment', options: [
    ['production_agreement',            'Production Agreement'],
    ['media_distribution_agreement',    'Distribution Agreement (Media)'],
    ['media_license_agreement',         'Licensing Agreement (Media)'],
    ['publishing_agreement',            'Publishing Agreement'],
    ['option_agreement_film',           'Option Agreement (Film/TV)'],
  ]},
  { label: 'Data & Privacy', options: [
    ['data_processing_agreement',       'Data Processing Agreement (DPA)'],
    ['data_sharing_agreement',          'Data Sharing Agreement'],
    ['privacy_agreement',               'Privacy Agreement'],
    ['gdpr_dpa',                        'GDPR Data Processing Agreement'],
    ['ccpa_compliance_agreement',       'CCPA Compliance Agreement'],
    ['data_licensing_agreement',        'Data Licensing Agreement'],
    ['information_security_agreement',  'Information Security Agreement'],
    ['cybersecurity_agreement',         'Cybersecurity Agreement'],
  ]},
  { label: 'Hospitality', options: [
    ['hotel_management_agreement',      'Hotel Management Agreement'],
    ['franchise_agreement_hospitality', 'Franchise Agreement (Hospitality)'],
    ['food_beverage_agreement',         'Food and Beverage Agreement'],
    ['event_services_agreement',        'Event Services Agreement'],
    ['catering_agreement',              'Catering Agreement'],
    ['tourism_agreement',               'Tourism Agreement'],
    ['accommodation_agreement',         'Accommodation Agreement'],
  ]},
];

// All document_type values that should be treated as "Contract" for filtering
const CONTRACT_SUBTYPES = new Set([
  ...CONTRACT_TYPE_CATEGORIES.flatMap(cat => cat.options.map(([v]) => v)),
  'contract', 'franchise_agreement', 'license_agreement', 'partnership_agreement',
]);

const INSURANCE_TYPES   = new Set(['insurance_policy', 'insurance_certificate', 'insurance_endorsement', 'insurance_binder', 'insurance_renewal', 'insurance_schedule']);
const ACCOUNTING_TYPES  = new Set(['tax_document', 'invoice', 'financial_statement', 'audit_report', 'balance_sheet', 'income_statement', 'accounting_document', 'general_review']);
const GOVERNANCE_TYPES  = new Set(['corporate_resolution', 'board_minutes', 'annual_report', 'proxy_statement', 'bylaws', 'corporate_charter', 'shareholder_agreement', 'governance_document', 'sec_filing', '10_k', '8_k']);
const PERMITS_TYPES     = new Set(['operating_permit', 'liquor_license', 'zoning_permit', 'building_permit', 'health_permit', 'business_license', 'certificate_of_occupancy', 'environmental_permit', 'fire_permit', 'sign_permit']);

function getDocCategory(docType: string): string {
  if (!docType) return 'Contract';
  const dt = docType.toLowerCase();
  if (INSURANCE_TYPES.has(dt)  || dt.includes('insurance'))                                                    return 'Insurance';
  if (PERMITS_TYPES.has(dt)    || dt.includes('permit') || (dt.includes('license') && !dt.includes('software') && !dt.includes('api') && !dt.includes('source') && !dt.includes('ip') && !dt.includes('open'))) return 'Permits & Licenses';
  if (GOVERNANCE_TYPES.has(dt) || dt.includes('governance') || dt.includes('proxy') || dt.includes('bylaw') || dt.includes('resolution') || dt.includes('minutes') || dt.includes('charter') || dt.includes('annual_report') || dt.includes('sec_filing')) return 'Entity Governance';
  if (ACCOUNTING_TYPES.has(dt) || dt.includes('tax') || dt.includes('invoice') || dt.includes('accounting') || dt.includes('financial') || dt.includes('audit') || dt.includes('balance_sheet') || dt.includes('income_statement')) return 'Accounting';
  return 'Contract';
}

const DOC_TYPES = [
  { id: '',                label: 'All Types',       color: '#94a3b8' },
  { id: 'contract',        label: 'Contract',         color: '#60a5fa' },
  { id: 'insurance policy',label: 'Insurance Policy', color: '#a78bfa' },
  { id: 'license/permit',  label: 'License / Permit', color: '#34d399' },
  { id: 'invoice',         label: 'Invoice',          color: '#f59e0b' },
  { id: 'tax document',    label: 'Tax Document',     color: '#f87171' },
];

// SearchableSelect imported from @/components/ui/SearchableSelect (bug-fixed)

function _SearchableSelectUnused({
  value,
  onChange,
  options,
  style,
  placeholder = 'Select…',
  footerItems,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; group?: string }[];
  style?: React.CSSProperties;
  placeholder?: string;
  footerItems?: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, { capture: true, once: true });
    return () => { document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const q = query.toLowerCase();
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q) || (o.group ?? '').toLowerCase().includes(q))
    : options;

  const groupOrder: string[] = [];
  const groupMap = new Map<string, { value: string; label: string }[]>();
  for (const o of filtered) {
    const g = o.group ?? '';
    if (!groupMap.has(g)) { groupMap.set(g, []); groupOrder.push(g); }
    groupMap.get(g)!.push(o);
  }

  const selectedLabel = options.find(o => o.value === value)?.label ?? value ?? '';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', ...style }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{selectedLabel || placeholder}</span>
        <span style={{ fontSize: '0.55em', opacity: 0.4, flexShrink: 0 }}>▼</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 240),
            zIndex: 99999, background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column', maxHeight: 320,
          }}
        >
          <div style={{ padding: '7px 8px 5px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered.length > 0) { onChange(filtered[0].value); setOpen(false); }
              }}
              placeholder="Search…"
              style={{ width: '100%', padding: '5px 8px', borderRadius: 5, boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.13)', color: '#e2e8f0', fontSize: '0.78rem', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {filtered.length === 0 && <div style={{ padding: '12px', color: 'rgba(148,163,184,0.5)', fontSize: '0.75rem' }}>No results</div>}
            {groupOrder.map(g => (
              <div key={g}>
                {g && <div style={{ padding: '5px 10px 2px', fontSize: '0.61rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.4)', userSelect: 'none', position: 'sticky', top: 0, background: '#0f0f1a' }}>{g}</div>}
                {groupMap.get(g)!.map(o => (
                  <div
                    key={o.value}
                    onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
                    style={{ padding: '5px 12px 5px 16px', fontSize: '0.77rem', cursor: 'pointer', color: o.value === value ? '#a78bfa' : '#cbd5e1', background: o.value === value ? 'rgba(124,58,237,0.12)' : 'transparent', lineHeight: 1.4 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = o.value === value ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = o.value === value ? 'rgba(124,58,237,0.12)' : 'transparent'; }}
                  >
                    {o.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {footerItems && footerItems.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
              {footerItems.map((fi, i) => (
                <div
                  key={i}
                  onMouseDown={e => { e.preventDefault(); fi.onClick(); setOpen(false); }}
                  style={{ padding: '7px 12px', fontSize: '0.77rem', cursor: 'pointer', color: '#94a3b8' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#e2e8f0'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
                >
                  {fi.label}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}


// ─── Tab 2: Clause Extractor ──────────────────────────────────────────────────

interface ClassifiedClause extends ExtractedClause {
  clause_id?: string;
  obligation_type?: string;
  ai_classification?: string;  // AI-generated summary description
  affiliates_bound?: string[];
  ai_confidence?: number;
  is_obligation_candidate?: boolean;
  obligation_saved?: boolean;
  // Clause form axes — distinct from clause_type. Populated by
  // classify-clauses' form-classification pass.
  category?: string[];
  modifiers?: string[];
  linked_obligation_count?: number;
  derived_effects?: (string | null)[];
}

// ─── Inline obligation candidate check (client-safe, no server imports) ───────
const _OBL_TRIGGERS = [
  /\b(shall|must|will|is required to|are required to)\b/i,
  /\b(shall not|must not|may not|is prohibited from|is not permitted to)\b/i,
  /\b(within \d+|no later than|at least \d+|every \d+|annually|monthly|quarterly|weekly|daily)\b/i,
  /\b(notify|report|provide notice|deliver|submit|maintain|inspect|train|certify|comply|ensure|keep|retain|store|document)\b/i,
  /\b(coverage|insurance|policy|insured|endorsement|certificate|limit of liability)\b/i,
  /\b(obligation|duty|responsibility|requirement|condition)\b/i,
];
const _NON_OBL_TRIGGERS = [
  /^\s*(this agreement|this contract|the parties|as used in this|for purposes of|the following definitions)\b/i,
  /\b(means|is defined as|refers to|shall mean|shall refer to)\b/i,
  /\b(governing law|jurisdiction|venue|choice of law)\b/i,
  /\b(this agreement.*governed by|governed by.*laws of)\b/i,
  /\b(recital|whereas|background|counterparts|entire agreement)\b/i,
];

function checkObligationCandidate(text: string): boolean {
  if (_NON_OBL_TRIGGERS.some(p => p.test(text))) return false;
  return _OBL_TRIGGERS.filter(p => p.test(text)).length >= 1;
}

// Clause type → color mapping. Types not listed fall back to a neutral gray.
const _C = (r: string, g: string, b: string) => ({
  bg: `rgba(${r},${g},${b},0.12)`, text: `rgb(${r},${g},${b})`, border: `rgba(${r},${g},${b},0.3)`,
});
const CLAUSE_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  // ── Confidentiality / Privacy / IP (cyan) ─────────────────────────────────
  'Confidentiality':                   _C('6','182','212'),
  'Data Protection Clause':            _C('6','182','212'),
  'Intellectual Property Clause':      _C('6','182','212'),
  'Work for Hire / IP Ownership':      _C('6','182','212'),
  'Publicity / Press Release Clause':  _C('6','182','212'),
  // ── Indemnification / Liability / Hold Harmless (red) ─────────────────────
  'Indemnification':                   _C('239','68','68'),
  'Hold Harmless':                     _C('239','68','68'),
  'Exculpatory Clause':                _C('239','68','68'),
  'Joint & Several Liability':         _C('239','68','68'),
  'Release of Claims':                 _C('239','68','68'),
  'Waiver of Subrogation':             _C('239','68','68'),
  'Subrogation':                       _C('239','68','68'),
  // ── Termination (orange) ─────────────────────────────────────────────────
  'Termination For Convenience':       _C('249','115','22'),
  'Termination With Cause':            _C('249','115','22'),
  'Termination Without Cause':         _C('249','115','22'),
  'Termination by Either Party':       _C('249','115','22'),
  'Termination of Lease':              _C('249','115','22'),
  'Termination Fee / Break-Up Fee':    _C('249','115','22'),
  'Termination Payment':               _C('249','115','22'),
  'Early Termination':                 _C('249','115','22'),
  'Break Clause':                      _C('249','115','22'),
  'Sunset Clause':                     _C('249','115','22'),
  'Tail Period / Tail Clause':         _C('249','115','22'),
  'Material Breach':                   _C('249','115','22'),
  'Breach of Contract':                _C('249','115','22'),
  // ── Payment / Financial (green) ───────────────────────────────────────────
  'Payment Terms':                     _C('16','185','129'),
  'Revenue/Profit Sharing':            _C('16','185','129'),
  'Minimum Commitment':                _C('16','185','129'),
  'Price Restrictions':                _C('16','185','129'),
  'Price Adjustment / Escalation':     _C('16','185','129'),
  'Liquidated Damages':                _C('16','185','129'),
  'Penalty Clause':                    _C('16','185','129'),
  'Earn-Out Clause':                   _C('16','185','129'),
  'Holdback Clause':                   _C('16','185','129'),
  'Liquidation Preference':            _C('16','185','129'),
  'Clawback Clause':                   _C('16','185','129'),
  'Gross-Up Clause':                   _C('16','185','129'),
  'Escrow':                            _C('16','185','129'),
  'Milestone Clause':                  _C('16','185','129'),
  'Most Favored Nation':               _C('16','185','129'),
  'Set-Off / Offset Clause':           _C('16','185','129'),
  // ── Governing Law / Dispute (blue) ───────────────────────────────────────
  'Governing Law':                     _C('59','130','246'),
  'Jurisdiction / Choice of Law':      _C('59','130','246'),
  'Compliance with Laws':              _C('59','130','246'),
  'Sanctions & Export Control':        _C('59','130','246'),
  'Anti-Corruption / FCPA Clause':     _C('59','130','246'),
  'Dispute Resolution':                _C('99','102','241'),
  'Arbitration':                       _C('99','102','241'),
  'Specific Performance':              _C('99','102','241'),
  'Attorneys Fees Clause':             _C('99','102','241'),
  'Frustration of Purpose':            _C('99','102','241'),
  // ── License / IP Ownership (purple) ──────────────────────────────────────
  'License Grant':                     _C('124','58','237'),
  'Affiliate License':                 _C('124','58','237'),
  'Irrevocable Or Perpetual License':  _C('124','58','237'),
  'Non-Transferable License':          _C('124','58','237'),
  'Unlimited License':                 _C('124','58','237'),
  'Unlimited/All-You-Can-Eat License': _C('124','58','237'),
  'IP Ownership Assignment':           _C('124','58','237'),
  'Joint IP Ownership':                _C('124','58','237'),
  'Force Majeure':                     _C('124','58','237'),
  // ── Warranties / Representations (teal) ───────────────────────────────────
  'Warranties':                        _C('20','184','166'),
  'Warranty Duration':                 _C('20','184','166'),
  'Warranty Disclaimer / As Is':       _C('20','184','166'),
  'Representations And Warranties':    _C('20','184','166'),
  'Representations vs. Warranties':    _C('20','184','166'),
  'Disclaimer':                        _C('20','184','166'),
  // ── Limitation of Liability (amber) ───────────────────────────────────────
  'Limited Liability':                 _C('245','158','11'),
  'Consequential Damages Waiver':      _C('245','158','11'),
  'Acceleration Clause':               _C('245','158','11'),
  // ── Non-compete / Solicitation / Assignment (pink) ────────────────────────
  'Anti-Assignment':                   _C('236','72','153'),
  'Assignment Clause':                 _C('236','72','153'),
  'Non-Compete':                       _C('236','72','153'),
  'Non-Solicitation':                  _C('236','72','153'),
  'No-Solicit Of Customers':           _C('236','72','153'),
  'No-Solicit Of Employees':           _C('236','72','153'),
  'Non-Disparagement':                 _C('236','72','153'),
  'Non-Circumvention Clause':          _C('236','72','153'),
  'Covenant Not to Compete (M&A)':     _C('236','72','153'),
  'Standstill Clause':                 _C('236','72','153'),
  'No-Shop Clause':                    _C('236','72','153'),
  // ── Insurance / Risk (violet) ─────────────────────────────────────────────
  'Insurance':                         _C('168','85','247'),
  'Additional Insured':                _C('168','85','247'),
  // ── Notice / Renewal / Term (lime) ────────────────────────────────────────
  'Notice Requirements':               _C('132','204','22'),
  'Notice Clause':                     _C('132','204','22'),
  'Notice and Cure':                   _C('132','204','22'),
  'Notice Period To Terminate Renewal':_C('132','204','22'),
  'Renewal Term':                      _C('132','204','22'),
  'Renewal Clause':                    _C('132','204','22'),
  'Evergreen Clause':                  _C('132','204','22'),
  'Term':                              _C('132','204','22'),
  'Survival Clause':                   _C('132','204','22'),
  // ── Exclusivity / ROFR (rose) ─────────────────────────────────────────────
  'Exclusivity':                       _C('244','63','94'),
  'ROFR/ROFO/ROFN':                    _C('244','63','94'),
  'Right of First Refusal (ROFR)':     _C('244','63','94'),
  'Right of First Offer (ROFO)':       _C('244','63','94'),
  'Drag-Along Rights':                 _C('244','63','94'),
  'Tag-Along Rights (Co-Sale)':        _C('244','63','94'),
  'Anti-Dilution Clause':              _C('244','63','94'),
  'Lock-Up Agreement':                 _C('244','63','94'),
  'Call / Put Option Clause':          _C('244','63','94'),
  // ── Change of Control / M&A (sky) ────────────────────────────────────────
  'Change Of Control':                 _C('14','165','233'),
  'Material Adverse Change (MAC/MAE)': _C('14','165','233'),
  'Key Person Clause':                 _C('14','165','233'),
  'Step-In Rights':                    _C('14','165','233'),
  // ── Audit / Compliance (indigo) ───────────────────────────────────────────
  'Audit Rights':                      _C('79','70','229'),
  'Audit Clause':                      _C('79','70','229'),
  'Benchmarking Clause':               _C('79','70','229'),
};

function ClauseTypeBadge({ type }: { type: string }) {
  const colors = CLAUSE_TYPE_COLORS[type] || { bg: 'rgba(100,116,139,0.12)', text: '#94a3b8', border: 'rgba(100,116,139,0.3)' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.65rem', fontWeight: 600, background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  );
}

function FullDocumentView({ text, clause }: { text: string; clause: ClassifiedClause }) {
  const highlightRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [clause]);

  if (!text) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        No document text available
      </div>
    );
  }

  const start = typeof clause.char_start === 'number' ? clause.char_start : -1;
  const end = typeof clause.char_end === 'number' ? clause.char_end : -1;

  if (start < 0 || end <= start) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.73rem', lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </div>
    );
  }

  const before = text.slice(0, start);
  const clausePart = text.slice(start, end);
  const after = text.slice(end);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.73rem', lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <span style={{ opacity: 0.55 }}>{before}</span>
      <mark
        ref={highlightRef}
        style={{ background: 'rgba(167,139,250,0.18)', borderLeft: '3px solid #a78bfa', paddingLeft: 6, paddingRight: 2, color: 'var(--text-primary)', borderRadius: '0 3px 3px 0', fontWeight: 600, display: 'inline' }}
      >
        {clausePart}
      </mark>
      <span style={{ opacity: 0.55 }}>{after}</span>
    </div>
  );
}

// ─── Clause Extractor doc preview — matches DocumentPreviewPanel styling ──────
function ClauseExtractorPreviewPanel({
  text,
  clauses,
  selectedClause,
  docTitle,
  documentId,
  fileBlobUrl,
  cleaningText,
  onCleanText,
  onTextChange,
  width,
  recaptureClauseId,
  onRecaptured,
  onCancelRecapture,
}: {
  text: string;
  clauses: ClassifiedClause[];
  selectedClause: ClassifiedClause | null;
  docTitle: string;
  documentId?: string | null;
  fileBlobUrl?: string | null;
  cleaningText: boolean;
  onCleanText: () => void;
  onTextChange: (t: string) => void;
  width?: number;
  recaptureClauseId?: string | null;
  onRecaptured?: (clauseId: string, start: number, end: number) => void;
  onCancelRecapture?: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [search, setSearch] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [viewMode, setViewMode] = useState<'pdf' | 'text'>('text');
  const selectedRef = useRef<HTMLElement | null>(null);
  const currentMatchRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Fetch stored file URL for existing documents
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!documentId) { setFileUrl(null); return; }
    fetch(`/api/documents/${documentId}/file`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then(d => setFileUrl(d.url || null))
      .catch(() => setFileUrl(null));
  }, [documentId]);

  // Effective PDF URL: blob URL for just-uploaded files, stored URL for existing docs
  const effectivePdfUrl = fileBlobUrl || fileUrl;

  // Switch to text view on clause select (to show highlight) or recapture
  useEffect(() => {
    if (selectedClause || recaptureClauseId) setViewMode('text');
  }, [selectedClause?.clause_id, recaptureClauseId]);

  // Build the PDF src with an inline search term for the selected clause
  const pdfSearchTerm = selectedClause
    ? (selectedClause.clause_text || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    : '';
  const pdfSrc = effectivePdfUrl
    ? (pdfSearchTerm ? `${effectivePdfUrl}#search=${encodeURIComponent(pdfSearchTerm)}` : effectivePdfUrl)
    : '';

  // Update iframe src imperatively to avoid full remount (which would lose PDF scroll position)
  useEffect(() => {
    if (iframeRef.current && pdfSrc && iframeRef.current.src !== pdfSrc) {
      iframeRef.current.src = pdfSrc;
    }
  }, [pdfSrc]);

  // Scroll to the selected clause highlight after React renders the new mark element
  useEffect(() => {
    if (!selectedClause || viewMode !== 'text') return;
    // Small delay so the DOM has committed the new <mark> before we scroll
    const t = setTimeout(() => {
      selectedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => clearTimeout(t);
  }, [selectedClause?.clause_id, viewMode]);

  // Text-mode search
  const searchTerm = search.trim().toLowerCase();
  const searchLen = searchTerm.length;
  const searchMatches: number[] = [];
  if (searchLen > 0 && text) {
    const lower = text.toLowerCase();
    let si = 0;
    while (si < lower.length) {
      const found = lower.indexOf(searchTerm, si);
      if (found === -1) break;
      searchMatches.push(found);
      si = found + searchLen;
    }
  }
  const totalMatches = searchMatches.length;
  const curIdx = totalMatches ? Math.min(matchIdx, totalMatches - 1) : 0;
  useEffect(() => { setMatchIdx(0); }, [searchTerm]);
  useEffect(() => {
    currentMatchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [curIdx, searchTerm]);

  // Resolve char positions for the selected clause.
  // Prefer stored char_start/char_end; fall back to searching the clause text in the document.
  const resolvedSelected: (ClassifiedClause & { char_start: number; char_end: number }) | null = (() => {
    if (!selectedClause || !text) return null;
    const ct = (selectedClause.clause_text || '').trim();
    if (!ct) return null;
    let s = typeof selectedClause.char_start === 'number' && typeof selectedClause.char_end === 'number' && selectedClause.char_end > selectedClause.char_start
      ? selectedClause.char_start : -1;
    let e = s >= 0 ? selectedClause.char_end as number : -1;
    if (s < 0) {
      // Text-search fallback: find the clause text in the document
      const needle = ct.substring(0, 120).replace(/\s+/g, ' ').trim();
      const haystack = text.replace(/\s+/g, ' ');
      const idx = haystack.indexOf(needle.length > 60 ? needle.substring(0, 60) : needle);
      if (idx >= 0) { s = idx; e = Math.min(idx + ct.length, text.length); }
    }
    if (s < 0 || e <= s) return null;
    return { ...selectedClause, char_start: s, char_end: e };
  })();

  // Build highlighted segments (text mode only).
  // When a clause is selected: use only that clause for boundaries → single clean highlight.
  // When nothing selected: use all clauses with valid positions.
  const allSortedClauses = [...clauses]
    .filter(c => typeof c.char_start === 'number' && typeof c.char_end === 'number' && (c.char_end as number) > (c.char_start as number))
    .sort((a, b) => (a.char_start as number) - (b.char_start as number));
  const clausesForSegments = resolvedSelected
    ? [resolvedSelected]
    : allSortedClauses;

  interface Seg { start: number; end: number; clause?: ClassifiedClause; matchNo: number }
  const segments: Seg[] = [];
  if (text) {
    const boundaries = new Set<number>([0, text.length]);
    for (const c of clausesForSegments) {
      boundaries.add(c.char_start as number);
      boundaries.add(Math.min(c.char_end as number, text.length));
    }
    if (searchLen > 0) {
      for (const pos of searchMatches) { boundaries.add(pos); boundaries.add(Math.min(pos + searchLen, text.length)); }
    }
    const pts = [...boundaries].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i], e = pts[i + 1], mid = (s + e) / 2;
      const matchNo = searchLen > 0 ? searchMatches.findIndex(pos => mid >= pos && mid < pos + searchLen) : -1;
      const clause = matchNo === -1 ? clausesForSegments.find(c => mid >= (c.char_start as number) && mid < (c.char_end as number)) : undefined;
      segments.push({ start: s, end: e, clause, matchNo });
    }
  }

  const pageWidth = Math.max(300, Math.round(560 * zoom / 100));
  // Collapse runs of 3+ blank lines to 2 so PDF header whitespace doesn't
  // make the preview look empty, then strip leading/trailing blank lines.
  const displayText = text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');

  return (
    <div style={{ width: width ?? 460, flexShrink: 0, minHeight: 0, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar — same structure as DocumentPreviewPanel */}
      <div style={{ padding: '7px 14px 7px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'var(--bg-elevated)' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {docTitle}
        </span>
        {/* Text search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,0.05)', border: `1px solid ${search.trim() ? 'rgba(245,158,11,0.5)' : 'var(--border-color)'}`, borderRadius: 5, padding: '3px 7px', flexShrink: 0 }}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(148,163,184,0.5)', lineHeight: 1 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setMatchIdx(i => totalMatches ? (i >= totalMatches - 1 ? 0 : i + 1) : 0); if (e.key === 'Escape') setSearch(''); }}
            placeholder="Search"
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.72rem', width: 88, fontFamily: 'inherit' }} />
          {search.trim() && <>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', borderLeft: '1px solid var(--border-color)', paddingLeft: 5 }}>
              {totalMatches ? `${curIdx + 1}/${totalMatches}` : '0/0'}
            </span>
            <button onClick={() => setMatchIdx(i => i <= 0 ? totalMatches - 1 : i - 1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 1px', fontSize: '0.55rem', lineHeight: 1 }}>▲</button>
            <button onClick={() => setMatchIdx(i => i >= totalMatches - 1 ? 0 : i + 1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 1px', fontSize: '0.55rem', lineHeight: 1 }}>▼</button>
          </>}
        </div>
        {/* Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <button onClick={() => setZoom(z => Math.max(50, z - 10))}
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer', width: 18, height: 18, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>−</button>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: 30, textAlign: 'center' }}>{zoom}%</span>
          <button onClick={() => setZoom(z => Math.min(200, z + 10))}
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer', width: 18, height: 18, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>+</button>
        </div>
        {/* PDF / Text toggle */}
        {effectivePdfUrl && (
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-color)', flexShrink: 0 }}>
            {(['pdf', 'text'] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)}
                style={{ padding: '2px 8px', background: viewMode === mode ? 'rgba(255,255,255,0.08)' : 'transparent', border: 'none', color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '0.68rem', fontWeight: viewMode === mode ? 600 : 400, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {mode}
              </button>
            ))}
          </div>
        )}
        {effectivePdfUrl && (
          <a href={effectivePdfUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '0.65rem', color: 'rgba(148,163,184,0.45)', textDecoration: 'none', border: '1px solid var(--border-color)', borderRadius: 3, padding: '2px 5px', flexShrink: 0, lineHeight: 1.4 }}
            title="Open PDF in new tab">↗</a>
        )}
        {editMode ? (
          <>
            <button onClick={() => { onTextChange(editDraft); setEditMode(false); }}
              style={{ padding: '3px 10px', borderRadius: 5, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
              Done
            </button>
            <button onClick={() => setEditMode(false)}
              style={{ padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', flexShrink: 0 }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => { setEditDraft(text); setEditMode(true); }}
              style={{ padding: '3px 8px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', flexShrink: 0 }}>
              Edit
            </button>
            <button onClick={onCleanText} disabled={cleaningText}
              style={{ padding: '3px 10px', borderRadius: 5, background: cleaningText ? 'rgba(124,58,237,0.06)' : 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.3)', color: cleaningText ? 'var(--text-muted)' : '#a78bfa', fontSize: '0.7rem', cursor: cleaningText ? 'default' : 'pointer', fontWeight: 600, flexShrink: 0 }}>
              {cleaningText ? '✦ Cleaning…' : '✦ Re-clean'}
            </button>
          </>
        )}
      </div>

      {/* Recapture banner */}
      {recaptureClauseId && (
        <div style={{ padding: '7px 14px', background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: '0.72rem', color: '#fbbf24', flex: 1 }}>Select the correct clause text in the document below, then release the mouse to recapture the highlight.</span>
          <button onClick={onCancelRecapture} style={{ background: 'none', border: 'none', color: 'rgba(251,191,36,0.5)', cursor: 'pointer', fontSize: '0.8rem', padding: '0 2px', lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* Document area */}
      {viewMode === 'pdf' && effectivePdfUrl ? (
        <iframe
          ref={iframeRef}
          src={pdfSrc}
          title={docTitle}
          style={{ flex: 1, border: 'none', width: '100%', minHeight: 0, display: 'block', background: '#1a1a2e' }}
        />
      ) : !text || !displayText.trim() ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{!text ? 'No document text available' : 'Document text is blank — try re-uploading or using a different file'}</div>
      ) : editMode ? (
        <textarea
          value={editDraft}
          onChange={e => setEditDraft(e.target.value)}
          style={{
            flex: 1, resize: 'none', border: 'none', outline: 'none',
            background: '#0f0f14', color: '#e2e8f0',
            fontFamily: '"Times New Roman", Times, Georgia, serif',
            fontSize: '0.83rem', lineHeight: 1.75, padding: '20px',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#111118', padding: '20px 16px' }}>
          <div
            ref={pageRef}
            onMouseUp={() => {
              if (!recaptureClauseId || !onRecaptured || !pageRef.current) return;
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
              const range = sel.getRangeAt(0);
              try {
                const preStart = document.createRange();
                preStart.setStart(pageRef.current, 0);
                preStart.setEnd(range.startContainer, range.startOffset);
                const start = preStart.toString().length;
                const preEnd = document.createRange();
                preEnd.setStart(pageRef.current, 0);
                preEnd.setEnd(range.endContainer, range.endOffset);
                const end = preEnd.toString().length;
                if (end > start) {
                  onRecaptured(recaptureClauseId, start, end);
                  sel.removeAllRanges();
                }
              } catch { /* selection outside document area */ }
            }}
            style={{
            background: '#ffffff',
            margin: '0 auto',
            width: pageWidth,
            maxWidth: '100%',
            minHeight: '100%',
            padding: `${Math.round(56 * zoom / 100)}px ${Math.round(64 * zoom / 100)}px`,
            boxShadow: '0 2px 20px rgba(0,0,0,0.6)',
            borderRadius: 2,
            fontSize: `${(zoom / 100) * 0.83}rem`,
            lineHeight: 1.85,
            color: '#1a1a1a',
            fontFamily: '"Times New Roman", Times, Georgia, serif',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            boxSizing: 'border-box',
            cursor: recaptureClauseId ? 'text' : undefined,
            outline: recaptureClauseId ? '2px dashed rgba(245,158,11,0.5)' : 'none',
          } as React.CSSProperties}>
            {(clausesForSegments.length > 0 || searchLen > 0) && segments.length > 0 ? segments.map((seg, i) => {
              const segText = text.slice(seg.start, seg.end);
              if (seg.matchNo !== -1) {
                const isCurrent = seg.matchNo === curIdx;
                return (
                  <mark key={i}
                    ref={isCurrent ? el => { currentMatchRef.current = el; } : undefined}
                    style={{ background: isCurrent ? '#f59e0b' : '#fde68a', color: '#111', borderRadius: 2, padding: '0 1px' }}>
                    {segText}
                  </mark>
                );
              }
              if (seg.clause) {
                if (selectedClause) {
                  // Single-clause mode: yellow highlight exactly like the Clause Library viewer
                  return (
                    <mark key={i}
                      ref={el => { if (el) selectedRef.current = el; }}
                      style={{ background: 'rgba(251,191,36,0.38)', color: '#78350f', borderRadius: 3, outline: '2px solid rgba(251,191,36,0.65)', outlineOffset: 2 }}>
                      {segText}
                    </mark>
                  );
                }
                // No clause selected: show all with type colours so user can see the full map
                const type = seg.clause.detected_type || seg.clause.obligation_type || '';
                const colors = CLAUSE_TYPE_COLORS[type] || { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8', border: 'rgba(100,116,139,0.4)' };
                return (
                  <mark key={i}
                    style={{ background: colors.bg, borderBottom: `2px solid ${colors.border}`, borderRadius: 2, color: '#1a1a1a' }}>
                    {segText}
                  </mark>
                );
              }
              return <span key={i}>{segText}</span>;
            }) : displayText}
          </div>
        </div>
      )}
    </div>
  );
}

// Exported (in addition to this file's default export) so
// app/(app)/documents/parser/page.tsx can render it standalone.
export function ClauseExplorerTab() {
  const [docs, setDocs] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [assets,   setAssets]   = useState<any[]>([]);
  const [uploadMode, setUploadMode] = useState<'existing' | 'new'>('existing');

  // Existing doc mode
  const [selectedDocId, setSelectedDocId] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);

  // New file mode
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newFileBlobUrl, setNewFileBlobUrl] = useState<string | null>(null);
  const [newFileText, setNewFileText] = useState('');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocType, setNewDocType] = useState('general_contract');
  // Populated by the auto-classify call in handleFileSelect (same
  // classifyDocument() engine bulk upload uses) — lets the "Save to
  // Contracts" checkbox and paper-source/governing-law/facing fields
  // pre-fill from a real classification instead of always defaulting to
  // 'internal'/blank/'client', while the user still reviews before Save.
  const [docTypeClassifying, setDocTypeClassifying] = useState(false);
  const [docTypeClassification, setDocTypeClassification] = useState<{
    documentType: string; confidence: number; method: string;
  } | null>(null);
  const [customDocTypes, setCustomDocTypes] = useState<string[]>([]);
  const [showAddDocType, setShowAddDocType] = useState(false);
  const [newDocTypeName, setNewDocTypeName] = useState('');
  const [newEntityName, setNewEntityName] = useState('');
  const [newCounterpartyName, setNewCounterpartyName] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);

  // Preview panel (bottom)
  const [previewText, setPreviewText] = useState('');
  const [previewVisible, setPreviewVisible] = useState(true);
  const [showOptions, setShowOptions] = useState(false);
  const [cleaningText, setCleaningText] = useState(false);
  const [ocrUsed, setOcrUsed] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(460);
  const previewResizeDragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Schemas
  const [schemas, setSchemas] = useState<string[]>(['auto']);
  const [detectingSchema, setDetectingSchema] = useState(false);
  const [schemaReason, setSchemaReason] = useState('');
  // #, No., Name, Clause Text, Summary, Type, actions
  const [clauseExColWidths, setClauseExColWidths] = useState([30, 70, 140, 340, 160, 120, 28]);
  const clauseExResizeDragRef = useRef<{ col: number; startX: number; startW: number } | null>(null);
  function startClauseExColResize(col: number, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const startW = clauseExColWidths[col];
    clauseExResizeDragRef.current = { col, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      const drag = clauseExResizeDragRef.current;
      if (!drag) return;
      const delta = ev.clientX - drag.startX;
      setClauseExColWidths(prev => { const n = [...prev]; n[drag.col] = Math.max(28, drag.startW + delta); return n; });
    };
    const onUp = () => { clauseExResizeDragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Extraction / classification
  const [extracting, setExtracting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [clauses, setClauses] = useState<ClassifiedClause[]>([]);
  const [selectedClause, setSelectedClause] = useState<ClassifiedClause | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [clauseSortKey, setClauseSortKey] = useState('');
  const [clauseSortDir, setClauseSortDir] = useState<'asc' | 'desc'>('asc');

  // Subclause grouping
  const [subclauseMode, setSubclauseMode] = useState<'combined' | 'separate'>('combined');

  // Save
  const [saving, setSaving] = useState(false);
  const [saveDocToTable, setSaveDocToTable] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [savedObligationCount, setSavedObligationCount] = useState(0);
  const [customExtractorTypes, setCustomExtractorTypes] = useState<string[]>([]);
  const [addingTypeRow, setAddingTypeRow] = useState<number | null>(null);
  const [newTypeValue, setNewTypeValue] = useState('');
  const [recapturingClauseId, setRecapturingClauseId] = useState<string | null>(null);

  // Counter-party picker (client / vendor)
  const [extractorFacing, setExtractorFacing] = useState<'client' | 'vendor'>('client');
  const [extractorCounterpartyId, setExtractorCounterpartyId] = useState('');
  const [extractorNewName, setExtractorNewName] = useState('');
  const [extractorNewVendorType, setExtractorNewVendorType] = useState('');
  const [extractorVendors, setExtractorVendors] = useState<any[]>([]);
  const [extractorClients, setExtractorClients] = useState<any[]>([]);
  // Extra contract fields shown when "Save to Contracts Table" is on
  const [savePaperSource, setSavePaperSource] = useState('internal');
  const [saveGoverningLaw, setSaveGoverningLaw] = useState('');
  // Pre-filled from classification's deterministic date-regex guesses (see
  // classifyNewDocType) — previously handleSave hardcoded effective_date to
  // today and expiration_date to '' unconditionally, silently discarding a
  // date the document itself states (e.g. "shall terminate on August 1,
  // 2027"). Still user-editable before Save, same as the other fields here.
  const [saveEffectiveDate, setSaveEffectiveDate] = useState('');
  const [saveExpirationDate, setSaveExpirationDate] = useState('');
  const [saveCounterpartyType, setSaveCounterpartyType] = useState('');
  const [customCounterpartyTypes, setCustomCounterpartyTypes] = useState<string[]>([]);
  const [addingCounterpartyType, setAddingCounterpartyType] = useState(false);
  const [newCounterpartyTypeName, setNewCounterpartyTypeName] = useState('');
  const counterpartyTypeOptions = [
    ...DEFAULT_COUNTERPARTY_TYPES.map(t => ({ value: t, label: t, group: '' })),
    ...customCounterpartyTypes.map(t => ({ value: t, label: t, group: 'Custom' })),
  ];

  // ── Insurance policy extraction — folded into the normal clause Save
  // action (see handleSave) rather than a separate Extract step. Saves to
  // insurance_policies, never to contracts — a policy can cover multiple
  // clients at once, which doesn't fit contracts' one-client shape.
  const [saveToInsuranceTable, setSaveToInsuranceTable] = useState(true);

  const autoSaveObligations = useCallback(async (candidates: ClassifiedClause[], docId: string, docContext?: { entity_id?: string | null; asset_id?: string | null }) => {
    if (candidates.length === 0) return;
    try {
      const rows = candidates.map(c => ({
        source_document_id:  docId,
        source_clause_id:    c.clause_id || '',
        document_id:         docId,
        obligation_type:     c.obligation_type && c.obligation_type !== 'other' ? c.obligation_type : 'maintenance',
        action_text:         (c.clause_text || '').slice(0, 400),
        source_text:         c.clause_text || '',
        status:              'active',
        confidence:          c.confidence ?? null,
        related_entity_id:   docContext?.entity_id || null,
        entity_id:           docContext?.entity_id || null,
        related_asset_id:    docContext?.asset_id  || null,
        asset_id:            docContext?.asset_id  || null,
      }));
      const res = await fetch('/api/obligations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      });
      const d = await res.json();
      const saved = (d.obligations || [d.obligation]).filter(Boolean).length;
      setSavedObligationCount(prev => prev + saved);
      // Mark the clauses as saved
      setClauses(prev => prev.map(c =>
        candidates.some(ca => (ca.clause_id || ca.clause_text) === (c.clause_id || c.clause_text))
          ? { ...c, obligation_saved: true } : c
      ));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchDocumentsCached().then(setDocs);
    fetch('/api/vendors').then(r => r.json()).then(d => setExtractorVendors(d.service_providers || [])).catch(() => {});
    fetch('/api/customers').then(r => r.json()).then(d => setExtractorClients(d.clients || [])).catch(() => {});
    // Registered "our" entities (Company Settings) — feeds knownEntityNames
    // below so party detection can tell which side of a contract is us.
    fetch('/api/entities').then(r => r.json()).then(d => setEntities(d.entities || [])).catch(() => {});
    try {
      const stored = localStorage.getItem('consola_clause_types');
      if (stored) setCustomExtractorTypes(JSON.parse(stored));
    } catch { /* ignore */ }
    setCustomDocTypes(getCustomDocumentTypes());
    setCustomCounterpartyTypes(getCustomCounterpartyTypes());
  }, []);

  const loadDocText = async (docId: string) => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await supabase.from('documents').select('*').eq('document_id', docId).single();
    return data;
  };

  const runSchemaDetect = async (text: string) => {
    setDetectingSchema(true);
    setSchemaReason('');
    try {
      const res = await fetch('/api/documents/detect-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.substring(0, 3000) }),
      });
      const data = await res.json();
      if (data.schemas?.length) {
        setSchemas(data.schemas);
        setSchemaReason(data.reason || '');
      }
    } catch { /* silent */ } finally {
      setDetectingSchema(false);
    }
  };

  const handleDocSelect = async (docId: string) => {
    setSelectedDocId(docId);
    setSchemaReason('');
    setClauses([]);
    setSelectedClause(null);
    setPreviewText('');
    if (!docId) { setSelectedDoc(null); return; }
    try {
      const doc = await loadDocText(docId);
      setSelectedDoc(doc);
      let text: string = doc?.file_text || '';

      // Fallback: if no cached text in DB, fetch the file from storage and extract
      if (!text) {
        try {
          const fileRes = await fetch(`/api/documents/${docId}/file`);
          if (fileRes.ok) {
            const { url, name } = await fileRes.json();
            if (url) {
              const blob = await fetch(url).then(r => r.blob());
              const fd = new FormData();
              fd.append('file', new File([blob], name || `${docId}.pdf`, { type: blob.type || 'application/pdf' }));
              const previewRes = await fetch('/api/documents/preview-text', { method: 'POST', body: fd });
              if (previewRes.ok) {
                const previewData = await previewRes.json();
                if (previewData.text) text = previewData.text;
              }
            }
          }
        } catch { /* storage fallback failed — show empty */ }
      }

      if (text) {
        setPreviewText(text);
        setPreviewVisible(true);
        await runSchemaDetect(text);
      }
    } catch { /* silent */ }
  };

  useEffect(() => {
    if (!newFile) { setNewFileBlobUrl(null); return; }
    const url = URL.createObjectURL(newFile);
    setNewFileBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [newFile]);

  // Auto-classifies Source Type on file select (same classifyDocument()
  // engine bulk upload uses) instead of leaving newDocType stuck at
  // 'general_contract' and "Save to Contracts" unchecked until the user
  // does both by hand. Only ever pre-fills fields the user can still see
  // and change before Save — never auto-creates a client/vendor record
  // (only pre-selects an EXISTING counterparty match by name; a hallucinated
  // or misspelled AI guess is not a reliable enough signal to create one).
  const classifyNewDocType = async (text: string, fileName: string) => {
    setDocTypeClassifying(true);
    try {
      const res = await fetch('/api/documents/classify-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName }),
      });
      if (!res.ok) return;
      const { classification } = await res.json();
      if (!classification || classification.documentType === 'unknown') return;
      setDocTypeClassification(classification);
      setNewDocType(classification.documentType);

      const isInsuranceType = classification.documentType === 'insurance_policy' || classification.documentType === 'certificate_of_insurance';
      const isNonBilateral = classification.documentType === 'regulation' || classification.documentType === 'entity_fact_document';
      if (isInsuranceType || isNonBilateral) return; // no contracts-row pre-fill for either

      setSaveDocToTable(true); // parity with insurance's already-true default — a confidently-classified bilateral contract auto-saves to Contracts unless the user unchecks it
      if (classification.paperSourceGuess === 'internal' || classification.paperSourceGuess === 'counter_party') {
        setSavePaperSource(classification.paperSourceGuess);
      }
      if (classification.governingLawGuess) setSaveGoverningLaw(classification.governingLawGuess);
      if (classification.effectiveDateGuess) setSaveEffectiveDate(classification.effectiveDateGuess);
      if (classification.expirationDateGuess) setSaveExpirationDate(classification.expirationDateGuess);
      if (classification.contractFacingGuess) setExtractorFacing(classification.contractFacingGuess);

      if (classification.counterpartyNameGuess) {
        const guess = (classification.counterpartyNameGuess as string).toLowerCase();
        const list = classification.contractFacingGuess === 'vendor' ? extractorVendors : extractorClients;
        const idKey = classification.contractFacingGuess === 'vendor' ? 'service_provider_id' : 'client_id';
        const nameKey = classification.contractFacingGuess === 'vendor' ? 'legal_name' : 'client_name';
        const match = list.find((p: any) => {
          const n = (p[nameKey] || '').toLowerCase();
          return n && (n.includes(guess) || guess.includes(n));
        });
        if (match) setExtractorCounterpartyId(match[idKey]);
      }
    } catch { /* best-effort — user can still pick Source Type manually */ } finally {
      setDocTypeClassifying(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setNewFile(file);
    setNewDocTitle(prev => prev || file.name.replace(/\.[^.]+$/, ''));
    setUploadingFile(true);
    setPreviewText('');
    setOcrUsed(false);
    setClauses([]);
    setSelectedClause(null);
    setDocTypeClassification(null);
    setSaveEffectiveDate('');
    setSaveExpirationDate('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/documents/preview-text', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.text) {
        setNewFileText(data.text);
        setPreviewText(data.text);
        setPreviewVisible(true);
        const wasOcr = !!data.ocr_used;
        setOcrUsed(wasOcr);
        await runSchemaDetect(data.text);
        classifyNewDocType(data.text, file.name); // fire-and-forget — doesn't block extraction on classification

        // Skip auto-clean for OCR documents — running an LLM over mixed OCR output
        // (contract text + invoice tables + signature pages) degrades quality.
        if (!wasOcr) {
          setCleaningText(true);
          try {
            const cleanRes = await fetch('/api/documents/clean-text', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: data.text }),
            });
            const cleanData = await cleanRes.json();
            if (cleanData.text) {
              setNewFileText(cleanData.text);
              setPreviewText(cleanData.text);
            }
          } catch { /* silent — raw text remains usable */ } finally {
            setCleaningText(false);
          }
        }
      }
    } catch { /* silent */ } finally {
      setUploadingFile(false);
    }
  };

  const handleCleanText = async () => {
    if (!previewText || cleaningText) return;
    if (ocrUsed) {
      alert('This document was extracted via OCR. AI text cleaning on OCR output tends to remove valid clause content along with the noise — the raw OCR text is more reliable for extraction. Use the rule-based extraction below instead.');
      return;
    }
    setCleaningText(true);
    try {
      const res = await fetch('/api/documents/clean-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: previewText }),
      });
      const data = await res.json();
      if (data.text) {
        setPreviewText(data.text);
        if (uploadMode === 'new') setNewFileText(data.text);
        if (data.localOnly) {
          alert('Clean Text: Groq is rate-limited — basic rule-based cleaning was applied instead (page numbers, reversed headings, blank lines). You can also click Edit to fix text manually.');
        } else if (data.failedChunks > 0) {
          alert(`Clean Text: Groq was unavailable for ${data.failedChunks}/${data.totalChunks} chunk(s) — rule-based cleaning was applied to those sections.`);
        }
      } else {
        alert('Clean Text failed: ' + (data.error || 'Unknown error. Check that Groq API is reachable.'));
      }
    } catch (err: any) {
      alert('Clean Text error: ' + (err?.message || 'Network error'));
    } finally {
      setCleaningText(false);
    }
  };

  const addSchema = () => setSchemas(prev => [...prev, 'auto']);
  const removeSchema = (i: number) => setSchemas(prev => prev.filter((_, idx) => idx !== i));
  const moveSchema = (i: number, dir: -1 | 1) => {
    setSchemas(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const activeText  = uploadMode === 'new' ? newFileText : (selectedDoc?.file_text || '');
  const canExtract  = uploadMode === 'existing' ? !!selectedDocId : !!newFileText;
  const currentDocType = uploadMode === 'existing' ? selectedDoc?.document_type : newDocType;
  // Insurance Policy = the underwriter's policy doc — has an insurer and a
  // named insured (the company being insured), never a "covered client."
  // COI = a certificate that names which of OUR clients are covered under
  // that policy — the only insurance-family doc type that should ever
  // populate linked_client_ids. Neither has a normal client/vendor
  // counterparty the way a regular contract does.
  const isInsuranceDoc = currentDocType === 'insurance_policy';
  const isCoiDoc = currentDocType === 'certificate_of_insurance';
  const isInsuranceFamily = isInsuranceDoc || isCoiDoc;
  // A regulation binds no counterparty and an entity-fact document (financial
  // statement, registration, license, EIN/W-9) isn't an agreement at all —
  // neither belongs in `contracts` any more than an insurance policy does.
  // See lib/documents/classifyDocument.ts's NON_BILATERAL_DOCUMENT_TYPES.
  const isNonBilateralDoc = currentDocType === 'regulation' || currentDocType === 'entity_fact_document';
  // Contract-relationship fields (Paper Source, Governing Law, Counterparty
  // Type, dates) only apply to bilateral agreements + order forms — never a
  // regulation, entity-fact doc, or insurance-family doc.
  const CONTRACT_OR_ORDER_FORM_TYPES = new Set(
    CONTRACT_TYPE_CATEGORIES
      .filter(cat => cat.label !== 'Insurance' && cat.label !== 'Regulatory & Entity-Fact Documents')
      .flatMap(cat => cat.options.map(([v]) => v)),
  );
  const isContractOrOrderForm = !!currentDocType && CONTRACT_OR_ORDER_FORM_TYPES.has(currentDocType);
  const entityMap   = Object.fromEntries(entities.map(e => [e.entity_id, e.name]));
  const assetMap    = Object.fromEntries(assets.map(a => [a.asset_id, a.name]));

  // Strip common prefixes and trailing periods so "Section 4.1" → "4.1", "4.1." → "4.1"
  function normalizeClauseNo(no: string): string {
    return no
      .replace(/^(section|article|clause|exhibit|schedule|appendix|part|chapter)\s+/i, '')
      .trim()
      .replace(/\.$/, '');
  }

  // Merge subclauses (4.1, 4.2, …) into their parent clause (4) when mode is 'combined'
  function applySubclauseMode(clauses: ExtractedClause[], mode: 'combined' | 'separate'): ExtractedClause[] {
    if (mode === 'separate') return clauses;
    const result: ExtractedClause[] = [];
    const parentMap = new Map<string, ExtractedClause>();

    for (const clause of clauses) {
      const rawNo = (clause.clause_no ?? '').trim();
      const no = normalizeClauseNo(rawNo);
      // Detect subclause:
      //   decimal:    4.1, 4.1.2
      //   letter sub: 4a, 4b
      //   paren sub:  9(a), 9(b), 9(A)
      const isSubclause =
        /^[\dA-Za-z]+(\.\d+)+$/.test(no) ||
        /^\d+[a-z]$/.test(no) ||
        /^\d+\([a-zA-Z]\)$/.test(no);

      if (isSubclause) {
        const parentNo = no.includes('.')
          ? no.split('.').slice(0, -1).join('.')
          : no.replace(/[a-z]$/, '').replace(/\([a-zA-Z]\)$/, '');
        const parent = parentMap.get(parentNo);
        if (parent) {
          parent.clause_text += '\n\n' + (rawNo ? `${rawNo}  ` : '') + clause.clause_text;
          parent.char_end = clause.char_end;
          continue;
        }
      }

      const copy = { ...clause };
      result.push(copy);
      parentMap.set(no || rawNo, copy);
    }
    return result;
  }

  const handleExtract = async () => {
    if (!canExtract) return;
    setExtracting(true);
    setClauses([]);
    setSelectedClause(null);
    try {
      // Prefer previewText so that Clean Text changes are reflected in extraction
      const text = previewText || activeText;
      if (!text) {
        alert('No document text available. Re-upload the document to extract text.');
        return;
      }
      // For OCR'd documents use the rule-based extractor directly — it is deterministic,
      // has no token-limit truncation, and ignores invoice/signature page noise.
      // For normal text PDFs use LlamaParse which handles party detection + typing.
      let extracted: ExtractedClause[];
      let entity_names: string[] | undefined;
      let counterparty_names: string[] | undefined;

      if (ocrUsed) {
        extracted = extractClausesRuleBased(text);
        if (!extracted.length) {
          alert('No clauses found in the extracted text. The OCR output may be incomplete — try uploading a clearer scan.');
          return;
        }
      } else {
        const extractRes = await fetch('/api/documents/extract-clauses-llama', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            knownEntityNames: entities.map((e: any) => e.name).filter(Boolean),
            knownAssetNames: assets.map((a: any) => a.name).filter(Boolean),
            availableClauseTypes: [...new Set([...CANONICAL_CLAUSE_TYPES, ...customExtractorTypes])],
          }),
        });
        if (!extractRes.ok) {
          const errBody = await extractRes.json().catch(() => null);
          alert(errBody?.error || 'Clause extraction failed. Please try again.');
          return;
        }
        const parsed: { clauses: ExtractedClause[]; entity_names?: string[]; counterparty_names?: string[] } = await extractRes.json();
        extracted = parsed.clauses;
        entity_names = parsed.entity_names;
        counterparty_names = parsed.counterparty_names;
      }
      if (!extracted?.length) {
        setClauses([]);
        alert('No clauses were found in this document. Please try again.');
        return;
      }
      // Pre-fill party fields if not already set — join multiples with " / "
      if (!newEntityName && entity_names?.length) setNewEntityName(entity_names.join(' / '));
      if (!newCounterpartyName && counterparty_names?.length) setNewCounterpartyName(counterparty_names.join(' / '));
      const grouped = applySubclauseMode(extracted, subclauseMode);
      setClauses(grouped.map(c => ({ ...c })));
      setClassifying(true);
      try {
        const resp = await fetch('/api/documents/classify-clauses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId: uploadMode === 'existing' ? selectedDocId : 'tmp',
            clauses: grouped,
            entityId: selectedDoc?.entity_id,
            entityName: newEntityName || entity_names?.[0] || selectedDoc?.entity_name,
            counterpartyName: newCounterpartyName || counterparty_names?.join(' / ') || selectedDoc?.counterparty_name,
            availableClauseTypes: [...new Set([...CANONICAL_CLAUSE_TYPES, ...customExtractorTypes])],
            documentType: selectedDoc?.document_type || newDocType,
          }),
        });
        const cData = await resp.json();
        const classified: ClassifiedClause[] = cData.clauses || extracted;
        const tagged = classified.map(c => ({
          ...c,
          is_obligation_candidate: checkObligationCandidate(c.clause_text || ''),
        }));
        setClauses(tagged);
        invalidateClausesCache();
      } catch { /* silent */ } finally {
        setClassifying(false);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleClassify = async () => {
    if (clauses.length === 0) return;
    setClassifying(true);
    try {
      const resp = await fetch('/api/documents/classify-clauses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: uploadMode === 'existing' ? selectedDocId : 'tmp',
          clauses,
          entityId: selectedDoc?.entity_id,
          entityName: newEntityName || selectedDoc?.entity_name,
          counterpartyName: newCounterpartyName || selectedDoc?.counterparty_name,
          documentType: selectedDoc?.document_type || newDocType,
        }),
      });
      const data = await resp.json();
      if (data.clauses) {
        const tagged = (data.clauses as ClassifiedClause[]).map(c => ({
          ...c,
          is_obligation_candidate: checkObligationCandidate(c.clause_text || ''),
        }));
        setClauses(tagged);
        invalidateClausesCache();
      }
    } finally {
      setClassifying(false);
    }
  };

  const handleSave = async () => {
    if (clauses.length === 0) return;
    setSaving(true);
    try {
      let docId = selectedDocId;
      let contractFamilyId: string | undefined;
      let fileUploadWarning = '';

      if (uploadMode === 'new' && (isInsuranceFamily || isNonBilateralDoc) && newFile) {
        // Insurance-family and non-bilateral (regulation / entity-fact) docs
        // never get a contracts row or a client/vendor counterparty — just
        // persist the source document so these clauses save against a real
        // documentId instead of 'tmp'. Checked ahead of saveDocToTable (which
        // the checkbox above hides, but the state itself can be stale-true
        // from a previously-selected bilateral file) so switching to one of
        // these types can never fall through into creating a spurious
        // contracts row for a document that has no counterparty at all.
        docId = await ensureDocumentSaved(currentDocType || newDocType);
      } else if (uploadMode === 'new' && saveDocToTable && newFile) {
        setSavingDoc(true);
        try {
          // Resolve counterparty — create new client/vendor if needed
          let counterpartyId = extractorCounterpartyId !== '_new_' ? extractorCounterpartyId : '';
          let counterpartyName = '';
          if (extractorCounterpartyId === '_new_' && extractorNewName.trim()) {
            if (extractorFacing === 'vendor') {
              const vRes = await fetch('/api/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legal_name: extractorNewName.trim(), provider_type: extractorNewVendorType || null }) });
              if (vRes.ok) { const vd = await vRes.json(); counterpartyId = vd.service_provider?.service_provider_id || ''; setExtractorVendors(p => [...p, vd.service_provider]); }
            } else {
              const cRes2 = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: extractorNewName.trim() }) });
              if (cRes2.ok) { const cd = await cRes2.json(); counterpartyId = cd.client?.client_id || ''; setExtractorClients(p => [...p, cd.client]); }
            }
            setExtractorCounterpartyId(counterpartyId);
            counterpartyName = extractorNewName.trim();
          } else {
            const list = extractorFacing === 'vendor' ? extractorVendors : extractorClients;
            const found = list.find((p: any) => (extractorFacing === 'vendor' ? p.service_provider_id : p.client_id) === counterpartyId);
            counterpartyName = found ? (extractorFacing === 'vendor' ? found.legal_name : found.client_name) : '';
          }

          // Create document record
          const title = newDocTitle.trim() || (newFile.name ?? 'Untitled Document');
          const docRes = await fetch('/api/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, document_type: newDocType, entity_name: newEntityName || undefined, counterparty_name: counterpartyName || newCounterpartyName || counterpartyId || undefined, file_text: newFileText, status: 'active' }),
          });
          const docData = await docRes.json();
          if (docData.document?.document_id) {
            docId = docData.document.document_id;
            // Mirror the component state, same as ensureDocumentSaved() does —
            // otherwise selectedDocId stays '' after a successful "Upload New"
            // save and any later action keyed off it (re-save / re-classify,
            // ensureDocumentSaved's idempotency guard) misbehaves.
            setSelectedDocId(docId);
            invalidateDocumentsCache();
            fetchDocumentsCached().then(setDocs);
            const fd = new FormData();
            fd.append('file', newFile);
            // Await — a fire-and-forget POST here gets aborted when this
            // component unmounts/resets right after Save, leaving the document
            // row with no file in Storage (preview then 404s).
            try {
              const upRes = await fetch(`/api/documents/${docId}/file`, { method: 'POST', body: fd });
              if (!upRes.ok) {
                const upErr = await upRes.json().catch(() => ({}));
                fileUploadWarning = upErr.error || `file upload failed (${upRes.status})`;
              }
            } catch (e: any) {
              fileUploadWarning = e?.message || 'file upload failed';
            }
          }

          // Create contract record with full fields
          const today = new Date().toISOString().slice(0, 10);
          const contractPayload: Record<string, unknown> = {
            governing_law: saveGoverningLaw || '',
            paper_source: savePaperSource || 'internal',
            contract_facing: extractorFacing,
            effective_date: saveEffectiveDate || today,
            expiration_date: saveExpirationDate || '',
            extracted_obligations: '',
            privacy_requirements: '',
            client_specific_bgc_requirements: '',
            contract_type: newDocType || '',
            counterparty_type: saveCounterpartyType || '',
            document_id: docId || undefined,
          };
          if (extractorFacing === 'vendor') {
            contractPayload.linked_vendor_id = counterpartyId || '';
            contractPayload.linked_vendor_name = counterpartyName;
            contractPayload.linked_client_id = '';
          } else {
            contractPayload.linked_client_id = counterpartyId || '';
            contractPayload.linked_client_name = counterpartyName;
          }
          const cRes = await fetch('/api/contracts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(contractPayload),
          }).catch(() => null);
          if (cRes?.ok) {
            const cData = await cRes.json().catch(() => ({}));
            contractFamilyId = cData.contract?.contract_id;
          }

          // Sync counterpartyName for classify-clauses call below
          if (counterpartyId) setNewCounterpartyName(counterpartyId);
        } catch { /* silent */ } finally {
          setSavingDoc(false);
        }
      }

      // Insurance-family docs: extract + save policy metadata to
      // insurance_policies as part of this same Save action — no separate
      // "Extract Insurance Policy" step. Best-effort: if this fails, clause
      // saving below still proceeds.

      // Resolve the insurer picked/created in the Insurer picker — used both
      // to tag the clause rows' counterparty and, if "Save to Insurance
      // Table" is on, the insurance_policies row. A newly-created insurer is
      // tagged provider_type: 'insurance_provider' so it's distinguishable on
      // the Service Providers page from other provider types.
      let insurerVendorId = '';
      let insurerVendorName = '';
      if (isInsuranceFamily) {
        if (extractorCounterpartyId === '_new_' && extractorNewName.trim()) {
          const vRes = await fetch('/api/vendors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ legal_name: extractorNewName.trim(), provider_type: 'insurance_provider' }),
          }).catch(() => null);
          if (vRes?.ok) {
            const vd = await vRes.json();
            insurerVendorId = vd.service_provider?.service_provider_id || '';
            insurerVendorName = extractorNewName.trim();
            setExtractorVendors(p => [...p, vd.service_provider]);
            setExtractorCounterpartyId(insurerVendorId);
          }
        } else if (extractorCounterpartyId) {
          insurerVendorId = extractorCounterpartyId;
          insurerVendorName = extractorVendors.find((v: any) => v.service_provider_id === extractorCounterpartyId)?.legal_name || '';
        }
      }

      let savedInsurancePolicyId: string | undefined;
      if (isInsuranceFamily && saveToInsuranceTable) {
        try {
          const text = previewText || activeText;
          const insRes = await fetch('/api/documents/classify-insurance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentText: text, documentType: currentDocType }),
          });
          if (insRes.ok) {
            const insData = await insRes.json();
            const p = insData.policy || {};
            const policyRes = await fetch('/api/insurance-policies', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                document_id: docId || undefined,
                source_document_type: currentDocType,
                insurer_vendor_id: insurerVendorId || undefined,
                policy_number: p.policy_number,
                // User-selected/created insurer wins over the LLM's free-text
                // extraction; the extracted name is only a fallback label.
                insurance_company: insurerVendorName || p.insurance_company,
                named_insured: p.named_insured,
                linked_client_ids: p.linked_client_ids,
                coverage_type: p.coverage_type,
                coverage_amount: p.coverage_amount,
                effective_date: p.effective_date,
                expiration_date: p.expiration_date,
                states: p.states,
              }),
            });
            const policyData = await policyRes.json();
            savedInsurancePolicyId = policyData.policy?.policy_id;
          }
        } catch {
          // best-effort — clause saving below still proceeds
        }
      }

      const resolvedCounterparty = isInsuranceFamily
        ? (insurerVendorId || insurerVendorName || undefined)
        : (extractorCounterpartyId && extractorCounterpartyId !== '_new_') ? extractorCounterpartyId : (newCounterpartyName || selectedDoc?.counterparty_name);
      await fetch('/api/documents/classify-clauses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: docId || 'tmp',
          clauses,
          entityId: selectedDoc?.entity_id,
          entityName: newEntityName || selectedDoc?.entity_name,
          counterpartyName: resolvedCounterparty,
          insurerVendorId: isInsuranceFamily ? (insurerVendorId || undefined) : undefined,
          documentType: selectedDoc?.document_type || newDocType,
          contractFamilyId,
          paperSource: savePaperSource,
        }),
      });
      invalidateClausesCache();
      alert(
        `Saved ${clauses.length} clauses successfully.` +
        (contractFamilyId ? `\nSaved as contract ${contractFamilyId}.` : '') +
        (savedInsurancePolicyId ? `\nSaved insurance policy ${savedInsurancePolicyId}.` : '') +
        (fileUploadWarning ? `\n\n⚠ The original file was NOT stored: ${fileUploadWarning}\nThe document text was saved, but the PDF preview will be unavailable until you re-attach the file.` : '')
      );
    } finally {
      setSaving(false);
    }
  };

  // Ensures a new upload has a real document row before it's needed by either
  // the insurance-table save or the clause save below — idempotent (reuses
  // selectedDocId once set) so it's safe to call every time handleSave runs.
  const ensureDocumentSaved = async (documentType: string): Promise<string> => {
    if (selectedDocId || !newFile) return selectedDocId;
    const title = newDocTitle.trim() || (newFile.name ?? 'Untitled Document');
    const docRes = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, document_type: documentType, file_text: newFileText, status: 'active' }),
    });
    const docData = await docRes.json();
    const docId = docData.document?.document_id;
    if (docId) {
      setSelectedDocId(docId);
      invalidateDocumentsCache();
      fetchDocumentsCached().then(setDocs);
      const fd = new FormData();
      fd.append('file', newFile);
      // Await so the file actually lands in Storage before this returns — a
      // fire-and-forget POST is aborted when the component resets after Save.
      try {
        const upRes = await fetch(`/api/documents/${docId}/file`, { method: 'POST', body: fd });
        if (!upRes.ok) {
          const upErr = await upRes.json().catch(() => ({}));
          alert(`Document saved, but the original file was NOT stored: ${upErr.error || `HTTP ${upRes.status}`}.\nThe PDF preview will be unavailable until you re-attach the file.`);
        }
      } catch (e: any) {
        alert(`Document saved, but the original file was NOT stored: ${e?.message || 'upload failed'}.\nThe PDF preview will be unavailable until you re-attach the file.`);
      }
      return docId;
    }
    return '';
  };

  const updateClause = (idx: number, patch: Partial<ClassifiedClause>) => {
    setClauses(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  const deleteClause = (idx: number) => {
    setClauses(prev => prev.filter((_, i) => i !== idx));
    if (selectedClause === clauses[idx]) setSelectedClause(null);
  };

  const handleClauseSort = (key: string) => {
    if (clauseSortKey === key) setClauseSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setClauseSortKey(key); setClauseSortDir('asc'); }
  };

  const sortedClauses = clauseSortKey
    ? [...clauses].sort((a, b) => {
        if (clauseSortKey === 'clause_no') {
          const av = String(a.clause_no || '');
          const bv = String(b.clause_no || '');
          const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
          return clauseSortDir === 'asc' ? cmp : -cmp;
        }
        const av = (clauseSortKey === 'detected_type' ? a.detected_type : clauseSortKey === 'obligation_type' ? (a.obligation_type || '') : String(a.clause_no || '')).toLowerCase();
        const bv = (clauseSortKey === 'detected_type' ? b.detected_type : clauseSortKey === 'obligation_type' ? (b.obligation_type || '') : String(b.clause_no || '')).toLowerCase();
        return clauseSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      })
    : clauses;

  function ClauseSortIcon({ col }: { col: string }) {
    if (clauseSortKey !== col) return <span style={{ opacity: 0.25, fontSize: '0.5rem', marginLeft: 3 }}>↕</span>;
    return <span style={{ fontSize: '0.5rem', color: '#a78bfa', marginLeft: 3 }}>{clauseSortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const INP: React.CSSProperties = { padding: '7px 10px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none' };

  // Scrolling to selected clause is now handled inside ClauseExtractorPreviewPanel.

  const resetMode = () => {
    setClauses([]); setSelectedClause(null); setPreviewText('');
    setSelectedDocId(''); setSelectedDoc(null);
    setNewFile(null); setNewFileText(''); setSchemaReason('');
    setNewEntityName(''); setNewCounterpartyName('');
  };

  return (
    <div
      style={{ flex: 1, display: 'flex', overflow: 'hidden', cursor: previewResizeDragRef.current ? 'col-resize' : undefined }}
      onMouseMove={e => {
        if (!previewResizeDragRef.current) return;
        const delta = previewResizeDragRef.current.startX - e.clientX;
        setPreviewWidth(Math.max(280, Math.min(900, previewResizeDragRef.current.startW + delta)));
      }}
      onMouseUp={() => { previewResizeDragRef.current = null; }}
      onMouseLeave={() => { previewResizeDragRef.current = null; }}
    >
      {/* ── LEFT: Toolbar + Clause table ────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* ── Single toolbar row ───────────────────────────────────────────── */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'nowrap' }}>

          {/* Mode toggle */}
          <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border-color)', flexShrink: 0 }}>
            {(['existing', 'new'] as const).map(m => (
              <button key={m} onClick={() => { setUploadMode(m); resetMode(); setShowOptions(false); }}
                style={{ padding: '5px 12px', background: uploadMode === m ? 'rgba(255,255,255,0.07)' : 'transparent', border: 'none', color: uploadMode === m ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '0.75rem', fontWeight: uploadMode === m ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {m === 'existing' ? 'Select Document' : 'Upload New'}
              </button>
            ))}
          </div>

          {/* Source selector — compact */}
          {uploadMode === 'existing' ? (
            <select value={selectedDocId} onChange={e => handleDocSelect(e.target.value)}
              style={{ ...INP, minWidth: 200, maxWidth: 320, fontSize: '0.78rem' }}>
              <option value="">— Select document —</option>
              {docs.map(d => <option key={d.document_id} value={d.document_id}>{d.title || d.document_id}</option>)}
            </select>
          ) : (
            <label style={{ padding: '5px 12px', borderRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: uploadingFile ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {uploadingFile ? 'Reading…' : newFile ? newFile.name : '+ Choose File'}
              <input type="file" accept=".pdf,.docx,.doc,.txt" onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])} style={{ display: 'none' }} />
            </label>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Options toggle */}
          <button onClick={() => setShowOptions(o => !o)}
            style={{ padding: '5px 10px', borderRadius: 5, background: showOptions ? 'rgba(255,255,255,0.07)' : 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            ⚙ Options
          </button>

          {/* Auto-classification indicator — the classify-type call fired in
              handleFileSelect is fire-and-forget, so this is the only signal
              the user gets that Source Type / Save to Contracts were just
              auto-filled (or that classification is still running). */}
          {uploadMode === 'new' && newFile && (docTypeClassifying || docTypeClassification) && (
            <span style={{ fontSize: '0.68rem', color: docTypeClassifying ? 'var(--text-muted)' : '#a78bfa', fontStyle: 'italic', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {docTypeClassifying ? 'Detecting source type…' : `Detected: ${CONTRACT_TYPE_OPTIONS.find(o => o.value === docTypeClassification!.documentType)?.label || docTypeClassification!.documentType}`}
            </span>
          )}

          {/* Save to Documents checkbox — persists the source doc + its
              contract-relationship metadata (client/service provider, paper
              source, governing law, dates) into the unified Documents table.
              Never for insurance-family or non-bilateral docs — see
              isNonBilateralDoc. */}
          {uploadMode === 'new' && newFile && !isInsuranceFamily && !isNonBilateralDoc && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.73rem', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <input type="checkbox" checked={saveDocToTable} onChange={e => setSaveDocToTable(e.target.checked)} style={{ accentColor: 'var(--primary-accent)' }} />
              Save to Documents
            </label>
          )}

          {/* Save to Insurance Table checkbox — insurance-family docs only.
              No separate "Extract Insurance Policy" step: clicking Save (N)
              below extracts and saves policy metadata to insurance_policies
              in the same action as saving clauses to the Clause Library. */}
          {isInsuranceFamily && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.73rem', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <input type="checkbox" checked={saveToInsuranceTable} onChange={e => setSaveToInsuranceTable(e.target.checked)} style={{ accentColor: 'var(--primary-accent)' }} />
              Save to Insurance Table
            </label>
          )}

          {/* Action buttons — clause extraction runs for every doc type,
              including insurance-family ones; their policy metadata is
              captured automatically on Save when the checkbox above is on. */}
          {clauses.length > 0 && (
            <>
              <button onClick={handleClassify} disabled={classifying}
                style={{ padding: '5px 12px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {classifying ? 'Classifying…' : 'Re-classify'}
              </button>
              <button onClick={handleSave} disabled={saving || savingDoc}
                style={{ padding: '5px 12px', borderRadius: 5, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {saving ? 'Saving…' : `Save (${clauses.length})`}
              </button>
            </>
          )}
          <button onClick={handleExtract} disabled={!canExtract || extracting}
            style={{ padding: '5px 14px', borderRadius: 5, background: 'var(--primary-accent)', border: 'none', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: canExtract ? 'pointer' : 'not-allowed', opacity: !canExtract ? 0.45 : 1, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {extracting ? 'Extracting…' : classifying ? 'Classifying…' : 'Extract Clauses'}
          </button>
        </div>

        {/* ── Options panel (collapsible) ──────────────────────────────────── */}
        {showOptions && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', flexShrink: 0 }}>

            {/* Schema selectors */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Numbering Schema</div>
              {schemas.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', width: 14, textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
                  <select value={s} onChange={e => setSchemas(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                    style={{ ...INP, fontSize: '0.75rem', minWidth: 180 }}>
                    <option value="auto">Auto-detect schema</option>
                    {Object.entries(NUMBERING_SCHEMAS).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
                  </select>
                  <button onClick={() => moveSchema(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: i === 0 ? 'default' : 'pointer', fontSize: '0.7rem', padding: '2px 4px', opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                  <button onClick={() => moveSchema(i, 1)} disabled={i === schemas.length - 1} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: i === schemas.length - 1 ? 'default' : 'pointer', fontSize: '0.7rem', padding: '2px 4px', opacity: i === schemas.length - 1 ? 0.3 : 1 }}>▼</button>
                  {schemas.length > 1 && <button onClick={() => removeSchema(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '2px 4px', lineHeight: 1 }}>✕</button>}
                </div>
              ))}
              <button onClick={addSchema} style={{ alignSelf: 'flex-start', padding: '2px 8px', borderRadius: 4, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', marginTop: 2 }}>+ Add Schema</button>
              {(schemaReason || detectingSchema) && (
                <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>
                  {detectingSchema ? 'Detecting…' : schemaReason}
                </div>
              )}
            </div>

            {/* Subclause mode */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Subclauses</div>
              <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                {(['combined', 'separate'] as const).map(m => (
                  <button key={m} onClick={() => setSubclauseMode(m)}
                    style={{ padding: '4px 10px', background: subclauseMode === m ? 'rgba(255,255,255,0.07)' : 'transparent', border: 'none', color: subclauseMode === m ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '0.73rem', fontWeight: subclauseMode === m ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Counter-party + doc details (new file only) */}
            {uploadMode === 'new' && newFile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Document Details</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input value={newDocTitle} onChange={e => setNewDocTitle(e.target.value)} placeholder="Document title"
                    style={{ ...INP, width: 180, fontSize: '0.78rem' }} />
                  <SearchableSelect
                    value={newDocType}
                    onChange={v => { setNewDocType(v); setShowAddDocType(false); }}
                    options={[
                      ...CONTRACT_TYPE_OPTIONS,
                      { value: 'tax_document', label: 'Tax Document', group: 'Other' },
                      { value: 'invoice', label: 'Invoice', group: 'Other' },
                      { value: 'general_review', label: 'General Review', group: 'Other' },
                      ...customDocTypes.map(label => ({ value: labelToDocTypeValue(label), label, group: 'Custom' })),
                    ]}
                    footerItems={[{ label: '+ Add new contract type…', onClick: () => { setShowAddDocType(true); setNewDocTypeName(''); } }]}
                    style={{ ...INP, fontSize: '0.75rem', display: 'flex', minWidth: 180 }}
                  />
                </div>
                {showAddDocType && (
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input autoFocus value={newDocTypeName} onChange={e => setNewDocTypeName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { const t = newDocTypeName.trim(); if (!t) return; const u = saveCustomDocumentType(t); setCustomDocTypes(u); setNewDocType(labelToDocTypeValue(t)); setShowAddDocType(false); setNewDocTypeName(''); } if (e.key === 'Escape') setShowAddDocType(false); }}
                      placeholder="New type name…" style={{ ...INP, fontSize: '0.75rem', flex: 1 }} />
                    <button onClick={() => { const t = newDocTypeName.trim(); if (!t) return; const u = saveCustomDocumentType(t); setCustomDocTypes(u); setNewDocType(labelToDocTypeValue(t)); setShowAddDocType(false); setNewDocTypeName(''); }}
                      disabled={!newDocTypeName.trim()} style={{ padding: '5px 10px', borderRadius: 4, background: 'var(--primary-accent)', border: 'none', color: '#fff', fontSize: '0.75rem', cursor: 'pointer' }}>Add</button>
                    <button onClick={() => setShowAddDocType(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                  </div>
                )}
                {/* Counter-party — not applicable to insurance-family docs (a
                    policy has an insurer + named insured, a COI has covered
                    clients; neither is the single client/vendor
                    counterparty concept regular contracts use) */}
                {!isInsuranceFamily && (
                  <>
                    {/* One combined Counterparty picker — Clients and Service
                        Providers in a single list. The facing (client vs
                        service provider) is derived from the selection, not a
                        separate toggle. */}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Counterparty</span>
                      <select
                        value={extractorCounterpartyId === '_new_' ? (extractorFacing === 'vendor' ? '_new_vendor_' : '_new_client_') : extractorCounterpartyId}
                        onChange={e => {
                          const v = e.target.value;
                          setExtractorNewName('');
                          // Counterparty Type auto-fills from the facing of the
                          // selected counterparty.
                          const applyFacing = (facing: 'client' | 'vendor') => {
                            setExtractorFacing(facing);
                            setSaveCounterpartyType(facing === 'vendor' ? 'Service Provider' : 'Client');
                          };
                          if (v === '_new_client_') { applyFacing('client'); setExtractorCounterpartyId('_new_'); return; }
                          if (v === '_new_vendor_') { applyFacing('vendor'); setExtractorCounterpartyId('_new_'); return; }
                          if (!v) { setExtractorCounterpartyId(''); return; }
                          const isVendor = extractorVendors.some((p: any) => p.service_provider_id === v);
                          applyFacing(isVendor ? 'vendor' : 'client');
                          setExtractorCounterpartyId(v);
                        }}
                        style={{ ...INP, fontSize: '0.75rem', minWidth: 240 }}>
                        <option value="">— Select client or service provider —</option>
                        <optgroup label="Clients">
                          {extractorClients.map((p: any) => (
                            <option key={p.client_id} value={p.client_id}>{p.client_name} ({p.client_id})</option>
                          ))}
                        </optgroup>
                        <optgroup label="Service Providers">
                          {extractorVendors.map((p: any) => (
                            <option key={p.service_provider_id} value={p.service_provider_id}>{p.legal_name} ({p.service_provider_id})</option>
                          ))}
                        </optgroup>
                        <option value="_new_client_">+ Add new client…</option>
                        <option value="_new_vendor_">+ Add new service provider…</option>
                      </select>
                    </div>
                    {extractorCounterpartyId === '_new_' && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input value={extractorNewName} onChange={e => setExtractorNewName(e.target.value)}
                          placeholder={`New ${extractorFacing === 'vendor' ? 'service provider' : extractorFacing} name`} style={{ ...INP, fontSize: '0.75rem', flex: 1, minWidth: 160 }} autoFocus />
                        {extractorFacing === 'vendor' && (
                          <select value={extractorNewVendorType} onChange={e => setExtractorNewVendorType(e.target.value)}
                            style={{ ...INP, fontSize: '0.75rem', minWidth: 180 }}>
                            <option value="">— Service Provider type (optional) —</option>
                            {Object.entries(
                              VENDOR_TYPE_OPTIONS.reduce((acc: Record<string, typeof VENDOR_TYPE_OPTIONS>, o) => {
                                (acc[o.group] ||= []).push(o); return acc;
                              }, {})
                            ).map(([group, opts]) => (
                              <optgroup key={group} label={group}>
                                {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    {extractorCounterpartyId && extractorCounterpartyId !== '_new_' && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        Counter-Party ID: <strong style={{ color: 'var(--text-secondary)' }}>{extractorCounterpartyId}</strong>
                      </div>
                    )}
                  </>
                )}
                {/* Insurer — vendor-only picker (an insurer is always a
                    vendor; no client/vendor toggle needed here). New
                    insurers created inline are tagged provider_type
                    'insurance_provider' in handleSave. */}
                {isInsuranceFamily && (
                  <>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Insurer</span>
                      <select value={extractorCounterpartyId} onChange={e => { setExtractorCounterpartyId(e.target.value); setExtractorNewName(''); }}
                        style={{ ...INP, fontSize: '0.75rem', minWidth: 200 }}>
                        <option value="">— Select insurer (optional) —</option>
                        {extractorVendors.map((v: any) => (
                          <option key={v.service_provider_id} value={v.service_provider_id}>{v.legal_name} ({v.service_provider_id})</option>
                        ))}
                        <option value="_new_">+ Add new insurer…</option>
                      </select>
                    </div>
                    {extractorCounterpartyId === '_new_' && (
                      <input value={extractorNewName} onChange={e => setExtractorNewName(e.target.value)}
                        placeholder="New insurer name" style={{ ...INP, fontSize: '0.75rem' }} autoFocus />
                    )}
                    {extractorCounterpartyId && extractorCounterpartyId !== '_new_' && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        Insurer ID: <strong style={{ color: 'var(--text-secondary)' }}>{extractorCounterpartyId}</strong>
                      </div>
                    )}
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Leave blank to let AI extraction fill this in from the document text instead.
                    </div>
                  </>
                )}
                {/* Governing law + paper source + counterparty type — only for a
                    Contract or Order Form (never a regulation / entity-fact /
                    insurance doc). Paper Source is a manual select for now. */}
                {saveDocToTable && isContractOrOrderForm && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        Paper Source
                        <select value={savePaperSource} onChange={e => setSavePaperSource(e.target.value)} style={{ ...INP, fontSize: '0.73rem', width: 'auto' }}>
                          <option value="internal">Internal Paper</option>
                          <option value="counter_party">Counter-Party Paper</option>
                        </select>
                      </label>
                      <SearchableSelect value={saveGoverningLaw} onChange={setSaveGoverningLaw} options={GEO_OPTIONS} placeholder="Governing Law…"
                        style={{ ...INP, fontSize: '0.73rem', display: 'flex', minWidth: 180 }} />
                      <SearchableSelect value={saveCounterpartyType} onChange={setSaveCounterpartyType} options={counterpartyTypeOptions} placeholder="Counterparty Type…"
                        footerItems={[{ label: '+ Add new type…', onClick: () => { setAddingCounterpartyType(true); setNewCounterpartyTypeName(''); } }]}
                        style={{ ...INP, fontSize: '0.73rem', display: 'flex', minWidth: 180 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        Effective
                        <input type="date" value={saveEffectiveDate} onChange={e => setSaveEffectiveDate(e.target.value)} style={{ ...INP, fontSize: '0.73rem', width: 'auto' }} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        Expiration
                        <input type="date" value={saveExpirationDate} onChange={e => setSaveExpirationDate(e.target.value)} style={{ ...INP, fontSize: '0.73rem', width: 'auto' }} />
                      </label>
                    </div>
                    {addingCounterpartyType && (
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <input autoFocus value={newCounterpartyTypeName} onChange={e => setNewCounterpartyTypeName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { const t = newCounterpartyTypeName.trim(); if (!t) return; const u = saveCustomCounterpartyType(t); setCustomCounterpartyTypes(u); setSaveCounterpartyType(t); setAddingCounterpartyType(false); setNewCounterpartyTypeName(''); }
                            if (e.key === 'Escape') setAddingCounterpartyType(false);
                          }}
                          placeholder="New type name…" style={{ ...INP, fontSize: '0.75rem', flex: 1 }} />
                        <button onClick={() => { const t = newCounterpartyTypeName.trim(); if (!t) return; const u = saveCustomCounterpartyType(t); setCustomCounterpartyTypes(u); setSaveCounterpartyType(t); setAddingCounterpartyType(false); setNewCounterpartyTypeName(''); }}
                          disabled={!newCounterpartyTypeName.trim()} style={{ padding: '5px 10px', borderRadius: 4, background: 'var(--primary-accent)', border: 'none', color: '#fff', fontSize: '0.75rem', cursor: 'pointer' }}>Add</button>
                        <button onClick={() => setAddingCounterpartyType(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Document metadata strip ────────────────────────────────────── */}
        {selectedDoc && uploadMode === 'existing' && (() => {
          const meta = [
            selectedDoc.document_type && { label: 'Type', value: (selectedDoc.document_type as string).replace(/_/g, ' ') },
            selectedDoc.entity_id     && { label: 'Entity', value: entityMap[selectedDoc.entity_id] || selectedDoc.entity_id },
            selectedDoc.asset_id      && { label: 'Asset',  value: assetMap[selectedDoc.asset_id]   || selectedDoc.asset_id },
            selectedDoc.counterparty_name && { label: 'Counterparty', value: selectedDoc.counterparty_name },
          ].filter(Boolean) as { label: string; value: string }[];
          if (meta.length === 0) return null;
          return (
            <div style={{ padding: '5px 28px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0, background: 'rgba(124,58,237,0.04)' }}>
              {meta.map(m => (
                <span key={m.label} style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.6rem', opacity: 0.6 }}>{m.label}</span>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'capitalize' }}>{m.value}</span>
                </span>
              ))}
            </div>
          );
        })()}

        {/* ── Clause table — full text, full height ─────────────────────── */}
        {clauses.length > 0 ? (
          <>
            {/* Sub-header: clause count + actions */}
            <div style={{ padding: '7px 28px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, background: 'rgba(255,255,255,0.01)' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', flex: 1 }}>
                Extracted Clauses ({clauses.length})
              </span>
              <button onClick={handleClassify} disabled={classifying}
                style={{ padding: '4px 10px', borderRadius: 5, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}>
                {classifying ? 'Classifying…' : '✦ Re-classify'}
              </button>
              <button onClick={handleSave} disabled={saving || savingDoc}
                style={{ padding: '4px 10px', borderRadius: 5, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#34d399', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}>
                {saving ? 'Saving…' : `Save Clauses (${clauses.length})`}
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  {clauseExColWidths.map((w, i) => <col key={i} style={w ? { width: w } : {}} />)}
                </colgroup>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, zIndex: 2, borderBottom: '1px solid var(--border-color)', background: '#090910' }}>
                    <th style={{ position: 'relative', padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.62rem', textTransform: 'uppercase' }}>#<div onMouseDown={e => startClauseExColResize(0, e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }} /></th>
                    <th onClick={() => handleClauseSort('clause_no')} style={{ position: 'relative', padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.62rem', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }}>No.<ClauseSortIcon col="clause_no" /><div onMouseDown={e => startClauseExColResize(1, e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }} /></th>
                    <th onClick={() => handleClauseSort('clause_name')} style={{ position: 'relative', padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.62rem', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }}>Name<ClauseSortIcon col="clause_name" /><div onMouseDown={e => startClauseExColResize(2, e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }} /></th>
                    <th style={{ position: 'relative', padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.62rem', textTransform: 'uppercase' }}>Clause Text<div onMouseDown={e => startClauseExColResize(3, e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }} /></th>
                    <th style={{ position: 'relative', padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.62rem', textTransform: 'uppercase' }}>Summary<div onMouseDown={e => startClauseExColResize(4, e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }} /></th>
                    <th onClick={() => handleClauseSort('detected_type')} style={{ position: 'relative', padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.62rem', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }}>Type<ClauseSortIcon col="detected_type" /><div onMouseDown={e => startClauseExColResize(5, e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }} /></th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sortedClauses.map((c, i) => {
                    const isSelected = selectedClause === c;
                    const origIdx = clauses.indexOf(c);
                    // Auto-size rows: ~80 chars per line, min 3, max 30
                    const textRows = Math.max(3, Math.min(30, Math.ceil((c.clause_text || '').length / 80)));
                    return (
                      <tr key={i}
                        onClick={() => setSelectedClause(isSelected ? null : c)}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'transparent', verticalAlign: 'top', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                        <td style={{ padding: '8px 10px', color: 'rgba(148,163,184,0.35)', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{i + 1}</td>
                        <td style={{ padding: '6px 10px' }} onClick={e => e.stopPropagation()}>
                          <textarea
                            value={c.clause_no || ''}
                            onChange={e => updateClause(origIdx, { clause_no: e.target.value })}
                            rows={Math.max(1, Math.ceil((c.clause_no || '').length / 8))}
                            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-secondary)', fontSize: '0.72rem', fontFamily: 'inherit', padding: 0, resize: 'none', lineHeight: 1.45, wordBreak: 'break-word', overflowWrap: 'break-word' } as React.CSSProperties}
                          />
                        </td>
                        <td style={{ padding: '6px 10px', verticalAlign: 'top' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                            <button
                              onClick={() => { setSelectedClause(isSelected ? null : c); setRecapturingClauseId(null); }}
                              title="Jump to this clause in the document preview"
                              style={{ flexShrink: 0, background: 'none', border: 'none', color: 'rgba(147,197,253,0.6)', cursor: 'pointer', fontSize: '0.72rem', padding: 0, marginTop: 2, lineHeight: 1 }}
                            >↗</button>
                            <textarea
                              value={c.clause_name || ''}
                              onChange={e => updateClause(origIdx, { clause_name: e.target.value })}
                              placeholder={c.ai_classification || (c.detected_type || '').split(',')[0] || `Clause ${i + 1}`}
                              rows={Math.max(1, Math.ceil((c.clause_name || '').length / 14))}
                              title="Edit clause name"
                              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#93c5fd', fontSize: '0.75rem', fontWeight: 500, fontFamily: 'inherit', padding: 0, resize: 'none', lineHeight: 1.4, wordBreak: 'break-word', overflowWrap: 'break-word' } as React.CSSProperties}
                            />
                          </div>
                        </td>
                        <td style={{ padding: '6px 10px' }} onClick={e => e.stopPropagation()}>
                          <textarea
                            value={c.clause_text}
                            onChange={e => updateClause(origIdx, { clause_text: e.target.value })}
                            rows={textRows}
                            style={{ width: '100%', resize: 'vertical', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.73rem', fontFamily: 'inherit', lineHeight: 1.6, padding: 0, minHeight: 48, wordBreak: 'break-word', overflowWrap: 'break-word' } as React.CSSProperties}
                          />
                        </td>
                        <td style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: '0.72rem', verticalAlign: 'top', wordBreak: 'break-word', lineHeight: 1.5 }}>
                          {c.ai_classification || ''}
                        </td>
                        <td style={{ padding: '6px 10px' }} onClick={e => e.stopPropagation()}>
                          {addingTypeRow === origIdx ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input
                                autoFocus
                                value={newTypeValue}
                                onChange={e => setNewTypeValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    const trimmed = newTypeValue.trim();
                                    if (trimmed) {
                                      const next = [...new Set([...customExtractorTypes, trimmed])];
                                      setCustomExtractorTypes(next);
                                      try { localStorage.setItem('consola_clause_types', JSON.stringify(next)); } catch { /* ignore */ }
                                      const existing = (c.detected_type || '').split(',').map(s => s.trim()).filter(Boolean);
                                      if (!existing.includes(trimmed)) updateClause(origIdx, { detected_type: [...existing, trimmed].join(', ') });
                                    }
                                    setAddingTypeRow(null); setNewTypeValue('');
                                  } else if (e.key === 'Escape') { setAddingTypeRow(null); setNewTypeValue(''); }
                                }}
                                placeholder="New type…"
                                style={{ flex: 1, minWidth: 0, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.4)', color: 'var(--text-primary)', fontSize: '0.68rem', borderRadius: 4, padding: '3px 6px', fontFamily: 'inherit', outline: 'none' }}
                              />
                              <button onClick={() => { setAddingTypeRow(null); setNewTypeValue(''); }}
                                style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.4)', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px', lineHeight: 1 }}>✕</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {(c.detected_type || '').split(',').map(s => s.trim()).filter(Boolean).map((t, ti) => (
                                  <span key={ti} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 99, fontSize: '0.62rem', background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.25)', whiteSpace: 'nowrap' }}>
                                    {t}
                                    <button onClick={e => { e.stopPropagation(); const types = (c.detected_type || '').split(',').map(s => s.trim()).filter(Boolean); types.splice(ti, 1); updateClause(origIdx, { detected_type: types.join(', ') }); }}
                                      style={{ background: 'none', border: 'none', color: 'rgba(196,181,253,0.5)', cursor: 'pointer', padding: 0, fontSize: '0.65rem', lineHeight: 1 }}>×</button>
                                  </span>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <SearchableSelect
                                  value=""
                                  onChange={v => { if (!v) return; const ex = (c.detected_type || '').split(',').map(s => s.trim()).filter(Boolean); if (!ex.includes(v)) updateClause(origIdx, { detected_type: [...ex, v].join(', ') }); }}
                                  options={[...new Set([...CANONICAL_CLAUSE_TYPES, ...customExtractorTypes])].map(t => ({ value: t, label: t }))}
                                  placeholder="Add type…"
                                  style={{ flex: 1, minWidth: 0, background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontSize: '0.68rem', borderRadius: 4, padding: '4px 6px', fontFamily: 'inherit' }}
                                />
                                <button onClick={() => { setAddingTypeRow(origIdx); setNewTypeValue(''); }} title="Add custom type"
                                  style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', cursor: 'pointer', fontSize: '0.75rem', borderRadius: 4, padding: '3px 6px', lineHeight: 1, flexShrink: 0 }}>+</button>
                              </div>
                            </div>
                          )}
                        </td>

                        <td style={{ padding: '6px 6px', verticalAlign: 'top' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                            <button
                              onClick={() => { setRecapturingClauseId(c.clause_id === recapturingClauseId ? null : (c.clause_id ?? null)); setSelectedClause(c); }}
                              title="Recapture: select the correct clause text in the document preview"
                              style={{ background: c.clause_id === recapturingClauseId ? 'rgba(245,158,11,0.15)' : 'none', border: c.clause_id === recapturingClauseId ? '1px solid rgba(245,158,11,0.4)' : 'none', borderRadius: 3, color: c.clause_id === recapturingClauseId ? '#fbbf24' : 'rgba(148,163,184,0.3)', cursor: 'pointer', fontSize: '0.72rem', lineHeight: 1, padding: '2px 4px' }}
                            >⌖</button>
                            <button onClick={() => deleteClause(origIdx)}
                              style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.2)', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1, padding: 2 }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 10 }}>
            <div style={{ fontSize: '2.5rem', opacity: 0.1 }}>◧</div>
            <div style={{ fontSize: '0.875rem' }}>
              {uploadMode === 'existing' ? 'Select a document and click Extract Clauses' : 'Upload a file and click Extract Clauses'}
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: Document preview (styled, clause-highlighted) ──────────── */}
      {previewText && (
        <>
          {/* Drag handle on left edge of panel */}
          <div
            onMouseDown={e => { e.preventDefault(); previewResizeDragRef.current = { startX: e.clientX, startW: previewWidth }; }}
            style={{ width: 5, cursor: 'col-resize', flexShrink: 0, background: 'transparent', borderLeft: '1px solid var(--border-color)', zIndex: 10 }}
          />
          <ClauseExtractorPreviewPanel
            width={previewWidth}
            text={previewText}
            clauses={clauses}
            selectedClause={selectedClause}
            docTitle={selectedDoc ? (selectedDoc.title || selectedDoc.document_id) : (newFile?.name || 'Document Preview')}
            documentId={selectedDoc?.document_id ?? null}
            fileBlobUrl={newFileBlobUrl}
            cleaningText={cleaningText}
            onCleanText={handleCleanText}
            onTextChange={t => { setPreviewText(t); if (uploadMode === 'new') setNewFileText(t); }}
            recaptureClauseId={recapturingClauseId}
            onRecaptured={(clauseId, start, end) => {
              const idx = clauses.findIndex(c => c.clause_id === clauseId);
              if (idx >= 0) updateClause(idx, { char_start: start, char_end: end });
              setRecapturingClauseId(null);
            }}
            onCancelRecapture={() => setRecapturingClauseId(null)}
          />
        </>
      )}
    </div>
  );
}

// ─── Tab 3: Obligations ───────────────────────────────────────────────────────

const COMPLIANCE_COLORS: Record<string, string> = {
  compliant:     '#22c55e',
  non_compliant: '#ef4444',
  review_needed: '#f59e0b',
  unchecked:     '#64748b',
};
const COMPLIANCE_LABELS: Record<string, string> = {
  compliant:     'Compliant',
  non_compliant: 'Non-Compliant',
  review_needed: 'Review Needed',
  unchecked:     '—',
};
function fmtDateCL(val: string | null | undefined): string {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return String(val); }
}
function getClauseStatusCL(clause: any, docStatus: string): 'active' | 'expired' {
  if (docStatus === 'expired' || docStatus === 'inactive') return clause.survives_termination ? 'active' : 'expired';
  return 'active';
}
// The rule-based extractor stores the ENTIRE opening line of a clause into
// clause_no when it captures a numbered heading (e.g. "3. Maximum
// Compensation, Invoicing,and Payment: 3") — clause_no is meant to hold
// only the section number, so this strips everything after the leading
// numeric token. When there's no leading number to strip at all (an
// unnumbered clause), falls back to the clause's own extraction-order
// position — the trailing _NN in clause_id (cl_####_NN) — which reflects
// true top-to-bottom document order regardless of how the table is
// currently sorted, rather than a table-row-position counter that would
// change under sorting/filtering.
function displayClauseNo(c: { clause_no?: string | null; clause_id?: string | null }): string {
  const raw = (c.clause_no || '').trim();
  const leading = raw.match(/^(\d+(?:\.\d+)*)\.?/);
  if (leading?.[1]) return leading[1];
  const idOrdinal = (c.clause_id || '').match(/_(\d+)$/);
  if (idOrdinal) return String(parseInt(idOrdinal[1], 10));
  return '';
}
// Clause Text cell — wraps every occurrence of any search term (case-insensitive,
// all variations, e.g. "sole" also matches "Sole"/"SOLE") in a <mark>, and auto-scrolls
// its own scroll box to the first match so a hit deep in the clause is visible without
// the user having to manually scroll each row.
const CLAUSE_TEXT_CELL_STYLE: React.CSSProperties = { fontSize: '0.73rem', lineHeight: 1.55, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto' };
function ClauseTextCell({ text, searchQuery }: { text: string; searchQuery: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const firstMarkRef = useRef<HTMLElement | null>(null);
  const terms = searchQuery.trim() ? extractPositiveTerms(searchQuery) : [];
  const escaped = [...new Set(terms.map(t => t.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  useEffect(() => {
    if (firstMarkRef.current && containerRef.current) {
      containerRef.current.scrollTop = Math.max(0, firstMarkRef.current.offsetTop - 8);
    }
  }, [text, searchQuery]);

  if (!text || escaped.length === 0) {
    return <div ref={containerRef} style={CLAUSE_TEXT_CELL_STYLE}>{text || '—'}</div>;
  }

  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);
  let firstMarkAssigned = false;
  return (
    <div ref={containerRef} style={CLAUSE_TEXT_CELL_STYLE}>
      {parts.map((part, i) => {
        if (i % 2 !== 1) return part;
        const isFirst = !firstMarkAssigned;
        firstMarkAssigned = true;
        return (
          <mark key={i}
            ref={isFirst ? (el => { firstMarkRef.current = el; }) : undefined}
            style={{ background: '#fde68a', color: '#111', borderRadius: 2, padding: '0 1px' }}>
            {part}
          </mark>
        );
      })}
    </div>
  );
}
function ComplianceBadge({ status }: { status?: string | null }) {
  if (!status || status === 'unchecked' || status === 'review_needed') return <span style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.35)' }}>—</span>;
  const color = COMPLIANCE_COLORS[status] || '#64748b';
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: 'nowrap' }}>
      {COMPLIANCE_LABELS[status] || status}
    </span>
  );
}

const INSURANCE_FAMILY_DOC_TYPES = ['insurance_policy', 'certificate_of_insurance'];

// The unified Clause Library mixes clauses from every source type in one
// table — Doc ID / Counterparty / Doc Type must be resolved per clause's own
// document's actual document_type, not a binary insurance-vs-everything-else
// guess (that binary previously mislabeled every regulation/entity-fact row
// as "Contract" — see cl_0068_02, a Regulation clause that isn't one).
type ClauseRowDocFamily = 'insurance' | 'regulation' | 'entity_fact' | 'contract';
const DOC_FAMILY_LABELS: Record<ClauseRowDocFamily, string> = {
  insurance: 'Insurance Policy',
  regulation: 'Regulation / Legal Authority',
  entity_fact: 'Entity Fact Document',
  contract: 'Contract',
};
function getClauseRowDocFamily(documentType: string | undefined): ClauseRowDocFamily {
  if (INSURANCE_FAMILY_DOC_TYPES.includes(documentType || '')) return 'insurance';
  if (documentType === 'regulation') return 'regulation';
  if (documentType === 'entity_fact_document') return 'entity_fact';
  return 'contract';
}

// ─── Structured-obligation side panel ───────────────────────────────────────
// Opens from a source clause. Shows EVERY atomic obligation linked to that
// clause — explicit and derived alike — with full structured detail,
// provenance (the exact source clause / unit), and per-entity applicability
// (Clients / Workers / Service Providers) with the four distinct states.
const APPLIC_STATE_META: Record<string, { label: string; color: string; short: string }> = {
  applicable:     { label: 'applicable',           color: '#34d399', short: '' },
  zero:           { label: 'none currently apply', color: 'rgba(148,163,184,0.7)', short: '0' },
  not_evaluated:  { label: 'not yet evaluated',    color: 'rgba(148,163,184,0.5)', short: '—' },
  unresolved:     { label: 'unresolved',           color: '#fbbf24', short: '?' },
  not_applicable: { label: 'not applicable to this entity type', color: 'rgba(148,163,184,0.4)', short: 'N/A' },
};

function ApplicabilityRow({ kind, data }: { kind: string; data: any }) {
  const [open, setOpen] = useState(false);
  const meta = APPLIC_STATE_META[data?.state] || APPLIC_STATE_META.not_evaluated;
  const expandable = data?.state === 'applicable' && (data?.records?.length ?? 0) > 0;
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '7px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: expandable ? 'pointer' : 'default' }} onClick={() => expandable && setOpen(o => !o)}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(148,163,184,0.55)', flex: 1 }}>{kind}</span>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: meta.color, fontFamily: 'monospace' }}>
          {data?.state === 'applicable' ? data.count : meta.short}
        </span>
        {expandable && <span style={{ fontSize: '0.6rem', color: 'rgba(148,163,184,0.5)' }}>{open ? '▾' : '▸'}</span>}
      </div>
      <div style={{ fontSize: '0.64rem', color: meta.color, opacity: 0.85, marginTop: 1 }}>
        {meta.label}{data?.reason ? ` — ${data.reason}` : ''}
      </div>
      {open && expandable && (
        <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {data.records.map((r: any) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
              <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.62rem', color: 'rgba(148,163,184,0.55)' }}>{r.id}</span>
              {r.url && <a href={r.url} style={{ color: '#a78bfa', textDecoration: 'none', fontSize: '0.65rem' }}>↗</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClauseObligationsPanel({ clause, docTitle, onClose }: { clause: any; docTitle?: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [obligations, setObligations] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    fetch(`/api/clauses/${encodeURIComponent(clause.clause_id)}/obligations`)
      .then(r => r.json())
      .then(d => { if (cancelled) return; if (d.error) setErr(d.error); else setObligations(d.obligations || []); setLoading(false); })
      .catch(() => { if (!cancelled) { setErr('Failed to load'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [clause.clause_id]);

  const L: React.CSSProperties = { fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.4)', marginBottom: 3 };

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 440, borderLeft: '1px solid var(--border-color)', background: '#09090f', overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)' }}>Structured Obligations</span>
          <div style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.5)', marginTop: 2 }}>
            <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>{clause.clause_id}</span>
            {docTitle ? ` · ${docTitle}` : ''}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Source clause text — provenance, never overwritten by a derived obligation */}
      <div style={{ marginBottom: 14, background: 'rgba(224,170,255,0.06)', border: '1px solid rgba(224,170,255,0.15)', borderRadius: 6, padding: '9px 11px' }}>
        <div style={L}>Source Clause Text</div>
        <div style={{ fontSize: '0.72rem', color: 'rgba(240,214,255,0.85)', lineHeight: 1.5, maxHeight: 130, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          {clause.clause_text || '—'}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: 30 }}>Loading obligations…</div>
      ) : err ? (
        <div style={{ color: '#f87171', fontSize: '0.75rem', padding: 12 }}>{err}</div>
      ) : obligations.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center', padding: 30 }}>
          No structured atomic obligations linked to this clause yet.
          <div style={{ fontSize: '0.68rem', marginTop: 6, opacity: 0.7 }}>Run obligation extraction on the source document to populate them.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: '0.66rem', color: 'rgba(148,163,184,0.5)' }}>{obligations.length} atomic obligation{obligations.length === 1 ? '' : 's'} from this clause</div>
          {obligations.map((o: any) => {
            const t = o.requirement_terms || {};
            return (
              <div key={o.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 12, background: 'rgba(255,255,255,0.02)', borderLeft: `3px solid ${o.derivation === 'derived' ? '#fbbf24' : '#a78bfa'}` }}>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 7 }}>
                  {o.requirement_effect && (
                    <span style={{ padding: '2px 7px', borderRadius: 99, fontSize: '0.6rem', fontWeight: 700, background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)' }}>
                      {(REQUIREMENT_EFFECT_LABELS as any)[o.requirement_effect] || o.requirement_effect}
                    </span>
                  )}
                  {o.derivation && (
                    <span style={{ padding: '2px 7px', borderRadius: 99, fontSize: '0.6rem', fontWeight: 700, background: o.derivation === 'derived' ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.12)', color: o.derivation === 'derived' ? '#fbbf24' : 'rgba(148,163,184,0.8)', border: `1px solid ${o.derivation === 'derived' ? 'rgba(245,158,11,0.3)' : 'rgba(148,163,184,0.25)'}` }}>
                      {(DERIVATION_LABELS as any)[o.derivation] || o.derivation}
                    </span>
                  )}
                  {o.topic?.label && (
                    <span style={{ padding: '2px 7px', borderRadius: 99, fontSize: '0.6rem', fontWeight: 600, background: 'rgba(56,189,248,0.12)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.25)' }}>{o.topic.label}</span>
                  )}
                  {o.resolution_status && (
                    <span style={{ padding: '2px 7px', borderRadius: 99, fontSize: '0.58rem', fontWeight: 600, color: 'rgba(148,163,184,0.6)', border: '1px solid rgba(148,163,184,0.2)' }}>{o.resolution_status.replace(/_/g, ' ')}</span>
                  )}
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 8 }}>
                  {o.requirement_summary || t.action || '—'}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', marginBottom: 8 }}>
                  {t.subject && <Field label="Duty bearer" value={t.subject} />}
                  {o.obligated_role && !t.subject && <Field label="Duty bearer" value={o.obligated_role} />}
                  {t.beneficiary && <Field label="Beneficiary" value={t.beneficiary} />}
                  {t.condition && <Field label="Condition" value={t.condition} />}
                  {t.qualification && <Field label="Qualification" value={t.qualification} />}
                  {t.exception && <Field label="Exception" value={t.exception} />}
                  {t.deadline && <Field label="Deadline" value={t.deadline} />}
                  {t.frequency && <Field label="Frequency" value={t.frequency} />}
                  {typeof o.confidence === 'number' && <Field label="Confidence" value={`${Math.round(o.confidence * 100)}%`} />}
                </div>

                {/* Provenance */}
                {o.source && (
                  <div style={{ fontSize: '0.63rem', color: 'rgba(148,163,184,0.5)', marginBottom: 8, lineHeight: 1.5 }}>
                    <span style={L as any}>Provenance</span>
                    <div>Source clause <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>{o.source.clause_id}</span>{o.source.clause_unit_id ? <> · unit <span style={{ fontFamily: 'monospace' }}>{o.source.clause_unit_id}</span></> : null}{o.source.source_subsection ? ` · ${o.source.source_subsection}` : ''}</div>
                    {o.source.source_excerpt && <div style={{ fontStyle: 'italic', marginTop: 2 }}>“{o.source.source_excerpt}”</div>}
                    {o.source.resolution_basis && <div style={{ marginTop: 2 }}>Comparison basis: {o.source.resolution_basis.replace(/_/g, ' ')}{o.source.resolution_role ? ` (${o.source.resolution_role})` : ''}</div>}
                  </div>
                )}

                {/* Applicability */}
                <div>
                  <div style={L}>Applicability</div>
                  <ApplicabilityRow kind="Clients" data={o.applicability?.client} />
                  <ApplicabilityRow kind="Workers" data={o.applicability?.worker} />
                  <ApplicabilityRow kind="Service Providers" data={o.applicability?.service_provider} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(148,163,184,0.4)' }}>{label}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.4, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

// Exported so app/(app)/documents/insurance/clauses/page.tsx can render the
// same Clause Library, scoped to insurance-family documents instead.
export function ObligationsTab({ contractFilter, insurerFilter, policyFilter, familyFilter = 'all', openClauseId }: { contractFilter?: string; insurerFilter?: string; policyFilter?: string; familyFilter?: 'contracts' | 'insurance' | 'all'; openClauseId?: string } = {}) {
  const router = useRouter();
  const [clauses, setClauses] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCounterpartyId, setFilterCounterpartyId] = useState('');
  const [counterpartyOptions, setCounterpartyOptions] = useState<CounterpartyOption[]>([]);
  // Clauses don't carry a counterparty id directly — derived via their parent
  // contract: document_id → contracts.linked_client_id/linked_vendor_id.
  const [docCounterpartyId, setDocCounterpartyId] = useState<Record<string, string>>({});
  // document_id -> real contract_id (e.g. "CNT-003") — clauses only carry document_id
  // ("doc_0042"), which never matches the Contract ID shown in the Contracts tab.
  const [docContractId, setDocContractId] = useState<Record<string, string>>({});
  // Insurance-family equivalents of docContractId/docCounterpartyId above —
  // insurance-family documents never get a contracts row, so those maps are
  // always empty for these; look up the real insurance_policies row instead.
  const [docPolicyId, setDocPolicyId] = useState<Record<string, string>>({});
  const [docInsurer, setDocInsurer] = useState<Record<string, { id: string; name: string }>>({});
  const [filterType, setFilterType] = useState('');
  const [filterVendorType, setFilterVendorType] = useState('');
  const [vendorTypeById, setVendorTypeById] = useState<Record<string, string>>({});
  const [filterList, setFilterList] = useState('');
  const [filterDocument, setFilterDocument] = useState('');
  const [extractingObls, setExtractingObls] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');
  const [clauseSearch, setClauseSearch] = useState('');
  const [obSortKey, setObSortKey] = useState('clause_no');
  const [obSortDir, setObSortDir] = useState<'asc'|'desc'>('asc');
  const [showListsPanel, setShowListsPanel] = useState(false);
  const [customClauseTypes, setCustomClauseTypes] = useState<string[]>([]);
  const [addingTypeFor, setAddingTypeFor] = useState<string | null>(null);
  const [newTypeInput, setNewTypeInput] = useState('');
  const [expandedClauses, setExpandedClauses] = useState<Set<string>>(new Set());
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});
  const [editingClauseId, setEditingClauseId] = useState<string | null>(null);
  const [editClauseData, setEditClauseData] = useState<Record<string, any>>({});
  const [savingClausePatch, setSavingClausePatch] = useState(false);
  const [selectedClauses, setSelectedClauses] = useState<Set<string>>(new Set());
  const [favListName, setFavListName] = useState('');
  const [savedLists, setSavedLists] = useState<Record<string, string[]>>({});
  const [showListPicker, setShowListPicker] = useState(false);
  const [savingToObligations, setSavingToObligations] = useState(false);
  const [cellHeights, setCellHeights] = useState<Record<string, number>>({});
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [previewClause, setPreviewClause] = useState<any | null>(null);
  const [previewPanelWidth, setPreviewPanelWidth] = useState(480);
  const [complianceDetailClause, setComplianceDetailClause] = useState<any | null>(null);
  const [compliancePlaybookRule, setCompliancePlaybookRule] = useState<any | null>(null);
  const [previewPanelDragging, setPreviewPanelDragging] = useState(false);
  const previewPanelResizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const [colWidths, setColWidths] = useState(
    // checkbox, Clause ID, Clause No., Clause Name, Clause Type, Clause Text,
    // Summary, Doc ID, Counterparty, Doc Type, Paper Source, Compliance,
    // Effective Date, Status, Actions
    [36, 90, 80, 140, 150, 200, 200, 120, 120, 120, 100, 110, 110, 88, 60]
  );
  const [activeResizeCol, setActiveResizeCol] = useState<number | null>(null);
  const [clauseIdPopup, setClauseIdPopup] = useState<{ clause: any; anchor: { top: number; left: number } } | null>(null);
  // Structured-obligation side panel — opened from a source clause.
  const [obligationPanelClause, setObligationPanelClause] = useState<any | null>(null);
  const [docFileTextCache, setDocFileTextCache] = useState<Record<string, string>>({});
  const [clauseDocViewer, setClauseDocViewer] = useState<any | null>(null);
  // The documents list API strips file_text (too large for list payloads), so
  // fetch the full row once per previewed document and cache its text here.
  useEffect(() => {
    if (!previewDocId || docFileTextCache[previewDocId] !== undefined) return;
    const docId = previewDocId;
    fetch(`/api/documents?document_id=${encodeURIComponent(docId)}`)
      .then(r => r.json())
      .then(d => {
        const text = d?.documents?.[0]?.file_text || '';
        setDocFileTextCache(prev => prev[docId] !== undefined ? prev : { ...prev, [docId]: text });
      })
      .catch(() => {
        setDocFileTextCache(prev => prev[docId] !== undefined ? prev : { ...prev, [docId]: '' });
      });
  }, [previewDocId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cpNameMap, setCpNameMap] = useState<Record<string, string>>({}); // CUST-001 / SP-001 → name
  const [clauseTextSearchOpen, setClauseTextSearchOpen] = useState(false);
  useEffect(() => {
    if (!clauseIdPopup) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-popup]')) { setClauseIdPopup(null); }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', close), 40);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', close); };
  }, [clauseIdPopup]);
  useEffect(() => {
    if (!clauseTextSearchOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-popup]')) setClauseTextSearchOpen(false);
    };
    const id = setTimeout(() => document.addEventListener('mousedown', close), 40);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', close); };
  }, [clauseTextSearchOpen]);
  const colResizeDragRef = useRef<{ col: number; startX: number; startW: number } | null>(null);
  function startColResize(col: number, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    colResizeDragRef.current = { col, startX: e.clientX, startW: colWidths[col] };
    setActiveResizeCol(col);
    const onMove = (ev: MouseEvent) => {
      const drag = colResizeDragRef.current;
      if (!drag) return;
      const delta = ev.clientX - drag.startX;
      setColWidths(prev => { const n = [...prev]; n[drag.col] = Math.max(40, drag.startW + delta); return n; });
    };
    const onUp = () => { colResizeDragRef.current = null; setActiveResizeCol(null); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startPreviewPanelResize(e: React.MouseEvent) {
    e.preventDefault();
    previewPanelResizeRef.current = { startX: e.clientX, startW: previewPanelWidth };
    setPreviewPanelDragging(true);
    const onMove = (ev: MouseEvent) => {
      if (!previewPanelResizeRef.current) return;
      const delta = previewPanelResizeRef.current.startX - ev.clientX;
      setPreviewPanelWidth(Math.max(300, Math.min(900, previewPanelResizeRef.current.startW + delta)));
    };
    const onUp = () => {
      previewPanelResizeRef.current = null;
      setPreviewPanelDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }


  useEffect(() => {
    Promise.all([
      fetchClausesCached(),
      fetchDocumentsCached(),
      fetch('/api/customers').then(r => r.json()).catch(() => ({ clients: [] })),
      fetch('/api/vendors').then(r => r.json()).catch(() => ({ service_providers: [] })),
      fetch('/api/contracts').then(r => r.json()).catch(() => ({ contracts: [] })),
    ]).then(([clauseList, docList, custData, vendData, contractData]) => {
      setClauses(clauseList || []);
      setDocs(docList || []);
      // Build ID → name lookup
      const map: Record<string, string> = {};
      for (const c of custData.clients || []) map[c.client_id] = c.client_name;
      for (const v of vendData.service_providers || []) map[v.service_provider_id] = v.legal_name;
      setCpNameMap(map);
      const vtMap: Record<string, string> = {};
      for (const v of vendData.service_providers || []) if (v.provider_type) vtMap[v.service_provider_id] = v.provider_type;
      setVendorTypeById(vtMap);
      // Insurance Clause Library: only insurers (provider_type ===
      // 'insurance_provider') are meaningful counterparties here — regular
      // vendors/clients never appear on insurance-family documents.
      setCounterpartyOptions(
        familyFilter === 'insurance'
          ? (vendData.service_providers || [])
              .filter((v: any) => v.provider_type === 'insurance_provider')
              .map((v: any) => ({ id: v.service_provider_id, name: v.legal_name, type: 'vendor' as const }))
          : [
              ...(custData.clients || []).map((c: any) => ({ id: c.client_id, name: c.client_name, type: 'client' as const })),
              ...(vendData.service_providers || []).map((v: any) => ({ id: v.service_provider_id, name: v.legal_name, type: 'vendor' as const })),
            ]
      );
      const docMap: Record<string, string> = {};
      const contractIdMap: Record<string, string> = {};
      for (const c of contractData.contracts || []) {
        if (!c.document_id) continue;
        const cpId = c.linked_client_id || c.linked_vendor_id;
        if (cpId) docMap[c.document_id] = cpId;
        if (c.contract_id) contractIdMap[c.document_id] = c.contract_id;
      }
      setDocCounterpartyId(docMap);
      setDocContractId(contractIdMap);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Deep link ?clause=<id> (from ObligationDetailPanel / the retired
  // standalone library) — open that clause's structured-obligation panel once
  // the clause list has loaded.
  const deepClauseOpenedRef = useRef(false);
  useEffect(() => {
    if (!openClauseId || deepClauseOpenedRef.current || clauses.length === 0) return;
    const match = clauses.find(c => c.clause_id === openClauseId);
    if (match) {
      setObligationPanelClause(match);
      deepClauseOpenedRef.current = true;
    }
  }, [openClauseId, clauses]);

  // Insurance-scoped equivalent of the contracts join above — needed
  // whenever insurance-family rows can appear (family=insurance or the
  // default unified 'all' view), skipped only for the contracts-only view.
  useEffect(() => {
    if (familyFilter === 'contracts') return;
    fetch('/api/insurance-policies').then(r => r.json()).then(d => {
      const policyMap: Record<string, string> = {};
      const insurerMap: Record<string, { id: string; name: string }> = {};
      for (const p of d.policies || []) {
        if (!p.document_id) continue;
        policyMap[p.document_id] = p.policy_id;
        insurerMap[p.document_id] = { id: p.insurer_vendor_id || '', name: p.insurance_company || '' };
      }
      setDocPolicyId(policyMap);
      setDocInsurer(insurerMap);
    }).catch(() => {});
  }, [familyFilter]);

  // Fetch matching playbook rule whenever the compliance detail panel opens
  useEffect(() => {
    if (!complianceDetailClause?.playbook_id) { setCompliancePlaybookRule(null); return; }
    fetch(`/api/playbooks?id=${encodeURIComponent(complianceDetailClause.playbook_id)}`)
      .then(r => r.json())
      .then(d => {
        const pb = d.playbooks?.[0];
        if (!pb?.rules) { setCompliancePlaybookRule(null); return; }
        const clauseKey = ((complianceDetailClause.clause_type || complianceDetailClause.obligation_type || '') as string)
          .toLowerCase().replace(/_/g, ' ').trim();
        const rule = (pb.rules as any[]).find(r => {
          const rk = (r.clause_type as string).toLowerCase().replace(/_/g, ' ').trim();
          return rk === clauseKey || clauseKey.includes(rk) || rk.includes(clauseKey);
        });
        setCompliancePlaybookRule(rule ?? null);
      })
      .catch(() => setCompliancePlaybookRule(null));
  }, [complianceDetailClause?.playbook_id, complianceDetailClause?.clause_type, complianceDetailClause?.obligation_type]);


  useEffect(() => {
    try {
      const stored = localStorage.getItem('consola_clause_lists');
      if (stored) setSavedLists(JSON.parse(stored));
      const storedTypes = localStorage.getItem('consola_clause_types');
      if (storedTypes) setCustomClauseTypes(JSON.parse(storedTypes));
    } catch { /* silent */ }
  }, []);

  const toggleSelect = (key: string) => {
    setSelectedClauses(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  };

  const toggleSelectAll = () => {
    const allKeys = filtered.map((c, i) => c.clause_id || String(i));
    if (allKeys.every(k => selectedClauses.has(k))) {
      setSelectedClauses(new Set());
    } else {
      setSelectedClauses(new Set(allKeys));
    }
  };

  const deleteSelected = async () => {
    const ids = [...selectedClauses].filter(id => !/^\d+$/.test(id)); // only real clause_ids
    if (ids.length > 0) {
      await fetch('/api/documents/clauses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clause_ids: ids }),
      });
    }
    setClauses(prev => prev.filter((c, i) => !selectedClauses.has(c.clause_id || String(i))));
    setSelectedClauses(new Set());
    invalidateClausesCache();
  };

  const saveToList = (listName: string) => {
    if (!listName.trim()) return;
    const ids = Array.from(selectedClauses);
    const updated = { ...savedLists, [listName.trim()]: [...new Set([...(savedLists[listName.trim()] || []), ...ids])] };
    setSavedLists(updated);
    try { localStorage.setItem('consola_clause_lists', JSON.stringify(updated)); } catch { /* silent */ }
    setSelectedClauses(new Set());
    setFavListName('');
    setShowListPicker(false);
  };

  // Manually-reviewed clauses the user chose to save as obligations — the
  // saved_obligations table's own header comment describes exactly this:
  // "One row per manually-reviewed clause a user chose to save as an
  // obligation." Reuses the same checkbox selection as Delete/Save to List
  // rather than an automatic per-save trigger, since which clauses are
  // genuinely obligations (vs. definitions, recitals, boilerplate) is a
  // human judgment call, not something to infer silently.
  const saveSelectedToObligations = async () => {
    const ids = [...selectedClauses].filter(id => !/^\d+$/.test(id));
    if (ids.length === 0) return;
    setSavingToObligations(true);
    try {
      const rows = clauses
        .filter(c => ids.includes(c.clause_id))
        .map(c => ({
          source_document_id: c.document_id || null,
          document_id: c.document_id || null,
          source_clause_id: c.clause_id || '',
          // Shares CANONICAL_CLAUSE_TYPES vocabulary with obligations.canonical_clause_type
          // (docs/ontology.md §3) — obligation_type is the field already in
          // that vocabulary; detected_type/clause_type is a fallback only
          // for clauses classify-clauses didn't map to a canonical type.
          obligation_type: c.obligation_type || (c.detected_type || '').split(',')[0]?.trim() || null,
          action_text: (c.clause_text || '').slice(0, 400),
          source_text: c.clause_text || '',
          status: 'active',
          confidence: typeof c.ai_confidence === 'number' ? c.ai_confidence : null,
        }));
      const res = await fetch('/api/obligations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      });
      if (res.ok) {
        setSelectedClauses(new Set());
      } else {
        alert('Failed to save selected clauses as obligations — please try again.');
      }
    } catch {
      alert('Failed to save selected clauses as obligations — please try again.');
    } finally {
      setSavingToObligations(false);
    }
  };

  const patchClause = async (clause_id: string, updates: Record<string, any>) => {
    await fetch('/api/documents/clauses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clause_id, ...updates }),
    });
    setClauses(prev => prev.map(c => c.clause_id === clause_id ? { ...c, ...updates } : c));
    invalidateClausesCache();
  };

  const startCellResize = (e: React.MouseEvent, key: string, currentHeight: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = currentHeight;
    const onMove = (ev: MouseEvent) => {
      setCellHeights(prev => ({ ...prev, [key]: Math.max(40, startH + (ev.clientY - startY)) }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const docMap = Object.fromEntries(docs.map((d: any) => [d.document_id, d.title || d.document_id]));
  // Clause counts per document — shown next to each contract in the Documents
  // filter so picking a contract with zero extracted clauses isn't a silent dead end.
  const clauseCountByDoc: Record<string, number> = {};
  for (const c of clauses) {
    if (!c.document_id) continue;
    clauseCountByDoc[c.document_id] = (clauseCountByDoc[c.document_id] || 0) + 1;
  }
  const docTypeMap = Object.fromEntries(docs.map((d: any) => [d.document_id, d.document_type || '']));
  const docStatusMap = Object.fromEntries(docs.map((d: any) => [d.document_id, (d.status || 'active').toLowerCase()]));
  const docEffDateMap = Object.fromEntries(docs.map((d: any) => [d.document_id, d.effective_date || null]));
  const docCounterpartyMap = Object.fromEntries(docs.map((d: any) => [d.document_id, d.counterparty_name || '']));

  // Collect all clause type names present in data
  const allTypes = [...new Set([...Object.keys(CLAUSE_TYPE_COLORS), ...customClauseTypes])];

  // Apply filters
  let filtered = clauses;
  // The default view ('all') shows every clause regardless of source type —
  // Doc ID / Counterparty / Doc Type columns below render per-row based on
  // whether that row's document is insurance-family or not. familyFilter
  // narrows to just one bucket only when a caller explicitly asks for it
  // (e.g. a deep link from an Insurance Policy or Contract row).
  if (familyFilter === 'insurance' || familyFilter === 'contracts') {
    filtered = filtered.filter(c => {
      const isInsuranceClause = INSURANCE_FAMILY_DOC_TYPES.includes(docTypeMap[c.document_id]);
      return familyFilter === 'insurance' ? isInsuranceClause : !isInsuranceClause;
    });
  }
  if (contractFilter) filtered = filtered.filter(c =>
    c.contract_family_id === contractFilter ||
    docContractId[c.document_id] === contractFilter ||
    // Regulation (and other non-bilateral) pseudo-rows in Contracts &
    // Documents use their own document_id as contract_id (no CNT-###
    // equivalent exists for them) — match directly so "View Clauses" works.
    c.document_id === contractFilter
  );
  if (insurerFilter) filtered = filtered.filter(c => (c.insurer_vendor_id || docInsurer[c.document_id]?.id) === insurerFilter);
  if (policyFilter) filtered = filtered.filter(c => docPolicyId[c.document_id] === policyFilter);
  if (filterCounterpartyId) filtered = filtered.filter(c =>
    familyFilter === 'insurance'
      ? (c.insurer_vendor_id || docInsurer[c.document_id]?.id) === filterCounterpartyId
      : docCounterpartyId[c.document_id] === filterCounterpartyId
  );
  if (filterDocument) filtered = filtered.filter(c => c.document_id === filterDocument);
  if (filterType) filtered = filtered.filter(c => (c.detected_type || '').split(',').map((s: string) => s.trim()).includes(filterType));
  if (filterVendorType) filtered = filtered.filter(c => vendorTypeById[docCounterpartyId[c.document_id]] === filterVendorType);
  if (filterList && savedLists[filterList]) filtered = filtered.filter(c => savedLists[filterList].includes(c.clause_id || ''));
  if (clauseSearch.trim()) filtered = filtered.filter(c =>
    matchesBooleanQuery([c.clause_text, c.clause_name, c.ai_classification, c.normalized_summary].filter(Boolean).join(' \n '), clauseSearch)
  );

  // Apply sort
  const sorted = obSortKey ? [...filtered].sort((a, b) => {
    if (obSortKey === 'compliance_score') {
      const sa = typeof a.compliance_score === 'number' ? a.compliance_score : -1;
      const sb = typeof b.compliance_score === 'number' ? b.compliance_score : -1;
      return obSortDir === 'asc' ? sa - sb : sb - sa;
    }
    if (obSortKey === 'clause_no') {
      const av = displayClauseNo(a);
      const bv = displayClauseNo(b);
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return obSortDir === 'asc' ? cmp : -cmp;
    }
    let av: string, bv: string;
    if (obSortKey === 'document') {
      av = (docMap[a.document_id] || a.document_id || '').toLowerCase();
      bv = (docMap[b.document_id] || b.document_id || '').toLowerCase();
    } else if (obSortKey === 'document_id') {
      av = (docContractId[a.document_id] || docPolicyId[a.document_id] || '').toLowerCase();
      bv = (docContractId[b.document_id] || docPolicyId[b.document_id] || '').toLowerCase();
    } else {
      av = (a[obSortKey] || '').toString().toLowerCase();
      bv = (b[obSortKey] || '').toString().toLowerCase();
    }
    return obSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  }) : filtered;

  const deleteList = (name: string) => {
    const updated = { ...savedLists };
    delete updated[name];
    setSavedLists(updated);
    try { localStorage.setItem('consola_clause_lists', JSON.stringify(updated)); } catch { /* silent */ }
    if (filterList === name) setFilterList('');
  };

  const handleObSort = (key: string) => {
    if (obSortKey === key) setObSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setObSortKey(key); setObSortDir('asc'); }
  };
  function ObSortIcon({ col }: { col: string }) {
    if (obSortKey !== col) return <span style={{ opacity: 0.2, fontSize: '0.5rem', marginLeft: 3 }}>↕</span>;
    return <span style={{ fontSize: '0.5rem', color: '#a78bfa', marginLeft: 3 }}>{obSortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const TH: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.45)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#090910', zIndex: 2 };
  const THS: React.CSSProperties = { ...TH, cursor: 'pointer', userSelect: 'none' };
  const TD: React.CSSProperties = { padding: '11px 16px', fontSize: '0.8rem', color: 'var(--text-secondary)', verticalAlign: 'top' };
  const DSEL: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, background: '#0d0a1a', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '0.78rem', colorScheme: 'dark' as const, outline: 'none', fontFamily: 'inherit' };

  if (loading) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>Loading…</div>;

  return (
    <>
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
    {/* ── Left column: filters + table ── */}
    <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, right: clauseDocViewer ? 520 : obligationPanelClause ? 440 : complianceDetailClause ? 360 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Contract / insurer / policy filter banner */}
      {(contractFilter || insurerFilter || policyFilter) && (
        <div style={{ padding: '8px 24px', background: 'rgba(124,58,237,0.1)', borderBottom: '1px solid rgba(124,58,237,0.25)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: '0.72rem', color: '#c4b5fd' }}>
            {policyFilter
              ? <>Showing clauses for policy <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{policyFilter}</span></>
              : insurerFilter
              ? <>Showing clauses for insurer <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{cpNameMap[insurerFilter] || insurerFilter}</span></>
              : <>Showing clauses for contract <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{contractFilter}</span></>}
          </span>
          <button
            onClick={() => router.push('/documents?tab=clause-table')}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(196,181,253,0.6)', cursor: 'pointer', fontSize: '0.72rem', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#c4b5fd')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(196,181,253,0.6)')}
          >
            × Clear filter
          </button>
        </div>
      )}
      {/* Filters bar — counterparty first; Documents only appears (and is scoped)
          once a client/vendor is selected */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <CounterpartySearchSelect
          selectedId={filterCounterpartyId}
          options={counterpartyOptions}
          onSelect={id => { setFilterCounterpartyId(id); setFilterDocument(''); }}
          onClear={() => { setFilterCounterpartyId(''); setFilterDocument(''); }}
          placeholder={familyFilter === 'insurance' ? 'Filter by insurance provider…' : 'Filter by client, service provider, or insurer…'}
          style={{ ...DSEL, minWidth: 200 }}
        />
        {filterCounterpartyId && (
          <select value={filterDocument} onChange={e => setFilterDocument(e.target.value)} style={DSEL}>
            <option value="">
              {familyFilter === 'insurance'
                ? `All Policies for this Insurer (${filtered.length})`
                : familyFilter === 'contracts'
                ? `All Contracts for this ${counterpartyOptions.find(o => o.id === filterCounterpartyId)?.type === 'vendor' ? 'Service Provider' : 'Client'} (${filtered.length})`
                : `All Documents for this Counterparty (${filtered.length})`}
            </option>
            {docs.filter((d: any) => familyFilter === 'insurance'
                ? docInsurer[d.document_id]?.id === filterCounterpartyId
                : familyFilter === 'contracts'
                ? docCounterpartyId[d.document_id] === filterCounterpartyId
                : (docCounterpartyId[d.document_id] === filterCounterpartyId || docInsurer[d.document_id]?.id === filterCounterpartyId))
              .map((d: any) => (
                <option key={d.document_id} value={d.document_id}>
                  {docContractId[d.document_id] || docPolicyId[d.document_id] || d.title || d.document_id} — {clauseCountByDoc[d.document_id] || 0} clause{(clauseCountByDoc[d.document_id] || 0) === 1 ? '' : 's'}
                </option>
              ))}
          </select>
        )}
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={DSEL}>
          <option value="">All Types</option>
          {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {familyFilter !== 'insurance' && (
          <select value={filterVendorType} onChange={e => setFilterVendorType(e.target.value)} style={DSEL}>
            <option value="">All Service Provider Types</option>
            {Object.entries(
              VENDOR_TYPE_OPTIONS.reduce((acc: Record<string, typeof VENDOR_TYPE_OPTIONS>, o) => {
                (acc[o.group] ||= []).push(o); return acc;
              }, {})
            ).map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        <select value={filterList} onChange={e => setFilterList(e.target.value)} style={DSEL}>
          <option value="">All Lists</option>
          {Object.keys(savedLists).map(name => (
            <option key={name} value={name}>{name} ({savedLists[name].length})</option>
          ))}
        </select>
        <button onClick={() => setShowListsPanel(p => !p)}
          style={{ padding: '6px 12px', borderRadius: 6, background: showListsPanel ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)', border: showListsPanel ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border-color)', color: showListsPanel ? '#a78bfa' : 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          My Lists {Object.keys(savedLists).length > 0 && <span style={{ opacity: 0.6 }}>({Object.keys(savedLists).length})</span>}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'rgba(148,163,184,0.35)' }}>{filtered.length} clauses</span>
      </div>
      {/* Actions bar — kept visually separate from filters so picking a
          counterparty can never be mistaken for clicking Export / Clause Extractor */}
      <div style={{ padding: '8px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <button
          onClick={() => {
            if (!sorted.length) return;
            const rows = sorted.map(c => {
              const rowFamily = getClauseRowDocFamily(docTypeMap[c.document_id]);
              const rowIsInsurance = rowFamily === 'insurance';
              return {
                'Clause ID': c.clause_id || '',
                'Clause No.': displayClauseNo(c),
                'Clause Name': c.clause_name || c.ai_classification || '',
                'Clause Type': c.detected_type || '',
                'Clause Text': c.clause_text || '',
                'Summary (AI)': c.ai_classification || '',
                'Doc ID': (rowIsInsurance ? docPolicyId[c.document_id] : docContractId[c.document_id]) || c.document_id || '',
                'Counterparty': (() => {
                  const ID_RE = /^(CLI|SP|CUST|VEND)-\d+$/i;
                  if (rowIsInsurance) {
                    return (c.insurer_vendor_id && cpNameMap[c.insurer_vendor_id]) || c.counterparty_name || docInsurer[c.document_id]?.name || '';
                  }
                  const rawCp = (c.counterparty_name || '').trim();
                  const id = docCounterpartyId[c.document_id] || (ID_RE.test(rawCp) ? rawCp : '');
                  const docCp = docCounterpartyMap[c.document_id] || '';
                  return (ID_RE.test(id) && cpNameMap[id])
                    || (ID_RE.test(rawCp) ? '' : rawCp)
                    || (ID_RE.test(docCp) ? (cpNameMap[docCp] || '') : docCp)
                    || id
                    || '';
                })(),
                'Doc Type': DOC_FAMILY_LABELS[rowFamily],
                'Doc Subtype': docTypeMap[c.document_id] || '',
                'Paper Source': c.paper_source || '',
                'Compliance': c.compliance_status || '',
                'Effective Date': fmtDateCL(docEffDateMap[c.document_id]),
                'Status': getClauseStatusCL(c, docStatusMap[c.document_id] || 'active'),
                'Survives Termination': c.survives_termination ? 'Yes' : 'No',
              };
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(60, Math.max(12, k.length + 4)) }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Clauses');
            XLSX.writeFile(wb, `clause-library-${new Date().toISOString().slice(0, 10)}.xlsx`);
          }}
          disabled={!sorted.length}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', color: sorted.length ? '#4ade80' : 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, cursor: sorted.length ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', fontFamily: 'inherit' }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v4h1V2h6v1H5v1h6V3h1V2a1 1 0 0 0-1-1H4zm-1 6v1h2v-1H3zm0 2v1h2v-1H3zm3-4v1h2v-1H6zm0 2v1h2v-1H6zm3-4v1h2v-1H9zm0 2v1h2v-1H9z"/></svg>
          Export ({sorted.length})
        </button>
        {(() => {
          // "Extract obligations" backfills clause_units + canonical
          // obligations + applicability for one already-parsed document.
          const docIds = new Set(sorted.map(c => c.document_id).filter(Boolean));
          const singleDocId = filterDocument || (docIds.size === 1 ? [...docIds][0] : '');
          if (!singleDocId) return null;
          return (
            <>
              <button
                onClick={async () => {
                  setExtractingObls(true); setExtractMsg('');
                  try {
                    const res = await fetch(`/api/documents/${encodeURIComponent(singleDocId)}/extract-obligations`, { method: 'POST' });
                    const d = await res.json();
                    if (d.error) setExtractMsg(d.error);
                    else {
                      setExtractMsg(`${d.explicitObligations + d.derivedObligations} obligations (${d.derivedObligations} derived) · ${d.applicability_rows} applicability rows`);
                      invalidateClausesCache();
                      fetchClausesCached().then(list => setClauses(list || []));
                    }
                  } catch { setExtractMsg('Extraction failed'); }
                  setExtractingObls(false);
                }}
                disabled={extractingObls}
                title="Segment this document's clauses into structured atomic obligations and compute applicability"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.35)', color: extractingObls ? 'var(--text-muted)' : '#a78bfa', fontSize: '0.75rem', fontWeight: 600, cursor: extractingObls ? 'wait' : 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}
              >
                {extractingObls ? 'Extracting…' : 'Extract obligations'}
              </button>
              {extractMsg && <span style={{ fontSize: '0.7rem', color: 'rgba(148,163,184,0.7)' }}>{extractMsg}</span>}
            </>
          );
        })()}
      </div>
      {/* Bulk action bar */}
      {selectedClauses.size > 0 && (
        <div style={{ padding: '8px 24px', borderBottom: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.07)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a78bfa' }}>{selectedClauses.size} selected</span>
          <button onClick={deleteSelected}
            style={{ padding: '4px 12px', borderRadius: 5, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Delete
          </button>
          <button onClick={saveSelectedToObligations} disabled={savingToObligations}
            style={{ padding: '4px 12px', borderRadius: 5, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa', fontSize: '0.72rem', fontWeight: 600, cursor: savingToObligations ? 'default' : 'pointer', fontFamily: 'inherit', opacity: savingToObligations ? 0.6 : 1 }}>
            {savingToObligations ? 'Saving…' : 'Save as Obligation'}
          </button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowListPicker(p => !p)}
              style={{ padding: '4px 12px', borderRadius: 5, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#34d399', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Save to List ▾
            </button>
            {showListPicker && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20, background: '#0e0b18', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 8, padding: 12, minWidth: 240, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.45)', marginBottom: 8 }}>Save to list</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    value={favListName}
                    onChange={e => setFavListName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveToList(favListName); }}
                    placeholder="New list name…"
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none' }}
                    autoFocus
                  />
                  <button onClick={() => saveToList(favListName)} disabled={!favListName.trim()}
                    style={{ padding: '5px 10px', borderRadius: 5, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#34d399', fontSize: '0.72rem', fontWeight: 600, cursor: favListName.trim() ? 'pointer' : 'not-allowed', opacity: favListName.trim() ? 1 : 0.5, fontFamily: 'inherit' }}>
                    Save
                  </button>
                </div>
                {Object.keys(savedLists).length > 0 && (
                  <>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.35)', marginBottom: 6 }}>Existing lists</div>
                    {Object.keys(savedLists).map(name => (
                      <button key={name} onClick={() => saveToList(name)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--text-secondary)', fontSize: '0.73rem', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 4 }}>
                        {name} <span style={{ color: 'rgba(148,163,184,0.4)', fontSize: '0.65rem' }}>({savedLists[name].length})</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setSelectedClauses(new Set())}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(148,163,184,0.45)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Clear selection
          </button>
        </div>
      )}
      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
        {/* Lists panel */}
        {showListsPanel && (
          <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border-color)', background: 'linear-gradient(180deg,#0e0b18 0%,#090910 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.45)' }}>My Lists</span>
              <button onClick={() => setShowListsPanel(false)} style={{ background: 'none', border: 'none', color: 'rgba(148,163,184,0.4)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px' }}>
              {Object.keys(savedLists).length === 0 ? (
                <div style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.75rem', textAlign: 'center', padding: '24px 0', fontStyle: 'italic' }}>No lists yet</div>
              ) : Object.entries(savedLists).map(([name, ids]) => {
                const listClauses = clauses.filter(c => ids.includes(c.clause_id || ''));
                const isActive = filterList === name;
                return (
                  <div key={name} style={{ marginBottom: 10, border: `1px solid ${isActive ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, overflow: 'hidden', background: isActive ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.02)' }}>
                    <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 600, color: isActive ? '#a78bfa' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: '0.62rem', color: 'rgba(148,163,184,0.4)', flexShrink: 0 }}>{ids.length}</span>
                      <button onClick={() => setFilterList(isActive ? '' : name)}
                        style={{ padding: '2px 7px', borderRadius: 4, background: isActive ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isActive ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.1)'}`, color: isActive ? '#a78bfa' : 'var(--text-muted)', fontSize: '0.62rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                        {isActive ? 'Clear' : 'Filter'}
                      </button>
                      <button onClick={() => deleteList(name)}
                        style={{ background: 'none', border: 'none', color: 'rgba(248,113,113,0.4)', cursor: 'pointer', fontSize: '0.72rem', padding: '1px 3px', lineHeight: 1, flexShrink: 0 }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(248,113,113,0.4)')}>✕</button>
                    </div>
                    {listClauses.length > 0 && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '6px 12px 8px' }}>
                        {listClauses.slice(0, 5).map(c => {
                          const firstLine = (c.clause_text || '').split(/\r?\n/).map((l: string) => l.trim()).find((l: string) => l.length > 0 && l.length < 80) || c.ai_classification || c.clause_id || '—';
                          return (
                            <div key={c.clause_id} style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.55)', padding: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              · {firstLine}
                            </div>
                          );
                        })}
                        {listClauses.length > 5 && (
                          <div style={{ fontSize: '0.62rem', color: 'rgba(148,163,184,0.3)', marginTop: 2 }}>+{listClauses.length - 5} more</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: '0.875rem' }}>No clauses found matching your filters</div>
          </div>
        ) : (
          /* ── Flat list (All Clauses) ── */
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...TH, padding: '10px 8px 10px 16px' }}>
                  <input type="checkbox"
                    checked={filtered.length > 0 && filtered.every((c, i) => selectedClauses.has(c.clause_id || String(i)))}
                    onChange={toggleSelectAll}
                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#a78bfa' }}
                  />
                </th>
                {([
                  ['Clause ID',       'clause_id'],
                  ['Clause No.',      'clause_no'],
                  ['Clause Name',     'clause_name'],
                  ['Clause Type',     'detected_type'],
                  ['Clause Text',     'clause_text'],
                  ['Summary (AI)',    'normalized_summary'],
                  ['Doc ID',          'document_id'],
                  ['Counterparty',    'counterparty_name'],
                  ['Doc Type',        'document_type'],
                  ['Paper Source',    'paper_source'],
                  ['Compliance',      'compliance_status'],
                  ['Effective Date',  ''],
                  ['Status',          ''],
                  ['Actions',         ''],
                ] as [string, string][]).map(([label, key], mapIdx) => {
                  const col = 1 + mapIdx;
                  const isClauseTextCol = label === 'Clause Text';
                  return (
                    <th key={label}
                      onClick={() => !isClauseTextCol && key && handleObSort(key)}
                      style={{ ...(key ? THS : TH), position: 'relative' }}>
                      {label}{key ? <ObSortIcon col={key} /> : null}
                      {isClauseTextCol && (
                        <button
                          onClick={e => { e.stopPropagation(); setClauseTextSearchOpen(o => !o); }}
                          title='Search clause text — supports AND / OR / NOT and "quoted phrases"'
                          style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: clauseSearch ? '#a78bfa' : 'rgba(148,163,184,0.5)', fontSize: '0.8rem', padding: 0, verticalAlign: 'middle' }}
                        >⌕</button>
                      )}
                      {isClauseTextCol && clauseTextSearchOpen && (
                        <div data-popup="1" onClick={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30,
                            background: '#0e0b18', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 8,
                            padding: 10, minWidth: 260, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                            textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, cursor: 'default',
                          }}>
                            <input
                              autoFocus
                              value={clauseSearch}
                              onChange={e => setClauseSearch(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Escape') { setClauseSearch(''); setClauseTextSearchOpen(false); }
                                if (e.key === 'Enter') setClauseTextSearchOpen(false);
                              }}
                              placeholder="sole AND liability"
                              style={{ width: '100%', padding: '6px 9px', borderRadius: 5, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                            />
                            <div style={{ fontSize: '0.6rem', color: 'rgba(148,163,184,0.4)', marginTop: 6, lineHeight: 1.5 }}>
                              AND / OR / NOT / -exclude / &quot;phrase&quot;
                            </div>
                            {clauseSearch && (
                              <button onClick={() => setClauseSearch('')}
                                style={{ marginTop: 6, background: 'none', border: 'none', color: 'rgba(248,113,113,0.7)', fontSize: '0.68rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                                Clear
                              </button>
                            )}
                        </div>
                      )}
                      <div
                        onMouseDown={e => startColResize(col, e)}
                        style={{
                          position: 'absolute', right: 0, top: '20%', bottom: '20%', width: 5,
                          cursor: 'col-resize',
                          background: activeResizeCol === col ? 'var(--primary-accent)' : 'rgba(255,255,255,0.1)',
                          borderRadius: 2,
                          transition: 'background 0.15s',
                          zIndex: 3,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.5)'; }}
                        onMouseLeave={e => { if (activeResizeCol !== col) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => {
                const clauseKey = c.clause_id || String(i);
                const isExpanded = expandedClauses.has(clauseKey);
                const isEditingThis = editingClauseId === clauseKey;
                const clauseTags: string[] = c.tags ? String(c.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : [];
                const docObj = docs.find((d: any) => d.document_id === c.document_id);
                const counterparty = docObj?.counterparty_name || '';
                const firstLine = (c.clause_text || '').split(/\r?\n/).map((l: string) => l.trim()).find((l: string) => l.length > 0 && l.length < 80) || '';
                const clauseTitle = firstLine || c.ai_classification || c.detected_type || '';
                const EINP: React.CSSProperties = { width: '100%', padding: '5px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: '0.73rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
                const isChecked = selectedClauses.has(clauseKey);
                // Per-row, not per-page — the unified 'all' view mixes every
                // source type's clauses in one table, so Doc ID / Counterparty
                // / Doc Type must be resolved per clause's own document, not
                // by a single family switch for the whole page.
                const rowFamily = getClauseRowDocFamily(docTypeMap[c.document_id]);
                const rowIsInsurance = rowFamily === 'insurance';
                return (
                  <tr key={clauseKey}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: isEditingThis ? 'rgba(124,58,237,0.07)' : isChecked ? 'rgba(124,58,237,0.05)' : 'transparent', transition: 'background 0.12s', verticalAlign: 'top' }}
                    onMouseEnter={e => { if (!isEditingThis && !isChecked) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'; }}
                    onMouseLeave={e => { if (!isEditingThis && !isChecked) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>

                    {/* Col 0 — Checkbox */}
                    <td style={{ padding: '11px 8px 11px 16px', verticalAlign: 'top' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(clauseKey)}
                        style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#a78bfa', marginTop: 2 }}
                      />
                    </td>

                    {/* Col 1 — Clause ID (clickable popup) */}
                    <td style={{ ...TD, whiteSpace: 'nowrap', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={e => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setClauseIdPopup(p => p?.clause.clause_id === c.clause_id ? null : { clause: c, anchor: { top: rect.bottom + 4, left: rect.left } });
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, color: '#a78bfa', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(167,139,250,0.4)', padding: 0 }}
                      >
                        {c.clause_id || '—'}
                      </button>
                    </td>

                    {/* Col 2 — Clause No. — number only, never the raw
                        extractor text (see displayClauseNo) */}
                    <td style={{ ...TD, fontSize: '0.75rem', color: 'rgba(148,163,184,0.6)', whiteSpace: 'nowrap' }}>
                      {isEditingThis
                        ? <input value={editClauseData.clause_no || ''} onChange={e => setEditClauseData(p => ({ ...p, clause_no: e.target.value }))} placeholder="No." style={EINP} />
                        : (displayClauseNo(c) || '—')}
                    </td>

                    {/* Col 3 — Clause Name */}
                    <td style={{ ...TD, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      {isEditingThis
                        ? <input value={editClauseData.clause_name || ''} onChange={e => setEditClauseData(p => ({ ...p, clause_name: e.target.value }))} placeholder="Clause name" style={EINP} />
                        : (c.clause_name || (c.detected_type || '').replace(/_/g, ' ') || '—')}
                    </td>

                    {/* Col 3b — Clause Type: controlled tag(s) from the same
                        detected_type taxonomy the "All Types" filter and
                        Document Parser's own extraction preview use — not
                        free text (that's Clause Name, above). */}
                    <td style={{ ...TD }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {(c.detected_type || '').split(',').map((s: string) => s.trim()).filter(Boolean).map((t: string, ti: number) => {
                          const colors = CLAUSE_TYPE_COLORS[t] || { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8', border: 'rgba(100,116,139,0.4)' };
                          return (
                            <span key={ti} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 99, fontSize: '0.62rem', fontWeight: 600, background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
                              {t}
                              {isEditingThis && (
                                <button onClick={() => {
                                  const types = ((editClauseData.detected_type ?? c.detected_type ?? '') as string).split(',').map(s => s.trim()).filter(Boolean);
                                  types.splice(ti, 1);
                                  setEditClauseData(p => ({ ...p, detected_type: types.join(', ') }));
                                }} style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.6, cursor: 'pointer', padding: 0, fontSize: '0.65rem', lineHeight: 1 }}>×</button>
                              )}
                            </span>
                          );
                        })}
                        {!(c.detected_type || '').trim() && !isEditingThis && <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>}
                      </div>
                      {isEditingThis && (
                        <SearchableSelect
                          value=""
                          onChange={v => {
                            if (!v) return;
                            const existing = ((editClauseData.detected_type ?? c.detected_type ?? '') as string).split(',').map(s => s.trim()).filter(Boolean);
                            if (!existing.includes(v)) setEditClauseData(p => ({ ...p, detected_type: [...existing, v].join(', ') }));
                          }}
                          options={allTypes.map(t => ({ value: t, label: t }))}
                          placeholder="Add type…"
                          style={{ marginTop: 4, background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontSize: '0.68rem', borderRadius: 4, padding: '4px 6px', fontFamily: 'inherit' }}
                        />
                      )}
                    </td>

                    {/* Col 4 — Clause Text */}
                    <td style={{ ...TD }}>
                      {isEditingThis
                        ? <textarea value={editClauseData.clause_text || ''} onChange={e => setEditClauseData(p => ({ ...p, clause_text: e.target.value }))} rows={4} style={{ ...EINP, resize: 'vertical', lineHeight: 1.5 }} />
                        : <ClauseTextCell text={c.clause_text || ''} searchQuery={clauseSearch} />}
                    </td>

                    {/* Col 5 — Summary (AI) */}
                    <td style={{ ...TD }}>
                      {isEditingThis
                        ? <textarea value={editClauseData.ai_classification || ''} onChange={e => setEditClauseData(p => ({ ...p, ai_classification: e.target.value }))} rows={3} placeholder="AI summary / description" style={{ ...EINP, resize: 'vertical', lineHeight: 1.5 }} />
                        : <div style={{ fontSize: '0.73rem', lineHeight: 1.55, color: 'var(--text-secondary)', whiteSpace: 'normal', wordBreak: 'break-word' }}>{c.ai_classification || c.normalized_summary || '—'}</div>}
                    </td>

                    {/* Col 6 — Doc ID: contract_id for contract docs, policy_id for
                        insurance-family docs (opens doc viewer with clause highlighted) */}
                    <td style={{ ...TD, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (!c.document_id) return;
                          setClauseDocViewer(clauseDocViewer?.clause_id === c.clause_id ? null : c);
                          setComplianceDetailClause(null);
                        }}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem', color: '#a78bfa', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                        title="Open document viewer with clause highlighted"
                      >
                        {(rowIsInsurance ? docPolicyId[c.document_id] : docContractId[c.document_id]) || c.document_id || '—'}
                      </button>
                    </td>

                    {/* Col 7 — Counterparty: insurer for insurance-family docs,
                        client/service provider otherwise. Same name-on-top /
                        ID-below layout as the Counter Party Name cell in the
                        Contracts & Documents table. */}
                    <td style={{ ...TD }}>
                      {(() => {
                        // Canonical business-record id prefixes: clients are
                        // CLI-###, service providers SP-### (legacy code also
                        // emitted CUST-/VEND-, kept here so old rows still resolve).
                        const ID_RE = /^(CLI|SP|CUST|VEND)-\d+$/i;
                        const rawCp = (c.counterparty_name || '').trim();
                        // Counterparty id: the contract's linked id, or the
                        // clause's own counterparty_name when an older save path
                        // stored a bare id there instead of a name.
                        const id = rowIsInsurance
                          ? (c.insurer_vendor_id || docInsurer[c.document_id]?.id || '')
                          : (docCounterpartyId[c.document_id] || (ID_RE.test(rawCp) ? rawCp : ''));
                        const isRealId = ID_RE.test(id);
                        const docCp = docCounterpartyMap[c.document_id] || '';
                        const name = (isRealId && cpNameMap[id])
                          || (rowIsInsurance ? docInsurer[c.document_id]?.name : '')
                          || (ID_RE.test(rawCp) ? '' : rawCp)
                          || (ID_RE.test(docCp) ? (cpNameMap[docCp] || '') : docCp)
                          || '';
                        if (!name && !id) return <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>;
                        return (
                          <>
                            {(name || id) && <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 1, whiteSpace: 'normal', wordBreak: 'break-word' }}>{name || id}</div>}
                            {isRealId && name && <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#a78bfa' }}>{id}</span>}
                          </>
                        );
                      })()}
                    </td>

                    {/* Col 8 — Doc Type: the row's actual document_type family
                        (Contract / Insurance Policy / Regulation / Entity
                        Fact Document — see getClauseRowDocFamily), with a
                        distinguishing subline below. For Contract/Insurance
                        that's the real subtype (MSA, Coverage Type, etc.) via
                        the same taxonomy the Contracts & Documents table
                        uses. Regulation has no subtype in that taxonomy at
                        all — 'regulation' only ever resolves back to the
                        literal "Regulation / Legal Authority" label, which
                        would just duplicate the bold line above — so it
                        shows the document's own title (e.g. "SB-88...")
                        instead. A real topical category (Privacy/TNC
                        Law/Ed Transportation) belongs to the
                        obligation_topic_definitions taxonomy from Phase 2b
                        Step 2 (not built yet) — once clause_obligation_topics
                        exists this should show that instead of the title. */}
                    <td style={{ ...TD, fontSize: '0.73rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{DOC_FAMILY_LABELS[rowFamily]}</div>
                      {rowFamily === 'regulation' ? (
                        docMap[c.document_id] && (
                          <div style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.6)', marginTop: 2 }}>{docMap[c.document_id]}</div>
                        )
                      ) : docTypeMap[c.document_id] && (
                        <div style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.6)', marginTop: 2 }}>
                          {CONTRACT_TYPE_OPTIONS.find(o => o.value === docTypeMap[c.document_id])?.label || docTypeMap[c.document_id].replace(/_/g, ' ')}
                        </div>
                      )}
                    </td>

                    {/* Col 9 — Paper Source (a Contract-only concept — insurance
                        rows fall through to the '—' case, not editable there) */}
                    <td style={{ ...TD }} onClick={e => e.stopPropagation()}>
                      {isEditingThis && !rowIsInsurance ? (
                        <select value={editClauseData.paper_source || ''} onChange={e => setEditClauseData(p => ({ ...p, paper_source: e.target.value }))} style={{ ...EINP, cursor: 'pointer' }}>
                          <option value="">— Select —</option>
                          <option value="counter_party">Counter-Party</option>
                          <option value="internal">Internal</option>
                        </select>
                      ) : c.paper_source ? (
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: c.paper_source.includes('counter') ? 'rgba(124,58,237,0.1)' : 'rgba(34,197,94,0.1)', color: c.paper_source.includes('counter') ? '#a78bfa' : '#34d399', border: `1px solid ${c.paper_source.includes('counter') ? 'rgba(124,58,237,0.25)' : 'rgba(34,197,94,0.25)'}`, whiteSpace: 'nowrap' }}>
                          {c.paper_source.includes('counter') ? 'Counter-Party' : 'Internal'}
                        </span>
                      ) : <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>}
                    </td>

                    {/* Col 10 — Compliance (insurance rows simply have no
                        compliance_status set, so ComplianceBadge renders '—') */}
                    <td style={{ ...TD, whiteSpace: 'nowrap', cursor: c.compliance_notes ? 'pointer' : 'default' }}
                      onClick={() => { if (c.compliance_notes || c.compliance_status) setComplianceDetailClause(c); }}>
                      <ComplianceBadge status={c.compliance_status} />
                    </td>

                    {/* Col 11 — Effective Date */}
                    <td style={{ ...TD, fontSize: '0.73rem', color: 'rgba(148,163,184,0.6)', whiteSpace: 'nowrap' }}>
                      {fmtDateCL(docEffDateMap[c.document_id])}
                    </td>

                    {/* Col 12 — Status (computed) */}
                    <td style={{ ...TD }}>
                      {(() => {
                        const st = getClauseStatusCL(c, docStatusMap[c.document_id] || 'active');
                        return (
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: st === 'active' ? '#22c55e' : '#f87171', border: `1px solid ${st === 'active' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}`, whiteSpace: 'nowrap' }}>
                            {st === 'active' ? 'Active' : 'Expired'}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Col 13 — Actions */}
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                      {isEditingThis ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <button onClick={async () => { setSavingClausePatch(true); await patchClause(c.clause_id, editClauseData); setSavingClausePatch(false); setEditingClauseId(null); }} disabled={savingClausePatch}
                            style={{ padding: '4px 10px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#34d399', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
                            {savingClausePatch ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingClauseId(null)}
                            style={{ padding: '4px 10px', borderRadius: 4, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => { setEditingClauseId(clauseKey); setEditClauseData({ clause_no: c.clause_no || '', clause_name: c.clause_name || '', detected_type: c.detected_type || '', ai_classification: c.ai_classification || '', clause_text: c.clause_text || '', paper_source: c.paper_source || '', survives_termination: !!c.survives_termination }); }}
                            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: 'rgba(148,163,184,0.45)', cursor: 'pointer', fontSize: '0.72rem', padding: '3px 7px', lineHeight: 1, marginRight: 5, transition: 'all 0.1s', fontFamily: 'inherit' }}
                            onMouseEnter={e => { (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.4)'); (e.currentTarget.style.color = '#a78bfa'); }}
                            onMouseLeave={e => { (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'); (e.currentTarget.style.color = 'rgba(148,163,184,0.45)'); }}>✎</button>
                          <button onClick={async () => { if (c.clause_id) await fetch('/api/documents/clauses', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clause_ids: [c.clause_id] }) }); setClauses(prev => prev.filter(x => x.clause_id !== c.clause_id)); invalidateClausesCache(); }}
                            style={{ background: 'none', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, color: 'rgba(248,113,113,0.5)', cursor: 'pointer', fontSize: '0.72rem', padding: '3px 7px', lineHeight: 1, transition: 'all 0.1s', fontFamily: 'inherit' }}
                            onMouseEnter={e => { (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.5)'); (e.currentTarget.style.color = '#f87171'); }}
                            onMouseLeave={e => { (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'); (e.currentTarget.style.color = 'rgba(248,113,113,0.5)'); }}>✕</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        </div>
      </div>
    </div>{/* end left column */}

    {/* ── Structured-obligation side panel ── */}
    {obligationPanelClause && (
      <ClauseObligationsPanel
        clause={obligationPanelClause}
        docTitle={docMap[obligationPanelClause.document_id]}
        onClose={() => setObligationPanelClause(null)}
      />
    )}

    {/* ── Compliance detail panel ── */}
    {complianceDetailClause && (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 360, borderLeft: '1px solid var(--border-color)', background: '#09090f', overflow: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', letterSpacing: '0.01em' }}>Compliance Analysis</span>
          <button onClick={() => { setComplianceDetailClause(null); setCompliancePlaybookRule(null); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Clause identity */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(148,163,184,0.4)', marginBottom: 5 }}>CLAUSE</div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {complianceDetailClause.clause_no ? <span style={{ color: 'rgba(148,163,184,0.5)', fontWeight: 400, marginRight: 6 }}>{complianceDetailClause.clause_no}</span> : null}
            {(complianceDetailClause.clause_type || complianceDetailClause.obligation_type || 'General').replace(/_/g, ' ')}
          </div>
          {docMap[complianceDetailClause.document_id] && (
            <div style={{ fontSize: '0.72rem', color: 'rgba(148,163,184,0.45)', marginTop: 3 }}>{docMap[complianceDetailClause.document_id]}</div>
          )}
        </div>

        {/* Status + Score row */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 16, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(148,163,184,0.4)', marginBottom: 5 }}>STATUS</div>
            {(() => {
              const st = complianceDetailClause.compliance_status as string;
              const color = COMPLIANCE_COLORS[st] || '#64748b';
              const label = COMPLIANCE_LABELS[st] || st || '—';
              if (!st || st === 'unchecked') return <span style={{ fontSize: '0.75rem', color: 'rgba(148,163,184,0.35)' }}>Unchecked</span>;
              return <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: `${color}22`, color, border: `1px solid ${color}44` }}>{label}</span>;
            })()}
          </div>
          {complianceDetailClause.compliance_score != null && (
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(148,163,184,0.4)', marginBottom: 5 }}>SCORE</div>
              {(() => {
                const s = complianceDetailClause.compliance_score as number;
                const color = s >= 8 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';
                return (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, color, lineHeight: 1 }}>{s}</span>
                    <span style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.4)' }}>/10</span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Score bar */}
        {complianceDetailClause.compliance_score != null && (() => {
          const s = complianceDetailClause.compliance_score as number;
          const color = s >= 8 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444';
          return (
            <div style={{ marginBottom: 16 }}>
              <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${s * 10}%`, background: color, borderRadius: 99, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          );
        })()}

        {/* AI analysis notes */}
        {complianceDetailClause.compliance_notes && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(148,163,184,0.4)', marginBottom: 6 }}>ANALYSIS</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7, background: 'rgba(255,255,255,0.025)', borderRadius: 8, padding: '12px 14px', border: '1px solid rgba(255,255,255,0.05)' }}>
              {complianceDetailClause.compliance_notes}
            </div>
          </div>
        )}

        {/* Preferred position from playbook */}
        {compliancePlaybookRule?.preferred_position && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(148,163,184,0.4)', marginBottom: 6 }}>PREFERRED POSITION</div>
            <div style={{ fontSize: '0.78rem', color: '#c4b5fd', lineHeight: 1.6, background: 'rgba(124,58,237,0.07)', borderRadius: 8, padding: '12px 14px', border: '1px solid rgba(124,58,237,0.18)' }}>
              {compliancePlaybookRule.preferred_position}
            </div>
            {compliancePlaybookRule.party_role && (
              <div style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.45)', marginTop: 5 }}>
                Role: <span style={{ color: '#a78bfa' }}>{compliancePlaybookRule.party_role}</span>
              </div>
            )}
          </div>
        )}

        {/* Actual clause text */}
        {complianceDetailClause.clause_text && (
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(148,163,184,0.4)', marginBottom: 6 }}>CLAUSE TEXT</div>
            <div style={{ fontSize: '0.72rem', color: 'rgba(148,163,184,0.5)', lineHeight: 1.65, maxHeight: 220, overflow: 'auto', background: 'rgba(255,255,255,0.015)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.04)' }}>
              {complianceDetailClause.clause_text}
            </div>
          </div>
        )}
      </div>
    )}

    {/* ── Right column: full-height preview panel (contracts browse) ── */}
    {previewDocId && (() => {
      const baseDoc = docs.find((d: any) => d.document_id === previewDocId);
      if (!baseDoc) return null;
      const cachedText = docFileTextCache[previewDocId];
      // Wait for the file_text fetch above before mounting the panel — mounting
      // with empty text would kick off its PDF re-extraction fallback for
      // documents that do have cached text in the DB.
      if (cachedText === undefined && !baseDoc.file_text) return null;
      const previewDoc = { ...baseDoc, file_text: cachedText ?? baseDoc.file_text ?? '' };
      return (
        <DocumentPreviewPanel
          doc={previewDoc}
          clauses={previewClause ? [previewClause] : []}
          onClose={() => { setPreviewDocId(null); setPreviewClause(null); }}
          width={previewPanelWidth}
          isDragging={previewPanelDragging}
          onDragStart={startPreviewPanelResize}
        />
      );
    })()}

    {/* ── Clause doc viewer — opens when Contract ID is clicked in Clause Library ── */}
    {clauseDocViewer && (
      <ClauseDocViewerPanel
        clause={clauseDocViewer}
        docs={docs}
        onClose={() => setClauseDocViewer(null)}
      />
    )}
    </div>

    {/* ── Clause ID popup ── */}
    {clauseIdPopup && (() => {
      const { clause, anchor } = clauseIdPopup;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1400;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
      return (
        <div data-popup="1" style={{ position: 'fixed', top: Math.min(anchor.top, vh - 160), left: Math.min(anchor.left, vw - 270), zIndex: 3000, width: 255, background: '#0e0b18', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', padding: '14px 16px' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(167,139,250,0.6)', marginBottom: 12, fontFamily: 'monospace' }}>{clause.clause_id}</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: '0.6rem', color: 'rgba(148,163,184,0.45)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date Added</div>
            <div style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 500 }}>{fmtDateCL(clause.created_at)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.6rem', color: 'rgba(148,163,184,0.45)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Survives Termination</div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: clause.survives_termination ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.12)', color: clause.survives_termination ? '#22c55e' : '#f87171', border: `1px solid ${clause.survives_termination ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}` }}>
              {clause.survives_termination ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
      );
    })()}

    </>
  );
}

// ─── Tab 4: Obligations ───────────────────────────────────────────────────────

const OBL_TYPE_COLORS: Record<string, string> = {
  maintenance:             '#60a5fa',
  inspection:              '#34d399',
  training:                '#a78bfa',
  safety_protocol:         '#f59e0b',
  staffing:                '#22d3ee',
  incident_response:       '#f87171',
  maintain_coverage:       '#e879f9',
  coverage_limit:          '#c084fc',
  additional_insured:      '#818cf8',
  notice_of_claim:         '#fb923c',
  claims_cooperation:      '#fbbf24',
  certificate_delivery:    '#6ee7b7',
  regulatory_reporting:    '#f43f5e',
  inspection_compliance:   '#10b981',
  permit_condition:        '#06b6d4',
  recordkeeping:           '#8b5cf6',
  post_incident_notice:    '#ef4444',
};

const OBL_STATUS_COLORS: Record<string, string> = {
  active:    '#34d399',
  satisfied: '#60a5fa',
  breached:  '#f87171',
  waived:    '#94a3b8',
  unknown:   '#f59e0b',
};

const OBL_SEVERITY_COLORS: Record<string, string> = {
  critical: '#f87171',
  high:     '#fb923c',
  medium:   '#f59e0b',
  low:      '#94a3b8',
};

function ObligationsView() {
  const [obligations, setObligations] = useState<any[]>([]);
  const [entities,    setEntities]    = useState<any[]>([]);
  const [assets,      setAssets]      = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filterType,  setFilterType]  = useState('');
  const [filterStatus,setFilterStatus]= useState('');
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [selectedObls,  setSelectedObls]   = useState<Set<string>>(new Set());
  const [oblFavListName,setOblFavListName] = useState('');
  const [oblSavedLists, setOblSavedLists]  = useState<Record<string, string[]>>({});
  const [showOblListPicker, setShowOblListPicker] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('consola_obligation_lists');
      if (stored) setOblSavedLists(JSON.parse(stored));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch('/api/obligations').then(r => r.json()).then(oblData => {
      setObligations(oblData.obligations || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const entityMap = Object.fromEntries(entities.map(e => [e.entity_id, e.name]));
  const assetMap  = Object.fromEntries(assets.map(a => [a.asset_id, a.name]));

  const filtered = obligations.filter(o => {
    if (filterType   && o.obligation_type !== filterType)   return false;
    if (filterStatus && o.status          !== filterStatus) return false;
    return true;
  });

  const TH: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: '0.61rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.45)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#090910', zIndex: 2 };
  const TD: React.CSSProperties = { padding: '9px 14px', fontSize: '0.79rem', color: 'var(--text-secondary)', verticalAlign: 'top' };

  const allTypes = [...new Set(obligations.map(o => o.obligation_type).filter(Boolean))].sort();

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const patchStatus = async (id: string, status: string) => {
    await fetch('/api/obligations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
    setObligations(prev => prev.map(o => (o.obligation_id === id || o.id === id) ? { ...o, status } : o));
  };

  const toggleOblSelect = (id: string) => {
    setSelectedObls(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const toggleOblSelectAll = () => {
    const allIds = filtered.map(o => o.obligation_id || o.id);
    if (allIds.every(id => selectedObls.has(id))) setSelectedObls(new Set());
    else setSelectedObls(new Set(allIds));
  };

  const deleteOblSelected = async () => {
    const ids = [...selectedObls];
    if (ids.length > 0) {
      await fetch('/api/obligations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    }
    setObligations(prev => prev.filter(o => !selectedObls.has(o.obligation_id || o.id)));
    setSelectedObls(new Set());
  };

  const saveOblToList = (listName: string) => {
    if (!listName.trim()) return;
    const ids = Array.from(selectedObls);
    const updated = { ...oblSavedLists, [listName.trim()]: [...new Set([...(oblSavedLists[listName.trim()] || []), ...ids])] };
    setOblSavedLists(updated);
    try { localStorage.setItem('consola_obligation_lists', JSON.stringify(updated)); } catch { /* silent */ }
    setSelectedObls(new Set());
    setOblFavListName('');
    setShowOblListPicker(false);
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>Loading…</div>;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Stats + filters bar */}
      <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        {[
          { label: 'Total',     value: obligations.length,                                    color: 'var(--text-primary)' },
          { label: 'Active',    value: obligations.filter(o => o.status === 'active').length,  color: '#34d399' },
          { label: 'Breached',  value: obligations.filter(o => o.status === 'breached').length, color: '#f87171' },
          { label: 'Satisfied', value: obligations.filter(o => o.status === 'satisfied').length,color: '#60a5fa' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px', minWidth: 72 }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '5px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none', colorScheme: 'dark' as const }}>
          <option value="">All Types</option>
          {allTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '5px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none', colorScheme: 'dark' as const }}>
          <option value="">All Statuses</option>
          {['active', 'satisfied', 'breached', 'waived', 'unknown'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Bulk action bar */}
      {selectedObls.size > 0 && (
        <div style={{ padding: '8px 24px', borderBottom: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.07)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a78bfa' }}>{selectedObls.size} selected</span>
          <button onClick={deleteOblSelected}
            style={{ padding: '4px 12px', borderRadius: 5, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Delete
          </button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowOblListPicker(p => !p)}
              style={{ padding: '4px 12px', borderRadius: 5, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#34d399', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Save to List ▾
            </button>
            {showOblListPicker && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20, background: '#0e0b18', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 8, padding: 12, minWidth: 240, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.45)', marginBottom: 8 }}>Save to list</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input value={oblFavListName} onChange={e => setOblFavListName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveOblToList(oblFavListName); }}
                    placeholder="New list name…" autoFocus
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none' }} />
                  <button onClick={() => saveOblToList(oblFavListName)} disabled={!oblFavListName.trim()}
                    style={{ padding: '5px 10px', borderRadius: 5, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#34d399', fontSize: '0.72rem', fontWeight: 600, cursor: oblFavListName.trim() ? 'pointer' : 'not-allowed', opacity: oblFavListName.trim() ? 1 : 0.5, fontFamily: 'inherit' }}>
                    Save
                  </button>
                </div>
                {Object.keys(oblSavedLists).length > 0 && (
                  <>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.35)', marginBottom: 6 }}>Existing lists</div>
                    {Object.keys(oblSavedLists).map(name => (
                      <button key={name} onClick={() => saveOblToList(name)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--text-secondary)', fontSize: '0.73rem', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 4 }}>
                        {name} <span style={{ color: 'rgba(148,163,184,0.4)', fontSize: '0.65rem' }}>({oblSavedLists[name].length})</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setSelectedObls(new Set())}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(148,163,184,0.45)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0
          ? <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>
              <div style={{ fontSize: '2rem', opacity: 0.15, marginBottom: 12 }}>◎</div>
              <div style={{ fontSize: '0.875rem' }}>No obligations yet</div>
              <div style={{ fontSize: '0.78rem', marginTop: 6, opacity: 0.6 }}>Select clauses in the Clause Library and click "Save as Obligation" to add them here</div>
            </div>
          : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...TH, width: 32, padding: '10px 8px 10px 14px' }}>
                  <input type="checkbox"
                    checked={filtered.length > 0 && filtered.every(o => selectedObls.has(o.obligation_id || o.id))}
                    onChange={toggleOblSelectAll}
                    onClick={e => e.stopPropagation()}
                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#a78bfa' }} />
                </th>
                {['', 'Doc ID', 'Source Clause', 'Type', 'Party', 'Action', 'Frequency / Deadline', 'Entity', 'Asset', 'Severity', 'Status'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map(o => {
                  const oblId     = o.obligation_id || o.id;
                  const sc        = OBL_STATUS_COLORS[o.status]   || '#94a3b8';
                  const tc        = OBL_TYPE_COLORS[o.obligation_type] || '#94a3b8';
                  const svc       = OBL_SEVERITY_COLORS[o.severity] || '#94a3b8';
                  const isExpanded = expanded.has(oblId);
                  const entityId  = o.related_entity_id || o.entity_id;
                  return (
                    <React.Fragment key={oblId}>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', background: selectedObls.has(oblId) ? 'rgba(124,58,237,0.06)' : 'transparent' }}
                        onClick={() => toggleExpand(oblId)}
                        onMouseEnter={e => { if (!selectedObls.has(oblId)) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'; }}
                        onMouseLeave={e => { if (!selectedObls.has(oblId)) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                        <td style={{ ...TD, width: 32, padding: '9px 8px 9px 14px' }} onClick={e => { e.stopPropagation(); toggleOblSelect(oblId); }}>
                          <input type="checkbox" checked={selectedObls.has(oblId)} onChange={() => toggleOblSelect(oblId)}
                            onClick={e => e.stopPropagation()}
                            style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#a78bfa' }} />
                        </td>
                        <td style={{ ...TD, width: 24, color: 'var(--text-muted)', fontSize: '0.65rem', paddingRight: 0 }}>{isExpanded ? '▾' : '▸'}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: '0.65rem', color: 'rgba(148,163,184,0.38)', whiteSpace: 'nowrap' }}>{o.document_id || '—'}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: '0.65rem', color: 'rgba(167,139,250,0.5)', whiteSpace: 'nowrap' }}>{o.source_clause_id || '—'}</td>
                        <td style={TD}>
                          <span style={{ padding: '2px 7px', borderRadius: 99, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', background: tc + '18', color: tc, border: `1px solid ${tc}44`, whiteSpace: 'nowrap' }}>
                            {(o.obligation_type || '—').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={{ ...TD, color: 'var(--text-primary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.obligated_party_text || o.normalized_summary?.split(' ')[0] || '—'}</td>
                        <td style={{ ...TD, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{o.action_text || o.normalized_summary || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.73rem', whiteSpace: 'nowrap' }}>
                          {o.frequency_text && <span>{o.frequency_text}</span>}
                          {o.frequency_text && o.deadline_text && <span style={{ opacity: 0.4 }}> · </span>}
                          {o.deadline_text && <span style={{ color: '#f59e0b' }}>{o.deadline_text}</span>}
                          {!o.frequency_text && !o.deadline_text && <span style={{ opacity: 0.3 }}>—</span>}
                        </td>
                        <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.73rem', whiteSpace: 'nowrap' }}>{entityId ? entityMap[entityId] || entityId : '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.73rem', whiteSpace: 'nowrap' }}>{(() => { const aid = o.related_asset_id || o.asset_id; return aid ? assetMap[aid] || aid : '—'; })()}</td>
                        <td style={TD}>{o.severity ? <span style={{ padding: '2px 6px', borderRadius: 99, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', background: svc + '18', color: svc, border: `1px solid ${svc}44` }}>{o.severity}</span> : <span style={{ opacity: 0.25 }}>—</span>}</td>
                        <td style={TD}>
                          <select
                            value={o.status || 'active'}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); patchStatus(oblId, e.target.value); }}
                            style={{ padding: '2px 7px', borderRadius: 99, fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', background: sc + '18', color: sc, border: `1px solid ${sc}44`, outline: 'none', cursor: 'pointer', fontFamily: 'inherit', colorScheme: 'dark' as const }}>
                            {['active', 'satisfied', 'breached', 'waived', 'unknown'].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td colSpan={12} style={{ padding: '10px 14px 14px 38px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px 20px', marginBottom: 10 }}>
                              {[
                                ['Obligation Subtype', o.obligation_subtype],
                                ['Standard',          o.standard_text],
                                ['Trigger',           o.trigger_event_type],
                                ['Confidence',        o.confidence != null ? `${Math.round(o.confidence * 100)}%` : null],
                              ].filter(([, v]) => v).map(([label, val]) => (
                                <div key={label as string}>
                                  <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 2 }}>{label as string}</div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{val as string}</div>
                                </div>
                              ))}
                            </div>
                            {(o.source_text || o.document_section_reference) && (
                              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 4, maxWidth: 800 }}>
                                {o.source_text || o.document_section_reference}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
        }
      </div>
    </div>
  );
}



// ─── Page shell ───────────────────────────────────────────────────────────────

// ─── Contracts Tab ────────────────────────────────────────────────────────────

function ContractStatusBadge({ status }: { status: 'Active' | 'Expired' | 'Approaching Expiration' }) {
  const map = {
    'Active':                 { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80' },
    'Expired':                { bg: 'rgba(239,68,68,0.12)',  color: '#f87171' },
    'Approaching Expiration': { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24' },
  };
  const c = map[status];
  return (
    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.65rem', fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

// Reflects whether THIS contract's own extracted clauses (not the linked
// client's rolled-up policy) address recording consent — set by
// classify-clauses's contract-level backfill: 'opt-in'/'opt-out' when a
// Recording Consent Clause with a determinable policy was found, 'missing'
// when the contract has been parsed but no such clause/language was found,
// null when the contract hasn't been parsed yet.
function RecordingRuleBadge({ value }: { value: 'opt-in' | 'opt-out' | 'missing' | null | undefined }) {
  if (!value) return <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>;
  const map = {
    'opt-in':  { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80',  label: 'Opt-In' },
    'opt-out': { bg: 'rgba(239,68,68,0.12)',  color: '#f87171',  label: 'Opt-Out' },
    'missing': { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24',  label: 'Missing' },
  };
  const c = map[value];
  return (
    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.65rem', fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
      {c.label}
    </span>
  );
}

// Wraps a Contracts Repository cell (Governing Law, BGC Cadence, Recording
// Rule, Effective/Expiration Date) that was auto-populated from a specific
// extracted clause. When that clause is known (contracts.*_clause_id, set by
// processDocumentUpload.ts / classify-clauses's backfills), clicking the
// cell jumps to Clause Library with that exact clause selected and its
// source document opened with the clause highlighted — so a value on this
// table is never just an unverifiable number, it's one click from the
// contract language that produced it. Renders as plain (non-clickable) text
// when no source clause is on record for this value.
function ClauseSourceCell({ documentId, clauseId, onOpen, children }: {
  documentId?: string | null; clauseId?: string | null; onOpen: (clauseId: string) => void; children: React.ReactNode;
}) {
  if (!clauseId || !documentId) return <>{children}</>;
  return (
    <span
      onClick={e => { e.stopPropagation(); onOpen(clauseId); }}
      title="Click to view the source clause, highlighted in the contract"
      style={{ cursor: 'pointer', borderBottom: '1px dotted rgba(167,139,250,0.5)', paddingBottom: 1 }}
    >
      {children}
    </span>
  );
}

function ClauseComplianceBadge({ status }: { status: 'compliant' | 'non_compliant' | 'review_needed' }) {
  const map = {
    compliant:     { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80',  label: 'Compliant' },
    non_compliant: { bg: 'rgba(239,68,68,0.12)',  color: '#f87171',  label: 'Non-Compliant' },
    review_needed: { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24',  label: 'Review Needed' },
  };
  const c = map[status] || map.review_needed;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.65rem', fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
      {c.label}
    </span>
  );
}

const CTH: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.55)',
  whiteSpace: 'nowrap', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
  position: 'sticky', top: 0, zIndex: 1,
};
const CTD: React.CSSProperties = {
  padding: '10px 12px', fontSize: '0.78rem', color: 'var(--text-primary)',
  borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle',
};
const C_INPUT: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.8rem',
  fontFamily: 'inherit', outline: 'none',
};
const C_SELECT: React.CSSProperties = { ...C_INPUT, background: '#0d0a1a', colorScheme: 'dark' };

// Searchable options for governing law / state — used in Add, Edit, and inline-edit
const GEO_OPTIONS: { value: string; label: string; group: string }[] = [
  ...US_STATES.map(s => ({ value: s.label, label: `${s.label} (${s.value})`, group: 'US States' })),
  ...COUNTRIES.map(c => ({ value: c, label: c, group: 'International' })),
];
// State-only options for governing_state field (plain name values)
const STATE_ONLY_OPTIONS: { value: string; label: string; group: string }[] = [
  ...US_STATES.map(s => ({ value: s.label, label: `${s.label} (${s.value})`, group: 'US States' })),
];

const BLANK_CONTRACT: Omit<Contract, 'contract_id'> = {
  contract_facing: 'client',
  linked_vendor_id: '',
  linked_vendor_name: '',
  governing_law: '',
  linked_client_id: '',
  linked_client_name: '',
  paper_source: 'internal',
  effective_date: '',
  expiration_date: '',
  extracted_obligations: '',
  privacy_requirements: '',
  client_specific_bgc_requirements: '',
  bgc_interval_months: null,
  contract_type: '',
  counterparty_type: '',
};

function ContractsTab({ openContract, initialSourceType }: { openContract?: string; initialSourceType?: string }) {
  const router = useRouter();
  const [contracts, setContracts] = React.useState<Contract[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [govFilter, setGovFilter] = React.useState('all');
  const [paperFilter, setPaperFilter] = React.useState('all');
  // Source Type — Insurance Policy swaps this whole tab's body for
  // InsurancePoliciesTab (its own table, its own document_id-linked detail
  // table, per the existing insurance_policies pattern) rather than trying
  // to force insurance rows into the contracts table's shape. Order Form /
  // Regulation / Other have no dedicated data source yet — selecting them
  // shows an explicit empty state rather than silently no-op'ing, so the
  // filter is honest about what exists today. This replaces the separate
  // /documents/insurance sidebar page — one page, one nav entry, Source Type
  // as a filter dimension, not a silo.
  const VALID_SOURCE_TYPES = ['all', 'contract', 'insurance', 'order_form', 'regulation', 'other'] as const;
  const [sourceType, setSourceType] = React.useState<typeof VALID_SOURCE_TYPES[number]>(
    (VALID_SOURCE_TYPES as readonly string[]).includes(initialSourceType || '') ? (initialSourceType as typeof VALID_SOURCE_TYPES[number]) : 'all'
  );
  // Lightweight parallel fetch, independent of InsurancePoliciesTab's own
  // internal state — only what the unified "All Sources" summary table needs
  // (ID, counterparty, dates, status). The full insurance table (with edit/
  // delete/clause-linking) still renders via InsurancePoliciesTab when
  // sourceType is narrowed to 'insurance'.
  const [insurancePoliciesForAll, setInsurancePoliciesForAll] = React.useState<any[]>([]);
  React.useEffect(() => {
    fetch('/api/insurance-policies').then(r => r.json()).then(d => setInsurancePoliciesForAll(d.policies || [])).catch(() => {});
  }, []);
  // Regulation-typed documents have no linked business-object row the way a
  // contract or insurance policy does (that's canonical_obligations/
  // regulatory_sources territory, not this page's) — so unlike the other two
  // pseudo-row sources, this reads straight from `documents`, not a
  // dedicated endpoint. Only the fields the unified table's summary columns
  // need, matching insurancePoliciesForAll's own scope.
  const [regulationDocsForAll, setRegulationDocsForAll] = React.useState<any[]>([]);
  React.useEffect(() => {
    fetch('/api/documents').then(r => r.json()).then(d =>
      setRegulationDocsForAll((d.documents || []).filter((doc: any) => doc.document_type === 'regulation'))
    ).catch(() => {});
  }, []);
  const [filterCounterpartyId, setFilterCounterpartyId] = React.useState('');
  const [counterpartyOptions, setCounterpartyOptions] = React.useState<CounterpartyOption[]>([]);
  const [selectedContract, setSelectedContract] = React.useState<Contract | null>(null);
  const [selectedContractFileText, setSelectedContractFileText] = React.useState('');
  // Set only when the panel was opened via a ClauseSourceCell (Recording
  // Rule / BGC / Governing Law / Effective Date / Expiration Date) so
  // DocumentPreviewPanel highlights that specific clause instead of opening
  // to a plain, unhighlighted view of the whole contract.
  const [previewClause, setPreviewClause] = React.useState<any | null>(null);
  const [panelWidth, setPanelWidth] = React.useState(420);
  const [panelDragging, setPanelDragging] = React.useState(false);
  const panelResizing = React.useRef(false);
  const panelResizeStartX = React.useRef(0);
  const panelResizeStartWidth = React.useRef(420);

  // Edit modal
  const [editContract, setEditContract] = React.useState<Contract | null>(null);
  const [editForm, setEditForm] = React.useState<Contract | null>(null);
  const [editSaving, setEditSaving] = React.useState(false);

  // Bulk upload modal
  const [bulkUploadOpen, setBulkUploadOpen] = React.useState(false);

  // Add modal
  const [showAdd, setShowAdd] = React.useState(false);
  const [addForm, setAddForm] = React.useState<Omit<Contract, 'contract_id'>>(BLANK_CONTRACT);
  const [addSaving, setAddSaving] = React.useState(false);
  const [addFile, setAddFile] = React.useState<File | null>(null);
  const [addFileText, setAddFileText] = React.useState('');
  const [addFileLoading, setAddFileLoading] = React.useState(false);
  const addFileRef = React.useRef<HTMLInputElement>(null);
  const [addFileBlobUrl, setAddFileBlobUrl] = React.useState<string | null>(null);
  const [newCounterpartyName, setNewCounterpartyName] = React.useState(''); // for inline add

  // Counterparty Type (Client / Vendor / Independent Contractor / custom)
  const [customCounterpartyTypes, setCustomCounterpartyTypes] = React.useState<string[]>([]);
  const [addingCounterpartyType, setAddingCounterpartyType] = React.useState(false);
  const [newCounterpartyTypeName, setNewCounterpartyTypeName] = React.useState('');
  const [editAddingCounterpartyType, setEditAddingCounterpartyType] = React.useState(false);
  const [editNewCounterpartyTypeName, setEditNewCounterpartyTypeName] = React.useState('');
  React.useEffect(() => { setCustomCounterpartyTypes(getCustomCounterpartyTypes()); }, []);
  const counterpartyTypeOptions = [
    ...DEFAULT_COUNTERPARTY_TYPES.map(t => ({ value: t, label: t, group: '' })),
    ...customCounterpartyTypes.map(t => ({ value: t, label: t, group: 'Custom' })),
  ];

  // Create blob URL only for PDF files (non-PDF blob URLs trigger downloads in iframes)
  const addFileIsPdf = addFile?.name?.toLowerCase().endsWith('.pdf') ?? false;
  React.useEffect(() => {
    if (!addFile || !addFileIsPdf) { setAddFileBlobUrl(null); return; }
    const url = URL.createObjectURL(addFile);
    setAddFileBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [addFile, addFileIsPdf]);

  // Vendors + clients (also feeds the counterparty filter below)
  const [vendors, setVendors] = React.useState<any[]>([]);
  React.useEffect(() => {
    Promise.all([
      fetch('/api/vendors').then(r => r.json()).catch(() => ({ service_providers: [] })),
      fetch('/api/customers').then(r => r.json()).catch(() => ({ clients: [] })),
    ]).then(([vendData, custData]) => {
      setVendors(vendData.service_providers || []);
      setCounterpartyOptions([
        ...(custData.clients || []).map((c: any) => ({ id: c.client_id, name: c.client_name, type: 'client' as const })),
        ...(vendData.service_providers || []).map((v: any) => ({ id: v.service_provider_id, name: v.legal_name, type: 'vendor' as const })),
      ]);
    });
  }, []);

  // Fetch the linked document's extracted text so the preview panel can use its
  // real search (highlight + auto-scroll + next/prev) instead of the raw PDF viewer.
  React.useEffect(() => {
    setSelectedContractFileText('');
    if (!selectedContract?.document_id) return;
    let cancelled = false;
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    supabase.from('documents').select('file_text').eq('document_id', selectedContract.document_id).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.file_text) { setSelectedContractFileText(data.file_text); return; }
        // Older documents may only have text on the uploads record, not the document row.
        fetch('/api/documents/uploads').then(r => r.json())
          .then(d => {
            if (cancelled) return;
            const up = (d.uploads || []).find((u: any) => u.document_id === selectedContract.document_id);
            setSelectedContractFileText(up?.file_text || '');
          })
          .catch(() => {});
      });
    return () => { cancelled = true; };
  }, [selectedContract?.document_id]);

  // Opens the same in-page document side panel used for a normal row click,
  // but scoped to one specific clause — resolves it from the contract's
  // clause list, then DocumentPreviewPanel highlights it via char_start/
  // char_end (same mechanism the Clause Library's clause rows use), all
  // without leaving the Contracts Repository page.
  async function openClauseInPanel(contractRow: Contract, clauseId: string) {
    if (!contractRow.document_id) return;
    setPreviewClause(null);
    setSelectedContract(contractRow);
    try {
      const res = await fetch(`/api/documents/clauses?documentId=${encodeURIComponent(contractRow.document_id)}`);
      const data = await res.json();
      const clause = (data.clauses || []).find((cl: any) => cl.clause_id === clauseId);
      if (clause) setPreviewClause(clause);
    } catch {
      // leave previewClause null — panel still opens to the plain document view
    }
  }

  const handlePdfDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setPanelDragging(true);
    panelResizing.current = true;
    panelResizeStartX.current = e.clientX;
    panelResizeStartWidth.current = panelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!panelResizing.current) return;
      const dx = panelResizeStartX.current - ev.clientX;
      const maxWidth = typeof window !== 'undefined' ? window.innerWidth / 2 : 720;
      setPanelWidth(Math.min(maxWidth, Math.max(280, panelResizeStartWidth.current + dx)));
    };
    const onUp = () => {
      panelResizing.current = false;
      setPanelDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  const loadFromApi = React.useCallback(() => {
    setLoading(true);
    fetch('/api/contracts')
      .then(r => r.json())
      .then(d => {
        // Trust any successful response, including a genuinely empty array —
        // an empty table means the user deleted everything, not "API failed."
        if (Array.isArray(d.contracts)) {
          setContracts(d.contracts);
        } else {
          setContracts(CONTRACTS);
        }
        setLoading(false);
      })
      .catch(() => { setContracts(CONTRACTS); setLoading(false); });
  }, []);

  React.useEffect(() => {
    loadFromApi();
  }, [loadFromApi]);

  async function handleDelete(contract_id: string) {
    if (!window.confirm('Delete this contract?')) return;
    const res = await fetch(`/api/contracts?contract_id=${encodeURIComponent(contract_id)}`, { method: 'DELETE' });
    if (res.ok) {
      setContracts(prev => prev.filter(c => c.contract_id !== contract_id));
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Delete failed');
    }
  }

  function openEdit(c: Contract) {
    setEditForm({ ...c });
    setEditContract(c);
  }

  async function saveEdit() {
    if (!editForm) return;
    setEditSaving(true);
    const { contract_id, ...updates } = editForm;
    const res = await fetch('/api/contracts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract_id, ...updates }),
    });
    if (res.ok) {
      const d = await res.json();
      const updated = d.contract || editForm;
      setContracts(prev => prev.map(c => c.contract_id === contract_id ? updated : c));
      setEditContract(null);
      setEditForm(null);
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Save failed');
    }
    setEditSaving(false);
  }

  async function handleAddFileSelect(file: File) {
    setAddFile(file);
    // Auto-fill title from filename if blank
    setAddForm(f => ({ ...f }));
    setAddFileLoading(true);
    setAddFileText('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/documents/preview-text', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.text) setAddFileText(data.text);
    } catch { /* silent */ } finally {
      setAddFileLoading(false);
    }
  }

  async function handleAdd() {
    setAddSaving(true);
    try {
      // 1. Resolve counterparty — create new client or vendor if needed
      let counterpartyId = '';
      let finalForm = { ...addForm };

      if (addForm.contract_facing === 'vendor') {
        if (addForm.linked_vendor_id === '_new_' && newCounterpartyName.trim()) {
          const vRes = await fetch('/api/vendors', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ legal_name: newCounterpartyName.trim() }),
          });
          if (vRes.ok) {
            const vData = await vRes.json();
            counterpartyId = vData.service_provider.service_provider_id;
            finalForm = { ...finalForm, linked_vendor_id: counterpartyId, linked_vendor_name: newCounterpartyName.trim() };
            setVendors(prev => [...prev, vData.service_provider]);
          }
        } else {
          counterpartyId = addForm.linked_vendor_id || '';
          finalForm = { ...finalForm, linked_vendor_name: vendors.find(v => v.service_provider_id === counterpartyId)?.legal_name || '' };
        }
      } else {
        if (addForm.linked_client_id === '_new_' && newCounterpartyName.trim()) {
          const cRes = await fetch('/api/customers', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_name: newCounterpartyName.trim() }),
          });
          if (cRes.ok) {
            const cData = await cRes.json();
            counterpartyId = cData.client.client_id;
            finalForm = { ...finalForm, linked_client_id: counterpartyId, linked_client_name: newCounterpartyName.trim() };
          }
        } else {
          counterpartyId = addForm.linked_client_id || '';
        }
      }

      let docId: string | undefined;

      // 2. If a file was attached, create document record + upload file to storage
      if (addFile) {
        const title = addFile.name.replace(/\.[^.]+$/, '');
        const docRes = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            document_type: 'general_contract',
            status: 'active',
            file_text: addFileText || undefined,
            // Name only — never the bare id (the contracts row below already
            // carries linked_client_id / linked_vendor_id). Storing an id here
            // makes the Clause Library counterparty column show "CLI-005".
            counterparty_name: (addForm.contract_facing === 'vendor' ? finalForm.linked_vendor_name : finalForm.linked_client_name) || undefined,
            effective_date: finalForm.effective_date || undefined,
          }),
        });
        if (docRes.ok) {
          const docData = await docRes.json();
          docId = docData.document?.document_id;
          if (docId) {
            invalidateDocumentsCache();
            const fd = new FormData();
            fd.append('file', addFile);
            // Await — a fire-and-forget POST is aborted when this modal closes
            // right after, leaving the document with no file in Storage.
            try {
              const upRes = await fetch(`/api/documents/${docId}/file`, { method: 'POST', body: fd });
              if (!upRes.ok) {
                const upErr = await upRes.json().catch(() => ({}));
                alert(`Contract created, but the attached file was NOT stored: ${upErr.error || `HTTP ${upRes.status}`}.\nThe PDF preview will be unavailable until you re-attach the file.`);
              }
            } catch (e: any) {
              alert(`Contract created, but the attached file was NOT stored: ${e?.message || 'upload failed'}.\nThe PDF preview will be unavailable until you re-attach the file.`);
            }
          }
        }
      }

      // 3. Create the contract record
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...finalForm, document_id: docId }),
      });
      if (res.ok) {
        const d = await res.json();
        setContracts(prev => [d.contract, ...prev]);
        setShowAdd(false);
        setAddForm(BLANK_CONTRACT);
        setNewCounterpartyName('');
        setAddFile(null);
        setAddFileText('');
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Create failed');
      }
    } finally {
      setAddSaving(false);
    }
  }

  // Auto-open panel when navigated here via ?open=<contract_id>
  React.useEffect(() => {
    if (!openContract || contracts.length === 0) return;
    const match = contracts.find(c => c.contract_id === openContract);
    if (match) setSelectedContract(match);
  }, [openContract, contracts]);

  const govLaws = React.useMemo(() => [...new Set(contracts.map(c => c.governing_law))].sort(), [contracts]);

  // Paper Source (internal vs. counter-party paper) is meaningful for any
  // bilaterally-negotiated agreement, not contracts exclusively — Order Form
  // is the other real case (both parties can propose their own paper);
  // Insurance Policy/Regulation/Other aren't negotiated documents in that
  // sense, so Paper Source stays inapplicable ("—") for those.
  type UnifiedDocType = 'Contract' | 'Insurance Policy' | 'Order Form' | 'Regulation / Legal Authority' | 'Other';
  const PAPER_SOURCE_APPLICABLE_TYPES: readonly UnifiedDocType[] = ['Contract', 'Order Form'];

  const contractsWithStatus = React.useMemo(() =>
    contracts.map(c => ({ ...c, docType: 'Contract' as UnifiedDocType, docSubtype: c.contract_type || undefined, status: contractStatus(c) })),
  [contracts]);

  // Insurance Policy rows, coerced into the same Contract shape so they can
  // sit in the SAME table/filter/row-click machinery below — not a separate
  // table, not a separate component. contract_id holds the real policy_id
  // (used as the row-click identity key); every other contract-only field
  // gets a safe empty default so the existing filter predicates (which
  // assume non-null strings) don't throw on these rows.
  const insurancePseudoRows = React.useMemo(() => insurancePoliciesForAll.map((p: any) => ({
    contract_id: p.policy_id, document_id: p.document_id || '', governing_law: '',
    linked_client_id: '', linked_client_name: '', linked_vendor_id: '', linked_vendor_name: p.insurance_company || '',
    // Type-satisfying placeholder only — the Paper Source cell is gated on
    // docType === 'Contract' below, so this value is never actually rendered
    // for insurance rows (we don't know an insurance policy's paper source).
    paper_source: 'internal' as const, contract_type: '', counterparty_type: '',
    effective_date: p.effective_date || '', expiration_date: p.expiration_date || '',
    extracted_obligations: '', privacy_requirements: '', client_specific_bgc_requirements: '',
    bgc_interval_months: null, recording_rule: null,
    contract_facing: undefined, bgc_requirement_types: undefined,
    docType: 'Insurance Policy' as UnifiedDocType, docSubtype: p.coverage_type || undefined,
    status: undefined as ('Expired' | 'Active' | 'Approaching Expiration' | undefined),
  })), [insurancePoliciesForAll]);

  // Regulation rows, coerced into the same Contract shape — same reasoning
  // as insurancePseudoRows above. contract_id holds the document_id (no
  // human-friendly REG-### scheme exists the way CNT-###/INS-### do), which
  // is also what ObligationsTab's contractFilter matches on for these rows
  // (see its document_id-fallback check) so "View Clauses" still works.
  const regulationPseudoRows = React.useMemo(() => regulationDocsForAll.map((doc: any) => ({
    contract_id: doc.document_id, document_id: doc.document_id, governing_law: doc.governing_state || '',
    linked_client_id: '', linked_client_name: '', linked_vendor_id: '', linked_vendor_name: '',
    paper_source: 'internal' as const, contract_type: '', counterparty_type: '',
    effective_date: doc.effective_date || '', expiration_date: doc.expiration_date || '',
    extracted_obligations: '', privacy_requirements: '', client_specific_bgc_requirements: '',
    bgc_interval_months: null, recording_rule: null,
    contract_facing: undefined, bgc_requirement_types: undefined,
    docType: 'Regulation / Legal Authority' as UnifiedDocType, docSubtype: doc.title || undefined,
    status: undefined as ('Expired' | 'Active' | 'Approaching Expiration' | undefined),
  })), [regulationDocsForAll]);

  const sourceRows = React.useMemo(() => {
    if (sourceType === 'contract') return contractsWithStatus;
    if (sourceType === 'insurance') return insurancePseudoRows;
    if (sourceType === 'regulation') return regulationPseudoRows;
    if (sourceType === 'order_form' || sourceType === 'other') return []; // no ingestion path yet — honest empty, not a silent no-op
    return [...contractsWithStatus, ...insurancePseudoRows, ...regulationPseudoRows]; // 'all'
  }, [sourceType, contractsWithStatus, insurancePseudoRows, regulationPseudoRows]);

  // "Active" includes contracts approaching expiration — that's still an
  // active, in-force contract, not a separate/exclusive bucket. Approaching
  // Expiration stays its own (overlapping) count/filter for contracts that
  // need renewal attention soon.
  const activeCount      = React.useMemo(() => contractsWithStatus.filter(c => c.status === 'Active' || c.status === 'Approaching Expiration').length, [contractsWithStatus]);
  const expiredCount     = React.useMemo(() => contractsWithStatus.filter(c => c.status === 'Expired').length, [contractsWithStatus]);
  const approachingCount = React.useMemo(() => contractsWithStatus.filter(c => c.status === 'Approaching Expiration').length, [contractsWithStatus]);
  const internalPaperPct = React.useMemo(() => {
    if (contracts.length === 0) return 0;
    const n = contracts.filter(c => { const ps = c.paper_source || ''; return ps === 'internal' || ps === 'Company Paper'; }).length;
    return Math.round((n / contracts.length) * 100);
  }, [contracts]);

  const filtered = React.useMemo(() => {
    return sourceRows.filter(c => {
      const q = search.toLowerCase();
      if (q && !c.contract_id.toLowerCase().includes(q) && !(c.linked_client_id || '').toLowerCase().includes(q) && !(c.linked_client_name || '').toLowerCase().includes(q) && !(c.linked_vendor_id || '').toLowerCase().includes(q) && !(c.linked_vendor_name || '').toLowerCase().includes(q) && !c.governing_law.toLowerCase().includes(q)) return false;
      // Status/Governing Law/Paper Source filters only meaningfully apply to
      // real contract rows — insurance (and future) pseudo-rows pass through
      // untouched unless a filter is actively narrowed away from 'all'.
      if (statusFilter === 'Active+Approaching') {
        if (c.docType === 'Contract' && c.status !== 'Active' && c.status !== 'Approaching Expiration') return false;
      } else if (statusFilter !== 'all' && c.docType === 'Contract' && c.status !== statusFilter) return false;
      if (govFilter !== 'all' && c.docType === 'Contract' && c.governing_law !== govFilter) return false;
      if (paperFilter === 'internal' && PAPER_SOURCE_APPLICABLE_TYPES.includes(c.docType)) { const ps = c.paper_source || ''; if (ps !== 'internal' && ps !== 'Company Paper') return false; }
      if (paperFilter === 'counter_party' && PAPER_SOURCE_APPLICABLE_TYPES.includes(c.docType)) { const ps = c.paper_source || ''; if (ps !== 'counter_party' && ps !== 'Client Paper') return false; }
      if (filterCounterpartyId && c.linked_client_id !== filterCounterpartyId && c.linked_vendor_id !== filterCounterpartyId) return false;
      return true;
    });
  }, [sourceRows, search, statusFilter, govFilter, paperFilter, filterCounterpartyId]);

  const SOURCE_TYPE_OPTIONS: { value: typeof sourceType; label: string }[] = [
    { value: 'all',          label: 'All Sources' },
    { value: 'contract',    label: 'Contract' },
    { value: 'insurance',   label: 'Insurance Policy' },
    { value: 'order_form',  label: 'Order Form' },
    { value: 'regulation',  label: 'Regulation / Legal Authority' },
    { value: 'other',       label: 'Other' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header row — buttons above stats */}
      <div style={{ padding: '12px 24px', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, borderBottom: '1px solid var(--border-color)' }}>
        <button
          onClick={() => setBulkUploadOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Bulk Upload
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={() => {
            if (!filtered.length) return;
            const rows = filtered.map((c: any) => ({
              'Contract ID': c.contract_id || '',
              'Client': c.client_name || '',
              'Counter-Party': c.counterparty_name || '',
              'Type': c.contract_type || '',
              'Counterparty Type': c.counterparty_type || '',
              'Status': c.status || '',
              'Recording Rule': c.recording_rule || '',
              'Effective Date': c.effective_date || '',
              'Expiration Date': c.expiration_date || '',
              'Governing Law': c.governing_law || '',
              'Value': c.contract_value || '',
              'Notes': c.notes || '',
            }));
            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(50, Math.max(12, k.length + 4)) }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Contracts');
            XLSX.writeFile(wb, `contracts-${new Date().toISOString().slice(0, 10)}.xlsx`);
          }}
          disabled={!filtered.length}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: filtered.length ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 500, cursor: filtered.length ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', fontFamily: 'inherit' }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v4h1V2h6v1H5v1h6V3h1V2a1 1 0 0 0-1-1H4zm-1 6v1h2v-1H3zm0 2v1h2v-1H3zm3-4v1h2v-1H6zm0 2v1h2v-1H6zm3-4v1h2v-1H9zm0 2v1h2v-1H9z"/></svg>
          Export ({filtered.length})
        </button>
        <button
          onClick={() => router.push('/documents/parser')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--primary-accent)', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Document
        </button>
        </div>
      </div>

      {/* Stats — each box is a filter shortcut */}
      {(() => {
        const isTotal     = statusFilter === 'all' && paperFilter === 'all';
        const isActive    = statusFilter === 'Active+Approaching';
        const isApproach  = statusFilter === 'Approaching Expiration';
        const isInternal  = paperFilter === 'internal';
        const statBox = (
          label: string, value: React.ReactNode, color: string,
          _active: boolean, onClick: () => void,
        ) => (
          <div
            onClick={onClick}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 8, padding: '12px 16px',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.5)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
          </div>
        );
        return (
          <div style={{ padding: '14px 24px 0', flexShrink: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {statBox('Total Contracts', contracts.length, 'var(--text-primary)', isTotal,
                () => { setStatusFilter('all'); setPaperFilter('all'); })}
              {statBox('Active', activeCount, '#4ade80', isActive,
                () => { setStatusFilter(isActive ? 'all' : 'Active+Approaching'); setPaperFilter('all'); })}
              {statBox('Approaching Expiration', approachingCount, '#fbbf24', isApproach,
                () => { setStatusFilter(isApproach ? 'all' : 'Approaching Expiration'); setPaperFilter('all'); })}
              {statBox('Internal Paper', <>{internalPaperPct}<span style={{ fontSize: '0.8rem', fontWeight: 400, marginLeft: 2 }}>%</span></>, '#34d399', isInternal,
                () => { setPaperFilter(isInternal ? 'all' : 'internal'); setStatusFilter('all'); })}
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div style={{ padding: '12px 24px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--border-color)' }}>
        <input style={{ ...C_INPUT, width: 240 }} placeholder="Search contract ID, client, law…" value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...C_SELECT, color: sourceType !== 'all' ? '#a78bfa' : undefined, borderColor: sourceType !== 'all' ? 'rgba(124,58,237,0.4)' : undefined }} value={sourceType} onChange={e => setSourceType(e.target.value as typeof sourceType)}>
          {SOURCE_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select style={C_SELECT} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="Active">Active</option>
          <option value="Expired">Expired</option>
          <option value="Approaching Expiration">Approaching Expiration</option>
        </select>
        <select style={C_SELECT} value={govFilter} onChange={e => setGovFilter(e.target.value)}>
          <option value="all">All Governing Law</option>
          {govLaws.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select style={{ ...C_SELECT, color: paperFilter !== 'all' ? '#a78bfa' : undefined, borderColor: paperFilter !== 'all' ? 'rgba(124,58,237,0.4)' : undefined }} value={paperFilter} onChange={e => setPaperFilter(e.target.value)}>
          <option value="all">All Paper Sources</option>
          <option value="internal">Internal Paper</option>
          <option value="counter_party">Counter-Party Paper</option>
        </select>
        <CounterpartySearchSelect
          selectedId={filterCounterpartyId}
          options={counterpartyOptions}
          onSelect={setFilterCounterpartyId}
          onClear={() => setFilterCounterpartyId('')}
          placeholder="Filter by client or service provider…"
          style={{ ...C_SELECT, minWidth: 200 }}
        />
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{filtered.length} of {sourceRows.length} source{sourceRows.length === 1 ? '' : 's'}</span>
      </div>

      {/* Main area — position:relative so panel overlays full height */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Table */}
        <div style={{ height: '100%', overflow: 'auto' }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '60px 0', fontSize: '0.85rem' }}>Loading contracts…</div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={CTH}>Doc ID</th>
                <th style={CTH}>Doc Type</th>
                <th style={CTH}>Counter Party Name</th>
                <th style={CTH}>Governing Law</th>
                <th style={CTH}>Counterparty Type</th>
                <th style={CTH}>BGC Cadence</th>
                <th style={CTH}>BGC Type</th>
                <th style={CTH} title="Recording consent language found in THIS contract's own extracted clauses">Recording Rule</th>
                <th style={CTH}>Paper Source</th>
                <th style={CTH}>Effective Date</th>
                <th style={CTH}>Expiration Date</th>
                <th style={CTH}>Status</th>
                <th style={CTH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={13} style={{ ...CTD, textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>No sources match current filters</td></tr>
              ) : filtered.map(c => (
                <tr key={c.contract_id}
                  style={{ background: 'transparent', transition: 'background 0.12s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <td style={{ ...CTD, cursor: 'pointer' }} onClick={() => { setPreviewClause(null); setSelectedContract(s => s?.contract_id === c.contract_id ? null : c); }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#a78bfa', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>{c.contract_id}</span>
                  </td>
                  <td style={{ ...CTD, cursor: 'pointer' }} onClick={() => { setPreviewClause(null); setSelectedContract(s => s?.contract_id === c.contract_id ? null : c); }}>
                    <div style={{ fontSize: '0.75rem' }}>{c.docType}</div>
                    {c.docSubtype && <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: '#a78bfa', marginTop: 1 }}>{c.docSubtype}</div>}
                  </td>
                  <td style={CTD}>
                    {(() => {
                      const isVendor = c.contract_facing === 'vendor';
                      const name = isVendor ? c.linked_vendor_name : c.linked_client_name;
                      const id   = isVendor ? c.linked_vendor_id   : c.linked_client_id;
                      return (
                        <>
                          {name && <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 1 }}>{name}</div>}
                          {id   && <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#a78bfa' }}>{id}</span>}
                          {!name && !id && <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>}
                        </>
                      );
                    })()}
                  </td>
                  <td style={{ ...CTD, whiteSpace: 'nowrap' }}>
                    <ClauseSourceCell documentId={c.document_id} clauseId={(c as any).governing_law_clause_id} onOpen={cid => openClauseInPanel(c, cid)}>{c.governing_law}</ClauseSourceCell>
                  </td>
                  <td style={{ ...CTD, fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{c.counterparty_type || '—'}</td>
                  <td style={{ ...CTD, whiteSpace: 'nowrap' }}>
                    <ClauseSourceCell documentId={c.document_id} clauseId={(c as any).bgc_interval_clause_id} onOpen={cid => openClauseInPanel(c, cid)}>
                      {c.bgc_interval_months != null
                        ? <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#c4b5fd' }}>{c.bgc_interval_months} mo</span>
                        : <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>}
                    </ClauseSourceCell>
                  </td>
                  <td style={{ ...CTD, whiteSpace: 'nowrap' }}>
                    {(() => {
                      const types = normalizeBgcRequirements(c.bgc_requirement_types);
                      if (!types.length) return <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>;
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {types.map(req => (
                            <span key={req.type} style={{ fontSize: '0.64rem', fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)', whiteSpace: 'nowrap' }}>
                              {req.type}{BGC_TYPES_WITH_JURISDICTION.includes(req.type) && req.jurisdiction.length ? ` (${req.jurisdiction.join('/')})` : ''}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={CTD}>
                    <ClauseSourceCell documentId={c.document_id} clauseId={(c as any).recording_rule_clause_id} onOpen={cid => openClauseInPanel(c, cid)}>
                      <RecordingRuleBadge value={(c as any).recording_rule} />
                    </ClauseSourceCell>
                  </td>
                  <td style={{ ...CTD }}>
                    {PAPER_SOURCE_APPLICABLE_TYPES.includes(c.docType) && c.paper_source ? (() => {
                      const isCP = c.paper_source === 'counter_party' || c.paper_source === 'Client Paper' || (c.paper_source || '').toLowerCase().includes('counter') || (c.paper_source || '').toLowerCase().includes('client');
                      return (
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap', background: isCP ? 'rgba(124,58,237,0.1)' : 'rgba(34,197,94,0.1)', color: isCP ? '#a78bfa' : '#34d399', border: `1px solid ${isCP ? 'rgba(124,58,237,0.25)' : 'rgba(34,197,94,0.25)'}` }}>
                          {isCP ? 'Counter-Party' : 'Internal'}
                        </span>
                      );
                    })() : <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>}
                  </td>
                  <td style={{ ...CTD, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    <ClauseSourceCell documentId={c.document_id} clauseId={(c as any).effective_date_clause_id} onOpen={cid => openClauseInPanel(c, cid)}>{c.effective_date}</ClauseSourceCell>
                  </td>
                  <td style={{ ...CTD, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    <ClauseSourceCell documentId={c.document_id} clauseId={(c as any).expiration_date_clause_id} onOpen={cid => openClauseInPanel(c, cid)}>{c.expiration_date}</ClauseSourceCell>
                  </td>
                  <td style={CTD}>{c.status ? <ContractStatusBadge status={c.status} /> : <span style={{ color: 'rgba(148,163,184,0.3)', fontSize: '0.72rem' }}>—</span>}</td>
                  <td style={{ ...CTD, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      <button
                        onClick={() => router.push(
                          c.docType === 'Insurance Policy'
                            // Insurance clauses live in the 'insurance' family bucket
                            // (see ObligationsTab's INSURANCE_FAMILY_DOC_TYPES split) —
                            // ?contract= only means anything inside the 'contracts'
                            // bucket. Route with ?family=insurance&policy= instead, or
                            // this 404s-to-empty exactly like /documents?tab=clause-table
                            // &contract=INS-001 did before this fix.
                            ? `/documents?tab=clause-table&family=insurance&policy=${c.contract_id}`
                            : `/documents?tab=clause-table&contract=${c.contract_id}`
                        )}
                        style={{
                          padding: '4px 10px', borderRadius: 5, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                          background: 'rgba(124,58,237,0.12)', color: '#a78bfa',
                          border: '1px solid rgba(124,58,237,0.3)', whiteSpace: 'nowrap', fontFamily: 'inherit',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.22)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.12)'; }}
                      >
                        View Clauses
                      </button>
                      <button
                        title="Edit"
                        onClick={() => openEdit(c)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.65)', cursor: 'pointer', flexShrink: 0 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#a78bfa'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(167,139,250,0.4)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(148,163,184,0.65)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button
                        title="Delete"
                        onClick={() => handleDelete(c.contract_id)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 26, borderRadius: 5, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgba(239,68,68,0.55)', cursor: 'pointer', flexShrink: 0 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.14)'; (e.currentTarget as HTMLElement).style.color = '#f87171'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.06)'; (e.currentTarget as HTMLElement).style.color = 'rgba(239,68,68,0.55)'; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>

        {/* ── Document side panel — absolute so it covers full ContractsTab height ── */}
        {selectedContract && (
          <>
            <div
              onClick={() => { setSelectedContract(null); setPreviewClause(null); }}
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 9 }}
            />
            <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: panelWidth, zIndex: 10 }}>
              <DocumentPreviewPanel
                doc={{ document_id: selectedContract.document_id, title: selectedContract.contract_id, file_text: selectedContractFileText }}
                clauses={previewClause ? [previewClause] : []}
                onClose={() => { setSelectedContract(null); setPreviewClause(null); }}
                width={panelWidth}
                isDragging={panelDragging}
                onDragStart={handlePdfDragStart}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Edit Contract Modal ── */}
      {editContract && editForm && (
        <div onClick={() => { setEditContract(null); setEditForm(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Edit Contract</h3>
                <div style={{ fontSize: '0.72rem', color: '#a78bfa', fontFamily: 'monospace', marginTop: 2 }}>{editContract.contract_id}</div>
              </div>
              <button onClick={() => { setEditContract(null); setEditForm(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '20px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', overflowY: 'auto', maxHeight: '60vh' }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Governing Law</label>
                <SearchableSelect
                  value={editForm.governing_law || ''}
                  onChange={v => setEditForm(f => f ? { ...f, governing_law: v } : f)}
                  options={GEO_OPTIONS}
                  placeholder="Search state or country…"
                  style={{ ...C_SELECT, width: '100%', display: 'flex' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>
                  Counter Party Name {editForm.contract_facing === 'vendor' ? '(Service Provider)' : '(Client)'}
                </label>
                {editForm.contract_facing === 'vendor' ? (
                  <select
                    style={C_SELECT}
                    value={editForm.linked_vendor_id || ''}
                    onChange={e => {
                      const v = vendors.find((v: any) => v.service_provider_id === e.target.value);
                      setEditForm(f => f ? { ...f, linked_vendor_id: e.target.value, linked_vendor_name: v?.legal_name || '' } : f);
                    }}
                  >
                    <option value="">— Select service provider —</option>
                    {vendors.map((v: any) => <option key={v.service_provider_id} value={v.service_provider_id}>{v.legal_name} ({v.service_provider_id})</option>)}
                  </select>
                ) : (
                  <ClientSearchDropdown
                    selectedId={editForm.linked_client_id || undefined}
                    selectedName={editForm.linked_client_name || undefined}
                    onSelect={(id, name) => setEditForm(f => f ? { ...f, linked_client_id: id, linked_client_name: name } : f)}
                    onClear={() => setEditForm(f => f ? { ...f, linked_client_id: '', linked_client_name: '' } : f)}
                    inputStyle={C_INPUT}
                  />
                )}
              </div>
              <div><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Paper Source</label>
                <select style={C_SELECT} value={editForm.paper_source || 'internal'} onChange={e => setEditForm(f => f ? { ...f, paper_source: e.target.value as any } : f)}>
                  <option value="internal">Internal</option>
                  <option value="counter_party">Counter-Party</option>
                </select>
              </div>
              <div><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Effective Date</label><input type="date" style={C_INPUT} value={editForm.effective_date || ''} onChange={e => setEditForm(f => f ? { ...f, effective_date: e.target.value } : f)} /></div>
              <div><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Expiration Date</label><input type="date" style={C_INPUT} value={editForm.expiration_date || ''} onChange={e => setEditForm(f => f ? { ...f, expiration_date: e.target.value } : f)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Contract Type</label><input style={C_INPUT} value={editForm.contract_type || ''} onChange={e => setEditForm(f => f ? { ...f, contract_type: e.target.value } : f)} /></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Counterparty Type</label>
                <SearchableSelect
                  value={editForm.counterparty_type || ''}
                  onChange={v => setEditForm(f => f ? { ...f, counterparty_type: v } : f)}
                  options={counterpartyTypeOptions}
                  placeholder="Select counterparty type…"
                  footerItems={[{ label: '+ Add new type…', onClick: () => { setEditAddingCounterpartyType(true); setEditNewCounterpartyTypeName(''); } }]}
                  style={{ ...C_SELECT, width: '100%', display: 'flex' }}
                />
                {editAddingCounterpartyType && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                    <input autoFocus value={editNewCounterpartyTypeName} onChange={e => setEditNewCounterpartyTypeName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { const t = editNewCounterpartyTypeName.trim(); if (!t) return; const u = saveCustomCounterpartyType(t); setCustomCounterpartyTypes(u); setEditForm(f => f ? { ...f, counterparty_type: t } : f); setEditAddingCounterpartyType(false); setEditNewCounterpartyTypeName(''); }
                        if (e.key === 'Escape') setEditAddingCounterpartyType(false);
                      }}
                      placeholder="New type name…" style={{ ...C_INPUT, flex: 1 }} />
                    <button onClick={() => { const t = editNewCounterpartyTypeName.trim(); if (!t) return; const u = saveCustomCounterpartyType(t); setCustomCounterpartyTypes(u); setEditForm(f => f ? { ...f, counterparty_type: t } : f); setEditAddingCounterpartyType(false); setEditNewCounterpartyTypeName(''); }}
                      disabled={!editNewCounterpartyTypeName.trim()} style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--primary-accent)', border: 'none', color: '#fff', fontSize: '0.78rem', cursor: 'pointer' }}>Add</button>
                    <button onClick={() => setEditAddingCounterpartyType(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                  </div>
                )}
              </div>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Extracted Obligations</label><input style={C_INPUT} value={editForm.extracted_obligations || ''} onChange={e => setEditForm(f => f ? { ...f, extracted_obligations: e.target.value } : f)} /></div>
              <div><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>BGC Interval (Months)</label><input type="number" min={1} style={C_INPUT} placeholder="e.g. 12" value={editForm.bgc_interval_months ?? ''} onChange={e => setEditForm(f => f ? { ...f, bgc_interval_months: e.target.value === '' ? null : Number(e.target.value) } : f)} /></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>BGC Type</label>
                <BgcTypeEditor
                  value={normalizeBgcRequirements(editForm.bgc_requirement_types)}
                  onChange={v => setEditForm(f => f ? { ...f, bgc_requirement_types: v } : f)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid var(--border-color)' }}>
              <button onClick={() => { setEditContract(null); setEditForm(null); }} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEdit} disabled={editSaving} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--primary-accent)', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', opacity: editSaving ? 0.6 : 1 }}>{editSaving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Contract Modal ── */}
      {showAdd && (
        <div onClick={() => { setShowAdd(false); setAddFile(null); setAddFileText(''); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, width: '100%', maxWidth: addFile ? 'min(90vw, 1100px)' : 580, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'max-width 0.2s ease' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Add New Contract</h3>
              <button onClick={() => { setShowAdd(false); setAddFile(null); setAddFileText(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}>×</button>
            </div>

            {/* Body — split layout when file present */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

              {/* Left: Document preview — iframe for PDF, extracted text for .docx/other */}
              {addFile && (
                <div style={{ flex: '1 1 55%', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={{ fontSize: '0.75rem', color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{addFile.name}</span>
                    {addFileLoading && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>Extracting…</span>}
                    {!addFileLoading && addFileText && <span style={{ fontSize: '0.68rem', color: '#34d399', flexShrink: 0 }}>Text extracted</span>}
                  </div>
                  {addFileIsPdf && addFileBlobUrl ? (
                    <iframe
                      src={addFileBlobUrl}
                      title="Contract preview"
                      style={{ flex: 1, border: 'none', background: '#1a1a2e', minHeight: 500 }}
                    />
                  ) : addFileText ? (
                    <div style={{ flex: 1, overflow: 'auto', background: '#111118', padding: '20px 16px' }}>
                      <div style={{
                        background: '#fff', margin: '0 auto', maxWidth: 560, width: '100%',
                        padding: '40px 48px', boxShadow: '0 2px 20px rgba(0,0,0,0.6)', borderRadius: 2,
                        fontSize: '0.82rem', lineHeight: 1.85, color: '#1a1a1a',
                        fontFamily: '"Times New Roman", Times, Georgia, serif',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxSizing: 'border-box',
                      } as React.CSSProperties}>
                        {addFileText}
                      </div>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {addFileLoading ? 'Extracting text…' : 'No preview available'}
                    </div>
                  )}
                </div>
              )}

              {/* Right: Form */}
              <div style={{ flex: addFile ? '0 0 380px' : '1', display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
                <div style={{ padding: '20px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px' }}>

                  {/* ── Document attachment ── */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>Attach Document <span style={{ color: 'rgba(148,163,184,0.4)', fontWeight: 400, textTransform: 'none' }}>(optional)</span></label>
                    <input
                      ref={addFileRef}
                      type="file"
                      accept=".pdf,.txt,.doc,.docx"
                      style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleAddFileSelect(f); }}
                    />
                    {!addFile ? (
                      <button
                        onClick={() => addFileRef.current?.click()}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', borderRadius: 7, border: '1px dashed rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Click to upload PDF or document
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 7, border: '1px solid rgba(167,139,250,0.3)', background: 'rgba(167,139,250,0.06)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span style={{ flex: 1, fontSize: '0.8rem', color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addFile.name}</span>
                        <button onClick={() => { setAddFile(null); setAddFileText(''); if (addFileRef.current) addFileRef.current.value = ''; }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 2px' }}>×</button>
                      </div>
                    )}
                  </div>

                  {/* ── Contract Facing ── */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>Contract Facing</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {(['client', 'vendor'] as const).map(type => {
                        const active = (addForm.contract_facing || 'client') === type;
                        return (
                          <button key={type} type="button"
                            onClick={() => { setAddForm(f => ({ ...f, contract_facing: type, linked_client_id: '', linked_client_name: '', linked_vendor_id: '', linked_vendor_name: '' })); setNewCounterpartyName(''); }}
                            style={{ flex: 1, padding: '8px 0', borderRadius: 7, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${active ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.1)'}`, background: active ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)', color: active ? '#a78bfa' : 'var(--text-muted)', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                            {type === 'client' ? '👤 Client-Facing' : '🏢 Service Provider-Facing'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Counter-Party selection ── */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                      {addForm.contract_facing === 'vendor' ? 'Service Provider' : 'Client'}
                    </label>

                    {addForm.contract_facing === 'vendor' ? (
                      /* ── Vendor selector ── */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <select
                          style={C_SELECT}
                          value={addForm.linked_vendor_id || ''}
                          onChange={e => { setAddForm(f => ({ ...f, linked_vendor_id: e.target.value })); if (e.target.value !== '_new_') setNewCounterpartyName(''); }}
                        >
                          <option value="">— Select existing service provider —</option>
                          {vendors.map((v: any) => <option key={v.service_provider_id} value={v.service_provider_id}>{v.legal_name} ({v.service_provider_id})</option>)}
                          <option value="_new_">+ Add new service provider…</option>
                        </select>
                        {addForm.linked_vendor_id === '_new_' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 6, background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.2)' }}>
                            <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, whiteSpace: 'nowrap' }}>New service provider name:</span>
                            <input
                              value={newCounterpartyName}
                              onChange={e => setNewCounterpartyName(e.target.value)}
                              placeholder="e.g. Acme Supplies Inc."
                              style={{ ...C_INPUT, flex: 1, marginBottom: 0 }}
                              autoFocus
                            />
                            <span style={{ fontSize: '0.65rem', color: 'rgba(167,139,250,0.5)', whiteSpace: 'nowrap' }}>→ SP-###</span>
                          </div>
                        )}
                        {addForm.linked_vendor_id && addForm.linked_vendor_id !== '_new_' && (
                          <div style={{ fontSize: '0.72rem', color: '#a78bfa', fontFamily: 'monospace', padding: '2px 6px' }}>
                            Counter-Party ID: <strong>{addForm.linked_vendor_id}</strong>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* ── Client selector ── */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <ClientSearchDropdown
                          selectedId={addForm.linked_client_id === '_new_' ? undefined : (addForm.linked_client_id || undefined)}
                          selectedName={addForm.linked_client_id === '_new_' ? undefined : (addForm.linked_client_name || undefined)}
                          onSelect={(id, name) => { setAddForm(f => ({ ...f, linked_client_id: id, linked_client_name: name })); setNewCounterpartyName(''); }}
                          onClear={() => setAddForm(f => ({ ...f, linked_client_id: '', linked_client_name: '' }))}
                          inputStyle={C_INPUT}
                        />
                        <button type="button"
                          onClick={() => { setAddForm(f => ({ ...f, linked_client_id: '_new_', linked_client_name: '' })); }}
                          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: addForm.linked_client_id === '_new_' ? '#a78bfa' : 'rgba(148,163,184,0.5)', fontSize: '0.72rem', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                          + Add new client not in list
                        </button>
                        {addForm.linked_client_id === '_new_' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 6, background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.2)' }}>
                            <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, whiteSpace: 'nowrap' }}>New client name:</span>
                            <input
                              value={newCounterpartyName}
                              onChange={e => setNewCounterpartyName(e.target.value)}
                              placeholder="e.g. Vail Resorts, Inc."
                              style={{ ...C_INPUT, flex: 1, marginBottom: 0 }}
                              autoFocus
                            />
                            <span style={{ fontSize: '0.65rem', color: 'rgba(167,139,250,0.5)', whiteSpace: 'nowrap' }}>→ CUST-###</span>
                          </div>
                        )}
                        {addForm.linked_client_id && addForm.linked_client_id !== '_new_' && (
                          <div style={{ fontSize: '0.72rem', color: '#a78bfa', fontFamily: 'monospace', padding: '2px 6px' }}>
                            Counter-Party ID: <strong>{addForm.linked_client_id}</strong>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Governing Law</label>
                    <SearchableSelect
                      value={addForm.governing_law}
                      onChange={v => setAddForm(f => ({ ...f, governing_law: v }))}
                      options={GEO_OPTIONS}
                      placeholder="Search state or country…"
                      style={{ ...C_SELECT, width: '100%', display: 'flex' }}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Contract Type</label>
                    <SearchableSelect
                      value={addForm.contract_type || ''}
                      onChange={v => setAddForm(f => ({ ...f, contract_type: v }))}
                      options={CONTRACT_TYPE_OPTIONS}
                      placeholder="Select contract type…"
                      style={{ ...C_SELECT, width: '100%', display: 'flex' }}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Counterparty Type</label>
                    <SearchableSelect
                      value={addForm.counterparty_type || ''}
                      onChange={v => setAddForm(f => ({ ...f, counterparty_type: v }))}
                      options={counterpartyTypeOptions}
                      placeholder="Select counterparty type…"
                      footerItems={[{ label: '+ Add new type…', onClick: () => { setAddingCounterpartyType(true); setNewCounterpartyTypeName(''); } }]}
                      style={{ ...C_SELECT, width: '100%', display: 'flex' }}
                    />
                    {addingCounterpartyType && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                        <input autoFocus value={newCounterpartyTypeName} onChange={e => setNewCounterpartyTypeName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { const t = newCounterpartyTypeName.trim(); if (!t) return; const u = saveCustomCounterpartyType(t); setCustomCounterpartyTypes(u); setAddForm(f => ({ ...f, counterparty_type: t })); setAddingCounterpartyType(false); setNewCounterpartyTypeName(''); }
                            if (e.key === 'Escape') setAddingCounterpartyType(false);
                          }}
                          placeholder="New type name…" style={{ ...C_INPUT, flex: 1 }} />
                        <button onClick={() => { const t = newCounterpartyTypeName.trim(); if (!t) return; const u = saveCustomCounterpartyType(t); setCustomCounterpartyTypes(u); setAddForm(f => ({ ...f, counterparty_type: t })); setAddingCounterpartyType(false); setNewCounterpartyTypeName(''); }}
                          disabled={!newCounterpartyTypeName.trim()} style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--primary-accent)', border: 'none', color: '#fff', fontSize: '0.78rem', cursor: 'pointer' }}>Add</button>
                        <button onClick={() => setAddingCounterpartyType(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                      </div>
                    )}
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Paper Source</label>
                    <select style={{ ...C_SELECT, width: '100%' }} value={addForm.paper_source} onChange={e => setAddForm(f => ({ ...f, paper_source: e.target.value as any }))}>
                      <option value="internal">Internal</option>
                      <option value="counter_party">Counter-Party</option>
                    </select>
                  </div>
                  <div><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Effective Date</label><input type="date" style={C_INPUT} value={addForm.effective_date} onChange={e => setAddForm(f => ({ ...f, effective_date: e.target.value }))} /></div>
                  <div><label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>Expiration Date</label><input type="date" style={C_INPUT} value={addForm.expiration_date} onChange={e => setAddForm(f => ({ ...f, expiration_date: e.target.value }))} /></div>
                  <div style={{ gridColumn: '1 / -1', fontSize: '0.74rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    BGC requirement will be detected automatically once this contract's clauses are extracted.
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
              <button onClick={() => { setShowAdd(false); setAddFile(null); setAddFileText(''); }} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleAdd} disabled={addSaving || addFileLoading} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--primary-accent)', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', opacity: (addSaving || addFileLoading) ? 0.6 : 1 }}>
                {addSaving ? (addFile ? 'Uploading…' : 'Creating…') : 'Create Contract'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BulkDocumentUploadModal
        open={bulkUploadOpen}
        onClose={() => setBulkUploadOpen(false)}
        onBatchComplete={loadFromApi}
      />
    </div>
  );
}


// ─── Insurance tab — policies extracted via the Document Parser's "Save to
// Insurance Table" option in handleSave (ClauseExplorerTab) and
// app/api/documents/classify-insurance. Deliberately read-only besides
// Delete: these rows are meant to come from document extraction, not manual
// entry, so there's no Add/Edit form here in v1. ──────────────────────────
const INS_TH: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(148,163,184,0.55)',
  whiteSpace: 'nowrap', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
  position: 'sticky', top: 0, zIndex: 1,
};
const INS_TD: React.CSSProperties = {
  padding: '9px 12px', fontSize: '0.78rem', color: 'var(--text-primary)',
  borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle',
};

// Exported (in addition to this file's default export) so
// app/(app)/documents/insurance/page.tsx can render it standalone.
export function InsurancePoliciesTab() {
  const router = useRouter();
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/insurance-policies')
      .then(r => r.json())
      .then(d => { setPolicies(d.policies || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(policyId: string) {
    if (!window.confirm(`Delete insurance policy ${policyId}?`)) return;
    setPolicies(prev => prev.filter(p => p.policy_id !== policyId));
    try {
      await fetch(`/api/insurance-policies?policy_id=${encodeURIComponent(policyId)}`, { method: 'DELETE' });
    } catch {
      // best-effort — local state already reflects the removal
    }
  }

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading insurance policies…</div>;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 24px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{policies.length} polic{policies.length === 1 ? 'y' : 'ies'}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Extracted via the <strong>Document Parser</strong> tab — select or upload an Insurance Policy or Certificate of Insurance document and click Extract.
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={INS_TH}>Policy ID</th>
              <th style={INS_TH}>Policy #</th>
              <th style={INS_TH}>Type</th>
              <th style={INS_TH}>Insurance Company</th>
              <th style={INS_TH}>Named Insured</th>
              <th style={INS_TH}>Covered Client(s)</th>
              <th style={INS_TH}>Coverage Type</th>
              <th style={INS_TH}>Limits</th>
              <th style={INS_TH}>Effective Date</th>
              <th style={INS_TH}>Expiration Date</th>
              <th style={INS_TH}>States</th>
              <th style={INS_TH}>Source Document</th>
              <th style={{ ...INS_TH, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr>
                <td colSpan={13} style={{ ...INS_TD, textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>
                  No insurance policies on file yet
                </td>
              </tr>
            ) : policies.map((p, i) => (
              <tr key={p.policy_id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={INS_TD}><span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#a78bfa' }}>{p.policy_id}</span></td>
                <td style={{ ...INS_TD, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{p.policy_number || '—'}</td>
                <td style={{ ...INS_TD, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.source_document_type === 'certificate_of_insurance' ? 'COI' : 'Policy'}</td>
                <td style={INS_TD}>{p.insurance_company || '—'}</td>
                <td style={INS_TD}>{(p.named_insured || []).length ? p.named_insured.join(', ') : '—'}</td>
                <td style={INS_TD}>
                  {(p.linked_client_ids || []).length > 0 ? (
                    <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {p.linked_client_ids.map((cid: string) => (
                        <span key={cid} style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#a78bfa' }}>{cid}</span>
                      ))}
                    </span>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={INS_TD}>{p.coverage_type || '—'}</td>
                <td style={{ ...INS_TD, fontSize: '0.72rem', color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.coverage_amount || ''}>{p.coverage_amount || '—'}</td>
                <td style={{ ...INS_TD, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{p.effective_date || '—'}</td>
                <td style={{ ...INS_TD, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{p.expiration_date || '—'}</td>
                <td style={{ ...INS_TD, fontSize: '0.72rem', color: 'var(--text-secondary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(p.states || []).length ? p.states.join(', ') : '—'}</td>
                <td style={INS_TD}>{p.document_id ? <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{p.document_id}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td style={{ ...INS_TD, textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      onClick={() => router.push(`/documents/insurance/clauses?policy=${p.policy_id}`)}
                      style={{
                        padding: '4px 10px', borderRadius: 5, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                        background: 'rgba(124,58,237,0.12)', color: '#a78bfa',
                        border: '1px solid rgba(124,58,237,0.3)', whiteSpace: 'nowrap', fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.22)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.12)'; }}
                    >
                      View Clauses
                    </button>
                    <button onClick={() => handleDelete(p.policy_id)} title="Delete"
                      style={{ width: 28, height: 26, borderRadius: 4, background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.25)', color: '#64748b', cursor: 'pointer', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: 'auto' }}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
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

// Document Parser stays its own sidebar page (an upload/parse workflow, not
// a source-type silo). Insurance no longer does — it was previously split
// into /documents/insurance specifically so it wasn't "buried behind a pill
// on the Contracts page," but that's exactly the silo the unified
// Contracts & Documents view (Source Type as a filter, not a separate nav
// entry) is meant to replace. Old /documents/insurance* URLs now redirect
// here with sourceType/family query params instead of 404ing.
// The former "Obligations" tab (a manual saved-obligations list) has been
// removed — structured atomic obligations now live inside the Clause Library,
// opened from their source clause. The saved_obligations table and
// /api/obligations routes remain for the risk-recompute integration.
const TABS = [
  { id: 'contracts',    label: 'Documents' },
  { id: 'clause-table', label: 'Clause Library' },
];

function DocsObligationsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get('tab');
  const contractFilter = searchParams.get('contract') || '';
  const openContract   = searchParams.get('open')     || '';
  const sourceType     = searchParams.get('sourceType') || '';
  const clauseFamily   = searchParams.get('family') === 'insurance' ? 'insurance' : searchParams.get('family') === 'contracts' ? 'contracts' : 'all';
  const insurerFilter  = searchParams.get('insurer') || '';
  const policyFilter   = searchParams.get('policy')  || '';
  const openClauseId   = searchParams.get('clause')  || '';
  const activeTab = TABS.some(t => t.id === rawTab) ? rawTab! : 'contracts';

  const setTab = (id: string) => {
    // Switching tabs clears the contract filter
    router.push(`/documents${id !== 'contracts' ? `?tab=${id}` : ''}`);
  };

  const headerTitle    = activeTab === 'clause-table' ? 'Clause Library'
    : activeTab === 'vendors' ? 'Service Providers'
    : 'Documents';
  const headerSubtitle = activeTab === 'clause-table'
    ? 'All saved clauses — browse, filter and review extracted clauses, across every source type'
    : activeTab === 'vendors'
    ? 'Manage service providers linked to contracts — auto-assigned SP-### IDs flow into clause counter-party'
    : 'Contracts, order forms, insurance policies, regulations, and other obligation-producing sources — browse, view, filter and manage by Source Type';

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PageHeader title={headerTitle} subtitle={headerSubtitle} />

      {/* Tab navigation */}
      <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 8, flexShrink: 0 }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              style={{
                padding: '6px 18px', borderRadius: 99, fontSize: '0.8rem', fontWeight: isActive ? 600 : 400,
                border: isActive ? 'none' : '1px solid var(--border-color)',
                background: isActive ? 'var(--primary-accent)' : 'var(--bg-card)',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'contracts'    && <ContractsTab openContract={openContract} initialSourceType={sourceType} />}
        {activeTab === 'clause-table' && <ObligationsTab contractFilter={contractFilter} familyFilter={clauseFamily} insurerFilter={insurerFilter} policyFilter={policyFilter} openClauseId={openClauseId} />}
      </div>
    </div>
  );
}

export default function DocsObligationsPage() {
  return (
    <Suspense fallback={<div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 60 }}>Loading…</div>}>
      <DocsObligationsPageInner />
    </Suspense>
  );
}
