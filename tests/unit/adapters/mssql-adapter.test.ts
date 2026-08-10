/**
 * SQL Server (MSSQL) Database Adapter Tests
 * Tests the MSSQL-specific database adapter implementation
 */

import { MSSQLAdapter } from '../../../src/database/adapters/mssql.js';
import type {
  DatabaseConnection,
  DatabaseConfig,
  QueryResult,
  DatabaseSchema,
} from '../../../src/types/index.js';

// Mock variables must be declared before jest.mock() calls
const mockRequest = jest.fn(() => ({
  input: jest.fn().mockReturnThis(),
  query: jest.fn(),
}));

const mockConnect = jest.fn();
const mockClose = jest.fn();

const mockConnectionPool = {
  connect: mockConnect,
  close: mockClose,
  connected: true,
  request: mockRequest,
};

// Mock the 'mssql' module
jest.mock('mssql', () => ({
  ConnectionPool: jest.fn(),
}));

import * as mssql from 'mssql';

// Use jest.mocked for proper typing
const mockMSSQLConnectionPool = jest.mocked(mssql.ConnectionPool);

// ============================================================================
// Test Suite
// ============================================================================

describe('MSSQLAdapter', () => {
  let config: DatabaseConfig;
  let adapter: MSSQLAdapter;
  let mockRequestInstance: any;

  beforeEach(() => {
    config = {
      type: 'mssql',
      host: 'localhost',
      port: 1433,
      database: 'testdb',
      username: 'testuser',
      password: 'testpass',
      timeout: 30000,
      encrypt: true,
    };

    adapter = new MSSQLAdapter(config);

    // Create a mock request instance
    mockRequestInstance = {
      input: jest.fn().mockReturnThis(),
      query: jest.fn(),
    };

    // Reset mocks
    jest.clearAllMocks();
    mockMSSQLConnectionPool.mockReturnValue(mockConnectionPool as any);
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockRequest.mockReturnValue(mockRequestInstance);
    mockRequestInstance.query.mockResolvedValue({
      recordset: [{ id: 1, name: 'test' }],
      recordsets: [[{ id: 1, name: 'test' }]],
    });
    mockConnectionPool.connected = true;
  });

  // ============================================================================
  // Constructor and Configuration Tests
  // ============================================================================

  describe('constructor', () => {
    it('should initialize with valid MSSQL config', () => {
      expect(adapter.getType()).toBe('mssql');
      expect(adapter.getConfig().host).toBe('localhost');
      expect(adapter.getConfig().port).toBe(1433);
    });

    it('should handle port as string', () => {
      const stringPortConfig = { ...config, port: '1434' as any };
      const stringAdapter = new MSSQLAdapter(stringPortConfig);
      expect(stringAdapter.getConfig().port).toBe('1434');
    });
  });

  // ============================================================================
  // Connection Management Tests
  // ============================================================================

  describe('connect', () => {
    it('should connect to SQL Server database successfully', async () => {
      const connection = await adapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith({
        server: 'localhost',
        port: 1433,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        connectionTimeout: 30000,
        requestTimeout: 30000,
        options: {
          encrypt: true,
          trustServerCertificate: false,
          enableArithAbort: true,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      });
      expect(mockConnect).toHaveBeenCalled();
      expect(connection).toBe(mockConnectionPool);
    });

    it('should handle encryption configuration', async () => {
      const encryptConfig = { ...config, encrypt: false };
      const encryptAdapter = new MSSQLAdapter(encryptConfig);

      await encryptAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            encrypt: false,
          }),
        })
      );
    });

    it('should use default encryption when not specified', async () => {
      const noEncryptConfig = { ...config };
      delete noEncryptConfig.encrypt;
      const noEncryptAdapter = new MSSQLAdapter(noEncryptConfig);

      await noEncryptAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            encrypt: true, // Default value
          }),
        })
      );
    });

    it('should default ssl_verify to true (trustServerCertificate false)', async () => {
      const noSslVerifyConfig = { ...config };
      delete noSslVerifyConfig.ssl_verify;
      const noSslVerifyAdapter = new MSSQLAdapter(noSslVerifyConfig);

      await noSslVerifyAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            trustServerCertificate: false, // ssl_verify defaults to true, negated = false
          }),
        })
      );
    });

    it('should respect explicit ssl_verify=false (trustServerCertificate true)', async () => {
      const sslVerifyFalseConfig = { ...config, ssl_verify: false };
      const sslVerifyFalseAdapter = new MSSQLAdapter(sslVerifyFalseConfig);

      await sslVerifyFalseAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            trustServerCertificate: true, // ssl_verify=false, negated = true
          }),
        })
      );
    });

    it('should validate required configuration fields', async () => {
      const incompleteConfig = { type: 'mssql' as const };
      const incompleteAdapter = new MSSQLAdapter(incompleteConfig);

      await expect(incompleteAdapter.connect()).rejects.toThrow(
        'Missing required configuration fields: host, database, username, password'
      );
    });

    it('should handle connection errors', async () => {
      const connectionError = new Error('Connection failed');
      mockConnect.mockRejectedValueOnce(connectionError);

      await expect(adapter.connect()).rejects.toThrow(
        'mssql adapter error: Failed to connect to SQL Server database - Connection failed'
      );
    });

    it('should use default port when not specified', async () => {
      const noPortConfig = { ...config };
      delete noPortConfig.port;
      const noPortAdapter = new MSSQLAdapter(noPortConfig);

      await noPortAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 1433,
        })
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect from SQL Server database successfully', async () => {
      const connection = await adapter.connect();
      await adapter.disconnect(connection);

      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle disconnect errors', async () => {
      const disconnectError = new Error('Disconnect failed');
      mockClose.mockRejectedValueOnce(disconnectError);

      const connection = await adapter.connect();
      await expect(adapter.disconnect(connection)).rejects.toThrow(
        'mssql adapter error: Failed to disconnect from SQL Server database - Disconnect failed'
      );
    });
  });

  describe('isConnected', () => {
    it('should return true for connected pool', async () => {
      const connection = await adapter.connect();
      mockConnectionPool.connected = true;

      expect(adapter.isConnected(connection)).toBe(true);
    });

    it('should return false for disconnected pool', async () => {
      const connection = await adapter.connect();
      mockConnectionPool.connected = false;

      expect(adapter.isConnected(connection)).toBe(false);
    });

    it('should return false for invalid connection', () => {
      expect(adapter.isConnected(null as any)).toBe(false);
      expect(adapter.isConnected({} as any)).toBe(false);
    });

    it('should handle exceptions gracefully', () => {
      const badConnection = {
        get connected() {
          throw new Error('Property access failed');
        },
      };

      expect(adapter.isConnected(badConnection as any)).toBe(false);
    });
  });

  // ============================================================================
  // Query Execution Tests
  // ============================================================================

  describe('executeQuery', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should execute query successfully', async () => {
      const mockResult = {
        recordset: [
          { id: 1, name: 'John' },
          { id: 2, name: 'Jane' },
        ],
        recordsets: [
          [
            { id: 1, name: 'John' },
            { id: 2, name: 'Jane' },
          ],
        ],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');

      expect(mockRequest).toHaveBeenCalled();
      expect(mockRequestInstance.query).toHaveBeenCalledWith('SELECT * FROM users');
      expect(result.rows).toEqual([
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' },
      ]);
      expect(result.fields).toEqual(['id', 'name']);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should execute query with parameters', async () => {
      const mockResult = {
        recordset: [{ id: 1, name: 'John' }],
        recordsets: [[{ id: 1, name: 'John' }]],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ?', [1]);

      expect(mockRequestInstance.input).toHaveBeenCalledWith('param0', 1);
      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = @param0'
      );
    });

    it('should handle multiple parameters', async () => {
      const mockResult = {
        recordset: [{ id: 1, name: 'John' }],
        recordsets: [[{ id: 1, name: 'John' }]],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ? AND active = ?', [
        1,
        true,
      ]);

      expect(mockRequestInstance.input).toHaveBeenCalledWith('param0', 1);
      expect(mockRequestInstance.input).toHaveBeenCalledWith('param1', true);
      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = @param0 AND active = @param1'
      );
    });

    it('should handle query execution errors', async () => {
      const queryError = new Error('Query execution failed');
      mockRequestInstance.query.mockRejectedValueOnce(queryError);

      await expect(adapter.executeQuery(connection, 'INVALID SQL')).rejects.toThrow(
        'mssql adapter error: Failed to execute SQL Server query - Query execution failed'
      );
    });

    it('should handle empty result sets', async () => {
      const mockResult = {
        recordset: [],
        recordsets: [[]],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM empty_table');

      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
      expect(result.rowCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('should handle result truncation', async () => {
      // Create mock result with more rows than the limit
      const largeRowSet = Array(1500)
        .fill(0)
        .map((_, i) => ({ id: i + 1, name: `User${i + 1}` }));
      const mockResult = {
        recordset: largeRowSet,
        recordsets: [largeRowSet],
      };
      mockRequestInstance.query.mockResolvedValueOnce(mockResult);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM large_table');

      expect(result.rows).toHaveLength(1000); // Should be truncated to max_rows
      expect(result.rowCount).toBe(1500); // Original count before truncation
      expect(result.truncated).toBe(true);
    });

    it('should handle malformed query results gracefully', async () => {
      // Mock a result without the expected structure
      const malformedResult = {
        // Missing recordset property
        someOtherProperty: 'value',
      };
      mockRequestInstance.query.mockResolvedValueOnce(malformedResult);

      const result = await adapter.executeQuery(connection, 'SELECT 1');

      // Should handle gracefully and return empty results
      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
    });
  });

  // ============================================================================
  // Transaction Management Tests
  // ============================================================================

  describe('transaction management', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    describe('beginTransaction', () => {
      it('should begin transaction successfully', async () => {
        await adapter.beginTransaction(connection);
        expect(mockRequestInstance.query).toHaveBeenCalledWith('BEGIN TRANSACTION');
      });

      it('should handle begin transaction errors', async () => {
        const transactionError = new Error('Begin failed');
        mockRequestInstance.query.mockRejectedValueOnce(transactionError);

        await expect(adapter.beginTransaction(connection)).rejects.toThrow(
          'mssql adapter error: Failed to begin SQL Server transaction - Begin failed'
        );
      });
    });

    describe('commitTransaction', () => {
      it('should commit transaction successfully', async () => {
        await adapter.commitTransaction(connection);
        expect(mockRequestInstance.query).toHaveBeenCalledWith('COMMIT TRANSACTION');
      });

      it('should handle commit transaction errors', async () => {
        const commitError = new Error('Commit failed');
        mockRequestInstance.query.mockRejectedValueOnce(commitError);

        await expect(adapter.commitTransaction(connection)).rejects.toThrow(
          'mssql adapter error: Failed to commit SQL Server transaction - Commit failed'
        );
      });
    });

    describe('rollbackTransaction', () => {
      it('should rollback transaction successfully', async () => {
        await adapter.rollbackTransaction(connection);
        expect(mockRequestInstance.query).toHaveBeenCalledWith('ROLLBACK TRANSACTION');
      });

      it('should handle rollback transaction errors', async () => {
        const rollbackError = new Error('Rollback failed');
        mockRequestInstance.query.mockRejectedValueOnce(rollbackError);

        await expect(adapter.rollbackTransaction(connection)).rejects.toThrow(
          'mssql adapter error: Failed to rollback SQL Server transaction - Rollback failed'
        );
      });
    });
  });

  // ============================================================================
  // Performance Analysis Tests
  // ============================================================================

  describe('buildExplainQuery', () => {
    it('should build SQL Server explain query with showplan', () => {
      const query = 'SELECT * FROM users WHERE active = 1';
      const explainQuery = adapter.buildExplainQuery(query);

      expect(explainQuery).toBe(
        'SET SHOWPLAN_ALL ON; SELECT * FROM users WHERE active = 1; SET SHOWPLAN_ALL OFF'
      );
    });

    it('should handle complex queries', () => {
      const complexQuery = `
 SELECT u.name, p.title 
 FROM users u 
 JOIN posts p ON u.id = p.user_id 
 WHERE u.created_at > '2023-01-01'
 `;

      const explainQuery = adapter.buildExplainQuery(complexQuery);
      expect(explainQuery).toContain('SET SHOWPLAN_ALL ON;');
      expect(explainQuery).toContain(complexQuery);
      expect(explainQuery).toContain('SET SHOWPLAN_ALL OFF');
    });
  });

  // ============================================================================
  // Schema Capture Tests
  // ============================================================================

  describe('captureSchema', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    it('should capture database schema successfully', async () => {
      // Mock tables query result
      const tablesResult = {
        recordset: [
          { TABLE_NAME: 'users', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: '' },
          { TABLE_NAME: 'posts', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: '' },
          { TABLE_NAME: 'user_stats', TABLE_TYPE: 'VIEW', TABLE_COMMENT: '' },
        ],
      };

      // Mock columns query results
      const usersColumnsResult = {
        recordset: [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            COLUMN_COMMENT: 'Primary key',
            COLUMN_KEY: 'PRI',
          },
          {
            COLUMN_NAME: 'name',
            DATA_TYPE: 'nvarchar',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: 100,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            COLUMN_COMMENT: 'Full name',
            COLUMN_KEY: '',
          },
        ],
      };

      const postsColumnsResult = {
        recordset: [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            COLUMN_COMMENT: '',
            COLUMN_KEY: 'PRI',
          },
        ],
      };

      const userStatsColumnsResult = {
        recordset: [
          {
            COLUMN_NAME: 'user_id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: 10,
            NUMERIC_SCALE: 0,
            COLUMN_COMMENT: 'User ID reference',
            COLUMN_KEY: '',
          },
        ],
      };

      // Set up query responses in order
      mockRequestInstance.query
        .mockResolvedValueOnce(tablesResult)
        .mockResolvedValueOnce(usersColumnsResult)
        .mockResolvedValueOnce(postsColumnsResult)
        .mockResolvedValueOnce(userStatsColumnsResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.database).toBe('testdb');
      expect(schema.type).toBe('mssql');
      expect(schema.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Check tables
      expect(Object.keys(schema.tables)).toHaveLength(2);
      expect(schema.tables.users).toBeDefined();
      expect(schema.tables.users.name).toBe('users');
      expect(schema.tables.users.columns).toHaveLength(2);
      expect(schema.tables.users.columns[0].name).toBe('id');
      expect(schema.tables.users.columns[0].nullable).toBe(false);
      expect(schema.tables.users.columns[0].key).toBe('PRI');
      expect(schema.tables.users.columns[1].name).toBe('name');
      expect(schema.tables.users.columns[1].max_length).toBe(100);

      // Check views
      expect(Object.keys(schema.views)).toHaveLength(1);
      expect(schema.views.user_stats).toBeDefined();
      expect(schema.views.user_stats.name).toBe('user_stats');
      expect(schema.views.user_stats.type).toBe('VIEW');

      // Check summary
      expect(schema.summary.table_count).toBe(2);
      expect(schema.summary.view_count).toBe(1);
      expect(schema.summary.total_columns).toBe(4);

      // Verify query calls
      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM INFORMATION_SCHEMA.TABLES')
      );
      expect(mockRequestInstance.input).toHaveBeenCalledWith('tableName', 'users');
    });

    it('should handle schema capture errors', async () => {
      const schemaError = new Error('Schema query failed');
      mockRequestInstance.query.mockRejectedValueOnce(schemaError);

      await expect(adapter.captureSchema(connection)).rejects.toThrow(
        'mssql adapter error: Failed to capture SQL Server schema - Schema query failed'
      );
    });

    it('should handle empty schema results', async () => {
      const emptyResult = { recordset: [] };
      mockRequestInstance.query.mockResolvedValueOnce(emptyResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables).toEqual({});
      expect(schema.views).toEqual({});
      expect(schema.summary.table_count).toBe(0);
      expect(schema.summary.view_count).toBe(0);
      expect(schema.summary.total_columns).toBe(0);
    });

    it('should handle missing column metadata gracefully', async () => {
      const tablesResult = {
        recordset: [{ TABLE_NAME: 'test_table', TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: null }],
      };

      const columnsResult = {
        recordset: [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            NUMERIC_PRECISION: null,
            NUMERIC_SCALE: null,
            COLUMN_COMMENT: null,
            COLUMN_KEY: null,
          },
        ],
      };

      mockRequestInstance.query
        .mockResolvedValueOnce(tablesResult)
        .mockResolvedValueOnce(columnsResult);

      const schema = await adapter.captureSchema(connection);

      expect(schema.tables.test_table.comment).toBe('');
      expect(schema.tables.test_table.columns[0].comment).toBe('');
      expect(schema.tables.test_table.columns[0].key).toBe('');
    });
  });

  // ============================================================================
  // SQL Server-specific Methods Tests
  // ============================================================================

  describe('SQL Server-specific methods', () => {
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = await adapter.connect();
    });

    describe('getVersion', () => {
      it('should get SQL Server version successfully', async () => {
        const versionResult = {
          recordset: [{ version: 'Microsoft SQL Server 2019 (RTM) - 15.0.2000.5' }],
        };
        mockRequestInstance.query.mockResolvedValueOnce(versionResult);

        const version = await adapter.getVersion(connection);

        expect(mockRequestInstance.query).toHaveBeenCalledWith('SELECT @@VERSION as version');
        expect(version).toBe('Microsoft SQL Server 2019 (RTM) - 15.0.2000.5');
      });

      it('should handle version query errors', async () => {
        const versionError = new Error('Version query failed');
        mockRequestInstance.query.mockRejectedValueOnce(versionError);

        await expect(adapter.getVersion(connection)).rejects.toThrow(
          'mssql adapter error: Failed to get SQL Server version - Version query failed'
        );
      });

      it('should handle empty version result', async () => {
        const emptyResult = { recordset: [] };
        mockRequestInstance.query.mockResolvedValueOnce(emptyResult);

        const version = await adapter.getVersion(connection);
        expect(version).toBe('Unknown');
      });
    });

    describe('getDatabaseSize', () => {
      it('should get database size successfully', async () => {
        const sizeResult = {
          recordset: [
            {
              database_name: 'testdb',
              size_mb: 128.5,
              data_size_mb: 64.0,
              log_size_mb: 64.5,
            },
          ],
        };
        mockRequestInstance.query.mockResolvedValueOnce(sizeResult);

        const size = await adapter.getDatabaseSize(connection);

        expect(mockRequestInstance.query).toHaveBeenCalledWith(
          expect.stringContaining('FROM sys.database_files')
        );
        expect(size).toEqual({
          database_name: 'testdb',
          size_mb: 128.5,
          data_size_mb: 64.0,
          log_size_mb: 64.5,
        });
      });

      it('should handle database size query errors', async () => {
        const sizeError = new Error('Size query failed');
        mockRequestInstance.query.mockRejectedValueOnce(sizeError);

        await expect(adapter.getDatabaseSize(connection)).rejects.toThrow(
          'mssql adapter error: Failed to get SQL Server database size - Size query failed'
        );
      });

      it('should handle empty size result', async () => {
        const emptyResult = { recordset: [] };
        mockRequestInstance.query.mockResolvedValueOnce(emptyResult);

        const size = await adapter.getDatabaseSize(connection);
        expect(size).toEqual({});
      });
    });

    describe('getTableStats', () => {
      it('should get table statistics successfully', async () => {
        const statsResult = {
          recordset: [
            {
              table_name: 'users',
              row_count: 1000,
              total_space_kb: 8192,
              used_space_kb: 6144,
              unused_space_kb: 2048,
            },
            {
              table_name: 'posts',
              row_count: 5000,
              total_space_kb: 16384,
              used_space_kb: 12288,
              unused_space_kb: 4096,
            },
          ],
        };
        mockRequestInstance.query.mockResolvedValueOnce(statsResult);

        const stats = await adapter.getTableStats(connection);

        expect(mockRequestInstance.query).toHaveBeenCalledWith(
          expect.stringContaining('FROM sys.tables')
        );
        expect(stats).toHaveLength(2);
        expect(stats[0]).toEqual(
          expect.objectContaining({
            table_name: 'users',
            row_count: 1000,
          })
        );
      });

      it('should handle table stats query errors', async () => {
        const statsError = new Error('Stats query failed');
        mockRequestInstance.query.mockRejectedValueOnce(statsError);

        await expect(adapter.getTableStats(connection)).rejects.toThrow(
          'mssql adapter error: Failed to get SQL Server table statistics - Stats query failed'
        );
      });
    });

    describe('getActiveConnections', () => {
      it('should get active connections successfully', async () => {
        const connectionsResult = {
          recordset: [
            {
              session_id: 52,
              login_time: '2023-01-01T10:00:00.000Z',
              host_name: 'CLIENT01',
              program_name: 'SSMS',
              login_name: 'testuser',
              status: 'sleeping',
              cpu_time: 1000,
              memory_usage: 2048,
            },
          ],
        };
        mockRequestInstance.query.mockResolvedValueOnce(connectionsResult);

        const connections = await adapter.getActiveConnections(connection);

        expect(mockRequestInstance.query).toHaveBeenCalledWith(
          expect.stringContaining('FROM sys.dm_exec_sessions')
        );
        expect(connections).toHaveLength(1);
        expect(connections[0]).toEqual(
          expect.objectContaining({
            session_id: 52,
            login_name: 'testuser',
          })
        );
      });

      it('should handle active connections query errors', async () => {
        const connectionsError = new Error('Connections query failed');
        mockRequestInstance.query.mockRejectedValueOnce(connectionsError);

        await expect(adapter.getActiveConnections(connection)).rejects.toThrow(
          'mssql adapter error: Failed to get SQL Server active connections - Connections query failed'
        );
      });
    });
  });

  // ============================================================================
  // Integration Scenarios Tests
  // ============================================================================

  describe('integration scenarios', () => {
    it('should handle complete workflow: connect -> query -> transaction -> disconnect', async () => {
      // Connect
      const connection = await adapter.connect();
      expect(adapter.isConnected(connection)).toBe(true);

      // Execute query
      const result = await adapter.executeQuery(connection, 'SELECT * FROM users');
      expect(result).toBeDefined();

      // Transaction workflow
      await adapter.beginTransaction(connection);
      await adapter.executeQuery(connection, 'INSERT INTO users (name) VALUES (?)', ['John']);
      await adapter.commitTransaction(connection);

      // Disconnect
      await adapter.disconnect(connection);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should handle transaction rollback scenario', async () => {
      const connection = await adapter.connect();

      await adapter.beginTransaction(connection);

      // Simulate error during transaction
      // Simulate error during transaction execution
      const insertError = new Error('Insert failed');
      mockRequestInstance.query.mockRejectedValueOnce(insertError);

      try {
        await adapter.executeQuery(connection, 'INSERT INTO users (invalid_column) VALUES (?)', [
          'value',
        ]);
      } catch (error) {
        await adapter.rollbackTransaction(connection);
      }

      expect(mockRequestInstance.query).toHaveBeenCalledWith('BEGIN TRANSACTION');
      expect(mockRequestInstance.query).toHaveBeenCalledWith('ROLLBACK TRANSACTION');
    });

    it('should handle concurrent operations', async () => {
      const connection = await adapter.connect();

      // Execute multiple queries concurrently
      const queries = [
        adapter.executeQuery(connection, 'SELECT 1'),
        adapter.executeQuery(connection, 'SELECT 2'),
        adapter.executeQuery(connection, 'SELECT 3'),
      ];

      const results = await Promise.all(queries);
      expect(results).toHaveLength(3);
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe('error handling and edge cases', () => {
    it('should handle missing recordset in query results', async () => {
      const connection = await adapter.connect();

      const resultWithoutRecordset = {
        // recordset property is missing
        someOtherProperty: 'value',
      };
      mockRequestInstance.query.mockResolvedValueOnce(resultWithoutRecordset);

      const result = await adapter.executeQuery(connection, 'SELECT * FROM test');
      expect(result.rows).toEqual([]);
      expect(result.fields).toEqual([]);
    });

    it('should handle encrypt configuration edge cases', async () => {
      // Test with encrypt as string 'false'
      const encryptStringConfig = { ...config, encrypt: 'false' as any };
      const encryptStringAdapter = new MSSQLAdapter(encryptStringConfig);

      await encryptStringAdapter.connect();

      // Should parse 'false' string as boolean false
      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            encrypt: false,
          }),
        })
      );
    });

    it('should handle null or undefined query parameters', async () => {
      const connection = await adapter.connect();

      await adapter.executeQuery(connection, 'SELECT * FROM users WHERE id = ? AND name = ?', [
        null,
        undefined,
      ]);

      expect(mockRequestInstance.input).toHaveBeenCalledWith('param0', null);
      expect(mockRequestInstance.input).toHaveBeenCalledWith('param1', undefined);
    });

    it('should handle complex parameter replacement', async () => {
      const connection = await adapter.connect();

      const complexQuery =
        'SELECT * FROM users WHERE id = ? AND name LIKE ? AND active = ? ORDER BY created_at';
      await adapter.executeQuery(connection, complexQuery, [1, '%John%', true]);

      expect(mockRequestInstance.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = @param0 AND name LIKE @param1 AND active = @param2 ORDER BY created_at'
      );
    });

    it('should handle connection pool configuration edge cases', async () => {
      // Test with very small timeout
      const smallTimeoutConfig = { ...config, timeout: 1000 };
      const smallTimeoutAdapter = new MSSQLAdapter(smallTimeoutConfig);

      await smallTimeoutAdapter.connect();

      expect(mockMSSQLConnectionPool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: 1000,
          requestTimeout: 1000,
        })
      );
    });
  });

  // ============================================================================
  // Performance Recommendations
  // ============================================================================

  describe('getPerformanceRecommendations', () => {
    it('should return no dialect-specific advice', () => {
      // MSSQL has no SHOWPLAN-specific analysis yet; it inherits the empty base default.
      const explainResult: QueryResult = {
        rows: [{ StmtText: 'SELECT * FROM users', EstimateRows: 1000 }],
        rowCount: 1,
        fields: ['StmtText', 'EstimateRows'],
        truncated: false,
        execution_time_ms: 1,
      };

      expect(adapter.getPerformanceRecommendations(explainResult, 'SELECT * FROM users')).toEqual(
        []
      );
    });
  });
});
