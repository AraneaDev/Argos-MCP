/**
 * SQL Server (MSSQL) Database Adapter
 */

import * as sql from 'mssql';
import type { ConnectionPool as MSSQLConnectionPool, IResult } from 'mssql';
import { DatabaseAdapter } from './base.js';
import type {
  DatabaseConnection,
  QueryResult,
  DatabaseSchema,
  ColumnInfo,
  TableInfo,
} from '../../types/index.js';

// ============================================================================
// SQL Server Adapter Implementation
// ============================================================================

export class MSSQLAdapter extends DatabaseAdapter {
  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<DatabaseConnection> {
    this.validateConfig(['host', 'database', 'username', 'password']);

    const host = this.config.host as string;
    const database = this.config.database as string;
    const username = this.config.username as string;
    const password = this.config.password as string;

    const connectionConfig: sql.config = {
      server: host,
      port: this.parseConfigValue(this.config.port, 'number', 1433),
      database,
      user: username,
      password,
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.connectionTimeout,
      options: {
        encrypt: this.parseConfigValue(this.config.encrypt ?? true, 'boolean', true),
        trustServerCertificate: !this.parseConfigValue(
          this.config.ssl_verify ?? true,
          'boolean',
          true
        ),
        enableArithAbort: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    try {
      const pool = new sql.ConnectionPool(connectionConfig);
      await pool.connect();
      return pool as DatabaseConnection;
    } catch (error) {
      throw this.createError('Failed to connect to SQL Server database', error as Error);
    }
  }

  async disconnect(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      await mssqlPool.close();
    } catch (error) {
      throw this.createError('Failed to disconnect from SQL Server database', error as Error);
    }
  }

  isConnected(connection: DatabaseConnection): boolean {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      return !!(mssqlPool && mssqlPool.connected);
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
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();

      // Add parameters if provided
      params.forEach((param, index) => {
        request.input(`param${index}`, param);
      });

      // Replace ? placeholders with named parameters for SQL Server, skipping any
      // '?' that appears inside a string literal so parameter order stays aligned.
      const processedQuery = this.replacePlaceholders(query);

      const result = await request.query(processedQuery);
      return this.normalizeQueryResult(result, startTime);
    } catch (error) {
      throw this.createError('Failed to execute SQL Server query', error as Error);
    }
  }

  /**
   * Convert positional '?' placeholders to @paramN, ignoring '?' inside string
   * literals so a literal question mark in a string does not shift parameter order.
   */
  private replacePlaceholders(query: string): string {
    let out = '';
    let paramIndex = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < query.length; i++) {
      const ch = query[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
      }

      if (ch === '?' && !inSingle && !inDouble) {
        out += `@param${paramIndex++}`;
      } else {
        out += ch;
      }
    }

