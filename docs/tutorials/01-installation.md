# Installation Tutorial

This tutorial walks you through installing and setting up the SQL MCP Server from start to finish.

## Prerequisites

### System Requirements

- **Node.js**: Version 16.0.0 or higher
- **npm**: Version 8.0.0 or higher 
- **Operating System**: Windows, macOS, or Linux
- **Memory**: At least 512MB RAM available
- **Disk Space**: 50MB for installation

### Supported Databases

The SQL MCP Server supports these database systems:

- **PostgreSQL** 11+ (including Amazon RDS, Google Cloud SQL, Azure Database)
- **MySQL** 5.7+ and MariaDB 10.3+ (including cloud variants)
- **SQLite** 3.x (including in-memory databases)
- **Microsoft SQL Server** 2016+ (including Azure SQL Database)

## Installation Methods

### Method 0: Automatic Installer (Easiest)

The fastest way to get started:

```bash
# Install the package
npm install -g sql-access

# Run the automatic installer
mcp-sql-install

# The installer automatically:
# 1. Detects Claude Code and Claude Desktop
# 2. Adds sql-access to their MCP configurations
# 3. Creates a default config.ini
```

After installation, add your databases using the `sql_add_database` MCP tool directly from Claude, or edit `~/.config/sql-access/config.ini`.

### Method 1: NPM Global Installation (Recommended)

Install globally for system-wide access:

```bash
# Install the SQL MCP Server globally
npm install -g sql-mcp-server

# Verify installation
mcp-sql-server --version
```

**Expected Output:**
```
SQL MCP Server v2.7.1
```

### Method 2: Local Project Installation

Install locally in a specific project:

```bash
# Create project directory
mkdir my-sql-mcp
cd my-sql-mcp

# Initialize npm project
npm init -y

# Install SQL MCP Server locally
npm install sql-mcp-server

# Verify installation
npx mcp-sql-server --version
```

### Method 3: Development Installation

For development or customization:

```bash
# Clone the repository
git clone https://github.com/AraneaDev/mcp-sql-access-server.git
cd mcp-sql-access-server

# Install dependencies
npm install

# Build the project
npm run build

# Run locally
npm start
```

## Initial Configuration

### Quick Setup with Interactive Wizard

The easiest way to configure the server is using the interactive setup wizard:

```bash
# Run the setup wizard
npm run setup
# or if globally installed:
mcp-sql-setup
```

The wizard will guide you through:

1. **Database Selection**: Choose your database type
2. **Connection Details**: Enter host, credentials, etc.
3. **Security Settings**: Configure access permissions
4. **SSH Tunneling**: Optional secure connections
5. **Extension Settings**: Performance and behavior options

### Example: PostgreSQL Setup

Here's what the interactive setup looks like for PostgreSQL:

```
 Claude SQL MCP Server Setup

=== Claude SQL Extension Configuration ===

Configuring database connection #1:
Database name (e.g., primary, analytics): production
Database type (postgresql/mysql/sqlite/mssql): postgresql
Database host: localhost
Database port (default: 5432): 5432
Database name: myapp
Username: readonly_user
Password: ********
Use SSL? (y/n): y
Use SSH tunnel? (y/n): n

--- Access Permissions ---
SELECT-only mode restricts this database to SELECT, WITH, SHOW, EXPLAIN, and DESCRIBE statements only.
This is recommended for production databases or read-only access scenarios.
Enable SELECT-only mode? (y/n): y

Connection timeout (ms, default: 30000): 30000
Add another database? (y/n): n

--- Extension Settings ---
Maximum rows per query (default: 1000): 1000
Query timeout (ms, default: 30000): 30000
Maximum queries in batch operations (default: 10): 10
Enable debug mode? (y/n): n

 Database 'production' configured with SELECT-only access
 Configuration saved to config.ini

Test database connections now? (y/n): y

--- Testing Connections ---
Testing production...
 Connected
 Schema captured: 15 tables, 127 columns
 Access mode: SELECT-only

 Configuration complete!
```

### Manual Configuration

You can also create the configuration file manually:

