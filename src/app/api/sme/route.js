import { connectDB } from '@/lib/db';
import { SME } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

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
    const { name, email, password, phone, dob, pan, expertise, departments, accountDetails, rate, contractStart, contractEnd } = body;

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
    const { id, ...updateData } = body;
    if (!id) return fail('SME ID required', 400);

    const sme = await SME.findByIdAndUpdate(id, updateData, { new: true });
    if (!sme) return fail('SME not found', 404);

    if (updateData.name && sme.userId) {
      await User.findByIdAndUpdate(sme.userId, { name: updateData.name });
    }

    return ok({ sme });
  } catch (e) {
    return fail(e.message, 500);
  }
}
