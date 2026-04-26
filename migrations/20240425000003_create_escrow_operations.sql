-- Create escrow operations and related tables
-- Migration: 20240425000003_create_escrow_operations.sql

-- Create escrow_operations table
CREATE TABLE IF NOT EXISTS escrow_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL 
        CHECK (operation_type IN ('create', 'fund', 'release', 'refund', 'cancel')),
    stellar_transaction_hash VARCHAR(64),
    contract_id VARCHAR(56),
    amount DECIMAL(15,2),
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    initiated_by UUID REFERENCES users(id),
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create escrow_summaries table for caching
CREATE TABLE IF NOT EXISTS escrow_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    total_funded DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_released DECIMAL(15,2) NOT NULL DEFAULT 0,
    available_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    stellar_ledger_sequence BIGINT,
    last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    cache_key VARCHAR(255) UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_escrow_operations_invoice_id ON escrow_operations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_escrow_operations_tenant_id ON escrow_operations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escrow_operations_status ON escrow_operations(status);
CREATE INDEX IF NOT EXISTS idx_escrow_operations_type ON escrow_operations(operation_type);
CREATE INDEX IF NOT EXISTS idx_escrow_operations_transaction_hash ON escrow_operations(stellar_transaction_hash);
CREATE INDEX IF NOT EXISTS idx_escrow_operations_created_at ON escrow_operations(created_at);

CREATE INDEX IF NOT EXISTS idx_escrow_summaries_invoice_id ON escrow_summaries(invoice_id);
CREATE INDEX IF NOT EXISTS idx_escrow_summaries_tenant_id ON escrow_summaries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escrow_summaries_cache_key ON escrow_summaries(cache_key);
CREATE INDEX IF NOT EXISTS idx_escrow_summaries_expires_at ON escrow_summaries(expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Create triggers
CREATE TRIGGER update_escrow_operations_updated_at 
    BEFORE UPDATE ON escrow_operations 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE escrow_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY escrow_operations_tenant_policy ON escrow_operations
    FOR ALL TO authenticated_role
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY escrow_summaries_tenant_policy ON escrow_summaries
    FOR ALL TO authenticated_role
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY audit_logs_tenant_policy ON audit_logs
    FOR ALL TO authenticated_role
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Add comments
COMMENT ON TABLE escrow_operations IS 'Stellar escrow operations tracking';
COMMENT ON TABLE escrow_summaries IS 'Cached escrow state summaries';
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for all operations';
COMMENT ON COLUMN escrow_operations.stellar_transaction_hash IS 'Stellar network transaction hash';
COMMENT ON COLUMN escrow_operations.contract_id IS 'Soroban contract identifier';
COMMENT ON COLUMN escrow_summaries.cache_key IS 'Redis cache key identifier';
COMMENT ON COLUMN audit_logs.ip_address IS 'Client IP address for security auditing';
