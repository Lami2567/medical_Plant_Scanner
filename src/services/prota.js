const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes PROTA4U (Plant Resources of Tropical Africa) database.
 * PROTA is the primary authority for African medicinal plants.
 */
async function fetchProtaData(scientificName) {
  try {
    const query = scientificName.replace(' ', '+');
    // Direct Article URL
    const articleUrl = `https://prota.prota4u.org/protav8.asp?p=${query}`;
    
    console.log(`[PROTA] Fetching article: ${articleUrl}`);
    
    const { data: articleHtml } = await axios.get(articleUrl, {
      headers: { 'User-Agent': 'MedPlantScanner/1.0' },
      timeout: 10000
    });
    
    const $ = cheerio.load(articleHtml);
    
    // Helper to extract text from improperly nested PROTA tables
    function extractText(html, name) {
      const marker = `<a name=${name}></a>${name}`;
      let parts = html.split(marker);
      if (parts.length < 2) return null;
      
      let section = parts[1];
      let startMarker = '<td colspan=3>';
      let startIdx = section.indexOf(startMarker);
      if (startIdx === -1) return null;
      
      let endMarker = '</td>';
      let endIdx = section.indexOf(endMarker, startIdx + startMarker.length);
      if (endIdx === -1) return null;
      
      let rawText = section.substring(startIdx + startMarker.length, endIdx);
      return rawText.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    
    let usesContent = '';
    
    const usesText = extractText(articleHtml, 'Uses');
    if (usesText) usesContent += 'Uses: ' + usesText + '\n\n';
    
    const propsText = extractText(articleHtml, 'Properties');
    if (propsText) usesContent += 'Properties: ' + propsText + '\n\n';
    
    const botanyText = extractText(articleHtml, 'Botany');
    if (botanyText) usesContent += 'Botany: ' + botanyText + '\n\n';

    if (!usesContent.trim()) {
      console.log(`[PROTA] No article content found for: ${scientificName}`);
      return null;
    }

    return {
      source: 'PROTA (Plant Resources of Tropical Africa)',
      trust_score: 0.95,
      url: articleUrl,
      scientific_name: scientificName,
      medicinal_uses: usesContent.trim(),
      raw_data: usesContent.trim()
    };
  } catch (err) {
    console.error('[PROTA ERROR]', err.message);
    return null;
  }
}

module.exports = { fetchProtaData };
