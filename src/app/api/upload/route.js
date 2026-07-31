import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { Project } from '@/lib/models/Task';
import { canManageUser } from '@/lib/rbac';

const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'png', 'jpg', 'jpeg']);
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024;

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const formData = await req.formData();
    const file = formData.get('file');
    const projectId = String(formData.get('projectId') || '').trim();
    if (!projectId) return fail('projectId is required', 400);
    if (!file) return fail('No file provided', 400);
    if (typeof file.name !== 'string' || typeof file.size !== 'number') return fail('Invalid file upload', 400);
    if (file.size === 0 || file.size > MAX_FILE_SIZE_BYTES) return fail('Files must be between 1 byte and 3 MB', 400);

    const project = await Project.findById(projectId).select('team').lean();
    if (!project) return fail('Project not found', 404);

    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
    const teamIds = (project.team || []).map(id => id.toString());
    const isMember = teamIds.includes(user._id.toString());
    const managesMember = (await Promise.all(teamIds.map(id => canManageUser(user, id)))).some(Boolean);
    if (!isAdmin && !isMember && !managesMember) return fail('Access denied', 403);

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.has(ext)) return fail('Unsupported file type', 400);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = join(process.cwd(), 'public', 'uploads', 'project-documents');
    await mkdir(uploadDir, { recursive: true });

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