```bash
# Create config.ini file
cat > config.ini << 'EOF'
[database.primary]
type=postgresql
host=localhost
port=5432
database=myapp
username=readonly_user
password=your_password
ssl=true
select_only=true
timeout=30000

[security]
max_joins=10
max_subqueries=5
max_unions=3
max_group_bys=5
max_complexity_score=100
max_query_length=10000

[extension]
max_rows=1000
query_timeout=30000
max_batch_size=10
debug=false
EOF
```

## Verification Steps

### 1. Test Server Startup

```bash
# Start the server
mcp-sql-server
# or if installed locally:
npx mcp-sql-server
```

**Expected Output:**
```
 SQL MCP Server starting...
 Loaded 1 database configuration(s):
 - primary (postgresql, SELECT-only)
 Security manager initialized
 MCP Server listening on stdio
```

### 2. Test Database Connection

```bash
# Test connections (if server is running)
sql-test-connections
# or via setup:
mcp-sql-setup --test-only
```

**Expected Output:**
```
--- Testing Connections ---
Testing primary...
 Connected
 Schema captured: 15 tables, 127 columns
 Access mode: SELECT-only
```

### 3. Verify MCP Protocol

```bash
# Test MCP protocol communication
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | mcp-sql-server
```

**Expected Response:**
```json
{
 "jsonrpc": "2.0",
 "id": 1,
 "result": {
 "tools": [
 {
 "name": "sql_query",
 "description": "Execute SQL queries with safety validation"
 },
 {
 "name": "sql_list_databases",
 "description": "List all configured databases"
 }
 ]
 }
}
```

## Common Installation Issues

### Issue 1: Node.js Version

**Error:**
```
Error: Node.js version 14.x is not supported
```

**Solution:**
```bash
# Check Node.js version
node --version

# Install Node.js 16+ using nvm (Linux/macOS)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Or download from nodejs.org for Windows
```

### Issue 2: Permission Denied

**Error:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'
```

**Solution:**
```bash
# Fix npm permissions (Linux/macOS)
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}

# Or use npx instead of global install
npx sql-mcp-server
```

### Issue 3: Database Connection Failed

**Error:**
```
 Failed: Connection refused
```

**Solutions:**

1. **Check database is running:**
 ```bash
 # PostgreSQL
 sudo systemctl status postgresql
 
 # MySQL
 sudo systemctl status mysql
 
 # Check if port is open
 telnet localhost 5432
 ```

2. **Verify credentials:**
 ```sql
 -- Test connection manually
 psql -h localhost -U readonly_user -d myapp
 ```

3. **Check firewall settings:**
 ```bash
 # Allow database port through firewall
 sudo ufw allow 5432
 ```

### Issue 4: SSL Connection Issues

**Error:**
```
 Failed: SSL connection error
```

**Solutions:**

1. **Disable SSL for testing:**
 ```ini
 [database.primary]
 ssl=false
 ```

2. **Check server SSL configuration:**
 ```sql
 -- PostgreSQL: Check SSL settings
 SHOW ssl;
 ```

3. **Use self-signed certificate:**
 ```ini
 [database.primary]
 ssl=true
 # Server handles self-signed certificates automatically
 ```

## Configuration Templates

### Template 1: Development Setup

```ini
[database.dev]
type=sqlite
file=./dev_database.db
select_only=false
timeout=10000

[extension]
max_rows=100
query_timeout=10000
max_batch_size=5
debug=true

[security]
max_joins=5
max_subqueries=3
max_complexity_score=50
```

### Template 2: Production Setup

```ini
[database.prod]
type=postgresql
host=prod-db.company.com
port=5432
database=production
username=readonly_service
password=${DB_PASSWORD}
ssl=true
select_only=true
timeout=30000

[database.analytics]
type=mysql
host=analytics-db.company.com
port=3306
database=analytics
username=analytics_readonly
password=${ANALYTICS_PASSWORD}
ssl=true
select_only=true
timeout=15000

[security]
max_joins=10
max_subqueries=5
max_unions=3
max_group_bys=5
max_complexity_score=100
max_query_length=10000

[extension]
max_rows=1000
query_timeout=30000
max_batch_size=10
debug=false
```

### Template 3: SSH Tunnel Setup

```ini
[database.remote]
type=postgresql
host=internal-db.company.local
port=5432
database=production
username=app_user
password=db_password
ssl=true
select_only=true

