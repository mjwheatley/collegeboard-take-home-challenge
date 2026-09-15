import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getApiBase() {
  if (process.env.API_BASE) return process.env.API_BASE;

  try {
    // Search for .sst/outputs.json by climbing up from the current file's directory
    let currentDir = __dirname;
    while (currentDir !== path.parse(currentDir).root) {
      const outputsPath = path.join(currentDir, '.sst', 'outputs.json');
      if (fs.existsSync(outputsPath)) {
        const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
        if (outputs.api) return outputs.api;
      }
      currentDir = path.dirname(currentDir);
    }
  } catch (e) {
    // Log the error to help debugging but continue to the throw below
    console.error('Error searching for .sst/outputs.json:', e.message);
  }

  throw new Error('API base URL is not configured. Please set API_BASE environment variable or ensure .sst/outputs.json exists in the project root and contains an "api" field.');
}

async function testEndpoint(apiBase, token, method, path, body = null) {
  console.log(`Testing ${method} ${path}...`);
  const options = {
    method,
    headers: {},
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  if (Object.keys(options.headers).length === 0) {
    delete options.headers;
  }

  try {
    const response = await fetch(`${apiBase}${path}`, options);
    const data = await response.json();
    console.log(`Status: ${response.status}`);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}: ${JSON.stringify(data)}`);
    }

    return { status: response.status, data };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

async function runIntegrationTests(apiBase = getApiBase(), token = process.env.AUTH_TOKEN) {
  const results = [];
  try {
    // 1. Create Item
    const createPayload = {
      subject: 'Integration Test Biology',
      itemType: 'multiple-choice',
      difficulty: 3,
      content: {
        question: 'What is the powerhouse of the cell?',
        options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi Apparatus'],
        correctAnswer: 'Mitochondria',
        explanation: 'Mitochondria generate most of the cell\'s supply of ATP.',
      },
      metadata: {
        author: 'integration-tester',
        status: 'draft',
        tags: ['biology', 'cell'],
      },
      securityLevel: 'standard',
    };
    const { data: createdItem } = await testEndpoint(apiBase, token, 'POST', '/api/items', createPayload);
    const itemId = createdItem.id;
    results.push({ endpoint: '/api/items', method: 'POST', status: 'success' });

    // 2. List Items
    await testEndpoint(apiBase, token, 'GET', '/api/items');
    results.push({ endpoint: '/api/items', method: 'GET', status: 'success' });

    // 3. Get Item
    await testEndpoint(apiBase, token, 'GET', `/api/items/${itemId}`);
    results.push({ endpoint: `/api/items/${itemId}`, method: 'GET', status: 'success' });

    // 4. Update Item
    const updatePayload = {
      subject: 'Integration Test Biology Updated',
      difficulty: 4,
    };
    await testEndpoint(apiBase, token, 'PUT', `/api/items/${itemId}`, updatePayload);
    results.push({ endpoint: `/api/items/${itemId}`, method: 'PUT', status: 'success' });

    // 5. Create Version
    const versionPayload = {
      content: {
        question: 'What is the powerhouse of the cell? (v2)',
        options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi Apparatus'],
        correctAnswer: 'Mitochondria',
        explanation: 'Updated explanation for v2.',
      },
      changeLog: 'Updated question text for clarity',
    };
    await testEndpoint(apiBase, token, 'POST', `/api/items/${itemId}/versions`, versionPayload);
    results.push({ endpoint: `/api/items/${itemId}/versions`, method: 'POST', status: 'success' });

    // 6. List Versions
    await testEndpoint(apiBase, token, 'GET', `/api/items/${itemId}/versions`);
    results.push({ endpoint: `/api/items/${itemId}/versions`, method: 'GET', status: 'success' });

    // 7. Get Audit Trail
    await testEndpoint(apiBase, token, 'GET', `/api/items/${itemId}/audit`);
    results.push({ endpoint: `/api/items/${itemId}/audit`, method: 'GET', status: 'success' });

    console.log('\n✅ All integration tests completed successfully!');
    return { success: true, results };
  } catch (error) {
    console.error('\n❌ Integration tests failed!');
    return { success: false, error: error.message, results };
  }
}

if (process.argv[1] && process.argv[1].endsWith('integration-test.js')) {
  runIntegrationTests().then(res => {
    if (!res.success) process.exit(1);
  });
}

export { runIntegrationTests, getApiBase };
