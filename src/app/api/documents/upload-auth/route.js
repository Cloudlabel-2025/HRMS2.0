import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { cloudinary } from '@/lib/cloudinary';

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || 'hrms_documents';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { timestamp, folder: UPLOAD_FOLDER };
    const signature = cloudinary.utils.api_sign_request(params, API_SECRET);

    return ok({
      cloudName: CLOUD_NAME,
      apiKey:    API_KEY,
      signature,
      timestamp,
      folder:    UPLOAD_FOLDER,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
