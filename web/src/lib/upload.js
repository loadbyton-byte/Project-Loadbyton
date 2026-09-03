// Client-side half of the base64-JSON upload (see saveUploadedFile in
// server/index.js) — no multipart/FormData involved, just a File read into
// a data URL and the base64 payload split off it.

export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
export const ALLOWED_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function fileToBase64(file) {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    return Promise.reject(new Error('File must be a JPEG, PNG, WEBP, or PDF.'));
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.reject(new Error(`File must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ base64: reader.result.split(',')[1], mimeType: file.type });
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

// Direct-to-R2 upload when the backend has S3 configured, base64-inline
// fallback otherwise (local disk dev, or S3 not yet set up) — same
// validation either way, decided entirely by what mintUploadUrl returns.
// mintUploadUrl is one of the api.js *UploadUrl calls, e.g.
// (mimeType) => api.getDriverUploadUrl(driverId, mimeType).
export async function uploadFile(file, mintUploadUrl) {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    throw new Error('File must be a JPEG, PNG, WEBP, or PDF.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`);
  }
  const presign = await mintUploadUrl(file.type).catch(() => null);
  if (presign && presign.uploadUrl) {
    const putRes = await fetch(presign.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!putRes.ok) throw new Error('Upload failed — try again.');
    return { storageKey: presign.key, mimeType: file.type };
  }
  const { base64, mimeType } = await fileToBase64(file);
  return { fileBase64: base64, mimeType };
}

export function documentFileUrl(jobId, doc) {
  return doc.storage_path ? `/api/jobs/${jobId}/documents/${doc.id}/file` : doc.file_url;
}

export function driverDocumentUrl(driverId, docType) {
  return `/api/fleet/drivers/${driverId}/documents/${docType}`;
}
