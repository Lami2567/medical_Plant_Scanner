const { Client } = require('pg');
const { cleanPlantData } = require('./src/services/aiCleaner');
require('dotenv').config();

async function debug() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    const result = await client.query('SELECT plant_name, raw_data FROM plant_data WHERE plant_name ILIKE $1', ['%Bridelia%']);
    
    if (result.rows.length === 0) {
      console.log('No Bridelia found in DB');
      return;
    }

    const { plant_name, raw_data } = result.rows[0];
    const rawText = raw_data?.rawData || JSON.stringify(raw_data);
    
    console.log(`Debugging cleaning for ${plant_name}...`);
    console.log(`Raw text length: ${rawText.length} chars`);
    
    const cleaned = await cleanPlantData(rawText);
    if (cleaned) {
      console.log('✅ CLEANING SUCCESSFUL LOCALLY:');
      console.log(JSON.stringify(cleaned, null, 2));
    } else {
      console.log('❌ CLEANING FAILED LOCALLY');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

debug();
