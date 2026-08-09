# Argos-MCP Performance Tuning Guide

## Overview

This comprehensive guide covers performance optimization strategies for the Argos-MCP, including query optimization, connection management, memory tuning, and system-level optimizations.

## Performance Architecture

```
+-----------------+ +------------------+ +-----------------+
| Client |----| Load Balancer |----| MCP Cluster |
| (Claude) | | (Connection | | (Optimized) |
\-----------------+ | Pooling) | \-----------------+
 \------------------+ |
 |
 +-----------------+ +-----------------+ |
 | Query Cache |----| Connection |----+
 | (Redis) | | Pool |
 \-----------------+ \-----------------+
 |
 +---------------------------------+-----------------+
 | Database Cluster |
 | +---------+ +---------+ +---------+ |
 | |Primary |--|Replica 1| |Replica 2| |
 | | (Write) | | (Read) | | (Read) | |
 | \---------+ \---------+ \---------+ |
 \---------------------------------------------------+
```

## Query Performance Optimization

### Query Analysis and Profiling

```typescript
// Query performance analyzer
export class QueryPerformanceAnalyzer {
 private slowQueryThreshold: number = 1000; // ms
 private complexityThreshold: number = 100;
 
 async analyzeQuery(
 database: string, 
 query: string, 
 executionTime: number
 ): Promise<QueryAnalysis> {
 const analysis: QueryAnalysis = {
 query_hash: this.hashQuery(query),
 execution_time: executionTime,
 complexity_score: await this.calculateComplexity(query),
 recommendations: []
 };

 // Performance recommendations
 if (executionTime > this.slowQueryThreshold) {
 analysis.recommendations.push('Consider query optimization or indexing');
 }

 if (analysis.complexity_score > this.complexityThreshold) {
 analysis.recommendations.push('Query complexity exceeds threshold');
 }

 // Specific optimization suggestions
 analysis.recommendations.push(...this.getOptimizationSuggestions(query));

 return analysis;
 }

 private getOptimizationSuggestions(query: string): string[] {
 const suggestions: string[] = [];
 const upperQuery = query.toUpperCase();

 // Check for common anti-patterns
 if (upperQuery.includes('SELECT *')) {
 suggestions.push('Avoid SELECT * - specify required columns');
 }

 if (upperQuery.includes('LIKE \'%')) {
 suggestions.push('Leading wildcards prevent index usage');
 }

 if (upperQuery.includes('ORDER BY') && !upperQuery.includes('LIMIT')) {
 suggestions.push('Consider adding LIMIT to ORDER BY queries');
 }

 if ((upperQuery.match(/JOIN/g) || []).length > 3) {
 suggestions.push('Complex joins detected - consider query restructuring');
 }

 if (upperQuery.includes('DISTINCT') && upperQuery.includes('ORDER BY')) {
 suggestions.push('DISTINCT with ORDER BY may be inefficient');
 }

 return suggestions;
 }

 private async calculateComplexity(query: string): Promise<number> {
 let score = 0;
 const upperQuery = query.toUpperCase();

 // Base complexity factors
 score += (upperQuery.match(/SELECT/g) || []).length * 1;
 score += (upperQuery.match(/FROM/g) || []).length * 2;
 score += (upperQuery.match(/JOIN/g) || []).length * 5;
 score += (upperQuery.match(/WHERE/g) || []).length * 2;
 score += (upperQuery.match(/GROUP BY/g) || []).length * 3;
 score += (upperQuery.match(/ORDER BY/g) || []).length * 2;
 score += (upperQuery.match(/HAVING/g) || []).length * 4;
 score += (upperQuery.match(/UNION/g) || []).length * 6;
 score += (upperQuery.match(/SUBQUERY|EXISTS|IN \(/gi) || []).length * 8;

 return score;
 }
}
```

### Query Caching Implementation

