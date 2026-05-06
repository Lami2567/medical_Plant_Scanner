const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const pool = require('../db/postgres');

const router = express.Router();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function tokenSecret() {
  return (
    process.env.ADMIN_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    process.env.ADMIN_PASSWORD ||
    'change-this-admin-token-secret'
  );
}

function signTokenPayload(payloadPart) {
  return crypto
    .createHmac('sha256', tokenSecret())
    .update(payloadPart)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createAdminToken(email) {
  const payload = {
    sub: 'admin',
    email,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  };
  const payloadPart = base64url(JSON.stringify(payload));
  return `${payloadPart}.${signTokenPayload(payloadPart)}`;
}

function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';

  if (!token) {
    return res.status(401).json({ error: 'Admin token required.' });
  }

  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) {
    return res.status(401).json({ error: 'Invalid admin token.' });
  }

  const expectedSignature = signTokenPayload(payloadPart);
  const validSignature = crypto.timingSafeEqual(
    crypto.createHash('sha256').update(signature).digest(),
    crypto.createHash('sha256').update(expectedSignature).digest()
  );

  if (!validSignature) {
    return res.status(401).json({ error: 'Invalid admin token.' });
  }

  try {
    const payload = JSON.parse(fromBase64url(payloadPart));
    if (payload.sub !== 'admin' || payload.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'Admin token expired.' });
    }
    req.admin = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid admin token.' });
  }
}

function safePasswordMatch(candidate, expected) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(candidate || '')).digest(),
    crypto.createHash('sha256').update(String(expected || '')).digest()
  );
}

