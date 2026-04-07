const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runSchema() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    const schemaSql = fs.readFileSync(path.join(__dirname, 'src', 'db', 'schema.sql'), 'utf-8');
    await client.query(schemaSql);
    console.log('Schema applied successfully.');
  } catch (err) {
    console.error('Error applying schema:', err);
  } finally {
    await client.end();
  }
}

runSchema();
