const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const bucketName =
  process.env.CLOUDFLARE_BUCKET_NAME || process.env.CLOUDFLARE_BUCKET || '';
const publicBaseUrl =
  process.env.R2_PUBLIC_IMAGES || process.env.CLOUDFLARE_PUBLIC_DOMAIN || '';
const endpoint = process.env.R2_ENDPOINT || '';
const region = process.env.R2_REGION || 'auto';
const accessKeyId =
  process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_ACCESS_KEY_ID || '';
const secretAccessKey =
  process.env.R2_SECRET_ACCESS_KEY ||
  process.env.CLOUDFLARE_SECRET_ACCESS_KEY ||
  '';

const isConfigured =
  Boolean(bucketName) &&
  Boolean(publicBaseUrl) &&
  Boolean(endpoint) &&
  Boolean(accessKeyId) &&
  Boolean(secretAccessKey);

const client = isConfigured
  ? new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  : null;

function normalizePublicBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

async function uploadScanImage(filePath, { userId, imageHash }) {
  if (!isConfigured || !client || !filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase() || '.jpg';
  const key = `scans/${userId}/${imageHash}${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: ext === '.png' ? 'image/png' : 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  return `${normalizePublicBaseUrl(publicBaseUrl)}/${key}`;
}

module.exports = {
  uploadScanImage,
  isStorageConfigured: isConfigured,
};
