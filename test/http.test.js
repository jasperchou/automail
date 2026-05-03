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

async function callRoute(route, { method = 'GET', url, headers = {} }) {
  const req = { method, url, headers };
  const res = createMockRes();
  route(req, res);
  await new Promise((resolve) => setImmediate(resolve));
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
  assert.equal(response.body, null);
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
