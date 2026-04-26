-- Add tenant_id to invoices table for proper multi-tenant isolation
-- Migration: 20240425000002_add_tenant_to_invoices.sql

-- Add tenant_id column to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- Add foreign key constraint
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_tenant_id 
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Create index for tenant_id
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);

-- Update RLS policy for invoices to enforce tenant isolation
DROP POLICY IF EXISTS invoice_tenant_policy ON invoices;
CREATE POLICY invoice_tenant_policy ON invoices
    FOR ALL TO authenticated_role
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Add comment
COMMENT ON COLUMN invoices.tenant_id IS 'Tenant ID for multi-tenant data isolation';

-- Create a function to safely set tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_uuid UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', tenant_uuid::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to get current tenant context
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_tenant_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
