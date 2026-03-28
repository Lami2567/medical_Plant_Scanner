const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes Prelude Medicinal Plants Database (via Ethnopharmacologia).
 * Prelude is a major repository of ethnomedicinal data from Africa.
 */
async function fetchPreludeData(scientificName) {
  try {
    const query = scientificName;
    console.log(`[Prelude] Searching for: ${scientificName}`);
    
    // 1. Fetch autocomplete ID
    const params = new URLSearchParams();
    params.append('term', query);
    params.append('action', 'getplantname');
    params.append('prelude', 'yes');
    
    let plantId = null;
    try {
      const cbUrl = `https://www.ethnopharmacologia.org/recherche-dans-prelude/?callback=cb`;
      const { data } = await axios.post(cbUrl, params.toString(), {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
      });

      const match = data.match(/cb\((.*)\)/);
      if (match && match[1]) {
        const json = JSON.parse(match[1]);
        if (json && json.item && json.item.length > 0) {
          const rawId = json.item[0].id; // e.g. "plantnametag--949"
          const digitsMatch = rawId.match(/\d+/);
          if (digitsMatch) {
            plantId = digitsMatch[0];
          }
        }
      }
    } catch(e) {
      console.warn(`[Prelude] Autocomplete API error for ${scientificName}: ${e.message}`);
      return null;
    }
    
    if (!plantId) {
      console.log(`[Prelude] No exact ID found for: ${scientificName}`);
      return null;
    }
    
    console.log(`[Prelude] Mapped ${scientificName} to ID: ${plantId}`);
    
    // 2. Fetch Detail Page
    const detailUrl = `https://www.ethnopharmacologia.org/recherche-dans-prelude/?plant_id=${plantId}`;
    const { data: detailHtml } = await axios.get(detailUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    
    const $ = cheerio.load(detailHtml);
    let treatments = '';
    
    $('.plant-reference-recipe strong').each((i, el) => {
      let text = $(el).text().trim();
      if (text) {
        text = text.replace(/<br\s*\/?>/gi, ' ');
        treatments += text + '\n';
      }
    });

    if (!treatments.trim()) {
      return null;
    }
    
    return {
      source: 'Prelude Medicinal Plants Database',
      trust_score: 0.9,
      url: detailUrl,
      medicinal_uses: treatments.trim(),
      raw_data: treatments.trim()
    };
  } catch (err) {
    console.error('[Prelude ERROR]', err.message);
    return null;
  }
}

module.exports = { fetchPreludeData };
