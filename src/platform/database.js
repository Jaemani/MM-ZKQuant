import pg from 'pg';

export class PlatformDatabase {
  constructor({ databaseUrl }) {
    if (!databaseUrl) throw Error('DATABASE_URL is required');
    this.pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 10 });
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
