import { createServerClient } from '@/lib/supabaseServer';
import { extractTextWithOCRFallback } from '@/lib/extractText';
import { extractClausesRuleBased, removePageNumbers } from '@/lib/ruleBasedExtractor';
import { sanitizeDbError } from '@/lib/security/safeError';
import { classifyDocument, NON_BILATERAL_DOCUMENT_TYPES } from '@/lib/documents/classifyDocument';
import { classifyInsurancePolicy } from '@/lib/documents/classifyInsurancePolicy';
import { resolveCompanyEntity } from '@/lib/documents/resolveCompanyEntity';
import { classifyRegulatorySource } from '@/lib/documents/classifyRegulatorySource';
import { resolveRegulatorySource } from '@/lib/documents/resolveRegulatorySource';
import { extractOperationalFacts, writeOperationalFacts } from '@/lib/documents/extractOperationalFacts';

// A policy/certificate has no negotiated clauses and no bilateral
// counterparty the way a contract does — used below to route document-type
// families to the right linked record (contracts vs insurance_policies) and,
// further down, to skip clause extraction for these types.
const INSURANCE_FAMILY_TYPES = new Set(['insurance_policy', 'certificate_of_insurance']);

// ─── Shared extraction core ────────────────────────────────────────────────
// Extracted out of the single-document upload route (POST /api/documents/extract)
// so bulk uploads (app/api/documents/bulk-upload/process) run the exact same
// text extraction → clause extraction → classification → compliance-check
// pipeline, not a parallel copy. The single-upload route calls this with a
// freshly-read File buffer and no documentId/uploadId (both get generated
// here); the bulk worker calls it with a buffer downloaded back from Storage
// and the documentId/uploadId a queued document_uploads row already reserved.

export interface ProcessDocumentUploadInput {
  buffer: ArrayBuffer;
  fileName: string;
  fileType: string;
  /**
   * Omit (or pass an empty array) to auto-classify — used by bulk upload,
   * where the user isn't asked to pick a type per file. The single-upload
   * route always passes this explicitly (manual selection), so classification
   * never runs for it and its behavior is unchanged.
   */
  documentTypes?: string[];
  documentTitle?: string | null;
  entityId?: string | null;
  assetId?: string | null;
  companyName?: string | null;
  counterparty?: string | null;
  governingState?: string | null;
  parentDocId?: string | null;
  docRelation?: string | null;
  deepExtractFlag?: boolean;
  /**
   * When true, also creates a linked record in whichever table the
   * Contracts & Documents page actually reads for this document's type
   * family — `contracts` for a bilateral contract, `insurance_policies`
   * for insurance_policy/certificate_of_insurance (INSURANCE_FAMILY_TYPES
   * above) — so the upload shows up there instead of only in `documents`.
   * The single-upload route never sets this (matching its existing
   * behavior: a plain document upload there was never expected to also
   * create a linked record — that's the separate "+ Add Contract"/manual
   * insurance-save flow, where a human reviews the extraction first).
   * Bulk upload sets it unconditionally and relies on this type-family
   * branch, since nothing reviews its output before it's created.
   */
  createContractRecord?: boolean;
  /** Pre-assigned by the bulk enqueue route (which already staged the file in Storage under this id). Generated here when omitted (single-upload path). */
  documentId?: string;
  /** Pre-assigned by the bulk enqueue route (a 'queued' document_uploads row already exists). Generated here when omitted (single-upload path). */
  uploadId?: string;
}

