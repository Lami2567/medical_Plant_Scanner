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

async function ensureScanColumns() {
  try {
    await pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS image_url TEXT');
    await pool.query(
      "ALTER TABLE scans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success'"
    );
    await pool.query("UPDATE scans SET status = 'success' WHERE status IS NULL");
    await pool.query("ALTER TABLE scans ALTER COLUMN status SET DEFAULT 'success'");
    await pool.query("ALTER TABLE scans ALTER COLUMN status SET NOT NULL");
    await pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS error_message TEXT');
    await pool.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_scans_status ON scans (status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans (created_at)');
  } catch (err) {
    console.error('[DB] Failed to ensure scan admin columns:', err.message);
  }
}

ensureScanColumns();

module.exports = pool;
