const { Groq } = require('groq-sdk');
require('dotenv').config();

// Ensure Groq is only instantiated if key is present to avoid instant crashing if missing
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

/**
 * Filter out sentences that contain obvious non-medical keywords.
 * @param {string} text
 * @returns {string}
 */
function filterRawText(text) {
  if (!text) return '';

  const nonMedicalKeywords = [
    'timber',
    'wood',
    'furniture',
    'construction',
    'ornamental use',
    'fuel'
  ];

  // Split text into sentences and filter out any sentence containing the bad keywords
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  const filteredSentences = sentences.filter(sentence => {
    const lower = sentence.toLowerCase();
    return !nonMedicalKeywords.some(keyword => lower.includes(keyword));
  });

  return filteredSentences.join(' ').trim();
}

/**
 * Clean data using Groq Llama 3
 * @param {string} rawText
 */
async function cleanPlantData(rawText) {
  if (!groq) {
    console.warn('[AI] GROQ_API_KEY not found. Skipping AI cleaner.');
    return null;
  }

  // Pre-filter
  let filteredText = filterRawText(rawText);

  // Truncate to max 3000 words
  const words = filteredText.split(' ');
  if (words.length > 3000) {
    filteredText = words.slice(0, 3000).join(' ');
  }

  if (filteredText.trim().length === 0) {
    return null;
  }

  const prompt = `You are a medicinal plant expert and data cleaner.

Your task is to extract ONLY medically relevant information about a plant from raw text.

STRICT RULES:
- Ignore non-medical uses (e.g., timber, furniture, construction, decoration)
- Focus ONLY on:
  - medicinal properties
  - health uses and benefits
  - who should use it
  - who should NOT use it
  - side effects and warnings

- Do NOT invent information
- Do NOT guess
- If information is not found, return "Information not available"

OUTPUT FORMAT (STRICT JSON):

{
  "medical_properties": [],
  "uses": [],
  "benefits": [],
  "who_should_use": [],
  "who_should_not_use": [],
  "side_effects": [],
  "warnings": []
}

INPUT TEXT:
"""
${filteredText}
"""
`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant', // A fast, standard llama3 model on Groq
      temperature: 0.1, // Low temperature for factual extraction
      response_format: { type: 'json_object' }
    });

    const outputString = chatCompletion.choices[0]?.message?.content;
    if (!outputString) return null;

    const parsedData = JSON.parse(outputString);
    return parsedData;

  } catch (error) {
    console.error('[AI] Groq Request Failed:', error.message);
    return null;
  }
}

module.exports = {
  cleanPlantData,
  filterRawText
};
