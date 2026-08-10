/**
 * Security-related types and interfaces
 */

// ============================================================================
// Security Validation Types
// ============================================================================

export interface SecurityValidation {
  allowed: boolean;
  reason?: string;
  confidence: number;
  blockedCommand?: string;
}

export interface BatchValidationResult {
  allowed: boolean;
  queries: QueryValidationResult[];
  batch_analysis: BatchSecurityAnalysis;
  total_complexity: number;
  summary: {
    total_queries: number;
    allowed_queries: number;
    blocked_queries: number;
    high_complexity_queries: number;
  };
}

export interface QueryValidationResult {
  index: number;
  label: string;
  query: string;
  allowed: boolean;
  reason?: string;
  complexity: QueryComplexityAnalysis;
  blockedCommand?: string;
}

export interface BatchSecurityAnalysis {
  allowed: boolean;
  warnings: string[];
  total_complexity: number;
  query_count: number;
  table_references: {
    tables: string[];
    conflicts: string[];
    access_map: Record<string, string[]>;
  };
  estimated_resource_usage: {
    cpu_intensity: number;
    memory_usage: number;
    io_operations: number;
    overall_impact: number;
  };
}

// ============================================================================
// Query Complexity Analysis Types
// ============================================================================

export type ComplexityRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface QueryComplexityAnalysis {
  score: number;
  factors: string[];
  joinCount: number;
  subqueryCount: number;
  unionCount: number;
  groupByCount: number;
  windowFuncCount: number;
  risk_level: ComplexityRiskLevel;
}

export interface ComplexityLimits {
  maxJoins: number;
  maxSubqueries: number;
  maxUnions: number;
  maxGroupBys: number;
  maxComplexityScore: number;
  maxQueryLength: number;
}

// ============================================================================
// SQL Token Types
// ============================================================================

export type TokenType = 'KEYWORD' | 'IDENTIFIER' | 'STRING' | 'OPERATOR' | 'UNKNOWN';

export interface SQLToken {
  value: string;
  type: TokenType;
  position: number;
  normalized: string;
}

// ============================================================================
// Audit Log Types
// ============================================================================

export type LogSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface AuditLogEntry {
  timestamp: string;
  database: string;
  query_type: 'SINGLE' | 'BATCH';
  query: string;
  query_count: number;
  queryHash: string;
  allowed: boolean;
  reason?: string;
  metadata: Record<string, unknown>;
  sourceIP: string;
  severity: LogSeverity;
}

// ============================================================================
// Security Configuration Types
// ============================================================================

export interface SecurityConfig {
  max_joins?: number | string;
  max_subqueries?: number | string;
  max_unions?: number | string;
  max_group_bys?: number | string;
  max_complexity_score?: number | string;
  max_query_length?: number | string;
}

export interface SecurityManagerConfig {
  security?: SecurityConfig;
}

// ============================================================================
// Dangerous Pattern Detection Types
// ============================================================================

// ============================================================================
// Security Manager Interface
// ============================================================================

export interface ISecurityManager {
  validateSelectOnlyQuery(_query: string, _dbType?: string): SecurityValidation;
  validateBatchSelectOnlyQueries(
    _queries: Array<{ query: string; params?: unknown[]; label?: string }>,
    _dbType?: string
  ): BatchValidationResult;
  analyzeQueryComplexity(_query: string): QueryComplexityAnalysis;
  createAuditLog(
    _database: string,
    _query: string | string[],
    _allowed: boolean,
    _reason?: string,
    _metadata?: Record<string, unknown>
  ): AuditLogEntry;
  sanitizeErrorMessage(_errorMessage: string): string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 *
 */
export function isComplexityRiskLevel(value: string): value is ComplexityRiskLevel {
  return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value);
}

/**
 *
 */
export function isTokenType(value: string): value is TokenType {
  return ['KEYWORD', 'IDENTIFIER', 'STRING', 'OPERATOR', 'UNKNOWN'].includes(value);
}

/**
 *
 */
export function isLogSeverity(value: string): value is LogSeverity {
  return ['INFO', 'WARNING', 'ERROR', 'CRITICAL'].includes(value);
}
