-- Run this in the Supabase SQL Editor.
-- Adds a structured BGC renewal interval to contracts, so the compliance
-- engine can compare a driver's actual background-check recency against the
-- customer's contractual requirement (in addition to the state legal minimum).
-- Set manually per contract by a reviewer after reading the relevant clause
-- (e.g. cl_0042_13's "requires annual checks" -> bgc_interval_months = 12) --
-- clause text is too varied to reliably auto-parse into a number.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS bgc_interval_months INTEGER;
