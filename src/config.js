import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.join(__dirname, '..');

export function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return {};
  }

  const raw = fsSync.readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export function createConfig(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const envFilePath = options.envFilePath || path.join(rootDir, '.env');
  const localEnv = options.localEnv || loadEnvFile(envFilePath);
  const processEnv = options.processEnv || process.env;

  function env(name, fallback = '') {
    if (processEnv[name] !== undefined) {
      return processEnv[name];
    }

    if (localEnv[name] !== undefined) {
      return localEnv[name];
    }

    return fallback;
  }

  function resolveFromRoot(value, fallback) {
    const resolvedValue = value || fallback;

    if (path.isAbsolute(resolvedValue)) {
      return resolvedValue;
    }

    return path.resolve(rootDir, resolvedValue);
  }

  function envList(name) {
    return env(name, '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return {
    rootDir,
    envFilePath,
    httpPort: Number(env('HTTP_PORT', '3000')),
    smtpPort: Number(env('SMTP_PORT', '2525')),
    smtpHost: env('SMTP_HOST', '0.0.0.0'),
    httpHost: env('HTTP_HOST', '0.0.0.0'),
    apiKey: env('API_KEY', ''),
    databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@127.0.0.1:5432/mail_service'),
    dataDir: resolveFromRoot(env('DATA_DIR', ''), 'data'),
    allowedRecipients: envList('ALLOWED_RECIPIENTS')
  };
}
