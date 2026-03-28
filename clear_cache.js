require('dotenv').config();
const pool = require('./src/db/postgres');

async function clearCache() {
  try {
    await pool.query('DELETE FROM plants');
    console.log('Database cache cleared successfully!');
  } catch (err) {
    console.error('Error clearing cache:', err);
  } finally {
    process.exit(0);
  }
}

clearCache();
