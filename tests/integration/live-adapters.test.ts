/**
 * Live adapter integration tests for the FIND-108 (server-side statement timeout) and
 * FIND-109 (pre-materialization row bounding) remediations.
 *
 * Requires a real MySQL server, so it is GATED behind LIVE_DB_TESTS=1 and MYSQL_HOST and
 * skipped in CI (which has no databases). Run locally with, e.g.:
 *
 *   LIVE_DB_TESTS=1 \
 *   MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=sqlmcp MYSQL_PASSWORD=sqlmcp_pw \
 *   MYSQL_DB=sqlmcp_test \
 *   npx jest tests/integration/live-adapters.test.ts
 *
 * NOTE on SQLite: node-sqlite3's streaming methods (`each`/`interrupt`) are not available
 * when the native module is loaded under Jest's swc transform, so the SQLite streaming path
 * cannot be exercised here. It is covered by (a) the mock-based unit tests in
 * tests/unit/adapters/sqlite-adapter.test.ts and (b) the real-database verification script
 * `scripts/verify-sqlite-streaming.cjs` (run under plain Node).
 */

import { MySQLAdapter } from '../../src/database/adapters/mysql.js';
import type { DatabaseConfig, DatabaseConnection } from '../../src/types/index.js';

const RUN = process.env.LIVE_DB_TESTS === '1' && !!process.env.MYSQL_HOST;
const describeLive = RUN ? describe : describe.skip;

describeLive('live MySQL adapter — FIND-108 / FIND-109', () => {
  jest.setTimeout(60000);

  const ROWS = 5000;
  const CAP = 100;
  const baseCfg = (): DatabaseConfig =>
    ({
      type: 'mysql',
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      username: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DB,
      select_only: false,
      max_rows: CAP,
    }) as DatabaseConfig;

  let setupAdapter: MySQLAdapter;
  let setupConn: DatabaseConnection;

  beforeAll(async () => {
    setupAdapter = new MySQLAdapter(baseCfg());
    setupConn = await setupAdapter.connect();
    await setupAdapter.executeQuery(setupConn, 'DROP TABLE IF EXISTS people', []);
    await setupAdapter.executeQuery(
      setupConn,
      'CREATE TABLE people (id INT PRIMARY KEY AUTO_INCREMENT, ssn VARCHAR(32), name VARCHAR(32))',
      []
    );
    const values: string[] = [];
    for (let i = 0; i < ROWS; i++) values.push(`('123-45-${String(i).padStart(4, '0')}','n${i}')`);
    await setupAdapter.executeQuery(
      setupConn,
      `INSERT INTO people (ssn, name) VALUES ${values.join(',')}`,
      []
    );
  });

  afterAll(async () => {
    try {
      await setupAdapter.executeQuery(setupConn, 'DROP TABLE IF EXISTS people', []);
      await setupAdapter.disconnect(setupConn);
    } finally {
      await setupAdapter.destroyPool();
    }
  });

  it('streams and bounds retained rows to max_rows while reporting the true count (FIND-109)', async () => {
    const adapter = new MySQLAdapter(baseCfg());
    const conn = await adapter.connect();
    const result = await adapter.executeQuery(conn, 'SELECT * FROM people', []);
    await adapter.disconnect(conn);
    await adapter.destroyPool();

    expect(result.rows.length).toBe(CAP); // never materializes all ROWS in the heap
    expect(result.rowCount).toBe(ROWS); // true count still reported
    expect(result.truncated).toBe(true);
    expect(result.fields).toEqual(['id', 'ssn', 'name']);
  });

  it('applies a server-side statement timeout on the session (FIND-108)', async () => {
    const adapter = new MySQLAdapter({ ...baseCfg(), query_timeout: 12345 } as DatabaseConfig);
    const conn = await adapter.connect();
    const result = await adapter.executeQuery(conn, 'SELECT @@SESSION.max_execution_time AS t', []);
    await adapter.disconnect(conn);
    await adapter.destroyPool();
    expect(Number((result.rows[0] as { t: number }).t)).toBe(12345);
  });
});
