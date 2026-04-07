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

  // Truncate to max 1200 words to stay within free-tier TPM limits
  const words = filteredText.split(' ');
  if (words.length > 1200) {
    filteredText = words.slice(0, 1200).join(' ');
  }

  if (filteredText.trim().length === 0) {
    return null;
  }

  const prompt = `You are a medicinal plant expert and data cleaner.

Your task is to extract ONLY medically relevant information about a plant from raw text.

STRICT RULES:
- Ignore non-medical uses (e.g., wood, timber, furniture, construction, decoration, shade, fencing, crafts)
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

  async function callGroqWithRetry(attempts = 2) {
    for (let i = 0; i < attempts; i++) {
      try {
        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.1-8b-instant', 
          temperature: 0.1,
          response_format: { type: 'json_object' }
        });

        const outputString = chatCompletion.choices[0]?.message?.content;
        if (!outputString) return null;
        return JSON.parse(outputString);
      } catch (error) {
        const isRateLimit = error.message.toLowerCase().includes('rate_limit_exceeded') || error.status === 429;
        
        if (isRateLimit && i < attempts - 1) {
          console.warn(`[AI] Rate limit hit. Retrying in 2 seconds... (Attempt ${i + 1}/${attempts})`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        
        console.error('[AI] Groq Request Failed:', error.message);
        return null;
      }
    }
    return null;
  }

  return await callGroqWithRetry();
}

module.exports = {
  cleanPlantData,
  filterRawText
};