```typescript
// Redis-based query cache
export class QueryCache {
 private redis: Redis;
 private defaultTTL: number = 300; // 5 minutes
 
 constructor(redisConfig: RedisConfig) {
 this.redis = new Redis(redisConfig);
 }

 async get(queryHash: string): Promise<QueryResult | null> {
 try {
 const cached = await this.redis.get(`query:${queryHash}`);
 if (cached) {
 const result = JSON.parse(cached);
 // Update hit metrics
 queryMetrics.cacheHits.inc({ status: 'hit' });
 return result;
 }
 
 queryMetrics.cacheHits.inc({ status: 'miss' });
 return null;
 } catch (error) {
 logger.error('Cache retrieval error', { error, queryHash });
 return null;
 }
 }

 async set(
 queryHash: string, 
 result: QueryResult, 
 ttl: number = this.defaultTTL
 ): Promise<void> {
 try {
 await this.redis.setex(
 `query:${queryHash}`, 
 ttl, 
 JSON.stringify(result)
 );
 
 queryMetrics.cacheOps.inc({ operation: 'set' });
 } catch (error) {
 logger.error('Cache storage error', { error, queryHash });
 }
 }

 async invalidate(pattern: string): Promise<void> {
 try {
 const keys = await this.redis.keys(`query:${pattern}`);
 if (keys.length > 0) {
 await this.redis.del(...keys);
 queryMetrics.cacheOps.inc({ operation: 'invalidate' });
 }
 } catch (error) {
 logger.error('Cache invalidation error', { error, pattern });
 }
 }

 // Smart TTL based on query characteristics
 calculateTTL(query: string, complexity: number): number {
 const baseTime = this.defaultTTL;
 
 // Longer cache for complex, read-only queries
 if (complexity > 50 && this.isReadOnlyQuery(query)) {
 return baseTime * 4; // 20 minutes
 }
 
 // Shorter cache for simple queries
 if (complexity < 10) {
 return baseTime / 2; // 2.5 minutes
 }
 
 return baseTime;
 }

 private isReadOnlyQuery(query: string): boolean {
 const upperQuery = query.trim().toUpperCase();
 return upperQuery.startsWith('SELECT') && 
 !upperQuery.includes('FOR UPDATE');
 }
}
```

### Connection Load Balancing (continued)

```typescript
// Read replica load balancer (continued)
export class ReadReplicaLoadBalancer {
 private readPools: Map<string, Pool[]> = new Map();
 private currentIndex = new Map<string, number>();
 private healthStatus = new Map<string, boolean[]>();

 addReadReplica(database: string, pool: Pool): void {
 if (!this.readPools.has(database)) {
 this.readPools.set(database, []);
 this.healthStatus.set(database, []);
 this.currentIndex.set(database, 0);
 }

 const pools = this.readPools.get(database)!;
 const health = this.healthStatus.get(database)!;
 
 pools.push(pool);
 health.push(true);

 // Start health monitoring for this replica
 this.startHealthMonitoring(database, pools.length - 1);
 }

 async getConnection(database: string): Promise<Connection> {
 const pools = this.readPools.get(database);
 if (!pools || pools.length === 0) {
 throw new Error(`No read replicas available for database: ${database}`);
 }

 // Try to get healthy connection using round-robin
 let attempts = 0;
 while (attempts < pools.length) {
 const index = this.getNextHealthyIndex(database);
 if (index === -1) {
 throw new Error(`No healthy read replicas for database: ${database}`);
 }

 try {
 const connection = await pools[index].acquire();
 connectionMetrics.active.inc({ 
 database: `${database}_replica_${index}` 
 });
 return connection;
 } catch (error) {
 logger.warn('Failed to acquire connection from replica', { 
 database, 
 replica: index, 
 error 
 });
 
 // Mark replica as unhealthy
 this.healthStatus.get(database)![index] = false;
 attempts++;
 }
 }

 throw new Error(`All read replicas unhealthy for database: ${database}`);
 }

 private getNextHealthyIndex(database: string): number {
 const health = this.healthStatus.get(database)!;
 const currentIdx = this.currentIndex.get(database)!;
 
 // Find next healthy replica using round-robin
 for (let i = 0; i < health.length; i++) {
 const index = (currentIdx + i) % health.length;
 if (health[index]) {
 this.currentIndex.set(database, (index + 1) % health.length);
 return index;
 }
 }
 
 return -1; // No healthy replicas
 }

 private startHealthMonitoring(database: string, replicaIndex: number): void {
 const pools = this.readPools.get(database)!;
 const pool = pools[replicaIndex];
 
 setInterval(async () => {
 try {
 const connection = await pool.acquire();
 await connection.query('SELECT 1');
 await pool.release(connection);
 
 // Mark as healthy
 this.healthStatus.get(database)![replicaIndex] = true;
 } catch (error) {
 // Mark as unhealthy
 this.healthStatus.get(database)![replicaIndex] = false;
 logger.warn('Read replica health check failed', { 
 database, 
 replica: replicaIndex, 
 error 
 });
 }
 }, 30000); // Check every 30 seconds
 }
}
```

