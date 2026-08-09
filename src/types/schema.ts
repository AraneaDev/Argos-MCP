/**
 * Enhanced schema types for Argos-MCP
 */

import type { ColumnInfo, TableInfo } from './database.js';

// ============================================================================
// Enhanced Schema Types
// ============================================================================

export interface EnhancedTableInfo extends TableInfo {
  relationships?: {
    foreignKeys: BasicForeignKeyInfo[];
    referencedBy: string[];
  };
  indexes?: BasicIndexInfo[];
  constraints?: ConstraintInfo[];
  statistics?: TableStatistics;
  dependencies?: string[];
}

export interface EnhancedColumnInfo extends ColumnInfo {
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isIndexed: boolean;
  isUnique: boolean;
  referencedTable?: string;
  referencedColumn?: string;
  checkConstraint?: string;
  statistics?: ColumnStatistics;
}

// ============================================================================
// Foreign Key Types
// ============================================================================

export interface BasicForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName?: string;
  onUpdate?: ForeignKeyAction;
  onDelete?: ForeignKeyAction;
}

export interface DetailedForeignKeyInfo extends BasicForeignKeyInfo {
  isDeferred: boolean;
  isDeferrable: boolean;
  matchType?: 'FULL' | 'PARTIAL' | 'SIMPLE';
  createdAt?: string;
  lastModified?: string;
}

export type ForeignKeyAction = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

// ============================================================================
// Index Types
// ============================================================================

export interface BasicIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  type?: IndexType;
}

export interface DetailedIndexInfo extends BasicIndexInfo {
  isPrimaryKey: boolean;
  isClusteredIndex: boolean;
  cardinality: number;
  pages?: number;
  filterCondition?: string;
  includedColumns?: string[];
  statistics?: IndexStatistics;
  createdAt?: string;
  lastUsed?: string;
  usageCount?: number;
}

export type IndexType =
  | 'BTREE'
  | 'HASH'
  | 'BITMAP'
  | 'GIN'
  | 'GIST'
  | 'SPGIST'
  | 'BRIN'
  | 'FULLTEXT'
  | 'SPATIAL';

// ============================================================================
// Constraint Types
// ============================================================================

export interface ConstraintInfo {
  name: string;
  type: ConstraintType;
  columns: string[];
  definition: string;
  isEnabled: boolean;
  isDeferrable?: boolean;
  isDeferred?: boolean;
}

export type ConstraintType =
  | 'PRIMARY KEY'
  | 'FOREIGN KEY'
  | 'UNIQUE'
  | 'CHECK'
  | 'NOT NULL'
  | 'DEFAULT'
  | 'EXCLUDE';

// ============================================================================
// Statistics Types
// ============================================================================

export interface TableStatistics {
  rowCount: number;
  avgRowLength: number;
  dataLength: number;
  indexLength: number;
  autoIncrement?: number;
  checkTime?: string;
  createTime?: string;
  updateTime?: string;
  collation?: string;
}

export interface ColumnStatistics {
  nullCount: number;
  distinctCount: number;
  minValue?: unknown;
  maxValue?: unknown;
  avgLength?: number;
  histogram?: HistogramBucket[];
  lastAnalyzed?: string;
}

export interface IndexStatistics {
  cardinality: number;
  leafPages: number;
  density: number;
  avgKeyLength: number;
  maxKeyLength: number;
  nullCount: number;
  uniqueCount: number;
}

export interface HistogramBucket {
  rangeStart: unknown;
  rangeEnd: unknown;
  frequency: number;
  distinctCount: number;
}

// ============================================================================
// View Types
// ============================================================================

export interface EnhancedViewInfo extends TableInfo {
  definition: string;
  isUpdatable: boolean;
  checkOption?: 'CASCADED' | 'LOCAL' | 'NONE';
  dependencies: string[];
  dependents: string[];
  security?: ViewSecurity;
}

export interface ViewSecurity {
  definer: string;
  invoker?: string;
  sqlSecurity: 'DEFINER' | 'INVOKER';
}

// ============================================================================
// Schema Relationship Types
// ============================================================================

export interface SchemaRelationships {
  tables: Record<string, TableRelationship>;
  views: Record<string, ViewRelationship>;
  circularReferences: CircularReference[];
  orphanedTables: string[];
  referenceCounts: Record<string, number>;
}

export interface TableRelationship {
  tableName: string;
  referencedBy: string[];
  references: string[];
  level: number; // depth in dependency tree
  isCircular: boolean;
}

export interface ViewRelationship {
  viewName: string;
  dependsOn: string[];
  usedBy: string[];
  level: number;
}

export interface CircularReference {
  cycle: string[];
  constraintNames: string[];
  severity: 'WARNING' | 'ERROR';
}

// ============================================================================
// Schema Analysis Types
// ============================================================================

export interface SchemaAnalysis {
  overview: SchemaOverview;
  relationships: SchemaRelationships;
  issues: SchemaIssue[];
  recommendations: SchemaRecommendation[];
  complexity: SchemaComplexity;
}

export interface SchemaOverview {
  tableCount: number;
  viewCount: number;
  procedureCount: number;
  functionCount: number;
  triggerCount: number;
  sequenceCount: number;
  totalColumns: number;
  totalIndexes: number;
  totalConstraints: number;
  totalSize?: number;
  lastUpdated: string;
}

export interface SchemaIssue {
  type: SchemaIssueType;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  table?: string;
  column?: string;
  constraint?: string;
  index?: string;
  description: string;
  suggestion?: string;
}

