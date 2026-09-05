import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/requireSession';

const LLAMAPARSE_BASE = 'https://api.cloud.llamaindex.ai/api/parsing';

function buildInstruction(entityName: string, documentType: string): string {
  return `This is a legal contract template (${documentType.replace(/_/g, ' ')}). \
You must analyze it strictly on behalf of "${entityName}".

STEP 1 — Identify "${entityName}"'s role: Read the Parties section and determine what business \
role "${entityName}" actually occupies in this agreement \
(e.g. service provider/vendor, customer/buyer, landlord, tenant, lender, borrower, franchisor, franchisee). \
Use that role as the lens for every preferred_position below.

STEP 2 — Extract every substantive clause or section. \
Skip boilerplate definitions, recitals, and signature blocks.

STEP 3 — For each clause write a preferred_position: 1-2 sentences describing what \
"${entityName}" should negotiate for, fully consistent with the business role identified in Step 1. \
The position must reflect the economic interests that role actually carries. \
For example: if "${entityName}" is the service provider/vendor in a SaaS agreement, \
they benefit from LONGER cure periods (more time to fix issues before the customer can terminate), \
broader limitation of liability, flexibility to modify the service, and predictable revenue — \
NOT from shorter cure periods or expanded customer rights to exit. \
Always reason from "${entityName}"'s real incentives, not from a generic or reversed perspective.

Return ONLY a valid JSON object — no markdown fences, no extra text:
{
  "clauses": [
    {
      "clause_name": "Human-readable name, e.g. Indemnification",
      "clause_type": "snake_case_key, e.g. indemnification",
      "clause_text": "Exact or near-exact clause text from the template",
      "preferred_position": "What ${entityName} should negotiate for in this clause"
    }
  ]
}`;
}

function parseClauses(raw: string): any[] {
  // Strip code fences and page-break separators (--- splits multi-page PDFs),
  // then try to parse the whole document as one JSON object.
  const joined = raw
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/\n?-{3,}\n?/g, '\n')
    .trim();

  // Strategy 1: outermost { "clauses": [...] }
  const objStart = joined.indexOf('{');
  const objEnd   = joined.lastIndexOf('}');
  if (objStart !== -1 && objEnd !== -1) {
    try {
      const p = JSON.parse(joined.slice(objStart, objEnd + 1));
      if (Array.isArray(p?.clauses) && p.clauses.length > 0) return p.clauses;
      if (Array.isArray(p) && p.length > 0) return p;
    } catch { /* fall through */ }
  }

  // Strategy 2: bare JSON array
  const arrStart = joined.indexOf('[');
  const arrEnd   = joined.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1) {
    try {
      const a = JSON.parse(joined.slice(arrStart, arrEnd + 1));
      if (Array.isArray(a) && a.length > 0) return a;
    } catch { /* fall through */ }
  }

  // Strategy 3: accumulate clauses across all page blocks
  const allClauses: any[] = [];
  for (const block of raw.split(/\n?-{3,}\n?/)) {
    const cleaned = block.replace(/```json|```/g, '').trim();
    if (!cleaned) continue;
    try {
      const p = JSON.parse(cleaned);
      if (Array.isArray(p?.clauses) && p.clauses.length > 0) allClauses.push(...p.clauses);
      else if (Array.isArray(p) && p.length > 0) allClauses.push(...p);
    } catch { /* next block */ }
  }
  if (allClauses.length > 0) {
    console.log(`[parse-template] Strategy 3 accumulated ${allClauses.length} clauses across ${raw.split(/\n?-{3,}\n?/).length} page blocks`);
    return allClauses;
  }

  console.error('[parse-template] Could not parse LlamaParse response:\n', raw.slice(0, 1000));
  return [];
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const formData  = await req.formData();
  const file      = formData.get('file') as File | null;
  const entityName   = (formData.get('entity_name')   as string | null)?.trim();
  const documentType = (formData.get('document_type') as string | null) ?? 'general_contract';

  if (!file)       return NextResponse.json({ error: 'file is required' },        { status: 400 });
  if (!entityName) return NextResponse.json({ error: 'entity_name is required' }, { status: 400 });

  const llamaKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!llamaKey)   return NextResponse.json({ error: 'LLAMA_CLOUD_API_KEY is not configured' }, { status: 500 });

  // Upload original file to LlamaParse (PDF/DOCX processed natively across all pages)
  const buffer = await file.arrayBuffer();
  const blob   = new Blob([buffer], { type: file.type || 'application/octet-stream' });
  const fd     = new FormData();
  fd.append('file', blob, file.name);
  fd.append('parsing_instruction', buildInstruction(entityName, documentType));

  const uploadRes = await fetch(`${LLAMAPARSE_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${llamaKey}` },
    body: fd,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    return NextResponse.json({ error: `LlamaParse upload failed: ${body}` }, { status: 500 });
  }

  const { id: jobId } = await uploadRes.json();
  if (!jobId) return NextResponse.json({ error: 'LlamaParse returned no job id' }, { status: 500 });

  // Poll up to 90 s
  let succeeded = false;
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${llamaKey}` },
    });
    const { status } = await s.json();
    if (status === 'SUCCESS') { succeeded = true; break; }
    if (status === 'ERROR')   return NextResponse.json({ error: 'LlamaParse job failed' }, { status: 500 });
  }
  if (!succeeded) return NextResponse.json({ error: 'LlamaParse timed out after 90 s' }, { status: 500 });

  const resultRes = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}/result/markdown`, {
    headers: { Authorization: `Bearer ${llamaKey}` },
  });
  if (!resultRes.ok) return NextResponse.json({ error: 'LlamaParse result fetch failed' }, { status: 500 });

  const resultJson = await resultRes.json();
  const raw: string = resultJson.markdown ?? resultJson.pages?.map((p: any) => p.md).join('\n') ?? '';

  const pageCount = raw.split(/\n?-{3,}\n?/).length;
  console.log(`[parse-template] LlamaParse raw — ${pageCount} page block(s), first 1200 chars:\n`, raw.slice(0, 1200));

  const rawClauses = parseClauses(raw);
  const validClauses = rawClauses.filter(c => c && (c.clause_name || c.clause_type) && c.clause_text?.trim());

  if (validClauses.length === 0) {
    return NextResponse.json({ error: 'No clauses extracted — check server terminal for raw output' }, { status: 422 });
  }

  // Deduplicate by clause_type and shape into PlaybookRule format
  const seen = new Set<string>();
  const rules = validClauses
    .filter(c => {
      const k = (c.clause_type || c.clause_name || '').toLowerCase().replace(/[\s_-]+/g, '_');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(c => ({
      clause_type:          (c.clause_type  || '').toString().trim(),
      clause_name:          (c.clause_name  || c.clause_type || '').toString().trim(),
      clause_text:          (c.clause_text  || '').toString().trim(),
      preferred_position:   (c.preferred_position || '').toString().trim(),
      party_role:           entityName,
      required_clause:      false,
      red_flags:            [] as string[],
      green_signals:        [] as string[],
      clause_weight:        3,
      applies_to_positions: [] as string[],
      score_rubric:         [] as { criterion: string; weight: number; preferred_outcome: string }[],
    }));

  return NextResponse.json({ rules, entity_name: entityName });
}
