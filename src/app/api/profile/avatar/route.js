import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';

const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const file = (await req.formData()).get('photo');
    if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') return fail('Please choose a profile image', 400);
    if (!ALLOWED_TYPES.has(file.type)) return fail('Only JPG, PNG, and WebP images are allowed', 400);
    if (file.size === 0 || file.size > MAX_FILE_SIZE) return fail('Profile image must be 5 MB or smaller', 400);

    const bytes = Buffer.from(await file.arrayBuffer());
    const directory = join(process.cwd(), 'public', 'uploads', 'profile-photos');
    await mkdir(directory, { recursive: true });
    const extension = ALLOWED_TYPES.get(file.type);
    const filename = `${user._id}-${Date.now()}.${extension}`;
    await writeFile(join(directory, filename), bytes);

    const profilePhoto = `/uploads/profile-photos/${filename}`;
    await connectDB();
    await User.findByIdAndUpdate(user._id, { profilePhoto });
    await auditLog('Profile Photo Updated', 'Profile', user._id, 'Updated their profile photo', 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    return ok({ profilePhoto });
  } catch (e) {
    return fail(e.message || 'Unable to update profile photo', 500);
  }
}

export async function DELETE(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const account = await User.findById(user._id).select('profilePhoto');
    const photoPath = account?.profilePhoto || '';
    if (photoPath.startsWith('/uploads/profile-photos/')) {
      const filename = photoPath.replace('/uploads/profile-photos/', '');
      if (/^[a-zA-Z0-9_.-]+$/.test(filename)) {
        await unlink(join(process.cwd(), 'public', 'uploads', 'profile-photos', filename)).catch(() => {});
      }
    }
    await User.findByIdAndUpdate(user._id, { profilePhoto: '' });
    await auditLog('Profile Photo Removed', 'Profile', user._id, 'Removed their profile photo', 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    return ok({ profilePhoto: '' });
  } catch (e) {
    return fail(e.message || 'Unable to remove profile photo', 500);
  }
}
