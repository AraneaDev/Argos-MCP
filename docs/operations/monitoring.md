# Argos-MCP Monitoring Guide

## Overview

This guide covers comprehensive monitoring strategies for the Argos-MCP, including metrics collection, alerting, log analysis, and performance tracking.

## Monitoring Architecture

```
+-------------+ +--------------+ +-------------+
| Grafana |----| Prometheus |----| Alerts |
| Dashboards | | Metrics | | Manager |
\-------------+ \--------------+ \-------------+
 |
 v
 +---------------------------------+
 | MCP Server Cluster |
 | +--------+ +--------+ +--------+|
 | | MCP-1 | | MCP-2 | | MCP-3 ||
 | \--------+ \--------+ \--------+|
 \---------------------------------+
 |
 v
 +---------------------------------+
 | ELK Stack |
 | +---------+ +---------+ +---------+|
 | |Elasticsearch| |Logstash | | Kibana ||
 | \---------+ \---------+ \---------+|
 \---------------------------------+
```

## Metrics Collection

### Application Metrics

**Core Performance Metrics**:

```typescript
import promClient from 'prom-client';

// Create registry
const register = new promClient.Registry();

// Query metrics
export const queryMetrics = {
 total: new promClient.Counter({
 name: 'sql_queries_total',
 help: 'Total number of SQL queries executed',
 labelNames: ['database', 'status', 'query_type'],
 registers: [register]
 }),

 duration: new promClient.Histogram({
 name: 'sql_query_duration_seconds',
 help: 'SQL query execution time in seconds',
 labelNames: ['database', 'query_type'],
 buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10],
 registers: [register]
 }),

 errors: new promClient.Counter({
 name: 'sql_query_errors_total',
 help: 'Total number of SQL query errors',
 labelNames: ['database', 'error_type'],
 registers: [register]
 }),

 complexity: new promClient.Histogram({
 name: 'sql_query_complexity_score',
 help: 'SQL query complexity analysis score',
 labelNames: ['database'],
 buckets: [1, 10, 25, 50, 100, 200, 500],
 registers: [register]
 })
};

// Connection metrics
export const connectionMetrics = {
 active: new promClient.Gauge({
 name: 'sql_connections_active',
 help: 'Number of active database connections',
 labelNames: ['database'],
 registers: [register]
 }),

 pool: new promClient.Gauge({
 name: 'sql_connection_pool_size',
 help: 'Current connection pool size',
 labelNames: ['database', 'status'],
 registers: [register]
 }),

 failures: new promClient.Counter({
 name: 'sql_connection_failures_total',
 help: 'Total connection failures',
 labelNames: ['database', 'reason'],
 registers: [register]
 })
};

// Security metrics
export const securityMetrics = {
 blockedQueries: new promClient.Counter({
 name: 'sql_queries_blocked_total',
 help: 'Total number of blocked queries',
 labelNames: ['database', 'reason'],
 registers: [register]
 }),

 authAttempts: new promClient.Counter({
 name: 'sql_auth_attempts_total',
 help: 'Total authentication attempts',
 labelNames: ['database', 'status'],
 registers: [register]
 })
};

// System metrics
export const systemMetrics = {
 memory: new promClient.Gauge({
 name: 'nodejs_memory_usage_bytes',
 help: 'Node.js memory usage in bytes',
 labelNames: ['type'],
 registers: [register]
 }),

 eventLoop: new promClient.Histogram({
 name: 'nodejs_event_loop_lag_seconds',
 help: 'Event loop lag in seconds',
 buckets: [0.001, 0.01, 0.1, 0.5, 1],
 registers: [register]
 }),

 gc: new promClient.Counter({
 name: 'nodejs_gc_runs_total',
 help: 'Total number of GC runs',
 labelNames: ['type'],
 registers: [register]
 })
};
```

### Metrics Instrumentation