## Memory Management and Optimization

### Node.js Memory Tuning

```typescript
// Memory management utilities
export class MemoryManager {
 private gcMetrics = new Map<string, number>();
 private heapSnapshots: HeapSnapshot[] = [];
 private maxSnapshots = 10;

 constructor() {
 this.setupGCMonitoring();
 this.setupMemoryAlerts();
 }

 private setupGCMonitoring(): void {
 // Monitor garbage collection
 if (global.gc) {
 const originalGC = global.gc;
 global.gc = () => {
 const start = process.hrtime();
 originalGC();
 const [seconds, nanoseconds] = process.hrtime(start);
 const gcTime = seconds * 1000 + nanoseconds / 1e6;
 
 this.gcMetrics.set('lastGcTime', gcTime);
 systemMetrics.gc.inc({ type: 'manual' });
 
 logger.debug('Manual GC completed', { gcTime });
 };
 }

 // Automatic GC monitoring with v8 hooks
 const v8 = require('v8');
 if (v8.getHeapStatistics) {
 setInterval(() => {
 const stats = v8.getHeapStatistics();
 
 systemMetrics.memory.set(
 { type: 'heapUsed' }, 
 stats.used_heap_size
 );
 systemMetrics.memory.set(
 { type: 'heapTotal' }, 
 stats.total_heap_size
 );
 systemMetrics.memory.set(
 { type: 'heapAvailable' }, 
 stats.total_available_size
 );
 
 // Check for memory pressure
 const heapUsedPercent = stats.used_heap_size / stats.heap_size_limit;
 if (heapUsedPercent > 0.9) {
 this.handleMemoryPressure();
 }
 }, 5000);
 }
 }

 private setupMemoryAlerts(): void {
 setInterval(() => {
 const memUsage = process.memoryUsage();
 const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
 
 if (heapPercent > 85) {
 logger.warn('High memory usage detected', { 
 heapPercent: heapPercent.toFixed(2),
 heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
 heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
 });
 
 // Trigger optimization strategies
 this.optimizeMemoryUsage();
 }
 }, 10000);
 }

 private handleMemoryPressure(): void {
 logger.warn('Memory pressure detected, triggering optimizations');
 
 // Clear caches
 this.clearCaches();
 
 // Force garbage collection if available
 if (global.gc) {
 global.gc();
 }
 
 // Reduce connection pool sizes temporarily
 this.reduceConnectionPools();
 }

 private optimizeMemoryUsage(): void {
 // Clear query result caches older than 5 minutes
 this.clearExpiredCaches();
 
 // Optimize prepared statement cache
 this.optimizePreparedStatements();
 
 // Clear old heap snapshots
 if (this.heapSnapshots.length > this.maxSnapshots / 2) {
 this.heapSnapshots = this.heapSnapshots.slice(-this.maxSnapshots / 2);
 }
 }

 async takeHeapSnapshot(): Promise<string> {
 const v8 = require('v8');
 const fs = require('fs').promises;
 
 const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
 const filename = `heap-${timestamp}.heapsnapshot`;
 const filepath = `./logs/${filename}`;
 
 try {
 const snapshot = v8.getHeapSnapshot();
 const chunks: Buffer[] = [];
 
 for await (const chunk of snapshot) {
 chunks.push(chunk);
 }
 
 await fs.writeFile(filepath, Buffer.concat(chunks));
 
 this.heapSnapshots.push({
 timestamp: new Date(),
 filename,
 size: Buffer.concat(chunks).length
 });
 
 // Clean old snapshots
 if (this.heapSnapshots.length > this.maxSnapshots) {
 const oldSnapshot = this.heapSnapshots.shift()!;
 try {
 await fs.unlink(`./logs/${oldSnapshot.filename}`);
 } catch (error) {
 logger.warn('Failed to delete old heap snapshot', { error });
 }
 }
 
 logger.info('Heap snapshot taken', { filename, filepath });
 return filepath;
 } catch (error) {
 logger.error('Failed to take heap snapshot', { error });
 throw error;
 }
 }

 getMemoryStats(): MemoryStats {
 const memUsage = process.memoryUsage();
 const v8 = require('v8');
 const heapStats = v8.getHeapStatistics();
 
 return {
 process: {
 rss: memUsage.rss,
 heapTotal: memUsage.heapTotal,
 heapUsed: memUsage.heapUsed,
 external: memUsage.external,
 arrayBuffers: memUsage.arrayBuffers
 },
 v8: {
 totalHeapSize: heapStats.total_heap_size,
 totalHeapSizeExecutable: heapStats.total_heap_size_executable,
 totalPhysicalSize: heapStats.total_physical_size,
 totalAvailableSize: heapStats.total_available_size,
 usedHeapSize: heapStats.used_heap_size,
 heapSizeLimit: heapStats.heap_size_limit
 },
 gc: {
 lastGcTime: this.gcMetrics.get('lastGcTime') || 0
 }
 };
 }
}
```