export type SchemaIssueType =
  | 'MISSING_INDEX'
  | 'UNUSED_INDEX'
  | 'DUPLICATE_INDEX'
  | 'MISSING_FOREIGN_KEY'
  | 'ORPHANED_RECORD'
  | 'CIRCULAR_REFERENCE'
  | 'NAMING_CONVENTION'
  | 'DATA_TYPE_INCONSISTENCY'
  | 'NULL_DESIGN'
  | 'PERFORMANCE_CONCERN';

export interface SchemaRecommendation {
  type: 'INDEX' | 'CONSTRAINT' | 'REFACTOR' | 'OPTIMIZATION';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  implementation: string;
  estimatedBenefit: string;
  affectedTables: string[];
}

export interface SchemaComplexity {
  score: number;
  factors: ComplexityFactor[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ComplexityFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
  description: string;
}

// ============================================================================
// Database-Specific Schema Types
// ============================================================================

export interface PostgreSQLSchemaExtensions {
  schemas: string[];
  extensions: ExtensionInfo[];
  enums: EnumTypeInfo[];
  domains: DomainTypeInfo[];
  aggregates: AggregateInfo[];
}

export interface ExtensionInfo {
  name: string;
  version: string;
  schema: string;
  description?: string;
  relocatable: boolean;
}

export interface EnumTypeInfo {
  name: string;
  schema: string;
  values: string[];
  owner: string;
}

export interface DomainTypeInfo {
  name: string;
  schema: string;
  baseType: string;
  notNull: boolean;
  default?: string;
  checkConstraint?: string;
}

export interface AggregateInfo {
  name: string;
  schema: string;
  inputTypes: string[];
  returnType: string;
  finalFunction?: string;
  stateFunction: string;
}

// ============================================================================
// Migration and Change Tracking Types
// ============================================================================

export interface SchemaChangeTracking {
  version: string;
  appliedAt: string;
  changes: SchemaChange[];
  rollbackScript?: string;
}

export interface SchemaChange {
  type: 'CREATE' | 'ALTER' | 'DROP' | 'RENAME';
  objectType: 'TABLE' | 'VIEW' | 'INDEX' | 'CONSTRAINT' | 'COLUMN';
  objectName: string;
  before?: string;
  after?: string;
  sql: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 *
 */
export function isEnhancedTableInfo(value: unknown): value is EnhancedTableInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'type' in value &&
    'columns' in value &&
    typeof (value as EnhancedTableInfo).name === 'string' &&
    typeof (value as EnhancedTableInfo).type === 'string' &&
    Array.isArray((value as EnhancedTableInfo).columns)
  );
}

/**
 *
 */
export function isForeignKeyInfo(value: unknown): value is BasicForeignKeyInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'column' in value &&
    'referencedTable' in value &&
    'referencedColumn' in value &&
    typeof (value as BasicForeignKeyInfo).column === 'string' &&
    typeof (value as BasicForeignKeyInfo).referencedTable === 'string' &&
    typeof (value as BasicForeignKeyInfo).referencedColumn === 'string'
  );
}

/**
 *
 */
export function isIndexInfo(value: unknown): value is BasicIndexInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'columns' in value &&
    'unique' in value &&
    typeof (value as BasicIndexInfo).name === 'string' &&
    Array.isArray((value as BasicIndexInfo).columns) &&
    typeof (value as BasicIndexInfo).unique === 'boolean'
  );
}

/**
 *
 */
export function isConstraintType(value: string): value is ConstraintType {
  return [
    'PRIMARY KEY',
    'FOREIGN KEY',
    'UNIQUE',
    'CHECK',
    'NOT NULL',
    'DEFAULT',
    'EXCLUDE',
  ].includes(value);
}

/**
 *
 */
export function isIndexType(value: string): value is IndexType {
  return [
    'BTREE',
    'HASH',
    'BITMAP',
    'GIN',
    'GIST',
    'SPGIST',
    'BRIN',
    'FULLTEXT',
    'SPATIAL',
  ].includes(value);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 *
 */
export function calculateTableComplexity(table: EnhancedTableInfo): number {
  let complexity = 0;

  // Base complexity from column count
  complexity += table.columns.length * 2;

  // Foreign key complexity
  if (table.relationships?.foreignKeys) {
    complexity += table.relationships.foreignKeys.length * 10;
  }

  // Index complexity
  if (table.indexes) {
    complexity += table.indexes.length * 5;
  }

  // Constraint complexity
  if (table.constraints) {
    complexity += table.constraints.length * 3;
  }

  return complexity;
}

/**
 *
 */
export function findMissingIndexes(table: EnhancedTableInfo): SchemaRecommendation[] {
  const recommendations: SchemaRecommendation[] = [];

  // Check for foreign keys without indexes
  if (table.relationships?.foreignKeys) {
    for (const fk of table.relationships.foreignKeys) {
      const hasIndex = table.indexes?.some((idx) => idx.columns.includes(fk.column));

      if (!hasIndex) {
        recommendations.push({
          type: 'INDEX',
          priority: 'MEDIUM',
          description: `Missing index on foreign key column ${fk.column}`,
          implementation: `CREATE INDEX idx_${table.name}_${fk.column} ON ${table.name}(${fk.column})`,
          estimatedBenefit: 'Improved JOIN performance',
          affectedTables: [table.name],
        });
      }
    }
  }

  return recommendations;
}