```typescript
// Query execution wrapper with metrics
export async function executeQueryWithMetrics(
 database: string,
 query: string,
 queryType: string
): Promise<any> {
 const timer = queryMetrics.duration.startTimer({ database, query_type: queryType });
 
 try {
 const result = await executeQuery(database, query);
 
 queryMetrics.total.inc({ database, status: 'success', query_type: queryType });
 
 return result;
 } catch (error) {
 queryMetrics.total.inc({ database, status: 'error', query_type: queryType });
 queryMetrics.errors.inc({ 
 database, 
 error_type: error.constructor.name 
 });
 
 throw error;
 } finally {
 timer();
 }
}

// Connection monitoring
export function updateConnectionMetrics(database: string) {
 const pool = getConnectionPool(database);
 
 connectionMetrics.active.set(
 { database }, 
 pool.activeConnections
 );
 
 connectionMetrics.pool.set(
 { database, status: 'idle' }, 
 pool.idleConnections
 );
 
 connectionMetrics.pool.set(
 { database, status: 'waiting' }, 
 pool.waitingClients
 );
}

// System metrics collection
setInterval(() => {
 const memUsage = process.memoryUsage();
 
 Object.entries(memUsage).forEach(([type, value]) => {
 systemMetrics.memory.set({ type }, value);
 });
 
 // Event loop lag measurement
 const start = process.hrtime();
 setImmediate(() => {
 const lag = process.hrtime(start);
 const lagSeconds = lag[0] + lag[1] / 1e9;
 systemMetrics.eventLoop.observe(lagSeconds);
 });
}, 5000);
```

### Prometheus Configuration

**prometheus.yml**:
```yaml
global:
 scrape_interval: 15s
 evaluation_interval: 15s

rule_files:
 - "sql_mcp_rules.yml"

scrape_configs:
 - job_name: 'argos-mcp'
 static_configs:
 - targets: ['mcp-1:3000', 'mcp-2:3000', 'mcp-3:3000']
 metrics_path: '/metrics'
 scrape_interval: 10s
 scrape_timeout: 5s

 - job_name: 'node-exporter'
 static_configs:
 - targets: ['mcp-1:9100', 'mcp-2:9100', 'mcp-3:9100']

 - job_name: 'postgres-exporter'
 static_configs:
 - targets: ['db-1:9187', 'db-2:9187']

alerting:
 alertmanagers:
 - static_configs:
 - targets:
 - alertmanager:9093
```

**Alert Rules (sql_mcp_rules.yml)**:
```yaml
groups:
 - name: sql_mcp_alerts
 rules:
 - alert: HighQueryErrorRate
 expr: rate(sql_query_errors_total[5m]) > 0.1
 for: 2m
 labels:
 severity: warning
 service: argos-mcp
 annotations:
 summary: "High SQL query error rate detected"
 description: "Query error rate is {{ $value }} errors/sec on database {{ $labels.database }}"

 - alert: QueryExecutionTimeHigh
 expr: histogram_quantile(0.95, rate(sql_query_duration_seconds_bucket[5m])) > 5
 for: 5m
 labels:
 severity: warning
 service: argos-mcp
 annotations:
 summary: "High query execution time"
 description: "95th percentile query time is {{ $value }}s on database {{ $labels.database }}"

 - alert: ConnectionPoolExhausted
 expr: sql_connection_pool_size{status="idle"} < 2
 for: 1m
 labels:
 severity: critical
 service: argos-mcp
 annotations:
 summary: "Connection pool nearly exhausted"
 description: "Only {{ $value }} idle connections remaining for database {{ $labels.database }}"

 - alert: MemoryUsageHigh
 expr: nodejs_memory_usage_bytes{type="heapUsed"} / nodejs_memory_usage_bytes{type="heapTotal"} > 0.9
 for: 5m
 labels:
 severity: warning
 service: argos-mcp
 annotations:
 summary: "High memory usage detected"
 description: "Memory usage is {{ $value | humanizePercentage }} of heap"

 - alert: EventLoopLagHigh
 expr: histogram_quantile(0.95, rate(nodejs_event_loop_lag_seconds_bucket[5m])) > 0.1
 for: 3m
 labels:
 severity: warning
 service: argos-mcp
 annotations:
 summary: "High event loop lag"
 description: "Event loop lag is {{ $value }}ms"

 - alert: SecurityViolation
 expr: increase(sql_queries_blocked_total[1m]) > 0
 for: 0m
 labels:
 severity: critical
 service: argos-mcp
 annotations:
 summary: "Security policy violation detected"
 description: "{{ $value }} queries blocked due to {{ $labels.reason }} on database {{ $labels.database }}"
```

