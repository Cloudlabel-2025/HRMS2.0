import mongoose from 'mongoose';
import { setServers } from 'node:dns';
import { assertProductionConfiguration } from './runtime-config';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('Please define MONGODB_URI in .env.local');

// Optional resolver override for networks that refuse Atlas SRV/TXT lookups.
// Keep the system resolver unless the local environment explicitly opts in.
const dnsServers = process.env.MONGODB_DNS_SERVERS?.split(',').map(server => server.trim()).filter(Boolean);
if (dnsServers?.length) setServers(dnsServers);

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function dbConnect() {
  assertProductionConfiguration();
  if (cached.conn) {
    // mongoose.connect resolves to Mongoose, not its Connection object.
    if (cached.conn.connection?.readyState === 1) return cached.conn;
    cached.conn = null;
    cached.promise = null;
  }

  // All callers share the same attempt and the same failure. Retrying inside
  // each waiting request used to create a reconnect storm during outages.
  if (cached.promise) return cached.promise;
  if (cached.retryAfter > Date.now()) throw cached.error;

  cached.promise = mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
    family: 4,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    waitQueueTimeoutMS: 10000,
  }).then(conn => {
    cached.conn = conn;
    cached.error = null;
    cached.retryAfter = 0;
    return conn;
  }).catch((err) => {
    cached.conn = null;
    cached.error = err;
    cached.retryAfter = Date.now() + 3000;
    throw err;
  }).finally(() => {
    cached.promise = null;
  });

  return cached.promise;
}

export default dbConnect;
export { dbConnect as connectDB };
