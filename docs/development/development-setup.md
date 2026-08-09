# Argos-MCP Development Environment Setup

## Overview

This guide provides a comprehensive development environment setup for contributing to the Argos-MCP project, including advanced developer tools, debugging configurations, and testing strategies.

## Quick Development Setup

### Prerequisites

- Node.js 18+ with npm or yarn
- Docker and Docker Compose
- Git with proper SSH keys
- VS Code or preferred IDE
- Database clients (psql, mysql, etc.)

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/AraneaDev/Argos-MCP.git
cd Argos-MCP

# Install dependencies
npm install

# Copy environment template
cp .env.template .env.development

# Generate development configuration
npm run setup:dev
```

### 2. Database Setup

```bash
# Start development databases with Docker
docker-compose -f docker/development.yml up -d

# Run database migrations
npm run db:migrate

# Seed test data
npm run db:seed
```

### 3. Start Development Server

```bash
# Start in development mode with hot reload
npm run dev

# Or with debug logging
npm run dev:debug

# Run with specific config
npm run dev -- --config config/development.ini
```

## Advanced Development Tools

### Enhanced Package.json Scripts

```json
{
 "scripts": {
 "dev": "nodemon --exec ts-node src/index.ts",
 "dev:debug": "nodemon --exec 'node --inspect-brk -r ts-node/register src/index.ts'",
 "dev:watch": "concurrently \"npm run build:watch\" \"npm run dev\"",
 "build": "tsc && npm run copy-assets",
 "build:watch": "tsc --watch",
 "build:prod": "tsc --project tsconfig.prod.json",
 "copy-assets": "copyfiles -u 1 'src/**/*.sql' 'src/**/*.json' dist/",
 "start": "node dist/index.js",
 "start:cluster": "node -r ./dist/cluster.js",
 
 "test": "jest",
 "test:watch": "jest --watch",
 "test:coverage": "jest --coverage",
 "test:integration": "jest --config jest.integration.config.js",
 "test:e2e": "jest --config jest.e2e.config.js",
 "test:performance": "jest --config jest.performance.config.js",
 "test:security": "npm run test:security:deps && npm run test:security:code",
 "test:security:deps": "npm audit --audit-level high",
 "test:security:code": "eslint --ext .ts src/ --config .eslintrc.security.js",
 
 "lint": "eslint --ext .ts,.js src/ tests/",
 "lint:fix": "eslint --ext .ts,.js src/ tests/ --fix",
 "lint:staged": "lint-staged",
 "format": "prettier --write \"src/**/*.{ts,js,json,md}\"",
 "format:check": "prettier --check \"src/**/*.{ts,js,json,md}\"",
 
 "setup:dev": "node scripts/setup-dev.js",
 "db:migrate": "node scripts/db-migrate.js",
 "db:seed": "node scripts/db-seed.js",
 "db:reset": "npm run db:migrate && npm run db:seed",
 "db:studio": "node scripts/db-studio.js",
 
 "docs:generate": "typedoc --out docs/api src/",
 "docs:serve": "http-server docs/ -p 8080",
 "docs:build": "vitepress build docs",
 
 "benchmark": "node scripts/benchmark.js",
 "profile": "node --prof dist/index.js",
 "profile:analyze": "node --prof-process isolate-*.log > profile.txt",
 
 "docker:build": "docker build -t argos-mcp .",
 "docker:run": "docker run -p 3000:3000 argos-mcp",
 "docker:test": "docker-compose -f docker/test.yml up --abort-on-container-exit",
 
 "release": "semantic-release",
 "release:dry": "semantic-release --dry-run",
 "version": "conventional-changelog -p angular -i CHANGELOG.md -s",
 
 "clean": "rimraf dist coverage .nyc_output *.log",
 "reset": "npm run clean && rm -rf node_modules && npm install"
 }
}
```

### VS Code Configuration

**.vscode/settings.json**:
```json
{
 "editor.formatOnSave": true,
 "editor.codeActionsOnSave": {
 "source.fixAll.eslint": true,
 "source.organizeImports": true
 },
 "editor.rulers": [80, 120],
 "editor.tabSize": 2,
 "editor.insertSpaces": true,
 "files.trimTrailingWhitespace": true,
 "files.insertFinalNewline": true,
 "typescript.preferences.importModuleSpecifier": "relative",
 "typescript.suggest.autoImports": true,
 "typescript.updateImportsOnFileMove.enabled": "always",
 "eslint.validate": ["typescript", "javascript"],
 "eslint.run": "onType",
 "search.exclude": {
 "**/node_modules": true,
 "**/dist": true,
 "**/coverage": true,
 "**/.git": true
 },
 "files.watcherExclude": {
 "**/node_modules/**": true,
 "**/dist/**": true,
 "**/coverage/**": true
 }
}
```

**.vscode/launch.json**:
```json
{
 "version": "0.2.0",
 "configurations": [
 {
 "name": "Debug Server",
 "type": "node",
 "request": "launch",
 "program": "${workspaceFolder}/src/index.ts",
 "env": {
 "NODE_ENV": "development",
 "DEBUG": "*"
 },
 "runtimeArgs": ["-r", "ts-node/register"],
 "sourceMaps": true,
 "restart": true,
 "protocol": "inspector",
 "console": "integratedTerminal",
 "internalConsoleOptions": "neverOpen"
 },
 {
 "name": "Debug Tests",
 "type": "node",
 "request": "launch",
 "program": "${workspaceFolder}/node_modules/.bin/jest",
 "args": ["--runInBand", "--no-cache", "--no-coverage"],
 "cwd": "${workspaceFolder}",
 "console": "integratedTerminal",
 "internalConsoleOptions": "neverOpen"
 },
 {
 "name": "Debug Current Test",
 "type": "node",
 "request": "launch",
 "program": "${workspaceFolder}/node_modules/.bin/jest",
 "args": ["--runInBand", "--no-cache", "${relativeFile}"],
 "cwd": "${workspaceFolder}",
 "console": "integratedTerminal",
 "internalConsoleOptions": "neverOpen"
 }
 ]
}
```

**.vscode/extensions.json**:
```json
{
 "recommendations": [
 "ms-vscode.vscode-typescript-next",
 "dbaeumer.vscode-eslint",
 "esbenp.prettier-vscode",
 "bradlc.vscode-tailwindcss",
 "ms-vscode.vscode-json",
 "redhat.vscode-yaml",
 "ms-python.python",
 "ms-vscode.vscode-docker",
 "github.copilot",
 "github.copilot-chat",
 "gruntfuggly.todo-tree",
 "christian-kohler.path-intellisense",
 "formulahendry.auto-rename-tag",
 "bradlc.vscode-tailwindcss"
 ]
}
```

### Advanced Testing Setup

**Jest Configuration (jest.config.js)**:
```javascript
module.exports = {
 preset: 'ts-jest',
 testEnvironment: 'node',
 roots: ['<rootDir>/src', '<rootDir>/tests'],
 testMatch: [
 '**/__tests__/**/*.test.ts',
 '**/?(*.)+(spec|test).ts'
 ],
 transform: {
 '^.+\\.ts$': 'ts-jest'
 },
 collectCoverageFrom: [
 'src/**/*.ts',
 '!src/**/*.d.ts',
 '!src/index.ts',
 '!src/setup.ts'
 ],
 coverageDirectory: 'coverage',
 coverageReporters: ['text', 'lcov', 'html'],
 coverageThreshold: {
 global: {
 branches: 80,
 functions: 80,
 lines: 80,
 statements: 80
 }
 },
 setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
 testTimeout: 10000,
 verbose: true,
 detectOpenHandles: true,
 forceExit: true,
 globalSetup: '<rootDir>/tests/global-setup.ts',
 globalTeardown: '<rootDir>/tests/global-teardown.ts'
};
```

**Performance Testing (jest.performance.config.js)**:
```javascript
module.exports = {
 ...require('./jest.config.js'),
 testMatch: ['**/?(*.)+(perf|performance).test.ts'],
 testTimeout: 30000,
 setupFilesAfterEnv: ['<rootDir>/tests/performance-setup.ts'],
 reporters: [
 'default',
 ['jest-html-reporters', {
 publicPath: './coverage/performance',
 filename: 'performance-report.html'
 }]
 ]
};
```

### Development Database Setup

**Docker Compose (docker/development.yml)**:
```yaml
version: '3.8'

