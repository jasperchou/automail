import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStorage,
  normalizeAllowlistEntry,
  pickText,
  recipientAllowlistKeys,
  serializeHeaders
} from '../src/storage.js';

function createPoolMock() {
  const state = {
    allowlist: new Map(),
    mailboxes: new Map(),
    messages: []
  };

  return {
    state,
    async query(text, params = []) {
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX') || text.includes('ALTER TABLE')) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes('INSERT INTO mailboxes')) {
        state.mailboxes.set(params[0], { email: params[0] });
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('INSERT INTO messages')) {
        const row = {
          id: params[0],
          mailbox: params[1],
          stored_at: params[2],
          mail_from: params[3],
          rcpt_to: JSON.parse(params[4]),
          subject: params[5],
          sender: JSON.parse(params[6]),
          recipient: JSON.parse(params[7]),
          cc: JSON.parse(params[8]),
          bcc: JSON.parse(params[9]),
          message_date: params[10],
          text_content: params[11],
          html_content: params[12],
          headers: JSON.parse(params[13]),
          attachments: JSON.parse(params[14]),
          structured_data: JSON.parse(params[15]),
          raw_content: params[16]
        };
        state.messages.push(row);
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('SELECT entry, created_at') && text.includes('FROM recipient_allowlist')) {
        return {
          rows: [...state.allowlist.values()].sort((a, b) => a.entry.localeCompare(b.entry)),
          rowCount: state.allowlist.size
        };
      }

      if (text.includes('INSERT INTO recipient_allowlist')) {
        const row = state.allowlist.get(params[0]) || {
          entry: params[0],
          created_at: '2026-05-03T00:00:00.000Z'
        };
        state.allowlist.set(params[0], row);
        return { rows: [row], rowCount: 1 };
      }

      if (text.includes('DELETE FROM recipient_allowlist')) {
        const deleted = state.allowlist.delete(params[0]);
        return { rows: [], rowCount: deleted ? 1 : 0 };
      }

      if (text.includes('FROM recipient_allowlist') && text.includes('entry = ANY')) {
        const keys = params[0];
        const exists = keys.some((key) => state.allowlist.has(key));
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 };
      }

      if (text.includes('SELECT email') && text.includes('FROM mailboxes')) {
        return {
          rows: [...state.mailboxes.values()].sort((a, b) => a.email.localeCompare(b.email)),
          rowCount: state.mailboxes.size
        };
      }

      if (text.includes('SELECT 1') && text.includes('FROM mailboxes')) {
        const exists = state.mailboxes.has(params[0]);
        return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 };
      }

      if (text.includes('SELECT COUNT(*) AS total') && text.includes('FROM messages')) {
        const filteredRows = filterRows(state.messages, text, params);
        return { rows: [{ total: String(filteredRows.length) }], rowCount: 1 };
      }

      if (text.includes('FROM messages') && text.includes('ORDER BY stored_at DESC')) {
        const limit = params[params.length - 2];
        const offset = params[params.length - 1];
        const rows = filterRows(state.messages, text, params)
          .sort((a, b) => String(b.stored_at).localeCompare(String(a.stored_at)))
          .slice(offset, offset + limit);
        return { rows, rowCount: rows.length };
      }

      if (text.includes('FROM messages') && text.includes('LIMIT 1')) {
        const row = state.messages.find(
          (item) => item.mailbox === params[0] && item.id === params[1]
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (
        text.includes('SELECT id, mailbox, subject, text_content, html_content') &&
        text.includes('FROM messages')
      ) {
        const rows = text.includes('WHERE mailbox = $1')
          ? state.messages.filter((item) => item.mailbox === params[0])
          : [...state.messages];
        return { rows, rowCount: rows.length };
      }

      if (text.includes('UPDATE messages') && text.includes('SET structured_data')) {
        const row = state.messages.find((item) => item.id === params[1]);
        if (!row) {
          return { rows: [], rowCount: 0 };
        }
        row.structured_data = JSON.parse(params[0]);
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    async end() {}
  };
}

function filterRows(rows, text, params) {
  const isAllMailboxQuery = text.includes('WHERE TRUE');
  let result = isAllMailboxQuery ? [...rows] : rows.filter((row) => row.mailbox === params[0]);
  let paramIndex = isAllMailboxQuery ? 0 : 1;

  if (text.includes("LOWER(COALESCE(mail_from, '')) LIKE")) {
    const senderPattern = String(params[paramIndex]).replaceAll('%', '').toLowerCase();
    result = result.filter((row) => String(row.mail_from || '').toLowerCase().includes(senderPattern));
    paramIndex += 1;
  }

  if (text.includes('(subject ILIKE') && text.includes('OR text_content ILIKE')) {
    const keywordPattern = String(params[paramIndex]).replaceAll('%', '').toLowerCase();
    result = result.filter((row) => {
      const subject = String(row.subject || '').toLowerCase();
      const textContent = String(row.text_content || '').toLowerCase();
      return subject.includes(keywordPattern) || textContent.includes(keywordPattern);
    });
    paramIndex += 1;
  }

  if (text.includes('stored_at >= $')) {
    const since = new Date(params[paramIndex]).getTime();
    result = result.filter((row) => new Date(row.stored_at).getTime() >= since);
    paramIndex += 1;
  }

  if (text.includes('stored_at <= $')) {
    const until = new Date(params[paramIndex]).getTime();
    result = result.filter((row) => new Date(row.stored_at).getTime() <= until);
  }

  return result;
}

test('pickText falls back to html when text is absent', () => {
  assert.equal(pickText({ html: '<p>Hello <b>world</b></p>' }), 'Hello world');
});

test('pickText returns empty string when no body exists', () => {
  assert.equal(pickText({}), '');
});

test('serializeHeaders keeps complex values JSON-safe', () => {
  const headers = new Map([
    ['subject', 'hello'],
    ['date', new Date('2026-05-03T04:05:00.000Z')],
    ['from', { value: [{ address: 'a@example.com' }] }]
  ]);

  const result = serializeHeaders(headers);

  assert.equal(result.subject, 'hello');
  assert.equal(result.date, '2026-05-03T04:05:00.000Z');
  assert.deepEqual(result.from, { value: [{ address: 'a@example.com' }] });
});

test('serializeHeaders stringifies circular values', () => {
  const circular = {};
  circular.self = circular;
  const headers = new Map([
    ['x-circular', circular]
  ]);

  const result = serializeHeaders(headers);

  assert.equal(result['x-circular'], '[object Object]');
});

test('allowlist normalizers support full address and domain keys', () => {
  assert.equal(normalizeAllowlistEntry(' @Berich.XYZ '), 'berich.xyz');
  assert.deepEqual(recipientAllowlistKeys('Jasper@Mail.Berich.XYZ'), [
    'jasper@mail.berich.xyz',
    'mail.berich.xyz'
  ]);
  assert.deepEqual(recipientAllowlistKeys('invalid'), ['invalid']);
});

test('recipient allowlist supports seed, list, add, remove, and matching', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  await storage.seedRecipientAllowlist(['@berich.xyz', 'Jasper@Mail.Berich.XYZ']);

  assert.deepEqual(
    (await storage.listRecipientAllowlist()).map((item) => item.entry),
    ['berich.xyz', 'jasper@mail.berich.xyz']
  );
  assert.equal(await storage.isRecipientAllowed('someone@berich.xyz'), true);
  assert.equal(await storage.isRecipientAllowed('jasper@mail.berich.xyz'), true);
  assert.equal(await storage.isRecipientAllowed('spameri@tiscali.it'), false);
  assert.equal(await storage.removeRecipientAllowlistEntry('berich.xyz'), true);
  assert.equal(await storage.isRecipientAllowed('someone@berich.xyz'), false);
});