### Buffer and Stream Optimization

```typescript
// Optimized result streaming
export class ResultStreamOptimizer {
 private chunkSize: number = 1000;
 private maxBufferSize: number = 10 * 1024 * 1024; // 10MB
 
 async streamLargeResult(
 query: string, 
 connection: Connection
 ): Promise<Readable> {
 const stream = new Readable({
 objectMode: true,
 highWaterMark: this.chunkSize
 });

 let totalSize = 0;
 let rowCount = 0;
 
 try {
 const cursor = connection.query(query).stream();
 
 cursor.on('data', (row: any) => {
 const rowSize = this.estimateRowSize(row);
 
 // Check buffer limits
 if (totalSize + rowSize > this.maxBufferSize) {
 logger.warn('Result size exceeds buffer limit', { 
 totalSize, 
 maxBufferSize: this.maxBufferSize 
 });
 cursor.pause();
 
 // Implement backpressure
 stream.once('drain', () => {
 cursor.resume();
 });
 }
 
 totalSize += rowSize;
 rowCount++;
 
 stream.push({
 data: row,
 metadata: {
 rowNumber: rowCount,
 estimatedSize: rowSize
 }
 });
 });

 cursor.on('end', () => {
 stream.push(null); // End stream
 logger.info('Result stream completed', { 
 rowCount, 
 totalSize 
 });
 });

 cursor.on('error', (error: Error) => {
 stream.emit('error', error);
 });

 } catch (error) {
 stream.emit('error', error);
 }

 return stream;
 }

 private estimateRowSize(row: any): number {
 return JSON.stringify(row).length * 2; // Rough UTF-16 estimate
 }

 // Batch processing for large operations
 async processBatch<T>(
 items: T[], 
 processor: (batch: T[]) => Promise<void>,
 batchSize: number = 100
 ): Promise<void> {
 const totalBatches = Math.ceil(items.length / batchSize);
 
 for (let i = 0; i < totalBatches; i++) {
 const start = i * batchSize;
 const end = Math.min(start + batchSize, items.length);
 const batch = items.slice(start, end);
 
 try {
 await processor(batch);
 
 // Allow event loop to process other tasks
 await new Promise(resolve => setImmediate(resolve));
 
 } catch (error) {
 logger.error('Batch processing error', { 
 batch: i + 1, 
 totalBatches, 
 error 
 });
 throw error;
 }
 }
 }
}
```

## System-Level Optimizations

### Operating System Tuning

**Linux System Configuration**:
```bash
#!/bin/bash
# system-optimization.sh

# TCP/IP optimizations
echo "# Argos-MCP optimizations" >> /etc/sysctl.conf
echo "net.core.somaxconn = 65535" >> /etc/sysctl.conf
echo "net.core.netdev_max_backlog = 5000" >> /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 65535" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_time = 600" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_intvl = 60" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_probes = 10" >> /etc/sysctl.conf

# Memory optimizations
echo "vm.swappiness = 10" >> /etc/sysctl.conf
echo "vm.dirty_ratio = 15" >> /etc/sysctl.conf
echo "vm.dirty_background_ratio = 5" >> /etc/sysctl.conf

# File descriptor limits
echo "fs.file-max = 2097152" >> /etc/sysctl.conf
echo "argos soft nofile 65536" >> /etc/security/limits.conf
echo "argos hard nofile 65536" >> /etc/security/limits.conf

# Apply changes
sysctl -p
```

### Node.js Runtime Optimization

