-- ============================================================
-- MIGRATION: Add payments table for Razorpay order audit trail
-- Run this in the Supabase SQL Editor once before deploying payment endpoints.
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid         TEXT NOT NULL,
  razorpay_order_id    TEXT NOT NULL UNIQUE,
  razorpay_payment_id  TEXT,
  razorpay_signature   TEXT,
  amount_paise         INTEGER NOT NULL,
  plan                 TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  status               TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_firebase_uid ON payments (firebase_uid);
CREATE INDEX IF NOT EXISTS idx_payments_order_id     ON payments (razorpay_order_id);

-- RLS: users can view their own payment records; admin service role can write
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payments"
  ON payments FOR SELECT
  USING (firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub');

-- Service-role key bypasses RLS — backend writes use the service role key.