// Resolves a guessed counterparty name to an EXISTING clients/service_providers
// row (case-insensitive exact match) — never creates one. An AI name guess is
// not a reliable enough signal to auto-create a business record on: besides
// the risk of a hallucinated/misspelled name creating a garbage entry, a
// deleted client/vendor's absence looks identical to "never existed" — an
// earlier version of this function auto-created on no-match, which silently
// resurrected an intentionally-deleted service provider the next time a
// document mentioning it was processed. If no match is found, the caller
// still records the free-text name (linked_client_name/linked_vendor_name)
// so nothing is lost — just without an ID, same as leaving that field blank
// on the manual "+ Add Contract" form. Linking it to a real record (creating
// one if needed) is a deliberate human action via that Edit flow, not
// something a document upload should do on its own.
//
// Checks BOTH clients and service_providers, regardless of what the AI
// guessed contract_facing to be — an existing business record is a far more
// reliable signal than the AI's read of the contract's defined-term
// language, and must win when the two disagree. Without this, a document
// mentioning an already-known client by name could get labeled "vendor" and
// linked to a freshly-implied vendor identity instead of that client's real
// record (e.g. CLI-007 misread as a new same-named vendor).
async function resolveExistingCounterparty(
  supabase: ReturnType<typeof createServerClient>,
  name: string,
): Promise<{ id: string; facing: 'client' | 'vendor' } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  const [{ data: clients }, { data: vendors }] = await Promise.all([
    supabase.from('clients').select('client_id, client_name'),
    supabase.from('service_providers').select('service_provider_id, legal_name'),
  ]);

  // Exact match first, then substring containment either direction — an
  // exact-only match misses real-world cases like the AI guessing "Aspen
  // Creek" for a client actually on file as "Aspen Creek School District"
  // (or the reverse). Same fuzzy-name pattern this app already uses for
  // party matching in extract-clauses-llama's matchesKnown().
  const clientExact = (clients || []).find((r: any) => (r.client_name || '').trim().toLowerCase() === lower);
  if (clientExact) return { id: clientExact.client_id, facing: 'client' };
  const vendorExact = (vendors || []).find((r: any) => (r.legal_name || '').trim().toLowerCase() === lower);
  if (vendorExact) return { id: vendorExact.service_provider_id, facing: 'vendor' };

  const clientFuzzy = (clients || []).find((r: any) => {
    const n = (r.client_name || '').trim().toLowerCase();
    return n && (n.includes(lower) || lower.includes(n));
  });
  if (clientFuzzy) return { id: clientFuzzy.client_id, facing: 'client' };
  const vendorFuzzy = (vendors || []).find((r: any) => {
    const n = (r.legal_name || '').trim().toLowerCase();
    return n && (n.includes(lower) || lower.includes(n));
  });
  if (vendorFuzzy) return { id: vendorFuzzy.service_provider_id, facing: 'vendor' };

  return null;
}

export interface ProcessDocumentUploadResult {
  documentId: string;
  uploadId: string;
  extractedCount: number;
  storageUploadError: string | null;
  ocrUsed: boolean;
}

