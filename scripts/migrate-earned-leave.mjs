import { register } from 'node:module';
import nextEnv from '@next/env';
import mongoose from 'mongoose';
import { setServers } from 'node:dns';

register('./.alias-loader.mjs', import.meta.url);
const envFile = process.argv.find(argument => argument.startsWith('--env-file='))?.slice(11);
if (envFile) process.loadEnvFile(envFile);
else nextEnv.loadEnvConfig(process.cwd());
if (process.env.MONGODB_DNS_SERVERS) setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim()));
let deadline = setTimeout(() => {
  console.error('Database connection/migration timed out. Re-run preview to check the current state.');
  process.exit(2);
}, 20000);
try {
  if (!process.env.MONGODB_URI) throw new Error('Missing database configuration');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, family: 4 });
  clearTimeout(deadline);
  deadline = setTimeout(() => { console.error('Migration timed out. Re-run preview to check state.'); process.exit(2); }, 120000);
  const { migrateEarnedLeave } = await import('../src/lib/leave/migrate-earned-leave.js');
  console.log(JSON.stringify(await migrateEarnedLeave({ apply: process.argv.includes('--apply') })));
} catch (error) {
  console.error(`Migration did not complete: ${error.name}. No secret values were displayed.`);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await mongoose.disconnect();
}
