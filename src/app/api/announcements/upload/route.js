import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role)) return fail('Access denied', 403);

    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') return fail('A valid document is required', 400);
    if (file.size === 0 || file.size > MAX_FILE_SIZE_BYTES) return fail('Attachments must be between 1 byte and 5 MB', 400);

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.has(extension)) return fail('Only images, PDF, Word, Excel, CSV, and PowerPoint files are supported', 400);

    const bytes = await file.arrayBuffer();
    const directory = join(process.cwd(), 'public', 'uploads', 'announcement-documents');
    await mkdir(directory, { recursive: true });

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    await writeFile(join(directory, filename), Buffer.from(bytes));
    const sizeKB = bytes.byteLength / 1024;

    return ok({
      name: file.name,
      url: `/uploads/announcement-documents/${filename}`,
      type: extension,
      size: sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB.toFixed(1)} KB`,
    }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