## Grafana Dashboards

### Main Dashboard Configuration

```json
{
 "dashboard": {
 "id": null,
 "title": "Argos-MCP Monitoring",
 "tags": ["sql", "mcp", "monitoring"],
 "timezone": "browser",
 "panels": [
 {
 "id": 1,
 "title": "Query Rate",
 "type": "graph",
 "targets": [
 {
 "expr": "rate(sql_queries_total[5m])",
 "legendFormat": "{{database}} - {{status}}"
 }
 ],
 "yAxes": [
 {
 "label": "Queries/sec",
 "min": 0
 }
 ]
 },
 {
 "id": 2,
 "title": "Query Duration (95th percentile)",
 "type": "graph",
 "targets": [
 {
 "expr": "histogram_quantile(0.95, rate(sql_query_duration_seconds_bucket[5m]))",
 "legendFormat": "{{database}}"
 }
 ]
 },
 {
 "id": 3,
 "title": "Connection Pool Status",
 "type": "graph",
 "targets": [
 {
 "expr": "sql_connection_pool_size",
 "legendFormat": "{{database}} - {{status}}"
 }
 ]
 },
 {
 "id": 4,
 "title": "Error Rate",
 "type": "singlestat",
 "targets": [
 {
 "expr": "sum(rate(sql_query_errors_total[5m]))",
 "legendFormat": "Errors/sec"
 }
 ],
 "thresholds": "1,5"
 }
 ]
 }
}
```

### Performance Dashboard

```json
{
 "dashboard": {
 "title": "Argos-MCP Performance",
 "panels": [
 {
 "title": "Memory Usage",
 "type": "graph",
 "targets": [
 {
 "expr": "nodejs_memory_usage_bytes",
 "legendFormat": "{{type}}"
 }
 ]
 },
 {
 "title": "Event Loop Lag",
 "type": "graph",
 "targets": [
 {
 "expr": "nodejs_event_loop_lag_seconds",
 "legendFormat": "Event Loop Lag"
 }
 ]
 },
 {
 "title": "GC Activity",
 "type": "graph",
 "targets": [
 {
 "expr": "rate(nodejs_gc_runs_total[5m])",
 "legendFormat": "{{type}}"
 }
 ]
 }
 ]
 }
}
```

## Logging and Log Analysis

### Structured Logging Setup

**Winston Configuration**:
```typescript
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

// Create logger
export const logger = winston.createLogger({
 level: process.env.LOG_LEVEL || 'info',
 format: winston.format.combine(
 winston.format.timestamp(),
 winston.format.errors({ stack: true }),
 winston.format.json()
 ),
 defaultMeta: {
 service: 'argos-mcp',
 version: process.env.APP_VERSION,
 instance: process.env.HOSTNAME
 },
 transports: [
 // Console transport for development
 new winston.transports.Console({
 format: winston.format.combine(
 winston.format.colorize(),
 winston.format.simple()
 )
 }),

 // File transport for production
 new winston.transports.File({
 filename: 'logs/app.log',
 maxsize: 100 * 1024 * 1024, // 100MB
 maxFiles: 5,
 tailable: true
 }),

 // Elasticsearch transport for centralized logging
 new ElasticsearchTransport({
 level: 'info',
 clientOpts: {
 node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200'
 },
 index: 'argos-mcp-logs'
 })
 ]
});

// Request logging middleware
export function requestLogger(req: any, res: any, next: any) {
 const start = Date.now();
 
 res.on('finish', () => {
 const duration = Date.now() - start;
 
 logger.info('HTTP Request', {
 method: req.method,
 url: req.url,
 status_code: res.statusCode,
 duration_ms: duration,
 user_agent: req.headers['user-agent'],
 ip: req.ip,
 request_id: req.id
 });
 });
 
 next();
}
```

### Log Analysis Queries

**Elasticsearch Queries**:

```json
{
 "query": {
 "bool": {
 "must": [
 {
 "range": {
 "@timestamp": {
 "gte": "now-1h"
 }
 }
 },
 {
 "term": {
 "level": "error"
 }
 }
 ]
 }
 },
 "aggs": {
 "error_types": {
 "terms": {
 "field": "error_type.keyword"
 }
 }
 }
}
```