export async function processDocumentUpload(input: ProcessDocumentUploadInput): Promise<ProcessDocumentUploadResult> {
  const {
    buffer, fileName, fileType,
    documentTitle, entityId, assetId, companyName, counterparty,
    governingState, parentDocId, docRelation, deepExtractFlag, createContractRecord,
  } = input;

  const supabase = createServerClient();

  // Independent copy for the Storage upload later — text extraction (below)
  // can end up detaching the original ArrayBuffer (unpdf/mammoth may hand it
  // to a worker/WASM boundary via a zero-copy transfer), which would
  // otherwise make the later supabase.storage.upload() call fail with
  // "Cannot perform ArrayBuffer.prototype.slice on a detached ArrayBuffer".
  const storageBuffer = buffer.slice(0);

  // 1. Extract text (with automatic OCR fallback for image-based PDFs) — done
  // before type resolution because auto-classification (below) needs the text.
  let rawText: string;
  let ocrUsed = false;
  try {
    const llamaKey = process.env.LLAMA_CLOUD_API_KEY;
    const result = await extractTextWithOCRFallback(buffer, fileName, fileType, llamaKey);
    rawText = result.text;
    ocrUsed = result.ocrUsed;
    if (result.ocrError) {
      console.error('[processDocumentUpload] OCR error (continuing with empty text):', result.ocrError);
    }
  } catch (e: any) {
    throw new Error(`Text extraction failed: ${e.message}`);
  }

  if (!rawText || rawText.trim().length < 50) {
    const hint = process.env.LLAMA_CLOUD_API_KEY
      ? 'OCR was attempted but returned no readable text. Check server logs for the LlamaParse error.'
      : 'The document may be an image-based PDF. Configure LLAMA_CLOUD_API_KEY to enable OCR.';
    throw new Error(`Could not extract meaningful text. ${hint}`);
  }

  rawText = removePageNumbers(rawText);

  // 2. Resolve the document type — either the caller picked one (single
  // upload, always) or it needs auto-classification (bulk upload, when the
  // user didn't override it). See lib/documents/classifyDocument.ts.
  let documentTypes = (input.documentTypes || []).filter(Boolean);
  let classification: Awaited<ReturnType<typeof classifyDocument>> | null = null;
  let effectiveCounterparty = counterparty;
  let effectiveGoverningState = governingState;
  if (documentTypes.length === 0) {
    classification = await classifyDocument({ supabase, text: rawText, fileName, companyName });
    documentTypes = [classification.documentType];
    if (!effectiveCounterparty && classification.counterpartyNameGuess) {
      effectiveCounterparty = classification.counterpartyNameGuess;
    }
    if (!effectiveGoverningState && classification.governingLawGuess) {
      effectiveGoverningState = classification.governingLawGuess;
    }
  }
  const primaryType = documentTypes[0];

  // 3. Fetch extraction profiles for all selected document types
  const { data: profiles } = await supabase
    .from('extraction_profiles')
    .select('*')
    .in('document_type', documentTypes);

  const profileMap = new Map((profiles || []).map((p: any) => [p.document_type, p]));
  const mergedPriorityClauses: string[] = [];
  let mergedSystemPrompt = '';
  let mergedDisplayLabel = documentTypes.join(' + ');

  for (const dt of documentTypes) {
    const p = profileMap.get(dt);
    if (p) {
      if (!mergedSystemPrompt) mergedSystemPrompt = p.system_prompt;
      if (p.priority_clauses) mergedPriorityClauses.push(...(p.priority_clauses as string[]));
      if (p.display_label) mergedDisplayLabel = p.display_label;
    }
  }

  const systemPrompt = mergedSystemPrompt ||
    'You are a legal extraction specialist. Extract every clause that creates an obligation, deadline, notice requirement, payment duty, indemnity, or trigger event.';
  const priorityClauses = mergedPriorityClauses.length > 0
    ? [...new Set(mergedPriorityClauses)]
    : ['obligation', 'trigger', 'deadline', 'notice', 'indemnity', 'payment', 'default', 'renewal'];
  const displayLabel = mergedDisplayLabel;

  if (!(profiles || []).some((p: any) => p.document_type === primaryType)) {
    void supabase.from('extraction_profiles').upsert({
      document_type: primaryType,
      system_prompt: systemPrompt,
      priority_clauses: priorityClauses,
      display_label: displayLabel,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'document_type' });
  }

  // 4. Create document record (with file_text)
  const docId = input.documentId || 'doc_' + Math.random().toString(36).substring(2, 10);
  const docInsert: Record<string, any> = {
    document_id: docId,
    title: documentTitle || fileName,
    document_type: primaryType,
    entity_id: entityId || null,
    asset_id: assetId || null,
    status: 'active',
    file_text: rawText.substring(0, 100000),
  };
  if (companyName) docInsert.entity_name = companyName;
  if (effectiveCounterparty) docInsert.counterparty_name = effectiveCounterparty;
  if (governingState) docInsert.governing_state = governingState;
  if (parentDocId) docInsert.parent_doc_id = parentDocId;
  if (docRelation) docInsert.doc_relation = docRelation;

  if (classification) {
    docInsert.document_type_confidence = classification.confidence;
    docInsert.document_type_classification_method = classification.method;
    docInsert.system_document_type = classification.documentType;
    docInsert.system_document_type_confidence = classification.confidence;
    docInsert.system_document_type_method = classification.method;
    if (classification.paperSourceGuess) {
      docInsert.paper_source_guess = classification.paperSourceGuess;
      docInsert.paper_source_confidence = classification.paperSourceConfidence;
    }
    if (classification.matchedTemplateId) {
      docInsert.matched_template_id = classification.matchedTemplateId;
      docInsert.matched_template_name = classification.matchedTemplateName;
      docInsert.matched_template_confidence = classification.matchedTemplateConfidence;
    }
  } else {
    // Caller (always single-upload) picked the type explicitly up front.
    docInsert.document_type_confidence = 1;
    docInsert.document_type_classification_method = 'manual';
  }

  // Upload original file to Supabase Storage so the preview panel can render the real PDF.
  // For bulk jobs the file already lives at this same key (the enqueue route staged it
  // there) — this re-upload (upsert:true) is a harmless no-op overwrite with identical
  // bytes, kept so this function behaves identically regardless of caller.
  let storageUploadError: string | null = null;
  try {
    const ext = (fileName.split('.').pop() || 'pdf').toLowerCase();
    const storagePath = `${docId}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, storageBuffer, {
        contentType: fileType || 'application/pdf',
        upsert: true,
      });
    if (uploadErr) {
      storageUploadError = uploadErr.message;
      console.error('[storage] upload error:', uploadErr.message);
    } else {
      console.log('[storage] uploaded:', storagePath);
    }
  } catch (e: any) {
    storageUploadError = e?.message ?? 'unknown';
    console.error('[storage] upload exception:', e?.message);
  }

  // Insert document — strip optional columns one-by-one if they don't exist yet
  // (the classification_* columns are only present once
  // scripts/add-document-type-classification.sql has been applied)
  const OPTIONAL_DOC_COLS = [
    'file_text', 'file_url', 'governing_state', 'parent_doc_id', 'doc_relation', 'counterparty_name', 'entity_name',
    'document_type_confidence', 'document_type_classification_method',
    'system_document_type', 'system_document_type_confidence', 'system_document_type_method',
    'paper_source_guess', 'paper_source_confidence',
    'matched_template_id', 'matched_template_name', 'matched_template_confidence',
  ];
  let docInsertErr: any = null;
  {
    const { error } = await supabase.from('documents').insert(docInsert);
    docInsertErr = error ?? null;
  }
  while (docInsertErr) {
    const col = OPTIONAL_DOC_COLS.find(c => docInsertErr!.message?.includes(c) && docInsert[c] !== undefined);
    if (!col) throw new Error(sanitizeDbError(docInsertErr));
    delete docInsert[col];
    const { error: retryErr } = await supabase.from('documents').insert(docInsert);
    docInsertErr = retryErr ?? null;
  }

  // 3b. Optionally create a linked record — see createContractRecord doc
  // comment above. Branches by document type family: a bilateral contract
  // gets a `contracts` row; an insurance_policy/certificate_of_insurance
  // gets an `insurance_policies` row instead (it has no governing_law,
  // contract_facing, or BGC terms — forcing it through the contracts shape
  // is exactly the bug this branch exists to avoid). Mirrors the
  // corresponding route's own ID generation (POST /api/contracts,
  // POST /api/insurance-policies) rather than calling either over HTTP: an
  // internal server-to-server fetch would hit the same session-cookie gate
  // in proxy.ts that /api/documents/bulk-upload/process needed an explicit
  // exemption for, and duplicating that exemption for a second route isn't
  // worth it for one small insert.
  // contractId is captured in the outer scope (not just inside the try
  // block) because step 5 below — after clauses are extracted — needs it to
  // link governing_law/effective_date/expiration_date back to whichever
  // clause they were actually found in. Insurance-family docs have no
  // clauses to extract (step 5 already excludes them), so no equivalent is
  // needed there.
  // Regulatory-source identity/dedup — unconditional on createContractRecord
  // (unlike the contracts/insurance_policies branches below, this isn't an
  // opt-in "should this show up on the Contracts & Documents table" choice;
  // every regulation upload should resolve to a regulatory_sources row to be
  // usable by the applicability/canonical-resolution engine later). Captured
  // in the outer scope so step 5 below can stamp it onto every provision
  // clause via classify-clauses' regulatorySourceId param.
  let regulatorySourceId: string | null = null;
  if (primaryType === 'regulation') {
    try {
      const extraction = await classifyRegulatorySource(rawText);
      const resolution = await resolveRegulatorySource(supabase, extraction, docId);
      regulatorySourceId = resolution.regulatorySourceId;
      console.info(`[processDocumentUpload] regulatory source ${resolution.status}: ${resolution.reason}`);
    } catch (err: any) {
      console.error('[processDocumentUpload] regulatory source resolution error:', err?.message);
    }
  }

  let contractId: string | null = null;
  if (createContractRecord && INSURANCE_FAMILY_TYPES.has(primaryType)) {
    try {
      const extraction = await classifyInsurancePolicy(
        supabase,
        rawText,
        primaryType as 'insurance_policy' | 'certificate_of_insurance',
      );
      const { data: existingPolicies } = await supabase
        .from('insurance_policies')
        .select('policy_id')
        .order('created_at', { ascending: false })
        .limit(25);
      let maxNum = 0;
      for (const row of existingPolicies || []) {
        const match = (row.policy_id as string)?.match(/^INS-(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
      const policyId = `INS-${String(maxNum + 1).padStart(3, '0')}`;
      const { error: policyInsertErr } = await supabase.from('insurance_policies').insert({
        policy_id: policyId,
        document_id: docId,
        source_document_type: primaryType,
        policy_number: extraction.policy_number,
        insurance_company: extraction.insurance_company,
        named_insured: extraction.named_insured,
        linked_client_ids: extraction.linked_client_ids,
        coverage_type: extraction.coverage_type,
        coverage_amount: extraction.coverage_amount,
        effective_date: extraction.effective_date,
        expiration_date: extraction.expiration_date,
        states: extraction.states,
      });
      if (policyInsertErr) console.error('[processDocumentUpload] insurance_policies insert error:', policyInsertErr.message);
    } catch (err: any) {
      console.error('[processDocumentUpload] insurance_policies insert exception:', err?.message);
    }
  } else if (createContractRecord && NON_BILATERAL_DOCUMENT_TYPES.has(primaryType)) {
    // A regulation or entity-fact document has no counterparty to link a
    // `contracts` row to — it stays a plain `documents` row until the
    // regulatory ingestion pipeline / entity-fact-resolution work (still
    // unbuilt — see docs/ontology-implementation-plan.md Phase 2b) gives it
    // a real destination (regulatory_sources / entity_facts).
  } else if (createContractRecord) {
    try {
      // Contracts are Documents now — the contract "record" is the documents
      // row itself (contracts merged into documents,
      // scripts/2026-merge-contracts-into-documents.sql). No separate CNT-###.
      contractId = docId;
      const paperSource = classification?.paperSourceGuess === 'counter_party' ? 'counter_party' : 'internal';
      const counterpartyNameForContract = effectiveCounterparty || '';
      // An existing clients/service_providers record for this name is
      // authoritative over the AI's contract_facing read of the contract
      // text — if the name matches a known CLIENT, this contract links to
      // that client even if the AI guessed "vendor" from the defined-term
      // language. Only falls back to the AI's guess when no existing record
      // matches at all (a genuinely new, unlinked counterparty).
      const existingMatch = await resolveExistingCounterparty(supabase, counterpartyNameForContract);
      const contractFacing = existingMatch?.facing || classification?.contractFacingGuess || 'client';
      const counterpartyId = existingMatch?.id || null;
      // Deterministic — never guessed. Only a 'resolved' status (an exact
      // EIN match, or the registered legal name/alias found as this
      // contract's own defined party) populates company_entity_id;
      // 'unresolved'/'ambiguous' leave it null rather than defaulting to
      // whichever entity happens to be registered, per docs/ontology-
      // implementation-plan.md Step 1 — silently guessing here would corrupt
      // which contracts count as evidence for an entity's regulatory
      // applicability downstream, not just display wrong.
      const entityResolution = await resolveCompanyEntity(supabase, rawText);
      const companyEntityId = entityResolution.status === 'resolved' ? entityResolution.match!.entityId : null;
      const contractFields: Record<string, unknown> = {
        company_entity_id: companyEntityId,
        governing_law: effectiveGoverningState || '',
        linked_client_id: contractFacing === 'vendor' ? '' : (counterpartyId || ''),
        linked_client_name: contractFacing === 'vendor' ? '' : counterpartyNameForContract,
        paper_source: paperSource,
        effective_date: classification?.effectiveDateGuess || null,
        expiration_date: classification?.expirationDateGuess || null,
        extracted_obligations: '',
        privacy_requirements: '',
        client_specific_bgc_requirements: '',
        bgc_requirement_types: classification?.bgcTypesGuess || [],
        contract_facing: contractFacing,
        contract_type: primaryType,
        linked_vendor_id: contractFacing === 'vendor' ? (counterpartyId || '') : '',
        linked_vendor_name: contractFacing === 'vendor' ? counterpartyNameForContract : '',
        counterparty_type: existingMatch ? (existingMatch.facing === 'vendor' ? 'Service Provider' : 'Client') : undefined,
      };
      // Write onto the documents row; fall back to the legacy contracts table
      // pre-migration (mint a CNT-### only in that fallback path).
      let contractInsertErr: { message: string } | null = null;
      const { error: docUpdErr } = await supabase.from('documents').update(contractFields).eq('document_id', docId);
      if ((docUpdErr as any)?.code === '42703') {
        const { data: existingContracts } = await supabase.from('contracts').select('contract_id').order('created_at', { ascending: false }).limit(25);
        let maxNum = 0;
        for (const row of existingContracts || []) {
          const m = (row.contract_id as string)?.match(/^CNT-(\d+)$/);
          if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
        }
        contractId = `CNT-${String(maxNum + 1).padStart(3, '0')}`;
        const legacy = await supabase.from('contracts').insert({ contract_id: contractId, document_id: docId, ...contractFields });
        contractInsertErr = legacy.error;
      } else {
        contractInsertErr = docUpdErr;
      }
      if (contractInsertErr) console.error('[processDocumentUpload] contract-metadata write error:', contractInsertErr.message);
      // Document-derived canonical facts (chat 2026-08-24): a contract/SOW/
      // order form is evidence for canonical applicability facts about the
      // CLIENT it governs (client_is_lea, activity_type, jurisdiction) — a
      // deliberately separate operation from regulatory applicability itself:
      //   agreement → extracted facts → canonical facts → regulatory applicability
      // Only fires when the counterparty resolved to a REAL existing clients
      // row (counterpartyId, from resolveExistingCounterparty above) — never
      // for a vendor-facing contract (no client to attach facts to) and never
      // for an unresolved free-text name, matching this file's existing
      // never-fabricate-a-business-record discipline.
      if (!contractInsertErr && contractFacing !== 'vendor' && counterpartyId) {
        try {
          const opFacts = await extractOperationalFacts(rawText);
          const { written } = await writeOperationalFacts(supabase, docId, counterpartyId, contractId, opFacts);
          if (written.length) console.info(`[processDocumentUpload] wrote operational facts [${written.join(', ')}] (client=${counterpartyId}, contract=${contractId}) from ${docId}`);
        } catch (err: any) {
          console.error('[processDocumentUpload] operational fact extraction error:', err?.message);
        }
      }
    } catch (err: any) {
      console.error('[processDocumentUpload] contracts insert exception:', err?.message);
    }
  }

  // 4. Create or update the upload record. Bulk jobs already have a 'queued'
  // document_uploads row (created by the enqueue route) — update it in place
  // rather than inserting a second row.
  const uploadId = input.uploadId || 'upl_' + Math.random().toString(36).substring(2, 10);
  if (input.uploadId) {
    await supabase.from('document_uploads').update({
      document_id: docId,
      file_name: fileName,
      file_type: fileName.split('.').pop() || 'unknown',
      document_type: primaryType,
      extraction_status: 'extracting',
      file_text: rawText.substring(0, 50000),
    }).eq('upload_id', uploadId);
  } else {
    await supabase.from('document_uploads').insert({
      upload_id: uploadId,
      document_id: docId,
      file_name: fileName,
      file_type: fileName.split('.').pop() || 'unknown',
      document_type: primaryType,
      extraction_status: 'extracting',
      file_text: rawText.substring(0, 50000),
    });
  }

  // 5. Auto-extract clauses. Excludes the insurance-family types (an
  // insurance policy / COI has no negotiated clauses to extract the way a
  // contract does — same exclusion the rest of the app applies, e.g.
  // isInsuranceDoc/isCoiDoc in app/(app)/documents/page.tsx) and
  // entity_fact_document (a financial statement/registration/certificate
  // has no negotiated clauses either — same reasoning). 'regulation' stays
  // included: a statute's provisions are shaped enough like clauses for
  // extraction to still be useful, and the real regulatory-provision
  // extraction pipeline (docs/ontology-implementation-plan.md Phase 2b)
  // isn't built yet. Everything else — including 'unknown' — still goes
  // through extraction, since a bulk-uploaded document not confidently
  // typed is still a real contract whose clauses the user needs.
  //
  // Rule-extracts clause boundaries, then hands them to classify-clauses —
  // the SAME classification this app's manual Document Parser flow uses —
  // instead of a separate, simpler inline classification. That match matters
  // for more than clause_type: classify-clauses is also what detects
  // Recording Consent clauses and backfills contracts.recording_rule /
  // clients.video_consent_policy, background-check cadence, additional-
  // insured, and data-sharing-prohibition — all silently skipped before,
  // since none of that lived in the simpler inline version. deepExtractFlag
  // only controls whether classify-clauses ALSO segments atomic obligation
  // units; the clause-level classification and all of the above backfills
  // happen either way.
  let autoExtractedClauseCount = 0;
  if (!documentTypes.some(t => INSURANCE_FAMILY_TYPES.has(t) || t === 'entity_fact_document')) {
    try {
      const extractedClauses = extractClausesRuleBased(rawText);
      if (extractedClauses.length > 0) {
        // Link governing_law/effective_date/expiration_date (found by
        // regex against the raw document text in classifyDocument.ts,
        // before clauses existed) to whichever extracted clause's
        // [char_start, char_end) range contains that match — powers the
        // Contracts Repository's click-a-cell-to-see-the-source-clause
        // feature. Same clause_id scheme classify-clauses uses (cl_####_##).
        if (contractId) {
          const docNumMatch = docId.match(/^doc_(\d+)$/);
          const docNum = docNumMatch ? docNumMatch[1] : docId.replace(/\D/g, '').slice(-4).padStart(4, '0');
          const clauseIdForCharIndex = (index: number | null | undefined): string | null => {
            if (index == null) return null;
            const i = extractedClauses.findIndex(c => index >= (c.char_start ?? -1) && index < (c.char_end ?? -1));
            return i === -1 ? null : `cl_${docNum}_${String(i + 1).padStart(2, '0')}`;
          };
          const clauseLinkUpdate: Record<string, string | null> = {
            governing_law_clause_id: clauseIdForCharIndex(classification?.governingLawCharIndex),
            effective_date_clause_id: clauseIdForCharIndex(classification?.effectiveDateCharIndex),
            expiration_date_clause_id: clauseIdForCharIndex(classification?.expirationDateCharIndex),
          };
          if (Object.values(clauseLinkUpdate).some(v => v !== null)) {
            // contractId === docId post-merge; only a CNT-### in the legacy
            // fallback path.
            const { error: linkErr } = /^CNT-/i.test(contractId)
              ? await supabase.from('contracts').update(clauseLinkUpdate).eq('contract_id', contractId)
              : await supabase.from('documents').update(clauseLinkUpdate).eq('document_id', docId);
            if (linkErr) console.error('[processDocumentUpload] contract clause-link update error:', linkErr.message);
          }
        }

        const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
        const internalSecret = process.env.BULK_PROCESS_SECRET;
        const classifyRes = await fetch(`${baseUrl}/api/documents/classify-clauses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
          },
          body: JSON.stringify({
            documentId: docId,
            clauses: extractedClauses,
            entityName: companyName,
            counterpartyName: effectiveCounterparty,
            documentType: primaryType,
            deepExtract: !!deepExtractFlag,
            regulatorySourceId: regulatorySourceId || undefined,
          }),
        });
        if (classifyRes.ok) {
          const classifyData = await classifyRes.json().catch(() => ({}));
          autoExtractedClauseCount = classifyData.savedCount ?? 0;
        } else {
          console.error('[processDocumentUpload] classify-clauses call failed:', classifyRes.status, await classifyRes.text().catch(() => ''));
        }
      }
    } catch (err) {
      console.error('Auto clause extraction error:', err);
    }
  }

  // Synchronous compliance check — await so results are in DB before this
  // returns. classify-clauses already runs one when it saves clauses, but
  // this covers documents with no extractable clauses (e.g. insurance-family
  // types) too, so it's kept unconditional — a second pass on the same
  // document is cheap and idempotent, not a correctness issue.
  try {
    const { runDocumentCompliance } = await import('@/lib/compliance/checker');
    await runDocumentCompliance({ documentId: docId, supabase });
  } catch (err) {
    console.error('[compliance] check error:', err);
  }

  // 6. Update upload status
  await supabase
    .from('document_uploads')
    .update({ extraction_status: 'review', extracted_count: autoExtractedClauseCount })
    .eq('upload_id', uploadId);

  return {
    documentId: docId,
    uploadId,
    extractedCount: autoExtractedClauseCount,
    storageUploadError,
    ocrUsed,
  };
}
