const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes medicinal information from Plants For A Future (pfaf.org).
 * PFAF is a highly authoritative source for edible and medicinal plants.
 */
async function fetchPfafData(scientificName) {
  try {
    const query = scientificName.replace(' ', '+');
    const url = `https://pfaf.org/user/Plant.aspx?LatinName=${query}`;
    
    console.log(`[PFAF] Fetching data for: ${scientificName}`);
    
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'MedPlantScanner/1.0 (contact@example.com)' },
      timeout: 10000
    });
    
    const $ = cheerio.load(data);
    
    // Extract medicinal uses
    let medicinalContent = $('#ContentPlaceHolder1_txtMediUses').text().trim();
    // Remove the standard PFAF disclaimer if present
    medicinalContent = medicinalContent.replace('Plants For A Future can not take any responsibility for any adverse effects from the use of plants. Always seek advice from a professional before using a plant medicinally.', '').trim();
    
    // Extract edible uses
    const edibleContent = $('#ContentPlaceHolder1_txtEdibleUses').text().trim();
    
    // Extract other uses
    const otherContent = $('#ContentPlaceHolder1_txtOtherUses').text().trim();

    return {
      source: 'Plants For A Future (PFAF)',
      trust_score: 0.8,
      url: url,
      medicinal_uses: medicinalContent,
      edible_uses: edibleContent,
      other_uses: otherContent,
      raw_data: medicinalContent + ' ' + edibleContent
    };
  } catch (err) {
    console.error('[PFAF ERROR]', err.message);
    return null;
  }
}

module.exports = { fetchPfafData };
