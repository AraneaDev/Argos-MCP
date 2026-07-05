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
   * Resolve the per-statement timeout (ms) from config, defaulting to 30s.
   */
  private getStatementTimeoutMs(): number {
    const raw = this.config.query_timeout ?? this.config.timeout;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 30000;
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

  async disconnect(connection: DatabaseConnection): Promise<void> {
    try {
      const poolConn = connection as MySQLPoolConnection;
      poolConn.release();
    } catch (error) {
      throw this.createError('Failed to release MySQL connection to pool', error as Error);
    }
  }

  async destroyPool(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = undefined;
    }
  }

  isConnected(connection: DatabaseConnection): boolean {
    try {
      if (!connection) {
        return false;
      }
      const mysqlConn = connection as MySQLConnection;
      // MySQL connection doesn't have a direct isConnected method
      // We'll use a simple approach - if the connection exists and hasn't been destroyed
      return mysqlConn && typeof mysqlConn.execute === 'function';
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Query Execution
  // ============================================================================

  async executeQuery(
    connection: DatabaseConnection,
    query: string,
    params: unknown[] = []
  ): Promise<QueryResult> {
    const startTime = Date.now();

    try {
      const mysqlConn = connection as MySQLConnection;
      const [rows, fields] = await mysqlConn.execute(
        query,
        (params ?? []) as (string | number | boolean | null)[]
      );

      return this.normalizeQueryResult({ rows, fields }, startTime, undefined, query);
    } catch (error) {
      throw this.createError('Failed to execute MySQL query', error as Error);
    }
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

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mysqlConn = connection as MySQLConnection;
      await mysqlConn.beginTransaction();
    } catch (error) {
      throw this.createError('Failed to begin MySQL transaction', error as Error);
    }
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mysqlConn = connection as MySQLConnection;
      await mysqlConn.commit();
    } catch (error) {
      throw this.createError('Failed to commit MySQL transaction', error as Error);
    }
  }

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

  buildExplainQuery(query: string): string {
    // Use JSON format for structured analysis (MySQL 5.7+)
    return `EXPLAIN FORMAT=JSON ${query}`;
  }

  // ============================================================================
  // Schema Capture
  // ============================================================================

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