    return out;
  }

  protected extractRawRows(result: unknown): unknown[] {
    const mssqlResult = result as IResult<unknown>;
    return Array.isArray(mssqlResult.recordset) ? mssqlResult.recordset : [];
  }

  protected extractFieldNames(result: unknown): string[] {
    const mssqlResult = result as IResult<Record<string, unknown>>;
    if (!Array.isArray(mssqlResult.recordset) || mssqlResult.recordset.length === 0) {
      return [];
    }
    return Object.keys(mssqlResult.recordset[0] || {});
  }

  // ============================================================================
  // Transaction Management
  // ============================================================================

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();
      await request.query('BEGIN TRANSACTION');
    } catch (error) {
      throw this.createError('Failed to begin SQL Server transaction', error as Error);
    }
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();
      await request.query('COMMIT TRANSACTION');
    } catch (error) {
      throw this.createError('Failed to commit SQL Server transaction', error as Error);
    }
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const request = mssqlPool.request();
      await request.query('ROLLBACK TRANSACTION');
    } catch (error) {
      throw this.createError('Failed to rollback SQL Server transaction', error as Error);
    }
  }

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  buildExplainQuery(query: string): string {
    return `SET SHOWPLAN_ALL ON; ${query}; SET SHOWPLAN_ALL OFF`;
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
 '' as TABLE_COMMENT
 FROM INFORMATION_SCHEMA.TABLES 
 WHERE TABLE_SCHEMA = 'dbo'
 ORDER BY TABLE_NAME
 `;

      const mssqlPool = connection as MSSQLConnectionPool;
      const tablesResult = await mssqlPool.request().query(tablesQuery);

      // Process each table/view
      for (const table of tablesResult.recordset) {
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
      throw this.createError('Failed to capture SQL Server schema', error as Error);
    }
  }

  private async captureTableColumns(
    connection: DatabaseConnection,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const columnsQuery = `
 SELECT 
 c.COLUMN_NAME,
 c.DATA_TYPE,
 c.IS_NULLABLE,
 c.COLUMN_DEFAULT,
 c.CHARACTER_MAXIMUM_LENGTH,
 c.NUMERIC_PRECISION,
 c.NUMERIC_SCALE,
 ISNULL(ep.value, '') as COLUMN_COMMENT,
 CASE 
 WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRI'
 ELSE ''
 END as COLUMN_KEY
 FROM INFORMATION_SCHEMA.COLUMNS c
 LEFT JOIN sys.extended_properties ep ON ep.major_id = OBJECT_ID('dbo.' + c.TABLE_NAME)
 AND ep.minor_id = c.ORDINAL_POSITION
 AND ep.name = 'MS_Description'
 LEFT JOIN (
 SELECT ku.COLUMN_NAME, ku.TABLE_NAME
 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
 JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
 ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
 WHERE c.TABLE_NAME = @tableName
 ORDER BY c.ORDINAL_POSITION
 `;

    const mssqlPool = connection as MSSQLConnectionPool;
    const request = mssqlPool.request();
    request.input('tableName', tableName);
    const columnsResult = await request.query(columnsQuery);

    return columnsResult.recordset.map(
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
        extra: '',
      })
    );
  }

  // ============================================================================
  // SQL Server-specific Methods
  // ============================================================================

  /**
   * Get SQL Server version information
   */
  async getVersion(connection: DatabaseConnection): Promise<string> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const result = await mssqlPool.request().query('SELECT @@VERSION as version');
      return result.recordset[0]?.version || 'Unknown';
    } catch (error) {
      throw this.createError('Failed to get SQL Server version', error as Error);
    }
  }

  /**
   * Get database size information
   */
  async getDatabaseSize(connection: DatabaseConnection): Promise<Record<string, unknown>> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const result = await mssqlPool.request().query(`
 SELECT 
 DB_NAME() as database_name,
 SUM(size * 8.0 / 1024) as size_mb,
 SUM(CASE WHEN type = 0 THEN size * 8.0 / 1024 END) as data_size_mb,
 SUM(CASE WHEN type = 1 THEN size * 8.0 / 1024 END) as log_size_mb
 FROM sys.database_files
 `);

      return result.recordset[0] || {};
    } catch (error) {
      throw this.createError('Failed to get SQL Server database size', error as Error);
    }
  }

  /**
   * Get table row counts and size information
   */
  async getTableStats(connection: DatabaseConnection): Promise<unknown[]> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const result = await mssqlPool.request().query(`
 SELECT 
 t.NAME AS table_name,
 p.rows AS row_count,
 SUM(a.total_pages) * 8 AS total_space_kb,
 SUM(a.used_pages) * 8 AS used_space_kb,
 (SUM(a.total_pages) - SUM(a.used_pages)) * 8 AS unused_space_kb
 FROM sys.tables t
 INNER JOIN sys.indexes i ON t.OBJECT_ID = i.object_id
 INNER JOIN sys.partitions p ON i.object_id = p.OBJECT_ID AND i.index_id = p.index_id
 INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
 WHERE t.NAME NOT LIKE 'dt%' AND t.is_ms_shipped = 0 AND i.OBJECT_ID > 255
 GROUP BY t.NAME, p.Rows
 ORDER BY t.NAME
 `);

      return result.recordset;
    } catch (error) {
      throw this.createError('Failed to get SQL Server table statistics', error as Error);
    }
  }

  /**
   * Get active connections and sessions
   */
  async getActiveConnections(connection: DatabaseConnection): Promise<unknown[]> {
    try {
      const mssqlPool = connection as MSSQLConnectionPool;
      const result = await mssqlPool.request().query(`
 SELECT 
 session_id,
 login_time,
 host_name,
 program_name,
 login_name,
 status,
 cpu_time,
 memory_usage,
 total_scheduled_time,
 total_elapsed_time,
 reads,
 writes
 FROM sys.dm_exec_sessions
 WHERE is_user_process = 1
 ORDER BY login_time DESC
 `);

      return result.recordset;
    } catch (error) {
      throw this.createError('Failed to get SQL Server active connections', error as Error);
    }
  }
}
