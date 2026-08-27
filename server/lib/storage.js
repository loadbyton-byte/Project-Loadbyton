// Storage abstraction — S3 when configured, local disk otherwise.
// Same fail-safe pattern as email/whatsapp/payments: works out-of-the-box
// with zero credentials (local uploads/), goes live the moment S3 env vars
// are set. The rest of the codebase never touches S3 directly.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const UPLOADS_DIR = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'loadbyton.db')), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let s3Client = null;
let s3Bucket = null;
if (process.env.S3_BUCKET) {
  s3Bucket = process.env.S3_BUCKET;
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    const region = process.env.AWS_REGION || 'me-central-1';
    const cfg = { region };
    // Explicit credentials only if provided; otherwise SDK falls back to
    // instance/profile credentials (EC2/ECS IRSA) as per AWS default chain.
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      cfg.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
      if (process.env.AWS_SESSION_TOKEN) cfg.credentials.sessionToken = process.env.AWS_SESSION_TOKEN;
    }
    s3Client = new S3Client(cfg);
    console.log(`[storage] S3 enabled: s3://${s3Bucket} (${region})`);
  } catch (e) {
    console.warn('[storage] @aws-sdk/client-s3 not available, falling back to local disk:', e.message);
    s3Client = null;
  }
} else {
  console.log('[storage] S3_BUCKET not set — file uploads use local disk at', UPLOADS_DIR);
}

function isS3Enabled() {
  return !!s3Client && !!s3Bucket;
}

const ALLOWED_UPLOAD_MIME_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function saveUploadedFile(jobId, mimeType, base64) {
  const ext = ALLOWED_UPLOAD_MIME_TYPES[mimeType];
  if (!ext) throw { status: 400, message: `mimeType must be one of: ${Object.keys(ALLOWED_UPLOAD_MIME_TYPES).join(', ')}` };
  if (typeof base64 !== 'string' || !base64) throw { status: 400, message: 'fileBase64 is required' };
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw { status: 400, message: 'fileBase64 is not valid base64' };
  }
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw { status: 400, message: `File must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` };
  }
  const filename = `${crypto.randomUUID()}.${ext}`;
  const key = `${jobId}/${filename}`;

  if (isS3Enabled()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }));
    return { storagePath: key, mimeType, s3: true };
  }

  const jobDir = path.join(UPLOADS_DIR, String(jobId));
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, filename), buffer);
  return { storagePath: key, mimeType, s3: false };
}

// Retrieve a stored object. For S3 this streams the GetObject result;
// for local disk it returns a filesystem path. The caller is responsible
// for setting Content-Type / Content-Disposition.
async function getFile(key) {
  if (isS3Enabled()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const result = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
    return { stream: result.Body, contentType: result.ContentType, localPath: null, s3: true };
  }
  const filePath = path.join(UPLOADS_DIR, key);
  if (!fs.existsSync(filePath)) return null;
  return { stream: fs.createReadStream(filePath), localPath: filePath, s3: false };
}

async function fileExists(key) {
  if (isS3Enabled()) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(path.join(UPLOADS_DIR, key));
}

module.exports = {
  UPLOADS_DIR,
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  isS3Enabled,
  saveUploadedFile,
  getFile,
  fileExists,
};
