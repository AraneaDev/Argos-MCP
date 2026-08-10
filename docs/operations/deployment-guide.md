# Argos-MCP Deployment Guide

## Overview

This guide covers production deployment strategies for the Argos-MCP, including containerization, orchestration, monitoring, and scaling considerations.

## Deployment Architectures

### Single Instance Deployment

**Use Case**: Development, testing, and small-scale production environments.

```
+-----------------+
| Claude |
| Desktop |
\-----------------+
 |
 | MCP Protocol
 v
+-----------------+ +--------------+
| Argos-MCP |----| Database |
| (Standalone) | | |
\-----------------+ \--------------+
```

**Configuration**:
```ini
[database.production]
type=postgresql
host=db-server.company.com
port=5432
database=production_db
username=readonly_user
password=${DB_PASSWORD}
readonly=true
```

### High Availability Deployment

**Use Case**: Mission-critical environments requiring redundancy.

```
+-----------------+
| Load Balancer |
| (HAProxy/Nginx)|
\-----------------+
 |
 +----+----+
 v v
+--------+ +--------+ +--------------+
| MCP #1 | | MCP #2 |----| Primary DB |
\--------+ \--------+ \--------------+
 | | |
 \---------+--------------+
 | |
 v v
 +--------------+ +--------------+
 | Replica DB | | Replica DB |
 \--------------+ \--------------+
```

**Features**:
- Multiple MCP server instances
- Database read replicas
- Automatic failover
- Session affinity

### Containerized Deployment

**Use Case**: Cloud-native environments with Docker/Kubernetes.

#### Docker Deployment

**Dockerfile**:
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY config.ini ./

EXPOSE 3000
USER 1000:1000

CMD ["node", "dist/index.js"]
```

**docker-compose.yml**:
```yaml
version: '3.8'

services:
 argos-mcp:
 build: .
 environment:
 - NODE_ENV=production
 - CONFIG_PATH=/app/config.ini
 volumes:
 - ./config.ini:/app/config.ini:ro
 - ./logs:/app/logs
 ports:
 - "3000:3000"
 restart: unless-stopped
 healthcheck:
 test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
 interval: 30s
 timeout: 10s
 retries: 3

 database:
 image: postgres:15
 environment:
 POSTGRES_DB: myapp
 POSTGRES_USER: app_user
 POSTGRES_PASSWORD: secure_password
 volumes:
 - postgres_data:/var/lib/postgresql/data
 restart: unless-stopped

volumes:
 postgres_data:
```

#### Kubernetes Deployment

**Deployment**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
 name: argos-mcp
 namespace: production
spec:
 replicas: 3
 selector:
 matchLabels:
 app: argos-mcp
 template:
 metadata:
 labels:
 app: argos-mcp
 spec:
 containers:
 - name: argos-mcp
 image: argos-mcp:latest
 ports:
 - containerPort: 3000
 env:
 - name: NODE_ENV
 value: "production"
 - name: DB_PASSWORD
 valueFrom:
 secretKeyRef:
 name: db-credentials
 key: password
 volumeMounts:
 - name: config
 mountPath: /app/config.ini
 subPath: config.ini
 livenessProbe:
 httpGet:
 path: /health
 port: 3000
 initialDelaySeconds: 30
 periodSeconds: 10
 readinessProbe:
 httpGet:
 path: /ready
 port: 3000
 initialDelaySeconds: 5
 periodSeconds: 5
 resources:
 requests:
 cpu: 100m
 memory: 128Mi
 limits:
 cpu: 500m
 memory: 512Mi
 volumes:
 - name: config
 configMap:
 name: argos-config
```

**Service**:
```yaml
apiVersion: v1
kind: Service
metadata:
 name: argos-mcp
 namespace: production
spec:
 selector:
 app: argos-mcp
 ports:
 - port: 80
 targetPort: 3000
 type: ClusterIP
```

**ConfigMap**:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
 name: argos-config
 namespace: production
data:
 config.ini: |
 [database.primary]
 type=postgresql
 host=postgres-service
 port=5432
 database=production_db
 username=readonly_user
 readonly=true
 
 [security]
 enable_readonly_mode=true
 max_query_complexity=100
 
 [logging]
 level=info
 format=json
```

## Environment Configuration

Argos does not read `.env` files, and there is no environment variable that
selects a configuration. It reads `config.ini` from the working directory it was
started in, so one environment per directory (or per container image) is how the
environments are kept apart:

```bash
# Staging and production differ by where the process is started, not by a flag
cd /srv/argos-staging   && node dist/index.js
cd /srv/argos-production && node dist/index.js
```

These are the only environment variables the server reads:

| Variable | Effect |
|----------|--------|
| `SQL_MCP_SQLITE_BASE_DIR` | Confines SQLite paths supplied through MCP tools to this directory. Worth setting wherever the model can add databases. |
| `SSH_DEBUG=true` | Adds the ssh2 handshake trace to `argos-mcp.log`. Verbose; off by default. |
| `CLIENT_IP` | Recorded as the source address in security audit entries. Set it if a wrapper knows the real client. |
| `DEBUG_SETUP=true` | Extra diagnostics from the setup wizard only. |
| `NODE_ENV=development` | Extra detail from the setup wizard only. Has no effect on the server. |

Log verbosity, monitoring and metrics endpoints are not configurable: see
[Monitoring and Logging](./security-hardening.md#monitoring-and-logging) for
what is written and where.

## Security Configuration

### Network Security

**Firewall Rules**:
```bash
# Allow MCP server port only from Claude instances
sudo ufw allow from 10.0.0.0/8 to any port 3000

