// ─── Per-obligation applicability (Clients / Workers / Service Providers) ────
// Requirement: for each atomic obligation the structured-obligation side panel
// shows how many Clients / Workers / Service Providers it applies to, each
// count expandable to the full record list, and FOUR states are kept distinct
// and never collapsed to 0:
//
//   'zero'           — scope resolved, the entity join returned no records
//   'not_evaluated'  — no canonical_obligation_applicability row for this
//                      obligation at all
//   'unresolved'     — scope known but a required fact is missing
//   'not_applicable' — this obligation does not bind that entity type
//
// Scope is stored on canonical_obligation_applicability (one row per
// obligation). Counts are NEVER stored — they are computed live here from the
// scope + the entity / relationship tables. Contract-sourced obligations use
// deterministic contract-relationship joins; regulation-sourced obligations
// are left to the regulatory Kleene engine (no row written -> 'not_evaluated'
// until that engine produces a determination).

import { createServerClient } from '@/lib/supabaseServer';

type SbClient = ReturnType<typeof createServerClient>;

// 'applicable' is the normal positive case (count > 0). The other four are the
// states the spec requires be kept distinct and never shown as a bare 0.
export type ApplicabilityState = 'applicable' | 'zero' | 'not_evaluated' | 'unresolved' | 'not_applicable';
export type EntityKind = 'client' | 'worker' | 'service_provider';

export interface ApplicableRecord {
  id: string;
  name: string;
  url: string | null;
}

export interface EntityApplicability {
  state: ApplicabilityState;
  count: number;
  reason: string | null;
  records: ApplicableRecord[];
}

export type ObligationApplicability = Record<EntityKind, EntityApplicability>;

const LIST_URL: Record<EntityKind, string> = {
  client: '/customers',
  worker: '/workers',
  service_provider: '/vendors',
};

// ─── Write scope rows for a document's contract-sourced obligations ─────────
export async function buildApplicabilityForDocument(sb: SbClient, documentId: string): Promise<{ written: number }> {
  const { data: sources } = await sb
    .from('canonical_obligation_sources')
    .select('canonical_obligation_id, regulatory_source_id')
    .eq('document_id', documentId)
    .eq('provenance_role', 'originating');
  if (!sources?.length) return { written: 0 };

  // Contract relationship — now stored on the documents row itself
  // (contracts merged into documents). Falls back to the legacy contracts
  // table pre-migration.
  let contract: { linked_client_id?: string | null; linked_vendor_id?: string | null; contract_facing?: string | null } | null = null;
  {
    const { data, error } = await sb
      .from('documents')
      .select('linked_client_id, linked_vendor_id, contract_facing')
      .eq('document_id', documentId)
      .maybeSingle();
    if (error?.code === '42703') {
      const legacy = await sb.from('contracts').select('linked_client_id, linked_vendor_id, contract_facing').eq('document_id', documentId).maybeSingle();
      contract = legacy.data;
    } else {
      contract = data;
    }
  }

  const clientId = contract?.linked_client_id || null;
  const vendorId = contract?.linked_vendor_id || null;

  // Obligation-level flow-down (whether the requirement passes through to
  // workers / subcontractors).
  const obIds = [...new Set(sources.map((s: any) => s.canonical_obligation_id))];
  // select('*') so requirement_effect / derivation resolve even before the
  // add-canonical-obligation-effect-derivation migration.
  const { data: obs } = await sb
    .from('canonical_obligations')
    .select('*')
    .in('id', obIds);
  const obById = new Map<string, any>((obs || []).map((o: any) => [o.id, o]));

  const now = new Date().toISOString();
  let written = 0;

  for (const obId of obIds) {
    const src = sources.find((s: any) => s.canonical_obligation_id === obId);
    if (src?.regulatory_source_id) continue; // regulation-sourced — leave to the Kleene engine

    const ob = obById.get(obId);
    const flowDown = !!ob?.flow_down_required;
    const role = (ob?.obligated_role || '').toLowerCase();
    const effect = (ob?.requirement_effect || '').toLowerCase();
    // A term with no operational effect ('none') only supplies interpretive
    // context — it never binds a worker / service provider / client.
    const isInterpretiveOnly = effect === 'none';

    // Client: an obligation in a contract with a linked client binds that client.
    let clientScope: 'specific' | 'all' | 'not_applicable' = 'not_applicable';
    let evalStatus: 'evaluated' | 'unresolved' = 'evaluated';
    let unresolvedReason: string | null = null;
    if (clientId) {
      clientScope = 'specific';
    } else if (!vendorId) {
      evalStatus = 'unresolved';
      unresolvedReason = 'Contract has no linked client or service provider on file.';
    }

    // Service provider: bound when the contract is provider-facing, or when
    // the obligation flows down to subcontractors.
    let spScope: 'specific' | 'all' | 'not_applicable' = 'not_applicable';
    if (vendorId && (contract?.contract_facing === 'vendor' || flowDown || role.includes('provider') || role.includes('contractor') || role.includes('vendor'))) {
      spScope = 'specific';
    } else if (flowDown && clientId) {
      spScope = 'all'; // every service provider engaged with this client
    }

    // Worker: a contractual obligation's requirements reach the workers who
    // actually perform the work for the linked client / service provider — so
    // scope to 'all' whenever there IS a linked client or vendor and the
    // obligation has a real operational effect. (Previously this was gated on
    // flow-down / a worker-role keyword, which wrongly showed N/A for e.g.
    // W-004 who has a service engagement for the client on the contract.)
    let workerScope: 'specific' | 'all' | 'not_applicable' = 'not_applicable';
    if (!isInterpretiveOnly && (clientId || vendorId)) {
      workerScope = 'all';
    } else if (!isInterpretiveOnly && (flowDown || role.includes('worker') || role.includes('driver') || role.includes('employee') || role.includes('personnel'))) {
      evalStatus = 'unresolved';
      unresolvedReason = unresolvedReason || 'Obligation binds workers but the contract has no linked client or service provider.';
    }

    // Replace any prior row for this obligation.
    await sb.from('canonical_obligation_applicability').delete().eq('canonical_obligation_id', obId);
    const row: Record<string, unknown> = {
      canonical_obligation_id: obId,
      client_scope: clientScope,
      client_id: clientScope === 'specific' ? clientId : null,
      service_provider_scope: spScope,
      service_provider_id: spScope === 'specific' ? vendorId : null,
      worker_scope: workerScope,
      worker_id: null,
      organization_scope: 'not_applicable',
      applicability_status: 'active',
      evaluation_status: evalStatus,
      unresolved_reason: unresolvedReason,
      evaluated_at: now,
    };
    let { error } = await sb.from('canonical_obligation_applicability').insert(row);
    while (error) {
      const m = /Could not find the '([a-z_]+)' column|column "?([a-z_]+)"?/i.exec(error.message || '');
      const col = m?.[1] || m?.[2];
      if (col && col in row) { delete row[col]; ({ error } = await sb.from('canonical_obligation_applicability').insert(row)); continue; }
      console.error('[applicabilityBuilder] insert failed:', error.message);
      break;
    }
    if (!error) written++;
  }
  return { written };
}

