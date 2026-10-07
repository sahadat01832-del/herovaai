#!/usr/bin/env node
/**
 * Verify every advertised model against the provider that would actually serve it.
 *
 * This is the guard against the failure this project shipped with: a curated list that
 * claimed models the providers do not have, so a request for one was quietly answered by
 * something else. Run it after touching the catalog, or on a timer.
 *
 *   node scripts/verify-catalog.js            # human report
 *   node scripts/verify-catalog.js --json     # machine report
 *
 * Exit status: 0 nothing advertised is dead, 1 at least one advertised id is out of stock,
 * 2 a provider probe failed (nothing could be verified, so this is not a pass).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const catalogService = require('../src/services/catalogService');
const cloudAIService = require('../src/services/cloudAIService');

async function main() {
  await catalogService.refresh({ force: true });
  const annotated = catalogService.annotate(cloudAIService.ALL_MODELS_CATALOG);
  const snapshot = catalogService.snapshot();

  const byState = { available: [], out_of_stock: [], key_missing: [], unverified: [] };
  for (const model of annotated) byState[model.availability].push(model);

  const failedProbes = Object.entries(snapshot.providers)
    .filter(([, p]) => !p.probed && p.error !== 'no key configured')
    .map(([name, p]) => `${name}: ${p.error}`);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      probedAt: snapshot.probedAt,
      counts: Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, v.length])),
      outOfStock: byState.out_of_stock.map(m => ({ id: m.id, provider: m.provider })),
      unverified: byState.unverified.map(m => ({ id: m.id, provider: m.provider })),
      providers: snapshot.providers,
      failedProbes,
    }, null, 2));
  } else {
    console.log(`probed at ${snapshot.probedAt} (ttl ${snapshot.ttlMs / 1000}s)`);
    for (const [name, probe] of Object.entries(snapshot.providers)) {
      console.log(`  ${probe.probed ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} ${probe.probed ? probe.count + ' ids' : probe.error}`);
    }
    console.log('');
    for (const state of ['available', 'out_of_stock', 'key_missing', 'unverified']) {
      console.log(`${state.padEnd(13)} ${byState[state].length}`);
      for (const model of byState[state]) {
        console.log(`    ${state === 'available' ? '✓' : '!'} ${model.id}  [${model.provider}]`);
      }
    }
    if (byState.out_of_stock.length) {
      console.log('\nAdvertised but not in the provider\'s live list — remove or replace these:');
      byState.out_of_stock.forEach(m => console.log(`  - ${m.id} [${m.provider}]`));
    }
  }

  if (byState.out_of_stock.length) return 1;
  if (failedProbes.length) return 2;
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('verify-catalog failed:', err.message);
    process.exit(2);
  });
