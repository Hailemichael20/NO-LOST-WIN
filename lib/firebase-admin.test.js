import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFirebaseAdminCredentialConfig } from './firebase-admin.js';

test('resolveFirebaseAdminCredentialConfig supports service-account JSON', () => {
  const previousEnv = { ...process.env };

  try {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: 'demo-project',
      client_email: 'demo@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    });

    const config = resolveFirebaseAdminCredentialConfig();

    assert.equal(config.projectId, 'demo-project');
    assert.equal(config.clientEmail, 'demo@example.com');
    assert.match(config.privateKey, /BEGIN PRIVATE KEY/);
    assert.match(config.privateKey, /abc/);
    assert.match(config.privateKey, /END PRIVATE KEY/);
  } finally {
    process.env = previousEnv;
  }
});

test('resolveFirebaseAdminCredentialConfig preserves explicit env vars', () => {
  const previousEnv = { ...process.env };

  try {
    process.env.FIREBASE_PROJECT_ID = 'env-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'env@example.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nxyz\\n-----END PRIVATE KEY-----\\n';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const config = resolveFirebaseAdminCredentialConfig();

    assert.equal(config.projectId, 'env-project');
    assert.equal(config.clientEmail, 'env@example.com');
    assert.match(config.privateKey, /xyz/);
  } finally {
    process.env = previousEnv;
  }
});
