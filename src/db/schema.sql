-- Payment Gateway Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Payment status enum
CREATE TYPE payment_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed',
  'refunded',
  'partially_refunded'
);

-- Refund status enum
CREATE TYPE refund_status AS ENUM (
  'pending',
  'completed',
  'failed'
);

-- Idempotency status enum
CREATE TYPE idempotency_status AS ENUM (
  'processing',
  'completed'
);

-- Webhook status enum
CREATE TYPE webhook_status AS ENUM (
  'pending',
  'sent',
  'failed'
);

-- API Keys table
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_hash VARCHAR(256) NOT NULL UNIQUE,
  merchant_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  permissions JSONB DEFAULT '["payments:read", "payments:write", "refunds:write"]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_merchant_id ON api_keys(merchant_id);

-- Payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id VARCHAR(255) UNIQUE,
  merchant_id VARCHAR(100) NOT NULL,
  amount DECIMAL(19, 4) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL,
  status payment_status DEFAULT 'pending',
  provider VARCHAR(50) NOT NULL,
  provider_transaction_id VARCHAR(255),
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  webhook_url VARCHAR(2048),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payments_external_id ON payments(external_id);
CREATE INDEX idx_payments_merchant_id ON payments(merchant_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_provider ON payments(provider);
CREATE INDEX idx_payments_created_at ON payments(created_at);

-- Transactions table (payment status history)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  provider_response JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_transactions_payment_id ON transactions(payment_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- Refunds table
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount DECIMAL(19, 4) NOT NULL CHECK (amount > 0),
  status refund_status DEFAULT 'pending',
  reason TEXT,
  provider_refund_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX idx_refunds_status ON refunds(status);

-- Idempotency keys table
CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  merchant_id VARCHAR(100) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  request_path VARCHAR(255) NOT NULL,
  request_method VARCHAR(10) NOT NULL,
  response JSONB,
  status_code INTEGER,
  status idempotency_status DEFAULT 'processing',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);
CREATE INDEX idx_idempotency_keys_merchant_id ON idempotency_keys(merchant_id);

-- Webhook events table
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  url VARCHAR(2048) NOT NULL,
  signature VARCHAR(512),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  status webhook_status DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_webhook_events_payment_id ON webhook_events(payment_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(status);
CREATE INDEX idx_webhook_events_next_retry_at ON webhook_events(next_retry_at);

-- Audit logs table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  actor VARCHAR(255),
  actor_type VARCHAR(50) DEFAULT 'system',
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_refunds_updated_at
  BEFORE UPDATE ON refunds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired idempotency keys
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM idempotency_keys WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ language 'plpgsql';