services:
 postgres-dev:
 image: postgres:15-alpine
 container_name: argos-postgres-dev
 environment:
 POSTGRES_DB: mcp_development
 POSTGRES_USER: mcp_dev
 POSTGRES_PASSWORD: dev_password
 POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"
 ports:
 - "5432:5432"
 volumes:
 - postgres_dev_data:/var/lib/postgresql/data
 - ./sql/init:/docker-entrypoint-initdb.d
 networks:
 - mcp-dev-network

 mysql-dev:
 image: mysql:8.0
 container_name: argos-mysql-dev
 environment:
 MYSQL_ROOT_PASSWORD: root_password
 MYSQL_DATABASE: mcp_development
 MYSQL_USER: mcp_dev
 MYSQL_PASSWORD: dev_password
 ports:
 - "3306:3306"
 volumes:
 - mysql_dev_data:/var/lib/mysql
 - ./sql/mysql-init:/docker-entrypoint-initdb.d
 networks:
 - mcp-dev-network

 redis-dev:
 image: redis:7-alpine
 container_name: argos-redis-dev
 ports:
 - "6379:6379"
 volumes:
 - redis_dev_data:/data
 command: redis-server --appendonly yes
 networks:
 - mcp-dev-network

 pgadmin:
 image: dpage/pgadmin4
 container_name: argos-pgadmin
 environment:
 PGADMIN_DEFAULT_EMAIL: admin@local.dev
 PGADMIN_DEFAULT_PASSWORD: admin
 PGADMIN_CONFIG_SERVER_MODE: 'False'
 ports:
 - "8080:80"
 volumes:
 - pgadmin_data:/var/lib/pgadmin
 networks:
 - mcp-dev-network
 depends_on:
 - postgres-dev

 adminer:
 image: adminer
 container_name: argos-adminer
 ports:
 - "8081:8080"
 networks:
 - mcp-dev-network
 depends_on:
 - postgres-dev
 - mysql-dev

