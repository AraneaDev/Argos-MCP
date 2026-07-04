# Changelog

All notable changes to the SQL MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.6.3] - 2026-07-04

### Changed
- `bump-version.sh` now promotes the `## [Unreleased]` CHANGELOG section to the released version, syncs version references in `docs/api/typescript-api.md` and `docs/tutorials/01-installation.md`, and refuses to release when the `[Unreleased]` section is missing or empty

### Fixed
- Backfilled missing CHANGELOG entries (2.4.4 through 2.6.2) and corrected stale version references in the TypeScript API and installation docs

## [2.6.2] - 2026-07-04

### Changed
- Applied Prettier formatting to satisfy the `format:check` CI gate

### Removed
- Stopped tracking `CLAUDE.md` in git and added it to `.gitignore`

## [2.6.1] - 2026-07-04

### Changed
- Hardened `utils` unit tests to a 100% mutation score (via chaos-mcp)

## [2.6.0] - 2026-07-04

Remediation of security audit findings (3 critical, 8 high, 6 medium, 3 low from `SECURITY-AUDIT.md`).

### Added
- SSH remote host key verification with fingerprint pinning (fails closed)

### Changed
- SELECT-only enforcement now also guards `sql_analyze_performance` and rejects data-modifying CTEs, `EXPLAIN ANALYZE`, `COPY ... PROGRAM`, stacked statements, and embedded write keywords (leading-token check)
- Fail-secure config defaults: `select_only` defaults to `true`, `ssl_verify` preserves `undefined` so TLS cert validation stays on, and MCP-added databases are always read-only
- SSH hardening: dropped SHA-1 KEX/HMAC, gated debug trace behind `SSH_DEBUG`, warn on non-loopback bind
- Honor configured `max_rows`; added PostgreSQL `statement_timeout`; wrapped batch/analyze in the query timeout; MSSQL placeholder replacement now skips string literals

### Fixed
- Redact secret fields before logging tool args; log/config files written `0600`; non-destructive, size-capped log rotation; atomic config writes
- Client-facing errors routed through `sanitizeMessage` (bearer tokens, passphrases, PEM); redaction now fails closed

### Security
- `npm audit fix` (6 of 7 advisories); documented the HTTP-transport auth caveat

## [2.5.3] - 2026-05-25

### Changed
- Extracted adapter construction into a dedicated `AdapterFactory` with logic and security refinements for database adapters and sanitization

## [2.5.2] - 2026-05-25

### Added
- CI now packages release assets as both `.zip` and `.tgz`
- CLAUDE.md project guidelines

### Changed
- Unified config loading and fixed runtime field redaction
- Default `ssl_verify` to `true` when SSL is enabled, extended to MSSQL
- Enforce `query_timeout` via `Promise.race`
- Unified path validation across config handlers; validate config in `handleUpdateDatabase`
- Renamed repository references and URLs to `mcp-sql-access-server`

### Fixed
- `sql_test_connection` now reports the actual connection status

### Security
- Sanitize database names in schema file paths; set restrictive (`0600`) permissions on schema files

## [2.5.1] - 2026-04-06

### Added
- Audit logging of config changes made via MCP tools

### Security
- Validate queries even when `select_only` is false
- Block `select_only` changes via MCP tools
- Block MySQL version-conditional comment bypass
- Validate database names to prevent INI injection
- Validate config in `handleAddDatabase`
- Validate SQLite file paths against traversal

### Fixed
- Resolved lint warnings and a flaky backoff test
- Ensure bin files are executable after build

## [2.5.0] - 2026-04-06

### Added
- **Circuit Breaker** - Automatic failure detection with open/half-open/closed state machine and `CircuitOpenError`
- **Query Cache** - TTL-LRU cache with per-database partitioning and automatic mutation invalidation
- **MetricsManager** - Per-database latency, error rate, circuit breaker, and cache hit/miss tracking
- **`sql_get_metrics` Tool** - New MCP tool exposing in-memory performance metrics
- **Audit Logger** - Structured audit logging with `audit_log` and `cache_ttl_seconds` config fields
- **Database Config Validation** - `validateDatabaseConfig` with host, port, and database name checks
- **SSH Key Permission Checks** - Validates private key file permissions before loading
- **Connection Pooling** - PostgreSQL pooling via `pg.Pool` and MySQL pooling via `mysql2 createPool`
- **Configurable SSH Bind Address** - New `ssh_local_host` option for SSH tunnel bind address

### Changed
- Circuit breaker, query cache, and metrics integrated into `ConnectionManager.executeQuery` pipeline
- `MetricsManager` and `QueryCache` instantiated in `SQLMCPServer` and wired into `ConnectionManager`
- Replaced non-null assertions and type assertions in adapters with typed local consts

