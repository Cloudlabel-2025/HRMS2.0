import { v2 as cloudinary } from 'cloudinary';

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || 'hrms_documents';

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key:    API_KEY,
  api_secret: API_SECRET,
});

export async function uploadFile(buffer, { fileName, folder } = {}) {
  const publicId = fileName
    ? `${Date.now()}-${fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`
    : undefined;

  const base64 = buffer.toString('base64');

  const result = await cloudinary.uploader.upload(`data:application/octet-stream;base64,${base64}`, {
    folder:        folder || UPLOAD_FOLDER,
    public_id:     publicId,
    resource_type: 'auto',
    timeout:       120000,
  });

  return {
    url:      result.secure_url,
    publicId: result.public_id,
    bytes:    result.bytes,
    format:   result.format,
    mimeType: result.format
      ? (result.resource_type === 'image' ? `image/${result.format}` : `application/${result.format}`)
      : 'application/octet-stream',
  };
}

export async function deleteFile(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

export { cloudinary };
