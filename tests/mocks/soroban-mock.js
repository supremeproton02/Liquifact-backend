/**
 * Simple Mock Soroban RPC Server for E2E tests.
 * Responds to JSON-RPC 2.0 calls like 'getHealth'.
 */
const express = require('express');
const app = express();
const port = process.env.PORT || 8000;

app.use(express.json());

app.post('/', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  
  console.log(`[Soroban Mock] Received call: ${method}`, params || '');

  if (method === 'getHealth') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: { status: 'healthy' }
    });
  }

  // Generic success response for other methods
  return res.json({
    jsonrpc: '2.0',
    id,
    result: { status: 'mock_success', method }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(port, () => {
  console.log(`Soroban Mock Server running at http://localhost:${port}`);
});
