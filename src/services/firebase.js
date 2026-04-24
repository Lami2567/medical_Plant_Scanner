const admin = require('firebase-admin');

// Initialize Firebase Admin (Only if credentials provided or if testing)
// If you don't provide a service account, it assumes it runs on GCP environments or skips initialization.
// We'll throw a helpful error if it hasn't been set up yet, but won't crash the server.
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[FIREBASE] Admin SDK initialized via env var.');
  } else {
    // Attempt local default initialization
    admin.initializeApp();
    console.log('[FIREBASE] Admin SDK initialized locally (no service account).');
  }
} catch (err) {
  console.log('[FIREBASE] Init error (often normal if no config):', err.message);
}

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('[AUTH ERROR]', error.message);
    return res.status(403).json({ error: 'Unauthorized: Invalid token.' });
  }
};

module.exports = { admin, verifyToken };
