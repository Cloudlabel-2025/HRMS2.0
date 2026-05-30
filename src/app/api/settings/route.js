import dbConnect from '@/lib/db';
import { Department, Shift, Holiday, SystemConfig } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const MODEL_MAP = { departments: Department, shifts: Shift, holidays: Holiday, config: SystemConfig };

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();
  const type = new URL(req.url).searchParams.get('type');
  if (!MODEL_MAP[type]) return fail('Invalid type', 400);
  const data = await MODEL_MAP[type].find();
  return ok(data);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();
  const { type, ...body } = await req.json();
  if (!MODEL_MAP[type]) return fail('Invalid type', 400);
  
  if (type === 'config') {
    const doc = await MODEL_MAP[type].findOneAndUpdate({ key: body.key }, { value: body.value }, { new: true, upsert: true });
    return ok(doc);
  }
  
  const doc = await MODEL_MAP[type].create(body);
  return ok(doc, 201);
}

export async function PUT(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();
  const { type, id, ...body } = await req.json();
  if (!MODEL_MAP[type]) return fail('Invalid type', 400);
  const doc = await MODEL_MAP[type].findByIdAndUpdate(id, body, { new: true });
  return ok(doc);
}

export async function DELETE(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();
  const { type, id } = await req.json();
  if (!MODEL_MAP[type] || type === 'config') return fail('Invalid type', 400);
  await MODEL_MAP[type].findByIdAndDelete(id);
  return ok({ deleted: true });
}
