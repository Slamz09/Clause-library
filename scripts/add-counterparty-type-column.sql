-- Run this in the Supabase SQL Editor.
-- Adds a counterparty classification to contracts (Customer, Vendor,
-- Independent Contractor, or a user-defined custom label), independent of
-- contract_facing which only governs which linked_customer_id/linked_vendor_id
-- pair is used.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS counterparty_type TEXT;
