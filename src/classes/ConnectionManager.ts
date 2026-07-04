/**
 * Database Connection Manager
 */

import { EventEmitter } from 'events';
import type {
  DatabaseConfig,
  ConnectionInfo,
  DatabaseConnection,
  SSHTunnelInfo,
  TestConnectionResult,
  DatabaseListItem,
  QueryResult,
  BatchResult,
} from '../types/index.js';
import { ConnectionError } from '../types/index.js';
import type { DatabaseAdapter } from '../database/adapters/index.js';
import { AdapterFactory } from '../database/adapters/index.js';
import type { EnhancedSSHTunnelManager } from './EnhancedSSHTunnelManager.js';
import { getLogger } from '../utils/logger.js';
import type { MetricsManager } from './MetricsManager.js';
import type { QueryCache } from './QueryCache.js';
import type { CircuitBreakerState } from '../utils/circuit-breaker.js';
import {
  initialCircuitState,
  shouldReject,
  recordFailure,
  recordSuccess,
} from '../utils/circuit-breaker.js';
import { CircuitOpenError } from '../utils/error-handler.js';
import { writeAuditLog } from '../utils/audit-logger.js';

// ============================================================================
// Connection Manager Class
// ============================================================================

// Transient error patterns that are worth retrying
const RETRYABLE_PATTERNS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'Connection lost',
  'Connection terminated unexpectedly',
  'read ECONNRESET',
  'socket hang up',
];

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  logger: ReturnType<typeof getLogger>,
  context: string,
  maxRetries = 2,
  delayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryableError(error)) {
        const backoff = delayMs * (attempt + 1);
        logger.warning(
          `Retryable error in ${context} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoff}ms`,
          {
            error: (error as Error).message,
          }
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        throw error;
      }
    }
  }
  throw lastError; // unreachable, but satisfies TS
}

/**
 *
 */
export class ConnectionManager extends EventEmitter {
  private connections = new Map<string, ConnectionInfo>();
  private adapters = new Map<string, DatabaseAdapter>();
  private databases: Record<string, DatabaseConfig> = {};
  private sshTunnelManager: EnhancedSSHTunnelManager;
  private logger = getLogger();
  private circuits = new Map<string, CircuitBreakerState>();
  private metrics?: MetricsManager;
  private queryCache?: QueryCache;

  constructor(
    sshTunnelManager: EnhancedSSHTunnelManager,
    metrics?: MetricsManager,
    queryCache?: QueryCache
  ) {
    super();
    this.sshTunnelManager = sshTunnelManager;
    this.metrics = metrics;
    this.queryCache = queryCache;
  }

  private getCircuit(dbName: string): CircuitBreakerState {
    let s = this.circuits.get(dbName);
    if (!s) {
      s = initialCircuitState();
      this.circuits.set(dbName, s);
    }
    return s;
  }

  /**
   * Create database adapter (can be overridden for testing)
   */
  private createAdapter(config: DatabaseConfig): DatabaseAdapter {
    return AdapterFactory.createAdapter(config);
  }

  /**
   * Initialize the connection manager
   */
  public initialize(databases: Record<string, DatabaseConfig>): void {
    this.databases = databases;
    this.emit('initialized', databases);
  }

  /**
   * Register a database configuration
   */
  public registerDatabase(name: string, config: DatabaseConfig): void {
    // Validate configuration
    const validation = AdapterFactory.validateConfig(config);
    if (!validation.isValid) {
      throw new Error(
        `Invalid configuration for database '${name}': ${validation.errors.join(', ')}`
      );
    }

    this.databases[name] = config;
    this.logger.info(`Database '${name}' registered`, { type: config.type });
  }

  /**
   * Unregister a database configuration
   */
  public unregisterDatabase(name: string): void {
    delete this.databases[name];

    // Close connection if it exists
    if (this.connections.has(name)) {
      this.closeConnection(name).catch((error) => {
        this.logger.error(`Error closing connection during unregister for '${name}'`, {
          error: (error as Error).message,
        });
      });
    }

    this.logger.info(`Database '${name}' unregistered`);
  }

  /**
   * Check if database is registered
   */
  public hasDatabase(name: string): boolean {
    return name in this.databases;
  }

  /**
   * Get list of registered database names
   */
  public getDatabaseNames(): string[] {
    return Object.keys(this.databases);
  }

  /**
   * Get database configuration
   */
  public getDatabaseConfig(name: string): DatabaseConfig | undefined {
    return this.databases[name];
  }

