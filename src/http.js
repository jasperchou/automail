export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-api-key',
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload, null, 2));
}

export function sendNoContent(res) {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-api-key',
    'access-control-max-age': '86400'
  });
  res.end();
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
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

  function getRequestApiKey(req, url) {
    const headerKey = req.headers['x-api-key'];
    const queryKey = url.searchParams.get('api_key');

    return Array.isArray(headerKey) ? headerKey[0] : headerKey || queryKey || '';
  }

  async function isAuthorized(req, url) {
    const requestKey = getRequestApiKey(req, url);

    if (typeof storage.isApiKeyAllowed === 'function' && typeof storage.hasActiveApiKeys === 'function') {
      if (await storage.hasActiveApiKeys()) {
        return storage.isApiKeyAllowed(requestKey);
      }
    }

    if (!config.apiKey) {
      return true;
    }

    return requestKey === config.apiKey;
  }

  function requireAuth(req, res, url, handler) {
    return isAuthorized(req, url)
      .then((authorized) => {
        if (!authorized) {
          return unauthorized(res);
        }

        return handler();
      })
      .catch((error) => {
        console.error(error);
        sendJson(res, 500, { error: 'Failed to authorize request' });
      });
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
      return requireAuth(req, res, url, () => (
        storage.listMailboxes()
          .then((mailboxes) => sendJson(res, 200, { mailboxes }))
          .catch((error) => {
            console.error(error);
            sendJson(res, 500, { error: 'Failed to list mailboxes' });
          })
      ));
    }

    if (pathname === '/api-keys') {
      return requireAuth(req, res, url, () => {
        if (req.method === 'GET') {
          return storage.listApiKeys()
            .then((keys) => sendJson(res, 200, { keys }))
            .catch((error) => {
              console.error(error);
              sendJson(res, 500, { error: 'Failed to list api keys' });
            });
        }

        if (req.method === 'POST') {
          return readJsonBody(req)
            .then((body) => {
              if (!body.key) {
                sendJson(res, 400, { error: 'key is required' });
                return null;
              }

              return storage.addApiKey(body.key, { label: body.label });
            })
            .then((key) => {
              if (key) {
                sendJson(res, 201, { key });
              }
            })
            .catch((error) => {
              console.error(error);
              if (error instanceof SyntaxError) {
                return sendJson(res, 400, { error: 'Invalid JSON body' });
              }
              sendJson(res, 500, { error: 'Failed to add api key' });
            });
        }

        return notFound(res);
      });
    }

    if (req.method === 'DELETE' && parts[0] === 'api-keys' && parts[1]) {
      return requireAuth(req, res, url, () => (
        storage.deactivateApiKey(parts[1])
          .then((removed) => {
            if (!removed) {
              return notFound(res, 'API key not found');
            }
            sendJson(res, 200, { removed: true });
          })
          .catch((error) => {
            console.error(error);
            sendJson(res, 500, { error: 'Failed to delete api key' });
          })
      ));
    }

    if (pathname === '/allowlist') {
      return requireAuth(req, res, url, () => {
        if (req.method === 'GET') {
          return storage.listRecipientAllowlist()
            .then((entries) => sendJson(res, 200, { entries }))
            .catch((error) => {
              console.error(error);
              sendJson(res, 500, { error: 'Failed to list allowlist' });
            });
        }

        if (req.method === 'POST') {
          return readJsonBody(req)
            .then((body) => {
              if (!body.entry) {
                sendJson(res, 400, { error: 'entry is required' });
                return null;
              }
              return storage.addRecipientAllowlistEntry(body.entry);
            })
            .then((entry) => {
              if (entry) {
                sendJson(res, 201, { entry });
              }
            })
            .catch((error) => {
              console.error(error);
              if (error instanceof SyntaxError) {
                return sendJson(res, 400, { error: 'Invalid JSON body' });
              }
              sendJson(res, 500, { error: 'Failed to add allowlist entry' });
            });
        }

        if (req.method === 'DELETE') {
          const entry = url.searchParams.get('entry');

          if (!entry) {
            return sendJson(res, 400, { error: 'entry query param is required' });
          }

          return storage.removeRecipientAllowlistEntry(entry)
            .then((removed) => {
              if (!removed) {
                return notFound(res, 'Allowlist entry not found');
              }
              sendJson(res, 200, { removed: true });
            })
            .catch((error) => {
              console.error(error);
              sendJson(res, 500, { error: 'Failed to remove allowlist entry' });
            });
        }

        return notFound(res);
      });
    }

    if (req.method === 'GET' && pathname === '/messages') {
      return requireAuth(req, res, url, () => {
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
      });
    }

    if (req.method === 'GET' && parts[0] === 'messages' && parts[1]) {
      return requireAuth(req, res, url, () => {
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
      });
    }

    notFound(res);
  };
}