```bash
#!/bin/bash
# node-optimization.sh

# Memory settings
export NODE_OPTIONS="--max-old-space-size=4096"
export NODE_OPTIONS="$NODE_OPTIONS --max-semi-space-size=128"

# Garbage collection tuning
export NODE_OPTIONS="$NODE_OPTIONS --expose-gc"
export NODE_OPTIONS="$NODE_OPTIONS --optimize-for-size"

# V8 optimizations
export NODE_OPTIONS="$NODE_OPTIONS --max-inlined-source-size=600"
export NODE_OPTIONS="$NODE_OPTIONS --max-inlined-bytecode-size=200"

# Event loop tuning
export UV_THREADPOOL_SIZE=16

# Enable performance profiling
export NODE_OPTIONS="$NODE_OPTIONS --prof"
export NODE_OPTIONS="$NODE_OPTIONS --trace-gc"
```

### Container Optimizations

**Optimized Dockerfile**:
```dockerfile
# Multi-stage build for optimal image size
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --no-audit --no-fund

FROM node:18-alpine AS runtime

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
 adduser -S argos -u 1001 -G nodejs

# System optimizations
RUN apk add --no-cache \
 dumb-init \
 tini && \
 rm -rf /var/cache/apk/*

WORKDIR /app

# Copy optimized node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=argos:nodejs . .

# Performance settings
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048 --optimize-for-size"
ENV UV_THREADPOOL_SIZE=16

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
 CMD node healthcheck.js

USER argos
EXPOSE 3000

# Use tini for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
```

### Database-Specific Optimizations

**PostgreSQL Optimizations**:
```sql
-- Connection settings
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;

-- Query optimization
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '4MB';

-- Connection pooling
ALTER SYSTEM SET max_prepared_transactions = 100;

SELECT pg_reload_conf();
```

**MySQL Optimizations**:
```sql
-- Connection and cache settings
SET GLOBAL max_connections = 500;
SET GLOBAL table_open_cache = 2000;
SET GLOBAL table_definition_cache = 1400;
SET GLOBAL query_cache_size = 128M;
SET GLOBAL query_cache_type = ON;

-- Buffer settings
SET GLOBAL innodb_buffer_pool_size = 1G;
SET GLOBAL innodb_log_file_size = 256M;
SET GLOBAL innodb_log_buffer_size = 16M;
SET GLOBAL innodb_flush_log_at_trx_commit = 2;

-- Connection timeout settings
SET GLOBAL wait_timeout = 600;
SET GLOBAL interactive_timeout = 600;
```

## Performance Monitoring and Benchmarking

### Automated Performance Testing