# Allow database connections only from MCP servers
sudo ufw allow from 192.168.1.100 to any port 5432
```

**Reverse Proxy Configuration (Nginx)**:
```nginx
upstream sql_mcp_backend {
 server 127.0.0.1:3000;
 server 127.0.0.1:3001 backup;
}

server {
 listen 80;
 server_name argos.company.com;
 
 location / {
 proxy_pass http://sql_mcp_backend;
 proxy_set_header Host $host;
 proxy_set_header X-Real-IP $remote_addr;
 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 
 # Rate limiting
 limit_req zone=api burst=20 nodelay;
 }
}
```

### TLS/SSL Configuration

**Certificate Management**:
```bash
# Using Let's Encrypt with certbot
sudo certbot --nginx -d argos.company.com

# Or use existing certificates
sudo cp company.crt /etc/ssl/certs/
sudo cp company.key /etc/ssl/private/
```

**TLS Configuration**:
```ini
[server]
enable_tls=true
cert_path=/etc/ssl/certs/company.crt
key_path=/etc/ssl/private/company.key
tls_version=1.3
```

## Performance Optimization

### Connection Pooling

```ini
[database.production]
# Connection pool settings
pool_min=5
pool_max=20
pool_idle_timeout=30000
pool_acquire_timeout=10000
```

### Query Caching

```ini
[caching]
enable_query_cache=true
cache_ttl=300
max_cache_size=100MB
```

### Resource Limits

**System Limits**:
```bash
# /etc/security/limits.conf
argos soft nofile 65536
argos hard nofile 65536
argos soft nproc 32768
argos hard nproc 32768
```

**Node.js Optimization**:
```bash
# Environment variables
export NODE_OPTIONS="--max-old-space-size=2048"
export UV_THREADPOOL_SIZE=16
```

## Monitoring and Observability

### Health Checks

**Kubernetes Probes**:
```typescript
// Health check endpoint
app.get('/health', (req, res) => {
 res.json({
 status: 'healthy',
 timestamp: new Date().toISOString(),
 uptime: process.uptime(),
 version: packageInfo.version
 });
});

app.get('/ready', async (req, res) => {
 try {
 await Promise.all(
 databases.map(db => db.ping())
 );
 res.json({ status: 'ready' });
 } catch (error) {
 res.status(503).json({ status: 'not ready', error: error.message });
 }
});
```

### Metrics Collection

**Prometheus Integration**:
```typescript
import promClient from 'prom-client';

const register = new promClient.Registry();

// Metrics
const queryCounter = new promClient.Counter({
 name: 'sql_queries_total',
 help: 'Total number of SQL queries executed',
 labelNames: ['database', 'status']
});

const queryDuration = new promClient.Histogram({
 name: 'sql_query_duration_seconds',
 help: 'SQL query execution time',
 labelNames: ['database']
});

