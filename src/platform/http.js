import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlatformDatabase } from './database.js';
import { PlatformService } from './service.js';
import { handlePlatformRequest } from './handler.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const environment = () => {
  const values = { ...process.env };
  try {
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && !values[match[1]]) values[match[1]] = match[2].trim();
    }
  } catch { /* deployment supplies environment variables */ }
  return values;
};
export function makePlatformServer(service, options = {}) {
  return createServer((request, response) => handlePlatformRequest(request, response, service, options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = environment(), port = Number(config.PORT || 8789);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT must be an integer from 1024 to 65535');
  const database = new PlatformDatabase({ databaseUrl: config.DATABASE_URL });
  const server = makePlatformServer(new PlatformService(database, { teeEndpoint: config.PLATFORM_TEE_URL, teeEncryptionPublicKey: config.PLATFORM_TEE_ENCRYPTION_PUBLIC_KEY }), { origin: config.PLATFORM_ORIGIN });
  server.listen(port, '0.0.0.0', () => console.log(`MM-ZKQuant platform API listening on ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => database.close().finally(() => process.exit(0))));
}