test('storage stores, lists, and fetches messages in postgres', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  const raw = Buffer.from(
    'From: sender@demo.com\nTo: user@example.com\nSubject: hi\nDate: Sat, 03 May 2026 12:05:00 +0800\n\nhello test\n'
  );

  const record = await storage.storeMessage(
    'User@Example.com',
    {
      mailFrom: { address: 'sender@demo.com' },
      rcptTo: [{ address: 'user@example.com' }]
    },
    raw
  );

  const mailboxes = await storage.listMailboxes();
  const messagesResult = await storage.listMessages('user@example.com');
  const message = await storage.getMessage('user@example.com', record.id);

  assert.deepEqual(mailboxes, ['user@example.com']);
  assert.equal(messagesResult.total, 1);
  assert.equal(messagesResult.limit, 20);
  assert.equal(messagesResult.offset, 0);
  assert.equal(messagesResult.messages.length, 1);
  assert.equal(messagesResult.messages[0].subject, 'hi');
  assert.equal(message.mailbox, 'user@example.com');
  assert.equal(message.envelope.mailFrom, 'sender@demo.com');
  assert.match(message.text, /hello test/);
  assert.deepEqual(message.envelope.rcptTo, ['user@example.com']);
});

test('listMessages returns null when mailbox does not exist', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });

  const messages = await storage.listMessages('missing@example.com');

  assert.equal(messages, null);
});

