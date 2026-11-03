// One-off: re-attach history orphaned by the old app's create+move+delete
// location-ID rename. Run ONLY while the API is stopped (it rewrites the DB file).
//
//   node scripts/migrate-orphaned-location-ids.js "OLD_ID=NEW_ID" ["OLD2=NEW2" ...]
//
// The NEW location must exist and the OLD one must not (already deleted).

const { dataStore } = require('../src/db/datastore');
const { loadFromDisk, flushSync } = require('../src/db/persistence');
const { migrateLocationReferences } = require('../src/services/locationRenameService');

const pairs = process.argv.slice(2).map((arg) => {
  const idx = arg.indexOf('=');
  if (idx <= 0) throw new Error(`Bad pair: ${arg}`);
  return [arg.slice(0, idx), arg.slice(idx + 1)];
});
if (pairs.length === 0) {
  console.error('usage: node scripts/migrate-orphaned-location-ids.js "OLD=NEW" ...');
  process.exit(1);
}

if (!loadFromDisk(dataStore)) {
  console.error('No DB file loaded; aborting.');
  process.exit(1);
}

pairs.forEach(([oldId, newId]) => {
  const target = dataStore.locations.find((l) => l._id === newId);
  if (!target) throw new Error(`Target location ${newId} does not exist`);
  if (dataStore.locations.find((l) => l._id === oldId)) {
    throw new Error(`Old location ${oldId} still exists; use the rename endpoint instead`);
  }
  const migrated = migrateLocationReferences(oldId, newId);
  target.previous_location_ids = [...new Set([...(target.previous_location_ids || []), oldId])];
  console.log(`${oldId} -> ${newId}:`, JSON.stringify(migrated));
});

flushSync(dataStore);
console.log('Saved.');
