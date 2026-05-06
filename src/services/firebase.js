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
    req.user = await enrichTokenUser(decodedToken);
    next();
  } catch (error) {
    console.error('[AUTH ERROR]', error.code || error.message);
    return res.status(403).json({ error: 'Unauthorized: Invalid token.' });
  }
};

async function enrichTokenUser(decodedToken) {
  if (!decodedToken?.uid) return decodedToken;

  try {
    const record = await admin.auth().getUser(decodedToken.uid);
    return {
      ...decodedToken,
      email: decodedToken.email || record.email || null,
      name: decodedToken.name || record.displayName || null,
      displayName: decodedToken.displayName || record.displayName || decodedToken.name || null,
      picture: decodedToken.picture || record.photoURL || null,
      photoURL: decodedToken.photoURL || record.photoURL || decodedToken.picture || null,
    };
  } catch (error) {
    console.warn('[FIREBASE] Could not enrich user profile:', error.code || error.message);
    return decodedToken;
  }
}

async function getUserProfilesByUid(uids = []) {
  if (!firebaseReady) return new Map();

  const uniqueUids = [...new Set(uids.filter(Boolean))];
  if (!uniqueUids.length) return new Map();

  try {
    const result = await admin.auth().getUsers(uniqueUids.map((uid) => ({ uid })));
    return new Map(result.users.map((user) => [
      user.uid,
      {
        uid: user.uid,
        email: user.email || null,
        name: user.displayName || null,
        photo_url: user.photoURL || null,
      },
    ]));
  } catch (error) {
    console.warn('[FIREBASE] Could not fetch user profiles:', error.code || error.message);
    return new Map();
  }
}

module.exports = { admin, getUserProfilesByUid, verifyToken };
