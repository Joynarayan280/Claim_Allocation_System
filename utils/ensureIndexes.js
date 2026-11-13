// utils/ensureIndexes.js
// Runs at every start-up. It is safe to run repeatedly and replaces the old manual fix-indexes.js script.
//  - removes legacy indexes that conflict with the current design
//  - back-fills `claimKey` (lower-case claim number) on old cases
//  - creates the indexes that keep claim lookups fast and block duplicate claim numbers

const mongoose = require('mongoose');

async function dropIfExists(collection, indexName) {
  try {
    const idx = await mongoose.connection.db.collection(collection).indexes();
    if (idx.some((i) => i.name === indexName)) {
      await mongoose.connection.db.collection(collection).dropIndex(indexName);
      console.log(`Dropped legacy index ${collection}.${indexName}`);
    }
  } catch (err) {
    if (!/ns not found|NamespaceNotFound/i.test(err.message)) console.warn(`Index check skipped for ${collection}.${indexName}:`, err.message);
  }
}

async function ensureIndexes() {
  const db = mongoose.connection.db;

  // Legacy indexes: single-field claimNo (old design) and employeeId-only on users (now employeeId + role)
  await dropIfExists('cases', 'claimNo_1');
  await dropIfExists('users', 'employeeId_1');

  // Back-fill claimKey for cases created before this field existed
  try {
    const r = await db.collection('cases').updateMany(
      { claimKey: { $exists: false }, claimNo: { $type: 'string', $ne: '' } },
      [{ $set: { claimKey: { $toLower: { $trim: { input: '$claimNo' } } } } }]
    );
    if (r.modifiedCount) console.log(`Back-filled claimKey on ${r.modifiedCount} existing cases`);
  } catch (err) {
    console.warn('claimKey back-fill skipped:', err.message);
  }

  await db.collection('cases').createIndex({ claimNo: 1 }, { name: 'claimNo_lookup' });

  try {
    await db.collection('cases').createIndex(
      { claimKey: 1 },
      { name: 'claimKey_unique', unique: true, partialFilterExpression: { claimKey: { $type: 'string' } } }
    );
  } catch (err) {
    // Happens only if the database already contains two cases with the same claim number.
    console.error(
      'WARNING: could not create the unique claim-number index (' + err.message + '). ' +
      'The database contains duplicate claim numbers; new duplicates are still blocked by the application check, ' +
      'but you should find and merge the old duplicates.'
    );
  }
}

module.exports = { ensureIndexes };
