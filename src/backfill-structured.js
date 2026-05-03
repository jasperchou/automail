import { createConfig } from './config.js';
import { createStorage } from './storage.js';

export function parseArgs(argv) {
  const result = {
    mailbox: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--mailbox') {
      result.mailbox = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--mailbox=')) {
      result.mailbox = arg.slice('--mailbox='.length);
    }
  }

  return result;
}

async function main() {
  const config = createConfig();
  const storage = createStorage(config.databaseUrl);
  const options = parseArgs(process.argv.slice(2));

  try {
    const result = await storage.backfillStructuredData(options);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await storage.close();
  }
}

if (process.argv[1]?.endsWith('backfill-structured.js')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