test('listMessages supports latest count, sender filter, and keyword filter', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  const first = Buffer.from(
    'From: alice@example.com\nTo: user@example.com\nSubject: invoice ready\n\nmonthly invoice attached\n'
  );
  const second = Buffer.from(
    'From: bob@example.com\nTo: user@example.com\nSubject: hello\n\njust saying hi\n'
  );

  await storage.storeMessage(
    'user@example.com',
    {
      mailFrom: { address: 'alice@example.com' },
      rcptTo: [{ address: 'user@example.com' }]
    },
    first
  );

  await storage.storeMessage(
    'user@example.com',
    {
      mailFrom: { address: 'bob@example.com' },
      rcptTo: [{ address: 'user@example.com' }]
    },
    second
  );

  const latestOne = await storage.listMessages('user@example.com', { limit: 1 });
  const bySender = await storage.listMessages('user@example.com', { sender: 'alice@example.com' });
  const byKeyword = await storage.listMessages('user@example.com', { keyword: 'invoice' });

  assert.equal(latestOne.messages.length, 1);
  assert.equal(bySender.total, 1);
  assert.equal(bySender.messages[0].from[0].address, 'alice@example.com');
  assert.equal(byKeyword.total, 1);
  assert.equal(byKeyword.messages[0].subject, 'invoice ready');
});

test('listMessages supports storedAt timestamp filtering', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  pool.state.mailboxes.set('user@example.com', { email: 'user@example.com' });
  pool.state.messages.push(
    {
      id: 'old',
      mailbox: 'user@example.com',
      stored_at: '2024-05-01T00:00:00.000Z',
      mail_from: 'alice@example.com',
      rcpt_to: ['user@example.com'],
      subject: 'old',
      sender: [{ address: 'alice@example.com', name: '' }],
      recipient: [{ address: 'user@example.com', name: '' }],
      cc: [],
      bcc: [],
      message_date: '2024-05-01T00:00:00.000Z',
      text_content: 'old body',
      html_content: null,
      headers: {},
      attachments: [],
      structured_data: { version: 1, items: [] },
      raw_content: 'old raw'
    },
    {
      id: 'new',
      mailbox: 'user@example.com',
      stored_at: '2024-05-03T00:00:00.000Z',
      mail_from: 'bob@example.com',
      rcpt_to: ['user@example.com'],
      subject: 'new',
      sender: [{ address: 'bob@example.com', name: '' }],
      recipient: [{ address: 'user@example.com', name: '' }],
      cc: [],
      bcc: [],
      message_date: '2024-05-03T00:00:00.000Z',
      text_content: 'new body',
      html_content: null,
      headers: {},
      attachments: [],
      structured_data: { version: 1, items: [] },
      raw_content: 'new raw'
    }
  );

  const filtered = await storage.listMessages('user@example.com', {
    since: '2024-05-02T00:00:00.000Z',
    until: '2024-05-04T00:00:00.000Z'
  });

  assert.equal(filtered.total, 1);
  assert.equal(filtered.messages[0].id, 'new');
});

