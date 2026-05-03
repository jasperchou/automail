import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from '../src/backfill-structured.js';

test('parseArgs supports mailbox flag forms', () => {
  assert.deepEqual(parseArgs([]), { mailbox: '' });
  assert.deepEqual(parseArgs(['--mailbox', 'user@example.com']), { mailbox: 'user@example.com' });
  assert.deepEqual(parseArgs(['--mailbox=user@example.com']), { mailbox: 'user@example.com' });
});
