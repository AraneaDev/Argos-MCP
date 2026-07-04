/**
 * RedactionManager - Handles field redaction for sensitive data protection
 */

import type {
  DatabaseRedactionConfig,
  FieldRedactionRule,
  QueryResult,
  QueryResultWithRedaction,
  RedactionResult,
  RedactionAuditEntry,
} from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error-handler.js';

// ============================================================================
// Redaction Pattern Implementations
// ============================================================================

/**
 *
 */
export class RedactionPatterns {
  /**
   * Full masking - replace entire value with mask characters
   */
  static fullMask(value: string, maskChar = '*'): string {
    if (typeof value !== 'string') return String(value);
    return maskChar.repeat(Math.min(value.length, 10));
  }

  /**
   * Partial masking for emails - preserve structure but mask content
   */
  static partialMaskEmail(email: string, maskChar = '*'): string {
    if (typeof email !== 'string' || !email.includes('@')) {
      return this.fullMask(email, maskChar);
    }

    const [localPart, domain] = email.split('@');
    if (!domain || !localPart) return this.fullMask(email, maskChar);

    // Mask local part
    let maskedLocal = localPart;
    if (localPart.length > 2) {
      if (localPart.includes('.')) {
        // For email like john.doe, produce j******.e (first char + asterisks + dot + last char)
        const firstChar = localPart.charAt(0);
        const lastChar = localPart.charAt(localPart.length - 1);
        const middleLength = localPart.length - 2; // Exclude first and last char

        maskedLocal = firstChar + maskChar.repeat(middleLength) + '.' + lastChar;
      } else {
        // For email without dots, use standard first/last preservation
        maskedLocal =
          localPart.charAt(0) +
          maskChar.repeat(Math.max(0, localPart.length - 2)) +
          localPart.charAt(localPart.length - 1);
      }
    } else if (localPart.length === 2) {
      maskedLocal = localPart.charAt(0) + maskChar;
    } else if (localPart.length === 1) {
      // Preserve single character
      maskedLocal = localPart;
    } else {
      maskedLocal = maskChar;
    }

    // Mask domain name but preserve TLD
    const domainParts = domain.split('.');
    if (domainParts.length >= 2) {
      const domainName = domainParts[0];
      const tld = domainParts.slice(1).join('.');
      const maskedDomain = maskChar.repeat(Math.min(domainName.length, 5)) + '.' + tld;
      return maskedLocal + '@' + maskedDomain;
    }

    return maskedLocal + '@' + maskChar.repeat(Math.min(domain.length, 5));
  }

  /**
   * Partial masking for phone numbers
   */
  static partialMaskPhone(phone: string, maskChar = '*'): string {
    if (typeof phone !== 'string') return String(phone);

    // Remove all non-digit characters for analysis
    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.length >= 10) {
      // For US phone numbers (10+ digits), preserve last 4 digits
      // Also mask spaces that appear between masked digits
      let result = phone.replace(/\d(?=.*\d{4})/g, maskChar);

      // Special handling: if we have ") " pattern after masking, remove the space
      result = result.replace(/\)\s+/g, ')');

      return result;
    } else if (cleaned.length >= 7) {
      // For 7-9 digit numbers, preserve last 4 digits
      return phone.replace(/\d(?=.*\d{4})/g, maskChar);
    } else if (cleaned.length >= 3) {
      // For very short numbers, use full mask
      return this.fullMask(phone, maskChar);
    }

    return this.fullMask(phone, maskChar);
  }

  /**
   * Partial masking for generic strings - preserve first and last characters
   */
  static partialMaskGeneric(value: string, maskChar = '*'): string {
    if (typeof value !== 'string') return String(value);

    if (value.length <= 2) {
      return maskChar.repeat(value.length);
    } else if (value.length <= 4) {
      return value.charAt(0) + maskChar.repeat(value.length - 1);
    } else {
      return (
        value.charAt(0) +
        maskChar.repeat(Math.min(value.length - 2, 8)) +
        value.charAt(value.length - 1)
      );
    }
  }

  /**
   * Custom pattern replacement using regex
   */
  static customPattern(value: string, pattern: string, replacement = '[REDACTED]'): string {
    if (typeof value !== 'string') return String(value);

    try {
      return value.replace(new RegExp(pattern, 'gi'), replacement);
    } catch {
      // If regex is invalid, fall back to full masking
      return this.fullMask(value);
    }
  }

  /**
   * Smart partial masking that detects content type
   */
  static smartPartialMask(value: string, maskChar = '*'): string {
    if (typeof value !== 'string') return String(value);

    // Detect email pattern
    if (value.includes('@') && value.includes('.')) {
      return this.partialMaskEmail(value, maskChar);
    }

    // Detect phone number pattern (has many digits)
    const digitCount = (value.match(/\d/g) || []).length;
    if (digitCount >= 7 && digitCount / value.length > 0.6) {
      return this.partialMaskPhone(value, maskChar);
    }

    // Default to generic partial masking
    return this.partialMaskGeneric(value, maskChar);
  }
}

