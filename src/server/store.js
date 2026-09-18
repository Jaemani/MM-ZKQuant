import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeKeys } from './crypto.js';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const keyPath = join(directory, 'operator-keys.json');
    if (!existsSync(keyPath)) writeFileSync(keyPath, JSON.stringify(makeKeys()), { mode: 0o600, flag: 'wx' });
    chmodSync(keyPath, 0o600);
    this.keys = JSON.parse(readFileSync(keyPath, 'utf8'));
    this.db = new DatabaseSync(join(directory, 'alpha.sqlite'));
    chmodSync(join(directory, 'alpha.sqlite'), 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, workspace TEXT, action TEXT NOT NULL, reason TEXT NOT NULL);');
  }
  get(workspace) { const row = this.db.prepare('SELECT state FROM workspace WHERE id=?').get(workspace); return row ? JSON.parse(row.state) : null; }
  put(workspace, state) { this.db.prepare('INSERT INTO workspace(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(workspace, JSON.stringify(state)); }
  transaction(workspace, callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const state = this.get(workspace); const result = callback(state); this.put(workspace, state); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(workspace, action, reason) { this.db.prepare('INSERT INTO audit(at,workspace,action,reason) VALUES(?,?,?,?)').run(new Date().toISOString(), workspace, action, reason); }
  close() { this.db.close(); }
}