volumes:
 postgres_dev_data:
 mysql_dev_data:
 redis_dev_data:
 pgladmin_data:

networks:
 mcp-dev-network:
 driver: bridge
```

### Code Quality and Linting

**ESLint Configuration (.eslintrc.js)**:
```javascript
module.exports = {
 parser: '@typescript-eslint/parser',
 parserOptions: {
 ecmaVersion: 2022,
 sourceType: 'module',
 project: './tsconfig.json'
 },
 plugins: [
 '@typescript-eslint',
 'import',
 'security',
 'sonarjs',
 'unicorn'
 ],
 extends: [
 'eslint:recommended',
 '@typescript-eslint/recommended',
 '@typescript-eslint/recommended-requiring-type-checking',
 'plugin:import/recommended',
 'plugin:import/typescript',
 'plugin:security/recommended',
 'plugin:sonarjs/recommended',
 'plugin:unicorn/recommended'
 ],
 rules: {
 // TypeScript specific rules
 '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
 '@typescript-eslint/explicit-function-return-type': 'error',
 '@typescript-eslint/no-explicit-any': 'warn',
 '@typescript-eslint/prefer-nullish-coalescing': 'error',
 '@typescript-eslint/prefer-optional-chain': 'error',
 '@typescript-eslint/strict-boolean-expressions': 'error',
 
 // Import rules
 'import/order': ['error', {
 groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
 'newlines-between': 'always'
 }],
 'import/no-unresolved': 'error',
 'import/no-duplicates': 'error',
 
 // Security rules
 'security/detect-sql-injection': 'error',
 'security/detect-object-injection': 'error',
 'security/detect-non-literal-regexp': 'warn',
 
 // Code quality rules
 'sonarjs/cognitive-complexity': ['error', 15],
 'sonarjs/no-duplicate-string': ['error', 3],
 'complexity': ['error', 10],
 'max-lines-per-function': ['error', 50],
 'max-depth': ['error', 4],
 
 // General rules
 'no-console': 'warn',
 'no-debugger': 'error',
 'prefer-const': 'error',
 'no-var': 'error'
 },
 settings: {
 'import/resolver': {
 typescript: {
 alwaysTryTypes: true,
 project: './tsconfig.json'
 }
 }
 }
};
```

**Prettier Configuration (.prettierrc.js)**:
```javascript
module.exports = {
 semi: true,
 trailingComma: 'es5',
 singleQuote: true,
 printWidth: 80,
 tabWidth: 2,
 useTabs: false,
 quoteProps: 'as-needed',
 bracketSpacing: true,
 arrowParens: 'avoid',
 endOfLine: 'lf',
 embeddedLanguageFormatting: 'auto',
 overrides: [
 {
 files: '*.json',
 options: {
 printWidth: 120
 }
 },
 {
 files: '*.md',
 options: {
 printWidth: 100,
 proseWrap: 'always'
 }
 }
 ]
};
```

### Development Scripts

**Setup Development Environment (scripts/setup-dev.js)**:
```javascript
#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

