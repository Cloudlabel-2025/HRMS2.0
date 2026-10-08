import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

const { MongoClient, BSON } = mongoose.mongo;
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--apply', '--writes-paused', '--verify', '--help', '--resume']);
if ([...args].some(arg => !allowed.has(arg))) throw new Error('Unknown migration argument');
if (args.has('--help')) {
  console.log('node scripts/migrate-database.mjs [--apply --writes-paused | --verify]\nCredentials and explicit DB name: .env.migration.local (ignored by Git). Default: read-only inspection.');
  process.exit(0);
}
if (args.has('--apply') && (!args.has('--writes-paused') || args.has('--verify'))) {
  throw new Error('Apply requires --writes-paused and cannot be combined with --verify');
}
if (args.has('--resume') && !args.has('--apply')) throw new Error('Resume requires --apply --writes-paused');
if (fs.existsSync('.env.migration.local')) {
  for (const line of fs.readFileSync('.env.migration.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^(MIGRATION_\w+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
const sourceUri = process.env.MIGRATION_SOURCE_URI;
const targetUri = process.env.MIGRATION_TARGET_URI;
const databaseName = process.env.MIGRATION_DB_NAME;
const targetDatabaseName = process.env.MIGRATION_TARGET_DB_NAME || databaseName;
if (!sourceUri || !targetUri || !databaseName) throw new Error('Set MIGRATION_SOURCE_URI, MIGRATION_TARGET_URI and MIGRATION_DB_NAME');
if (new URL(sourceUri).host === new URL(targetUri).host) throw new Error('Source and target must be different clusters');
if (['admin', 'local', 'config'].includes(databaseName)) throw new Error('System databases cannot be migrated');
if (['admin', 'local', 'config'].includes(targetDatabaseName)) throw new Error('System databases cannot be migrated');
const options = { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000, socketTimeoutMS: 60000, family: 4, promoteValues: false, promoteLongs: false };
const source = new MongoClient(sourceUri, options);
const target = new MongoClient(targetUri, options);

async function connect(client) {
  let timer;
  try {
    await Promise.race([client.connect(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('ConnectionTimeout')), 25000);
    })]);
  } finally { clearTimeout(timer); }
}

async function fingerprint(collection) {
  const hash = createHash('sha256');
  let count = 0;
  for await (const document of collection.find({}, { raw: true }).sort({ _id: 1 })) {
    hash.update(document);
    count++;
  }
  return { count, sha256: hash.digest('hex') };
}

const indexSpec = ({ v, ns, ...index }) => index;
const same = (a, b) => BSON.EJSON.stringify(a, { relaxed: false }) === BSON.EJSON.stringify(b, { relaxed: false });

async function verifyCollection(a, b, name, expected) {
  const current = await fingerprint(a.collection(name));
  const copied = await fingerprint(b.collection(name));
  if (!same(current, copied) || (expected && !same(current, { count: expected.count, sha256: expected.sha256 }))) {
    throw new Error(`VerificationFailed: document contents/count changed for ${name}`);
  }
  const normalize = indexes => indexes.map(indexSpec).sort((x, y) => x.name.localeCompare(y.name));
  if (!same(normalize(await a.collection(name).listIndexes().toArray()), normalize(await b.collection(name).listIndexes().toArray()))) {
    throw new Error(`VerificationFailed: index definitions differ for ${name}`);
  }
  console.log(`Verified ${name}: ${current.count} documents, SHA-256 and indexes match`);
  return current;
}

