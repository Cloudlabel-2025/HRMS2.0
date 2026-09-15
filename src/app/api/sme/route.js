import { connectDB } from '@/lib/db';
import { SME } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { z } from 'zod';

const SME_CREATE_FIELDS = ['name', 'email', 'phone', 'dob', 'pan', 'expertise', 'departments', 'accountDetails', 'rate', 'contractStart', 'contractEnd'];
const SME_UPDATE_FIELDS = ['name', 'phone', 'dob', 'pan', 'expertise', 'departments', 'accountDetails', 'rate', 'contractStart', 'contractEnd', 'status'];

const SmeCreateSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  password: z.string().min(4).max(128).optional(),
  phone: z.string().max(20).optional(),
  dob: z.string().max(20).optional().nullable(),
  pan: z.string().max(20).optional(),
  expertise: z.array(z.string().max(80)).max(30).optional(),
  departments: z.array(z.string().max(80)).max(30).optional(),
  accountDetails: z.record(z.any()).optional(),
  rate: z.object({ amount: z.coerce.number().min(0).max(100000000), type: z.string().max(20).optional() }).passthrough().optional(),
  contractStart: z.string().max(20).optional().nullable(),
  contractEnd: z.string().max(20).optional().nullable(),
}).strict();

const SmeUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(20).optional(),
  dob: z.string().max(20).optional().nullable(),
  pan: z.string().max(20).optional(),
  expertise: z.array(z.string().max(80)).max(30).optional(),
  departments: z.array(z.string().max(80)).max(30).optional(),
  accountDetails: z.record(z.any()).optional(),
  rate: z.object({ amount: z.coerce.number().min(0).max(100000000), type: z.string().max(20).optional() }).passthrough().optional(),
  contractStart: z.string().max(20).optional().nullable(),
  contractEnd: z.string().max(20).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
}).strict();

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Access denied', 403);
    await connectDB();
    const smes = await SME.find().sort({ createdAt: -1 }).populate('userId', 'name email role status');
    return ok({ smes });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Access denied', 403);
    await connectDB();

    const body = await req.json();
    const parsed = SmeCreateSchema.safeParse(body);
    if (!parsed.success) return fail('Validation failed: ' + parsed.error.issues.map(i => i.message).join(', '), 400);
    const { name, email, password, phone, dob, pan, expertise, departments, accountDetails, rate, contractStart, contractEnd } = parsed.data;

    if (!name || !email) return fail('Name and email are required', 400);

    const existingUser = await User.findOne({ email });
    if (existingUser) return fail('Email already exists', 409);

    const crypto = await import('crypto');
    const generatedPassword = password || crypto.randomBytes(4).toString('hex');

    const authUser = await User.create({
      name,
      email,
      password: generatedPassword,
      role: 'sme',
      status: 'active',
      isFirstLogin: true,
    });

    const sme = await SME.create({
      name,
      email,
      phone: phone || '',
      dob: dob || null,
      pan: pan || '',
      expertise: expertise || [],
      departments: departments || [],
      accountDetails: accountDetails || {},
      rate: rate || { amount: 0, type: 'hourly' },
      contractStart: contractStart || null,
      contractEnd: contractEnd || null,
      status: 'active',
      userId: authUser._id,
    });

    return ok({ sme, credentials: { email, password: generatedPassword } }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Access denied', 403);
    await connectDB();

    const body = await req.json();
    const parsed = SmeUpdateSchema.safeParse(body);
    if (!parsed.success) return fail('Validation failed: ' + parsed.error.issues.map(i => i.message).join(', '), 400);
    const { id } = parsed.data;
    const updateData = pick(parsed.data, SME_UPDATE_FIELDS);
    if (!id) return fail('SME ID required', 400);

    const sme = await SME.findByIdAndUpdate(id, updateData, { new: true });
    if (!sme) return fail('SME not found', 404);

    if (updateData.name && sme.userId) {
      await User.findByIdAndUpdate(sme.userId, { name: updateData.name });
    }
    await auditLog('SME Update', 'SME', user._id, `Updated SME ${sme.email || id}`, 'medium', req.headers.get('x-forwarded-for') || '', null, sme.userId || null);

    return ok({ sme });
  } catch (e) {
    return fail(e.message, 500);
  }
}
