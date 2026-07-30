import mongoose from 'mongoose';
import dbConnect from '@/lib/db';
import { getProductionConfigurationStatus } from '@/lib/runtime-config';

export async function GET() {
  try {
    const configuration = getProductionConfigurationStatus();
    if (process.env.NODE_ENV === 'production' && !configuration.valid) {
      return Response.json({ status: 'error', configuration: 'invalid', timestamp: new Date().toISOString() }, { status: 503 });
    }
    await dbConnect();
    const state = mongoose.connection.readyState;
    // 0=disconnected 1=connected 2=connecting 3=disconnecting
    const stateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    const connected = state === 1;
    return Response.json({
      status: connected ? 'ok' : 'degraded',
      mongodb: stateMap[state] ?? 'unknown',
      configuration: configuration.valid ? 'valid' : 'incomplete',
      timestamp: new Date().toISOString(),
    }, { status: connected ? 200 : 503 });
  } catch (e) {
    return Response.json({
      status: 'error',
      mongodb: 'disconnected',
      configuration: 'invalid',
      error: e.message,
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