async function setupDevelopmentEnvironment() {
 console.log(' Setting up Argos-MCP development environment...\n');

 try {
 // Check prerequisites
 await checkPrerequisites();
 
 // Create development configuration
 await createDevConfiguration();
 
 // Setup Git hooks
 await setupGitHooks();
 
 // Create development directories
 await createDirectories();
 
 // Initialize databases
 await initializeDatabases();
 
 // Install additional dev tools
 await installDevTools();
 
 console.log(' Development environment setup complete!');
 console.log('\nNext steps:');
 console.log('1. Start databases: docker-compose -f docker/development.yml up -d');
 console.log('2. Run migrations: npm run db:migrate');
 console.log('3. Start development server: npm run dev');
 
 } catch (error) {
 console.error(' Setup failed:', error.message);
 process.exit(1);
 }
}

async function checkPrerequisites() {
 console.log(' Checking prerequisites...');
 
 const requirements = [
 { command: 'node --version', name: 'Node.js' },
 { command: 'npm --version', name: 'npm' },
 { command: 'docker --version', name: 'Docker' },
 { command: 'docker-compose --version', name: 'Docker Compose' }
 ];

 for (const req of requirements) {
 try {
 const version = execSync(req.command, { encoding: 'utf8' });
 console.log(` ${req.name}: ${version.trim()}`);
 } catch (error) {
 throw new Error(`${req.name} is not installed or not in PATH`);
 }
 }
}

async function createDevConfiguration() {
 console.log(' Creating development configuration...');
 
 const devConfig = `
[server]
host=localhost
port=3000
environment=development
enable_tls=false

[database.postgres_dev]
type=postgresql
host=localhost
port=5432
database=mcp_development
username=mcp_dev
password=dev_password
readonly=false
pool_min=2
pool_max=10

[database.mysql_dev]
type=mysql
host=localhost
port=3306
database=mcp_development
username=mcp_dev
password=dev_password
readonly=false
pool_min=2
pool_max=10

[security]
enable_readonly_mode=false
max_query_complexity=1000
rate_limit_max_requests=1000
enable_audit_logging=false

[logging]
level=debug
format=text
enable_colors=true

[monitoring]
enable_metrics=true
metrics_port=9090

[caching]
enable_query_cache=true
redis_url=redis://localhost:6379
cache_ttl=300
`;

 await fs.writeFile('config/development.ini', devConfig.trim());
 console.log(' Development configuration created');
}

