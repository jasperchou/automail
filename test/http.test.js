import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoute } from '../src/http.js';

function createMockRes() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

async function callRoute(route, { method = 'GET', url, headers = {}, body = null, silenceConsoleError = false }) {
  const req = body === null
    ? { method, url, headers }
    : Object.assign(Readable.from([body]), { method, url, headers });
  const res = createMockRes();
  const originalConsoleError = console.error;

  if (silenceConsoleError) {
    console.error = () => {};
  }

  try {
    route(req, res);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalConsoleError;
  }

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body ? JSON.parse(res.body) : null
  };
}

test('health endpoint is public', async () => {
  const route = createRoute({
    config: {
      apiKey: 'secret',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {}
  });

  const response = await callRoute(route, { url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
});

test('mailboxes endpoint requires api key when configured', async () => {
  const route = createRoute({
    config: {
      apiKey: 'secret',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listMailboxes: async () => ['a@example.com']
    }
  });

  const unauthorized = await callRoute(route, { url: '/mailboxes' });
  const authorized = await callRoute(route, {
    url: '/mailboxes',
    headers: { host: '127.0.0.1:3000', 'x-api-key': 'secret' }
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.body.mailboxes, ['a@example.com']);
  assert.equal(authorized.headers['access-control-allow-origin'], '*');
});

test('mailboxes endpoint accepts api key query parameter and handles storage errors', async () => {
  const route = createRoute({
    config: {
      apiKey: 'secret',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listMailboxes: async () => {
        throw new Error('database unavailable');
      }
    }
  });

  const response = await callRoute(route, {
    url: '/mailboxes?api_key=secret',
    silenceConsoleError: true
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'Failed to list mailboxes');
});

test('options request returns cors preflight response', async () => {
  const route = createRoute({
    config: {
      apiKey: 'secret',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {}
  });

  const response = await callRoute(route, { method: 'OPTIONS', url: '/messages' });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], '*');
  assert.equal(response.headers['access-control-allow-methods'], 'GET, POST, DELETE, OPTIONS');
  assert.equal(response.body, null);
});

test('allowlist endpoint requires api key and supports list add delete', async () => {
  const entries = new Map();
  const route = createRoute({
    config: {
      apiKey: 'secret',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listRecipientAllowlist: async () => [...entries.values()],
      addRecipientAllowlistEntry: async (entry) => {
        const normalizedEntry = entry.trim().toLowerCase().replace(/^@+/, '');
        const record = {
          entry: normalizedEntry,
          createdAt: '2026-05-03T00:00:00.000Z'
        };
        entries.set(normalizedEntry, record);
        return record;
      },
      removeRecipientAllowlistEntry: async (entry) => entries.delete(entry.trim().toLowerCase().replace(/^@+/, ''))
    }
  });

  const unauthorized = await callRoute(route, { url: '/allowlist' });
  const added = await callRoute(route, {
    method: 'POST',
    url: '/allowlist',
    headers: { 'x-api-key': 'secret' },
    body: JSON.stringify({ entry: '@berich.xyz' })
  });
  const listed = await callRoute(route, {
    url: '/allowlist',
    headers: { 'x-api-key': 'secret' }
  });
  const removed = await callRoute(route, {
    method: 'DELETE',
    url: '/allowlist?entry=berich.xyz',
    headers: { 'x-api-key': 'secret' }
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(added.statusCode, 201);
  assert.equal(added.body.entry.entry, 'berich.xyz');
  assert.deepEqual(listed.body.entries.map((item) => item.entry), ['berich.xyz']);
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.body.removed, true);
});

test('allowlist endpoint validates entry and missing deletes', async () => {
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      addRecipientAllowlistEntry: async () => null,
      removeRecipientAllowlistEntry: async () => false
    }
  });

  const missingPostEntry = await callRoute(route, {
    method: 'POST',
    url: '/allowlist',
    body: '{}'
  });
  const missingDeleteEntry = await callRoute(route, {
    method: 'DELETE',
    url: '/allowlist'
  });
  const notFound = await callRoute(route, {
    method: 'DELETE',
    url: '/allowlist?entry=missing.example'
  });

  assert.equal(missingPostEntry.statusCode, 400);
  assert.equal(missingDeleteEntry.statusCode, 400);
  assert.equal(notFound.statusCode, 404);
});

test('allowlist endpoint rejects invalid json body', async () => {
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {}
  });

  const response = await callRoute(route, {
    method: 'POST',
    url: '/allowlist',
    body: '{',
    silenceConsoleError: true
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Invalid JSON body');
});

test('messages endpoint validates mailbox and returns not found when absent', async () => {
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listMessages: async () => null
    }
  });

  const missingParam = await callRoute(route, { url: '/messages' });
  const missingMailbox = await callRoute(route, { url: '/messages?mailbox=none@example.com' });

  assert.equal(missingParam.statusCode, 400);
  assert.equal(missingMailbox.statusCode, 404);
});

