const axios = require('axios');

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

/**
 * Fetches and extracts medicinal-relevant content from Wikipedia for a given plant name.
 * @param {string} plantName - Common or scientific name of the plant
 * @returns {{ summary: string, medicinalText: string, toxicityText: string, descriptionText: string }}
 */
async function fetchPlantKnowledge(plantName) {
  // Step 1: Search for the page title
  const searchRes = await axios.get(WIKIPEDIA_API, {
    params: {
      action: 'query',
      list: 'search',
      srsearch: `${plantName} plant medicinal`,
      format: 'json',
      srlimit: 3,
    },
    headers: {
      'User-Agent': 'MedPlantScanner/1.0 (https://github.com/Lami2567/medical_Plant_Scanner; contact@example.com)'
    },
    timeout: 15000,
  });

  const searchResults = searchRes.data?.query?.search || [];
  if (searchResults.length === 0) {
    return null;
  }

  // Pick the most relevant result
  const pageTitle = searchResults[0].title;

  // Step 2: Fetch the full page extract (plain text)
  const pageRes = await axios.get(WIKIPEDIA_API, {
    params: {
      action: 'query',
      titles: pageTitle,
      prop: 'extracts',
      explaintext: true,
      exsectionformat: 'wiki',
      format: 'json',
    },
    timeout: 15000,
    headers: { 'User-Agent': 'MedPlantScanner/1.0 (contact@example.com)' }
  });

  const pages = pageRes.data?.query?.pages;
  const page = pages ? Object.values(pages)[0] : null;

  if (!page || page.missing || !page.extract) {
    return null;
  }

  const fullText = page.extract;

  // Step 3: Extract relevant sections by heading keywords
  const medicinalText = extractSection(fullText, [
    'Medicinal', 'Medical use', 'Traditional medicine', 'Herbal', 'Phytotherapy',
    'Therapeutic', 'Health benefit', 'Folk medicine',
  ]);

  const toxicityText = extractSection(fullText, [
    'Toxicity', 'Toxic', 'Adverse', 'Side effect', 'Contraindication',
    'Safety', 'Precaution', 'Warning', 'Poisoning',
  ]);

  const descriptionText = extractSection(fullText, [
    'Description', 'Morphology', 'Botany', 'Characteristics',
  ]);

  // Fallback: use first 2000 characters as summary
  const summaryText = fullText.substring(0, 2000);

  return {
    pageTitle,
    summary: summaryText,
    medicinalText: medicinalText || '',
    toxicityText: toxicityText || '',
    descriptionText: descriptionText || '',
    fullText,
  };
}

/**
 * Extracts text from sections matching any of the given heading keywords.
 */
function extractSection(fullText, headingKeywords) {
  const lines = fullText.split('\n');
  let capturing = false;
  let depth = 0;
  const collected = [];

  for (const line of lines) {
    // Detect wiki section headings (== Heading ==, === Sub ===)
    const headingMatch = line.match(/^(={2,})\s*(.+?)\s*\1$/);

    if (headingMatch) {
      const currentDepth = headingMatch[1].length;
      const headingText = headingMatch[2];

      const isTargetSection = headingKeywords.some((kw) =>
        headingText.toLowerCase().includes(kw.toLowerCase())
      );

      if (isTargetSection) {
        capturing = true;
        depth = currentDepth;
        continue;
      } else if (capturing && currentDepth <= depth) {
        // End of target section
        break;
      }
    }

    if (capturing) {
      collected.push(line);
    }
  }

  return collected.join('\n').trim();
}

module.exports = { fetchPlantKnowledge };
