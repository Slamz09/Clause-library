'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { CONTRACT_TYPE_CATEGORIES, CONTRACT_TYPE_OPTIONS } from '@/lib/documentProfiles';
import { getCustomDocumentTypes, labelToDocTypeValue } from '@/lib/customDocumentTypes';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface Props {
  open: boolean;
  onClose: () => void;
  onBatchComplete?: () => void;
}

type ModalStep = 'select' | 'status' | 'pending';

interface PendingBatch {
  batch_id: string;
  status: 'processing' | 'completed' | 'completed_with_errors';
  total_count: number;
  created_at: string;
  counts: { queued: number; processing: number; completed: number; failed: number };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

interface BulkJobDoc {
  document_type: string | null;
  document_type_confidence: number | null;
  document_type_classification_method: string | null;
  document_type_override: string | null;
  paper_source_guess: string | null;
  paper_source_confidence: number | null;
  matched_template_name: string | null;
  matched_template_confidence: number | null;
  governing_state: string | null;
  entity_name: string | null;
  counterparty_name: string | null;
}

interface BulkJob {
  upload_id: string;
  document_id: string;
  file_name: string;
  extraction_status: 'queued' | 'processing' | 'completed' | 'failed';
  extracted_count: number | null;
  error_message: string | null;
  retry_count: number;
  document: BulkJobDoc | null;
}

interface BulkBatch {
  batch_id: string;
  status: 'processing' | 'completed' | 'completed_with_errors';
  total_count: number;
}

const STATUS_META: Record<BulkJob['extraction_status'], { label: string; color: string; bg: string }> = {
  queued:     { label: 'Queued',     color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  processing: { label: 'Processing', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  completed:  { label: 'Completed',  color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  failed:     { label: 'Failed',     color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

const TYPE_LABEL: Record<string, string> = Object.fromEntries(CONTRACT_TYPE_OPTIONS.map(o => [o.value, o.label]));
const METHOD_LABEL: Record<string, string> = {
  template_match: 'Template match',
  structural: 'Structural match',
  semantic: 'AI classification',
  manual: 'Manual',
  unknown: 'Unclassified',
};
const US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia'];

function confidenceMeta(confidence: number | null | undefined, docType: string | null | undefined) {
  if (docType === 'unknown' || confidence == null) return { label: 'Review needed', color: '#f87171' };
  const pct = Math.round(confidence * 100);
  if (pct >= 90) return { label: `${pct}%`, color: '#4ade80' };
  if (pct >= 75) return { label: `${pct}% · Review recommended`, color: '#fbbf24' };
  return { label: `${pct}% · Review needed`, color: '#f87171' };
}

export default function BulkDocumentUploadModal({ open, onClose, onBatchComplete }: Props) {
  const [step, setStep] = useState<ModalStep>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<{ file_name: string; error: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [forceType, setForceType] = useState(false);
  const [documentType, setDocumentType] = useState('');
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [governingState, setGoverningState] = useState('');
  const [deepExtract, setDeepExtract] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [batch, setBatch] = useState<BulkBatch | null>(null);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ document_type: string; paper_source: string; governing_state: string; entity_name: string; counterparty_name: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingBatches, setPendingBatches] = useState<PendingBatch[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPendingBatches = useCallback(() => {
    setLoadingPending(true);
    fetch('/api/documents/bulk-upload')
      .then(r => r.json())
      .then(d => setPendingBatches(Array.isArray(d.batches) ? d.batches : []))
      .catch(() => {})
      .finally(() => setLoadingPending(false));
  }, []);

  useEffect(() => {
    if (open) setCustomTypes(getCustomDocumentTypes());
  }, [open]);

  // Opening the modal shows what's currently uploading/pending first, if
  // anything is — instead of always jumping straight to a fresh upload form.
  useEffect(() => {
    if (!open) return;
    setLoadingPending(true);
    fetch('/api/documents/bulk-upload')
      .then(r => r.json())
      .then(d => {
        const list: PendingBatch[] = Array.isArray(d.batches) ? d.batches : [];
        setPendingBatches(list);
        if (list.some(b => b.status === 'processing')) setStep('pending');
      })
      .catch(() => {})
      .finally(() => setLoadingPending(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [open]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollStatus = useCallback((batchId: string) => {
    fetch(`/api/documents/bulk-upload?batchId=${encodeURIComponent(batchId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.batch) setBatch(d.batch);
        if (d.jobs) setJobs(d.jobs);
        if (d.batch && d.batch.status !== 'processing') {
          stopPolling();
          onBatchComplete?.();
        }
      })
      .catch(() => {});
  }, [onBatchComplete, stopPolling]);

  if (!open) return null;

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter(f => /\.(pdf|docx|doc|txt)$/i.test(f.name));
    setFiles(prev => [...prev, ...arr]);
  };

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  async function handleUpload() {
    if (files.length === 0) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      // Document type is intentionally omitted by default — each file is
      // classified independently after upload. Only send it when the user
      // explicitly opted into forcing one type for this batch.
      if (forceType && documentType) fd.append('document_types', JSON.stringify([documentType]));
      if (governingState) fd.append('governing_state', governingState);
      if (deepExtract) fd.append('deep_extract', 'true');

      const res = await fetch('/api/documents/bulk-upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Bulk upload failed');
        setSubmitting(false);
        return;
      }
      setRejected(data.rejected || []);
      setBatch({ batch_id: data.batchId, status: 'processing', total_count: data.jobs?.length || 0 });
      setJobs((data.jobs || []).map((j: any) => ({
        upload_id: j.upload_id, document_id: j.document_id, file_name: j.file_name,
        extraction_status: j.status, extracted_count: null, error_message: null, retry_count: 0, document: null,
      })));
      setStep('status');
      pollStatus(data.batchId);
      pollRef.current = setInterval(() => pollStatus(data.batchId), 3000);
    } catch (err: any) {
      setSubmitError(err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  function viewBatch(batchId: string) {
    stopPolling();
    setStep('status');
    setRejected([]);
    pollStatus(batchId);
    pollRef.current = setInterval(() => pollStatus(batchId), 3000);
  }

  async function handleRetry(uploadId: string) {
    setRetryingIds(prev => new Set(prev).add(uploadId));
    try {
      await fetch('/api/documents/bulk-upload/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      if (batch) {
        setBatch(prev => prev ? { ...prev, status: 'processing' } : prev);
        if (!pollRef.current) pollRef.current = setInterval(() => pollStatus(batch.batch_id), 3000);
        pollStatus(batch.batch_id);
      }
    } finally {
      setRetryingIds(prev => { const s = new Set(prev); s.delete(uploadId); return s; });
    }
  }

  function openEdit(job: BulkJob) {
    const d = job.document;
    setEditingDocId(job.document_id);
    setEditForm({
      document_type: d?.document_type || 'unknown',
      paper_source: d?.paper_source_guess || '',
      governing_state: d?.governing_state || '',
      entity_name: d?.entity_name || '',
      counterparty_name: d?.counterparty_name || '',
    });
  }

  async function saveEdit(job: BulkJob) {
    if (!editForm) return;
    setSavingEdit(true);
    try {
      const original = job.document?.document_type;
      const updates: Record<string, any> = {
        document_id: job.document_id,
        document_type: editForm.document_type,
        governing_state: editForm.governing_state || null,
        entity_name: editForm.entity_name || null,
        counterparty_name: editForm.counterparty_name || null,
      };
      if (editForm.paper_source) updates.paper_source_guess = editForm.paper_source;
      if (editForm.document_type !== original) {
        // Preserve the system's original call — never overwritten by a correction.
        updates.document_type_override = editForm.document_type;
        updates.document_type_override_at = new Date().toISOString();
      }
      await fetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      setJobs(prev => prev.map(j => j.document_id === job.document_id
        ? { ...j, document: { ...(j.document as BulkJobDoc), document_type: editForm.document_type, document_type_override: editForm.document_type !== original ? editForm.document_type : (j.document?.document_type_override ?? null), paper_source_guess: editForm.paper_source || j.document?.paper_source_guess || null, governing_state: editForm.governing_state || null, entity_name: editForm.entity_name || null, counterparty_name: editForm.counterparty_name || null } }
        : j));
      setEditingDocId(null);
      setEditForm(null);
    } finally {
      setSavingEdit(false);
    }
  }

  function handleClose() {
    stopPolling();
    setStep('select');
    setFiles([]);
    setRejected([]);
    setBatch(null);
    setJobs([]);
    setSubmitError('');
    setEditingDocId(null);
    setEditForm(null);
    onClose();
  }

  const allTypeOptions = [
    ...CONTRACT_TYPE_CATEGORIES.flatMap(cat => cat.options.map(([v, l]) => ({ value: v, label: l, group: cat.label }))),
    ...customTypes.map(label => ({ value: labelToDocTypeValue(label), label, group: 'Custom' })),
  ];

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 11px', borderRadius: 6, boxSizing: 'border-box',
    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
    color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none',
  };
  const lbl: React.CSSProperties = {
    fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
    display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em',
  };

  const completedCount = jobs.filter(j => j.extraction_status === 'completed').length;
  const failedCount = jobs.filter(j => j.extraction_status === 'failed').length;
  const activeCount = jobs.filter(j => j.extraction_status === 'queued' || j.extraction_status === 'processing').length;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 12, width: '100%', maxWidth: step === 'status' ? 980 : step === 'pending' ? 620 : 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {step === 'select' ? 'Bulk Upload Contracts' : step === 'pending' ? 'Pending Uploads' : `Batch Progress (${completedCount + failedCount}/${jobs.length})`}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {step === 'select'
                ? 'Select or drag multiple PDF/DOCX/TXT files — each is classified and processed independently'
                : step === 'pending'
                  ? 'Contracts currently uploading and processing'
                  : activeCount > 0
                    ? 'Processing in the background — you can close this window and come back later'
                    : 'Batch finished'}
            </div>
          </div>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 0 0 12px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {step === 'pending' && (
            <div style={{ padding: '18px 22px' }}>
              {loadingPending && pendingBatches.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '30px 0' }}>Loading…</div>
              ) : pendingBatches.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '30px 0' }}>Nothing pending</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pendingBatches.map(b => {
                    const { queued, processing, completed, failed } = b.counts;
                    const done = completed + failed;
                    const pct = b.total_count ? Math.round((done / b.total_count) * 100) : 0;
                    const dotColor = b.status === 'processing' ? '#38bdf8' : failed > 0 ? '#f87171' : '#4ade80';
                    return (
                      <div key={b.batch_id} onClick={() => viewBatch(b.batch_id)}
                        style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                            {done}/{b.total_count} document{b.total_count !== 1 ? 's' : ''}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{timeAgo(b.created_at)}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 6 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: dotColor, transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 10, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {(queued + processing) > 0 && <span>{queued + processing} in progress</span>}
                          {completed > 0 && <span style={{ color: '#4ade80' }}>{completed} done</span>}
                          {failed > 0 && <span style={{ color: '#f87171' }}>{failed} failed</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {step === 'select' && (
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {pendingBatches.some(b => b.status === 'processing') && (
                <button onClick={() => setStep('pending')}
                  style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 99, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8' }} />
                  View pending uploads
                </button>
              )}
              <div>
                <span style={lbl}>Files <span style={{ color: '#ef4444', fontWeight: 400, textTransform: 'none' }}>*</span></span>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                  style={{
                    border: `2px dashed ${dragOver ? 'rgba(124,58,237,0.7)' : files.length ? 'rgba(124,58,237,0.5)' : 'var(--border-color)'}`,
                    borderRadius: 8, padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
                    background: dragOver ? 'rgba(124,58,237,0.08)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: '1.6rem', marginBottom: 8, opacity: 0.3 }}>↑</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Drop multiple files or click to browse</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>PDF, DOCX, TXT — up to 100 files. Mix any kind of agreement — MSAs, SOWs, NDAs, amendments, order forms…</div>
                </div>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" multiple style={{ display: 'none' }}
                  onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              </div>

              {files.length > 0 && (
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, maxHeight: 180, overflow: 'auto' }}>
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: i < files.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                      <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{(f.size / 1024).toFixed(0)} KB</span>
                      <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', padding: 0, flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Document type is automatically detected after upload — template match, document structure, then AI classification. You'll be able to review and correct each file's type once processing finishes.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <span style={lbl}>Governing State</span>
                  <select value={governingState} onChange={e => setGoverningState(e.target.value)} style={inp}>
                    <option value="">— Optional —</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginBottom: 5 }}>
                    <input type="checkbox" checked={forceType} onChange={e => setForceType(e.target.checked)} />
                    <span style={lbl}>Force one document type (advanced)</span>
                  </label>
                  <SearchableSelect
                    value={documentType}
                    onChange={setDocumentType}
                    options={allTypeOptions}
                    placeholder="Only if you already know the type…"
                    style={{ ...inp, padding: '7px 11px', opacity: forceType ? 1 : 0.5, pointerEvents: forceType ? 'auto' : 'none' }}
                  />
                </div>
              </div>

              {submitError && <div style={{ fontSize: '0.78rem', color: '#f87171' }}>{submitError}</div>}
            </div>
          )}

          {step === 'status' && (
            <div style={{ padding: '18px 22px' }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {[
                  { label: 'Total', value: jobs.length, color: 'var(--text-primary)' },
                  { label: 'Completed', value: completedCount, color: '#4ade80' },
                  { label: 'Failed', value: failedCount, color: failedCount ? '#f87171' : 'var(--text-muted)' },
                  { label: 'In progress', value: activeCount, color: '#38bdf8' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: s.color }}>{s.value}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 6 }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {rejected.length > 0 && (
                <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#f87171', marginBottom: 6 }}>{rejected.length} file{rejected.length !== 1 ? 's' : ''} rejected before upload</div>
                  {rejected.map((r, i) => (
                    <div key={i} style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.file_name} — {r.error}</div>
                  ))}
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '0 10px 8px 4px' }}>File</th>
                      <th style={{ padding: '0 10px 8px' }}>Document Type</th>
                      <th style={{ padding: '0 10px 8px' }}>Confidence</th>
                      <th style={{ padding: '0 10px 8px' }}>Paper Source</th>
                      <th style={{ padding: '0 10px 8px' }}>Matched Template</th>
                      <th style={{ padding: '0 10px 8px' }}>Governing State</th>
                      <th style={{ padding: '0 10px 8px' }}>Counterparty</th>
                      <th style={{ padding: '0 10px 8px' }}>Status</th>
                      <th style={{ padding: '0 4px 8px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map(job => {
                      const meta = STATUS_META[job.extraction_status] || STATUS_META.processing;
                      const isRetrying = retryingIds.has(job.upload_id);
                      const d = job.document;
                      const isEditing = editingDocId === job.document_id;
                      const conf = confidenceMeta(d?.document_type_confidence, d?.document_type);
                      const rows = [
                        <tr key={job.upload_id} style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px 10px 8px 4px', color: 'var(--text-primary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.file_name}>{job.file_name}</td>
                          <td style={{ padding: '8px 10px' }}>
                            {d ? (
                              <div>
                                <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{TYPE_LABEL[d.document_type || ''] || d.document_type || '—'}</div>
                                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                                  {METHOD_LABEL[d.document_type_classification_method || ''] || '—'}
                                  {d.document_type_override && ' · corrected'}
                                </div>
                              </div>
                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ padding: '8px 10px', color: conf.color, whiteSpace: 'nowrap' }}>{d ? conf.label : '—'}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                            {d?.paper_source_guess === 'internal' ? 'Company Paper' : d?.paper_source_guess === 'counter_party' ? 'Counterparty Paper' : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{d?.matched_template_name || '—'}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{d?.governing_state || '—'}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d?.counterparty_name || '—'}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: '0.66rem', fontWeight: 600, background: meta.bg, color: meta.color, whiteSpace: 'nowrap', width: 'fit-content' }}>
                                {job.extraction_status === 'processing' ? '● Processing' : meta.label}
                              </span>
                              {job.extraction_status === 'completed' && job.extracted_count != null && (
                                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{job.extracted_count} clause{job.extracted_count !== 1 ? 's' : ''}</span>
                              )}
                              {job.extraction_status === 'failed' && job.error_message && (
                                <span title={job.error_message} style={{ fontSize: '0.64rem', color: '#f87171', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.error_message}</span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
                            {job.extraction_status === 'failed' && (
                              <button onClick={() => handleRetry(job.upload_id)} disabled={isRetrying}
                                style={{ padding: '3px 9px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 600, border: '1px solid rgba(124,58,237,0.35)', background: 'rgba(124,58,237,0.1)', color: '#a78bfa', cursor: isRetrying ? 'not-allowed' : 'pointer', opacity: isRetrying ? 0.6 : 1, marginRight: 4 }}>
                                {isRetrying ? '…' : 'Retry'}
                              </button>
                            )}
                            {job.extraction_status === 'completed' && (
                              <button onClick={() => isEditing ? setEditingDocId(null) : openEdit(job)}
                                style={{ padding: '3px 9px', borderRadius: 5, fontSize: '0.68rem', fontWeight: 600, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                {isEditing ? 'Cancel' : 'Edit'}
                              </button>
                            )}
                          </td>
                        </tr>,
                      ];
                      if (isEditing && editForm) {
                        rows.push(
                          <tr key={`${job.upload_id}-edit`} style={{ background: 'rgba(124,58,237,0.05)' }}>
                            <td colSpan={9} style={{ padding: '10px 12px 14px 4px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignItems: 'end' }}>
                                <div>
                                  <span style={lbl}>Document Type</span>
                                  <SearchableSelect value={editForm.document_type} onChange={v => setEditForm(f => f ? { ...f, document_type: v } : f)} options={allTypeOptions} style={{ ...inp, padding: '6px 9px' }} />
                                </div>
                                <div>
                                  <span style={lbl}>Paper Source</span>
                                  <select value={editForm.paper_source} onChange={e => setEditForm(f => f ? { ...f, paper_source: e.target.value } : f)} style={inp}>
                                    <option value="">— Unknown —</option>
                                    <option value="internal">Company Paper</option>
                                    <option value="counter_party">Counterparty Paper</option>
                                  </select>
                                </div>
                                <div>
                                  <span style={lbl}>Governing State</span>
                                  <select value={editForm.governing_state} onChange={e => setEditForm(f => f ? { ...f, governing_state: e.target.value } : f)} style={inp}>
                                    <option value="">— None —</option>
                                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <span style={lbl}>Counterparty</span>
                                  <input value={editForm.counterparty_name} onChange={e => setEditForm(f => f ? { ...f, counterparty_name: e.target.value } : f)} style={inp} />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                                <button onClick={() => { setEditingDocId(null); setEditForm(null); }} style={{ padding: '5px 12px', borderRadius: 5, fontSize: '0.72rem', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={() => saveEdit(job)} disabled={savingEdit} style={{ padding: '5px 14px', borderRadius: 5, fontSize: '0.72rem', fontWeight: 600, border: 'none', background: 'var(--primary-accent)', color: '#fff', cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? 0.6 : 1 }}>
                                  {savingEdit ? 'Saving…' : 'Save Correction'}
                                </button>
                              </div>
                            </td>
                          </tr>,
                        );
                      }
                      return rows;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          {step === 'select' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginRight: 'auto', userSelect: 'none' }}>
                <div onClick={() => setDeepExtract(v => !v)} style={{ width: 36, height: 20, borderRadius: 99, background: deepExtract ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.1)', border: deepExtract ? '1px solid rgba(124,58,237,0.9)' : '1px solid rgba(255,255,255,0.2)', position: 'relative', transition: 'all 0.2s', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2, left: deepExtract ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: deepExtract ? '#c4b5fd' : 'var(--text-muted)', fontWeight: deepExtract ? 600 : 400 }}>Deep extract atomic obligations</span>
              </label>
              <button onClick={handleClose} style={{ padding: '8px 18px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleUpload} disabled={files.length === 0 || submitting || (forceType && !documentType)}
                style={{ padding: '8px 20px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, background: (files.length === 0 || submitting) ? 'rgba(124,58,237,0.3)' : 'var(--primary-accent)', border: 'none', color: '#fff', cursor: (files.length === 0 || submitting) ? 'not-allowed' : 'pointer', opacity: (files.length === 0 || submitting) ? 0.6 : 1 }}>
                {submitting ? 'Uploading…' : `Upload ${files.length || ''} File${files.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
          {step === 'status' && (
            <button onClick={handleClose} style={{ padding: '8px 20px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, background: 'var(--primary-accent)', border: 'none', color: '#fff', cursor: 'pointer' }}>
              {activeCount > 0 ? 'Close (keeps processing)' : 'Done'}
            </button>
          )}
          {step === 'pending' && (
            <>
              <button onClick={() => loadPendingBatches()} disabled={loadingPending}
                style={{ padding: '8px 18px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: loadingPending ? 'not-allowed' : 'pointer', marginRight: 'auto' }}>
                {loadingPending ? 'Refreshing…' : 'Refresh'}
              </button>
              <button onClick={handleClose} style={{ padding: '8px 18px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer' }}>Close</button>
              <button onClick={() => setStep('select')} style={{ padding: '8px 20px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, background: 'var(--primary-accent)', border: 'none', color: '#fff', cursor: 'pointer' }}>
                Upload New Files
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
