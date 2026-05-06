require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const plantRoutes = require('./src/routes/plant');
const userRoutes = require('./src/routes/user');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 8000;

// Trust the proxy (Koyeb load balancer) for accurate IP-based rate limiting
app.set('trust proxy', 1);

// ─── Security Middleware ────────────────────────────────────────────────────
const cspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
delete cspDirectives['upgrade-insecure-requests'];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...cspDirectives,
      'connect-src': ["'self'", 'http://localhost:*', 'http://127.0.0.1:*', 'https:'],
      'img-src': ["'self'", 'data:', 'https:'],
      'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
    },
  },
}));
app.use(cors());
app.use(express.json());

// Rate limiting: max 30 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please wait and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/scan-plant', limiter);

// ─── Uploads Directory ──────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ─── Routes ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: '🌿 MedPlant Scanner API is running.',
    endpoints: {
      health: '/health',
      scan: '/scan-plant (POST)',
      get_plant: '/plant/:name (GET)',
      admin: '/admin-dashboard'
    }
  });
});

app.use('/', plantRoutes);
app.use('/user', userRoutes);
app.use('/admin', adminRoutes);

const adminDir = path.join(__dirname, '..', 'admin');
if (fs.existsSync(adminDir)) {
  app.use('/admin-dashboard', express.static(adminDir));
}

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'MedPlant Scanner API', time: new Date().toISOString() });
});

// ─── 404 Handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌿 MedPlant Scanner API running on http://0.0.0.0:${PORT}`);
});

module.exports = app;
