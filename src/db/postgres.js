const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon requires SSL. Use rejectUnauthorized: false for convenience in development,
  // or configure CA certs for production.
  ssl: process.env.DATABASE_URL?.includes('neon.tech') || process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS image_url TEXT').catch(
  (err) => {
    console.error('[DB] Failed to ensure scans.image_url column:', err.message);
  }
);

module.exports = pool;
