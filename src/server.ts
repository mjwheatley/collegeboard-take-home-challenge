/**
 * Local Development Server
 *
 * A simple HTTP server for testing your handlers locally.
 * Run with: pnpm dev
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';

import { getItemHandler, createItemHandler } from './handlers/example.js';

import type { CreateItemRequest } from './types/item.js';

const PORT = Number(process.env.PORT ?? 3000);

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const { method, url } = req;

  // Parse request body
  let body = '';

  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  await new Promise((resolve) => req.on('end', resolve));

  const parsedBody: unknown = body ? JSON.parse(body) : null;

  console.log(`${method} ${url}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();

    return;
  }

  try {
    let result;

    // Example routes - implement your own routing logic
    if (method === 'GET' && url === '/api/items/test') {
      result = await getItemHandler('test');
    } else if (method === 'POST' && url === '/api/items') {
      // TODO: Validate parsedBody with Zod instead of trusting the client (see task 3)
      result = await createItemHandler(parsedBody as CreateItemRequest);
    } else if (method === 'GET' && url?.startsWith('/api/items/')) {
      const id = url.split('/').pop();

      result = id ? await getItemHandler(id) : { statusCode: 400, body: { error: 'Missing item id' } };
    } else {
      result = {
        statusCode: 404,
        body: { error: 'Route not found' },
      };
    }

    res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`\nExample endpoints:`);
  console.log(`  POST   http://localhost:${PORT}/api/items`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
