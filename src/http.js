export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type, x-api-key',
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload, null, 2));
}

export function sendNoContent(res) {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type, x-api-key',
    'access-control-max-age': '86400'
  });
  res.end();
}

export function createRoute({ config, storage }) {
  function parsePositiveInt(value, fallback) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
      return fallback;
    }

    return parsed;
  }

  function parseTimestamp(value) {
    if (!value) {
      return null;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    const milliseconds = trimmed.length <= 10 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }

  function notFound(res, message = 'Not found') {
    sendJson(res, 404, { error: message });
  }

  function unauthorized(res) {
    sendJson(res, 401, { error: 'Unauthorized' });
  }

  function isAuthorized(req, url) {
    if (!config.apiKey) {
      return true;
    }

    const headerKey = req.headers['x-api-key'];
    const queryKey = url.searchParams.get('api_key');

    return headerKey === config.apiKey || queryKey === config.apiKey;
  }

  return function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const parts = pathname.split('/').filter(Boolean);

    if (req.method === 'OPTIONS') {
      return sendNoContent(res);
    }

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        smtp: { host: config.smtpHost, port: config.smtpPort },
        http: { host: config.httpHost, port: config.httpPort }
      });
    }

    if (req.method === 'GET' && pathname === '/mailboxes') {
      if (!isAuthorized(req, url)) {
        return unauthorized(res);
      }

      return storage.listMailboxes()
        .then((mailboxes) => sendJson(res, 200, { mailboxes }))
        .catch((error) => {
          console.error(error);
          sendJson(res, 500, { error: 'Failed to list mailboxes' });
        });
    }

    if (req.method === 'GET' && pathname === '/messages') {
      if (!isAuthorized(req, url)) {
        return unauthorized(res);
      }

      const mailbox = url.searchParams.get('mailbox');
      const limit = parsePositiveInt(url.searchParams.get('limit'), 20);
      const offset = parsePositiveInt(url.searchParams.get('offset'), 0);
      const sender = url.searchParams.get('sender') || '';
      const keyword = url.searchParams.get('keyword') || '';
      const since = parseTimestamp(url.searchParams.get('since'));
      const until = parseTimestamp(url.searchParams.get('until'));

      if (!mailbox) {
        return sendJson(res, 400, { error: 'mailbox query param is required' });
      }

      const listMessages = mailbox.toLowerCase() === 'all'
        ? storage.listAllMessages({ limit, offset, sender, keyword, since, until })
        : storage.listMessages(mailbox, { limit, offset, sender, keyword, since, until });

      return listMessages
        .then((result) => {
          if (!result) {
            return notFound(res, 'Mailbox not found');
          }
          sendJson(res, 200, {
            mailbox,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
            sender,
            keyword,
            since,
            until,
            messages: result.messages
          });
        })
        .catch((error) => {
          console.error(error);
          sendJson(res, 500, { error: 'Failed to list messages' });
        });
    }

    if (req.method === 'GET' && parts[0] === 'messages' && parts[1]) {
      if (!isAuthorized(req, url)) {
        return unauthorized(res);
      }

      const mailbox = url.searchParams.get('mailbox');
      const id = parts[1];

      if (!mailbox) {
        return sendJson(res, 400, { error: 'mailbox query param is required' });
      }

      return storage.getMessage(mailbox, id)
        .then((message) => {
          if (!message) {
            return notFound(res, 'Message not found');
          }
          sendJson(res, 200, message);
        })
        .catch((error) => {
          console.error(error);
          sendJson(res, 500, { error: 'Failed to get message' });
        });
    }

    notFound(res);
  };
}
