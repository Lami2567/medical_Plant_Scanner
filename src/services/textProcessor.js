/**
 * Text Processor — converts raw text from multiple sources into a structured plant info JSON.
 * Implements a Multi-Source RAG KnowledgeMerger with trust-based weighing.
 */

// ─── Trust Scores ────────────────────────────────────────────────────────────
const TRUST_SCORES = {
  'HerbMed': 0.9,
  'Plants For A Future (PFAF)': 0.8,
  'Prelude': 0.7,
  'Perenual API': 0.6,
};

// ─── Sentence splitter ──────────────────────────────────────────────────────
function splitSentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20); // Slightly longer for better quality
}

// ─── Citation / reference cleaner ───────────────────────────────────────────
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\[\d+\]/g, '')           // [1], [23]
    .replace(/\([^)]{0,60}\)/g, '')    // short parentheticals
    .replace(/==+[^=]+==+/g, '')       // section headings
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Keyword banks ───────────────────────────────────────────────────────────
const USES_KEYWORDS = ['used for', 'used to treat', 'treatment', 'treats', 'remedy', 'relieves'];
const BENEFITS_KEYWORDS = ['beneficial', 'health benefit', 'supports', 'promotes', 'helps', 'effective'];
const SIDE_EFFECTS_KEYWORDS = ['may cause', 'side effect', 'adverse', 'reaction', 'irritation', 'nausea'];
const NOT_RECOMMENDED_KEYWORDS = ['avoid', 'not recommended', 'contraindicated', 'pregnant', 'children', 'toxic'];
const RECOMMENDED_KEYWORDS = ['recommended for', 'suitable for', 'appropriate for', 'good for', 'safe for'];
const PROPERTIES_KEYWORDS = [
  'antioxidant', 'anti-inflammatory', 'antimicrobial', 'antifungal', 'antiviral', 
  'antibacterial', 'analgesic', 'adaptogen', 'diuretic', 'sedative', 'stimulant',
  'antispasmodic', 'antiseptic', 'tonic'
];

// ─── Match helper ─────────────────────────────────────────────────────────────
function matchesAny(sentence, keywords) {
  const lower = sentence.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ─── Extraction Helper ───────────────────────────────────────────────────────
function extractFromSources(sources, keywords, fieldName) {
  let allFindings = [];

  // Grouped by source for trust-based processing
  for (const source of sources) {
    if (!source || !source.raw_data) continue;
    
    const sentences = splitSentences(cleanText(source.raw_data));
    const matched = sentences.filter((s) => matchesAny(s, keywords));
    
    matched.forEach(s => {
      allFindings.push({
        text: s,
        score: TRUST_SCORES[source.source] || 0.5,
        source: source.source
      });
    });
  }

  // Deduplicate and prioritize by score
  allFindings.sort((a, b) => b.score - a.score);
  
  const unique = [];
  for (const item of allFindings) {
    const isDuplicate = unique.some(u => 
      u.toLowerCase().substring(0, 30) === item.text.toLowerCase().substring(0, 30)
    );
    if (!isDuplicate) unique.push(item.text);
    if (unique.length >= 8) break;
  }

  return unique;
}

// ─── Extract medical properties ─────────────────────────────────────────────
function extractProperties(sources) {
  const allText = sources.map(s => (s?.raw_data || '').toLowerCase()).join(' ');
  const found = PROPERTIES_KEYWORDS.filter(kw => allText.includes(kw.toLowerCase()));
  return [...new Set(found)];
}

// ─── Main Merger ────────────────────────────────────────────────────────────
/**
 * Merges data from multiple authoritative sources into one structured JSON.
 */
function mergePlantData(plantName, scientificName, sources) {
  const activeSources = sources.filter(s => !!s);
  
  if (activeSources.length === 0) {
    return buildEmpty(plantName, scientificName);
  }

  const result = {
    plant_name: capitalize(plantName),
    scientific_name: scientificName || 'Unknown',
    medical_properties: extractProperties(activeSources),
    uses: extractFromSources(activeSources, USES_KEYWORDS, 'uses'),
    benefits: extractFromSources(activeSources, BENEFITS_KEYWORDS, 'benefits'),
    who_should_use: extractFromSources(activeSources, RECOMMENDED_KEYWORDS, 'who_should_use'),
    who_should_not_use: extractFromSources(activeSources, NOT_RECOMMENDED_KEYWORDS, 'who_should_not_use'),
    side_effects: extractFromSources(activeSources, SIDE_EFFECTS_KEYWORDS, 'side_effects'),
    warnings: [],
    sources: activeSources.map(s => ({ name: s.source, url: s.url, confidence: s.trust_score })),
    disclaimer: 'This information is for educational purposes only and is not medical advice.',
  };

  // Populate warnings from "who_should_not_use" and "side_effects"
  result.warnings = result.who_should_not_use.slice(0, 2).concat(result.side_effects.slice(0, 1));
  
  // Fill empty fields
  const fields = ['medical_properties', 'uses', 'benefits', 'who_should_use', 'who_should_not_use', 'side_effects'];
  fields.forEach(f => {
    if (result[f].length === 0) result[f] = ['Information not available'];
  });

  if (result.warnings.length === 0) result.warnings = ['Consult a healthcare professional before use.'];

  return result;
}

function buildEmpty(plantName, scientificName) {
  return {
    plant_name: capitalize(plantName),
    scientific_name: scientificName || 'Unknown',
    medical_properties: ['Information not available'],
    uses: ['Information not available'],
    benefits: ['Information not available'],
    who_should_use: ['Information not available'],
    who_should_not_use: ['Information not available'],
    side_effects: ['Information not available'],
    warnings: ['Consult a healthcare professional before use.'],
    sources: [],
    disclaimer: 'This information is for educational purposes only and is not medical advice.',
  };
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = { mergePlantData };

