/**
 * SQLite Database Adapter
 */

import * as sqlite3 from 'sqlite3';
const { Database } = sqlite3;
import type { Database as SQLiteDatabase } from 'sqlite3';
import { DatabaseAdapter } from './base.js';
import type {
  DatabaseConnection,
  QueryResult,
  DatabaseSchema,
  ColumnInfo,
  TableInfo,
} from '../../types/index.js';

// ============================================================================
// SQLite Adapter Implementation
// ============================================================================

export class SQLiteAdapter extends DatabaseAdapter {
  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<DatabaseConnection> {
    this.validateConfig(['file']);

    const file = this.config.file as string;

    // Fail secure: for SELECT-only databases, open READONLY. This prevents the default
    // OPEN_READWRITE|OPEN_CREATE behaviour from (a) creating a new database file at an
    // attacker-supplied path and (b) writing to an existing file (see FIND-110). Non
    // SELECT-only databases keep the default read/write/create mode.
    const mode = this.config.select_only
      ? sqlite3.OPEN_READONLY
      : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;

    return new Promise<DatabaseConnection>((resolve, reject) => {
      const db = new Database(file, mode, (err) => {
        if (err) {
          reject(this.createError('Failed to connect to SQLite database', err));
        } else {
          resolve(db as DatabaseConnection);
        }
      });
    });
  }

