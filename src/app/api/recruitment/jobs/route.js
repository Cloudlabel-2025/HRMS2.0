import dbConnect from '@/lib/db';
import { JobPosting } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const RECRUITMENT_ROLES = ['super_admin', 'admin_full', 'recruiter'];

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const jobs = await JobPosting.find().sort({ createdAt: -1 });
  return ok(jobs);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const body = await req.json();
  if (!body.title) return fail('Job title is required', 400);
  const job = await JobPosting.create({
    title:      body.title,
    department: body.department || '',
    type:       body.type || 'Full-time',
    status:     body.status || 'active',
    createdBy:  user._id,
  });
  return ok(job, 201);
}
