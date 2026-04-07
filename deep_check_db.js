const { Client } = require('pg');
require('dotenv').config();

async function checkData() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    const result = await client.query('SELECT plant_name, scientific_name, cleaned_data, raw_data FROM plant_data WHERE plant_name ILIKE $1', ['%Bridelia%']);
    
    if (result.rows.length > 0) {
       const row = result.rows[0];
       console.log('--- RECORD FOUND ---');
       console.log('Plant Name:', row.plant_name);
       console.log('Scientific Name:', row.scientific_name);
       console.log('Cleaned Data (shortened):', JSON.stringify(row.cleaned_data).substring(0, 500));
       console.log('Raw Data Type:', typeof row.raw_data);
       console.log('Are they identical?', JSON.stringify(row.cleaned_data) === JSON.stringify(row.raw_data));
    } else {
       console.log('No record found.');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

checkData();
