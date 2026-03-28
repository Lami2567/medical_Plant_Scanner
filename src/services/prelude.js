const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes Prelude Medicinal Plants Database (via Ethnopharmacologia).
 * Prelude is a major repository of ethnomedicinal data from Africa.
 */
async function fetchPreludeData(scientificName) {
  try {
    const query = encodeURIComponent(scientificName);
    // Prelude search on Ethnopharmacologia
    const searchUrl = `https://www.ethnopharmacologia.org/recherche-dans-prelude/?preludesearch=set&_pt[]=${query}`;
    
    console.log(`[Prelude] Searching for: ${scientificName}`);
    
    const { data: searchHtml } = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'MedPlantScanner/1.0' },
      timeout: 10000
    });
    
    const $ = cheerio.load(searchHtml);
    
    // Prelude results are often a list of symptoms and preparations.
    // We'll extract the main table or list of medicinal uses.
    let content = '';
    
    // Look for symptom table or preparation list
    $('.prelude-results, .entry-content table').each((i, el) => {
      content += $(el).text() + '\n';
    });
    
    if (!content.trim()) {
      // Fallback: search main site
      const fallbackUrl = `https://www.ethnopharmacologia.org/?s=${query}`;
      const { data: fallbackHtml } = await axios.get(fallbackUrl);
      const $f = cheerio.load(fallbackHtml);
      content = $f('.entry-content').text().substring(0, 2000);
    }

    return {
      source: 'Prelude Medicinal Plants Database',
      trust_score: 0.9,
      url: searchUrl,
      medicinal_uses: content.trim(),
      raw_data: content.trim()
    };
  } catch (err) {
    console.error('[Prelude ERROR]', err.message);
    return null;
  }
}

module.exports = { fetchPreludeData };