### Fixed
- Unsafe internal property access in `isConnected` checks replaced with safe alternatives
- Swallowed errors in SSH port suggestion fallback now logged
- Flaky timing assertion in connection-manager test converted to fake timers

### Security
- Block `EXEC`/`CALL`/stored procedure execution in non-SELECT mode
- Warn when `config.ini` is group- or world-readable

### Testing
- New test coverage for circuit breaker, query cache, schema race conditions, and SSH tunnels

## [2.4.4] - 2026-04-05

### Fixed
- Documentation: corrected version references and class names, and updated the bump script

## [2.4.3] - 2026-04-05

### Added
- 10 new test files covering tools/handlers, utils, types, and adapter factory
- GitHub Actions CI workflow with lint, format, type-check, and test matrix (Node 18/20/22)
- Prettier code formatting with `.prettierrc.json` and `.prettierignore`

### Changed
- Expanded 12 existing test files with error path, edge case, and branch coverage
- Raised Jest coverage thresholds to industry standards: 80% statements/lines/functions, 70% branches
- Total test count: 416 → 1101 tests across 21 suites

### Fixed
- Redaction manager test describe block structure (premature closure)
- Logger test url mock for SWC CJS transform compatibility (`pathToFileURL`)
- Connection manager SQLite+ssh_host test missing required `ssh_password` field
- Timing-sensitive exponential backoff test tolerance

## [2.4.2] - 2026-03-28

### Changed
- Migrated repository URLs from Forgejo to GitHub
- Full spectrum audit: deduplication, type safety improvements, security hardening, and tooling updates
- Switched test transform from ts-jest to @swc/jest for native ESM/import.meta support
- Removed dead `getSafeString/Number/Boolean` test cases referencing removed base adapter methods

### Fixed
- Resolved all 10 failing test suites caused by ts-jest ESM compilation errors with `import.meta.url`
- All 11 test suites now pass (416 tests)

## [2.4.1] - 2026-03-22

### Fixed
- Resolved log and schema file paths to project root instead of current working directory
- Fixed stdout contamination and config path failures causing random MCP connection drops

## [2.4.0] - 2026-03-14

### Added
- Retry logic for transient connection failures (ECONNREFUSED, ETIMEDOUT, etc.) with exponential backoff
- 10-second shutdown timeout to prevent hanging on disconnect
- ESLint JSDoc plugin enforcing documentation on public API surface
- `@typescript-eslint/recommended` ruleset with strict type checking
- `eqeqeq` and `no-throw-literal` lint rules
- Per-connection and per-tunnel 5-second timeouts during cleanup

### Changed
- **Breaking up the god class**: Extracted SQLMCPServer (1,637 lines) into focused modules:
  - `src/tools/tool-definitions.ts` - MCP tool JSON schemas
  - `src/tools/dispatcher.ts` - Tool call routing
  - `src/tools/handlers/query-handlers.ts` - Query, batch, and performance tools
  - `src/tools/handlers/schema-handlers.ts` - Schema, list, test, and refresh tools
  - `src/tools/handlers/config-handlers.ts` - Database CRUD and config tools
  - `src/utils/response-formatter.ts` - Table and summary formatting
- SQLMCPServer reduced to ~330 lines (lifecycle + config parsing only)
- `closeAllConnections()` and `closeAllTunnels()` now use `Promise.allSettled` instead of `Promise.all`
- Uncaught exception/rejection handlers now route through `gracefulShutdown()` instead of `process.exit(1)`
- Replaced all `any` types with proper types across the codebase (0 ESLint warnings)

### Fixed
- Duplicate `process.on('exit')` and `process.on('SIGINT')` handlers in EnhancedSSHTunnelManager competing with main shutdown handler
- Async cleanup in sync `process.on('exit')` handler that could never complete
- `server.cleanup()` hanging forever if a connection/tunnel refused to close
- Schema manager tests updated to match compact schema output format
- Integration test compilation errors restored
- Strict equality violation in RedactionManager

### Removed
- Dead `SSHTunnelManager.ts` (512 lines) - never imported by production code, registered competing signal handlers
- Unused imports: `createHash`, `RedactionType`, `FieldPatternType`, `isValidFieldPatternType`

## [2.3.1] - 2026-03-11

### Changed
- **`sql_get_schema` Compact Output** - Schema output now adapts based on size: large schemas (>200 columns) show a compact summary with table names, column counts, and key columns; small schemas show full inline column details. This prevents output from exceeding MCP token limits on large databases.

