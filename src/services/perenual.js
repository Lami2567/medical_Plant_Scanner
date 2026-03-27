const axios = require('axios');

const PERENUAL_API_KEY = process.env.PERENUAL_API_KEY;
const BASE_URL = 'https://perenual.com/api/v2';

/**
 * Fetches plant data from the Perenual API.
 * Provides structured species details and medicinal notes if available.
 */
async function fetchPerenualData(commonName) {
  if (!PERENUAL_API_KEY || PERENUAL_API_KEY === 'your_perenual_api_key_here') {
    return null;
  }

  try {
    console.log(`[Perenual] Searching for: ${commonName}`);
    
    // Step 1: Search for species ID
    const searchRes = await axios.get(`${BASE_URL}/species-list`, {
      params: { key: PERENUAL_API_KEY, q: commonName },
      timeout: 10000
    });
    
    const results = searchRes.data?.data || [];
    if (results.length === 0) return null;
    
    const speciesId = results[0].id;
    
    // Step 2: Get full details
    console.log(`[Perenual] Fetching details for ID: ${speciesId}`);
    const detailRes = await axios.get(`${BASE_URL}/species/details/${speciesId}`, {
      params: { key: PERENUAL_API_KEY },
      timeout: 10000
    });
    
    const details = detailRes.data;
    
    return {
      source: 'Perenual API',
      trust_score: 0.6,
      url: `https://perenual.com/species/${speciesId}`,
      common_name: details.common_name,
      scientific_name: details.scientific_name ? details.scientific_name[0] : '',
      description: details.description || '',
      medicinal_notes: details.medicinal_notes || '', // Custom field if available in their DB
      raw_data: details.description + ' ' + (details.care_guides || '')
    };
  } catch (err) {
    console.error('[Perenual ERROR]', err.message);
    return null;
  }
}

module.exports = { fetchPerenualData };
