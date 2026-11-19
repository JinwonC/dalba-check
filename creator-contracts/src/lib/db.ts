import { Pool, type QueryResultRow } from "pg";

const g = globalThis as unknown as { __pool?: Pool };

function pool(): Pool {
  if (!g.__pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const local = /localhost|127\.0\.0\.1/.test(url);
    g.__pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: local ? false : { rejectUnauthorized: false },
    });
  }
  return g.__pool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params);
  return res.rows;
}
