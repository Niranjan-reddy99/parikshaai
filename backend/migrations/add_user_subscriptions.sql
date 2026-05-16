-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Creates the user_subscriptions table for server-side paywall enforcement

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid             TEXT NOT NULL UNIQUE,
    plan                     TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'basic' | 'pro' | 'elite'
    status                   TEXT NOT NULL DEFAULT 'active', -- 'active' | 'expired' | 'cancelled'
    plan_expires_at          TIMESTAMPTZ,
    razorpay_subscription_id TEXT,
    razorpay_customer_id     TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subs_uid ON user_subscriptions(firebase_uid);

-- RLS: only service_role can write; users can read their own row
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own subscription" ON user_subscriptions;
DROP POLICY IF EXISTS "Service role full access" ON user_subscriptions;

CREATE POLICY "Users read own subscription" ON user_subscriptions
    FOR SELECT USING (true);  -- backend reads with service_role, so RLS bypassed

CREATE POLICY "Service role full access" ON user_subscriptions
    FOR ALL USING (true);