// ─── Compute the live 4-state counts + record lists for one obligation ─────
export async function resolveApplicabilityCounts(sb: SbClient, canonicalObligationId: string): Promise<ObligationApplicability> {
  const notEval = (): EntityApplicability => ({ state: 'not_evaluated', count: 0, reason: null, records: [] });
  const result: ObligationApplicability = { client: notEval(), worker: notEval(), service_provider: notEval() };

  const { data: rows } = await sb
    .from('canonical_obligation_applicability')
    .select('*')
    .eq('canonical_obligation_id', canonicalObligationId)
    .eq('applicability_status', 'active');
  if (!rows?.length) return result; // no row at all -> not_evaluated for every type

  const row: any = rows[0];
  const unresolved = row.evaluation_status === 'unresolved';
  const reason: string | null = row.unresolved_reason || null;

  result.client = await resolveEntity(sb, 'client', row.client_scope, row.client_id, row, unresolved, reason);
  result.worker = await resolveEntity(sb, 'worker', row.worker_scope, row.worker_id, row, unresolved, reason);
  result.service_provider = await resolveEntity(sb, 'service_provider', row.service_provider_scope, row.service_provider_id, row, unresolved, reason);
  return result;
}

async function resolveEntity(
  sb: SbClient,
  kind: EntityKind,
  scope: string | null | undefined,
  specificId: string | null,
  row: any,
  unresolvedFlag: boolean,
  reason: string | null,
): Promise<EntityApplicability> {
  if (!scope || scope === 'not_applicable') {
    return { state: 'not_applicable', count: 0, reason: null, records: [] };
  }
  if (unresolvedFlag) {
    return { state: 'unresolved', count: 0, reason, records: [] };
  }

  let records: ApplicableRecord[] = [];
  try {
    if (scope === 'specific' && specificId) {
      const rec = await fetchOne(sb, kind, specificId);
      records = rec ? [rec] : [];
    } else if (scope === 'all') {
      records = await fetchAll(sb, kind, row);
    }
  } catch (err: any) {
    return { state: 'unresolved', count: 0, reason: `Could not resolve ${kind} list: ${err?.message ?? 'query failed'}`, records: [] };
  }

  // Scope resolved. Zero records is a real, distinct state — not "unknown".
  return { state: records.length === 0 ? 'zero' : 'applicable', count: records.length, reason: null, records };
}