test('listAllMessages returns messages across mailboxes ordered by latest first', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  pool.state.messages.push(
    {
      id: 'old',
      mailbox: 'a@example.com',
      stored_at: '2024-05-01T00:00:00.000Z',
      mail_from: 'alice@example.com',
      rcpt_to: ['a@example.com'],
      subject: 'old',
      sender: [{ address: 'alice@example.com', name: '' }],
      recipient: [{ address: 'a@example.com', name: '' }],
      cc: [],
      bcc: [],
      message_date: null,
      text_content: 'old body',
      html_content: null,
      headers: {},
      attachments: [],
      structured_data: { version: 1, items: [] },
      raw_content: 'old raw'
    },
    {
      id: 'new',
      mailbox: 'b@example.com',
      stored_at: '2024-05-03T00:00:00.000Z',
      mail_from: 'bob@example.com',
      rcpt_to: ['b@example.com'],
      subject: 'new',
      sender: [{ address: 'bob@example.com', name: '' }],
      recipient: [{ address: 'b@example.com', name: '' }],
      cc: [],
      bcc: [],
      message_date: null,
      text_content: 'new body',
      html_content: null,
      headers: {},
      attachments: [],
      structured_data: { version: 1, items: [] },
      raw_content: 'new raw'
    }
  );

  const result = await storage.listAllMessages({ limit: 20 });

  assert.equal(result.total, 2);
  assert.equal(result.messages[0].id, 'new');
  assert.equal(result.messages[1].id, 'old');
});

test('listMessages clamps limit and offset options', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  pool.state.mailboxes.set('user@example.com', { email: 'user@example.com' });
  for (let index = 0; index < 3; index += 1) {
    pool.state.messages.push({
      id: `message-${index}`,
      mailbox: 'user@example.com',
      stored_at: `2024-05-0${index + 1}T00:00:00.000Z`,
      mail_from: 'sender@example.com',
      rcpt_to: ['user@example.com'],
      subject: `message ${index}`,
      sender: [{ address: 'sender@example.com', name: '' }],
      recipient: [{ address: 'user@example.com', name: '' }],
      cc: [],
      bcc: [],
      message_date: null,
      text_content: `body ${index}`,
      html_content: null,
      headers: {},
      attachments: [],
      structured_data: { version: 1, items: [] },
      raw_content: `raw ${index}`
    });
  }

  const tooLarge = await storage.listMessages('user@example.com', { limit: 200, offset: -10 });
  const invalid = await storage.listMessages('user@example.com', { limit: 'abc', offset: 'abc' });

  assert.equal(tooLarge.limit, 100);
  assert.equal(tooLarge.offset, 0);
  assert.equal(invalid.limit, 20);
  assert.equal(invalid.offset, 0);
});

test('getMessage filters ignored resource links from stored structured data', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  pool.state.mailboxes.set('user@example.com', { email: 'user@example.com' });
  pool.state.messages.push({
    id: 'message-with-old-structured-data',
    mailbox: 'user@example.com',
    stored_at: '2024-05-01T00:00:00.000Z',
    mail_from: 'sender@example.com',
    rcpt_to: ['user@example.com'],
    subject: 'old structured data',
    sender: [{ address: 'sender@example.com', name: '' }],
    recipient: [{ address: 'user@example.com', name: '' }],
    cc: [],
    bcc: [],
    message_date: null,
    text_content: 'body',
    html_content: null,
    headers: {},
    attachments: [],
    structured_data: {
      version: 1,
      items: [
        { type: 'link', value: 'https://example.com/logo.png' },
        { type: 'link', value: 'https://example.com/action' }
      ]
    },
    raw_content: 'raw'
  });

  const message = await storage.getMessage('user@example.com', 'message-with-old-structured-data');

  assert.deepEqual(
    message.structuredData.items.map((item) => item.value),
    ['https://example.com/action']
  );
});

