import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlatformDatabase } from '../src/platform/database.js';
import { databaseUrl } from '../src/platform/environment.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const values = { ...process.env };
try { for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) { const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); if (match && !values[match[1]]) values[match[1]] = match[2].trim(); } } catch {}
const database = new PlatformDatabase({ databaseUrl: databaseUrl(values) });
try {
  await database.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const existing = await database.query("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') AS exists");
  if (existing.rows[0].exists) await database.query("INSERT INTO schema_migrations(id) VALUES('001_e2e_platform.sql') ON CONFLICT DO NOTHING");
  for (const file of readdirSync(resolve(root, 'db/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    const applied = await database.query('SELECT 1 FROM schema_migrations WHERE id=$1', [file]);
    if (!applied.rows[0]) {
      await database.query(readFileSync(resolve(root, 'db/migrations', file), 'utf8'));
      await database.query('INSERT INTO schema_migrations(id) VALUES($1)', [file]);
    }
  }
  console.log('Platform migrations applied');
} finally { await database.close(); }
