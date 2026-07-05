/**
 * Abstract base class for database adapters
 */

import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
  DatabaseTypeString,
  QueryResultWithRedaction,
} from '../../types/index.js';
import { RedactionManager } from '../../classes/RedactionManager.js';

// ============================================================================
// Abstract Database Adapter
// ============================================================================

export abstract class DatabaseAdapter {
  protected config: DatabaseConfig;
  protected connectionTimeout: number;
  protected redactionManager?: RedactionManager;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.connectionTimeout =
      typeof config.timeout === 'number'
        ? config.timeout
        : typeof config.timeout === 'string'
          ? parseInt(config.timeout, 10) || 30000
          : 30000;

    // Initialize redaction manager if configured
    if (config.redaction?.enabled) {
      this.redactionManager = new RedactionManager(config.redaction);
    }
  }

  // ============================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ============================================================================

  /**
   * Create a connection to the database
   */
  abstract connect(): Promise<DatabaseConnection>;

  /**
   * Execute a query against the database
   */
  abstract executeQuery(
    _connection: DatabaseConnection,
    _query: string,
    _params?: unknown[]
  ): Promise<QueryResult>;

  /**
   * Disconnect from the database
   */
  abstract disconnect(_connection: DatabaseConnection): Promise<void>;

  /**
   * Capture schema information from the database
   */
  abstract captureSchema(_connection: DatabaseConnection): Promise<DatabaseSchema>;

  /**
   * Test if the connection is still alive
   */
  abstract isConnected(_connection: DatabaseConnection): boolean;

  /**
   * Begin a transaction
   */
  abstract beginTransaction(_connection: DatabaseConnection): Promise<void>;

  /**
   * Commit a transaction
   */
  abstract commitTransaction(_connection: DatabaseConnection): Promise<void>;

  /**
   * Rollback a transaction
   */
  abstract rollbackTransaction(_connection: DatabaseConnection): Promise<void>;

  /**
   * Build an EXPLAIN query for performance analysis
   */
  abstract buildExplainQuery(_query: string): string;

  // ============================================================================
  // Common Implementation Methods
  // ============================================================================

  /**
   * Get the database type
   */
  public getType(): DatabaseTypeString {
    return this.config.type;
  }

  /**
   * Get the connection configuration
   */
  public getConfig(): DatabaseConfig {
    return { ...this.config };
  }

  /**
   * Sanitize connection config for logging (remove sensitive data)
   */
  public getSafeConfig(): Partial<DatabaseConfig> {
    const { password, ssh_password, ssh_private_key, ssh_passphrase, ...safe } = this.config;
    return {
      ...safe,
      password: password ? '[REDACTED]' : undefined,
      ssh_password: ssh_password ? '[REDACTED]' : undefined,
      ssh_private_key: ssh_private_key ? '[REDACTED]' : undefined,
      ssh_passphrase: ssh_passphrase ? '[REDACTED]' : undefined,
    };
  }

  /**
   * Validate that required configuration fields are present
   */
  protected validateConfig(requiredFields: string[]): void {
    const missing: string[] = [];

    for (const field of requiredFields) {
      const value = this.config[field as keyof DatabaseConfig];
      if (value === undefined || value === null || value === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required configuration fields: ${missing.join(', ')}`);
    }
  }

  /**
   * Parse string values to appropriate types
   */
  protected parseConfigValue<T>(
    value: string | number | boolean | T,
    type: 'string' | 'number' | 'boolean',
    defaultValue: T
  ): T {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    switch (type) {
      case 'string':
        return String(value) as T;
      case 'number': {
        if (typeof value === 'number') return value as T;
        const parsed = parseInt(String(value), 10);
        return (isNaN(parsed) ? defaultValue : parsed) as T;
      }
      case 'boolean':
        if (typeof value === 'boolean') return value as T;
        return (String(value).toLowerCase() === 'true') as T;
      default:
        return value as T;
    }
  }

  /**
   * Create a standardized error with context
   */
  protected createError(message: string, originalError?: Error): Error {
    const errorMessage = `${this.getType()} adapter error: ${message}`;

    if (originalError) {
      const error = new Error(`${errorMessage} - ${originalError.message}`);
      error.stack = originalError.stack;
      return error;
    }

    return new Error(errorMessage);
  }

  /**
   * Truncate rows if they exceed the limit
   */
  protected truncateResults(
    rows: unknown[],
    maxRows: number
  ): { rows: unknown[]; truncated: boolean } {
    if (rows.length <= maxRows) {
      return { rows, truncated: false };
    }

    return {
      rows: rows.slice(0, maxRows),
      truncated: true,
    };
  }

  /**
   * Extract field names from query results (implementation varies by adapter)
   */
  protected abstract extractFieldNames(_result: unknown): string[];

  /**
   * Resolve the effective maximum row count from configuration (default 1000).
   */
  protected getMaxRows(): number {
    const configured = this.config.max_rows;
    return typeof configured === 'number' && configured > 0 ? configured : 1000;
  }

  /**
   * Normalize query result to standard format with optional redaction
   */
  protected normalizeQueryResult(
    rawResult: unknown,
    startTime: number,
    maxRows?: number,
    query?: string
  ): QueryResult {
    const executionTime = Date.now() - startTime;
    const cap = maxRows ?? this.getMaxRows();

    // Extract rows - implementation varies by adapter
    const rawRows = this.extractRawRows(rawResult);
    const { rows, truncated } = this.truncateResults(rawRows, cap);

    // Extract field names
    const fields = this.extractFieldNames(rawResult);

    // Create base result
    const baseResult: QueryResult = {
      rows: rows as Record<string, unknown>[],
      rowCount: rawRows.length,
      fields,
      truncated,
      execution_time_ms: executionTime,
    };

    // Apply redaction if configured
    if (this.redactionManager) {
      const redactedResult = this.redactionManager.redactResults(baseResult, query);
      return redactedResult;
    }

    return baseResult;
  }

  /**
   * Extract raw rows from database-specific result (implementation varies by adapter)
   */
  protected abstract extractRawRows(_result: unknown): unknown[];

  // ============================================================================
  // Helper Methods for Schema Capture
  // ============================================================================

  /**
   * Create a base schema object
   */
  protected createBaseSchema(databaseName: string): DatabaseSchema {
    return {
      database: databaseName,
      type: this.getType(),
      captured_at: new Date().toISOString(),
      tables: {},
      views: {},
      summary: {
        table_count: 0,
        view_count: 0,
        total_columns: 0,
      },
    };
  }

  /**
   * Update schema summary statistics
   */
  protected updateSchemaSummary(schema: DatabaseSchema): void {
    schema.summary.table_count = Object.keys(schema.tables).length;
    schema.summary.view_count = Object.keys(schema.views).length;
    schema.summary.total_columns = [
      ...Object.values(schema.tables),
      ...Object.values(schema.views),
    ].reduce((total, table) => total + table.columns.length, 0);
  }

  // ============================================================================
  // Redaction Management Methods
  // ============================================================================

  /**
   * Update redaction configuration at runtime
   */
  public updateRedactionConfig(redactionConfig: DatabaseConfig['redaction']): void {
    if (redactionConfig?.enabled) {
      this.redactionManager = new RedactionManager(redactionConfig);
    } else {
      this.redactionManager = undefined;
    }

    // Update the config
    this.config.redaction = redactionConfig;
  }

  /**
   * Check if redaction is enabled
   */
  public isRedactionEnabled(): boolean {
    return !!this.redactionManager;
  }

  /**
   * Get redaction configuration summary
   */
  public getRedactionSummary(): ReturnType<RedactionManager['getConfigurationSummary']> | null {
    return this.redactionManager?.getConfigurationSummary() || null;
  }

  /**
   * Test redaction with sample data
   */
  public testRedaction(
    sampleData: Record<string, unknown>
  ): ReturnType<RedactionManager['testRedaction']> | null {
    return this.redactionManager?.testRedaction(sampleData) || null;
  }
}
