-- Re-removes "Aspen Creek", which was silently resurrected by a bug in bulk
-- upload's counterparty auto-linking (now fixed — it no longer auto-creates
-- client/vendor records from an AI name guess, only links to existing ones).
-- Matches by name since it was re-created under a new SP-### id.

-- Preview first — check this is the right row(s) before running the deletes below.
SELECT service_provider_id, legal_name FROM public.service_providers WHERE legal_name ILIKE '%aspen creek%';

UPDATE public.contracts
SET linked_vendor_id = '', linked_vendor_name = ''
WHERE linked_vendor_id IN (SELECT service_provider_id FROM public.service_providers WHERE legal_name ILIKE '%aspen creek%');

UPDATE public.clauses
SET insurer_vendor_id = NULL
WHERE insurer_vendor_id IN (SELECT service_provider_id FROM public.service_providers WHERE legal_name ILIKE '%aspen creek%');

DELETE FROM public.service_providers WHERE legal_name ILIKE '%aspen creek%';