  /**
   * Close all connections
   */
  public closeAll(): Promise<void> {
    return this.closeAllConnections();
  }

  /**
   * Check if connection is healthy
   */
  public async isConnectionHealthy(name: string): Promise<boolean> {
    if (!this.isConnected(name)) {
      return false;
    }

    try {
      await this.executeQuery(name, 'SELECT 1 as health_check');
      return true;
    } catch (error) {
      this.logger.warning(`Health check failed for '${name}'`, { error: (error as Error).message });
      return false;
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Create a new database connection
   */
  async createConnection(dbName: string, config: DatabaseConfig): Promise<ConnectionInfo> {
    try {
      this.logger.info(`Creating connection to database '${dbName}'`, {
        type: config.type,
        host: config.host,
        database: config.database,
        ssl: config.ssl ?? false,
        ssh_enabled: !!config.ssh_host,
      });

      // Validate configuration
      const validation = AdapterFactory.validateConfig(config);
      if (!validation.isValid) {
        throw new ConnectionError(
          `Invalid configuration for database '${dbName}': ${validation.errors.join(', ')}`,
          { database: dbName, errors: validation.errors }
        );
      }

      // Create database adapter
      let adapter: DatabaseAdapter;
      let actualConfig = { ...config };

      try {
        adapter = this.createAdapter(config);
      } catch (error) {
        throw new ConnectionError(`Failed to create adapter for database '${dbName}'`, {
          database: dbName,
          error: (error as Error).message,
        });
      }

      // Set up SSH tunnel if needed
      if (config.ssh_host && config.type !== 'sqlite') {
        try {
          let tunnelInfo: SSHTunnelInfo;

          // Check if tunnel already exists and is healthy
          if (this.sshTunnelManager.isConnected(dbName)) {
            this.logger.info(`Using existing healthy tunnel for '${dbName}'`);
            tunnelInfo = this.sshTunnelManager.getTunnel(dbName)!;
          } else {
            // Check if tunnel exists but unhealthy
            if (this.sshTunnelManager.hasTunnel(dbName)) {
              this.logger.warning(`Existing tunnel for '${dbName}' is unhealthy, recreating...`);
              await this.sshTunnelManager.closeTunnel(dbName);
            }

            // Create new tunnel only if none exists or previous was unhealthy
            this.logger.info(`Creating new SSH tunnel for '${dbName}'`);
            tunnelInfo = await this.sshTunnelManager.createTunnel(dbName, {
              sshConfig: {
                host: config.ssh_host,
                port:
                  typeof config.ssh_port === 'number'
                    ? config.ssh_port
                    : parseInt(String(config.ssh_port || 22), 10),
                username: config.ssh_username!,
                password: config.ssh_password,
                privateKey: config.ssh_private_key,
                passphrase: config.ssh_passphrase,
                hostFingerprint: config.ssh_host_fingerprint,
                strictHostKeyChecking: config.ssh_strict_host_key_checking,
              },
              forwardConfig: {
                sourceHost: '127.0.0.1',
                sourcePort: 0, // Auto-assign
                destinationHost: config.host!,
                destinationPort:
                  typeof config.port === 'number'
                    ? config.port
                    : parseInt(String(config.port!), 10),
              },
              localPort:
                typeof config.local_port === 'number'
                  ? config.local_port
                  : parseInt(String(config.local_port || 0), 10),
              localHost: config.ssh_local_host ?? '127.0.0.1',
            });

            this.logger.info(`New SSH tunnel established for '${dbName}'`, {
              remoteHost: config.host,
              remotePort: config.port,
              localHost: tunnelInfo.localHost,
              localPort: tunnelInfo.localPort,
            });
          }

          // Update config to use tunnel
          actualConfig = {
            ...config,
            host: tunnelInfo.localHost,
            port: tunnelInfo.localPort,
          };

          // Create new adapter with tunnel config
          adapter = this.createAdapter(actualConfig);
        } catch (error) {
          throw new ConnectionError(`Failed to create SSH tunnel for database '${dbName}'`, {
            database: dbName,
            error: (error as Error).message,
          });
        }
      }

      // Establish database connection
      let connection: DatabaseConnection;
      try {
        connection = await adapter.connect();
        this.logger.info(`Database connection established for '${dbName}'`);
      } catch (error) {
        // Clean up SSH tunnel if connection failed
        if (config.ssh_host) {
          await this.sshTunnelManager.closeTunnel(dbName);
        }

        // For tests and specific error types, preserve original message
        const originalMessage = (error as Error).message;
        if (
          originalMessage.includes('Connection failed') ||
          originalMessage.includes('Connection timeout')
        ) {
          throw error;
        }

        throw new ConnectionError(`Failed to connect to database '${dbName}': ${originalMessage}`, {
          database: dbName,
          error: originalMessage,
        });
      }

      // Store connection info
      const connectionInfo: ConnectionInfo = {
        connection,
        type: config.type,
      };

      this.connections.set(dbName, connectionInfo);
      this.adapters.set(dbName, adapter);

      // Emit connection event
      this.emit('connected', dbName);

      return connectionInfo;
    } catch (error) {
      if (error instanceof ConnectionError) {
        throw error;
      }

      // For tests and specific error types, preserve original message
      const originalMessage = (error as Error).message;
      if (
        originalMessage.includes('Connection failed') ||
        originalMessage.includes('Connection timeout')
      ) {
        throw error;
      }

      throw new ConnectionError(
        `Unexpected error creating connection to '${dbName}': ${originalMessage}`,
        { database: dbName, error: originalMessage }
      );
    }
  }

  /**
   * Get an existing connection or create a new one
   */
  async getConnection(dbName: string): Promise<ConnectionInfo> {
    // Check if connection already exists
    const existing = this.connections.get(dbName);
    if (existing) {
      return existing;
    }

    // Check if database is registered
    const config = this.databases[dbName];
    if (!config) {
      throw new Error(`Database ${dbName} is not registered`);
    }

    // Create new connection with retry for transient failures
    return await withRetry(
      () => this.createConnection(dbName, config),
      this.logger,
      `getConnection(${dbName})`
    );
  }

  /**
   * Get existing connection (synchronous)
   */
  getExistingConnection(dbName: string): ConnectionInfo | undefined {
    return this.connections.get(dbName);
  }

  /**
   * Get database adapter
   */
  getAdapter(dbName: string): DatabaseAdapter | undefined {
    return this.adapters.get(dbName);
  }

  /**
   * Check if a connection exists and is active
   */
  isConnected(dbName: string): boolean {
    const connectionInfo = this.connections.get(dbName);
    const adapter = this.adapters.get(dbName);

    if (!connectionInfo || !adapter) {
      return false;
    }

    try {
      return adapter.isConnected(connectionInfo.connection);
    } catch (error) {
      this.logger.error(`Error checking connection status for '${dbName}'`, {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Close a specific connection
   */
  async closeConnection(dbName: string): Promise<void> {
    const connectionInfo = this.connections.get(dbName);
    const adapter = this.adapters.get(dbName);

    if (connectionInfo && adapter) {
      try {
        await adapter.disconnect(connectionInfo.connection);
        this.logger.info(`Database connection closed for '${dbName}'`);
      } catch (error) {
        this.logger.error(`Error closing connection for '${dbName}'`, {
          error: (error as Error).message,
        });
      }

      // Emit disconnection event
      this.emit('disconnected', dbName);
    }

    // Close SSH tunnel if exists
    try {
      await this.sshTunnelManager.closeTunnel(dbName);
    } catch (error) {
      this.logger.error(`Error closing SSH tunnel for '${dbName}'`, {
        error: (error as Error).message,
      });
    }

    // Remove from maps
    this.connections.delete(dbName);
    this.adapters.delete(dbName);
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    const dbNames = Array.from(this.connections.keys());

    const PER_CONNECTION_TIMEOUT = 5000;
    const results = await Promise.allSettled(
      dbNames.map((dbName) =>
        Promise.race([
          this.closeConnection(dbName),
          new Promise<void>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Timeout closing connection '${dbName}'`)),
              PER_CONNECTION_TIMEOUT
            );
            timer.unref();
          }),
        ])
      )
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        this.logger.error(`Error closing connection for '${dbNames[i]}'`, {
          error: (results[i] as PromiseRejectedResult).reason?.message,
        });
      }
    }

    this.logger.info('All database connections closed');

    // Destroy connection pools on shutdown
    for (const adapter of this.adapters.values()) {
      const poolable = adapter as unknown as { destroyPool?: () => Promise<void> };
      if (typeof poolable.destroyPool === 'function') {
        await poolable.destroyPool();
      }
    }
  }

  /**
   * Test connection to a database
   */
  async testConnection(dbName: string, config?: DatabaseConfig): Promise<TestConnectionResult> {
    // Use provided config or get from registered databases
    const actualConfig = config || this.databases[dbName];

    if (!actualConfig) {
      return {
        success: false,
        database: dbName,
        error: `Database ${dbName} is not registered`,
        ssh_tunnel: false,
        select_only_mode: false,
        schema_captured: false,
      };
    }

    let tempAdapter: DatabaseAdapter | undefined;
    let tempConnection: DatabaseConnection | undefined;
    const sshTunnelCreated = !!(actualConfig.ssh_host && actualConfig.type !== 'sqlite');

    try {
      // Validate configuration
      const validation = AdapterFactory.validateConfig(actualConfig);
      if (!validation.isValid) {
        return {
          success: false,
          database: dbName,
          error: `Invalid configuration: ${validation.errors.join(', ')}`,
          ssh_tunnel: false,
          select_only_mode: actualConfig.select_only === true,
          schema_captured: false,
        };
      }

      // Set up SSH tunnel if needed for testing
      let testConfig = { ...actualConfig };
      let tunnelInfo: SSHTunnelInfo | undefined;

      if (sshTunnelCreated) {
        try {
          tunnelInfo = await this.sshTunnelManager.createTunnel(`${dbName}_test`, {
            sshConfig: {
              host: actualConfig.ssh_host!,
              port:
                typeof actualConfig.ssh_port === 'number'
                  ? actualConfig.ssh_port
                  : parseInt(String(actualConfig.ssh_port || 22), 10),
              username: actualConfig.ssh_username!,
              password: actualConfig.ssh_password,
              privateKey: actualConfig.ssh_private_key,
              passphrase: actualConfig.ssh_passphrase,
            },
            forwardConfig: {
              sourceHost: '127.0.0.1',
              sourcePort: 0,
              destinationHost: actualConfig.host!,
              destinationPort:
                typeof actualConfig.port === 'number'
                  ? actualConfig.port
                  : parseInt(String(actualConfig.port!), 10),
            },
          });

          testConfig = {
            ...actualConfig,
            host: tunnelInfo.localHost,
            port: tunnelInfo.localPort,
          };
        } catch (error) {
          return {
            success: false,
            database: dbName,
            error: `SSH tunnel failed: ${(error as Error).message}`,
            ssh_tunnel: false,
            select_only_mode: actualConfig.select_only === true,
            schema_captured: false,
          };
        }
      }

      // Create adapter and test connection
      tempAdapter = this.createAdapter(testConfig);
      tempConnection = await tempAdapter.connect();

      // Test with a simple query
      await tempAdapter.executeQuery(tempConnection, 'SELECT 1 as test');

      // Try to capture basic schema info
      let schemaInfo;
      try {
        const schema = await tempAdapter.captureSchema(tempConnection);
        schemaInfo = schema.summary;
      } catch (error) {
        this.logger.warning(`Could not capture schema during connection test for '${dbName}'`, {
          error: (error as Error).message,
        });
      }

      return {
        success: true,
        database: dbName,
        message: 'Connection test successful',
        ssh_tunnel: sshTunnelCreated,
        select_only_mode: actualConfig.select_only === true,
        schema_captured: !!schemaInfo,
        schema_info: schemaInfo,
      };
    } catch (error) {
      return {
        success: false,
        database: dbName,
        error: (error as Error).message,
        ssh_tunnel: sshTunnelCreated,
        select_only_mode: actualConfig.select_only === true,
        schema_captured: false,
      };
    } finally {
      // Clean up test connection and tunnel
      if (tempConnection && tempAdapter) {
        try {
          await tempAdapter.disconnect(tempConnection);
        } catch (error) {
          this.logger.error(`Error cleaning up test connection for '${dbName}'`, {
            error: (error as Error).message,
          });
        }
      }

      if (sshTunnelCreated) {
        try {
          await this.sshTunnelManager.closeTunnel(`${dbName}_test`);
        } catch (error) {
          this.logger.error(`Error cleaning up test SSH tunnel for '${dbName}'`, {
            error: (error as Error).message,
          });
        }
      }
    }
  }

  // ============================================================================
  // Information and Statistics
  // ============================================================================

  /**
   * Get list of all active connections
   */
  getActiveConnections(): string[] {
    return Array.from(this.connections.keys()).filter((dbName) => this.isConnected(dbName));
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    total: number;
    active: number;
    inactive: number;
    withSSH: number;
  } {
    const totalRegistered = Object.keys(this.databases).length;
    const active = this.getActiveConnections().length;
    const withSSH = Array.from(this.connections.keys()).filter((dbName) =>
      this.sshTunnelManager.isConnected(dbName)
    ).length;

    return {
      total: totalRegistered,
      active,
      inactive: totalRegistered - active,
      withSSH,
    };
  }

  /**
   * Get connection statistics (alias for backwards compatibility)
   */
  getConnectionStatistics(): {
    total: number;
    active: number;
    inactive: number;
    withSSH: number;
  } {
    return this.getConnectionStats();
  }

  /**
   * Create database list items with connection status
   */
  createDatabaseListItems(configs: Record<string, DatabaseConfig>): DatabaseListItem[] {
    return Object.entries(configs).map(([dbName, config]) => ({
      name: dbName,
      type: config.type,
      host: config.host || config.file,
      database: config.database,
      ssh_enabled: !!config.ssh_host,
      ssl_enabled: config.ssl === true,
      select_only_mode: config.select_only === true,
      mcp_configurable: !!config.mcp_configurable,
      schema_cached: false, // This will be determined by SchemaManager
      schema_info: undefined, // This will be populated by SchemaManager
    }));
  }

  // ============================================================================
  // Query Execution Methods
  // ============================================================================

  /**
   * Internal query execution — preserves original connection-lookup and error handling.
   */
  private async _executeQueryInternal(
    dbName: string,
    query: string,
    params: unknown[] = []
  ): Promise<QueryResult> {
    // Get connection (will create if doesn't exist)
    const connectionInfo = await this.getConnection(dbName);
    const adapter = this.adapters.get(dbName);

    if (!adapter) {
      throw new ConnectionError(`No adapter found for database '${dbName}'`);
    }

    try {
      const result = await adapter.executeQuery(connectionInfo.connection, query, params);
      return result;
    } catch (error) {
      this.emit('error', error, dbName);
      throw error;
    }
  }

  /**
   * Classify an error into a category for metrics and circuit breaker decisions.
   */
  private classifyErrorCategory(err: unknown): string {
    if (err instanceof CircuitOpenError) return 'CONNECTION';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorObj = err as any;
    const name = errorObj?.name ?? '';
    if (name.includes('SSH') || name === 'SSHTunnelError') return 'SSH';
    if (name === 'ConnectionError') return 'CONNECTION';
    if (name === 'SecurityViolationError') return 'SECURITY';
    if (name === 'QueryExecutionError') return 'QUERY';
    if (name === 'TimeoutError') return 'TIMEOUT';

    // Robust inspection of codes and messages for query-time network/connection/SSH failures
    const code = String(errorObj?.code || errorObj?.originalError?.code || '').toUpperCase();
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EPIPE' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ESOCKETTIMEDOUT' ||
      code === 'PROTOCOL_CONNECTION_LOST'
    ) {
      return code.includes('SSH') ? 'SSH' : 'CONNECTION';
    }

    const message = errorObj?.message ?? '';
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('epipe') ||
      lowerMessage.includes('etimedout') ||
      lowerMessage.includes('econnreset') ||
      lowerMessage.includes('connection closed') ||
      lowerMessage.includes('connection lost') ||
      lowerMessage.includes('socket') ||
      lowerMessage.includes('terminated') ||
      lowerMessage.includes('handshake')
    ) {
      if (lowerMessage.includes('ssh') || lowerMessage.includes('tunnel')) {
        return 'SSH';
      }
      return 'CONNECTION';
    }

    return 'QUERY';
  }

  /**
   * Execute a single query on a database with circuit breaker, caching, metrics,
   * and optional audit logging.
   */
  async executeQuery(dbName: string, query: string, params: unknown[] = []): Promise<QueryResult> {
    // 1. Circuit breaker — fast-reject if OPEN
    const circuit = this.getCircuit(dbName);
    const decision = shouldReject(circuit, Date.now());
    if (decision.reject) {
      const retryIn = Math.ceil((decision as { reject: true; retryInMs: number }).retryInMs / 1000);
      throw new CircuitOpenError(
        `Database '${dbName}' is currently unavailable — retry in ${retryIn}s`
      );
    }
    if (
      !decision.reject &&
      (decision as { reject: false; transitionTo?: 'HALF_OPEN' }).transitionTo === 'HALF_OPEN'
    ) {
      this.circuits.set(dbName, { ...circuit, status: 'HALF_OPEN' });
    }

    // 2. Cache check — for SELECT queries
    if (this.queryCache) {
      const cached = this.queryCache.get(dbName, query, params);
      if (cached !== undefined) {
        this.metrics?.recordCacheHit(dbName);
        return cached;
      }
      if (this.queryCache.shouldCache(query)) {
        this.metrics?.recordCacheMiss(dbName);
      }
    }

    // 3. Execute the query
    const startTime = Date.now();
    try {
      // Note: on timeout, the underlying query continues running on the database;
      // cancellation would require adapter-level support (e.g. KILL QUERY).
      const queryTimeout = this.getDatabaseConfig(dbName)?.query_timeout ?? 30000;
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Query timed out after ${queryTimeout}ms`)),
          queryTimeout
        );
        timeoutHandle.unref();
      });
      const result = await Promise.race([
        this._executeQueryInternal(dbName, query, params),
        timeoutPromise,
      ]).finally(() => clearTimeout(timeoutHandle));
      const durationMs = Date.now() - startTime;

      // 4. On success
      const currentCircuit = this.getCircuit(dbName);
      const prevStatus = currentCircuit.status;
      const newCircuit = recordSuccess(currentCircuit);
      this.circuits.set(dbName, newCircuit);
      if (prevStatus !== newCircuit.status) {
        this.metrics?.recordCircuitEvent(
          dbName,
          newCircuit.status === 'CLOSED' ? 'closed' : 'half_open'
        );
        this.emit('circuitStateChange', dbName, newCircuit.status);
      }

      this.metrics?.recordQuery(dbName, durationMs, true);

      // Cache result if cacheable
      if (this.queryCache?.shouldCache(query)) {
        const ttl = this.getDatabaseConfig(dbName)?.cache_ttl_seconds ?? 60;
        this.queryCache.set(dbName, query, params, result, ttl);
      }

      // Invalidate cache for mutation queries
      if (this.queryCache?.isMutation(query)) {
        this.queryCache.invalidate(dbName);
      }

      // Fire-and-forget audit log
      const dbConfig = this.getDatabaseConfig(dbName);
      if (dbConfig?.audit_log) {
        writeAuditLog(dbName, query, durationMs, 'success').catch(
          /* audit is best-effort */ () => undefined
        );
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // 5. On failure
      const category = this.classifyErrorCategory(error);

      // Only advance circuit breaker for CONNECTION/SSH errors
      if (category === 'CONNECTION' || category === 'SSH') {
        // Evict/close broken connection
        await this.closeConnection(dbName).catch((evictError) => {
          this.logger.error(`Failed to evict dead connection for database '${dbName}'`, {
            error: evictError.message,
          });
        });

        const currentCircuit = this.getCircuit(dbName);
        const prevStatus = currentCircuit.status;
        const newCircuit = recordFailure(currentCircuit, Date.now());
        this.circuits.set(dbName, newCircuit);
        if (prevStatus !== newCircuit.status) {
          this.metrics?.recordCircuitEvent(
            dbName,
            newCircuit.status === 'OPEN' ? 'open' : 'half_open'
          );
          this.emit('circuitStateChange', dbName, newCircuit.status);
        }
      }

      this.metrics?.recordQuery(dbName, durationMs, false, category);

      // Fire-and-forget audit log
      const dbConfig = this.getDatabaseConfig(dbName);
      if (dbConfig?.audit_log) {
        writeAuditLog(dbName, query, durationMs, `error:${category}`).catch(
          /* audit is best-effort */ () => undefined
        );
      }

      throw error;
    }
  }

  /**
   * Execute multiple queries in batch
   */
  async executeBatch(
    dbName: string,
    queries: Array<{ query: string; params?: unknown[]; label?: string }>,
    useTransaction = false
  ): Promise<BatchResult> {
    // Get connection (will create if doesn't exist)
    const connectionInfo = await this.getConnection(dbName);
    const adapter = this.adapters.get(dbName);

    if (!adapter) {
      throw new ConnectionError(`No adapter found for database '${dbName}'`);
    }

    const startTime = Date.now();
    const results: Array<{
      index: number;
      label: string;
      success: boolean;
      data?: QueryResult;
      error?: string;
      query: string;
      execution_time_ms?: number;
    }> = [];

    let transactionStarted = false;

    try {
      // Begin transaction if requested
      if (useTransaction) {
        await adapter.beginTransaction(connectionInfo.connection);
        transactionStarted = true;
      }

      // Execute each query
      for (let i = 0; i < queries.length; i++) {
        const queryObj = queries[i];
        const queryStartTime = Date.now();

        try {
          const result = await this.withQueryTimeout(
            dbName,
            () => adapter.executeQuery(connectionInfo.connection, queryObj.query, queryObj.params || []),
            'Batch query'
          );

          results.push({
            index: i,
            label: queryObj.label || `Query ${i + 1}`,
            success: true,
            data: result,
            query: queryObj.query,
            execution_time_ms: Date.now() - queryStartTime,
          });

          // Invalidate cache for mutation queries
          if (this.queryCache?.isMutation(queryObj.query)) {
            this.queryCache.invalidate(dbName);
          }
        } catch (error) {
          results.push({
            index: i,
            label: queryObj.label || `Query ${i + 1}`,
            success: false,
            error: (error as Error).message,
            query: queryObj.query,
            execution_time_ms: Date.now() - queryStartTime,
          });

          // If transaction is active and a query fails, rollback
          if (transactionStarted) {
            await adapter.rollbackTransaction(connectionInfo.connection);
            transactionStarted = false;
            throw error;
          }
        }
      }

      // Commit transaction if all succeeded
      if (transactionStarted) {
        await adapter.commitTransaction(connectionInfo.connection);
      }

      const totalTime = Date.now() - startTime;
      const successCount = results.filter((r) => r.success).length;

      return {
        totalExecutionTime: totalTime,
        results,
        successCount,
        failureCount: results.length - successCount,
        transactionUsed: useTransaction,
      };
    } catch (error) {
      // Rollback transaction if still active
      if (transactionStarted) {
        try {
          await adapter.rollbackTransaction(connectionInfo.connection);
        } catch (rollbackError) {
          this.logger.error(`Error rolling back transaction for '${dbName}'`, {
            error: (rollbackError as Error).message,
          });
        }
      }

      this.emit('error', error, dbName);
      throw error;
    }
  }

  /**
   * Race an operation against the configured per-database query timeout.
   * Note: this stops the client from waiting; server-side cancellation additionally
   * depends on the adapter (e.g. PostgreSQL statement_timeout).
   */
  private async withQueryTimeout<T>(
    dbName: string,
    op: () => Promise<T>,
    label = 'Operation'
  ): Promise<T> {
    const queryTimeout = this.getDatabaseConfig(dbName)?.query_timeout ?? 30000;
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`${label} timed out after ${queryTimeout}ms`)),
        queryTimeout
      );
      timeoutHandle.unref();
    });
    return Promise.race([op(), timeoutPromise]).finally(() =>
      clearTimeout(timeoutHandle)
    ) as Promise<T>;
  }

