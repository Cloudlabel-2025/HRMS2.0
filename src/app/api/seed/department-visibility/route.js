import dbConnect from '@/lib/db';
import { Department } from '@/lib/models';
import { ok, fail } from '@/lib/jwt';

function getSubmittedSetupToken(req, body = {}) {
  return req.headers.get('x-setup-token') || body.setupToken || '';
}

export async function POST(req) {
  try {
    const expectedToken = process.env.SETUP_TOKEN;
    if (!expectedToken) {
      return fail('Seed route is disabled. Set SETUP_TOKEN for controlled setup.', 403);
    }

    const body = await req.json().catch(() => ({}));
    if (getSubmittedSetupToken(req, body) !== expectedToken) {
      return fail('Invalid setup token', 403);
    }

    await dbConnect();

    await Department.findOneAndUpdate(
      { name: 'Technical' },
      { $setOnInsert: { name: 'Technical', head: '', members: 0 } },
      { upsert: true }
    );

    await Department.findOneAndUpdate(
      { name: 'Functional' },
      { $setOnInsert: { name: 'Functional', head: '', members: 0 } },
      { upsert: true }
    );

    const dept = await Department.findOneAndUpdate(
      { name: 'Techno-Functional' },
      {
        $set: { visibleDepartments: [] },
        $setOnInsert: { name: 'Techno-Functional', head: '', members: 0 },
      },
      { upsert: true, new: true }
    );

    return ok({
      message: 'Department visibility rule seeded',
      department: dept.name,
      visibleDepartments: dept.visibleDepartments,
    }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
