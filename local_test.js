require('dotenv').config();
const { identifyPlant } = require('./src/services/plantnet');
const { fetchPreludeData } = require('./src/services/prelude');
const { fetchPfafData } = require('./src/services/pfaf');
const { normalizePlantName } = require('./src/services/mpns');

const fs = require('fs');

async function test() {
  const images = fs.readdirSync('./TestImages').filter(file => file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.webp'));

  for (const img of images) {
    const imgPath = `./TestImages/${img}`;
    console.log(`\n--- Testing image: ${imgPath} ---`);
    try {
      const identified = await identifyPlant(imgPath);
      console.log(`[PlantNet] Identified: ${identified.name} (${identified.scientificName})`);
      
      const normalized = await normalizePlantName(identified.scientificName || identified.name);
      console.log(`[MPNS] Normalized:`, normalized);
      
      const prelude = await fetchPreludeData(identified.scientificName || identified.name);
      console.log(`[Prelude] Data:\n`, prelude ? JSON.stringify(prelude, null, 2) : 'None');
      
      const pfaf = await fetchPfafData(normalized.resolvedName);
      console.log(`[PFAF] Data:\n`, pfaf ? JSON.stringify(pfaf, null, 2) : 'None');
    } catch (e) {
      console.log(`[Error]`, e.message);
    }
  }
}

test();
