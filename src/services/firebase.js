const admin = require('firebase-admin');

let firebaseReady = false;

// Initialize Firebase Admin for production hosts like Koyeb.
// Token verification can work with a project ID only, but we prefer a full
// service account when one is available.
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[FIREBASE] Admin SDK initialized via env var.');
    firebaseReady = true;
  } else {
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT;

    if (projectId) {
      admin.initializeApp({ projectId });
      console.log(`[FIREBASE] Admin SDK initialized with project ID: ${projectId}`);
      firebaseReady = true;
    } else {
      console.warn('[FIREBASE] Admin SDK not configured. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID.');
    }
  }
} catch (err) {
  console.log('[FIREBASE] Init error (often normal if no config):', err.message);
}

const verifyToken = async (req, res, next) => {
  if (!firebaseReady) {
    return res.status(500).json({
      error: 'Server authentication is not configured. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID.',
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  const token = authHeader.substring('Bearer '.length).trim();
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('[AUTH ERROR]', error.code || error.message);
    return res.status(403).json({ error: 'Unauthorized: Invalid token.' });
  }
};

module.exports = { admin, verifyToken };
