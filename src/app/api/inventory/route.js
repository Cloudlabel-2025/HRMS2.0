import { connectDB } from '@/lib/db';
import { Asset, Stock } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type'); // 'assets' | 'stock'

    if (type === 'stock') {
      const stock = await Stock.find().sort({ item: 1 });
      return ok({ stock });
    }

    const assets = await Asset.find()
      .populate('assignedTo', 'name avatar department')
      .sort({ createdAt: -1 });
    return ok({ assets });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    const { id, ...body } = await req.json();
    const asset = await Asset.findByIdAndUpdate(id, body, { new: true }).populate('assignedTo', 'name avatar');
    return ok({ asset });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();

    const body = await req.json();
    if (body.type === 'stock') {
      const stock = await Stock.create(body);
      return ok({ stock }, 201);
    }
    const asset = await Asset.create(body);
    return ok({ asset }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
