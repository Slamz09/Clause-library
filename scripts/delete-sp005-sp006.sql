-- Permanently removes service providers SP-005 and SP-006. Irreversible —
-- back up first if there's any doubt.
--
-- Unlinks known references before deleting the rows themselves, so this
-- doesn't leave dangling vendor IDs on contracts/clauses, and doesn't fail
-- on a foreign-key constraint if one exists between these tables.
-- If your schema has other tables referencing service_provider_id (e.g. an
-- insurance_policies or service_engagements table) that aren't listed here,
-- this DELETE will error with exactly which constraint blocks it — add the
-- matching UPDATE for that table and re-run.

UPDATE public.contracts
SET linked_vendor_id = '', linked_vendor_name = ''
WHERE linked_vendor_id IN ('SP-005', 'SP-006');

UPDATE public.clauses
SET insurer_vendor_id = NULL
WHERE insurer_vendor_id IN ('SP-005', 'SP-006');

DELETE FROM public.service_providers
WHERE service_provider_id IN ('SP-005', 'SP-006');
