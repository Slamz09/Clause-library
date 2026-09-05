// ─── Safe Error Responses ─────────────────────────────────────────────────────
// Prevents internal details (table names, column names, constraint violations,
// stack traces) from leaking to API callers.

// Supabase / PostgreSQL error patterns that reveal internal schema details
const SENSITIVE_PATTERNS: RegExp[] = [
  /column\s+"[^"]+"\s+of\s+relation/i,
  /relation\s+"[^"]+"\s+does\s+not\s+exist/i,
  /duplicate\s+key\s+value\s+violates/i,
  /violates\s+(foreign\s+key|not-null|unique)\s+constraint/i,
  /syntax\s+error\s+at\s+or\s+near/i,
  /operator\s+does\s+not\s+exist/i,
  /permission\s+denied\s+for\s+(table|relation|schema)/i,
  /null\s+value\s+in\s+column\s+"[^"]+"/i,
  /invalid\s+input\s+syntax\s+for\s+type/i,
  /each\s+row\s+expression\s+in\s+the\s+IN\s+list/i,
  /function\s+[a-z_]+\([^)]*\)\s+does\s+not\s+exist/i,
];

/**
 * Sanitizes a Supabase or DB error message before returning it to the caller.
 * Messages that reveal internal schema details are replaced with a generic string.
 * User-facing validation errors (e.g. "document_id is required") pass through.
 */
export function sanitizeDbError(
  error: { message: string } | null | undefined,
  fallback = 'Database operation failed',
): string {
  if (!error?.message) return fallback;
  const msg = error.message;
  if (SENSITIVE_PATTERNS.some((p) => p.test(msg))) return fallback;
  return msg;
}

/**
 * Logs the real error server-side and returns a safe public message.
 * Use this in catch blocks to ensure nothing internal leaks.
 */
export function safeError(
  err: unknown,
  context: string,
  publicMessage = 'An internal error occurred',
): string {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[${context}]`, detail);
  return publicMessage;
}
