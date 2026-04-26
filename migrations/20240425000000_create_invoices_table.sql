-- Create invoices table for LiquiFact
-- Migration: 20240425000000_create_invoices_table.sql

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255),
    customer_tax_id VARCHAR(50),
    due_date DATE NOT NULL,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_verification' 
        CHECK (status IN ('pending_verification', 'verified', 'funded', 'partially_funded', 'completed', 'defaulted')),
    sme_id UUID NOT NULL,
    buyer_id UUID,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    version INTEGER NOT NULL DEFAULT 1
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoices_sme_id ON invoices(sme_id);
CREATE INDEX IF NOT EXISTS idx_invoices_buyer_id ON invoices(buyer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_customer_name_trgm ON invoices USING gin(customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_invoices_metadata ON invoices USING gin(metadata);

-- Create trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_invoices_updated_at 
    BEFORE UPDATE ON invoices 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add RLS (Row Level Security) policies
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see invoices belonging to their tenant
-- This will be implemented with proper tenant_id column in future migrations
-- For now, we allow all reads (to be updated when tenant system is implemented)

-- Add comments for documentation
COMMENT ON TABLE invoices IS 'Core invoices table for LiquiFact platform';
COMMENT ON COLUMN invoices.id IS 'Primary key using UUID';
COMMENT ON COLUMN invoices.invoice_number IS 'Unique invoice identifier for business use';
COMMENT ON COLUMN invoices.amount IS 'Invoice amount in specified currency';
COMMENT ON COLUMN invoices.currency IS 'ISO 4217 currency code (default: USD)';
COMMENT ON COLUMN invoices.status IS 'Current invoice status in the financing lifecycle';
COMMENT ON COLUMN invoices.sme_id IS 'Reference to the SME (seller) who issued the invoice';
COMMENT ON COLUMN invoices.buyer_id IS 'Reference to the buyer who owes the invoice';
COMMENT ON COLUMN invoices.metadata IS 'Flexible JSON storage for additional invoice data';
COMMENT ON COLUMN invoices.deleted_at IS 'Soft delete timestamp - null means active record';
