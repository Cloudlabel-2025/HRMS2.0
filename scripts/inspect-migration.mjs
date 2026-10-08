import fs from 'node:fs';
import { MongoClient } from 'mongodb';

// This file is ignored by Git. Never log connection strings or document contents.
for (const line of fs.readFileSync('.env.migration.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^(MIGRATION_\w+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
for (const side of ['SOURCE', 'TARGET']) {
  const uri = process.env[`MIGRATION_${side}_URI`];
  if (!uri) throw new Error(`Missing MIGRATION_${side}_URI`);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, family: 4 });
  try {
    let timeout;
    try {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('ConnectionTimeout')), 25000); }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    console.log(`${side}: connected to ${new URL(uri).hostname}; default DB ${client.db().databaseName}`);
    const result = await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
    for (const { name } of result.databases) {
      if (['admin', 'local', 'config'].includes(name)) continue;
      const db = client.db(name);
      const collections = await db.listCollections().toArray();
      console.log(`Database ${name}: ${collections.length} collections`);
      for (const collection of collections) {
        const count = await db.collection(collection.name).countDocuments();
        console.log(`  ${collection.name}: ${count} documents (${collection.type})`);
      }
    }
  } catch (error) {
    // Error messages may contain secrets. Print only the error type/code.
    console.error(`${side}: connection/inspection failed (${error.name}, code ${error.code ?? 'unavailable'})`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