## [2.3.0] - 2026-03-10

### Added
- **Dynamic Database Management via MCP** - Add, update, and remove database configurations at runtime using MCP tools
- **`sql_add_database` Tool** - Add new databases via MCP with automatic `mcp_configurable=true` and `select_only=true` defaults
- **`sql_update_database` Tool** - Modify database settings (host, port, credentials, SSL, SSH) via MCP for configurable databases
- **`sql_remove_database` Tool** - Remove databases via MCP, including disconnection and SSH tunnel cleanup
- **`sql_get_config` Tool** - View database configuration with automatic password/credential redaction
- **`sql_set_mcp_configurable` Tool** - One-way lock mechanism to prevent MCP configuration changes (unlocking requires manual config edit)
- **`mcp_configurable` Configuration Flag** - Per-database flag controlling whether MCP tools can modify the database settings
- **`mcp-sql-install` CLI Installer** - Automatic installer that configures Claude Code and Claude Desktop MCP integration
- **Platform Detection** - Installer auto-detects macOS, Windows, and Linux config file locations
- **Default Config Location** - New default config path at `~/.config/sql-access/config.ini` for installed usage

### Changed
- **`DatabaseConfig` Interface** - Added `mcp_configurable?: boolean` field
- **`DatabaseListItem` Interface** - Added `mcp_configurable: boolean` field
- **`sql_list_databases` Output** - Now shows MCP configurable status for each database
- **Config Persistence** - `saveConfigFile()` now writes `mcp_configurable` flag
- **`SQLMCPServer`** - Stores config file path as instance variable for runtime config persistence
- **`ConnectionManager`** - `createDatabaseListItems()` includes `mcp_configurable` in output
- **`package.json`** - Added `mcp-sql-install` bin entry and `install-mcp` npm script
- **esbuild Config** - Updated to bundle `install.ts` entry point
- **Documentation** - Comprehensive updates across README, API reference, configuration guide, installation guide, tutorials, and architecture docs

### Security
- **One-Way Lock Design** - `sql_set_mcp_configurable` can only lock (set to false), preventing AI from re-enabling its own config access
- **Credential Redaction** - `sql_get_config` always redacts passwords, SSH keys, and passphrases
- **Safe Defaults** - Manually-configured databases default to `mcp_configurable=false`; MCP-created databases default to `select_only=true`
- **Config Mutation Logging** - All configuration changes via MCP are logged

### Testing
- **456 tests passing** (up from 437)
- **Test fixture updates** - Updated `DatabaseListItem` test fixtures for `mcp_configurable` field

### Breaking Changes
- **None** - This release is fully backward compatible with v2.2.x. Existing databases without `mcp_configurable` default to `false` (locked).

### Migration Guide
No migration required. Existing configurations work without changes. To enable MCP configuration for existing databases, add `mcp_configurable=true` to the desired `[database.*]` sections in config.ini.

## [2.2.0] - 2026-02-23

### Added
- **Field Redaction Implementation** - Automatic masking/replacement of sensitive data in query results
- **Configurable Redaction Rules** - Support for exact match, wildcard, and regex patterns for field matching
- **Multiple Redaction Patterns** - Full masking, partial masking, and custom replacement text options
- **Security-Enhanced Query Results** - Automatic protection of sensitive fields without application changes
- **RedactionManager Class** - Dedicated redaction engine with flexible pattern support
- **Enhanced Configuration Schema** - New redaction configuration options in database settings
- **Audit Logging for Redacted Fields** - Optional logging when redacted fields are accessed
- **Email & Phone Redaction Patterns** - Built-in support for common sensitive data types
- **Preserve Format Options** - Maintain original data structure while redacting content

### Changed
- **Database Adapter Integration** - Enhanced base adapter to support field redaction processing
- **Configuration Parser Updates** - Extended configuration parsing to handle redaction rules
- **Query Result Processing** - Updated result normalization to apply redaction before output
- **Setup Wizard Enhancement** - Added interactive redaction configuration during setup
- **Documentation Updates** - Comprehensive redaction feature documentation and examples

### Fixed
- **Memory Management** - Improved resource cleanup in redaction processing
- **Type Safety** - Enhanced TypeScript type definitions for redaction configuration
- **Configuration Validation** - Better error handling for malformed redaction rules

### Security
- **Sensitive Data Protection** - Automatic redaction prevents accidental exposure of sensitive information
- **Configurable Security Policies** - Flexible rules allow customization per security requirements
- **Data Loss Prevention** - Built-in patterns protect common sensitive data types
- **Audit Trail** - Optional logging provides compliance-ready access tracking