register.registerMetric(queryCounter);
register.registerMetric(queryDuration);
```

### Logging Configuration

**Structured Logging**:
```json
{
 "timestamp": "2025-08-12T10:00:00.000Z",
 "level": "info",
 "message": "Query executed successfully",
 "database": "production",
 "query_hash": "abc123",
 "execution_time_ms": 45,
 "user": "claude_instance_1",
 "request_id": "req-456"
}
```

**Log Aggregation (ELK Stack)**:
```yaml
# filebeat.yml
filebeat.inputs:
- type: log
 paths:
 - /app/logs/*.log
 json.keys_under_root: true
 json.add_error_key: true

output.elasticsearch:
 hosts: ["elasticsearch:9200"]
 index: "argos-mcp-%{+yyyy.MM.dd}"
```

## Backup and Disaster Recovery

### Configuration Backup

```bash
#!/bin/bash
# backup-config.sh
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/argos"

mkdir -p "$BACKUP_DIR"
cp config.ini "$BACKUP_DIR/config_$DATE.ini"
tar -czf "$BACKUP_DIR/logs_$DATE.tar.gz" logs/

# Encrypt sensitive backups
gpg --cipher-algo AES256 --compress-algo 1 --s2k-mode 3 \
 --s2k-digest-algo SHA512 --s2k-count 65536 --symmetric \
 "$BACKUP_DIR/config_$DATE.ini"
```

### Database Backup Strategy

```bash
# automated-backup.sh
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# PostgreSQL backup
pg_dump -h db-server -U backup_user production_db \
 | gzip > "/backups/db/production_$TIMESTAMP.sql.gz"

# Retention policy (keep 30 days)
find /backups/db -name "*.sql.gz" -mtime +30 -delete
```

### Recovery Procedures

**Configuration Recovery**:
1. Stop MCP server: `systemctl stop argos-mcp`
2. Restore configuration: `cp backup/config.ini ./config.ini`
3. Validate configuration: `npm run validate-config`
4. Start server: `systemctl start argos-mcp`

**Database Recovery**:
1. Create recovery database: `createdb recovery_db`
2. Restore from backup: `gunzip -c backup.sql.gz | psql recovery_db`
3. Update configuration to point to recovery database
4. Restart MCP server

## Scaling Strategies

### Horizontal Scaling

**Load Balancer Configuration**:
```bash
# HAProxy configuration
backend sql_mcp_servers
 balance roundrobin
 server mcp1 10.0.1.10:3000 check
 server mcp2 10.0.1.11:3000 check
 server mcp3 10.0.1.12:3000 check
```

**Auto-scaling (Kubernetes)**:
```yaml
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
 maxReplicas: 10
 metrics:
 - type: Resource
 resource:
 name: cpu
 target:
 type: Utilization
 averageUtilization: 70
 - type: Resource
 resource:
 name: memory
 target:
 type: Utilization
 averageUtilization: 80
```

### Vertical Scaling

**Resource Allocation**:
```yaml
resources:
 requests:
 cpu: "200m"
 memory: "256Mi"
 limits:
 cpu: "1000m"
 memory: "1Gi"
```

**JVM Tuning** (if applicable):
```bash
export JAVA_OPTS="-Xms512m -Xmx2g -XX:+UseG1GC"
```

## Migration and Upgrades

### Zero-Downtime Deployment

**Blue-Green Deployment**:
1. Deploy new version to "green" environment
2. Run health checks and integration tests
3. Switch load balancer to "green" environment
4. Monitor for issues
5. Decommission "blue" environment

**Rolling Deployment**:
```bash
#!/bin/bash
# rolling-deploy.sh
for server in server1 server2 server3; do
 echo "Deploying to $server"
 ssh $server "
 systemctl stop argos-mcp
 cp /tmp/new-version/* /opt/argos-mcp/
 systemctl start argos-mcp
 "
 sleep 30 # Wait for health check
done
```

### Database Migration

```sql
-- Migration script v1.2.0
BEGIN;

-- Add new configuration table
CREATE TABLE IF NOT EXISTS server_config (
 key VARCHAR(100) PRIMARY KEY,
 value TEXT NOT NULL,
 created_at TIMESTAMP DEFAULT NOW()
);

-- Update existing data
UPDATE database_connections SET readonly = true WHERE environment = 'production';

COMMIT;
```

## Troubleshooting

### Common Deployment Issues

**Port Conflicts**:
```bash
# Check port usage
netstat -tlnp | grep :3000
lsof -i :3000

# Kill conflicting processes
pkill -f "argos-mcp"
```

**Permission Issues**:
```bash
# Fix file permissions
chown -R argos:argos /opt/argos-mcp
chmod 600 config.ini
chmod 755 logs/
```

**Memory Issues**:
```bash
# Monitor memory usage
ps aux | grep node
free -h
vmstat 1 5

# Adjust Node.js heap size
export NODE_OPTIONS="--max-old-space-size=1024"
```

### Log Analysis

**Common Error Patterns**:
```bash
# Connection timeouts
grep "ETIMEDOUT" logs/error.log

# Authentication failures
grep "authentication failed" logs/audit.log

# High memory usage
grep "out of memory" logs/application.log
```

## Best Practices

### Deployment Checklist

- [ ] Configuration files are secure and validated
- [ ] Database connections are tested
- [ ] Health checks are implemented
- [ ] Monitoring is configured
- [ ] Logging is properly structured
- [ ] Backup procedures are in place
- [ ] Security hardening is applied
- [ ] Performance tuning is optimized
- [ ] Documentation is updated
- [ ] Rollback procedures are defined

### Security Best Practices

1. **Principle of Least Privilege**: Grant minimal necessary permissions
2. **Defense in Depth**: Multiple security layers
3. **Regular Updates**: Keep dependencies current
4. **Audit Trails**: Comprehensive logging and monitoring
5. **Encryption**: Data at rest and in transit
6. **Access Controls**: Strong authentication and authorization

### Performance Best Practices

1. **Connection Pooling**: Efficient database connections
2. **Query Optimization**: Regular performance analysis
3. **Caching**: Appropriate caching strategies
4. **Resource Monitoring**: Proactive performance monitoring
5. **Capacity Planning**: Regular capacity assessment

## Conclusion

This deployment guide provides comprehensive strategies for deploying the Argos-MCP in various environments. Choose the appropriate architecture and configuration based on your specific requirements, security needs, and scale.

For additional support, consult the troubleshooting guide and community resources.