  /**
   * Analyze query performance with database-specific recommendations
   */
  async analyzePerformance(
    dbName: string,
    query: string
  ): Promise<{
    executionTime: number;
    explainTime: number;
    rowCount: number;
    columnCount: number;
    executionPlan: string;
    recommendations: string;
  }> {
    // Get connection (will create if doesn't exist)
    const connectionInfo = await this.getConnection(dbName);
    const adapter = this.adapters.get(dbName);

    if (!adapter) {
      throw new ConnectionError(`No adapter found for database '${dbName}'`);
    }

    try {
      // Execute the actual query to get timing and row info
      const startTime = Date.now();
      const result = await this.withQueryTimeout(
        dbName,
        () => adapter.executeQuery(connectionInfo.connection, query),
        'Performance analysis'
      );
      const executionTime = Date.now() - startTime;

      // Get execution plan
      const explainStartTime = Date.now();
      const explainQuery = adapter.buildExplainQuery(query);
      const explainResult = await this.withQueryTimeout(
        dbName,
        () => adapter.executeQuery(connectionInfo.connection, explainQuery),
        'Performance analysis (explain)'
      );
      const explainTime = Date.now() - explainStartTime;

      // Format execution plan based on database type
      const executionPlan = this.formatExecutionPlan(explainResult, connectionInfo.type);

      // Generate database-specific recommendations
      const recommendations = this.generatePerformanceRecommendations({
        query,
        result,
        explainResult,
        executionTime,
        databaseType: connectionInfo.type,
      });

      return {
        executionTime,
        explainTime,
        rowCount: result.rowCount,
        columnCount: result.fields.length,
        executionPlan,
        recommendations,
      };
    } catch (error) {
      this.emit('error', error, dbName);
      throw error;
    }
  }