async function run() {
  await connect(source);
  await connect(target);
  const a = source.db(databaseName);
  const b = target.db(targetDatabaseName);
  const collections = (await a.listCollections().toArray()).sort((x, y) => x.name.localeCompare(y.name));
  if (!collections.length) throw new Error('Source database is empty; check MIGRATION_DB_NAME');
  for (const collection of collections) {
    if (collection.type !== 'collection' || collection.name.startsWith('system.') || collection.options?.timeseries || collection.options?.encryptedFields) {
      throw new Error(`Unsupported collection ${collection.name}; use MongoDB Database Tools for this database`);
    }
  }
  const existing = await b.listCollections().toArray();
  if (args.has('--verify')) {
    if (!same(collections.map(c => c.name), existing.map(c => c.name).sort())) throw new Error('VerificationFailed: collection names differ');
    for (const collection of collections) {
      const destination = existing.find(c => c.name === collection.name);
      if (!same(collection.options, destination.options)) throw new Error(`VerificationFailed: collection options differ for ${collection.name}`);
      await verifyCollection(a, b, collection.name);
    }
    return;
  }
  console.log(`Source ${new URL(sourceUri).hostname}/${databaseName}; target ${new URL(targetUri).hostname}/${targetDatabaseName}`);
  for (const { name } of collections) console.log(`${name}: ${await a.collection(name).countDocuments()} documents`);
  if (existing.length && !args.has('--resume')) throw new Error('Target database already has collections. Refusing to overwrite or merge data.');
  if (args.has('--resume')) {
    const priorPath = process.env.MIGRATION_BACKUP_PATH;
    if (!priorPath) throw new Error('Resume requires MIGRATION_BACKUP_PATH');
    const prior = JSON.parse(fs.readFileSync(path.join(priorPath, 'manifest.json'), 'utf8'));
    if (prior.verified || prior.databaseName !== databaseName || prior.targetDatabaseName !== targetDatabaseName || !same(prior.collections.map(c => c.name), collections.map(c => c.name))) {
      throw new Error('VerificationFailed: resume backup does not match migration');
    }
    // Existing target collections must match both the recorded backup and source.
    // Never replace, merge or delete destination documents during resume.
    for (const collection of existing) {
      const snapshot = prior.collections.find(c => c.name === collection.name);
      if (!snapshot) throw new Error('VerificationFailed: unexpected destination collection');
      const file = fs.readFileSync(path.join(priorPath, `${collection.name}.bson`));
      if (createHash('sha256').update(file).digest('hex') !== snapshot.sha256) throw new Error('VerificationFailed: backup checksum mismatch');
      await verifyCollection(a, b, collection.name, snapshot);
    }
    console.log('Resume validated. Taking a fresh complete backup before restoring missing collections.');
  }
  if (!args.has('--apply')) {
    console.log('Read-only preflight passed. No data changed. Pause all writers before --apply --writes-paused.');
    return;
  }

  // Back up every collection BEFORE making any target changes. BSON preserves IDs,
  // dates, binary values and numeric types; these files also work with mongorestore.
  const backup = path.resolve('backups', `migration-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backup, { recursive: true });
  const manifest = { databaseName, targetDatabaseName, startedAt: new Date().toISOString(), collections: [], verified: false };
  const manifestPath = path.join(backup, 'manifest.json');
  const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  saveManifest();
  for (const { name, options: collectionOptions } of collections) {
    if (/[\\/]/.test(name)) throw new Error('Unsafe backup filename');
    const collection = a.collection(name);
    const indexes = await collection.listIndexes().toArray();
    fs.writeFileSync(path.join(backup, `${name}.metadata.json`), BSON.EJSON.stringify({ options: collectionOptions, indexes }, { relaxed: false }));
    const file = fs.createWriteStream(path.join(backup, `${name}.bson`), { flags: 'wx' });
    // Capture errors even when the stream is not waiting for drain.
    let streamError;
    file.on('error', error => { streamError = error; });
    const hash = createHash('sha256');
    let count = 0;
    try {
      for await (const raw of collection.find({}, { raw: true }).sort({ _id: 1 })) {
        if (streamError) throw streamError;
        if (!file.write(raw)) await once(file, 'drain');
        hash.update(raw);
        count++;
      }
      file.end();
      await once(file, 'finish');
    } catch (error) { file.destroy(); throw error; }
    const snapshot = { name, count, sha256: hash.digest('hex') };
    if (!same(await fingerprint(collection), { count, sha256: snapshot.sha256 })) throw new Error(`SourceChanged: ${name}; keep writes paused`);
    manifest.collections.push(snapshot);
    saveManifest();
    console.log(`Backed up ${name}: ${count} documents`);
  }
  // A second destination check reduces the chance of colliding with an active app.
  const latestTarget = await b.listCollections().toArray();
  if (!same(existing.map(c => c.name).sort(), latestTarget.map(c => c.name).sort())) throw new Error('Target changed during backup; refusing to overwrite');
  for (const { name, options: collectionOptions } of collections) {
    if (existing.some(c => c.name === name)) {
      await verifyCollection(a, b, name, manifest.collections.find(c => c.name === name));
      continue;
    }
    await b.createCollection(name, { ...collectionOptions, writeConcern: { w: 'majority' } });
    const collection = b.collection(name);
    // Read BSON records with a bounded buffer, avoiding loading whole collections.
    const fd = fs.openSync(path.join(backup, `${name}.bson`), 'r');
    let position = 0;
    let batch = [];
    let bytes = 0;
    const flush = async () => {
      if (batch.length) await collection.insertMany(batch, { ordered: true, writeConcern: { w: 'majority' } });
      batch = []; bytes = 0;
    };
    try {
      while (true) {
        const header = Buffer.alloc(4);
        const read = fs.readSync(fd, header, 0, 4, position);
        if (!read) break;
        const size = header.readInt32LE(0);
        if (read !== 4 || size < 5 || size > 16 * 1024 * 1024) throw new Error('Invalid BSON backup record');
        const record = Buffer.alloc(size);
        header.copy(record);
        if (fs.readSync(fd, record, 4, size - 4, position + 4) !== size - 4) throw new Error('Truncated BSON backup');
        if (bytes + size > 8 * 1024 * 1024 || batch.length >= 500) await flush();
        batch.push(BSON.deserialize(record, { promoteValues: false, promoteLongs: false }));
        bytes += size;
        position += size;
      }
      await flush();
    } finally { fs.closeSync(fd); }
    const indexes = BSON.EJSON.parse(fs.readFileSync(path.join(backup, `${name}.metadata.json`), 'utf8')).indexes;
    const additional = indexes.filter(index => index.name !== '_id_').map(indexSpec);
    if (additional.length) await collection.createIndexes(additional, { writeConcern: { w: 'majority' } });
    await verifyCollection(a, b, name, manifest.collections.find(c => c.name === name));
  }
  const after = (await a.listCollections().toArray()).sort((x, y) => x.name.localeCompare(y.name));
  if (!same(collections, after)) throw new Error('SourceChanged: collection definitions changed');
  // Verify again after ALL collections are restored to catch changes during copying.
  for (const { name } of collections) await verifyCollection(a, b, name, manifest.collections.find(c => c.name === name));
  manifest.verified = true;
  manifest.completedAt = new Date().toISOString();
  saveManifest();
  console.log(`Migration verified. Private backup: ${backup}. Keep writes paused until Vercel cutover completes.`);
}

try { await run(); }
catch (error) {
  // Never emit raw driver errors, URIs, credentials or failed document contents.
  const safe = /^(VerificationFailed:|SourceChanged:|Target |Source database|Unsupported collection|Unsafe backup|Invalid BSON|Truncated BSON)/.test(error.message);
  console.error(safe ? error.message : `Migration failed (${error.name}, code ${error.code ?? 'unavailable'}). Check Atlas access, credentials and permissions.`);
  for (const server of error.reason?.servers?.values?.() ?? []) {
    const failure = server.error;
    if (failure) console.error(`Server failure: ${failure.name}; code ${failure.code ?? failure.cause?.code ?? 'unavailable'}`);
  }
  process.exitCode = 1;
} finally { await Promise.allSettled([source.close(), target.close()]); }
