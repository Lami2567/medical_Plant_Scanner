const { Client } = require('pg');
require('dotenv').config();

async function truncateDB() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    await client.query('TRUNCATE TABLE plant_data');
    console.log('Truncated plant_data.');
  } catch (err) {
    console.error('Error truncating:', err);
  } finally {
    await client.end();
  }
}

truncateDB();
