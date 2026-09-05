/**
 * Lightweight boolean word search: "sole AND liability", "indemnify OR hold harmless",
 * "-terminate" / "NOT terminate", and "quoted phrases". Bare space-separated terms are
 * implicitly ANDed. AND/OR/NOT are case-insensitive; unmatched quotes are treated as
 * literal text.
 */

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    tokens.push(m[1] !== undefined ? `"${m[1]}"` : m[2]);
  }
  return tokens;
}

export function matchesBooleanQuery(haystack: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const hay = haystack.toLowerCase();

  const tokens = tokenize(q);

  // Split into OR-groups; terms within a group are implicitly ANDed.
  const groups: string[][] = [[]];
  for (const tok of tokens) {
    if (tok.toUpperCase() === 'OR') groups.push([]);
    else groups[groups.length - 1].push(tok);
  }

  return groups.some(group => {
    if (group.length === 0) return false;
    for (let i = 0; i < group.length; i++) {
      let tok = group[i];
      if (tok.toUpperCase() === 'AND') continue;

      let negate = false;
      if (tok.toUpperCase() === 'NOT') {
        negate = true;
        i++;
        tok = group[i];
        if (tok === undefined) break;
      } else if (tok.startsWith('-') && tok.length > 1) {
        negate = true;
        tok = tok.slice(1);
      }

      const term = (tok.startsWith('"') && tok.endsWith('"') && tok.length > 1 ? tok.slice(1, -1) : tok).toLowerCase();
      if (!term) continue;
      const found = hay.includes(term);
      if (negate ? found : !found) return false;
    }
    return true;
  });
}

/** Returns the non-negated search terms from a boolean query — i.e. every word/phrase
 *  that must (or may, under OR) be present, skipping AND/OR/NOT keywords and any
 *  "-excluded"/"NOT excluded" terms. Used to highlight matches, not to filter. */
export function extractPositiveTerms(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const tokens = tokenize(q);
  const terms: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const upper = tok.toUpperCase();
    if (upper === 'OR' || upper === 'AND') continue;
    if (upper === 'NOT') { i++; continue; } // skip the negated term that follows
    if (tok.startsWith('-') && tok.length > 1) continue; // negated term, skip

    const term = tok.startsWith('"') && tok.endsWith('"') && tok.length > 1 ? tok.slice(1, -1) : tok;
    if (term.trim()) terms.push(term.trim());
  }
  return terms;
}
