import { randomUUID } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { Pool } from 'pg';
import { extractStructuredData, normalizeStructuredData } from './structured.js';

export function createMessageId() {
  return randomUUID();
}

export function serializeHeaders(headers) {
  const result = {};

  for (const [key, value] of headers.entries()) {
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      continue;
    }

    if (value instanceof Date) {
      result[key] = value.toISOString();
      continue;
    }

    try {
      result[key] = JSON.parse(JSON.stringify(value));
    } catch {
      result[key] = String(value);
    }
  }

  return result;
}

export function pickText(parsed) {
  if (parsed.text) {
    return parsed.text;
  }

  if (parsed.html) {
    return String(parsed.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return '';
}

export function normalizeAllowlistEntry(value = '') {
  return String(value).trim().toLowerCase().replace(/^@+/, '');
}

export function recipientAllowlistKeys(address = '') {
  const normalizedAddress = normalizeAllowlistEntry(address);
  const atIndex = normalizedAddress.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === normalizedAddress.length - 1) {
    return [normalizedAddress].filter(Boolean);
  }

  return [
    normalizedAddress,
    normalizedAddress.slice(atIndex + 1)
  ];
}

export function createStorage(databaseUrl, options = {}) {
  const pool = options.pool || new Pool({
    connectionString: databaseUrl
  });

  async function query(text, params = []) {
    return pool.query(text, params);
  }

  async function init() {
    await query(`
      CREATE TABLE IF NOT EXISTS mailboxes (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        mailbox TEXT NOT NULL REFERENCES mailboxes(email) ON DELETE CASCADE,
        stored_at TIMESTAMPTZ NOT NULL,
        mail_from TEXT,
        rcpt_to JSONB NOT NULL,
        subject TEXT NOT NULL,
        sender JSONB NOT NULL,
        recipient JSONB NOT NULL,
        cc JSONB NOT NULL,
        bcc JSONB NOT NULL,
        message_date TIMESTAMPTZ,
        text_content TEXT NOT NULL,
        html_content TEXT,
        headers JSONB NOT NULL,
        attachments JSONB NOT NULL,
        structured_data JSONB NOT NULL DEFAULT '{"version":1,"items":[]}'::jsonb,
        raw_content TEXT NOT NULL
      )
    `);

    await query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS structured_data JSONB NOT NULL DEFAULT '{"version":1,"items":[]}'::jsonb
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_messages_mailbox_stored_at
      ON messages (mailbox, stored_at DESC)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_messages_mail_from
      ON messages (mail_from)
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS recipient_allowlist (
        entry TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async function ensureMailbox(mailbox) {
    await query(
      `
        INSERT INTO mailboxes (email)
        VALUES ($1)
        ON CONFLICT (email) DO NOTHING
      `,
      [mailbox]
    );
  }

  async function storeMessage(recipient, envelope, raw) {
    const parsed = await simpleParser(raw);
    const mailbox = recipient.toLowerCase();
    const id = createMessageId();
    const storedAt = new Date().toISOString();
    const record = {
      id,
      mailbox,
      storedAt,
      envelope: {
        mailFrom: envelope.mailFrom?.address || null,
        rcptTo: envelope.rcptTo?.map((item) => item.address) || []
      },
      subject: parsed.subject || '',
      from: parsed.from?.value || [],
      to: parsed.to?.value || [],
      cc: parsed.cc?.value || [],
      bcc: parsed.bcc?.value || [],
      date: parsed.date ? parsed.date.toISOString() : null,
      text: pickText(parsed),
      html: parsed.html ? String(parsed.html) : null,
      headers: serializeHeaders(parsed.headers),
      attachments: (parsed.attachments || []).map((attachment) => ({
        filename: attachment.filename || null,
        contentType: attachment.contentType,
        size: attachment.size
      })),
      raw: raw.toString('utf8')
    };
    record.structuredData = extractStructuredData({
      subject: record.subject,
      text: record.text,
      html: record.html
    });

    await ensureMailbox(mailbox);
    await query(
      `
        INSERT INTO messages (
          id, mailbox, stored_at, mail_from, rcpt_to, subject,
          sender, recipient, cc, bcc, message_date,
          text_content, html_content, headers, attachments, structured_data, raw_content
        )
        VALUES (
          $1, $2, $3, $4, $5::jsonb, $6,
          $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11,
          $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17
        )
      `,
      [
        record.id,
        record.mailbox,
        record.storedAt,
        record.envelope.mailFrom,
        JSON.stringify(record.envelope.rcptTo),
        record.subject,
        JSON.stringify(record.from),
        JSON.stringify(record.to),
        JSON.stringify(record.cc),
        JSON.stringify(record.bcc),
        record.date,
        record.text,
        record.html,
        JSON.stringify(record.headers),
        JSON.stringify(record.attachments),
        JSON.stringify(record.structuredData),
        record.raw
      ]
    );

    return record;
  }

  async function listMailboxes() {
    const result = await query(
      `
        SELECT email
        FROM mailboxes
        ORDER BY email ASC
      `
    );

    return result.rows.map((row) => row.email);
  }

  async function seedRecipientAllowlist(entries = []) {
    for (const entry of entries) {
      await addRecipientAllowlistEntry(entry);
    }
  }

  async function listRecipientAllowlist() {
    const result = await query(
      `
        SELECT entry, created_at
        FROM recipient_allowlist
        ORDER BY entry ASC
      `
    );

    return result.rows.map((row) => ({
      entry: row.entry,
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  async function addRecipientAllowlistEntry(entry) {
    const normalizedEntry = normalizeAllowlistEntry(entry);

    if (!normalizedEntry) {
      return null;
    }

    const result = await query(
      `
        INSERT INTO recipient_allowlist (entry)
        VALUES ($1)
        ON CONFLICT (entry) DO UPDATE SET entry = EXCLUDED.entry
        RETURNING entry, created_at
      `,
      [normalizedEntry]
    );

    const row = result.rows[0];
    return {
      entry: row.entry,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  async function removeRecipientAllowlistEntry(entry) {
    const normalizedEntry = normalizeAllowlistEntry(entry);

    if (!normalizedEntry) {
      return false;
    }

    const result = await query(
      `
        DELETE FROM recipient_allowlist
        WHERE entry = $1
      `,
      [normalizedEntry]
    );

    return result.rowCount > 0;
  }

  async function isRecipientAllowed(address) {
    const keys = recipientAllowlistKeys(address);

    if (keys.length === 0) {
      return false;
    }

    const result = await query(
      `
        SELECT 1
        FROM recipient_allowlist
        WHERE entry = ANY($1::text[])
        LIMIT 1
      `,
      [keys]
    );

    return result.rowCount > 0;
  }

  function normalizeListOptions(options = {}) {
    const parsedLimit = Number(options.limit || 20);
    const parsedOffset = Number(options.offset || 0);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const offset = Number.isFinite(parsedOffset) ? parsedOffset : 0;

    return {
      limit: Math.max(1, Math.min(limit, 100)),
      offset: Math.max(0, offset),
      sender: options.sender ? String(options.sender).trim().toLowerCase() : '',
      keyword: options.keyword ? String(options.keyword).trim() : '',
      since: options.since || null,
      until: options.until || null
    };
  }

  async function listMessagesByWhere({ conditions, params, filters }) {
    const whereClause = conditions.join(' AND ');
    const countParams = [...params];
    const countResult = await query(
      `
        SELECT COUNT(*) AS total
        FROM messages
        WHERE ${whereClause}
      `,
      countParams
    );

    const listParams = [...params, filters.limit, filters.offset];
    const limitParam = listParams.length - 1;
    const offsetParam = listParams.length;
    const listResult = await query(
      `
        SELECT id, mailbox, stored_at, subject, sender, recipient, message_date, text_content
        FROM messages
        WHERE ${whereClause}
        ORDER BY stored_at DESC
        LIMIT $${limitParam}
        OFFSET $${offsetParam}
      `,
      listParams
    );

    return {
      total: Number(countResult.rows[0]?.total || 0),
      limit: filters.limit,
      offset: filters.offset,
      messages: listResult.rows.map((row) => ({
        id: row.id,
        mailbox: row.mailbox,
        storedAt: new Date(row.stored_at).toISOString(),
        subject: row.subject,
        from: row.sender,
        to: row.recipient,
        date: row.message_date ? new Date(row.message_date).toISOString() : null,
        textPreview: String(row.text_content || '').slice(0, 160)
      }))
    };
  }

  function appendMessageFilters({ conditions, params, filters }) {
    let paramIndex = params.length + 1;

    if (filters.sender) {
      conditions.push(`LOWER(COALESCE(mail_from, '')) LIKE $${paramIndex}`);
      params.push(`%${filters.sender}%`);
      paramIndex += 1;
    }

    if (filters.keyword) {
      conditions.push(`(subject ILIKE $${paramIndex} OR text_content ILIKE $${paramIndex})`);
      params.push(`%${filters.keyword}%`);
      paramIndex += 1;
    }

    if (filters.since) {
      conditions.push(`stored_at >= $${paramIndex}`);
      params.push(filters.since);
      paramIndex += 1;
    }

    if (filters.until) {
      conditions.push(`stored_at <= $${paramIndex}`);
      params.push(filters.until);
    }
  }

  async function listMessages(mailbox, options = {}) {
    const normalizedMailbox = mailbox.toLowerCase();
    const filters = normalizeListOptions(options);

    const mailboxResult = await query(
      `
        SELECT 1
        FROM mailboxes
        WHERE email = $1
      `,
      [normalizedMailbox]
    );

    if (mailboxResult.rowCount === 0) {
      return null;
    }

    const conditions = ['mailbox = $1'];
    const params = [normalizedMailbox];
    appendMessageFilters({ conditions, params, filters });

    return listMessagesByWhere({ conditions, params, filters });
  }

  async function listAllMessages(options = {}) {
    const filters = normalizeListOptions(options);
    const conditions = ['TRUE'];
    const params = [];
    appendMessageFilters({ conditions, params, filters });

    return listMessagesByWhere({ conditions, params, filters });
  }

  async function getMessage(mailbox, id) {
    const result = await query(
      `
        SELECT
          id, mailbox, stored_at, mail_from, rcpt_to, subject,
          sender, recipient, cc, bcc, message_date,
          text_content, html_content, headers, attachments, structured_data, raw_content
        FROM messages
        WHERE mailbox = $1 AND id = $2
        LIMIT 1
      `,
      [mailbox.toLowerCase(), id]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];

    return {
      id: row.id,
      mailbox: row.mailbox,
      storedAt: new Date(row.stored_at).toISOString(),
      envelope: {
        mailFrom: row.mail_from,
        rcptTo: row.rcpt_to
      },
      subject: row.subject,
      from: row.sender,
      to: row.recipient,
      cc: row.cc,
      bcc: row.bcc,
      date: row.message_date ? new Date(row.message_date).toISOString() : null,
      text: row.text_content,
      html: row.html_content,
      headers: row.headers,
      attachments: row.attachments,
      structuredData: normalizeStructuredData(row.structured_data),
      raw: row.raw_content
    };
  }

  async function backfillStructuredData(options = {}) {
    const mailbox = options.mailbox ? String(options.mailbox).trim().toLowerCase() : '';
    const params = [];
    const whereClause = mailbox ? 'WHERE mailbox = $1' : '';

    if (mailbox) {
      params.push(mailbox);
    }

    const result = await query(
      `
        SELECT id, mailbox, subject, text_content, html_content
        FROM messages
        ${whereClause}
        ORDER BY stored_at ASC
      `,
      params
    );

    let updated = 0;

    for (const row of result.rows) {
      const structuredData = extractStructuredData({
        subject: row.subject,
        text: row.text_content,
        html: row.html_content
      });
      const updateResult = await query(
        `
          UPDATE messages
          SET structured_data = $1::jsonb
          WHERE id = $2
        `,
        [JSON.stringify(structuredData), row.id]
      );
      updated += updateResult.rowCount || 0;
    }

    return {
      mailbox: mailbox || 'all',
      scanned: result.rowCount,
      updated
    };
  }

  async function close() {
    if (typeof pool.end === 'function') {
      await pool.end();
    }
  }

  return {
    query,
    init,
    storeMessage,
    listMailboxes,
    seedRecipientAllowlist,
    listRecipientAllowlist,
    addRecipientAllowlistEntry,
    removeRecipientAllowlistEntry,
    isRecipientAllowed,
    listMessages,
    listAllMessages,
    getMessage,
    backfillStructuredData,
    close
  };
}
