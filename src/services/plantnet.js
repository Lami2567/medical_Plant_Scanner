const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const PLANTNET_API_KEY = process.env.PLANTNET_API_KEY;
const PLANTNET_API_URL = 'https://my-api.plantnet.org/v2/identify/all';
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.20');

/**
 * Identifies a plant from an image file using the PlantNet API.
 * @param {string} imagePath - Absolute path to the image file
 * @returns {{ name: string, scientificName: string, confidence: number }}
 * @throws Error if confidence is below threshold or identification fails
 */
async function identifyPlant(imagePath) {
  if (!PLANTNET_API_KEY || PLANTNET_API_KEY === 'your_plantnet_api_key_here') {
    throw new Error('PlantNet API key is not configured. Please set PLANTNET_API_KEY in your .env file.');
  }

  const form = new FormData();
  form.append('images', fs.createReadStream(imagePath));
  form.append('organs', 'auto');

  let response;
  try {
    response = await axios.post(`${PLANTNET_API_URL}?api-key=${PLANTNET_API_KEY}&lang=en&include-related-images=false`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      if (status === 404) throw new Error('Plant not recognized. Please try a clearer photo.');
      if (status === 401) throw new Error('Invalid PlantNet API key.');
      throw new Error(`PlantNet API error: ${err.response.data?.message || err.message}`);
    }
    throw new Error(`Failed to reach PlantNet API: ${err.message}`);
  }

  const results = response.data?.results;
  if (!results || results.length === 0) {
    throw new Error('Plant not recognized. Please try a clearer photo.');
  }

  const best = results[0];
  const confidence = best.score || 0;

  if (confidence < CONFIDENCE_THRESHOLD) {
    throw new Error(
      `Plant identification confidence too low (${(confidence * 100).toFixed(1)}%). Please try a clearer photo.`
    );
  }

  const scientificName = best.species?.scientificNameWithoutAuthor || best.species?.scientificName || 'Unknown';
  const commonNames = best.species?.commonNames || [];
  const commonName = commonNames.length > 0 ? commonNames[0] : scientificName;

  return {
    name: commonName,
    scientificName,
    confidence: parseFloat((confidence * 100).toFixed(1)),
  };
}

module.exports = { identifyPlant };