**Kibana Dashboard Queries**:

```
# Query performance over time
{
 "query": "message:\"Query executed\" AND status:success",
 "aggs": {
 "avg_execution_time": {
 "avg": {
 "field": "execution_time_ms"
 }
 }
 }
}

# Security violations
{
 "query": "message:\"Query blocked\" OR message:\"Authentication failed\"",
 "size": 100,
 "sort": [
 {
 "@timestamp": {
 "order": "desc"
 }
 }
 ]
}

# Database connection issues
{
 "query": "message:\"Connection failed\" OR message:\"Timeout\"",
 "aggs": {
 "by_database": {
 "terms": {
 "field": "database.keyword"
 }
 }
 }
}
```

## Alerting Configuration

### AlertManager Setup

**alertmanager.yml**:
```yaml
global:
 smtp_smarthost: 'localhost:587'
 smtp_from: 'alerts@company.com'

route:
 group_by: ['alertname']
 group_wait: 10s
 group_interval: 10s
 repeat_interval: 1h
 receiver: 'web.hook'

receivers:
- name: 'web.hook'
 email_configs:
 - to: 'devops@company.com'
 subject: '[{{ .Status | title }}] Argos-MCP Alert'
 body: |
 {{ range .Alerts }}
 Alert: {{ .Annotations.summary }}
 Description: {{ .Annotations.description }}
 {{ end }}

 slack_configs:
 - api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
 channel: '#alerts'
 title: 'Argos-MCP Alert'
 text: |
 {{ range .Alerts }}
 {{ .Annotations.summary }}
 {{ .Annotations.description }}
 {{ end }}

 webhook_configs:
 - url: 'http://pagerduty-webhook:8080/webhook'
 send_resolved: true
```

### Custom Alert Scripts

**Slack Integration**:
```bash
#!/bin/bash
# slack-alert.sh

WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
ALERT_MESSAGE="$1"
SEVERITY="$2"

case $SEVERITY in
 "critical")
 COLOR="danger"
 ;;
 "warning")
 COLOR="warning"
 ;;
 *)
 COLOR="good"
 ;;
esac

curl -X POST -H 'Content-type: application/json' \
 --data "{
 \"attachments\": [{
 \"color\": \"$COLOR\",
 \"title\": \"Argos-MCP Alert\",
 \"text\": \"$ALERT_MESSAGE\",
 \"timestamp\": $(date +%s)
 }]
 }" \
 $WEBHOOK_URL
```

**Email Alerts**:
```python
#!/usr/bin/env python3
import smtplib
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_alert(subject, body, severity):
 msg = MIMEMultipart()
 msg['From'] = 'alerts@company.com'
 msg['To'] = 'devops@company.com'
 msg['Subject'] = f'[{severity.upper()}] {subject}'
 
 msg.attach(MIMEText(body, 'plain'))
 
 server = smtplib.SMTP('localhost', 587)
 server.send_message(msg)
 server.quit()

if __name__ == '__main__':
 subject = sys.argv[1]
 body = sys.argv[2] 
 severity = sys.argv[3]
 send_alert(subject, body, severity)
```

## Health Checks and Uptime Monitoring

### Health Check Implementation

```typescript
// Health check endpoint
app.get('/health', async (req, res) => {
 try {
 const health = {
 status: 'healthy',
 timestamp: new Date().toISOString(),
 uptime: process.uptime(),
 version: packageInfo.version,
 environment: process.env.NODE_ENV,
 checks: {}
 };

 // Database connectivity checks
 for (const [name, config] of Object.entries(databases)) {
 try {
 await testConnection(config);
 health.checks[name] = { status: 'healthy', response_time: 0 };
 } catch (error) {
 health.checks[name] = { 
 status: 'unhealthy', 
 error: error.message 
 };
 health.status = 'degraded';
 }
 }

 // Memory check
 const memUsage = process.memoryUsage();
 const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
 
 health.checks.memory = {
 status: heapPercent > 90 ? 'warning' : 'healthy',
 heap_used_percent: Math.round(heapPercent)
 };

 res.json(health);
 } catch (error) {
 res.status(503).json({
 status: 'unhealthy',
 error: error.message
 });
 }
});
```

### External Monitoring

