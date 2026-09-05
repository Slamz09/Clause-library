import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { requireSession, getSessionUser } from '@/lib/auth/requireSession';
import { createServerClient } from '@/lib/supabaseServer';
import { evaluateComplianceBatch, type EvaluateRequestItem } from '@/lib/compliance/evaluateServer';
import { safeError } from '@/lib/security/safeError';
import { env } from '@/lib/env';

// Reduced from an initial 500 — each request already does bulk (.in()) fetches
// rather than per-item queries, but a very large batch still means a very
// large result set and a very large regulation_overrides/.in() list.
const MAX_BATCH = 100;

// Permissive but bounded: blocks SQL wildcards / oversized buffers (the
// actual threat) without hard-coding an exact id prefix format that could
// false-reject legitimate legacy rows (e.g. workers still carrying the
// pre-rename 'DRV-###' prefix — worker_id has no DB-level format constraint).
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Matches the same 2-letter-abbr format already enforced by
// app/api/regulations/overrides/route.ts's isValidAbbr.
const STATE_RE = /^[A-Z]{2}$/;

let ratelimit: Ratelimit | null | undefined;

function getRatelimit(): Ratelimit | null {
  if (ratelimit !== undefined) return ratelimit;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('[compliance/evaluate] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting disabled for this route');
    ratelimit = null;
    return ratelimit;
  }
  ratelimit = new Ratelimit({
    redis: new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    limiter: Ratelimit.slidingWindow(20, '1 m'),
    prefix: 'ratelimit:compliance-evaluate',
  });
  return ratelimit;
}

function isValidItem(e: any): e is EvaluateRequestItem {
  return (
    !!e &&
    typeof e.worker_id === 'string' && ID_RE.test(e.worker_id) &&
    typeof e.client_id === 'string' && ID_RE.test(e.client_id) &&
    typeof e.state === 'string' && STATE_RE.test(e.state) &&
    (e.service_engagement_id === undefined || (typeof e.service_engagement_id === 'string' && ID_RE.test(e.service_engagement_id)))
  );
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const requestId = randomUUID();
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    // requireSession() above already guarantees a valid session — this
    // should be unreachable, but don't assume it away.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limiter = getRatelimit();
  if (limiter) {
    const { success } = await limiter.limit(sessionUser.id);
    if (!success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
  }

  const body = await req.json().catch(() => null);
  const evaluations = body?.evaluations;
  if (!Array.isArray(evaluations) || evaluations.length === 0) {
    return NextResponse.json({ error: 'evaluations (non-empty array) required' }, { status: 400 });
  }
  if (evaluations.length > MAX_BATCH) {
    return NextResponse.json({ error: `evaluations exceeds max batch size of ${MAX_BATCH}` }, { status: 400 });
  }
  if (!evaluations.every(isValidItem)) {
    return NextResponse.json(
      { error: 'each evaluation requires worker_id, client_id, state (2-letter), optional service_engagement_id, all in valid format' },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  try {
    const results = await evaluateComplianceBatch(evaluations as EvaluateRequestItem[]);

    // Best-effort immutable audit write — a logging failure must not mask
    // successful evaluation results from the caller.
    const { error: logError } = await supabase.from('compliance_evaluation_log').insert({
      user_id: sessionUser.id,
      user_email: sessionUser.email ?? null,
      request_id: requestId,
      item_count: evaluations.length,
      results,
    });
    if (logError) {
      console.error(`[compliance/evaluate:${requestId}] audit log write failed`, logError.message);
    }

    // Structured, per-item Decision Trace rows (see lib/ontology/types.ts and
    // scripts/add-decision-traces.sql) — same best-effort posture as the
    // audit log above: a write failure here must not mask the evaluation
    // results already computed.
    const traceRows = results.flatMap(r => r.decisionTraces.map(t => ({
      request_id: requestId,
      worker_id: t.worker_id,
      client_id: t.client_id,
      state: t.state,
      service_engagement_id: t.service_engagement_id,
      requirement_category: t.requirement_category,
      standards: t.standards,
      controlling_standard: t.controlling_standard,
      relationship: t.relationship,
      result: t.result,
    })));
    if (traceRows.length > 0) {
      const { error: traceError } = await supabase.from('decision_traces').insert(traceRows);
      if (traceError) {
        console.error(`[compliance/evaluate:${requestId}] decision trace write failed`, traceError.message);
      }
    }

    return NextResponse.json({ results, requestId });
  } catch (error) {
    const publicMessage = safeError(error, `compliance/evaluate:${requestId}`, 'Evaluation failed');

    const { error: logError } = await supabase.from('compliance_evaluation_log').insert({
      user_id: sessionUser.id,
      user_email: sessionUser.email ?? null,
      request_id: requestId,
      item_count: evaluations.length,
      results: [],
      error: publicMessage,
    });
    if (logError) {
      console.error(`[compliance/evaluate:${requestId}] audit log write failed (error path)`, logError.message);
    }

    return NextResponse.json({ error: publicMessage, requestId }, { status: 500 });
  }
}
