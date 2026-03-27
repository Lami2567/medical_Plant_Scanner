/**
 * Text Processor — converts raw Wikipedia text into a structured plant info JSON.
 * Uses keyword-based extraction (no AI required).
 */

// ─── Sentence splitter ──────────────────────────────────────────────────────
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// ─── Citation / reference cleaner ───────────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/\[\d+\]/g, '')           // [1], [23]
    .replace(/\([^)]{0,60}\)/g, '')    // short parentheticals
    .replace(/==+[^=]+==+/g, '')       // section headings
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Keyword banks ───────────────────────────────────────────────────────────
const USES_KEYWORDS = [
  'used for', 'used to treat', 'used in treatment', 'treats', 'treating',
  'effective against', 'helpful for', 'beneficial for', 'remedy for',
  'relieves', 'alleviates', 'reduces', 'promotes', 'supports', 'heals',
  'antioxidant', 'anti-inflammatory', 'antimicrobial', 'antifungal',
  'antiviral', 'antibacterial', 'analgesic', 'diuretic', 'laxative',
];

const SIDE_EFFECTS_KEYWORDS = [
  'may cause', 'can cause', 'toxic', 'toxicity', 'adverse', 'side effect',
  'overdose', 'harmful', 'dangerous', 'irritation', 'allergic', 'reaction',
  'nausea', 'vomiting', 'diarrhea', 'rash', 'liver', 'kidney', 'poisoning',
];

const NOT_RECOMMENDED_KEYWORDS = [
  'avoid', 'not recommended', 'contraindicated', 'should not', 'must not',
  'pregnant', 'pregnancy', 'breastfeeding', 'nursing', 'children', 'infants',
  'elderly', 'diabetic', 'hypertension', 'blood thinner', 'surgery',
  'medication interaction', 'drug interaction',
];

const RECOMMENDED_KEYWORDS = [
  'recommended for', 'beneficial for', 'helpful for', 'suitable for',
  'good for', 'safe for', 'effective for', 'used by', 'appropriate for',
];

const PROPERTIES_KEYWORDS = [
  'antioxidant', 'anti-inflammatory', 'antimicrobial', 'antifungal',
  'antiviral', 'antibacterial', 'analgesic', 'adaptogen', 'diuretic',
  'carminative', 'expectorant', 'astringent', 'sedative', 'stimulant',
  'hepatoprotective', 'immunomodulatory', 'antispasmodic', 'antiseptic',
  'nervine', 'tonic',
];

// ─── Match helper ─────────────────────────────────────────────────────────────
function matchesAny(sentence, keywords) {
  const lower = sentence.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ─── Extract lists from text ──────────────────────────────────────────────────
function extractList(text, keywords, maxItems = 8) {
  if (!text) return [];
  const sentences = splitSentences(cleanText(text));
  const matched = sentences.filter((s) => matchesAny(s, keywords));
  // Deduplicate similar sentences
  const unique = [];
  for (const s of matched) {
    const isDuplicate = unique.some(
      (u) => u.toLowerCase().substring(0, 40) === s.toLowerCase().substring(0, 40)
    );
    if (!isDuplicate) unique.push(s);
    if (unique.length >= maxItems) break;
  }
  return unique;
}

// ─── Extract medical properties (single words/phrases) ───────────────────────
function extractProperties(allText) {
  const lower = allText.toLowerCase();
  return PROPERTIES_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()));
}

// ─── Build warnings string ────────────────────────────────────────────────────
function buildWarnings(toxicityText, fullText) {
  const source = (toxicityText || '') + ' ' + (fullText || '');
  const sentences = splitSentences(cleanText(source));
  const warningsSentences = sentences.filter((s) =>
    matchesAny(s, [
      'warning', 'caution', 'consult', 'physician', 'doctor', 'medical advice',
      'overdose', 'toxic dose', 'lethal', 'seek medical',
    ])
  );
  if (warningsSentences.length > 0) return warningsSentences.slice(0, 3).join(' ');
  return 'Consult a healthcare professional before use.';
}

// ─── Main processor ───────────────────────────────────────────────────────────
/**
 * Converts raw Wikipedia knowledge into a structured plant info JSON.
 */
function processPlantData(plantName, scientificName, wikiData) {
  if (!wikiData) {
    return buildEmpty(plantName, scientificName);
  }

  const { medicinalText, toxicityText, descriptionText, summary, fullText } = wikiData;
  const combinedText = [medicinalText, toxicityText, descriptionText, summary].join('\n');

  const uses = extractList(combinedText, USES_KEYWORDS);
  const sideEffects = extractList(toxicityText + ' ' + fullText, SIDE_EFFECTS_KEYWORDS);
  const whoShouldNotUse = extractList(combinedText + ' ' + fullText, NOT_RECOMMENDED_KEYWORDS, 6);
  const whoShouldUse = extractList(combinedText, RECOMMENDED_KEYWORDS, 6);
  const medicalProperties = extractProperties(combinedText);
  const warnings = buildWarnings(toxicityText, fullText);

  return {
    plant_name: capitalize(plantName),
    scientific_name: scientificName || 'Unknown',
    medical_properties: medicalProperties.length > 0 ? medicalProperties : ['Information not available'],
    uses: uses.length > 0 ? uses : ['Information not available'],
    who_should_use: whoShouldUse.length > 0 ? whoShouldUse : ['General adults as a traditional remedy (consult a physician)'],
    who_should_not_use: whoShouldNotUse.length > 0 ? whoShouldNotUse : ['Pregnant or breastfeeding women without medical advice'],
    side_effects: sideEffects.length > 0 ? sideEffects : ['Information not available'],
    warnings,
    disclaimer: 'This information is for educational purposes only and is not medical advice.',
    source: 'Wikipedia',
    confidence_score: null,
  };
}

function buildEmpty(plantName, scientificName) {
  return {
    plant_name: capitalize(plantName),
    scientific_name: scientificName || 'Unknown',
    medical_properties: ['Information not available'],
    uses: ['Information not available'],
    who_should_use: ['Information not available'],
    who_should_not_use: ['Information not available'],
    side_effects: ['Information not available'],
    warnings: 'Consult a healthcare professional before use.',
    disclaimer: 'This information is for educational purposes only and is not medical advice.',
    source: 'Wikipedia',
    confidence_score: null,
  };
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = { processPlantData };