// ============================================================================
// RedactionManager Implementation
// ============================================================================

/**
 *
 */
export class RedactionManager {
  private rules: Map<string, FieldRedactionRule>;
  private defaultRedaction?: DatabaseRedactionConfig['default_redaction'];
  private logAccess: boolean;
  private auditQueries: boolean;
  private caseSensitive: boolean;
  private readonly logger = getLogger();

  constructor(config: DatabaseRedactionConfig) {
    this.rules = new Map();
    this.logAccess = config.log_redacted_access ?? false;
    this.auditQueries = config.audit_redacted_queries ?? false;
    this.caseSensitive = config.case_sensitive_matching ?? false;
    this.defaultRedaction = config.default_redaction;

    // Build rules map for efficient lookups
    for (const rule of config.rules) {
      this.addRule(rule);
    }

    this.logger.info('RedactionManager initialized', {
      ruleCount: this.rules.size,
      logAccess: this.logAccess,
      auditQueries: this.auditQueries,
      caseSensitive: this.caseSensitive,
    });
  }

  /**
   * Apply redaction rules to a query result
   */
  redactResults(results: QueryResult): QueryResultWithRedaction {
    if (!results.rows || results.rows.length === 0) {
      return results;
    }

    const redactionResult: RedactionResult = {
      fields_redacted: [],
      redaction_count: 0,
      rules_applied: [],
      warnings: [],
    };

    // Process each row
    const redactedRows = results.rows.map((row) =>
      this.redactRow(row, results.fields, redactionResult)
    );

    // Remove duplicates from tracking arrays
    redactionResult.fields_redacted = [...new Set(redactionResult.fields_redacted)];
    redactionResult.rules_applied = [...new Set(redactionResult.rules_applied)];

    // Log redacted access if configured
    if (this.logAccess && redactionResult.redaction_count > 0) {
      this.logger.info('Redacted field access', {
        fields_redacted: redactionResult.fields_redacted,
        redaction_count: redactionResult.redaction_count,
        rules_applied: redactionResult.rules_applied,
      });
    }

    return {
      ...results,
      rows: redactedRows,
      redaction: redactionResult.redaction_count > 0 ? redactionResult : undefined,
    };
  }

  /**
   * Apply redaction rules to a single row
   */
  private redactRow(
    row: Record<string, unknown>,
    fieldNames: string[],
    redactionResult: RedactionResult
  ): Record<string, unknown> {
    const redactedRow = { ...row };

    for (const fieldName of fieldNames) {
      const rule = this.shouldRedactField(fieldName);
      if (rule && fieldName in row) {
        const originalValue = row[fieldName];

        // Only redact non-null values (but redact empty strings)
        if (originalValue !== null && originalValue !== undefined) {
          try {
            const redactedValue = this.applyRedaction(originalValue, rule);

            redactedRow[fieldName] = redactedValue;
            redactionResult.fields_redacted.push(fieldName);
            redactionResult.redaction_count++;
            redactionResult.rules_applied.push(rule.field_pattern);
          } catch (error) {
            // Fail closed: if redaction throws, do NOT return the original sensitive
            // value. Replace it with a safe placeholder so nothing leaks.
            redactedRow[fieldName] = '[REDACTION_ERROR]';
            redactionResult.fields_redacted.push(fieldName);
            redactionResult.redaction_count++;
            const errorMsg = `Failed to redact field '${fieldName}': ${getErrorMessage(error)}`;
            redactionResult.warnings = redactionResult.warnings || [];
            redactionResult.warnings.push(errorMsg);
            this.logger.warning('Redaction error', { field: fieldName, error: errorMsg });
          }
        }
      }
    }

    return redactedRow;
  }

  /**
   * Check if a field should be redacted and return the matching rule
   */
  shouldRedactField(fieldName: string): FieldRedactionRule | null {
    const searchName = this.caseSensitive ? fieldName : fieldName.toLowerCase();

    // Check exact matches first
    for (const [pattern, rule] of this.rules) {
      if (rule.pattern_type === 'exact') {
        const rulePattern = this.caseSensitive ? pattern : pattern.toLowerCase();
        if (rulePattern === searchName) {
          return rule;
        }
      }
    }

    // Then check wildcard matches
    for (const [pattern, rule] of this.rules) {
      if (rule.pattern_type === 'wildcard') {
        if (
          this.matchesWildcard(searchName, this.caseSensitive ? pattern : pattern.toLowerCase())
        ) {
          return rule;
        }
      }
    }

    // Finally check regex matches
    for (const [pattern, rule] of this.rules) {
      if (rule.pattern_type === 'regex') {
        try {
          const flags = this.caseSensitive ? 'g' : 'gi';
          const regex = new RegExp(pattern, flags);
          if (regex.test(fieldName)) {
            return rule;
          }
        } catch (error) {
          this.logger.warning('Invalid regex pattern in redaction rule', { pattern, error });
        }
      }
    }

    return null;
  }

