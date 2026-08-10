/**
 * MySQL Database Adapter
 */

import * as mysql from 'mysql2/promise';
import type {
  Connection as MySQLConnection,
  Pool as MySQLPool,
  PoolConnection as MySQLPoolConnection,
} from 'mysql2/promise';
import { DatabaseAdapter } from './base.js';
import type {
  DatabaseConnection,
  QueryResult,
  DatabaseSchema,
  ColumnInfo,
  TableInfo,
} from '../../types/index.js';

// ============================================================================
// MySQL Adapter Implementation
// ============================================================================

/**
 * Minimal shape of the underlying (non-promise) mysql2 core connection used for row
 * streaming — exposed as `.connection` on a promise pool connection.
 */
interface MySQLStreamingConnection {
  query: (sql: string, values?: unknown[]) => { stream: (opts?: unknown) => NodeJS.ReadableStream };
}

/**
 *
 */
export class MySQLAdapter extends DatabaseAdapter {
  private _pool?: MySQLPool;

  // ============================================================================
  // Connection Management
  // ============================================================================

  private getPool(): MySQLPool {
    if (!this._pool) {
      const host = this.config.host as string;
      const database = this.config.database as string;
      const username = this.config.username as string;
      const password = this.config.password as string;

      const poolConfig: mysql.PoolOptions = {
        host,
        port: this.parseConfigValue(this.config.port, 'number', 3306),
        database,
        user: username,
        password,
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: this.connectionTimeout,
      };

      // Handle SSL configuration
      if (this.config.ssl !== undefined) {
        const sslEnabled = this.parseConfigValue(this.config.ssl ?? false, 'boolean', false);
        if (sslEnabled) {
          const sslVerify = this.parseConfigValue(this.config.ssl_verify ?? true, 'boolean', true);
          poolConfig.ssl = { rejectUnauthorized: sslVerify };
        }
      }

      // Azure MariaDB/MySQL: force SSL and rewrite username to user@server
      if (
        host.includes('.mariadb.database.azure.com') ||
        host.includes('.mysql.database.azure.com')
      ) {
        const sslVerify = this.parseConfigValue(this.config.ssl_verify ?? true, 'boolean', true);
        poolConfig.ssl = { rejectUnauthorized: sslVerify };
        if (!username.includes('@')) {
          const serverName = host.split('.')[0];
          poolConfig.user = `${username}@${serverName}`;
        }
      }

      this._pool = mysql.createPool(poolConfig);
    }
    return this._pool;
  }

  /**
   *
   */
  async connect(): Promise<DatabaseConnection> {
    this.validateConfig(['host', 'database', 'username', 'password']);
    try {
      const conn: MySQLPoolConnection = await this.getPool().getConnection();
      await this.applyStatementTimeout(conn);
      return conn as DatabaseConnection;
    } catch (error) {
      throw this.createError('Failed to acquire MySQL connection from pool', error as Error);
    }
  }

  /**
   * Enforce a server-side statement timeout so a runaway query is cancelled by the DB
   * itself, not just by the client-side race (FIND-108). MySQL 5.7.8+ uses
   * `max_execution_time` (ms, SELECT statements); MariaDB uses `max_statement_time` (s).
   * Best-effort: a server supporting neither falls back to the client-side timeout.
   * @param conn - a freshly acquired pool connection
   */
  private async applyStatementTimeout(conn: MySQLPoolConnection): Promise<void> {
    const timeoutMs = this.getStatementTimeoutMs();
    if (timeoutMs <= 0) return;
    const runner = conn as unknown as {
      query: (sql: string, values?: unknown[]) => Promise<unknown>;
    };
    try {
      await runner.query('SET SESSION max_execution_time = ?', [timeoutMs]);
    } catch {
      try {
        await runner.query('SET SESSION max_statement_time = ?', [Math.ceil(timeoutMs / 1000)]);
      } catch {
        /* server supports neither — rely on the client-side timeout in ConnectionManager */
      }
    }
  }