test('storeMessage persists structured data for codes and links', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  const raw = Buffer.from(
    'From: noreply@example.com\nTo: user@example.com\nSubject: Code 123456\n\nClick https://example.com/login and enter 123456\n'
  );

  const record = await storage.storeMessage(
    'user@example.com',
    {
      mailFrom: { address: 'noreply@example.com' },
      rcptTo: [{ address: 'user@example.com' }]
    },
    raw
  );
  const message = await storage.getMessage('user@example.com', record.id);

  assert.deepEqual(
    message.structuredData.items.map((item) => [item.type, item.value]),
    [
      ['verification_code', '123456'],
      ['link', 'https://example.com/login']
    ]
  );
});

test('backfillStructuredData recalculates historical structured data', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  pool.state.mailboxes.set('user@example.com', { email: 'user@example.com' });
  pool.state.messages.push({
    id: 'historical',
    mailbox: 'user@example.com',
    stored_at: '2024-05-01T00:00:00.000Z',
    mail_from: 'noreply@example.com',
    rcpt_to: ['user@example.com'],
    subject: 'Code 257535',
    sender: [{ address: 'noreply@example.com', name: '' }],
    recipient: [{ address: 'user@example.com', name: '' }],
    cc: [],
    bcc: [],
    message_date: null,
    text_content: 'Use 257535 and open https://example.com/action. Ignore https://example.com/logo.png',
    html_content: null,
    headers: {},
    attachments: [],
    structured_data: { version: 1, items: [] },
    raw_content: 'old raw'
  });

  const result = await storage.backfillStructuredData({ mailbox: 'user@example.com' });
  const message = await storage.getMessage('user@example.com', 'historical');

  assert.deepEqual(result, {
    mailbox: 'user@example.com',
    scanned: 1,
    updated: 1
  });
  assert.deepEqual(
    message.structuredData.items.map((item) => [item.type, item.value]),
    [
      ['verification_code', '257535'],
      ['link', 'https://example.com/action']
    ]
  );
});

test('backfillStructuredData can process all mailboxes', async () => {
  const pool = createPoolMock();
  const storage = createStorage('postgres://example', { pool });
  await storage.init();

  pool.state.messages.push(
    {
      id: 'a',
      mailbox: 'a@example.com',
      stored_at: '2024-05-01T00:00:00.000Z',
      mail_from: 'sender@example.com',
      rcpt_to: ['a@example.com'],
      subject: 'Code 111111',
      sender: [{ address: 'sender@example.com', name: '' }],
      recipient: [{ address: 'a@example.com', name: '' }],
      cc: [],
      bcc: [],
      message_date: null,
      text_content: 'Use 111111',
      html_content: null,
      headers: {},
      attachments: [],
      structured_data: { version: 1, items: [] },
      raw_content: 'raw'
    },
    {
      id: 'b',
      mailbox: 'b@example.com',
      stored_at: '2024-05-02T00:00:00.000Z',
      mail_from: 'sender@example.com',
      rcpt_to: ['b@example.com'],
      subject: 'Code 222222',
      sender: [{ address: 'sender@example.com', name: '' }],
      recipient: [{ address: 'b@example.com', name: '' }],
      cc: [],
      bcc: [],
      message_date: null,
      text_content: 'Use 222222',
      html_content: null,
      headers: {},
      attachments: [],
      structured_data: { version: 1, items: [] },
      raw_content: 'raw'
    }
  );

  const result = await storage.backfillStructuredData();

  assert.deepEqual(result, {
    mailbox: 'all',
    scanned: 2,
    updated: 2
  });
});