  /**
   * Apply specific redaction pattern to a value
   */
  private applyRedaction(value: unknown, rule: FieldRedactionRule): unknown {
    // Handle null/undefined values - should not happen due to earlier check
    if (value === null || value === undefined) return value;

    // Convert to string for redaction
    const stringValue = String(value);
    const maskChar = rule.mask_character || '*';

    switch (rule.redaction_type) {
      case 'full_mask':
        return RedactionPatterns.fullMask(stringValue, maskChar);

      case 'partial_mask':
        if (rule.preserve_format) {
          return RedactionPatterns.smartPartialMask(stringValue, maskChar);
        } else {
          return RedactionPatterns.partialMaskGeneric(stringValue, maskChar);
        }

      case 'replace':
        return rule.replacement_text || '[REDACTED]';

      case 'custom':
        if (rule.custom_pattern) {
          return RedactionPatterns.customPattern(
            stringValue,
            rule.custom_pattern,
            rule.replacement_text || '[REDACTED]'
          );
        } else {
          this.logger.warning('Custom redaction rule missing custom_pattern', { rule });
          return RedactionPatterns.fullMask(stringValue, maskChar);
        }

      default:
        this.logger.warning('Unknown redaction type', { redaction_type: rule.redaction_type });
        return RedactionPatterns.fullMask(stringValue, maskChar);
    }
  }

  /**
   * Check if a field name matches a wildcard pattern
   */
  private matchesWildcard(fieldName: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
      .replace(/\*/g, '.*'); // Convert * to .*

    try {
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(fieldName);
    } catch (error) {
      this.logger.warning('Invalid wildcard pattern', { pattern, error });
      return false;
    }
  }

  /**
   * Add a redaction rule
   */
  private addRule(rule: FieldRedactionRule): void {
    // Validate rule
    if (!rule.field_pattern) {
      this.logger.warning('Redaction rule missing field_pattern', { rule });
      return;
    }

    this.rules.set(rule.field_pattern, rule);
  }

  /**
   * Create audit log entry for redacted query
   */
  createAuditEntry(
    database: string,
    queryHash: string,
    redactionResult: RedactionResult
  ): RedactionAuditEntry {
    return {
      timestamp: new Date().toISOString(),
      database,
      query_hash: queryHash,
      fields_redacted: redactionResult.fields_redacted,
      rules_applied: redactionResult.rules_applied,
      redaction_count: redactionResult.redaction_count,
    };
  }

  /**
   * Get current configuration summary
   */
  getConfigurationSummary(): {
    enabled: boolean;
    rule_count: number;
    rules: Array<{ pattern: string; type: string; redaction: string }>;
    settings: {
      log_access: boolean;
      audit_queries: boolean;
      case_sensitive: boolean;
    };
  } {
    const rules = Array.from(this.rules.values()).map((rule) => ({
      pattern: rule.field_pattern,
      type: rule.pattern_type,
      redaction: rule.redaction_type,
    }));

    return {
      enabled: true,
      rule_count: this.rules.size,
      rules,
      settings: {
        log_access: this.logAccess,
        audit_queries: this.auditQueries,
        case_sensitive: this.caseSensitive,
      },
    };
  }

  /**
   * Update redaction rules at runtime
   */
  updateRules(config: DatabaseRedactionConfig): void {
    this.rules.clear();
    this.logAccess = config.log_redacted_access ?? false;
    this.auditQueries = config.audit_redacted_queries ?? false;
    this.caseSensitive = config.case_sensitive_matching ?? false;
    this.defaultRedaction = config.default_redaction;

    for (const rule of config.rules) {
      this.addRule(rule);
    }

    this.logger.info('RedactionManager rules updated', {
      ruleCount: this.rules.size,
    });
  }

  /**
   * Test redaction rules against sample data
   */
  testRedaction(sampleData: Record<string, unknown>): {
    original: Record<string, unknown>;
    redacted: Record<string, unknown>;
    fields_affected: string[];
    rules_applied: string[];
  } {
    const fields = Object.keys(sampleData);
    const redactionResult: RedactionResult = {
      fields_redacted: [],
      redaction_count: 0,
      rules_applied: [],
    };

    const redacted = this.redactRow(sampleData, fields, redactionResult);

    return {
      original: sampleData,
      redacted,
      fields_affected: redactionResult.fields_redacted,
      rules_applied: redactionResult.rules_applied,
    };
  }
}
