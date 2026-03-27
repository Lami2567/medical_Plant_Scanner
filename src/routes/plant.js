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
const { mergePlantData } = require('../services/textProcessor');

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
    'SELECT data FROM plants WHERE LOWER(plant_name) = $1 LIMIT 1',
    [normalized]
  );
  return result.rows[0]?.data || null;
}

async function savePlantToDB(plantName, scientificName, data) {
  try {
    await pool.query(
      `INSERT INTO plants (plant_name, scientific_name, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (plant_name) DO UPDATE SET data = EXCLUDED.data, scientific_name = EXCLUDED.scientific_name`,
      [plantName.toLowerCase().trim(), scientificName, data]
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
  
  // Normalize via MPNS if needed
  const normalized = await normalizePlantName(scientificName || commonName);
  
  // Parallel fetch from authoritative sources
  const [pfaf, perenual] = await Promise.all([
    fetchPfafData(normalized.resolvedName),
    fetchPerenualData(commonName)
  ]);

  return mergePlantData(commonName, scientificName, [pfaf, perenual]);
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
      const plantData = await getMultiSourceKnowledge(identified.name, identified.scientificName);
      plantData.confidence_score = identified.confidence;
      plantData.from_cache = false;

      // Step 4: Save to DB
      await savePlantToDB(identified.name, identified.scientificName, plantData);

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
    const plantData = await getMultiSourceKnowledge(plantName, null);
    
    await savePlantToDB(plantName, null, plantData);
    plantData.from_cache = false;
    
    return res.json(plantData);
  } catch (error) {
    console.error('[GET ERROR]', error.message);
    return res.status(500).json({ error: 'Failed to retrieve plant information.' });
  }
});

module.exports = router;