  async disconnect(connection: DatabaseConnection): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.close((err) => {
        if (err) {
          reject(this.createError('Failed to disconnect from SQLite database', err));
        } else {
          resolve();
        }
      });
    });
  }

  isConnected(connection: DatabaseConnection): boolean {
    try {
      const sqliteDb = connection as SQLiteDatabase;
      // SQLite database is considered connected if it's not null and open property is true
      return !!(
        sqliteDb &&
        'open' in sqliteDb &&
        (sqliteDb as Record<string, unknown>).open === true
      );
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

    return new Promise<QueryResult>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      sqliteDb.all(query, params, (err, rows) => {
        if (err) {
          reject(this.createError('Failed to execute SQLite query', err));
        } else {
          const result = this.normalizeQueryResult({ rows }, startTime, undefined, query);
          resolve(result);
        }
      });
    });
  }

  protected extractRawRows(result: unknown): unknown[] {
    const sqliteResult = result as { rows: unknown[] };
    return Array.isArray(sqliteResult.rows) ? sqliteResult.rows : [];
  }

  protected extractFieldNames(result: unknown): string[] {
    const sqliteResult = result as { rows: Record<string, unknown>[] };
    if (!Array.isArray(sqliteResult.rows) || sqliteResult.rows.length === 0) {
      return [];
    }
    return Object.keys(sqliteResult.rows[0] || {});
  }

  // ============================================================================
  // Transaction Management
  // ============================================================================

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          reject(this.createError('Failed to begin SQLite transaction', err));
        } else {
          resolve();
        }
      });
    });
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.run('COMMIT', (err) => {
        if (err) {
          reject(this.createError('Failed to commit SQLite transaction', err));
        } else {
          resolve();
        }
      });
    });
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.run('ROLLBACK', (err) => {
        if (err) {
          reject(this.createError('Failed to rollback SQLite transaction', err));
        } else {
          resolve();
        }
      });
    });
  }

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  buildExplainQuery(query: string): string {
    return `EXPLAIN QUERY PLAN ${query}`;
  }

  // ============================================================================
  // Schema Capture
  // ============================================================================

  async captureSchema(connection: DatabaseConnection): Promise<DatabaseSchema> {
    try {
      const schema = this.createBaseSchema(this.config.file ?? '');

      // Get all tables and views
      const tables = await this.getTables(connection);

      // Process each table/view
      for (const table of tables) {
        const columns = await this.captureTableColumns(connection, table.name);

        const tableInfo: TableInfo = {
          name: table.name,
          type: table.type,
          comment: '', // SQLite doesn't support table comments
          columns,
        };

        if (table.type === 'table') {
          schema.tables[table.name] = tableInfo;
        } else {
          schema.views[table.name] = tableInfo;
        }
      }

      this.updateSchemaSummary(schema);
      return schema;
    } catch (error) {
      throw this.createError('Failed to capture SQLite schema', error as Error);
    }
  }

  private async getTables(
    connection: DatabaseConnection
  ): Promise<Array<{ name: string; type: string }>> {
    return new Promise((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      const query = `
 SELECT name, type 
 FROM sqlite_master 
 WHERE type IN ('table', 'view') 
 AND name NOT LIKE 'sqlite_%'
 ORDER BY name
 `;

      sqliteDb.all(query, (err, rows) => {
        if (err) {
          reject(this.createError('Failed to get SQLite tables', err));
        } else {
          resolve(rows as Array<{ name: string; type: string }>);
        }
      });
    });
  }

  private async captureTableColumns(
    connection: DatabaseConnection,
    tableName: string
  ): Promise<ColumnInfo[]> {
    return new Promise((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      // Use PRAGMA table_info to get column information
      sqliteDb.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
        if (err) {
          reject(this.createError(`Failed to get columns for table ${tableName}`, err));
        } else {
          const columns = (
            rows as Array<{
              cid: number;
              name: string;
              type: string;
              notnull: number;
              dflt_value: unknown;
              pk: number;
            }>
          ).map(
            (col): ColumnInfo => ({
              name: col.name,
              type: col.type,
              nullable: col.notnull === 0,
              default: col.dflt_value,
              max_length: null,
              precision: null,
              scale: null,
              comment: '', // SQLite doesn't support column comments
              key: col.pk === 1 ? 'PRI' : '',
              extra: '',
            })
          );

          resolve(columns);
        }
      });
    });
  }

  // ============================================================================
  // SQLite-specific Methods
  // ============================================================================

  /**
   * Get SQLite version information
   */
  async getVersion(connection: DatabaseConnection): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      sqliteDb.get('SELECT sqlite_version() as version', (err, row) => {
        if (err) {
          reject(this.createError('Failed to get SQLite version', err));
        } else {
          resolve((row as { version: string })?.version || 'Unknown');
        }
      });
    });
  }

  /**
   * Get database file size and page information
   */
  async getDatabaseInfo(connection: DatabaseConnection): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      const queries = ['PRAGMA page_count', 'PRAGMA page_size', 'PRAGMA database_list'];

      const results: Record<string, unknown> = {};
      let completed = 0;

      queries.forEach((query, index) => {
        sqliteDb.get(query, (err, row) => {
          if (err) {
            reject(this.createError(`Failed to execute ${query}`, err));
            return;
          }

          switch (index) {
            case 0:
              results.page_count = (row as { page_count: number })?.page_count;
              break;
            case 1:
              results.page_size = (row as { page_size: number })?.page_size;
              break;
            case 2:
              results.database_list = row;
              break;
          }

          completed++;
          if (completed === queries.length) {
            // Calculate approximate file size
            if (typeof results.page_count === 'number' && typeof results.page_size === 'number') {
              results.approximate_size = results.page_count * results.page_size;
            }
            resolve(results);
          }
        });
      });
    });
  }

  /**
   * Analyze table for statistics (SQLite ANALYZE command)
   */
  async analyzeTable(connection: DatabaseConnection, tableName?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;
      const query = tableName ? `ANALYZE ${tableName}` : 'ANALYZE';

      sqliteDb.run(query, (err) => {
        if (err) {
          reject(this.createError('Failed to analyze SQLite table', err));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Vacuum database to optimize storage
   */
  async vacuum(connection: DatabaseConnection): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sqliteDb = connection as SQLiteDatabase;

      sqliteDb.run('VACUUM', (err) => {
        if (err) {
          reject(this.createError('Failed to vacuum SQLite database', err));
        } else {
          resolve();
        }
      });
    });
  }
}
