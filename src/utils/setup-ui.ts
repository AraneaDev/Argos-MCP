/**
 * Setup UI utilities for interactive console output
 * This is specifically for setup wizard UI, separate from server logging
 */

import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from './logger.js';

const _currentFile = fileURLToPath(import.meta.url);
const _currentDir = dirname(_currentFile);
const PROJECT_ROOT = resolve(_currentDir, '..', '..');
import type { DatabaseConfig, ExtensionConfig, SecurityConfig } from '../types/database.js';

// ============================================================================
// Setup UI Class
// ============================================================================

/**
 *
 */
export class SetupUI {
  private static instance: SetupUI | undefined;
  private readonly logger = getLogger({
    component: 'setup',
    enableFile: true,
    enableConsole: false, // Don't duplicate console output in logger
    logFile: join(PROJECT_ROOT, 'setup.log'),
    logLevel: 'WARNING', // Only log warnings and errors by default
  });

  private constructor() {
    // Singleton pattern
  }

  /**
   *
   */
  public static getInstance(): SetupUI {
    if (!SetupUI.instance) {
      SetupUI.instance = new SetupUI();
    }
    return SetupUI.instance;
  }

  // ============================================================================
  // Console Output Methods (for interactive setup only)
  // ============================================================================

  /**
   *
   */
  public print(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
    // Don't log routine UI output to avoid noise
  }

  /**
   *
   */
  public printHeader(title: string): void {
    const separator = '='.repeat(50);
    // eslint-disable-next-line no-console
    console.log(`\n${title}`);
    // eslint-disable-next-line no-console
    console.log(separator);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printSection(title: string): void {
    // eslint-disable-next-line no-console
    console.log(`\n${title}`);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printSubsection(title: string): void {
    // eslint-disable-next-line no-console
    console.log(`\n ${title}:`);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printInfo(message: string): void {
    // eslint-disable-next-line no-console
    console.log(` ${message}`);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printSuccess(message: string): void {
    // eslint-disable-next-line no-console
    console.log(` ${message}`);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printWarning(message: string): void {
    // eslint-disable-next-line no-console
    console.log(` ${message}`);
    this.logger.warning(`UI Warning: ${message}`);
  }

  /**
   *
   */
  public printError(message: string): void {
    // eslint-disable-next-line no-console
    console.log(` ${message}`);
    this.logger.error(`UI Error: ${message}`);
  }

  /**
   *
   */
  public printOption(number: number | string, description: string): void {
    // eslint-disable-next-line no-console
    console.log(`${number}. ${description}`);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printDetail(label: string, value: string | number | boolean): void {
    const displayValue = typeof value === 'boolean' ? (value ? '' : '') : value;
    // eslint-disable-next-line no-console
    console.log(` ${label}: ${displayValue}`);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printDetailWithStatus(
    label: string,
    value: string | number | boolean,
    enabled: boolean
  ): void {
    const status = enabled ? '' : '';
    const displayValue = typeof value === 'boolean' ? status : `${status} (${value})`;
    // eslint-disable-next-line no-console
    console.log(` ${label}: ${displayValue}`);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printSeparator(): void {
    const separator = '='.repeat(50);
    // eslint-disable-next-line no-console
    console.log(separator);
    // Don't log routine UI output
  }

  /**
   *
   */
  public printEmptyLine(): void {
    // eslint-disable-next-line no-console
    console.log('');
  }

  // ============================================================================
  // Configuration Display Methods
  // ============================================================================

  /**
   *
   */
  public printDatabaseConfig(name: string, config: DatabaseConfig): void {
    this.printSubsection(name);
    this.printDetail('Type', config.type);

    if (config.type !== 'sqlite') {
      this.printDetail('Host', `${config.host}:${config.port}`);
      this.printDetail('Database', config.database || 'N/A');
      this.printDetail('Username', config.username || 'N/A');
      this.printDetail('SSL', config.ssl || false);
      this.printDetailWithStatus('SSH Tunnel', config.ssh_host || 'None', !!config.ssh_host);
    } else {
      this.printDetail('File', config.file || 'N/A');
    }

    const isSelectOnly = config.select_only === true;
    this.printDetail('SELECT-only Mode', isSelectOnly ? ' ENABLED' : ' DISABLED');
  }

  /**
   *
   */
  public printExtensionConfig(config: Partial<ExtensionConfig>): void {
    this.printSection(' Extension Settings:');
    this.printDetail('Max Rows', config.max_rows || 1000);
    this.printDetail('Query Timeout', `${config.query_timeout || 30000}ms`);
    this.printDetail('Max Batch Size', config.max_batch_size || 10);
    this.printDetail('Debug Mode', config.debug || false);
  }

  /**
   *
   */
  public printSecurityConfig(config: Partial<SecurityConfig>): void {
    this.printSection(' Security Settings:');
    this.printDetail('Max JOINs', config.max_joins || 10);
    this.printDetail('Max Subqueries', config.max_subqueries || 5);
    this.printDetail('Max UNIONs', config.max_unions || 3);
    this.printDetail('Max GROUP BYs', config.max_group_bys || 5);
    this.printDetail('Max Complexity', config.max_complexity_score || 100);
    this.printDetail('Max Query Length', config.max_query_length || 10000);
  }

  // ============================================================================
  // Debug Methods
  // ============================================================================

  /**
   *
   */
  public printDebug(message: string, data?: unknown): void {
    // Only show debug output if explicitly enabled via environment variable
    if (process.env.DEBUG_SETUP === 'true') {
      if (data) {
        // eslint-disable-next-line no-console
        console.log(` Debug - ${message}:`, JSON.stringify(data, null, 2));
        this.logger.debug(`UI Debug: ${message}`, { data });
      } else {
        // eslint-disable-next-line no-console
        console.log(` Debug - ${message}`);
        this.logger.debug(`UI Debug: ${message}`);
      }
    } else {
      // Always log to file for debugging later, just don't show in console
      this.logger.debug(`UI Debug: ${message}`, data ? { data } : undefined);
    }
  }

  // ============================================================================
  // Logging Integration
  // ============================================================================

  /**
   *
   */
  public logUserAction(action: string, details?: Record<string, unknown>): void {
    this.logger.info(`User Action: ${action}`, details);
  }

  /**
   *
   */
  public logError(error: Error, context?: string): void {
    const message = context ? `${context}: ${error.message}` : error.message;
    this.printError(message);
    this.logger.error('Setup Error', error);
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

// Export commonly used functions for easier imports
export const ui = SetupUI.getInstance();
