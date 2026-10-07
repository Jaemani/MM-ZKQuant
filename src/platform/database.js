import pg from 'pg';

export class PlatformDatabase {
  constructor({ databaseUrl, maxConnections = 2 }) {
    if (!databaseUrl) throw Error('DATABASE_URL is required');
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: /[?&]sslmode=(?!disable)/.test(databaseUrl) ? { rejectUnauthorized: false } : false,
      max: maxConnections,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });
    this.pool.on('error', error => console.error('PLATFORM_DATABASE_IDLE_ERROR', error.code || 'CONNECTION_ERROR'));
  }

  query(text, values = []) { return this.pool.query(text, values); }

  async transaction(run) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  close() { return this.pool.end(); }
}
