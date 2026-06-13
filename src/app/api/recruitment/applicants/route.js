import dbConnect from '@/lib/db';
import { Applicant } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
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
  const ip = req.headers.get('x-forwarded-for') || '';
  const body = await req.json();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const qualification = String(body.qualification || '').trim();
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (!body.jobId || !name || !email || !phone || !qualification) {
    auditLog('Applicant Add Failed', 'Recruitment', user._id,
      `Missing fields: ${[!body.jobId && 'jobId', !name && 'name', !email && 'email', !phone && 'phone', !qualification && 'qualification'].filter(Boolean).join(', ')}`,
      'low', ip, null, user._id);
    return fail('jobId, name, email, phone and qualification are required', 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Valid email is required', 400);
  if (!/^[0-9]{10}$/.test(phone)) return fail('Phone must be 10 digits', 400);
  if (body.isFresher === false && !Number(body.experienceYears || 0)) return fail('Years of experience is required', 400);
  const previousRejected = await Applicant.findOne({
    $and: [
      { $or: [{ stage: 'Rejected' }, { rejectionReason: { $nin: ['', null] } }, { rejectedAt: { $ne: null } }] },
      { $or: [
        { email },
        { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
        { phone },
      ] },
    ],
  }).sort({ rejectedAt: -1, updatedAt: -1 });
  const matchedBy = previousRejected
    ? [
        previousRejected.email?.toLowerCase() === email ? 'email' : '',
        phone && previousRejected.phone === phone ? 'phone' : '',
      ].filter(Boolean).join('_')
    : '';
  const applicant = await Applicant.create({
    jobId: body.jobId, name, email, phone,
    stage: body.stage || 'Applied',
    score: body.score || 0,
    resume: body.resume || '',
    qualification,
    skills: Array.isArray(body.skills) ? body.skills : [],
    isFresher: body.isFresher !== false,
    experienceYears: Number(body.experienceYears || 0),
    referralName: body.referralName || '',
    referralFromOffice: !!body.referralFromOffice,
    referralEmployeeId: body.referralEmployeeId || null,
    previousRejection: previousRejected ? {
      matchedBy,
      applicantId: previousRejected._id,
      reason: previousRejected.rejectionReason || '',
      rejectedAt: previousRejected.rejectedAt || previousRejected.updatedAt || null,
    } : undefined,
  });
  auditLog('Applicant Added', 'Recruitment', user._id, `Added applicant ${body.name} (${email})${previousRejected ? ' with prior rejection match' : ''}`, previousRejected ? 'medium' : 'low', ip, null, user._id);
  return ok(applicant, 201);
}

export async function PUT(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!RECRUITMENT_ROLES.includes(user.role)) return fail('Access denied', 403);
  await dbConnect();
  const ip = req.headers.get('x-forwarded-for') || '';
  const body = await req.json();
  if (!body.id) {
    auditLog('Applicant Update Failed', 'Recruitment', user._id, 'Missing applicant id', 'low', ip, null, user._id);
    return fail('Applicant id is required', 400);
  }
  const allowed = ['stage', 'score', 'resume', 'qualification', 'skills', 'isFresher', 'experienceYears', 'referralName', 'referralFromOffice', 'referralEmployeeId', 'phone', 'rejectionReason', 'onboardedAt', 'onboardedEmployeeId', 'name', 'email', 'jobId'];
  const update = {};
  allowed.forEach(f => { if (f in body) update[f] = body[f]; });
  if (update.phone) update.phone = String(update.phone).replace(/\D/g, '');
  if (update.stage === 'Rejected') {
    const reason = String(body.rejectionReason || '').trim();
    if (!reason) return fail('Rejection reason is required', 400);
    update.rejectionReason = reason;
    update.rejectedAt = new Date();
    update.rejectedBy = user._id;
  }
  const applicant = await Applicant.findByIdAndUpdate(body.id, update, { new: true });
  if (!applicant) {
    auditLog('Applicant Update Failed', 'Recruitment', user._id, `Applicant ${body.id} not found`, 'low', ip, null, user._id);
    return fail('Applicant not found', 404);
  }
  auditLog('Applicant Updated', 'Recruitment', user._id, `Updated applicant ${applicant.name} stage to ${update.stage || applicant.stage}`, 'low', ip, null, user._id);
  return ok(applicant);
}
