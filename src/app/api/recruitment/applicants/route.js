import dbConnect from '@/lib/db';
import { Applicant } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const filter = jobId ? { jobId } : {};
  const applicants = await Applicant.find(filter).sort({ createdAt: -1 });
  return ok(applicants);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const body = await req.json();
  const applicant = await Applicant.create(body);
  return ok(applicant, 201);
}

export async function PUT(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const { id, stage } = await req.json();
  const applicant = await Applicant.findByIdAndUpdate(id, { stage }, { new: true });
  return ok(applicant);
}
