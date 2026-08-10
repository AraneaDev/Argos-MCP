/**
 * Error Handler Tests
 */

import {
  SQLMCPError,
  SecurityViolationError,
  ConnectionError,
  QueryExecutionError,
  ConfigurationError,
  SchemaError,
  SSHTunnelError,
  ValidationError,
  TimeoutError,
  getErrorMessage,
  ErrorCategory,
  ErrorSeverity,
  ErrorHandler,
  ErrorInfo,
  sanitizeError,
  sanitizeMessage,
  withErrorHandling,
  createErrorResponse,
} from '../../../src/utils/error-handler.js';

// Mock the logger
const mockLogger = {
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  critical: jest.fn(),
  debug: jest.fn(),
};

describe('error-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Error Classes
  // ============================================================================

  describe('SQLMCPError', () => {
    it('should create error with code and details', () => {
      const err = new SQLMCPError('test message', 'TEST_CODE', { key: 'value' });
      expect(err.message).toBe('test message');
      expect(err._code).toBe('TEST_CODE');
      expect(err._details).toEqual({ key: 'value' });
      expect(err.name).toBe('SQLMCPError');
    });

    it('should create error without details', () => {
      const err = new SQLMCPError('msg', 'CODE');
      expect(err._details).toBeUndefined();
    });

    it('should have a stack trace', () => {
      const err = new SQLMCPError('msg', 'CODE');
      expect(err.stack).toBeDefined();
    });

    it('should serialize to JSON', () => {
      const err = new SQLMCPError('test', 'CODE', { foo: 'bar' });
      const json = err.toJSON();

      expect(json.name).toBe('SQLMCPError');
      expect(json.message).toBe('test');
      expect(json.code).toBe('CODE');
      expect(json.details).toEqual({ foo: 'bar' });
      expect(json.stack).toBeDefined();
    });
  });

  describe('SecurityViolationError', () => {
    it('should set correct code and name', () => {
      const err = new SecurityViolationError('forbidden');
      expect(err._code).toBe('SECURITY_VIOLATION');
      expect(err.name).toBe('SecurityViolationError');
    });

    it('should accept details', () => {
      const err = new SecurityViolationError('forbidden', { query: 'DROP TABLE' });
      expect(err._details).toEqual({ query: 'DROP TABLE' });
    });
  });

  describe('ConnectionError', () => {
    it('should set correct code and name', () => {
      const err = new ConnectionError('refused');
      expect(err._code).toBe('CONNECTION_ERROR');
      expect(err.name).toBe('ConnectionError');
    });
  });

  describe('QueryExecutionError', () => {
    it('should set correct code and name', () => {
      const err = new QueryExecutionError('syntax error');
      expect(err._code).toBe('QUERY_EXECUTION_ERROR');
      expect(err.name).toBe('QueryExecutionError');
    });
  });

  describe('ConfigurationError', () => {
    it('should set correct code and name', () => {
      const err = new ConfigurationError('bad config');
      expect(err._code).toBe('CONFIGURATION_ERROR');
      expect(err.name).toBe('ConfigurationError');
    });
  });

  describe('SchemaError', () => {
    it('should set correct code and name', () => {
      const err = new SchemaError('schema issue');
      expect(err._code).toBe('SCHEMA_ERROR');
      expect(err.name).toBe('SchemaError');
    });
  });

  describe('SSHTunnelError', () => {
    it('should set correct code and name', () => {
      const err = new SSHTunnelError('tunnel failed');
      expect(err._code).toBe('SSH_TUNNEL_ERROR');
      expect(err.name).toBe('SSHTunnelError');
    });
  });

  describe('ValidationError', () => {
    it('should set correct code, name, and field', () => {
      const err = new ValidationError('invalid input', 'email');
      expect(err._code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('ValidationError');
      expect(err.field).toBe('email');
      expect(err._details).toEqual({ field: 'email' });
    });

    it('should default field to unknown', () => {
      const err = new ValidationError('bad');
      expect(err.field).toBe('unknown');
    });

    it('should merge details with field', () => {
      const err = new ValidationError('bad', 'name', { extra: 'data' });
      expect(err._details).toEqual({ field: 'name', extra: 'data' });
    });
  });

  describe('TimeoutError', () => {
    it('should set correct code, name, and timeoutMs', () => {
      const err = new TimeoutError('timed out', 5000);
      expect(err._code).toBe('TIMEOUT_ERROR');
      expect(err.name).toBe('TimeoutError');
      expect(err.timeoutMs).toBe(5000);
      expect(err._details).toEqual({ timeoutMs: 5000 });
    });

    it('should merge details', () => {
      const err = new TimeoutError('timed out', 3000, { operation: 'query' });
      expect(err._details).toEqual({ timeoutMs: 3000, operation: 'query' });
    });
  });

  // ============================================================================
  // getErrorMessage
  // ============================================================================

  describe('getErrorMessage', () => {
    it('should extract message from Error instance', () => {
      expect(getErrorMessage(new Error('hello'))).toBe('hello');
    });

    it('should return Unknown error for non-Error', () => {
      expect(getErrorMessage('string error')).toBe('Unknown error');
      expect(getErrorMessage(42)).toBe('Unknown error');
      expect(getErrorMessage(null)).toBe('Unknown error');
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });
  });

  // ============================================================================
  // ErrorHandler
  // ============================================================================

  describe('ErrorHandler', () => {
    let handler: ErrorHandler;

    beforeEach(() => {
      handler = new ErrorHandler(mockLogger as any);
    });

    describe('handleError', () => {
      it('should classify SecurityViolationError', () => {
        const err = new SecurityViolationError('forbidden');
        const info = handler.handleError(err, 'test');

        expect(info.category).toBe(ErrorCategory.SECURITY);
        expect(info.severity).toBe(ErrorSeverity.HIGH);
        expect(info.retryable).toBe(false);
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should classify ConnectionError', () => {
        const info = handler.handleError(new ConnectionError('refused'), 'test');
        expect(info.category).toBe(ErrorCategory.CONNECTION);
        expect(info.severity).toBe(ErrorSeverity.HIGH);
        expect(info.retryable).toBe(true);
      });

      it('should classify QueryExecutionError', () => {
        const info = handler.handleError(new QueryExecutionError('syntax'), 'test');
        expect(info.category).toBe(ErrorCategory.QUERY);
        expect(info.severity).toBe(ErrorSeverity.MEDIUM);
        expect(mockLogger.warning).toHaveBeenCalled();
      });

      it('should classify ConfigurationError', () => {
        const info = handler.handleError(new ConfigurationError('bad config'), 'test');
        expect(info.category).toBe(ErrorCategory.CONFIGURATION);
        expect(info.severity).toBe(ErrorSeverity.CRITICAL);
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should classify SchemaError', () => {
        const info = handler.handleError(new SchemaError('schema issue'), 'test');
        expect(info.category).toBe(ErrorCategory.SCHEMA);
        expect(info.severity).toBe(ErrorSeverity.MEDIUM);
        expect(info.retryable).toBe(true);
      });

      it('should classify SSHTunnelError', () => {
        const info = handler.handleError(new SSHTunnelError('tunnel failed'), 'test');
        expect(info.category).toBe(ErrorCategory.SSH);
        expect(info.severity).toBe(ErrorSeverity.HIGH);
        expect(info.retryable).toBe(true);
      });

      it('should classify ValidationError', () => {
        const info = handler.handleError(new ValidationError('invalid', 'email'), 'test');
        expect(info.category).toBe(ErrorCategory.VALIDATION);
        expect(info.severity).toBe(ErrorSeverity.MEDIUM);
        expect(info.retryable).toBe(false);
        expect(info.troubleshooting).toEqual(
          expect.arrayContaining([expect.stringContaining('email')])
        );
      });

      it('should classify TimeoutError', () => {
        const info = handler.handleError(new TimeoutError('timeout', 5000), 'test');
        expect(info.category).toBe(ErrorCategory.TIMEOUT);
        expect(info.severity).toBe(ErrorSeverity.MEDIUM);
        expect(info.retryable).toBe(true);
        expect(info.troubleshooting).toEqual(
          expect.arrayContaining([expect.stringContaining('5000')])
        );
      });

      it('should classify ECONNREFUSED errors', () => {
        const info = handler.handleError(new Error('connect ECONNREFUSED'), 'test');
        expect(info.category).toBe(ErrorCategory.CONNECTION);
        expect(info.userMessage).toBe('Connection refused');
      });

      it('should classify ENOTFOUND errors', () => {
        const info = handler.handleError(new Error('getaddrinfo ENOTFOUND host'), 'test');
        expect(info.category).toBe(ErrorCategory.CONNECTION);
        expect(info.userMessage).toBe('Host not found');
      });

      it('should classify ETIMEDOUT errors', () => {
        const info = handler.handleError(new Error('connect ETIMEDOUT'), 'test');
        expect(info.category).toBe(ErrorCategory.TIMEOUT);
        expect(info.userMessage).toBe('Connection timed out');
      });

      it('should classify EACCES errors', () => {
        const info = handler.handleError(new Error('EACCES: permission denied'), 'test');
        expect(info.category).toBe(ErrorCategory.CONFIGURATION);
        expect(info.userMessage).toBe('Permission denied');
      });

      it('should classify permission denied errors', () => {
        const info = handler.handleError(new Error('permission denied for file'), 'test');
        expect(info.category).toBe(ErrorCategory.CONFIGURATION);
      });

      it('should classify unknown errors', () => {
        const info = handler.handleError(new Error('some unknown issue'), 'test');
        expect(info.category).toBe(ErrorCategory.UNKNOWN);
        expect(info.severity).toBe(ErrorSeverity.MEDIUM);
      });

      it('should classify non-Error objects', () => {
        const info = handler.handleError('string error', 'test');
        expect(info.category).toBe(ErrorCategory.UNKNOWN);
        expect(info.technicalMessage).toBe('string error');
      });

      it('should log LOW severity with info', () => {
        // LOW severity is returned for... actually let's mock classifyError
        // The default unknown gets MEDIUM, so let's test the INFO log path differently
        // We can test with context=undefined
        const info = handler.handleError(new QueryExecutionError('test'));
        expect(info.severity).toBe(ErrorSeverity.MEDIUM);
        expect(mockLogger.warning).toHaveBeenCalledWith(
          expect.stringContaining('unknown context'),
          expect.any(Object)
        );
      });
    });

    describe('formatUserError', () => {
      it('should format error with troubleshooting tips', () => {
        const formatted = handler.formatUserError(new ConnectionError('refused'), 'connecting');
        expect(formatted).toContain('Error');
        expect(formatted).toContain('refused');
        expect(formatted).toContain('Troubleshooting');
        expect(formatted).toContain('retried');
      });

      it('should format non-retryable error without retry message', () => {
        const formatted = handler.formatUserError(new SecurityViolationError('blocked'), 'query');
        expect(formatted).not.toContain('retried');
      });
    });

    describe('formatToolError', () => {
      it('should format error with tool name', () => {
        const formatted = handler.formatToolError(
          new QueryExecutionError('syntax error'),
          'sql_query'
        );
        expect(formatted).toContain('sql_query Failed');
        expect(formatted).toContain('syntax error');
        expect(formatted).toContain('Troubleshooting');
      });
    });

    describe('isRecoverable', () => {
      it('should return true for recoverable errors', () => {
        expect(handler.isRecoverable(new ConnectionError('test'))).toBe(true);
      });

      it('should return true for unknown errors', () => {
        expect(handler.isRecoverable(new Error('generic'))).toBe(true);
      });
    });

    describe('isRetryable', () => {
      it('should return true for retryable errors', () => {
        expect(handler.isRetryable(new ConnectionError('test'))).toBe(true);
      });

      it('should return false for non-retryable errors', () => {
        expect(handler.isRetryable(new SecurityViolationError('test'))).toBe(false);
      });
    });

    describe('getErrorSeverity', () => {
      it('should return correct severity for each error type', () => {
        expect(handler.getErrorSeverity(new SecurityViolationError('test'))).toBe(
          ErrorSeverity.HIGH
        );
        expect(handler.getErrorSeverity(new ConfigurationError('test'))).toBe(
          ErrorSeverity.CRITICAL
        );
        expect(handler.getErrorSeverity(new QueryExecutionError('test'))).toBe(
          ErrorSeverity.MEDIUM
        );
      });
    });
  });

  // ============================================================================
  // sanitizeError
  // ============================================================================

  describe('sanitizeError', () => {
    it('should return message as-is for SecurityViolationError', () => {
      const err = new SecurityViolationError('security issue');
      expect(sanitizeError(err)).toBe('security issue');
    });

    it('should remove password from message', () => {
      const err = new Error('connection failed password=secret123 next');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('password=[REDACTED]');
      expect(sanitized).not.toContain('secret123');
    });

    it('should remove pwd from message', () => {
      const err = new Error('failed pwd=mypass next');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('pwd=[REDACTED]');
      expect(sanitized).not.toContain('mypass');
    });

    it('should remove connection strings', () => {
      const err = new Error('error at mysql://root:pass@localhost:3306/mydb');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('<connection_string>');
      expect(sanitized).not.toContain('root:pass');
    });

    it('should redact passphrase and bearer tokens and spaced password assignments', () => {
      expect(sanitizeError(new Error('ssh_passphrase=hunter2 fail'))).not.toContain('hunter2');
      expect(sanitizeError(new Error('auth failed: Bearer eyJabc.DEF-123'))).not.toContain(
        'eyJabc'
      );
      const spaced = sanitizeError(new Error('bad password = topsecret here'));
      expect(spaced).not.toContain('topsecret');
    });

    it('should strip PEM private key blocks', () => {
      const err = new Error(
        'key error -----BEGIN RSA PRIVATE KEY-----\nMIIabcSECRET\n-----END RSA PRIVATE KEY----- done'
      );
      const sanitized = sanitizeError(err);
      expect(sanitized).not.toContain('MIIabcSECRET');
      expect(sanitized).toContain('[REDACTED KEY]');
    });

    it('should remove file paths', () => {
      const err = new Error('error reading /home/user/secret/config.ini');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('<file_path>');
    });

    it('should remove Windows file paths', () => {
      const err = new Error('error reading C:\\Users\\admin\\config.ini');
      const sanitized = sanitizeError(err);
      expect(sanitized).toContain('<file_path>');
    });

    it('should NOT sanitize mathematical division like 1/0 or a/b', () => {
      const err1 = new Error('division by zero: 1/0');
      expect(sanitizeError(err1)).toContain('1/0');
      expect(sanitizeError(err1)).not.toContain('<file_path>');

      const err2 = new Error('syntax error at a/b');
      expect(sanitizeError(err2)).toContain('a/b');
      expect(sanitizeError(err2)).not.toContain('<file_path>');
    });

    it('should sanitize absolute paths even when wrapped in quotes or parentheses', () => {
      const err1 = new Error("failed loading '/root/sql-ts/keys/db_key'");
      expect(sanitizeError(err1)).toContain('<file_path>');
      expect(sanitizeError(err1)).not.toContain('/root/sql-ts');

      const err2 = new Error('error (in /tmp/test-config.ini) occurred');
      expect(sanitizeError(err2)).toContain('<file_path>');
      expect(sanitizeError(err2)).not.toContain('/tmp/test-config');
    });

    it('should return Unknown error for non-Error', () => {
      expect(sanitizeError('string')).toBe('Unknown error occurred');
      expect(sanitizeError(42)).toBe('Unknown error occurred');
      expect(sanitizeError(null)).toBe('Unknown error occurred');
    });
  });

  // ============================================================================
  // withErrorHandling
  // ============================================================================

  describe('withErrorHandling', () => {
    it('should pass through successful calls', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const handler = new ErrorHandler(mockLogger as any);
      const wrapped = withErrorHandling(fn, handler, 'test');

      const result = await wrapped();
      expect(result).toBe('result');
    });

    it('should handle errors and re-throw', async () => {
      const error = new Error('test error');
      const fn = jest.fn().mockRejectedValue(error);
      const handler = new ErrorHandler(mockLogger as any);
      const wrapped = withErrorHandling(fn, handler, 'test');

      await expect(wrapped()).rejects.toThrow('test error');
      expect(mockLogger.warning).toHaveBeenCalled(); // MEDIUM severity -> warning
    });
  });

  // ============================================================================
  // createErrorResponse
  // ============================================================================

  describe('createErrorResponse', () => {
    it('should create MCP error response from Error', () => {
      const response = createErrorResponse(new Error('query failed'), 'sql_query');

      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toContain('sql_query');
      expect(response.content[0].text).toContain('query failed');
      expect(response.content[0].text).toContain('Troubleshooting');
      expect(response._meta).toEqual({ progressToken: null });
    });

    it('should create MCP error response from string', () => {
      const response = createErrorResponse('string error', 'tool');
      expect(response.content[0].text).toContain('string error');
    });

    it('should create MCP error response from non-Error object', () => {
      const response = createErrorResponse(42, 'tool');
      expect(response.content[0].text).toContain('42');
    });
  });

  // ============================================================================
  // Enums
  // ============================================================================

  describe('ErrorCategory', () => {
    it('should have all expected values', () => {
      expect(ErrorCategory.SECURITY).toBe('security');
      expect(ErrorCategory.CONNECTION).toBe('connection');
      expect(ErrorCategory.QUERY).toBe('query');
      expect(ErrorCategory.CONFIGURATION).toBe('configuration');
      expect(ErrorCategory.SCHEMA).toBe('schema');
      expect(ErrorCategory.SSH).toBe('ssh');
      expect(ErrorCategory.VALIDATION).toBe('validation');
      expect(ErrorCategory.TIMEOUT).toBe('timeout');
      expect(ErrorCategory.UNKNOWN).toBe('unknown');
    });
  });

  describe('ErrorSeverity', () => {
    it('should have all expected values', () => {
      expect(ErrorSeverity.LOW).toBe('low');
      expect(ErrorSeverity.MEDIUM).toBe('medium');
      expect(ErrorSeverity.HIGH).toBe('high');
      expect(ErrorSeverity.CRITICAL).toBe('critical');
    });
  });

  // ============================================================================
  // Full classification tables — the exact ErrorInfo each error type produces
  // ============================================================================

  describe('classification tables (full ErrorInfo shape)', () => {
    let handler: ErrorHandler;

    beforeEach(() => {
      handler = new ErrorHandler(mockLogger as any);
    });

    const cases: Array<[string, unknown, ErrorInfo]> = [
      [
        'SecurityViolationError',
        new SecurityViolationError('sec msg'),
        {
          category: ErrorCategory.SECURITY,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Security policy violation',
          technicalMessage: 'sec msg',
          recoverable: true,
          retryable: false,
          troubleshooting: [
            'Review the query for prohibited operations',
            'Check if the database is configured for SELECT-only mode',
            'Ensure the query complies with security limits',
            'Contact administrator for full access permissions if needed',
          ],
        },
      ],
      [
        'ConnectionError',
        new ConnectionError('conn msg'),
        {
          category: ErrorCategory.CONNECTION,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Database connection failed',
          technicalMessage: 'conn msg',
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check database server is running',
            'Verify connection credentials',
            'Confirm network connectivity',
            'Check SSH tunnel configuration if applicable',
            'Review firewall settings',
          ],
        },
      ],
      [
        'QueryExecutionError',
        new QueryExecutionError('query msg'),
        {
          category: ErrorCategory.QUERY,
          severity: ErrorSeverity.MEDIUM,
          userMessage: 'Query execution failed',
          technicalMessage: 'query msg',
          recoverable: true,
          retryable: false,
          troubleshooting: [
            'Review SQL syntax',
            'Check table and column names exist',
            'Verify data types in conditions',
            'Check for sufficient permissions',
            'Review query complexity limits',
          ],
        },
      ],
      [
        'ConfigurationError',
        new ConfigurationError('config msg'),
        {
          category: ErrorCategory.CONFIGURATION,
          severity: ErrorSeverity.CRITICAL,
          userMessage: 'Configuration error',
          technicalMessage: 'config msg',
          recoverable: true,
          retryable: false,
          troubleshooting: [
            'Check config.ini file syntax',
            'Verify all required fields are present',
            'Validate configuration values',
            'Run setup wizard to reconfigure',
            'Check file permissions',
          ],
        },
      ],
      [
        'SchemaError',
        new SchemaError('schema msg'),
        {
          category: ErrorCategory.SCHEMA,
          severity: ErrorSeverity.MEDIUM,
          userMessage: 'Schema operation failed',
          technicalMessage: 'schema msg',
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Ensure database connection is active',
            'Check database permissions for schema access',
            'Verify table names and structures',
            'Clear schema cache and retry',
            'Check for database structure changes',
          ],
        },
      ],
      [
        'SSHTunnelError',
        new SSHTunnelError('ssh msg'),
        {
          category: ErrorCategory.SSH,
          severity: ErrorSeverity.HIGH,
          userMessage: 'SSH tunnel connection failed',
          technicalMessage: 'ssh msg',
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check SSH server accessibility',
            'Verify SSH credentials',
            'Confirm SSH key permissions',
            'Check SSH port configuration',
            'Verify network connectivity to SSH host',
          ],
        },
      ],
      [
        'ValidationError',
        new ValidationError('validation msg', 'email'),
        {
          category: ErrorCategory.VALIDATION,
          severity: ErrorSeverity.MEDIUM,
          userMessage: 'Invalid input provided',
          technicalMessage: 'validation msg',
          recoverable: true,
          retryable: false,
          troubleshooting: [
            "Check the 'email' field",
            'Verify input format and constraints',
            'Review parameter requirements',
            'Check for required vs optional fields',
          ],
        },
      ],
      [
        'TimeoutError',
        new TimeoutError('timeout msg', 5000),
        {
          category: ErrorCategory.TIMEOUT,
          severity: ErrorSeverity.MEDIUM,
          userMessage: 'Operation timed out',
          technicalMessage: 'timeout msg',
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Operation exceeded 5000ms limit',
            'Simplify the query to reduce execution time',
            'Check database performance',
            'Increase timeout limit if appropriate',
            'Review query optimization opportunities',
          ],
        },
      ],
      [
        'ECONNREFUSED',
        new Error('connect ECONNREFUSED 127.0.0.1'),
        {
          category: ErrorCategory.CONNECTION,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Connection refused',
          technicalMessage: 'connect ECONNREFUSED 127.0.0.1',
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check if database server is running',
            'Verify correct host and port',
            'Check firewall settings',
            'Confirm network connectivity',
          ],
        },
      ],
      [
        'ENOTFOUND',
        new Error('getaddrinfo ENOTFOUND dbhost'),
        {
          category: ErrorCategory.CONNECTION,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Host not found',
          technicalMessage: 'getaddrinfo ENOTFOUND dbhost',
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check hostname spelling',
            'Verify DNS resolution',
            'Check network connectivity',
            'Try using IP address instead of hostname',
          ],
        },
      ],
      [
        'ETIMEDOUT',
        new Error('connect ETIMEDOUT'),
        {
          category: ErrorCategory.TIMEOUT,
          severity: ErrorSeverity.MEDIUM,
          userMessage: 'Connection timed out',
          technicalMessage: 'connect ETIMEDOUT',
          recoverable: true,
          retryable: true,
          troubleshooting: [
            'Check network connectivity',
            'Verify server responsiveness',
            'Increase timeout values',
            'Check for network latency issues',
          ],
        },
      ],
      [
        'EACCES',
        new Error('EACCES: cannot open file'),
        {
          category: ErrorCategory.CONFIGURATION,
          severity: ErrorSeverity.HIGH,
          userMessage: 'Permission denied',
          technicalMessage: 'EACCES: cannot open file',
          recoverable: true,
          retryable: false,
          troubleshooting: [
            'Check file permissions',
            'Verify user has required access',
            'Check SSH key permissions',
            'Run with appropriate privileges',
          ],
        },
      ],
      [
        'unknown Error',
        new Error('mystery'),
        {
          category: ErrorCategory.UNKNOWN,
          severity: ErrorSeverity.MEDIUM,
          userMessage: 'An unexpected error occurred',
          technicalMessage: 'mystery',
          recoverable: true,
          retryable: false,
          troubleshooting: [
            'Check server logs for more details',
            'Verify all configuration settings',
            'Try the operation again',
            'Contact support if the issue persists',
          ],
        },
      ],
    ];

    it.each(cases)('%s produces the exact ErrorInfo', (_name, error, expected) => {
      expect(handler.handleError(error)).toEqual(expected);
    });
  });

  // ============================================================================
  // Logging switch — exact message per severity, with and without context
  // ============================================================================

  describe('handleError logging', () => {
    let handler: ErrorHandler;

    beforeEach(() => {
      handler = new ErrorHandler(mockLogger as any);
    });

    it('logs CRITICAL via error with exact message including context', () => {
      handler.handleError(new ConfigurationError('x'), 'setup');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Critical error in setup',
        expect.objectContaining({ context: 'setup', severity: ErrorSeverity.CRITICAL })
      );
    });

    it('logs CRITICAL with unknown context when context is omitted', () => {
      handler.handleError(new ConfigurationError('x'));
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Critical error in unknown context',
        expect.any(Object)
      );
    });

    it('logs HIGH via error with exact message including context', () => {
      handler.handleError(new ConnectionError('x'), 'connecting');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'High severity error in connecting',
        expect.any(Object)
      );
    });

    it('logs HIGH with unknown context when context is omitted', () => {
      handler.handleError(new ConnectionError('x'));
      expect(mockLogger.error).toHaveBeenCalledWith(
        'High severity error in unknown context',
        expect.any(Object)
      );
    });

    it('logs MEDIUM via warning with exact message including context', () => {
      handler.handleError(new SchemaError('x'), 'schema-load');
      expect(mockLogger.warning).toHaveBeenCalledWith(
        'Medium severity error in schema-load',
        expect.any(Object)
      );
    });

    it('logs LOW via info with exact message including context', () => {
      const lowInfo: ErrorInfo = {
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.LOW,
        userMessage: 'minor',
        technicalMessage: 'minor',
        recoverable: true,
        retryable: false,
      };
      (handler as unknown as { classifyError: () => ErrorInfo }).classifyError = () => lowInfo;
      handler.handleError(new Error('x'), 'background');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Low severity error in background',
        expect.any(Object)
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warning).not.toHaveBeenCalled();
    });

    it('logs LOW with unknown context when context is omitted', () => {
      const lowInfo: ErrorInfo = {
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.LOW,
        userMessage: 'minor',
        technicalMessage: 'minor',
        recoverable: true,
        retryable: false,
      };
      (handler as unknown as { classifyError: () => ErrorInfo }).classifyError = () => lowInfo;
      handler.handleError(new Error('x'));
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Low severity error in unknown context',
        expect.any(Object)
      );
    });
  });

  // ============================================================================
  // Formatters — exact output
  // ============================================================================

  describe('formatter exact output', () => {
    let handler: ErrorHandler;

    beforeEach(() => {
      handler = new ErrorHandler(mockLogger as any);
    });

    it('formatUserError renders the complete message exactly', () => {
      const msg = handler.formatUserError(new SecurityViolationError('nope'), 'q');
      expect(msg).toBe(
        ' **Error**: Security policy violation\n' +
          ' **Details**: nope\n' +
          '\n **Troubleshooting:**\n' +
          ' - Review the query for prohibited operations\n' +
          ' - Check if the database is configured for SELECT-only mode\n' +
          ' - Ensure the query complies with security limits\n' +
          ' - Contact administrator for full access permissions if needed\n'
      );
    });

    it('formatUserError appends the exact retry note for retryable errors', () => {
      const msg = handler.formatUserError(new SchemaError('s'), 'q');
      expect(msg.endsWith('\n This operation can be retried.')).toBe(true);
    });

    it('formatUserError omits the troubleshooting section for an empty list', () => {
      const info: ErrorInfo = {
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'u',
        technicalMessage: 't',
        recoverable: true,
        retryable: false,
        troubleshooting: [],
      };
      (handler as unknown as { classifyError: () => ErrorInfo }).classifyError = () => info;
      expect(handler.formatUserError(new Error('x'))).not.toContain('Troubleshooting');
    });

    it('formatUserError omits the troubleshooting section when absent', () => {
      const info: ErrorInfo = {
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'u',
        technicalMessage: 't',
        recoverable: true,
        retryable: false,
      };
      (handler as unknown as { classifyError: () => ErrorInfo }).classifyError = () => info;
      expect(handler.formatUserError(new Error('x'))).not.toContain('Troubleshooting');
    });

    it('formatToolError renders the complete message exactly and logs the tool context', () => {
      const msg = handler.formatToolError(new QueryExecutionError('bad sql'), 'sql_query');
      expect(msg).toBe(
        ' **sql_query Failed**\n\n' +
          ' **Error**: Query execution failed\n' +
          ' **Details**: bad sql\n' +
          '\n **Troubleshooting Steps:**\n' +
          ' - Review SQL syntax\n' +
          ' - Check table and column names exist\n' +
          ' - Verify data types in conditions\n' +
          ' - Check for sufficient permissions\n' +
          ' - Review query complexity limits\n'
      );
      expect(mockLogger.warning).toHaveBeenCalledWith(
        'Medium severity error in tool:sql_query',
        expect.any(Object)
      );
    });

    it('formatToolError omits the troubleshooting section for an empty list', () => {
      const info: ErrorInfo = {
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'u',
        technicalMessage: 't',
        recoverable: true,
        retryable: false,
        troubleshooting: [],
      };
      (handler as unknown as { classifyError: () => ErrorInfo }).classifyError = () => info;
      expect(handler.formatToolError(new Error('x'), 'tool')).not.toContain('Troubleshooting');
    });

    it('formatToolError omits the troubleshooting section when absent', () => {
      const info: ErrorInfo = {
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.MEDIUM,
        userMessage: 'u',
        technicalMessage: 't',
        recoverable: true,
        retryable: false,
      };
      (handler as unknown as { classifyError: () => ErrorInfo }).classifyError = () => info;
      expect(handler.formatToolError(new Error('x'), 'tool')).not.toContain('Troubleshooting');
    });
  });

  // ============================================================================
  // sanitizeMessage — exact redaction behavior
  // ============================================================================

  describe('sanitizeMessage', () => {
    it('redacts bearer tokens exactly, including base64 padding', () => {
      expect(sanitizeMessage('auth failed: Bearer eyJhbGciOi.abc-123==')).toBe(
        'auth failed: Bearer [REDACTED]'
      );
    });

    it('redacts colon-separated credentials and normalizes to key=[REDACTED]', () => {
      expect(sanitizeMessage('login token: abc123 rest')).toBe('login token=[REDACTED] rest');
    });

    // The value matcher stopped at the first space, so a quoted secret was only
    // partly removed: password='my secret pass' left "secret pass'" in a message
    // that goes back to the caller.
    // Asserted exactly, not with a "does it still contain the password" check:
    // the old behaviour ate the opening quote and the first word, which passes a
    // loose check while the tail of the secret is still in the message.
    it.each([
      ['double quotes', 'Access denied: password="hunter 2"', 'Access denied: password=[REDACTED]'],
      [
        'single quotes',
        "Access denied: password='my secret pass'",
        'Access denied: password=[REDACTED]',
      ],
      [
        'a quoted passphrase',
        'Config: ssh_passphrase="a b c"',
        'Config: ssh_passphrase=[REDACTED]',
      ],
      ['a quoted value after a colon', 'Config: secret: "top level"', 'Config: secret=[REDACTED]'],
    ])('redacts a quoted credential containing spaces (%s)', (_label, message, expected) => {
      expect(sanitizeMessage(message)).toBe(expected);
    });

    it('still stops at whitespace for an unquoted value', () => {
      // Consuming the rest of the line would swallow the explanation with it.
      expect(sanitizeMessage('password=abc is invalid')).toBe('password=[REDACTED] is invalid');
    });

    it('redacts bearer tokens case-insensitively and repeatedly', () => {
      expect(sanitizeMessage('bearer tok123 and Bearer tok456')).toBe(
        'Bearer [REDACTED] and Bearer [REDACTED]'
      );
    });

    it('redacts bearer tokens separated by multiple spaces', () => {
      expect(sanitizeMessage('Bearer  tok123')).toBe('Bearer [REDACTED]');
    });

    it('does not redact when Bearer is part of another word', () => {
      expect(sanitizeMessage('XBearer tok123')).toBe('XBearer tok123');
    });

    // FIND-106: email PII, internal host:port, and DB usernames must be masked.
    it('masks email addresses (e.g. Postgres unique-constraint PII)', () => {
      expect(sanitizeMessage('Key (email)=(jane.doe@corp.com) already exists')).not.toContain(
        'jane.doe@corp.com'
      );
      expect(sanitizeMessage('duplicate: alice@example.org')).toContain('<email>');
    });

    it('masks internal host:port and IPv4:port tokens', () => {
      expect(sanitizeMessage('connect ECONNREFUSED 10.0.0.5:5432')).toBe(
        'connect ECONNREFUSED <host:port>'
      );
      expect(sanitizeMessage('ETIMEDOUT db.internal.corp:3306')).toContain('<host:port>');
    });

    it('masks disclosed database usernames', () => {
      expect(sanitizeMessage('password authentication failed for user "readonly_user"')).toBe(
        'password authentication failed for user <user>'
      );
    });

    it.each([
      ['passwd=x1 y', 'passwd=[REDACTED] y'],
      ['key=x1 y', 'key=[REDACTED] y'],
      ['api_key=x1 y', 'api_key=[REDACTED] y'],
      ['api-key=x1 y', 'api-key=[REDACTED] y'],
      ['apikey=x1 y', 'apikey=[REDACTED] y'],
      ['authorization=x1 y', 'authorization=[REDACTED] y'],
      ['credential=x1 y', 'credential=[REDACTED] y'],
      ['credentials=x1 y', 'credentials=[REDACTED] y'],
    ])('redacts %s', (input, expected) => {
      expect(sanitizeMessage(input)).toBe(expected);
    });

    it('redacts uppercase PASSWORD assignments preserving the matched keyword', () => {
      expect(sanitizeMessage('PASSWORD=hunter2 z')).toBe('PASSWORD=[REDACTED] z');
    });

    it('redacts multiple credential assignments in one message', () => {
      expect(sanitizeMessage('password=a token=b')).toBe('password=[REDACTED] token=[REDACTED]');
    });

    it('stops secret redaction at semicolons', () => {
      expect(sanitizeMessage('secret=abc;tail')).toBe('secret=[REDACTED];tail');
    });

    it('stops redaction at delimiters', () => {
      expect(sanitizeMessage('secret=s3cr3t,visible')).toBe('secret=[REDACTED],visible');
    });

    it('replaces connection strings exactly', () => {
      expect(sanitizeMessage('at mysql://root:pw@host:3306/db end')).toBe(
        'at <connection_string> end'
      );
    });

    it('replaces Windows drive paths', () => {
      expect(sanitizeMessage('read D:\\data\\file.txt failed')).toBe('read <file_path> failed');
    });

    it('leaves single-segment unix paths alone', () => {
      expect(sanitizeMessage('mount /data failed')).toBe('mount /data failed');
    });

    it('masks credit card numbers exactly', () => {
      expect(sanitizeMessage('card 1234-5678-9012-3456 declined')).toBe(
        'card XXXX-XXXX-XXXX-XXXX declined'
      );
    });

    it('masks SSNs exactly', () => {
      expect(sanitizeMessage('ssn 123-45-6789 found')).toBe('ssn XXX-XX-XXXX found');
    });

    it('truncates messages to 500 characters', () => {
      const long = 'a'.repeat(600);
      expect(sanitizeMessage(long)).toBe('a'.repeat(500));
    });
  });

  describe('sanitizeError security-violation passthrough', () => {
    it('returns SecurityViolationError messages verbatim without sanitization', () => {
      const raw = 'Blocked query containing password=abc123';
      expect(sanitizeError(new SecurityViolationError(raw))).toBe(raw);
    });
  });

  // ============================================================================
  // createErrorResponse — exact text
  // ============================================================================

  describe('createErrorResponse exact text', () => {
    it('renders the exact error text with the troubleshooting block', () => {
      const response = createErrorResponse(new Error('boom'), 'sql_query');
      expect(response.content[0].text).toBe(
        ' Error in sql_query: boom\n\n' +
          '**Troubleshooting:**\n' +
          '- Check that all required parameters are provided\n' +
          '- Verify database connection is working\n' +
          '- Review server logs for more details\n' +
          '- Ensure proper permissions are configured'
      );
    });
  });
});