  /**
   * Format execution plan based on database type
   */
  private formatExecutionPlan(explainResult: QueryResult, dbType: string): string {
    switch (dbType) {
      case 'postgresql':
        return explainResult.rows.map((row) => Object.values(row).join(' ')).join('\n');

      case 'mysql':
        return explainResult.rows
          .map((row) => {
            const vals = Object.values(row);
            return `${vals[0]} | ${vals[1]} | ${vals[2]} | ${vals[3]}`;
          })
          .join('\n');

      case 'sqlite':
        return explainResult.rows.map((row) => Object.values(row).join(' | ')).join('\n');

      default:
        return explainResult.rows.map((row) => Object.values(row).join(' | ')).join('\n');
    }
  }

  /**
   * Generate database-specific performance recommendations
   */
  private generatePerformanceRecommendations(options: {
    query: string;
    result: QueryResult;
    explainResult: QueryResult;
    executionTime: number;
    databaseType: string;
  }): string {
    const { query, result, explainResult, executionTime, databaseType } = options;
    const recommendations: string[] = ['Performance Analysis Results:'];

    // Basic execution metrics
    recommendations.push(`- Query executed successfully in ${executionTime}ms`);
    recommendations.push(`- Returned ${result.rowCount} rows with ${result.fields.length} columns`);

    // Performance warnings based on execution time
    if (executionTime > 5000) {
      recommendations.push(
        ' CRITICAL: Query took over 5 seconds - requires immediate optimization'
      );
    } else if (executionTime > 1000) {
      recommendations.push(' WARNING: Slow query detected (>1s) - consider optimization');
    } else if (executionTime > 500) {
      recommendations.push('[INFO]: Moderate execution time - monitor for performance');
    } else {
      recommendations.push(' GOOD: Query performance is acceptable');
    }

    // Large result set warnings
    if (result.rowCount > 10000) {
      recommendations.push(' LARGE DATASET: Consider adding LIMIT clause or pagination');
    } else if (result.rowCount > 1000) {
      recommendations.push('[INFO]: Large result set - verify if all rows are needed');
    }

    // Query analysis recommendations
    const upperQuery = query.toUpperCase();

    if (upperQuery.includes('SELECT *')) {
      recommendations.push(
        ' TIP: Use specific column names instead of SELECT * for better performance'
      );
    }

    if (!upperQuery.includes('LIMIT') && !upperQuery.includes('TOP')) {
      recommendations.push(
        ' TIP: Consider adding LIMIT clause to prevent unexpected large results'
      );
    }

    // Database-specific recommendations
    switch (databaseType) {
      case 'postgresql':
        this.addPostgreSQLRecommendations(recommendations, explainResult, query);
        break;
      case 'mysql':
        this.addMySQLRecommendations(recommendations, explainResult, query);
        break;
      case 'sqlite':
        this.addSQLiteRecommendations(recommendations, explainResult, query);
        break;
    }

    // Join analysis
    const joinCount = (upperQuery.match(/\bJOIN\b/g) || []).length;
    if (joinCount > 3) {
      recommendations.push(
        ' COMPLEX: Multiple JOINs detected - ensure proper indexing on join columns'
      );
    } else if (joinCount > 0) {
      recommendations.push('[INFO]: JOINs detected - verify indexes exist on join columns');
    }

    return recommendations.join('\n');
  }

