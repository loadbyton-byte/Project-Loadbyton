// Storage abstraction — S3 when configured, local disk otherwise.
// Same fail-safe pattern as email/whatsapp/payments: works out-of-the-box
// with zero credentials (local uploads/), goes live the moment S3 env vars
// are set. The rest of the codebase never touches S3 directly.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Default DB_PATH here must match server/db.js's own default
// (path.join(__dirname, 'data', ...) from server/, i.e. server/data/) —
// this file lives in server/lib/, so it needs an extra '..' to land on the
// same directory rather than a sibling server/lib/data/ that .gitignore's
// server/data/uploads/ rule doesn't cover.
const UPLOADS_DIR = path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'loadbyton.db')), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let s3Client = null;
let s3Bucket = null;
if (process.env.S3_BUCKET) {
  s3Bucket = process.env.S3_BUCKET;
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    // Cloudflare R2 (and most S3-compatible providers) require region
    // 'auto' and their own endpoint + path-style addressing — real AWS S3
    // needs neither. S3_ENDPOINT being set is what distinguishes the two.
    const region = process.env.AWS_REGION || (process.env.S3_ENDPOINT ? 'auto' : 'me-central-1');
    const cfg = { region };
    if (process.env.S3_ENDPOINT) {
      cfg.endpoint = process.env.S3_ENDPOINT;
      cfg.forcePathStyle = true;
    }
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
    console.log(`[storage] S3 enabled: s3://${s3Bucket} (${region}${process.env.S3_ENDPOINT ? `, endpoint ${process.env.S3_ENDPOINT}` : ''})`);
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

// Raw put, no mime/size validation — for server-internal writes (DB
// backups) rather than user-facing uploads. saveUploadedFile below layers
// its own validation on top of this for the user-upload path.
async function putObject(key, buffer, contentType) {
  if (isS3Enabled()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));
    return { storagePath: key, s3: true };
  }
  const filePath = path.join(UPLOADS_DIR, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return { storagePath: key, s3: false };
}

// Presigned direct-to-bucket upload — the fix for docs/DISASTER_RECOVERY.md's
// "upload/IOPS pressure" scenario: the browser PUTs the file straight to R2
// using this URL, so a burst of concurrent uploads never touches the app
// server's CPU/memory at all (today's saveUploadedFile path routes every
// byte through this Node process as base64 in the request body). Returns
// null when S3 isn't configured — callers fall back to the base64 path,
// which is the only option that makes sense against local disk anyway.
async function getPresignedUploadUrl(prefix, mimeType) {
  if (!isS3Enabled()) return null;
  const ext = ALLOWED_UPLOAD_MIME_TYPES[mimeType];
  if (!ext) throw { status: 400, message: `mimeType must be one of: ${Object.keys(ALLOWED_UPLOAD_MIME_TYPES).join(', ')}` };
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  // A presigned PUT signs method+path+headers, not a size policy — MAX_UPLOAD_BYTES
  // isn't enforceable here the way it is on the base64 path (that would need
  // presigned POST + a content-length-range condition, a different API and
  // an extra package). Accepted trade-off for a first version: the uploader
  // is always an authenticated user acting on their own account, and R2's
  // free tier caps total bucket size regardless — a single oversized file
  // is a storage-hygiene concern, not a security one, unlike an
  // unauthenticated write path would be.
  const command = new PutObjectCommand({ Bucket: s3Bucket, Key: key, ContentType: mimeType });
  // 5 minutes — long enough for a slow mobile upload, short enough that a
  // leaked URL isn't a standing write hole into the bucket.
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  return { key, uploadUrl, mimeType };
}

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
  const { s3 } = await putObject(key, buffer, mimeType);
  return { storagePath: key, mimeType, s3 };
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
  putObject,
  getPresignedUploadUrl,
  saveUploadedFile,
  getFile,
  fileExists,
};
