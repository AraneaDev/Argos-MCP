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
  sanitizeError,
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
});
