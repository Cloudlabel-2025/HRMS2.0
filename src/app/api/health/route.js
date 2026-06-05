import mongoose from 'mongoose';
import dbConnect from '@/lib/db';

export async function GET() {
  try {
    await dbConnect();
    const state = mongoose.connection.readyState;
    // 0=disconnected 1=connected 2=connecting 3=disconnecting
    const stateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    const connected = state === 1;
    return Response.json({
      status: connected ? 'ok' : 'degraded',
      mongodb: stateMap[state] ?? 'unknown',
      timestamp: new Date().toISOString(),
    }, { status: connected ? 200 : 503 });
  } catch (e) {
    return Response.json({
      status: 'error',
      mongodb: 'disconnected',
      error: e.message,
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
