#!/usr/bin/env node
/**
 * Real-database verification for the SQLite adapter's FIND-109 (pre-materialization row
 * bounding) and FIND-108 (statement timeout via interrupt) remediations.
 *
 * The SQLite streaming path cannot run under Jest (node-sqlite3's `each`/`interrupt` methods
 * are unavailable when the native module is loaded through Jest's swc transform), so this
 * script exercises the REAL built adapter against a REAL temp database under plain Node.
 *
 * Usage:
 *   npm run build            # produces dist/
 *   node scripts/verify-sqlite-streaming.cjs
 *
 * Exits 0 on success, 1 on any assertion failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const DIST = path.join(__dirname, '..', 'dist', 'database', 'adapters', 'sqlite.js');
const ROWS = 5000;
const CAP = 100;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('  ✓', msg);
  }
}

async function seed(sqlite3, file) {
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      file,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      (err) => err && reject(err)
    );
    db.run('CREATE TABLE people (id INTEGER PRIMARY KEY, ssn TEXT, name TEXT)', (e) => {
      if (e) return reject(e);
      const vals = [];
      for (let i = 0; i < ROWS; i++) vals.push(`('123-45-${String(i).padStart(4, '0')}','n${i}')`);
      db.run(`INSERT INTO people (ssn, name) VALUES ${vals.join(',')}`, (e2) =>
        e2 ? reject(e2) : db.close((e3) => (e3 ? reject(e3) : resolve()))
      );
    });
  });
}

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ not found — run `npm run build` first.');
    process.exit(2);
  }
  const sqlite3 = require('sqlite3');
  const { SQLiteAdapter } = await import(pathToFileURL(DIST).href);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlmcp-verify-'));
  const file = path.join(dir, 'data.db');
  try {
    await seed(sqlite3, file);

    console.log('FIND-109 — row bounding (max_rows cap, heap never holds full set):');
    const roAdapter = new SQLiteAdapter({ type: 'sqlite', file, select_only: true, max_rows: CAP });
    const conn = await roAdapter.connect();
    const res = await roAdapter.executeQuery(conn, 'SELECT * FROM people', []);
    await roAdapter.disconnect(conn);
    assert(res.rows.length === CAP, `retained rows capped at max_rows (${res.rows.length} === ${CAP})`);
    assert(res.rowCount === ROWS, `true observed count reported (${res.rowCount} === ${ROWS})`);
    assert(res.truncated === true, 'truncated flag set');
    assert(JSON.stringify(res.fields) === JSON.stringify(['id', 'ssn', 'name']), 'fields correct');

    console.log('FIND-108 — statement timeout interrupts a runaway query:');
    const toAdapter = new SQLiteAdapter({
      type: 'sqlite',
      file,
      select_only: true,
      max_rows: 10,
      query_timeout: 300,
    });
    const conn2 = await toAdapter.connect();
    const runaway =
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 100000000) SELECT count(*) FROM c';
    const start = Date.now();
    let threw = false;
    try {
      await toAdapter.executeQuery(conn2, runaway, []);
    } catch (e) {
      threw = /timed out/i.test(e.message);
    }
    const elapsed = Date.now() - start;
    await toAdapter.disconnect(conn2);
    assert(threw, 'runaway query rejected with a timeout error');
    assert(elapsed < 5000, `interrupted quickly, not run to completion (${elapsed}ms < 5000ms)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(process.exitCode ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}

main().catch((e) => {
  console.error('verification error:', e);
  process.exit(1);
});
