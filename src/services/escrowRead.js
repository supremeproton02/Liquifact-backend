/**
 * @fileoverview Service to resolve contractId for an invoice and read on-chain escrow state.
 *
 * - Maps invoiceId to contractId (DB or .env allowlist for dev)
 * - Reads get_escrow, get_legal_hold, and related getters from Soroban
 * - Returns UI-friendly JSON
 */

'use strict';

const { callSorobanContract } = require('./soroban');
const { AppError } = require('../errors/AppError');

// Allowlist mapping for dev: comma-separated pairs in .env: "invoice1:contract1,invoice2:contract2"
function getContractIdForInvoice(invoiceId) {
  const allowlist = process.env.ESCROW_ADDR_BY_INVOICE;
  if (!allowlist) throw new AppError('Contract mapping not configured', 500);
  const pairs = allowlist.split(',').map(s => s.trim().split(':'));
  const found = pairs.find(([inv]) => inv === invoiceId);
  if (!found) throw new AppError('No contract mapping for invoice', 404);
  return found[1];
}

/**
 * Reads escrow state for a given invoiceId.
 * @param {string} invoiceId
 * @returns {Promise<object>} Escrow state JSON for UI
 */
async function readEscrowState(invoiceId) {
  // 1. Map invoiceId to contractId
  const contractId = getContractIdForInvoice(invoiceId);

  // 2. Read on-chain state (stubbed for now)
  // TODO: Replace with real Soroban contract calls
  const [escrow, legalHold] = await Promise.all([
    callSorobanContract(() => Promise.resolve({ status: 'active', fundedAmount: 1000 })),
    callSorobanContract(() => Promise.resolve({ legalHold: false })),
  ]);

  return {
    invoiceId,
    contractId,
    escrow,
    legalHold: legalHold.legalHold,
  };
}

module.exports = {
  getContractIdForInvoice,
  readEscrowState,
};