**Pingdom Configuration**:
```http
GET /health HTTP/1.1
Host: argos.company.com
User-Agent: Pingdom.com_bot_version_1.4

Expected Response: 200 OK
Contains: "status":"healthy"
```

**New Relic Synthetics**:
```javascript
// synthetic-monitor.js
var assert = require('assert');

$http.get('https://argos.company.com/health', function(err, response, body) {
 assert.equal(response.statusCode, 200, 'Expected HTTP 200');
 
 var health = JSON.parse(body);
 assert.equal(health.status, 'healthy', 'Service should be healthy');
 
 console.log('Health check passed');
});
```

## Performance Analysis

### Query Performance Monitoring

```sql
-- Query performance analysis
SELECT 
 database_name,
 query_type,
 COUNT(*) as execution_count,
 AVG(execution_time_ms) as avg_time,
 MAX(execution_time_ms) as max_time,
 PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) as p95_time
FROM query_logs 
WHERE timestamp >= NOW() - INTERVAL '1 hour'
GROUP BY database_name, query_type
ORDER BY avg_time DESC;
```

### Resource Usage Analysis

```bash
#!/bin/bash
# performance-report.sh

echo "=== Argos-MCP Performance Report ==="
echo "Date: $(date)"
echo

echo "=== CPU Usage ==="
ps aux | grep "argos-mcp" | grep -v grep

echo "=== Memory Usage ==="
pmap $(pgrep -f argos-mcp) | tail -1

echo "=== Network Connections ==="
netstat -an | grep :3000

echo "=== Database Connections ==="
curl -s http://localhost:3000/metrics | grep sql_connections_active

echo "=== Query Metrics (Last Hour) ==="
curl -s http://localhost:3000/metrics | grep sql_queries_total
```

## Capacity Planning

### Growth Trend Analysis

```promql
# Query growth rate (queries per minute)
increase(sql_queries_total[1h]) / 60

# Resource utilization trends
rate(nodejs_memory_usage_bytes[1h])

# Connection pool utilization
sql_connections_active / sql_connection_pool_size{status="total"}

# Response time trends
histogram_quantile(0.95, 
 rate(sql_query_duration_seconds_bucket[1h])
)
```

### Scaling Recommendations

```yaml
# scaling-policy.yml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
 name: argos-hpa
spec:
 scaleTargetRef:
 apiVersion: apps/v1
 kind: Deployment 
 name: argos-mcp
 minReplicas: 2
 maxReplicas: 20
 metrics:
 - type: Resource
 resource:
 name: cpu
 target:
 type: Utilization
 averageUtilization: 70
 - type: Pods
 pods:
 metric:
 name: sql_queries_per_second
 target:
 type: AverageValue
 averageValue: "100"
```

## Troubleshooting with Monitoring

### Common Monitoring Scenarios

**High Response Time Investigation**:
1. Check query duration metrics
2. Analyze slow query logs
3. Review database performance
4. Check connection pool status
5. Monitor system resources

**Memory Leak Detection**:
1. Monitor heap usage trends
2. Analyze GC patterns
3. Check for connection leaks
4. Review query caching
5. Generate heap dumps for analysis

**Security Event Response**:
1. Review blocked query logs
2. Analyze authentication patterns
3. Check access control violations
4. Monitor unusual query complexity
5. Review audit trails

## Best Practices

### Monitoring Strategy

1. **Establish Baselines**: Understand normal operating parameters
2. **Set Meaningful Alerts**: Avoid alert fatigue with actionable thresholds
3. **Monitor Business Metrics**: Track user-facing performance indicators
4. **Regular Review**: Periodic assessment of monitoring effectiveness
5. **Documentation**: Maintain runbooks for common issues

### Performance Optimization

1. **Query Analysis**: Regular review of slow queries
2. **Connection Tuning**: Optimize connection pool settings
3. **Resource Monitoring**: Proactive capacity management
4. **Caching Strategy**: Implement appropriate caching layers
5. **Load Testing**: Regular performance validation

## Conclusion

Comprehensive monitoring ensures the Argos-MCP operates reliably and efficiently. This guide provides the foundation for implementing robust observability practices that enable proactive issue detection and resolution.

Regular monitoring review and optimization ensures the system continues to meet performance and reliability requirements as it scales.
