const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const router = express.Router();
const pool = require('../db/postgres');
const { identifyPlant } = require('../services/plantnet');
const { normalizePlantName } = require('../services/mpns');
const { fetchPfafData } = require('../services/pfaf');
const { fetchPerenualData } = require('../services/perenual');
const { fetchProtaData } = require('../services/prota');
const { fetchPreludeData } = require('../services/prelude');
const { mergePlantData, accumulateRawData } = require('../services/textProcessor');
const { cleanPlantData } = require('../services/aiCleaner');

// ─── Multer Config ───────────────────────────────────────────────────────────
const MAX_SIZE_MB = parseInt(process.env.MAX_IMAGE_SIZE_MB || '10');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `plant_${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${ext}. Use JPG, PNG, or WEBP.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getPlantFromDB(plantName) {
  const normalized = plantName.toLowerCase().trim();
  const result = await pool.query(
    'SELECT cleaned_data FROM plant_data WHERE LOWER(plant_name) = $1 LIMIT 1',
    [normalized]
  );
  return result.rows[0]?.cleaned_data || null;
}

async function savePlantToDB(plantName, scientificName, cleanedData, rawData) {
  try {
    await pool.query(
      `INSERT INTO plant_data (plant_name, scientific_name, cleaned_data, raw_data)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (plant_name) DO UPDATE SET cleaned_data = EXCLUDED.cleaned_data, raw_data = EXCLUDED.raw_data, scientific_name = EXCLUDED.scientific_name`,
      [plantName.toLowerCase().trim(), scientificName, cleanedData, rawData]
    );
  } catch (err) {
    console.error('[DB] Failed to cache plant:', err.message);
  }
}

function cleanup(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlink(filePath, () => {});
  }
}

/**
 * Orchestrates multi-source RAG retrieval.
 */
async function getMultiSourceKnowledge(commonName, scientificName) {
  console.log(`[RAG] Fetching knowledge for ${commonName} (${scientificName})...`);
  
  // Normalize via MPNS
  const normalized = await normalizePlantName(scientificName || commonName);
  
  // Parallel fetch from authoritative sources
  const [pfaf, perenual, prota, prelude] = await Promise.all([
    fetchPfafData(normalized.resolvedName).catch(() => null),
    fetchPerenualData(scientificName || commonName).catch(() => null),
    fetchProtaData(scientificName || commonName).catch(() => null),
    fetchPreludeData(scientificName || commonName).catch(() => null)
  ]);

  const rawData = accumulateRawData([pfaf, perenual, prota, prelude]);
  const fallbackData = mergePlantData(commonName, scientificName, [pfaf, perenual, prota, prelude]);

  return { fallbackData, rawData, sources: fallbackData.sources };
}

// ─── POST /scan-plant ─────────────────────────────────────────────────────────
router.post('/scan-plant', (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Image too large. Maximum size is ${MAX_SIZE_MB}MB.` });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    const imagePath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image provided. Include an image file in the "image" field.' });
      }

      const compressedPath = imagePath.replace(/(\.\w+)$/, '_compressed.jpg');
      await sharp(imagePath)
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(compressedPath);

      // Step 1: Identify plant
      console.log('[SCAN] Identifying plant...');
      const identified = await identifyPlant(compressedPath);
      console.log(`[SCAN] Identified: ${identified.name} (${identified.scientificName}) @ ${identified.confidence}%`);

      // Step 2: Check cache
      const cached = await getPlantFromDB(identified.name);
      if (cached) {
        console.log('[SCAN] Returning cached result');
        cleanup(imagePath);
        cleanup(compressedPath);
        return res.json({ ...cached, confidence_score: identified.confidence, from_cache: true });
      }

      // Step 3: Multi-Source RAG
      const { fallbackData, rawData, sources } = await getMultiSourceKnowledge(identified.name, identified.scientificName);
      
      let plantData = null;
      let aiCleaned = null;
      if (rawData) {
        console.log('[SCAN] Passing raw data to AI Cleaner...');
        aiCleaned = await cleanPlantData(rawData);
        if (aiCleaned) {
          plantData = {
             plant_name: fallbackData.plant_name,
             scientific_name: fallbackData.scientific_name,
             ...aiCleaned,
             sources: sources,
             disclaimer: fallbackData.disclaimer
          };
        }
      }

      if (!plantData) {
        console.log('[SCAN] AI Cleaner failed or no data. Using fallback processed data.');
        plantData = fallbackData;
      }

      plantData.confidence_score = identified.confidence;
      plantData.from_cache = false;

      // Step 4: Save to DB (Only cache if we successfully cleaned it or if we truly want the fallback)
      // If AI failed, we still show the fallback to the user, but we DON'T save it to DB
      // so that next time we can try the AI again.
      if (aiCleaned) {
        await savePlantToDB(identified.name, identified.scientificName, plantData, { rawData });
      }

      cleanup(imagePath);
      cleanup(compressedPath);

      return res.json(plantData);
    } catch (error) {
      cleanup(imagePath);
      console.error('[SCAN ERROR]', error.message);
      
      const userFacingErrors = ['not recognized', 'confidence', 'PlantNet API', 'file type', 'too large'];
      const isUserFacing = userFacingErrors.some((kw) => error.message.toLowerCase().includes(kw));

      return res.status(isUserFacing ? 400 : 500).json({ error: error.message });
    }
  });
});

// ─── GET /plant/:name ─────────────────────────────────────────────────────────
router.get('/plant/:name', async (req, res) => {
  const plantName = req.params.name?.trim();
  if (!plantName) return res.status(400).json({ error: 'Plant name is required.' });

  try {
    const cached = await getPlantFromDB(plantName);
    if (cached) return res.json({ ...cached, from_cache: true });

    console.log(`[GET] Fetching live data for: ${plantName}`);
    const { fallbackData, rawData, sources } = await getMultiSourceKnowledge(plantName, null);
    
    let plantData = null;
    let aiCleaned = null;
    if (rawData) {
      console.log('[GET] Passing raw data to AI Cleaner...');
      aiCleaned = await cleanPlantData(rawData);
      if (aiCleaned) {
        plantData = {
           plant_name: fallbackData.plant_name,
           scientific_name: fallbackData.scientific_name,
           ...aiCleaned,
           sources: sources,
           disclaimer: fallbackData.disclaimer
        };
      }
    }

    if (!plantData) {
      console.log('[GET] AI Cleaner failed or no data. Using fallback processed data.');
      plantData = fallbackData;
    }
    
    // Step 4: Save to DB (Only cache if we successfully cleaned it)
    if (aiCleaned) {
      await savePlantToDB(plantName, null, plantData, { rawData });
    }
    plantData.from_cache = false;
    
    return res.json(plantData);
  } catch (error) {
    console.error('[GET ERROR]', error.message);
    return res.status(500).json({ error: 'Failed to retrieve plant information.' });
  }
});

module.exports = router;

