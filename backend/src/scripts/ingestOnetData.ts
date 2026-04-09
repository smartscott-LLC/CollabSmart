#!/usr/bin/env ts-node
/**
 * CollabSmart O*NET Ingestion Script
 * ====================================
 * Fetches technology/software occupation data from the O*NET Web Services API
 * and loads it into the CollabSmart PostgreSQL database.
 *
 * Usage:
 *   npx ts-node src/scripts/ingestOnetData.ts [--limit N]
 *
 * Prerequisites:
 *   - ONET_USERNAME and ONET_PASSWORD env vars set (register at https://services.onetcenter.org/)
 *   - PostgreSQL running and schema initialised (./db/schema.sql)
 *
 * Adapted from memory/onet_integration/ingest_onet_data.py for CollabSmart (tech focus).
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { getPgPool, initSchema } from '../db/pool';
import { OnetIntegration } from '../memory/onetIntegration';

const OCCUPATIONS_FILE = path.join(__dirname, '../../db/collabsmart_onet_occupations.txt');
const RATE_LIMIT_MS = 600; // ms between requests to be respectful of the API

function loadOccupationCodes(filepath: string): string[] {
  const lines = fs.readFileSync(filepath, 'utf8').split('\n');
  return lines
    .map((l) => l.split('#')[0].trim())
    .filter((l) => l && /^\d{2}-\d{4}\.\d{2}$/.test(l));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const limit = (() => {
    const idx = process.argv.indexOf('--limit');
    if (idx !== -1 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1], 10);
    return Infinity;
  })();

  const username = process.env.ONET_USERNAME ?? '';
  const password = process.env.ONET_PASSWORD ?? '';

  if (!username || !password) {
    console.error(
      'Error: ONET_USERNAME and ONET_PASSWORD must be set.\n' +
      'Register at: https://services.onetcenter.org/',
    );
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('CollabSmart O*NET Ingestion — Technology & Software Occupations');
  console.log('='.repeat(70));

  // Load codes from file
  if (!fs.existsSync(OCCUPATIONS_FILE)) {
    console.error(`Occupation codes file not found: ${OCCUPATIONS_FILE}`);
    process.exit(1);
  }

  let codes = loadOccupationCodes(OCCUPATIONS_FILE);
  console.log(`Loaded ${codes.length} occupation codes from ${path.basename(OCCUPATIONS_FILE)}`);

  if (isFinite(limit)) {
    codes = codes.slice(0, limit);
    console.log(`Limited to first ${codes.length} codes`);
  }

  // Init DB
  console.log('\nConnecting to PostgreSQL...');
  const pool = getPgPool();
  try {
    await pool.query('SELECT 1');
    console.log('Connected to PostgreSQL');
  } catch (err) {
    console.error('Database connection failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  await initSchema();
  const onet = new OnetIntegration(pool);

  console.log(`\nStarting ingestion of ${codes.length} occupations...\n`);

  let successful = 0;
  let failed = 0;
  const failedCodes: string[] = [];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    process.stdout.write(`[${i + 1}/${codes.length}] ${code} `);

    const details = await onet.fetchOccupationDetails(code);

    if (!details || !details.code) {
      console.log('— NOT FOUND');
      failed++;
      failedCodes.push(code);
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    try {
      await onet.upsertOccupation(details);

      // Fetch and store skills, knowledge, technology in parallel
      const [skills, knowledge, tech] = await Promise.all([
        onet.fetchSkills(code),
        onet.fetchKnowledge(code),
        onet.fetchTechnology(code),
      ]);

      await Promise.all([
        onet.storeSkills(code, skills),
        onet.storeKnowledge(code, knowledge),
        onet.storeTechnology(code, tech),
      ]);

      console.log(`✓ ${details.title ?? ''} (${skills.length} skills, ${tech.length} tools)`);
      successful++;
    } catch (err) {
      console.log(`✗ DB error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      failedCodes.push(code);
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Ingestion Complete');
  console.log(`  Successful : ${successful}`);
  console.log(`  Failed     : ${failed}`);

  if (failedCodes.length > 0) {
    console.log('\nFailed codes:');
    failedCodes.forEach((c) => console.log(`  - ${c}`));
  }

  const countResult = await pool.query<{ count: string }>('SELECT COUNT(*) FROM onet_occupations');
  console.log(`\nTotal occupations in CollabSmart database: ${countResult.rows[0].count}`);

  const brightResult = await pool.query<{ onetsoc_code: string; title: string }>(
    'SELECT onetsoc_code, title FROM onet_occupations WHERE bright_outlook = TRUE LIMIT 5',
  );
  if (brightResult.rows.length > 0) {
    console.log('\nBright Outlook occupations in database:');
    brightResult.rows.forEach((r) => console.log(`  • ${r.onetsoc_code}: ${r.title}`));
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