```typescript
// Performance benchmark suite
export class PerformanceBenchmark {
 private results: BenchmarkResult[] = [];
 
 async runBenchmarkSuite(): Promise<BenchmarkReport> {
 const report: BenchmarkReport = {
 timestamp: new Date(),
 results: [],
 summary: {
 totalTests: 0,
 passed: 0,
 failed: 0,
 averageResponseTime: 0
 }
 };

 // Query performance tests
 await this.benchmarkQueryPerformance(report);
 
 // Connection pool tests
 await this.benchmarkConnectionPool(report);
 
 // Memory usage tests
 await this.benchmarkMemoryUsage(report);
 
 // Concurrent load tests
 await this.benchmarkConcurrentLoad(report);
 
 this.generateReport(report);
 return report;
 }

 private async benchmarkQueryPerformance(report: BenchmarkReport): Promise<void> {
 const testQueries = [
 { name: 'Simple SELECT', query: 'SELECT 1', expectedTime: 10 },
 { name: 'Complex JOIN', query: 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id LIMIT 100', expectedTime: 100 },
 { name: 'Aggregation', query: 'SELECT COUNT(*), AVG(amount) FROM orders GROUP BY status', expectedTime: 200 }
 ];

 for (const test of testQueries) {
 const start = process.hrtime();
 
 try {
 await this.executeQuery(test.query);
 const [seconds, nanoseconds] = process.hrtime(start);
 const executionTime = seconds * 1000 + nanoseconds / 1e6;
 
 const result: BenchmarkResult = {
 name: test.name,
 category: 'query_performance',
 executionTime,
 success: executionTime <= test.expectedTime,
 expectedTime: test.expectedTime,
 metadata: { query: test.query }
 };
 
 report.results.push(result);
 report.summary.totalTests++;
 
 if (result.success) {
 report.summary.passed++;
 } else {
 report.summary.failed++;
 }
 
 } catch (error) {
 report.results.push({
 name: test.name,
 category: 'query_performance',
 executionTime: -1,
 success: false,
 error: error.message,
 expectedTime: test.expectedTime
 });
 
 report.summary.totalTests++;
 report.summary.failed++;
 }
 }
 }

 private async benchmarkConcurrentLoad(report: BenchmarkReport): Promise<void> {
 const concurrencyLevels = [10, 50, 100, 200];
 const testQuery = 'SELECT * FROM users LIMIT 10';
 
 for (const concurrency of concurrencyLevels) {
 const promises: Promise<number>[] = [];
 const startTime = process.hrtime();
 
 // Create concurrent requests
 for (let i = 0; i < concurrency; i++) {
 promises.push(this.timeQuery(testQuery));
 }
 
 try {
 const results = await Promise.all(promises);
 const [totalSeconds, totalNanos] = process.hrtime(startTime);
 const totalTime = totalSeconds * 1000 + totalNanos / 1e6;
 
 const avgResponseTime = results.reduce((sum, time) => sum + time, 0) / results.length;
 const throughput = (concurrency / totalTime) * 1000; // requests per second
 
 report.results.push({
 name: `Concurrent Load (${concurrency} requests)`,
 category: 'load_testing',
 executionTime: totalTime,
 success: avgResponseTime < 1000, // 1 second threshold
 metadata: {
 concurrency,
 avgResponseTime,
 throughput,
 minTime: Math.min(...results),
 maxTime: Math.max(...results)
 }
 });
 
 } catch (error) {
 report.results.push({
 name: `Concurrent Load (${concurrency} requests)`,
 category: 'load_testing',
 executionTime: -1,
 success: false,
 error: error.message
 });
 }
 }
 }

 private generateReport(report: BenchmarkReport): void {
 const totalTime = report.results.reduce((sum, r) => sum + (r.executionTime > 0 ? r.executionTime : 0), 0);
 report.summary.averageResponseTime = totalTime / report.results.filter(r => r.executionTime > 0).length;
 
 // Log summary
 logger.info('Performance benchmark completed', {
 totalTests: report.summary.totalTests,
 passed: report.summary.passed,
 failed: report.summary.failed,
 successRate: (report.summary.passed / report.summary.totalTests * 100).toFixed(2) + '%',
 averageResponseTime: report.summary.averageResponseTime.toFixed(2) + 'ms'
 });

 // Save detailed report
 const fs = require('fs').promises;
 const reportPath = `./logs/benchmark-${Date.now()}.json`;
 fs.writeFile(reportPath, JSON.stringify(report, null, 2))
 .then(() => logger.info('Benchmark report saved', { reportPath }))
 .catch(error => logger.error('Failed to save benchmark report', { error }));
 }
}
```

## Best Practices Summary

### Query Optimization Checklist

- [ ] Use specific column names instead of SELECT *
- [ ] Add appropriate indexes for frequently queried columns
- [ ] Use LIMIT clauses for large result sets
- [ ] Optimize JOIN operations and order
- [ ] Use prepared statements for repeated queries
- [ ] Implement query result caching
- [ ] Monitor and analyze slow queries
- [ ] Use EXPLAIN plans to understand query execution

### Connection Management Best Practices

- [ ] Configure optimal pool sizes based on system resources
- [ ] Implement connection health monitoring
- [ ] Use read replicas for read-heavy workloads
- [ ] Set appropriate connection timeouts
- [ ] Monitor connection pool metrics
- [ ] Implement connection retry logic
- [ ] Use connection validation queries

### Memory Management Best Practices

- [ ] Set appropriate Node.js heap size limits
- [ ] Monitor memory usage and garbage collection
- [ ] Implement memory leak detection
- [ ] Use streaming for large result sets
- [ ] Clear caches periodically
- [ ] Optimize object creation and retention
- [ ] Take heap snapshots for analysis

### System-Level Best Practices

- [ ] Optimize OS-level network settings
- [ ] Configure appropriate file descriptor limits
- [ ] Use container resource limits
- [ ] Monitor system-level metrics
- [ ] Implement proper logging and alerting
- [ ] Regular performance testing and benchmarking
- [ ] Capacity planning and scaling strategies

## Conclusion

Performance optimization is an ongoing process that requires regular monitoring, testing, and adjustment. This guide provides the foundation for implementing comprehensive performance improvements across all layers of the Argos-MCP stack.

Regular benchmarking and performance analysis ensure the system continues to meet performance requirements as load and usage patterns evolve.
