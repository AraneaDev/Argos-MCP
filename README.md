# MCP SQL Access Server v2.7.0

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Test Coverage](https://img.shields.io/badge/Coverage-88%25-brightgreen)](https://github.com/AraneaDev/mcp-sql-access-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-1181%20passing-success)](https://github.com/AraneaDev/mcp-sql-access-server)
[![ESLint](https://img.shields.io/badge/ESLint-0%20warnings-brightgreen?logo=eslint)](https://eslint.org/)
[![JSDoc](https://img.shields.io/badge/JSDoc-enforced-blue)](https://jsdoc.app/)
[![Strict TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org/)

**Enterprise-grade MCP SQL Access Server v2.7.0** - Connect Claude Desktop to your databases with bulletproof security, comprehensive monitoring, and seamless multi-database support.

## Why Choose MCP SQL Access Server v2.7.0?

### **Security First**
- **SELECT-Only Mode** - Production-safe read-only database access
- **Query Validation** - Advanced SQL injection prevention and complexity analysis
- **SSH Tunneling** - Secure encrypted connections through bastion hosts
- **Audit Logging** - Comprehensive security event tracking

### **High Performance**
- **Connection Pooling** - Efficient database connection management
- **Schema Caching** - Lightning-fast metadata access
- **Query Optimization** - Built-in performance analysis and recommendations
- **Batch Operations** - Execute multiple queries with transaction support

### **Universal Database Support**
- **PostgreSQL** - Full support including advanced features
- **MySQL/MariaDB** - Complete compatibility with all versions
- **SQLite** - Perfect for development and small applications
- **SQL Server** - Enterprise-grade Microsoft SQL Server support

### **Developer Experience**
- **5-Minute Setup** - Interactive configuration wizard or automatic installer
- **TypeScript Native** - Full type safety and IntelliSense support
- **Comprehensive Docs** - Detailed guides, tutorials, and API reference
- **Extensive Testing** - Unit, integration, and end-to-end test coverage

## Quick Start

### 1. Install
```bash
git clone https://github.com/AraneaDev/mcp-sql-access-server.git
cd mcp-sql-access-server
npm install
npm run build
npm link
```

> **Note:** `npm link` makes the CLI commands (`mcp-sql-install`, `mcp-sql-server`, `mcp-sql-setup`) available globally. Alternatively, you can run them directly with `node dist/install.js`.

### 2. Connect to Claude
```bash
mcp-sql-install
```
Registers the MCP server with Claude Code and/or Claude Desktop. Use `--client=claude-code` or `--client=claude-desktop` to target a specific client.

### 3. Configure Databases
```bash
mcp-sql-setup
```
Interactive wizard for adding database connections, security settings, and SSH tunnels. You can also add databases at runtime using the `sql_add_database` MCP tool.

## Use Cases

### **Data Analytics & Business Intelligence**
> "Show me the top 10 customers by revenue this quarter, including their growth rate compared to last quarter"

### **Production Database Monitoring**
> "Check the status of our user registration system - how many signups in the last 24 hours and any error patterns?"

### **Database Administration**
> "Analyze the performance of our product catalog queries and suggest optimizations"

### **Development & Testing**
> "Generate test data scenarios based on our current user demographics"

## Architecture

```mermaid
graph TB
 Claude[Claude Desktop] --> MCP[MCP Protocol]
 MCP --> Security[Security Layer]
 Security --> Connection[Connection Manager]
 Connection --> Adapters[Database Adapters]

 Adapters --> PostgreSQL[(PostgreSQL)]
 Adapters --> MySQL[(MySQL)]
 Adapters --> SQLite[(SQLite)]
 Adapters --> MSSQL[(SQL Server)]

 Security --> SSH[SSH Tunneling]
 SSH --> Bastion[Bastion Host]
 Bastion --> RemoteDB[(Remote Database)]
```

**Built on solid foundations:**
- **TypeScript** - Full type safety and modern development experience
- **Node.js** - Cross-platform compatibility and excellent ecosystem
- **MCP Protocol** - Standard protocol for AI tool integration
- **Industry-standard drivers** - Proven database connectivity libraries

## Documentation Hub

### **Getting Started**
- **[5-Minute Quick Start](docs/guides/quick-start.md)** - Get running fast
- **[Installation Guide](docs/guides/installation-guide.md)** - Detailed setup instructions
- **[First Database Tutorial](docs/tutorials/02-first-database.md)** - Connect your first database
- **[Claude Integration](docs/tutorials/03-claude-integration.md)** - Set up Claude Desktop

### **Architecture & Design**
- **[System Architecture](docs/architecture/system-architecture.md)** - How it all works together
- **[Security Architecture](docs/architecture/security-architecture.md)** - Defense-in-depth security model
- **[Database Layer](docs/architecture/database-layer.md)** - Adapter pattern implementation

### **API Reference**
- **[MCP Tools Reference](docs/api/mcp-tools-reference.md)** - Complete tool documentation
- **[TypeScript API](docs/api/typescript-api.md)** - Developer API reference
- **[Configuration Reference](docs/guides/configuration-guide.md)** - All configuration options

### **Advanced Guides**
- **[Multi-Database Setup](docs/tutorials/advanced-01-multi-database.md)** - Managing multiple databases
- **[SSH Tunneling](docs/tutorials/advanced-02-ssh-tunnels.md)** - Secure remote access
- **[Security Hardening](docs/operations/security-hardening.md)** - Production security guide
- **[Performance Tuning](docs/operations/performance-tuning.md)** - Optimization strategies

**[Browse All Documentation](docs/README.md)**

## Configuration Examples

### Production PostgreSQL with SSH
```ini
[database.production]
type=postgresql
host=internal-db.company.local
port=5432
database=production_app
username=readonly_user
password=secure_random_password
ssl=true
select_only=true
timeout=15000

# SSH Tunnel Configuration
ssh_host=bastion.company.com
ssh_port=22
ssh_username=tunnel_user
ssh_private_key=/secure/path/ssh_key

[security]
max_joins=5
max_subqueries=3
max_complexity_score=50
```

### Multi-Database Analytics Setup
```ini
[database.transactions]
type=postgresql
host=transactions-db.company.com
database=transactions
select_only=true

[database.users]
type=mysql
host=users-db.company.com
database=users
select_only=true

[database.analytics]
type=sqlite
file=./data/analytics.sqlite
select_only=false

[database.local_cache]
type=sqlite
file=./data/cache.sqlite
select_only=false
mcp_configurable=true

[extension]
max_rows=1000
query_timeout=30000
```

## Security Features

### Multi-Layer Security Model
1. **Query Validation** - SQL injection prevention and syntax analysis
2. **Complexity Limits** - Prevent resource-intensive queries
3. **SELECT-Only Mode** - Read-only database access for production safety
4. **Connection Encryption** - SSL/TLS and SSH tunnel support
5. **Audit Logging** - Comprehensive security event tracking
6. **[Field Redaction](docs/features/field-redaction.md)** - Automatic masking of sensitive data in query results

### Field Redaction

Automatically mask, replace, or partially obscure sensitive fields (emails, phone numbers, SSNs, etc.) in query results before they reach Claude or other clients. Redaction is configured per-database in `config.ini`:

```ini
[database.production]
type=postgresql
host=prod-db.company.com
database=app_db
username=readonly_user
password=secure_pass
select_only=true

# Field Redaction
redaction_enabled=true
redaction_rules=*email*:partial_mask,*phone*:full_mask,ssn:replace:[PROTECTED]
redaction_case_sensitive=false
redaction_log_access=true
```

**Redaction types:**
| Type | Example Input | Example Output |
|------|--------------|----------------|
| `partial_mask` | `john.doe@example.com` | `j******.e@*****.com` |
| `full_mask` | `555-123-4567` | `************` |
| `replace` | `123-45-6789` | `[PROTECTED]` |
| `custom` | Regex-based | Custom pattern |

**Field patterns:** exact match (`email`), wildcard (`*email*`), or regex (`/^user_.+$/`).

**[Full Redaction Guide](docs/features/field-redaction.md)**

### Enterprise Security Compliance
- **SOC 2 Type II** compatible logging and monitoring
- **GDPR/CCPA** compliant data access controls
- **HIPAA** suitable with proper configuration
- **PCI DSS** compatible for payment data environments

## Dynamic Database Management

MCP SQL Access Server supports runtime database management through dedicated MCP tools. This allows you to add, update, and remove database connections without restarting the server.

### Available MCP Tools

| Tool | Description | Requirements |
|------|-------------|--------------|
| `sql_add_database` | Add new database connections at runtime via MCP | None |
| `sql_update_database` | Update existing database settings via MCP | `mcp_configurable=true` on the target database |
| `sql_remove_database` | Remove database connections via MCP | `mcp_configurable=true` on the target database |
| `sql_get_config` | View database configuration (passwords are automatically redacted) | None |
| `sql_set_mcp_configurable` | Lock a database from MCP changes | One-way operation: can only lock (`false`), unlocking requires manual config edit |

### Usage Notes

- Set `mcp_configurable=true` in your database config to allow MCP-driven updates and removal.
- The `sql_set_mcp_configurable` tool is a one-way lock: once set to `false`, the database can no longer be modified or removed via MCP. Unlocking requires a manual edit to the configuration file.
- The `sql_get_config` tool always redacts passwords and other sensitive fields before returning configuration data.
- Databases added at runtime via `sql_add_database` have `mcp_configurable=true` by default.

## Performance

### Benchmarks
| Operation | PostgreSQL | MySQL | SQLite | SQL Server |
|-----------|------------|-------|--------|------------|
| Simple SELECT | ~5ms | ~4ms | ~1ms | ~6ms |
| Complex JOIN | ~45ms | ~40ms | ~8ms | ~50ms |
| Schema Capture | ~150ms | ~120ms | ~30ms | ~180ms |
| Connection Setup | ~80ms | ~60ms | ~5ms | ~100ms |

### Performance Features
- **Connection Pooling** - Reuse database connections efficiently
- **Schema Caching** - Instant metadata access after initial capture
- **Query Optimization** - Built-in EXPLAIN plan analysis
- **Result Streaming** - Handle large datasets efficiently
- **Batch Operations** - Execute multiple queries optimally

## CLI Commands

The following CLI commands are available after installation:

| Command | Description |
|---------|-------------|
| `mcp-sql-server` | Start the MCP SQL Access Server |
| `mcp-sql-setup` | Run the interactive configuration wizard |
| `mcp-sql-install` | Automatic installer for quick setup and Claude Desktop integration |

## Development

### Development Setup
```bash
git clone https://github.com/AraneaDev/mcp-sql-access-server.git
cd mcp-sql-access-server
npm install
npm run dev
npm test
```

**[Full Development Guide](docs/development/development-setup.md)**

## License

This project is licensed under the **MIT License**.

### Open Source Commitment
- **Always free** for individual developers and small teams
- **No vendor lock-in** - use with any Claude deployment
- **Transparent** development process and roadmap

## Acknowledgments

### Built With
- **TypeScript** - Language and tooling
- **Node.js** - Runtime platform
- **Jest** - Testing framework
- **ESLint** - Code quality
- **MCP Protocol** - AI integration standard

### Special Thanks
- **[Anthropic](https://anthropic.com)** - For Claude AI and MCP protocol
- **[TypeScript Team](https://www.typescriptlang.org/)** - For excellent tooling
- **Database Driver Maintainers** - For reliable connectivity libraries

---

<div align="center">

**[Get Started Now](docs/guides/quick-start.md)** | **[Documentation](docs/README.md)**

*Transform your database interactions with AI-powered SQL intelligence*

</div>