'use client';

import { useState, useRef, useEffect } from 'react';
import { CONTRACT_TYPE_CATEGORIES } from '@/lib/documentProfiles';
import { getCustomDocumentTypes, saveCustomDocumentType, labelToDocTypeValue } from '@/lib/customDocumentTypes';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface Props {
  open: boolean;
  onClose: () => void;
  onExtractionComplete: (uploadId: string, extractedCount: number) => void;
  entities: Array<{ entity_id: string; name: string }>;
  assets?: Array<{ asset_id: string; name: string; entity_id?: string }>;
  docs?: Array<{ document_id: string; title: string }>;
}

type UploadStep = 'select' | 'uploading' | 'review' | 'done';

interface ExtractedObligation {
  extracted_id: string;
  clause_type: string;
  obligated_party: string;
  beneficiary_party: string;
  trigger_condition: string;
  deadline: string;
  consequence: string;
  clause_reference: string;
  supporting_quote: string;
  confidence: number;
  mapped_trigger_type: string | null;
  review_status: string;
}

// Contract group values for reference in extract route
const CONTRACT_GROUP_VALUES = new Set(['msa','nda','service_agreement','franchise_agreement','loan_agreement','master_lease','general_contract']);

export default function DocumentUploadModal({ open, onClose, onExtractionComplete, entities, assets = [], docs = [] }: Props) {
  const [step, setStep]               = useState<UploadStep>('select');
  const [file, setFile]               = useState<File | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [documentType, setDocumentType] = useState<string>('general_contract');
  const [customTypes, setCustomTypes]   = useState<string[]>([]);
  const [showAddType, setShowAddType]   = useState(false);
  const [newTypeName, setNewTypeName]   = useState('');
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [entitySearchQ, setEntitySearchQ] = useState('');
  const [showEntityDrop, setShowEntityDrop] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [assetSearchQ, setAssetSearchQ] = useState('');
  const [showAssetDrop, setShowAssetDrop] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [governingState, setGoverningState] = useState('');
  const [parentDocId, setParentDocId] = useState('');
  const [parentRelation, setParentRelation] = useState('Amendment');
  const [title, setTitle]             = useState('');
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [progress, setProgress]       = useState('');
  const [uploadId, setUploadId]       = useState('');
  const [extracted, setExtracted]     = useState<ExtractedObligation[]>([]);
  const [confirmed, setConfirmed]     = useState<Set<string>>(new Set());
  const [rejected, setRejected]       = useState<Set<string>>(new Set());
  const [submitting, setSubmitting]   = useState(false);
  const [deepExtract, setDeepExtract] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setCustomTypes(getCustomDocumentTypes());
  }, [open]);

  const saveNewType = () => {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;
    const updated = saveCustomDocumentType(trimmed);
    setCustomTypes(updated);
    setDocumentType(labelToDocTypeValue(trimmed));
    setShowAddType(false);
    setNewTypeName('');
  };

  if (!open) return null;

  // ── File selection ───────────────────────────────────────────────────────────

  const handleFile = async (f: File) => {
    setFile(f);
    setTitle(prev => prev || f.name.replace(/\.[^/.]+$/, ''));
    setPreviewText('');
    setLoadingPreview(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/documents/preview-text', { method: 'POST', body: fd });
      const data = await res.json();
      setPreviewText(data.text || '');
    } catch {
      setPreviewText('');
    } finally {
      setLoadingPreview(false);
    }
  };

  // ── AI Suggest ───────────────────────────────────────────────────────────────

  const handleAiSuggest = async () => {
    if (!previewText) return;
    setAiSuggesting(true);
    try {
      const res = await fetch('/api/documents/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: previewText, document_types: [documentType], entities }),
      });
      const data = await res.json();
      if (data.title) setTitle(data.title);
      if (data.entity_id && !selectedEntityIds.includes(data.entity_id)) setSelectedEntityIds(prev => [...prev, data.entity_id]);
      if (data.counterparty) setCounterparty(data.counterparty);
    } finally {
      setAiSuggesting(false);
    }
  };

  // ── Upload + Save ────────────────────────────────────────────────────────────

  async function handleUpload() {
    if (!file || !documentType) return;
    setStep('uploading');
    setProgress('Saving document…');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_type', documentType);
    fd.append('document_types', JSON.stringify([documentType]));
    fd.append('title', title || file.name);
    if (selectedEntityIds.length > 0) fd.append('entity_id', selectedEntityIds[0]);
    if (selectedEntityIds.length > 1) fd.append('entity_ids', JSON.stringify(selectedEntityIds));
    if (selectedAssetIds.length > 0) fd.append('asset_ids', JSON.stringify(selectedAssetIds));
    if (companyName) fd.append('company_name', companyName);
    if (counterparty) fd.append('counterparty', counterparty);
    if (governingState) fd.append('governing_state', governingState);
    if (parentDocId) { fd.append('parent_doc_id', parentDocId); fd.append('doc_relation', parentRelation); }
    if (deepExtract) fd.append('deep_extract', 'true');

    const res = await fetch('/api/documents/extract', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      setProgress('Error: ' + (data.error || 'Failed to save document'));
      setStep('select');
      return;
    }

    // The document row saved, but the original file may not have reached
    // Storage (bucket/RLS/size). Surface it instead of silently showing "saved"
    // and leaving the PDF preview to 404 later.
    if (data.storage_upload_error) {
      alert(`Document saved, but the original file was NOT stored: ${data.storage_upload_error}.\nThe PDF preview will be unavailable until the file is re-attached.`);
    }

    setUploadId(data.uploadId || '');
    setStep('done');
  }

  // ── Confirm obligations ──────────────────────────────────────────────────────

  async function handleConfirm() {
    setSubmitting(true);
    const res = await fetch('/api/documents/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, confirmedIds: [...confirmed], rejectedIds: [...rejected] }),
    });
    const data = await res.json();
    setStep('done');
    onExtractionComplete(uploadId, data.promoted || 0);
    setSubmitting(false);
  }

  const toggleItem = (id: string) => {
    if (confirmed.has(id)) {
      setConfirmed(prev => { const s = new Set(prev); s.delete(id); return s; });
      setRejected(prev => new Set(prev).add(id));
    } else if (rejected.has(id)) {
      setRejected(prev => { const s = new Set(prev); s.delete(id); return s; });
      setConfirmed(prev => new Set(prev).add(id));
    } else {
      setConfirmed(prev => new Set(prev).add(id));
    }
  };

  const confLabel = (c: number) =>
    c >= 0.85 ? { label: 'High', color: '#22c55e' }
    : c >= 0.6 ? { label: 'Med',  color: '#f59e0b' }
    :            { label: 'Low',  color: '#ef4444' };

  // ── Grouped type options ─────────────────────────────────────────────────────

  const allTypeOptions = [
    ...CONTRACT_TYPE_CATEGORIES.flatMap(cat =>
      cat.options.map(([v, l]) => ({ value: v, label: l, group: cat.label }))
    ),
    ...customTypes.map(label => ({ value: labelToDocTypeValue(label), label, group: 'Custom' })),
  ];

  // ── Styles ───────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 11px', borderRadius: 6, boxSizing: 'border-box',
    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
    color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none',
  };
  const lbl: React.CSSProperties = {
    fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
    display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em',
  };

  const isSelect = step === 'select';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        width: '100%',
        maxWidth: isSelect ? 1040 : 760,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {step === 'select'    && 'Upload Document'}
              {step === 'uploading' && 'Extracting Clauses…'}
              {step === 'review'    && `Review Extracted Clauses (${extracted.length})`}
              {step === 'done'      && 'Document Saved'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {step === 'select' && 'Select document type, fill details, then extract'}
              {step === 'review' && 'High-confidence items are pre-confirmed. Click to toggle.'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 0 0 12px' }}>×</button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

          {/* ── SELECT step: two-column ───────────────────────────────────── */}
          {step === 'select' && (
            <>
              {/* Left: Form */}
              <div style={{ width: 400, flexShrink: 0, overflow: 'auto', padding: '20px 22px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* File drop */}
                <div>
                  <span style={lbl}>File <span style={{ color: '#ef4444', fontWeight: 400, textTransform: 'none' }}>*</span></span>
                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                    style={{
                      border: `2px dashed ${file ? 'rgba(124,58,237,0.5)' : 'var(--border-color)'}`,
                      borderRadius: 8, padding: '20px 16px', textAlign: 'center',
                      cursor: 'pointer', background: file ? 'rgba(124,58,237,0.04)' : 'transparent',
                    }}
                  >
                    {file ? (
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-accent)' }}>{file.name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>
                          {(file.size / 1024).toFixed(1)} KB{loadingPreview ? ' — reading…' : ' — click to change'}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '1.4rem', marginBottom: 6, opacity: 0.3 }}>↑</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Drop a file or click to browse</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>PDF, DOCX, TXT</div>
                      </div>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </div>

                {/* Document type — searchable select */}
                <div>
                  <span style={lbl}>Document Type <span style={{ color: '#ef4444', fontWeight: 400, textTransform: 'none' }}>*</span></span>
                  <SearchableSelect
                    value={documentType}
                    onChange={v => { setDocumentType(v); setShowAddType(false); }}
                    options={allTypeOptions}
                    placeholder="Select document type…"
                    style={{ ...inp, padding: '7px 11px' }}
                    footerItems={[{ label: '＋ Add new contract type…', onClick: () => { setShowAddType(true); setNewTypeName(''); } }]}
                  />

                  {showAddType && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 7 }}>
                      <input
                        autoFocus
                        value={newTypeName}
                        onChange={e => setNewTypeName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveNewType();
                          if (e.key === 'Escape') { setShowAddType(false); setNewTypeName(''); }
                        }}
                        placeholder="e.g. Joint Venture Agreement"
                        style={{ ...inp, flex: 1, padding: '6px 10px', fontSize: '0.78rem' }}
                      />
                      <button
                        onClick={saveNewType}
                        disabled={!newTypeName.trim()}
                        style={{
                          padding: '6px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
                          background: newTypeName.trim() ? 'var(--primary-accent)' : 'rgba(124,58,237,0.3)',
                          border: 'none', color: '#fff',
                          cursor: newTypeName.trim() ? 'pointer' : 'not-allowed', flexShrink: 0,
                        }}
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setShowAddType(false); setNewTypeName(''); }}
                        style={{
                          padding: '6px 9px', borderRadius: 6, fontSize: '0.78rem',
                          background: 'transparent', border: '1px solid var(--border-color)',
                          color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* Title + AI Suggest */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={lbl}>Document Title</span>
                    {previewText && (
                      <button onClick={handleAiSuggest} disabled={aiSuggesting}
                        style={{ padding: '3px 9px', borderRadius: 5, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#c4b5fd', fontSize: '0.68rem', cursor: aiSuggesting ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: aiSuggesting ? 0.6 : 1 }}>
                        {aiSuggesting ? '✦ Analyzing…' : '✦ AI Suggest'}
                      </button>
                    )}
                  </div>
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. MSA — Acme Corp / BlackRock 2024"
                    style={inp} />
                </div>

                {/* Related Entities — multi */}
                <div>
                  <span style={lbl}>Related Entities</span>
                  {/* Chips */}
                  {selectedEntityIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                      {selectedEntityIds.map(id => {
                        const ent = entities.find(e => e.entity_id === id);
                        return (
                          <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.35)', fontSize: '0.72rem', color: '#c4b5fd' }}>
                            {ent?.name || id}
                            <button type="button" onClick={() => setSelectedEntityIds(prev => prev.filter(x => x !== id))} style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', padding: 0, fontSize: '0.8rem', lineHeight: 1 }}>×</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* Search input */}
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text" value={entitySearchQ}
                      onChange={e => { setEntitySearchQ(e.target.value); setShowEntityDrop(true); }}
                      onFocus={() => setShowEntityDrop(true)}
                      onBlur={() => setTimeout(() => setShowEntityDrop(false), 150)}
                      placeholder={selectedEntityIds.length === 0 ? 'Search entity…' : '+ Add another entity…'}
                      autoComplete="off"
                      style={{ ...inp, padding: '7px 11px' }}
                    />
                    {showEntityDrop && entitySearchQ && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 300, maxHeight: 180, overflow: 'auto' }}>
                        {entities.filter(e => !selectedEntityIds.includes(e.entity_id) && (e.name.toLowerCase().includes(entitySearchQ.toLowerCase()) || e.entity_id.toLowerCase().includes(entitySearchQ.toLowerCase()))).map(e => (
                          <div key={e.entity_id}
                            onMouseDown={() => { setSelectedEntityIds(prev => [...prev, e.entity_id]); setEntitySearchQ(''); setShowEntityDrop(false); }}
                            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.82rem', color: 'var(--text-primary)' }}
                            onMouseEnter={el => (el.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.05)'}
                            onMouseLeave={el => (el.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                            {e.name} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({e.entity_id})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Associated Properties — multi */}
                <div>
                  <span style={lbl}>Associated Properties</span>
                  {selectedAssetIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                      {selectedAssetIds.map(id => {
                        const asset = assets.find(a => a.asset_id === id);
                        return (
                          <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.3)', fontSize: '0.72rem', color: '#5eead4' }}>
                            {asset?.name || id}
                            <button type="button" onClick={() => setSelectedAssetIds(prev => prev.filter(x => x !== id))} style={{ background: 'none', border: 'none', color: '#5eead4', cursor: 'pointer', padding: 0, fontSize: '0.8rem', lineHeight: 1 }}>×</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text" value={assetSearchQ}
                      onChange={e => { setAssetSearchQ(e.target.value); setShowAssetDrop(true); }}
                      onFocus={() => setShowAssetDrop(true)}
                      onBlur={() => setTimeout(() => setShowAssetDrop(false), 150)}
                      placeholder={selectedAssetIds.length === 0 ? 'Search property / asset…' : '+ Add another property…'}
                      autoComplete="off"
                      style={{ ...inp, padding: '7px 11px' }}
                    />
                    {showAssetDrop && assetSearchQ && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 300, maxHeight: 180, overflow: 'auto' }}>
                        {assets.filter(a => !selectedAssetIds.includes(a.asset_id) && (a.name.toLowerCase().includes(assetSearchQ.toLowerCase()) || a.asset_id.toLowerCase().includes(assetSearchQ.toLowerCase()))).map(a => (
                          <div key={a.asset_id}
                            onMouseDown={() => { setSelectedAssetIds(prev => [...prev, a.asset_id]); setAssetSearchQ(''); setShowAssetDrop(false); }}
                            style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.82rem', color: 'var(--text-primary)' }}
                            onMouseEnter={el => (el.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.05)'}
                            onMouseLeave={el => (el.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                            {a.name} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({a.asset_id})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Company Name */}
                <div>
                  <span style={lbl}>Company Name</span>
                  <input value={companyName} onChange={e => setCompanyName(e.target.value)}
                    placeholder="Your company or entity name…"
                    style={inp} />
                </div>

                {/* Counter Party Name */}
                <div>
                  <span style={lbl}>Counter Party Name</span>
                  <input value={counterparty} onChange={e => setCounterparty(e.target.value)}
                    placeholder="Insurer, lender, landlord, other party…"
                    style={inp} />
                </div>

                {/* Governing State */}
                <div>
                  <span style={lbl}>Governing State</span>
                  <select value={governingState} onChange={e => setGoverningState(e.target.value)} style={inp}>
                    <option value="">— Select state (optional) —</option>
                    {['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Link to Parent Document */}
                <div>
                  <span style={lbl}>Link to Parent Document</span>
                  <select value={parentDocId} onChange={e => setParentDocId(e.target.value)} style={inp}>
                    <option value="">— None (optional) —</option>
                    {docs.map(d => <option key={d.document_id} value={d.document_id}>{d.title || d.document_id}</option>)}
                  </select>
                </div>
                {parentDocId && (
                  <div>
                    <span style={lbl}>Relationship Type</span>
                    <select value={parentRelation} onChange={e => setParentRelation(e.target.value)} style={inp}>
                      {['Amendment','Addendum','Exhibit','Renewal','Assignment','Termination'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Right: Text preview */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Document Preview</span>
                  {loadingPreview && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Reading text…</span>}
                  {previewText && !loadingPreview && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{previewText.length.toLocaleString()} chars</span>
                  )}
                </div>
                <div style={{
                  flex: 1, overflow: 'auto', padding: '14px 18px',
                  fontSize: '0.73rem', lineHeight: 1.75, color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace',
                }}>
                  {loadingPreview ? (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', paddingTop: 60, fontFamily: 'inherit', fontStyle: 'italic' }}>Extracting text…</div>
                  ) : previewText ? (
                    previewText
                  ) : (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', paddingTop: 60, fontFamily: 'inherit' }}>
                      <div style={{ fontSize: '1.8rem', marginBottom: 10, opacity: 0.15 }}>▤</div>
                      <div>Upload a document to preview its text</div>
                      <div style={{ fontSize: '0.68rem', marginTop: 6, opacity: 0.6 }}>AI Suggest uses this preview to auto-fill title, entity, and counterparty</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── UPLOADING step ────────────────────────────────────────────── */}
          {step === 'uploading' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 24px' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid var(--border-color)', borderTopColor: 'var(--primary-accent)', animation: 'spin 0.9s linear infinite' }} />
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 400 }}>{progress}</div>
            </div>
          )}

          {/* ── REVIEW step ───────────────────────────────────────────────── */}
          {step === 'review' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                {[
                  { label: 'Total extracted', value: extracted.length, color: 'var(--text-primary)' },
                  { label: 'Auto-confirmed',  value: confirmed.size,   color: '#22c55e' },
                  { label: 'Needs review',    value: extracted.filter(e => !confirmed.has(e.extracted_id) && !rejected.has(e.extracted_id)).length, color: '#f59e0b' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: s.color }}>{s.value}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 6 }}>{s.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {extracted.map(item => {
                  const isConfirmed = confirmed.has(item.extracted_id);
                  const isRejected  = rejected.has(item.extracted_id);
                  const cl          = confLabel(item.confidence);
                  return (
                    <div key={item.extracted_id} onClick={() => toggleItem(item.extracted_id)}
                      style={{
                        padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${isConfirmed ? 'rgba(34,197,94,0.3)' : isRejected ? 'rgba(239,68,68,0.2)' : 'var(--border-color)'}`,
                        background: isConfirmed ? 'rgba(34,197,94,0.04)' : isRejected ? 'rgba(239,68,68,0.04)' : 'var(--bg-card)',
                        opacity: isRejected ? 0.45 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', background: 'rgba(124,58,237,0.15)', color: '#c4b5fd' }}>
                            {item.clause_type?.replace(/_/g, ' ')}
                          </span>
                          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.65rem', fontWeight: 600, background: `${cl.color}18`, color: cl.color }}>
                            {cl.label} confidence
                          </span>
                        </div>
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, flexShrink: 0, color: isConfirmed ? '#22c55e' : isRejected ? '#ef4444' : 'var(--text-muted)' }}>
                          {isConfirmed ? '✓ Include' : isRejected ? '✗ Exclude' : '○ Pending'}
                        </span>
                      </div>
                      {item.trigger_condition && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginBottom: 4, fontWeight: 500 }}>{item.trigger_condition}</div>
                      )}
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {item.deadline && <span style={{ fontSize: '0.72rem', color: '#f59e0b' }}>⏱ {item.deadline}</span>}
                        {item.consequence && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>⚠ {item.consequence}</span>}
                        {item.clause_reference && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>§ {item.clause_reference}</span>}
                      </div>
                      {item.supporting_quote && (
                        <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.4 }}>
                          "{item.supporting_quote.substring(0, 180)}{item.supporting_quote.length > 180 ? '…' : ''}"
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── DONE step ─────────────────────────────────────────────────── */}
          {step === 'done' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 12, textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem' }}>✓</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Document saved</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', maxWidth: 400 }}>
                Open the Clause Explorer to review extracted clauses.
              </div>
              {(title || companyName || counterparty) && (
                <div style={{ marginTop: 8, padding: '12px 18px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 460 }}>
                  {title && <div><span style={{ color: 'var(--text-muted)' }}>Title: </span>{title}</div>}
                  {companyName && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text-muted)' }}>Company: </span>{companyName}</div>}
                  {counterparty && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text-muted)' }}>Counter Party: </span>{counterparty}</div>}
                  <div style={{ marginTop: 4, fontSize: '0.72rem', color: 'rgba(34,197,94,0.8)' }}>✓ Saved to Documents Library</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          {step === 'select' && (
            <>
              {/* Deep extract toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginRight: 'auto', userSelect: 'none' }}>
                <div
                  onClick={() => setDeepExtract(v => !v)}
                  style={{
                    width: 36, height: 20, borderRadius: 99, background: deepExtract ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.1)',
                    border: deepExtract ? '1px solid rgba(124,58,237,0.9)' : '1px solid rgba(255,255,255,0.2)',
                    position: 'relative', transition: 'all 0.2s', flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 2, left: deepExtract ? 18 : 2, width: 14, height: 14,
                    borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                  }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: deepExtract ? '#c4b5fd' : 'var(--text-muted)', fontWeight: deepExtract ? 600 : 400 }}>
                  Deep extract atomic obligations
                </span>
              </label>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
              <button onClick={handleUpload} disabled={!file || !documentType || loadingPreview} style={primaryBtn(!file || !documentType || loadingPreview)}>
                Save
              </button>
            </>
          )}
          {step === 'done' && <button onClick={onClose} style={primaryBtn(false)}>Done</button>}
        </div>
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500,
  background: 'transparent', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', cursor: 'pointer',
};
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 20px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500,
  background: disabled ? 'rgba(124,58,237,0.3)' : 'var(--primary-accent)',
  border: 'none', color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});
