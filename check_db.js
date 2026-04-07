const { Client } = require('pg');
require('dotenv').config();

async function checkData() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    const result = await client.query('SELECT plant_name, cleaned_data FROM plant_data WHERE plant_name ILIKE $1', ['%Bridelia%']);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

checkData();