### Documentation
- **Field Redaction Guide** - Complete documentation for redaction feature configuration
- **Security Best Practices** - Updated security guidance including redaction recommendations
- **Configuration Examples** - Practical examples for common redaction scenarios
- **API Documentation Updates** - Updated TypeScript API reference with redaction interfaces

### Testing
- **Redaction Test Suite** - Comprehensive tests for all redaction patterns and configurations
- **Integration Testing** - End-to-end validation of redaction in query workflows
- **Performance Testing** - Validation that redaction adds minimal performance overhead

### Breaking Changes
- **None** - This release is fully backward compatible with v2.1.x

### Migration Guide
No migration is required for this release. Field redaction is an opt-in feature that can be enabled through configuration. All existing configurations and integrations continue to work without changes.

## [2.1.0] - 2025-08-29

### Added
- **Enhanced SSH Tunneling** with connection pooling and health monitoring
- **Comprehensive test coverage** (427+ tests, 90%+ coverage achieved)
- **Enhanced configuration templates** with detailed examples
- **Port management utilities** for better resource allocation and conflict resolution 
- **Enhanced SSH tunnel examples** and comprehensive documentation
- **Improved error handling** and logging throughout all components
- **Performance optimizations** in connection management and query processing
- **Database adapter improvements** with better type safety and error handling

### Changed 
- **Improved ConnectionManager** with better error handling and resource cleanup
- **Enhanced security validation** with more comprehensive SQL injection prevention
- **Updated TypeScript configurations** for better type safety and development experience
- **Optimized query performance analysis** with more accurate complexity calculations
- **Better resource cleanup** and memory management across all components
- **Enhanced logging system** with better error tracking and debugging capabilities

### Fixed
- **SSH tunnel connection stability** issues in high-load scenarios
- **Memory leaks** in connection pooling and SSH tunnel management
- **Query complexity calculation** edge cases with complex nested queries
- **Configuration validation** edge cases with malformed INI files
- **File system operation** error handling in schema caching
- **Database adapter** connection recovery in network failure scenarios
- **Port assignment conflicts** in concurrent SSH tunnel creation

### Security
- **Enhanced SQL injection prevention** mechanisms with improved pattern detection
- **Improved error message sanitization** to prevent information disclosure
- **Better connection security validation** with stricter SSL/TLS enforcement
- **Enhanced SSH tunnel security** features with better key validation
- **Audit logging improvements** for better security compliance tracking

### Documentation
- **Complete test coverage documentation** with detailed coverage reports
- **Enhanced SSH tunneling feature documentation** with practical examples
- **Updated API documentation** and comprehensive reference guides
- **Improved troubleshooting guides** with common solutions
- **Better configuration examples** for various deployment scenarios
- **Enhanced tutorial content** for getting started quickly

### Testing
- **427+ test scenarios** added across all components
- **90%+ line coverage** achieved for core functionality
- **Comprehensive integration tests** for MCP protocol compliance
- **Performance benchmarking** for database operations
- **Security validation testing** for SQL injection prevention
- **SSH tunnel functionality testing** with real network scenarios
- **Database adapter testing** for all supported database types

### Build & Development
- **Improved build process** with better error handling
- **Enhanced development tooling** with better debugging support
- **Updated ESLint configuration** with stricter rules
- **Better TypeScript integration** with improved type definitions
- **Automated testing pipeline** improvements

### Breaking Changes
- **None** - This release is fully backward compatible with v2.0.x

### Migration Guide 
No migration is required for this release. All existing configurations, scripts, and integrations will continue to work without changes.

### Deprecation Notices
- Legacy SSH tunnel configuration format will be deprecated in v3.0.0 (still supported in v2.1.0)
- Some internal API methods may be deprecated in future releases (no user impact)

## [2.0.0] - 2025-08-14

### Added
- Initial release with comprehensive database support
- MCP protocol implementation
- Security features and SQL injection prevention
- SSH tunneling capabilities
- Multi-database support (PostgreSQL, MySQL, SQLite, SQL Server)
- Configuration management and validation
- Performance monitoring and query analysis

### Initial Features
- Connection management and pooling
- Schema caching and introspection
- Security validation and audit logging
- Error handling and recovery mechanisms
- Comprehensive documentation and examples

---

## Version Numbering

This project uses [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for new functionality in a backwards compatible manner 
- **PATCH** version for backwards compatible bug fixes

## Support Policy

- **Current Release (2.5.x)**: Full support including new features and bug fixes
- **Previous Release (2.4.x)**: Security fixes and critical bug fixes only
- **Previous Release (2.3.x)**: No longer supported, upgrade recommended
