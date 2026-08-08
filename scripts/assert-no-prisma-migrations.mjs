import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query("SELECT to_regclass('public._prisma_migrations') IS NULL AS absent");
  if (!result.rows[0]?.absent) throw new Error('_prisma_migrations exists after refused adoption');
} finally {
  await client.end();
}