function parsePagination(query) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(
    Math.max(Number.parseInt(query.limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  return { page, limit, offset: (page - 1) * limit };
}

function normalizeSearch(value) {
  return String(value || '').trim().slice(0, 120);
}

function sortDirection(value) {
  return String(value || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
}

function pickSort(sort, allowed, fallback) {
  return allowed[sort] || allowed[fallback];
}

function pageMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}

function getMailTransportConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || user;

  if (!host || !from) {
    return null;
  }

  return {
    transport: {
      host,
      port,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
      auth: user && pass ? { user, pass } : undefined,
    },
    from,
  };
}

router.post('/login', (req, res) => {
  const configuredEmail = process.env.ADMIN_EMAIL;
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const { email, password } = req.body || {};

  if (!configuredEmail || !configuredPassword) {
    return res.status(503).json({
      error: 'Admin login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD.',
    });
  }

  const emailMatches = String(email || '').trim().toLowerCase() === configuredEmail.toLowerCase();
  const passwordMatches = safePasswordMatch(password, configuredPassword);

  if (!emailMatches || !passwordMatches) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  return res.json({
    token: createAdminToken(configuredEmail),
    expiresIn: 8 * 60 * 60,
    admin: { email: configuredEmail },
  });
});

router.use(verifyAdminToken);

router.get('/me', (req, res) => {
  res.json({ admin: { email: req.admin.email } });
});

router.get('/users', async (req, res, next) => {
  const { page, limit, offset } = parsePagination(req.query);
  const search = normalizeSearch(req.query.search);
  const sortMap = {
    name: 'LOWER(u.name)',
    email: 'LOWER(u.email)',
    created_at: 'u.created_at',
    total_scans: 'total_scans',
  };
  const sort = pickSort(req.query.sort, sortMap, 'created_at');
  const direction = sortDirection(req.query.direction);
  const params = [];
  const where = [];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereSql}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;
    const dataParams = [...params, limit, offset];
    const usersResult = await pool.query(
      `SELECT
         u.uid,
         COALESCE(NULLIF(u.name, ''), 'Unnamed user') AS name,
         u.email,
         u.created_at,
         COUNT(s.scan_id)::int AS total_scans
       FROM users u
       LEFT JOIN scans s ON s.user_id = u.uid
       ${whereSql}
       GROUP BY u.uid
       ORDER BY ${sort} ${direction} NULLS LAST
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      users: usersResult.rows,
      pagination: pageMeta(total, page, limit),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/scans/:scanId', async (req, res, next) => {
  const scanId = Number.parseInt(req.params.scanId, 10);

  if (!Number.isInteger(scanId) || scanId <= 0) {
    return res.status(400).json({ error: 'A valid scan id is required.' });
  }

  try {
    const result = await pool.query(
      `SELECT
         s.scan_id,
         s.user_id,
         COALESCE(NULLIF(u.name, ''), 'Unnamed user') AS user_name,
         u.email,
         s.plant_name,
         pd.scientific_name,
         pd.cleaned_data,
         s.image_hash,
         s.image_url,
         s.status,
         s.error_message,
         s.created_at,
         s.updated_at
       FROM scans s
       LEFT JOIN users u ON u.uid = s.user_id
       LEFT JOIN plant_data pd ON pd.plant_name = s.plant_name
       WHERE s.scan_id = $1
       LIMIT 1`,
      [scanId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found.' });
    }

    const row = result.rows[0];
    return res.json({
      scan: {
        scan_id: row.scan_id,
        user_id: row.user_id,
        user_name: row.user_name,
        email: row.email,
        plant_name: row.plant_name,
        scientific_name: row.scientific_name,
        image_hash: row.image_hash,
        image_url: row.image_url,
        status: row.status,
        error_message: row.error_message,
        created_at: row.created_at,
        updated_at: row.updated_at,
        scan_data: row.cleaned_data || null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/scans', async (req, res, next) => {
  const { page, limit, offset } = parsePagination(req.query);
  const requestedStatus = String(req.query.status || '').toLowerCase();
  const status = ['success', 'failed'].includes(requestedStatus) ? requestedStatus : '';
  const search = normalizeSearch(req.query.search);
  const sortMap = {
    user: 'LOWER(u.name)',
    email: 'LOWER(u.email)',
    status: 's.status',
    date: 's.created_at',
    created_at: 's.created_at',
  };
  const sort = pickSort(req.query.sort, sortMap, 'created_at');
  const direction = sortDirection(req.query.direction);
  const params = [];
  const where = [];

  if (status) {
    params.push(status);
    where.push(`s.status = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length} OR s.plant_name ILIKE $${params.length})`
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM scans s
       LEFT JOIN users u ON u.uid = s.user_id
       ${whereSql}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;
    const dataParams = [...params, limit, offset];
    const scansResult = await pool.query(
      `SELECT
         s.scan_id,
         s.user_id,
         COALESCE(NULLIF(u.name, ''), 'Unnamed user') AS user_name,
         u.email,
         s.plant_name,
         s.image_url,
         s.status,
         s.error_message,
         s.created_at
       FROM scans s
       LEFT JOIN users u ON u.uid = s.user_id
       ${whereSql}
       ORDER BY ${sort} ${direction} NULLS LAST
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      scans: scansResult.rows,
      pagination: pageMeta(total, page, limit),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/failed-scans', async (req, res, next) => {
  const { page, limit, offset } = parsePagination(req.query);
  const search = normalizeSearch(req.query.search);
  const params = ['failed'];
  const where = ['s.status = $1'];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM scans s
       LEFT JOIN users u ON u.uid = s.user_id
       ${whereSql}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;
    const dataParams = [...params, limit, offset];
    const failedResult = await pool.query(
      `SELECT
         s.scan_id,
         COALESCE(NULLIF(u.name, ''), 'Unnamed user') AS user_name,
         u.email,
         s.image_url,
         s.error_message,
         s.created_at
       FROM scans s
       LEFT JOIN users u ON u.uid = s.user_id
       ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      failedScans: failedResult.rows,
      pagination: pageMeta(total, page, limit),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics', async (req, res, next) => {
  const days = Math.min(
    Math.max(Number.parseInt(req.query.days, 10) || 30, 7),
    365
  );

  try {
    const [overviewResult, scansByDayResult, usersByDayResult] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM users) AS total_users,
           (SELECT COUNT(*)::int FROM scans) AS total_scans,
           (SELECT COUNT(*)::int FROM scans WHERE status = 'success') AS successful_scans,
           (SELECT COUNT(*)::int FROM scans WHERE status = 'failed') AS failed_scans`
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(
             CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'),
             CURRENT_DATE,
             INTERVAL '1 day'
           )::date AS day
         )
         SELECT
           TO_CHAR(days.day, 'YYYY-MM-DD') AS date,
           COUNT(s.scan_id) FILTER (WHERE s.status = 'success')::int AS successful,
           COUNT(s.scan_id) FILTER (WHERE s.status = 'failed')::int AS failed,
           COUNT(s.scan_id)::int AS total
         FROM days
         LEFT JOIN scans s ON s.created_at::date = days.day
         GROUP BY days.day
         ORDER BY days.day`,
        [days]
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(
             CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'),
             CURRENT_DATE,
             INTERVAL '1 day'
           )::date AS day
         )
         SELECT
           TO_CHAR(days.day, 'YYYY-MM-DD') AS date,
           COUNT(u.uid)::int AS registrations
         FROM days
         LEFT JOIN users u ON u.created_at::date = days.day
         GROUP BY days.day
         ORDER BY days.day`,
        [days]
      ),
    ]);

    const overview = overviewResult.rows[0] || {};
    const scanOutcomes = scansByDayResult.rows.map((row) => ({
      date: row.date,
      successful: row.successful,
      failed: row.failed,
    }));
    const scansOverTime = scansByDayResult.rows.map((row) => ({
      date: row.date,
      total: row.total,
    }));

    return res.json({
      overview: {
        totalUsers: overview.total_users || 0,
        totalScans: overview.total_scans || 0,
        successfulScans: overview.successful_scans || 0,
        failedScans: overview.failed_scans || 0,
      },
      scanOutcomes,
      scansOverTime,
      registrations: usersByDayResult.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/send-email', async (req, res, next) => {
  const email = String(req.body?.email || '').trim();
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();

  if (!email || !subject || !message) {
    return res.status(400).json({ error: 'Email, subject, and message are required.' });
  }

  const mailConfig = getMailTransportConfig();
  if (!mailConfig) {
    return res.status(503).json({
      error: 'Email service is not configured. Set SMTP_HOST and EMAIL_FROM or SMTP_USER.',
    });
  }

  try {
    const transporter = nodemailer.createTransport(mailConfig.transport);
    const result = await transporter.sendMail({
      from: mailConfig.from,
      to: email,
      subject,
      text: message,
    });

    return res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
