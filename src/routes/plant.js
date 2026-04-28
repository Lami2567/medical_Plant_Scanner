const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

const router = express.Router();
const pool = require('../db/postgres');
const { verifyToken } = require('../services/firebase');
const { identifyPlant } = require('../services/plantnet');
const { normalizePlantName } = require('../services/mpns');
const { fetchPfafData } = require('../services/pfaf');
const { fetchPerenualData } = require('../services/perenual');
const { fetchProtaData } = require('../services/prota');
const { fetchPreludeData } = require('../services/prelude');
const { mergePlantData, accumulateRawData } = require('../services/textProcessor');
const { cleanPlantData } = require('../services/aiCleaner');
const { uploadScanImage } = require('../services/storage');

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

function generateImageHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

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

async function ensureUserRecord(user) {
  if (!user?.uid) return;

  try {
    await pool.query(
      `INSERT INTO users (uid, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (uid) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [user.uid, user.email || null, user.name || user.displayName || null]
    );
  } catch (err) {
    console.error('[DB ERROR] Failed to ensure user record:', err.message);
    throw err;
  }
}

async function recordScan(user, plantName, imageHash, imageUrl = null) {
  await ensureUserRecord(user);
  await pool.query(
    `INSERT INTO scans (user_id, plant_name, image_hash, image_url) VALUES ($1, $2, $3, $4)`,
    [user.uid, plantName.toLowerCase().trim(), imageHash, imageUrl]
  );
}

function cleanup(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlink(filePath, () => {});
  }
}

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

  // Filter out any source that returns data for a mismatched scientific name
  const validSources = [pfaf, perenual, prota, prelude].filter(source => {
    if (!source) return false;
    
    if (source.scientific_name && scientificName) {
      // Extract genus & species (first 2 words) to ignore author abbreviations
      const srcWords = source.scientific_name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
      const reqWords = scientificName.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
      
      if (srcWords.length >= 2 && reqWords.length >= 2) {
        if (srcWords[0] !== reqWords[0] || srcWords[1] !== reqWords[1]) {
          console.log(`[RAG] Discarding ${source.source} data: Name mismatch (${source.scientific_name} !== ${scientificName})`);
          return false;
        }
      }
    }
    return true;
  });

  const rawData = accumulateRawData(validSources);
  const fallbackData = mergePlantData(commonName, scientificName, validSources);

  return { fallbackData, rawData, sources: fallbackData.sources };
}

// ─── POST /scan-plant ─────────────────────────────────────────────────────────
router.post('/scan-plant', verifyToken, (req, res, next) => {
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

      await ensureUserRecord(req.user);
      const imageHash = generateImageHash(imagePath);

      // Step 0: Check if Image Hash exists in scans for immediate deduplication
      try {
        const scanResult = await pool.query(
          'SELECT plant_name, image_url FROM scans WHERE image_hash = $1 LIMIT 1',
          [imageHash]
        );
        if (scanResult.rows.length > 0) {
          const matchedPlantName = scanResult.rows[0].plant_name;
          const matchedImageUrl = scanResult.rows[0].image_url || null;
          const cached = await getPlantFromDB(matchedPlantName);
          if (cached) {
            console.log(`[SCAN] Image Deduplication triggered: Reusing ${matchedPlantName} data.`);
            
            // Record scan history for this user
            await recordScan(
              req.user,
              matchedPlantName,
              imageHash,
              matchedImageUrl
            );

            cleanup(imagePath);
            return res.json({
              ...cached,
              image_url: matchedImageUrl,
              confidence_score: 100,
              from_cache: true,
              deduplicated: true,
            });
          }
        }
      } catch (dbErr) {
        console.error('[DB CHECK ERROR] deduplication check failed:', dbErr.message);
      }

      const compressedPath = imagePath.replace(/(\.\w+)$/, '_compressed.jpg');
      await sharp(imagePath)
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(compressedPath);

      let uploadedImageUrl = null;
      try {
        uploadedImageUrl = await uploadScanImage(compressedPath, {
          userId: req.user.uid,
          imageHash,
        });
      } catch (uploadError) {
        console.error(
          '[STORAGE ERROR] Failed to upload scan image:',
          uploadError.message
        );
      }

      // Step 1: Identify plant
      console.log('[SCAN] Identifying plant...');
      const identified = await identifyPlant(compressedPath);
      console.log(`[SCAN] Identified: ${identified.name} (${identified.scientificName}) @ ${identified.confidence}%`);

      // Step 2: Check cache
      const cached = await getPlantFromDB(identified.name);
      if (cached) {
        console.log('[SCAN] Returning cached result');
        
        try {
          await recordScan(
            req.user,
            identified.name,
            imageHash,
            uploadedImageUrl
          );
        } catch (err) { console.error('[DB ERROR] Failed to record scan cache hit:', err.message); }

        cleanup(imagePath);
        cleanup(compressedPath);
        return res.json({
          ...cached,
          image_url: uploadedImageUrl,
          confidence_score: identified.confidence,
          from_cache: true,
        });
      }

      // Step 3: Multi-Source RAG
      const { fallbackData, rawData, sources } = await getMultiSourceKnowledge(identified.name, identified.scientificName);
      
      let plantData = null;
      let aiCleaned = null;
      if (rawData) {
        console.log(`[SCAN] Passing raw data to AI Cleaner (${rawData.length} chars)...`);
        aiCleaned = await cleanPlantData(rawData);
        if (aiCleaned) {
          console.log('[SCAN] AI Cleaning Successful');
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
      plantData.image_url = uploadedImageUrl;

      // Save the best result we have so history can always resolve a scan entry.
      // If AI cleaning failed, we still persist the fallback result instead of
      // dropping the user's scan from history.
      await savePlantToDB(
        identified.name,
        identified.scientificName,
        plantData,
        rawData ? { rawData, ai_cleaned: Boolean(aiCleaned) } : { ai_cleaned: Boolean(aiCleaned) }
      );

      try {
        await recordScan(
          req.user,
          identified.name,
          imageHash,
          uploadedImageUrl
        );
      } catch (err) {
        console.error('[DB ERROR] Failed to record scan:', err.message);
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
      console.log(`[GET] Passing raw data to AI Cleaner (${rawData.length} chars)...`);
      aiCleaned = await cleanPlantData(rawData);
      if (aiCleaned) {
        console.log('[GET] AI Cleaning Successful');
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
