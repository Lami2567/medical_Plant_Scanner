const express = require('express');
const router = express.Router();
const pool = require('../db/postgres');
const { verifyToken } = require('../services/firebase');

// Ensure token on all /user routes
router.use(verifyToken);

// Update user details on login or just to keep sync
router.post('/sync', async (req, res) => {
  const { uid, email, name, displayName, picture, photoURL } = req.user;
  try {
    await pool.query(
      `INSERT INTO users (uid, email, name, photo_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (uid) DO UPDATE SET 
         email = COALESCE(EXCLUDED.email, users.email), 
         name = COALESCE(EXCLUDED.name, users.name),
         photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url)`,
      [uid, email, name || displayName || null, photoURL || picture || null]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[USER SYNC ERROR]', err);
    return res.status(500).json({ error: 'Failed to sync user.' });
  }
});

// Get user scan history
router.get('/history', async (req, res) => {
  const { uid } = req.user;
  try {
    const result = await pool.query(
      `SELECT s.scan_id, s.image_hash, s.image_url, s.created_at, pd.plant_name, pd.scientific_name, pd.cleaned_data
       FROM scans s
       JOIN plant_data pd ON s.plant_name = pd.plant_name
       WHERE s.user_id = $1
         AND s.status = 'success'
       ORDER BY s.created_at DESC`,
      [uid]
    );
    
    // Format to match old plant output
    const history = result.rows.map(row => ({
      scan_id: row.scan_id,
      image_hash: row.image_hash,
      image_url: row.image_url,
      scanned_at: row.created_at,
      plant_name: row.plant_name,
      scientific_name: row.scientific_name,
      ...row.cleaned_data,
    }));

    return res.json({ history });
  } catch (error) {
    console.error('[HISTORY ERROR]', error.message);
    return res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

// Delete a single scan from the signed-in user's history.
// This only removes the scan row; shared plant_data cache remains intact.
router.delete('/history/:scanId', async (req, res) => {
  const { uid } = req.user;
  const scanId = Number.parseInt(req.params.scanId, 10);

  if (!Number.isInteger(scanId) || scanId <= 0) {
    return res.status(400).json({ error: 'A valid scan id is required.' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM scans
       WHERE scan_id = $1 AND user_id = $2
       RETURNING scan_id`,
      [scanId, uid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Scan not found.' });
    }

    return res.json({ success: true, scan_id: result.rows[0].scan_id });
  } catch (error) {
    console.error('[HISTORY DELETE ERROR]', error.message);
    return res.status(500).json({ error: 'Failed to delete scan.' });
  }
});

module.exports = router;
