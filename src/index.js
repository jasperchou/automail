import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { SMTPServer } from 'smtp-server';
import { createConfig } from './config.js';
import { createRoute } from './http.js';
import { createStorage } from './storage.js';

const config = createConfig();
const storage = createStorage(config.databaseUrl);

async function main() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await storage.init();
  await storage.seedRecipientAllowlist(config.allowedRecipients);

  const smtpServer = new SMTPServer({
    disabledCommands: ['AUTH'],
    authOptional: true,
    banner: 'Simple Mail Service',
    onRcptTo(address, _session, callback) {
      if (!address.address) {
        return callback(new Error('Invalid recipient'));
      }

      storage.isRecipientAllowed(address.address)
        .then((allowed) => {
          if (!allowed) {
            const error = new Error('Recipient not allowed');
            error.responseCode = 550;
            return callback(error);
          }
          callback();
        })
        .catch(callback);
    },
    onData(stream, session, callback) {
      const chunks = [];

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', async () => {
        try {
          const raw = Buffer.concat(chunks);
          const recipients = session.envelope.rcptTo.map((item) => item.address);

          for (const recipient of recipients) {
            await storage.storeMessage(recipient, session.envelope, raw);
          }

          callback(null, 'Message accepted');
        } catch (error) {
          callback(error);
        }
      });
      stream.on('error', callback);
    }
  });

  smtpServer.listen(config.smtpPort, config.smtpHost, () => {
    console.log(`SMTP listening on ${config.smtpHost}:${config.smtpPort}`);
  });

  const httpServer = createServer(createRoute({ config, storage }));
  httpServer.listen(config.httpPort, config.httpHost, () => {
    console.log(`HTTP listening on ${config.httpHost}:${config.httpPort}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
