import mongoose from 'mongoose';
import { assertProductionConfiguration } from './runtime-config';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('Please define MONGODB_URI in .env.local');

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function dbConnect() {
  assertProductionConfiguration();
  if (cached.conn) {
    if (cached.conn.readyState === 1) return cached.conn;
    cached.conn = null;
    cached.promise = null;
  }

  if (cached.promise) {
    try {
      cached.conn = await cached.promise;
      return cached.conn;
    } catch {
      cached.promise = null;
      cached.conn = null;
    }
  }

  cached.promise = mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
    family: 4,
  }).catch((err) => {
    cached.promise = null;
    cached.conn = null;
    throw err;
  });

  cached.conn = await cached.promise;
  return cached.conn;
}

export default dbConnect;
export { dbConnect as connectDB };
