import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createConfig, loadEnvFile } from '../src/config.js';

test('loadEnvFile parses env values and ignores comments', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mail-config-'));
  const envPath = path.join(tempDir, '.env');

  await fs.writeFile(
    envPath,
    "# comment\nHTTP_PORT=3010\nAPI_KEY='secret'\nSMTP_HOST=127.0.0.1\nINVALID_LINE\n",
    'utf8'
  );

  const env = loadEnvFile(envPath);

  assert.equal(env.HTTP_PORT, '3010');
  assert.equal(env.API_KEY, 'secret');
  assert.equal(env.SMTP_HOST, '127.0.0.1');
  assert.equal(env.INVALID_LINE, undefined);
});

test('loadEnvFile returns empty object when file is missing', () => {
  const env = loadEnvFile(path.join(os.tmpdir(), `missing-mail-env-${Date.now()}`));

  assert.deepEqual(env, {});
});

test('createConfig prefers process env over local env', () => {
  const config = createConfig({
    rootDir: '/tmp/mail-root',
    localEnv: {
      HTTP_PORT: '3001',
      API_KEY: 'from-file',
      DATABASE_URL: 'postgres://file-user:file-pass@db:5432/file_db',
      DATA_DIR: './mail-data'
    },
    processEnv: {
      HTTP_PORT: '3999',
      API_KEY: 'from-process'
    }
  });

  assert.equal(config.httpPort, 3999);
  assert.equal(config.apiKey, 'from-process');
  assert.equal(config.smtpPort, 2525);
  assert.equal(config.databaseUrl, 'postgres://file-user:file-pass@db:5432/file_db');
  assert.equal(config.dataDir, path.resolve('/tmp/mail-root', 'mail-data'));
});

test('createConfig preserves absolute data directory', () => {
  const config = createConfig({
    rootDir: '/tmp/mail-root',
    localEnv: {
      DATA_DIR: '/var/lib/automail'
    },
    processEnv: {}
  });

  assert.equal(config.dataDir, '/var/lib/automail');
});