test('messages endpoint forwards pagination and filter params', async () => {
  const calls = [];
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listMessages: async (mailbox, options) => {
        calls.push({ mailbox, options });
        return {
          total: 99,
          limit: options.limit,
          offset: options.offset,
          messages: [{ id: 'm1', subject: 'hello' }]
        };
      }
    }
  });

  const response = await callRoute(route, {
    url: '/messages?mailbox=user@example.com&limit=5&offset=10&sender=alice@example.com&keyword=invoice&since=1714708800&until=1714795200'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0], {
    mailbox: 'user@example.com',
    options: {
      limit: 5,
      offset: 10,
      sender: 'alice@example.com',
      keyword: 'invoice',
      since: '2024-05-03T04:00:00.000Z',
      until: '2024-05-04T04:00:00.000Z'
    }
  });
  assert.equal(response.body.total, 99);
  assert.equal(response.body.limit, 5);
  assert.equal(response.body.offset, 10);
  assert.equal(response.body.sender, 'alice@example.com');
  assert.equal(response.body.keyword, 'invoice');
  assert.equal(response.body.since, '2024-05-03T04:00:00.000Z');
  assert.equal(response.body.until, '2024-05-04T04:00:00.000Z');
  assert.equal(response.body.messages.length, 1);
});

test('messages endpoint normalizes invalid pagination and timestamp params', async () => {
  const calls = [];
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listMessages: async (mailbox, options) => {
        calls.push({ mailbox, options });
        return {
          total: 0,
          limit: options.limit,
          offset: options.offset,
          messages: []
        };
      }
    }
  });

  const response = await callRoute(route, {
    url: '/messages?mailbox=user@example.com&limit=-1&offset=nope&since=invalid&until='
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0], {
    mailbox: 'user@example.com',
    options: {
      limit: 20,
      offset: 0,
      sender: '',
      keyword: '',
      since: null,
      until: null
    }
  });
});

test('messages endpoint returns server error when list fails', async () => {
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listMessages: async () => {
        throw new Error('database unavailable');
      }
    }
  });

  const response = await callRoute(route, {
    url: '/messages?mailbox=user@example.com',
    silenceConsoleError: true
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'Failed to list messages');
});

test('message detail endpoint returns stored message', async () => {
  const route = createRoute({
    config: {
      apiKey: 'secret',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      getMessage: async (_mailbox, id) => ({ id, subject: 'hello' })
    }
  });

  const response = await callRoute(route, {
    url: '/messages/abc123?mailbox=user@example.com&api_key=secret'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.id, 'abc123');
  assert.equal(response.body.subject, 'hello');
});

test('message detail endpoint validates mailbox and missing records', async () => {
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      getMessage: async () => null
    }
  });

  const missingParam = await callRoute(route, { url: '/messages/abc123' });
  const missingRecord = await callRoute(route, { url: '/messages/abc123?mailbox=user@example.com' });

  assert.equal(missingParam.statusCode, 400);
  assert.equal(missingRecord.statusCode, 404);
  assert.equal(missingRecord.body.error, 'Message not found');
});

test('message detail endpoint returns server error when lookup fails', async () => {
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      getMessage: async () => {
        throw new Error('database unavailable');
      }
    }
  });

  const response = await callRoute(route, {
    url: '/messages/abc123?mailbox=user@example.com',
    silenceConsoleError: true
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'Failed to get message');
});

test('messages endpoint supports all mailboxes', async () => {
  const calls = [];
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {
      listAllMessages: async (options) => {
        calls.push(options);
        return {
          total: 1,
          limit: options.limit,
          offset: options.offset,
          messages: [{ id: 'm1', mailbox: 'a@example.com' }]
        };
      }
    }
  });

  const response = await callRoute(route, {
    url: '/messages?mailbox=all&limit=10'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].limit, 10);
  assert.equal(response.body.mailbox, 'all');
  assert.equal(response.body.messages[0].mailbox, 'a@example.com');
});

test('unknown route returns not found', async () => {
  const route = createRoute({
    config: {
      apiKey: '',
      smtpHost: '0.0.0.0',
      smtpPort: 2525,
      httpHost: '0.0.0.0',
      httpPort: 3000
    },
    storage: {}
  });

  const response = await callRoute(route, { url: '/missing' });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, 'Not found');
});