async function setupGitHooks() {
 console.log(' Setting up Git hooks...');
 
 const preCommitHook = `#!/bin/sh
# Pre-commit hook for Argos-MCP

echo "Running pre-commit checks..."

# Run linting
npm run lint
if [ $? -ne 0 ]; then
 echo " Linting failed"
 exit 1
fi

# Run type checking
npm run type-check
if [ $? -ne 0 ]; then
 echo " Type checking failed"
 exit 1
fi

# Run tests
npm run test:staged
if [ $? -ne 0 ]; then
 echo " Tests failed"
 exit 1
fi

echo " Pre-commit checks passed"
`;

 await fs.writeFile('.git/hooks/pre-commit', preCommitHook, { mode: 0o755 });
 console.log(' Git pre-commit hook installed');
}

async function createDirectories() {
 console.log(' Creating development directories...');
 
 const directories = [
 'logs/development',
 'data/cache',
 'data/sessions',
 'config/development',
 'scripts/dev-tools',
 'tests/fixtures',
 'docs/development'
 ];

 for (const dir of directories) {
 await fs.mkdir(dir, { recursive: true });
 }
 
 console.log(' Development directories created');
}

async function initializeDatabases() {
 console.log(' Initializing development databases...');
 
 try {
 execSync('docker-compose -f docker/development.yml up -d', { stdio: 'inherit' });
 
 // Wait for databases to be ready
 console.log(' [PENDING] Waiting for databases to start...');
 await new Promise(resolve => setTimeout(resolve, 10000));
 
 console.log(' Development databases initialized');
 } catch (error) {
 console.warn(' Database initialization skipped (Docker may not be running)');
 }
}

async function installDevTools() {
 console.log(' Installing additional development tools...');
 
 try {
 // Install global tools if not present
 const globalTools = [
 'nodemon',
 'ts-node',
 'typescript',
 '@types/node'
 ];
 
 for (const tool of globalTools) {
 try {
 execSync(`npm list -g ${tool}`, { stdio: 'ignore' });
 console.log(` ${tool} already installed`);
 } catch {
 execSync(`npm install -g ${tool}`, { stdio: 'inherit' });
 console.log(` ${tool} installed globally`);
 }
 }
 } catch (error) {
 console.warn(' Some dev tools installation skipped');
 }
}

// Run setup
if (require.main === module) {
 setupDevelopmentEnvironment();
}

module.exports = { setupDevelopmentEnvironment };
```

### Debugging and Profiling

**Performance Profiling Script (scripts/profile.js)**:
```javascript
#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class PerformanceProfiler {
 constructor() {
 this.profileDir = path.join(process.cwd(), 'profiles');
 this.ensureProfileDir();
 }

 ensureProfileDir() {
 if (!fs.existsSync(this.profileDir)) {
 fs.mkdirSync(this.profileDir, { recursive: true });
 }
 }

 async profileCPU(duration = 30000) {
 console.log(` Starting CPU profiling for ${duration}ms...`);
 
 const timestamp = Date.now();
 const profileFile = path.join(this.profileDir, `cpu-${timestamp}.prof`);
 
 const server = spawn('node', [
 '--prof',
 '--prof-process',
 'dist/index.js'
 ], {
 stdio: 'inherit',
 env: { ...process.env, NODE_ENV: 'production' }
 });

 // Stop profiling after duration
 setTimeout(() => {
 server.kill('SIGINT');
 }, duration);

 return new Promise((resolve, reject) => {
 server.on('close', (code) => {
 if (code === 0) {
 console.log(` CPU profile saved to ${profileFile}`);
 this.analyzeCPUProfile(profileFile);
 resolve(profileFile);
 } else {
 reject(new Error(`Profiling failed with code ${code}`));
 }
 });
 });
 }

 analyzeCPUProfile(profileFile) {
 console.log(' Analyzing CPU profile...');
 
 try {
 const analysisFile = profileFile.replace('.prof', '.txt');
 execSync(`node --prof-process ${profileFile} > ${analysisFile}`);
 
 console.log(` Analysis saved to ${analysisFile}`);
 
 // Extract top functions
 const analysis = fs.readFileSync(analysisFile, 'utf8');
 const lines = analysis.split('\n');
 const topFunctions = lines
 .filter(line => line.includes('ms'))
 .slice(0, 10);
 
 console.log('\n Top CPU consumers:');
 topFunctions.forEach(func => console.log(` ${func.trim()}`));
 
 } catch (error) {
 console.error(' Profile analysis failed:', error.message);
 }
 }

 async profileMemory() {
 console.log(' Starting memory profiling...');
 
 const { performance, PerformanceObserver } = require('perf_hooks');
 
 const obs = new PerformanceObserver((list) => {
 const entries = list.getEntries();
 entries.forEach((entry) => {
 console.log(`${entry.name}: ${entry.duration}ms`);
 });
 });
 
 obs.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
 
 // Monitor memory usage
 const memoryInterval = setInterval(() => {
 const usage = process.memoryUsage();
 console.log('Memory Usage:', {
 rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
 heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
 heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
 external: `${Math.round(usage.external / 1024 / 1024)}MB`
 });
 }, 5000);

 // Stop after 1 minute
 setTimeout(() => {
 clearInterval(memoryInterval);
 obs.disconnect();
 console.log(' Memory profiling completed');
 }, 60000);
 }

 async profileQueries() {
 console.log(' Starting query performance profiling...');
 
 // This would integrate with the actual MCP server
 // to profile database query performance
 const timestamp = Date.now();
 const logFile = path.join(this.profileDir, `queries-${timestamp}.log`);
 
 console.log(` Query performance data will be logged to ${logFile}`);
 
 // Enable query logging in the server
 process.env.ENABLE_QUERY_PROFILING = 'true';
 process.env.QUERY_LOG_FILE = logFile;
 }
}

