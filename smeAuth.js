'use strict';

const AppError = require('../errors/AppError');

/**
 * Middleware to verify wallet binding and authorize SME-specific operations.
 * 
 * This is a design stub. In production, walletAddress would be retrieved from 
 * the database user record, which is populated via SIWS (Sign-In with Stellar).
 */
function authorizeSmeWallet(req, res, next) {
  const user = req.user;

  // 1. Authentication Check
  if (!user) {
    return next(new AppError({
      type: 'https://liquifact.com/probs/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Standard authentication (JWT) is required for this operation.',
    }));
  }

  // 2. Wallet Binding Check (Stub)
  // We check the user object for a bound address, or allow a header for development/testing.
  const walletAddress = user.walletAddress || req.headers['x-stellar-address'];

  if (!walletAddress) {
    return next(new AppError({
      type: 'https://liquifact.com/probs/wallet-unbound',
      title: 'Wallet Unbound',
      status: 403,
      detail: 'No Stellar wallet address is bound to this account. Ownership cannot be verified.',
      instance: req.originalUrl,
    }));
  }

  // 3. Address Format Validation
  const stellarAddressRegex = /^G[A-Z2-7]{55}$/;
  if (!stellarAddressRegex.test(walletAddress)) {
    return next(new AppError({
      type: 'https://liquifact.com/probs/invalid-wallet',
      title: 'Invalid Wallet Address',
      status: 400,
      detail: 'The provided Stellar wallet address format is invalid.',
      instance: req.originalUrl,
    }));
  }

  // Attach verified wallet address to the request context
  req.walletAddress = walletAddress;
  next();
}

/**
 * Middleware to verify SME ownership of a specific invoice.
 * 
 * @param {Array} invoices - The invoice collection (in-memory or service).
 */
const verifyInvoiceOwner = (invoices) => (req, res, next) => {
  const { id } = req.params;
  const { walletAddress } = req;
  const userId = req.user?.id || req.user?.sub;

  if (!id) {
    return next(new AppError({
      type: 'https://liquifact.com/probs/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Invoice ID is required.',
    }));
  }

  const invoice = invoices.find(inv => inv.id === id);

  if (!invoice) {
    return next(new AppError({
      type: 'https://liquifact.com/probs/not-found',
      title: 'Invoice Not Found',
      status: 404,
      detail: `Invoice with ID '${id}' was not found.`,
      instance: req.originalUrl,
    }));
  }

  // Ownership logic (Stub): must match bound wallet address or user identifier.
  const isOwner = (invoice.smeWallet && invoice.smeWallet === walletAddress) || 
                  (invoice.ownerId && invoice.ownerId === userId);

  if (!isOwner) {
    return next(new AppError({
      type: 'https://liquifact.com/probs/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'You do not have permission to access this invoice.',
      instance: req.originalUrl,
    }));
  }

  // Attach verified invoice to request to avoid re-fetching
  req.invoice = invoice;
  next();
};

module.exports = { authorizeSmeWallet, verifyInvoiceOwner };