import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not defined');
    }
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }
  return pool;
}

export async function query(text: string, params?: any[]) {
  const dbPool = getPool();
  return dbPool.query(text, params);
}