  /**
   *
   */
  async disconnect(connection: DatabaseConnection): Promise<void> {
    try {
      const poolConn = connection as MySQLPoolConnection;
      poolConn.release();
    } catch (error) {
      throw this.createError('Failed to release MySQL connection to pool', error as Error);
    }
  }

  /**
   *
   */
  async destroyPool(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = undefined;
    }
  }

  /**
   *
   */
  isConnected(connection: DatabaseConnection): boolean {
    try {
      if (!connection) {
        return false;
      }
      const mysqlConn = connection as MySQLConnection;
      // Audit H4: `typeof execute === 'function'` is true even after the underlying
      // socket is closed (a mysql2 PoolConnection keeps its methods). Inspect the
      // core connection's socket state instead, so dead connections are detected
      // and ConnectionManager.getConnection recreates them transparently.
      const core = (
        mysqlConn as unknown as {
          connection?: { stream?: { destroyed?: boolean } };
        }
      ).connection;
      if (core?.stream) {
        // If the stream is explicitly destroyed, the connection is dead.
        if (core.stream.destroyed === true) return false;
      }
      return typeof mysqlConn.execute === 'function';
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Query Execution
  // ============================================================================

  /**
   *
   */
  async executeQuery(
    connection: DatabaseConnection,
    query: string,
    params: unknown[] = []
  ): Promise<QueryResult> {
    const startTime = Date.now();
    const cap = this.getMaxRows();
    const mysqlConn = connection as MySQLConnection;

    // Stream rows and retain only up to maxRows so a huge result set never fully
    // materializes in the Node heap (FIND-109). Uses the underlying (non-promise) core
    // connection, which exposes the row stream. Falls back to the buffered `execute`
    // path when streaming is unavailable (e.g. a mocked connection in unit tests).
    const core = (mysqlConn as unknown as { connection?: MySQLStreamingConnection }).connection;

    if (!core || typeof core.query !== 'function') {
      try {
        const [rows, fields] = await mysqlConn.execute(
          query,
          (params ?? []) as (string | number | boolean | null)[]
        );
        return this.normalizeQueryResult({ rows, fields }, startTime, undefined, query);
      } catch (error) {
        throw this.createError('Failed to execute MySQL query', error as Error);
      }
    }

    return new Promise<QueryResult>((resolve, reject) => {
      const kept: Record<string, unknown>[] = [];
      let observed = 0;
      let truncated = false;
      let settled = false;

      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (err) {
          reject(this.createError('Failed to execute MySQL query', err));
          return;
        }
        resolve(this.buildStreamedResult(kept, observed, truncated, startTime, query));
      };

      let stream: NodeJS.ReadableStream;
      try {
        stream = core.query(query, (params ?? []) as unknown[]).stream();
      } catch (err) {
        finish(err as Error);
        return;
      }

      stream.on('data', (row: Record<string, unknown>) => {
        observed++;
        if (kept.length < cap) kept.push(row);
        else truncated = true;
      });
      stream.on('error', (err: Error) => finish(err));
      stream.on('end', () => finish());
    });
  }

  protected extractRawRows(result: unknown): unknown[] {
    const mysqlResult = result as { rows: unknown[]; fields: unknown[] };
    return Array.isArray(mysqlResult.rows) ? mysqlResult.rows : [];
  }

  protected extractFieldNames(result: unknown): string[] {
    const mysqlResult = result as { rows: unknown[]; fields: mysql.FieldPacket[] };
    return mysqlResult.fields?.map((field: mysql.FieldPacket) => field.name) || [];
  }

  // ============================================================================
  // Transaction Management
  // ============================================================================

  /**
   *
   */
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mysqlConn = connection as MySQLConnection;
      await mysqlConn.beginTransaction();
    } catch (error) {
      throw this.createError('Failed to begin MySQL transaction', error as Error);
    }
  }

  /**
   *
   */
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mysqlConn = connection as MySQLConnection;
      await mysqlConn.commit();
    } catch (error) {
      throw this.createError('Failed to commit MySQL transaction', error as Error);
    }
  }

  /**
   *
   */
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mysqlConn = connection as MySQLConnection;
      await mysqlConn.rollback();
    } catch (error) {
      throw this.createError('Failed to rollback MySQL transaction', error as Error);
    }
  }

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  /**
   *
   */
  buildExplainQuery(query: string): string {
    // Use JSON format for structured analysis (MySQL 5.7+)
    return `EXPLAIN FORMAT=JSON ${query}`;
  }

  override getPerformanceRecommendations(explainResult: QueryResult, _query: string): string[] {
    const recommendations: string[] = [];

    for (const row of explainResult.rows) {
      const rowData = row as Record<string, unknown>;

      if (rowData.type === 'ALL') {
        recommendations.push(' MYSQL: Full table scan detected - add appropriate indexes');
      }

      if (rowData.Extra && String(rowData.Extra).includes('Using filesort')) {
        recommendations.push(
          ' MYSQL: Filesort operation - consider adding index on ORDER BY columns'
        );
      }

      if (rowData.Extra && String(rowData.Extra).includes('Using temporary')) {
        recommendations.push(
          ' MYSQL: Temporary table created - optimize GROUP BY or DISTINCT operations'
        );
      }
    }

    return recommendations;
  }

  // ============================================================================
  // Schema Capture
  // ============================================================================

  /**
   *
   */
  async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
    try {
      const schema = this.createBaseSchema(this.config.database ?? '');

      // Get all tables and views
      const tablesQuery = `
 SELECT 
 TABLE_NAME,
 TABLE_TYPE,
 TABLE_COMMENT
 FROM information_schema.TABLES 
 WHERE TABLE_SCHEMA = ?
 ORDER BY TABLE_NAME
 `;

      const [tablesRows] = await (connection as MySQLConnection).execute(tablesQuery, [
        this.config.database ?? '',
      ]);
      const tables = tablesRows as Array<{
        TABLE_NAME: string;
        TABLE_TYPE: string;
        TABLE_COMMENT: string;
      }>;

      // Process each table/view
      for (const table of tables) {
        const columns = await this.captureTableColumns(connection, table.TABLE_NAME);

        const tableInfo: TableInfo = {
          name: table.TABLE_NAME,
          type: table.TABLE_TYPE,
          comment: table.TABLE_COMMENT || '',
          columns,
        };

        if (table.TABLE_TYPE === 'BASE TABLE') {
          schema.tables[table.TABLE_NAME] = tableInfo;
        } else {
          schema.views[table.TABLE_NAME] = tableInfo;
        }
      }

      this.updateSchemaSummary(schema);
      return schema;
    } catch (error) {
      throw this.createError('Failed to capture MySQL schema', error as Error);
    }
  }

  private async captureTableColumns(
    connection: DatabaseConnection,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const columnsQuery = `
 SELECT 
 COLUMN_NAME,
 DATA_TYPE,
 IS_NULLABLE,
 COLUMN_DEFAULT,
 CHARACTER_MAXIMUM_LENGTH,
 NUMERIC_PRECISION,
 NUMERIC_SCALE,
 COLUMN_COMMENT,
 COLUMN_KEY,
 EXTRA
 FROM information_schema.COLUMNS 
 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
 ORDER BY ORDINAL_POSITION
 `;

    const [columnsRows] = await (connection as MySQLConnection).execute(columnsQuery, [
      this.config.database ?? '',
      tableName,
    ]);

    const columns = columnsRows as Array<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: unknown;
      CHARACTER_MAXIMUM_LENGTH: number | null;
      NUMERIC_PRECISION: number | null;
      NUMERIC_SCALE: number | null;
      COLUMN_COMMENT: string;
      COLUMN_KEY: string;
      EXTRA: string;
    }>;

    return columns.map(
      (col): ColumnInfo => ({
        name: col.COLUMN_NAME,
        type: col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        default: col.COLUMN_DEFAULT,
        max_length: col.CHARACTER_MAXIMUM_LENGTH,
        precision: col.NUMERIC_PRECISION,
        scale: col.NUMERIC_SCALE,
        comment: col.COLUMN_COMMENT || '',
        key: col.COLUMN_KEY || '',
        extra: col.EXTRA || '',
      })
    );
  }
}
