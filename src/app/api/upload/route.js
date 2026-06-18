import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const formData = await req.formData();
    const file = formData.get('file');
    if (!file) return fail('No file provided', 400);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = join(process.cwd(), 'public', 'uploads', 'project-documents');
    await mkdir(uploadDir, { recursive: true });

    const ext = file.name.split('.').pop() || '';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const path = join(uploadDir, filename);
    await writeFile(path, buffer);

    const url = `/uploads/project-documents/${filename}`;
    const fileType = ext.toLowerCase();
    const sizeKB = (buffer.length / 1024).toFixed(1);

    return ok({ url, fileType, fileName: file.name, fileSize: sizeKB > 1024 ? `${(buffer.length / 1048576).toFixed(1)} MB` : `${sizeKB} KB` }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
