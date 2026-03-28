const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes PROTA4U (Plant Resources of Tropical Africa) database.
 * PROTA is the primary authority for African medicinal plants.
 */
async function fetchProtaData(scientificName) {
  try {
    const query = scientificName.replace(' ', '+');
    // Search URL
    const searchUrl = `https://prota.prota4u.org/searchresults.asp?allfield=${query}`;
    
    console.log(`[PROTA] Searching for: ${scientificName}`);
    
    const { data: searchHtml } = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'MedPlantScanner/1.0' },
      timeout: 10000
    });
    
    const $search = cheerio.load(searchHtml);
    
    // Find the first result link. PROTA results are often in a table or list.
    // Looking for a link that goes to protav8.asp (the article viewer)
    const firstResult = $search('a[href*="protav8.asp"]').first();
    const relativeUrl = firstResult.attr('href');
    
    if (!relativeUrl) {
      console.log(`[PROTA] No article found for: ${scientificName}`);
      return null;
    }
    
    const articleUrl = `https://prota.prota4u.org/${relativeUrl}`;
    console.log(`[PROTA] Fetching article: ${articleUrl}`);
    
    const { data: articleHtml } = await axios.get(articleUrl, {
      headers: { 'User-Agent': 'MedPlantScanner/1.0' },
      timeout: 10000
    });
    
    const $ = cheerio.load(articleHtml);
    
    // PROTA sections are usually inside specific headers or labels
    // We'll look for "Uses" or "Medicinal uses"
    let usesContent = '';
    $('b, strong').each((i, el) => {
      const text = $(el).text().toLowerCase();
      if (text.includes('uses') || text.includes('medicinal')) {
        // Collect following siblings until next bold/header
        let next = $(el).parent().next();
        while (next.length && !next.find('b, strong').length) {
          usesContent += next.text() + ' ';
          next = next.next();
        }
      }
    });

    if (!usesContent.trim()) {
      // Fallback: try to just grab everything in the center content
      usesContent = $('body').text().substring(0, 3000); 
    }

    return {
      source: 'PROTA (Plant Resources of Tropical Africa)',
      trust_score: 0.95,
      url: articleUrl,
      medicinal_uses: usesContent.trim(),
      raw_data: usesContent.trim()
    };
  } catch (err) {
    console.error('[PROTA ERROR]', err.message);
    return null;
  }
}

module.exports = { fetchProtaData };