# SSH Tunnel Configuration
ssh_host=bastion.company.com
ssh_port=22
ssh_username=deploy_user
ssh_private_key=/path/to/private/key
# ssh_passphrase=optional_key_passphrase

[security]
max_joins=10
max_subqueries=5
max_complexity_score=100

[extension]
max_rows=1000
query_timeout=60000
debug=false
```

## Environment Variables

### Using Environment Variables for Sensitive Data

```bash
# Set environment variables
export DB_PASSWORD="your_secure_password"
export ANALYTICS_PASSWORD="another_secure_password"

# Reference in config.ini
[database.prod]
password=${DB_PASSWORD}
```

### Supported Environment Variables

- `DB_PASSWORD` - Database password
- `DB_HOST` - Database host override
- `SSH_PRIVATE_KEY` - SSH private key path
- `NODE_ENV` - Environment mode (development/production)
- `DEBUG` - Enable debug output
- `CONFIG_PATH` - Custom configuration file path

## Starting the Server

### Development Mode

```bash
# Start with debug output
DEBUG=sql-mcp:* mcp-sql-server

# Start with custom config
mcp-sql-server --config=/path/to/custom/config.ini

# Start with environment override
NODE_ENV=development mcp-sql-server
```

### Production Mode

```bash
# Start as background service
nohup mcp-sql-server > server.log 2>&1 &

# Using systemd (Linux)
sudo systemctl start sql-mcp-server
sudo systemctl enable sql-mcp-server

# Using PM2 process manager
npm install -g pm2
pm2 start mcp-sql-server --name "sql-mcp"
pm2 startup
pm2 save
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy configuration
COPY config.ini ./

# Install SQL MCP Server
RUN npm install -g sql-mcp-server

# Expose port (if using HTTP mode)
EXPOSE 3000

# Start server
CMD ["mcp-sql-server"]
```

```bash
# Build and run
docker build -t sql-mcp-server .
docker run -d --name sql-mcp \
 -v $(pwd)/config.ini:/app/config.ini \
 sql-mcp-server
```

## Next Steps

After successful installation:

1. **Configure Claude Desktop Integration** -> [Claude Integration Tutorial](03-claude-integration.md)
2. **Learn Basic Query Operations** -> [Basic Queries Tutorial](04-basic-queries.md)
3. **Review Security Configuration** -> [Security Guide](../guides/security-guide.md)
4. **Explore Advanced Features** -> [Configuration Guide](../guides/configuration-guide.md)

## Command Reference

### Installation Commands
```bash
npm install -g sql-mcp-server # Global installation
npm install sql-mcp-server # Local installation
git clone <repo-url> # Development installation
```

### Configuration Commands
```bash
mcp-sql-setup # Interactive configuration
mcp-sql-setup --template=production # Generate template
mcp-sql-setup --config=/path/to/config.ini # Custom config path
```

### Server Commands
```bash
mcp-sql-server # Start server
mcp-sql-server --version # Show version
mcp-sql-server --help # Show help
sql-test-connections # Test database connections
```

### Installer Commands
```bash
mcp-sql-install # Automatic MCP installer
mcp-sql-install --client=claude-code # Install for Claude Code only
mcp-sql-install --uninstall # Remove from MCP configs
```

### Utility Commands
```bash
sql-validate-config # Validate configuration
sql-generate-schema # Generate database schema
sql-benchmark # Run performance benchmarks
```

## Getting Help

### Documentation Resources

- **[Configuration Guide](../guides/configuration-guide.md)** - Complete configuration reference
- **[Troubleshooting Guide](../guides/troubleshooting-guide.md)** - Common issues and solutions
- **[Security Guide](../guides/security-guide.md)** - Security best practices

### Community Support

- **GitHub Issues** - Bug reports and feature requests
- **GitHub Discussions** - Questions and community support
- **Documentation** - Comprehensive guides and examples

### Professional Support

- **Enterprise Support** - Priority support for commercial users
- **Consulting Services** - Custom deployment and integration
- **Training** - Team training and best practices

---

** Congratulations!** You've successfully installed the SQL MCP Server. Continue with the [Claude Integration Tutorial](03-claude-integration.md) to connect it with Claude Desktop.
