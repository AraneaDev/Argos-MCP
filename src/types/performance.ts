/**
 * Performance analysis types for Argos-MCP
 */

// ============================================================================
// Performance Analysis Result Types
// ============================================================================

export interface PerformanceAnalysisResult {
  executionTime: number;
  explainTime: number;
  rowCount: number;
  columnCount: number;
  executionPlan: string;
  recommendations: string;
  metadata?: {
    database_type: string;
    query_hash: string;
    analyzed_at: string;
    plan_format: string;
  };
}

// ============================================================================
// Query Metrics Types
// ============================================================================

export interface QueryMetrics {
  executionTime: number;
  rowsExamined: number;
  rowsReturned: number;
  indexesUsed: string[];
  cost?: number;
  bufferHits?: number;
  diskReads?: number;
}

export interface DetailedQueryMetrics extends QueryMetrics {
  planningTime?: number;
  executionStages: ExecutionStage[];
  resourceUsage: ResourceUsage;
  warnings: string[];
}

// ============================================================================
// Execution Plan Types
// ============================================================================

export interface ExecutionStage {
  operation: string;
  cost: number;
  rows: number;
  width: number;
  time?: number;
  loops?: number;
  indexName?: string;
  condition?: string;
  children?: ExecutionStage[];
}

export interface ExecutionPlan {
  format: 'JSON' | 'TEXT' | 'XML';
  raw: string;
  parsed?: ExecutionStage[];
  totalCost: number;
  estimatedRows: number;
  actualRows?: number;
}

// ============================================================================
// Resource Usage Types
// ============================================================================

export interface ResourceUsage {
  cpuTime: number;
  memoryUsage: number;
  diskIO: number;
  networkIO?: number;
  locks?: LockInfo[];
}

export interface LockInfo {
  lockType: string;
  resource: string;
  duration: number;
  blocking: boolean;
}

// ============================================================================
// Performance Recommendations Types
// ============================================================================

export interface PerformanceRecommendation {
  type: RecommendationType;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  suggestion: string;
  estimatedImpact?: string;
  implementationEffort?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export type RecommendationType =
  | 'INDEX_SUGGESTION'
  | 'QUERY_REWRITE'
  | 'LIMIT_CLAUSE'
  | 'JOIN_OPTIMIZATION'
  | 'SUBQUERY_OPTIMIZATION'
  | 'PARTITIONING'
  | 'STATISTICS_UPDATE'
  | 'CONFIGURATION_CHANGE';

// ============================================================================
// Database-Specific Performance Types
// ============================================================================

export interface PostgreSQLPerformanceData {
  bufferHits: number;
  bufferReads: number;
  sharedBlksHit: number;
  sharedBlksRead: number;
  sharedBlksDirtied: number;
  sharedBlksWritten: number;
  localBlksHit: number;
  localBlksRead: number;
  tempBlksRead: number;
  tempBlksWritten: number;
  jitFunctions?: number;
  jitGenerationTime?: number;
  jitInliningTime?: number;
  jitOptimizationTime?: number;
  jitEmissionTime?: number;
}

export interface MySQLPerformanceData {
  selectType: string;
  table: string;
  partitions?: string[];
  type: string;
  possibleKeys?: string[];
  key?: string;
  keyLen?: number;
  ref?: string;
  rows: number;
  filtered?: number;
  extra: string;
}

export interface SQLitePerformanceData {
  operationType: string;
  tableUsed: string;
  indexUsed?: string;
  detail: string;
  estimatedRows: number;
}

// ============================================================================
// Performance Analysis Options
// ============================================================================

export interface PerformanceAnalysisOptions {
  includeExecutionPlan: boolean;
  includeBufferStats: boolean;
  includeTimingStats: boolean;
  includeRecommendations: boolean;
  detailedMetrics: boolean;
  explainFormat?: 'JSON' | 'TEXT' | 'XML';
}

// ============================================================================
// Performance Threshold Types
// ============================================================================

export interface PerformanceThresholds {
  slowQueryThreshold: number; // milliseconds
  largeResultSetThreshold: number; // row count
  highCpuThreshold: number; // percentage
  highMemoryThreshold: number; // MB
  longRunningThreshold: number; // seconds
}

// ============================================================================
// Performance History Types
// ============================================================================

export interface PerformanceHistoryEntry {
  timestamp: string;
  queryHash: string;
  database: string;
  metrics: QueryMetrics;
  duration: number;
  rowsAffected: number;
}

export interface PerformanceHistorySummary {
  queryHash: string;
  executionCount: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  totalTime: number;
  lastExecuted: string;
  trend: 'IMPROVING' | 'STABLE' | 'DEGRADING';
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 *
 */
export function isPerformanceAnalysisResult(value: unknown): value is PerformanceAnalysisResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'executionTime' in value &&
    'explainTime' in value &&
    'rowCount' in value &&
    'columnCount' in value &&
    'executionPlan' in value &&
    'recommendations' in value &&
    typeof (value as PerformanceAnalysisResult).executionTime === 'number' &&
    typeof (value as PerformanceAnalysisResult).explainTime === 'number' &&
    typeof (value as PerformanceAnalysisResult).rowCount === 'number' &&
    typeof (value as PerformanceAnalysisResult).columnCount === 'number' &&
    typeof (value as PerformanceAnalysisResult).executionPlan === 'string' &&
    typeof (value as PerformanceAnalysisResult).recommendations === 'string'
  );
}

/**
 *
 */
export function isRecommendationType(value: string): value is RecommendationType {
  return [
    'INDEX_SUGGESTION',
    'QUERY_REWRITE',
    'LIMIT_CLAUSE',
    'JOIN_OPTIMIZATION',
    'SUBQUERY_OPTIMIZATION',
    'PARTITIONING',
    'STATISTICS_UPDATE',
    'CONFIGURATION_CHANGE',
  ].includes(value);
}

/**
 *
 */
export function isPerformancePriority(
  value: string
): value is 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 *
 */
export function generateBasicRecommendations(
  metrics: QueryMetrics,
  thresholds: PerformanceThresholds
): PerformanceRecommendation[] {
  const recommendations: PerformanceRecommendation[] = [];

  if (metrics.executionTime > thresholds.slowQueryThreshold) {
    recommendations.push({
      type: 'QUERY_REWRITE',
      priority: 'HIGH',
      description: 'Slow query detected',
      suggestion: 'Review query structure, consider adding indexes, or optimize JOIN conditions',
    });
  }

  if (metrics.rowsReturned > thresholds.largeResultSetThreshold) {
    recommendations.push({
      type: 'LIMIT_CLAUSE',
      priority: 'MEDIUM',
      description: 'Large result set detected',
      suggestion: 'Consider adding LIMIT clause or pagination to reduce data transfer',
    });
  }

  if (metrics.indexesUsed.length === 0 && metrics.rowsExamined > 100) {
    recommendations.push({
      type: 'INDEX_SUGGESTION',
      priority: 'HIGH',
      description: 'No indexes used in query',
      suggestion:
        'Consider adding appropriate indexes for the columns used in WHERE, JOIN, and ORDER BY clauses',
    });
  }

  return recommendations;
}