async function fetchOne(sb: SbClient, kind: EntityKind, id: string): Promise<ApplicableRecord | null> {
  if (kind === 'client') {
    const { data } = await sb.from('clients').select('client_id, client_name').eq('client_id', id).maybeSingle();
    return data ? { id: data.client_id, name: data.client_name || data.client_id, url: LIST_URL.client } : null;
  }
  if (kind === 'worker') {
    const { data } = await sb.from('workers').select('worker_id, legal_name, display_name').eq('worker_id', id).maybeSingle();
    return data ? { id: data.worker_id, name: data.legal_name || data.display_name || data.worker_id, url: LIST_URL.worker } : null;
  }
  const { data } = await sb.from('service_providers').select('service_provider_id, legal_name, display_name').eq('service_provider_id', id).maybeSingle();
  return data ? { id: data.service_provider_id, name: data.legal_name || data.display_name || data.service_provider_id, url: LIST_URL.service_provider } : null;
}

async function fetchAll(sb: SbClient, kind: EntityKind, row: any): Promise<ApplicableRecord[]> {
  const clientId: string | null = row.client_id || null;
  const spId: string | null = row.service_provider_id || null;

  if (kind === 'worker') {
    // A worker "serves" a client through ANY of three links — union them so a
    // worker connected only via a service engagement (e.g. W-004 / SE-006 for
    // Canyon Ridge) is still recognised:
    //   1. workers.service_provider_id  (the SP on a provider-facing contract)
    //   2. workers.customer_id          (single primary client link)
    //   3. workers.clients_serviced[]   (manual "Clients Serviced" column)
    //   4. service_engagements.worker_id where client_id = <client>
    const byId = new Map<string, ApplicableRecord>();
    const add = (w: any) => { if (w?.worker_id && !byId.has(w.worker_id)) byId.set(w.worker_id, { id: w.worker_id, name: w.legal_name || w.display_name || w.worker_id, url: LIST_URL.worker }); };

    if (spId) {
      const { data } = await sb.from('workers').select('worker_id, legal_name, display_name').eq('service_provider_id', spId);
      (data || []).forEach(add);
    }
    if (clientId) {
      const { data: byCustomer } = await sb.from('workers').select('worker_id, legal_name, display_name').eq('customer_id', clientId);
      (byCustomer || []).forEach(add);

      // Manual clients_serviced[] (array contains). Ignore a missing-column error.
      const cs = await sb.from('workers').select('worker_id, legal_name, display_name').contains('clients_serviced', [clientId]);
      if (!cs.error) (cs.data || []).forEach(add);

      const { data: se } = await sb.from('service_engagements').select('worker_id').eq('client_id', clientId);
      const seWorkerIds = [...new Set((se || []).map((r: any) => r.worker_id).filter(Boolean))];
      if (seWorkerIds.length) {
        const { data: seWorkers } = await sb.from('workers').select('worker_id, legal_name, display_name').in('worker_id', seWorkerIds);
        (seWorkers || []).forEach(add);
      }
    }
    return [...byId.values()];
  }

  if (kind === 'service_provider') {
    if (!clientId) return [];
    // Service providers engaged with this client, via service_engagements.vendor_id
    // and contracts.linked_vendor_id.
    const ids = new Set<string>();
    const { data: se } = await sb.from('service_engagements').select('vendor_id').eq('client_id', clientId);
    for (const r of se || []) if (r.vendor_id) ids.add(r.vendor_id);
    const { data: ct } = await sb.from('contracts').select('linked_vendor_id').eq('linked_client_id', clientId);
    for (const r of ct || []) if (r.linked_vendor_id) ids.add(r.linked_vendor_id);
    if (ids.size === 0) return [];
    const { data } = await sb.from('service_providers').select('service_provider_id, legal_name, display_name').in('service_provider_id', [...ids]);
    return (data || []).map((s: any) => ({ id: s.service_provider_id, name: s.legal_name || s.display_name || s.service_provider_id, url: LIST_URL.service_provider }));
  }

  // client 'all' — every client (rare; only when an obligation is written to
  // bind all clients). Bounded select.
  const { data } = await sb.from('clients').select('client_id, client_name').limit(1000);
  return (data || []).map((c: any) => ({ id: c.client_id, name: c.client_name || c.client_id, url: LIST_URL.client }));
}