// CLI interface
if (require.main === module) {
 const profiler = new PerformanceProfiler();
 const command = process.argv[2];
 
 switch (command) {
 case 'cpu':
 profiler.profileCPU(parseInt(process.argv[3]) || 30000);
 break;
 case 'memory':
 profiler.profileMemory();
 break;
 case 'queries':
 profiler.profileQueries();
 break;
 default:
 console.log('Usage: node scripts/profile.js <cpu|memory|queries> [duration]');
 break;
 }
}
```

## Development Workflow

### Daily Development Process

1. **Morning Setup**:
 ```bash
 git pull origin main
 npm install # If package.json changed
 docker-compose -f docker/development.yml up -d
 npm run db:migrate # If schema changed
 ```

2. **Feature Development**:
 ```bash
 git checkout -b feature/new-feature
 npm run dev # Start development server
 # Make changes...
 npm run test:watch # Run tests continuously
 ```

3. **Code Quality Checks**:
 ```bash
 npm run lint:fix
 npm run format
 npm run test:coverage
 npm run build
 ```

4. **Commit and Push**:
 ```bash
 git add .
 git commit -m "feat: add new feature"
 git push origin feature/new-feature
 ```

### Debugging Common Issues

**Database Connection Issues**:
```bash
# Check database status
docker-compose -f docker/development.yml ps

# View database logs
docker-compose -f docker/development.yml logs postgres-dev

# Reset database
docker-compose -f docker/development.yml down -v
docker-compose -f docker/development.yml up -d
```

**TypeScript Compilation Errors**:
```bash
# Check TypeScript config
npx tsc --showConfig

# Full type check
npx tsc --noEmit

# Clean and rebuild
npm run clean && npm run build
```

**Port Conflicts**:
```bash
# Find processes using ports
lsof -i :3000
lsof -i :5432

# Kill processes
kill -9 <PID>
```

## Contributing Guidelines

### Code Style

- Use TypeScript with strict type checking
- Follow ESLint and Prettier configurations
- Write comprehensive tests for new features
- Document complex functions with JSDoc
- Use semantic commit messages

### Pull Request Process

1. Create feature branch from main
2. Implement feature with tests
3. Update documentation
4. Run full test suite
5. Create pull request with description
6. Address code review feedback
7. Merge after approval

### Testing Standards

- Unit tests for all business logic
- Integration tests for database operations
- End-to-end tests for complete workflows
- Performance tests for critical paths
- Security tests for input validation

This development setup provides a comprehensive environment for contributing to the Argos-MCP with modern tooling, automated quality checks, and debugging capabilities.
