import dbConnect from '@/lib/db';
import { Applicant } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const RECRUITMENT_ROLES = ['super_admin', 'admin_full', 'recruiter'];

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
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
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const body = await req.json();
  if (!body.jobId || !body.name || !body.email) return fail('jobId, name and email are required', 400);
  const applicant = await Applicant.create({
    jobId: body.jobId,
    name:  body.name,
    email: body.email,
    stage: body.stage || 'Applied',
    score: body.score || 0,
    resume: body.resume || '',
  });
  return ok(applicant, 201);
}

export async function PUT(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const body = await req.json();
  if (!body.id) return fail('Applicant id is required', 400);
  const allowed = ['stage', 'score', 'resume'];
  const update = {};
  allowed.forEach(f => { if (f in body) update[f] = body[f]; });
  const applicant = await Applicant.findByIdAndUpdate(body.id, update, { new: true });
  if (!applicant) return fail('Applicant not found', 404);
  return ok(applicant);
}