  /**
   * Add PostgreSQL-specific recommendations
   */
  private addPostgreSQLRecommendations(
    recommendations: string[],
    explainResult: QueryResult,
    query: string
  ): void {
    const planText = explainResult.rows
      .map((row) => Object.values(row).join(' '))
      .join(' ')
      .toLowerCase();

    if (planText.includes('seq scan')) {
      recommendations.push(' POSTGRESQL: Sequential scan detected - consider adding indexes');
    }

    if (planText.includes('nested loop') && planText.includes('buffers')) {
      recommendations.push(' POSTGRESQL: Nested loops with buffer usage - check join conditions');
    }

    if (query.toUpperCase().includes('LIKE') && query.includes('%')) {
      recommendations.push(
        ' POSTGRESQL: LIKE with wildcards - consider full-text search (GIN indexes)'
      );
    }
  }

  /**
   * Add MySQL-specific recommendations
   */
  private addMySQLRecommendations(
    recommendations: string[],
    explainResult: QueryResult,
    _query: string
  ): void {
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
  }

  /**
   * Add SQLite-specific recommendations
   */
  private addSQLiteRecommendations(
    recommendations: string[],
    explainResult: QueryResult,
    _query: string
  ): void {
    const planText = explainResult.rows
      .map((row) => Object.values(row).join(' '))
      .join(' ')
      .toLowerCase();

    if (planText.includes('scan table')) {
      recommendations.push(' SQLITE: Table scan detected - consider adding indexes');
    }

    if (planText.includes('temp b-tree')) {
      recommendations.push(' SQLITE: Temporary B-tree created - optimize sorting operations');
    }

    recommendations.push(
      '[INFO] SQLITE: Run ANALYZE command periodically to update query planner statistics'
    );
  }
}
