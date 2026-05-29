import dbConnect from '@/lib/db';
import { JobPosting } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();
  const jobs = await JobPosting.find().sort({ createdAt: -1 });
  return ok(jobs);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const body = await req.json();
  const job = await JobPosting.create({ ...body, postedBy: user._id });
  return ok(job, 201);
}
