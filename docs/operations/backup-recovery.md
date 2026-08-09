# Argos-MCP Backup and Recovery Guide

## Overview

This comprehensive guide covers backup strategies, disaster recovery procedures, and data protection measures for the Argos-MCP and associated databases.

## Backup Architecture

```
+-----------------------------------------------------------------+
| Backup Infrastructure |
|-----------------------------------------------------------------+
| |
| +-------------+ +-------------+ +-------------+ |
| | Config | | Logs | | Metrics | |
| | Backup | | Backup | | Backup | |
| \-------------+ \-------------+ \-------------+ |
| | | | |
| v v v |
| +---------------------------------------------------------+ |
| | Central Backup Storage | |
| | +---------+ +---------+ +---------+ +---------+ | |
| | | Local | | AWS S3 | | Azure | | GCP | | |
| | | Storage | | | | Blob | | Storage | | |
| | \---------+ \---------+ \---------+ \---------+ | |
| \---------------------------------------------------------+ |
| |
| +---------------------------------------------------------+ |
| | Database Backup Strategy | |
| | | |
| | +---------+ +---------+ +---------+ | |
| | | Full | | Incr. | | Log | | |
| | | Backup | | Backup | | Backup | | |
| | |(Weekly) | |(Daily) | |(Hourly) | | |
| | \---------+ \---------+ \---------+ | |
| \---------------------------------------------------------+ |
\-----------------------------------------------------------------+
```

## Configuration Backup

### Automated Configuration Backup

```bash
#!/bin/bash
# config-backup.sh - Automated configuration backup script

set -euo pipefail

# Configuration
BACKUP_ROOT="/backups/argos-mcp"
RETENTION_DAYS=30
ENCRYPTION_KEY_FILE="/etc/argos/backup.key"
S3_BUCKET="argos-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
BACKUP_DIR="${BACKUP_ROOT}/config_${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

# Log function
log() {
 echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${BACKUP_ROOT}/backup.log"
}

log "Starting configuration backup - ${TIMESTAMP}"

# Backup configuration files
backup_configs() {
 log "Backing up configuration files..."
 
 # Main configuration
 cp config.ini "${BACKUP_DIR}/config.ini" 2>/dev/null || log "Warning: config.ini not found"
 
 # Environment files
 cp .env* "${BACKUP_DIR}/" 2>/dev/null || log "No environment files found"
 
 # SSL certificates (if any)
 if [ -d "certs" ]; then
 cp -r certs "${BACKUP_DIR}/" 2>/dev/null || log "Warning: certs directory not accessible"
 fi
 
 # Package information
 cp package.json "${BACKUP_DIR}/" 2>/dev/null || log "Warning: package.json not found"
 cp package-lock.json "${BACKUP_DIR}/" 2>/dev/null || log "Warning: package-lock.json not found"
 
 # Custom scripts
 if [ -d "scripts" ]; then
 cp -r scripts "${BACKUP_DIR}/" 2>/dev/null || log "No custom scripts found"
 fi
}

# Backup application state
backup_application_state() {
 log "Backing up application state..."
 
 # Current process information
 ps aux | grep argos-mcp > "${BACKUP_DIR}/process_info.txt" 2>/dev/null || true
 
 # Network connections
 netstat -tlnp | grep argos > "${BACKUP_DIR}/network_info.txt" 2>/dev/null || true
 
 # Memory usage
 free -h > "${BACKUP_DIR}/memory_info.txt" 2>/dev/null || true
 
 # Disk usage
 df -h > "${BACKUP_DIR}/disk_info.txt" 2>/dev/null || true
 
 # System information
 uname -a > "${BACKUP_DIR}/system_info.txt" 2>/dev/null || true
 
 # Node.js version
 node --version > "${BACKUP_DIR}/node_version.txt" 2>/dev/null || true
}

# Create backup metadata
create_metadata() {
 log "Creating backup metadata..."
 
 cat > "${BACKUP_DIR}/backup_metadata.json" <<EOF
{
 "backup_type": "configuration",
 "timestamp": "${TIMESTAMP}",
 "hostname": "$(hostname)",
 "backup_version": "1.0",
 "retention_policy": "${RETENTION_DAYS} days",
 "files_backed_up": $(find "${BACKUP_DIR}" -type f | wc -l),
 "backup_size_mb": $(du -sm "${BACKUP_DIR}" | cut -f1),
 "checksum": "$(find "${BACKUP_DIR}" -type f -exec md5sum {} + | md5sum | cut -d' ' -f1)"
}
EOF
}

# Encrypt backup if key exists
encrypt_backup() {
 if [ -f "${ENCRYPTION_KEY_FILE}" ]; then
 log "Encrypting backup archive..."
 
 cd "${BACKUP_ROOT}"
 tar -czf "config_${TIMESTAMP}.tar.gz" "config_${TIMESTAMP}/"
 
 gpg --cipher-algo AES256 --compress-algo 1 --s2k-mode 3 \
 --s2k-digest-algo SHA512 --s2k-count 65536 \
 --passphrase-file "${ENCRYPTION_KEY_FILE}" \
 --symmetric "config_${TIMESTAMP}.tar.gz"
 
 # Remove unencrypted files
 rm "config_${TIMESTAMP}.tar.gz"
 rm -rf "config_${TIMESTAMP}/"
 
 log "Backup encrypted successfully"
 else
 log "No encryption key found, creating unencrypted archive..."
 cd "${BACKUP_ROOT}"
 tar -czf "config_${TIMESTAMP}.tar.gz" "config_${TIMESTAMP}/"
 rm -rf "config_${TIMESTAMP}/"
 fi
}

# Upload to cloud storage
upload_to_cloud() {
 local archive_file="${BACKUP_ROOT}/config_${TIMESTAMP}.tar.gz"
 
 if [ -f "${archive_file}.gpg" ]; then
 archive_file="${archive_file}.gpg"
 fi
 
 if command -v aws &> /dev/null; then
 log "Uploading to AWS S3..."
 aws s3 cp "${archive_file}" "s3://${S3_BUCKET}/config/" \
 --storage-class STANDARD_IA \
 --server-side-encryption AES256 || log "S3 upload failed"
 fi
 
 if command -v az &> /dev/null; then
 log "Uploading to Azure Blob Storage..."
 az storage blob upload \
 --file "${archive_file}" \
 --container-name "argos-backups" \
 --name "config/config_${TIMESTAMP}.tar.gz" || log "Azure upload failed"
 fi
 
 if command -v gsutil &> /dev/null; then
 log "Uploading to Google Cloud Storage..."
 gsutil cp "${archive_file}" "gs://${S3_BUCKET}/config/" || log "GCS upload failed"
 fi
}

# Cleanup old backups
cleanup_old_backups() {
 log "Cleaning up backups older than ${RETENTION_DAYS} days..."
 
 find "${BACKUP_ROOT}" -name "config_*.tar.gz*" -mtime +${RETENTION_DAYS} -delete
 
 # Cleanup cloud storage (AWS S3 example)
 if command -v aws &> /dev/null; then
 aws s3 ls "s3://${S3_BUCKET}/config/" --recursive | \
 awk '$1 <= "'$(date -d "${RETENTION_DAYS} days ago" '+%Y-%m-%d')'" {print $4}' | \
 xargs -I {} aws s3 rm "s3://${S3_BUCKET}/{}" 2>/dev/null || true
 fi
}

# Main execution
main() {
 backup_configs
 backup_application_state
 create_metadata
 encrypt_backup
 upload_to_cloud
 cleanup_old_backups
 
 log "Configuration backup completed successfully - ${TIMESTAMP}"
}

# Execute main function
main "$@"
```

### MySQL Backup Implementation (continued)

```bash
#!/bin/bash
# mysql-backup.sh - Comprehensive MySQL backup (continued)

# Binary log backup (continued)
binlog_backup() {
 local timestamp=$(date +%Y%m%d_%H%M%S)
 local binlog_dir="${BACKUP_ROOT}/binlogs_${timestamp}"
 
 log "Starting binary log backup"
 
 mkdir -p "${binlog_dir}"
 
 # Get binary log files
 mysql --defaults-file="${MYSQL_CONFIG_FILE}" \
 --host="${DB_HOST}" --port="${DB_PORT}" \
 --user="${DB_USER}" \
 -e "SHOW BINARY LOGS;" | tail -n +2 | awk '{print $1}' > "${binlog_dir}/binlog_list.txt"
 
 # Copy binary logs
 local mysql_data_dir=$(mysql --defaults-file="${MYSQL_CONFIG_FILE}" \
 --host="${DB_HOST}" --port="${DB_PORT}" \
 --user="${DB_USER}" \
 -e "SHOW VARIABLES LIKE 'datadir';" | tail -n +2 | awk '{print $2}')
 
 while read -r binlog_file; do
 if [ -f "${mysql_data_dir}${binlog_file}" ]; then
 cp "${mysql_data_dir}${binlog_file}" "${binlog_dir}/"
 fi
 done < "${binlog_dir}/binlog_list.txt"
 
 # Archive binary logs
 if [ "$(ls -A "${binlog_dir}" | wc -l)" -gt 1 ]; then
 tar -czf "${binlog_dir}.tar.gz" -C "${binlog_dir}" .
 rm -rf "${binlog_dir}"
 
 # Upload to cloud
 upload_backup "${binlog_dir}.tar.gz" "binlogs/"
 
 log "Binary log backup completed: ${binlog_dir}.tar.gz"
 else
 log "No binary logs found for backup"
 rmdir "${binlog_dir}"
 fi
}

# MySQL restore function
restore_database() {
 local backup_file="$1"
 local target_db="${2:-${DB_NAME}_restore}"
 
 log "Starting MySQL database restore from: ${backup_file}"
 
 # Create target database
 mysql --defaults-file="${MYSQL_CONFIG_FILE}" \
 --host="${DB_HOST}" --port="${DB_PORT}" \
 --user="${DB_USER}" \
 -e "CREATE DATABASE IF NOT EXISTS \`${target_db}\`;"
 
 # Restore based on backup type
 if [[ "${backup_file}" == *.sql.gz ]]; then
 # Compressed SQL restore
 gunzip -c "${backup_file}" | \
 mysql --defaults-file="${MYSQL_CONFIG_FILE}" \
 --host="${DB_HOST}" --port="${DB_PORT}" \
 --user="${DB_USER}" "${target_db}"
 elif [[ "${backup_file}" == *.sql ]]; then
 # Plain SQL restore
 mysql --defaults-file="${MYSQL_CONFIG_FILE}" \
 --host="${DB_HOST}" --port="${DB_PORT}" \
 --user="${DB_USER}" "${target_db}" < "${backup_file}"
 else
 log "Error: Unsupported backup format: ${backup_file}"
 return 1
 fi
 
 log "Database restore completed: ${target_db}"
}

# Point-in-time recovery
point_in_time_recovery() {
 local full_backup="$1"
 local target_time="$2"
 local target_db="${3:-${DB_NAME}_pitr}"
 
 log "Starting point-in-time recovery to: ${target_time}"
 
 # Restore full backup first
 restore_database "${full_backup}" "${target_db}"
 
 # Apply binary logs up to target time
 local binlog_dir="/tmp/pitr_binlogs_$(date +%s)"
 mkdir -p "${binlog_dir}"
 
 # Find and download relevant binary logs
 # This is a simplified version - production would need more sophisticated log management
 find "${BACKUP_ROOT}" -name "binlogs_*.tar.gz" | while read -r binlog_archive; do
 tar -xzf "${binlog_archive}" -C "${binlog_dir}"
 done
 
 # Apply binary logs
 for binlog_file in "${binlog_dir}"/*; do
 if [[ -f "${binlog_file}" && "${binlog_file}" != *.txt ]]; then
 mysqlbinlog --stop-datetime="${target_time}" "${binlog_file}" | \
 mysql --defaults-file="${MYSQL_CONFIG_FILE}" \
 --host="${DB_HOST}" --port="${DB_PORT}" \
 --user="${DB_USER}" "${target_db}"
 fi
 done
 
 # Cleanup
 rm -rf "${binlog_dir}"
 
 log "Point-in-time recovery completed: ${target_db}"
}

# Main MySQL backup logic
main() {
 local backup_type="${1:-auto}"
 
 mkdir -p "${BACKUP_ROOT}"
 
 case "$backup_type" in
 "full")
 full_backup
 ;;
 "binlog")
 binlog_backup
 ;;
 "auto")
 local day_of_week=$(date +%w)
 if [ "$day_of_week" = "0" ]; then # Sunday
 full_backup
 else
 binlog_backup
 fi
 ;;
 "restore")
 if [ -z "${2:-}" ]; then
 log "Usage: $0 restore <backup_file> [target_database]"
 exit 1
 fi
 restore_database "$2" "$3"
 ;;
 "pitr")
 if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
 log "Usage: $0 pitr <full_backup> <target_time> [target_database]"
 exit 1
 fi
 point_in_time_recovery "$2" "$3" "$4"
 ;;
 *)
 echo "Usage: $0 {full|binlog|auto|restore|pitr}"
 exit 1
 ;;
 esac
}

# Execute main function
main "$@"
```

## Disaster Recovery Procedures

### Comprehensive Disaster Recovery Plan

```typescript
// disaster-recovery.ts - Automated disaster recovery orchestration

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DisasterRecoveryConfig {
 backupSources: BackupSource[];
 recoveryTargets: RecoveryTarget[];
 notificationChannels: NotificationChannel[];
 recoveryTimeObjective: number; // minutes
 recoveryPointObjective: number; // minutes
}

interface BackupSource {
 type: 'configuration' | 'database' | 'logs';
 location: 'local' | 's3' | 'azure' | 'gcp';
 path: string;
 credentials?: any;
}

interface RecoveryTarget {
 name: string;
 priority: number;
 dependencies: string[];
 recoverySteps: RecoveryStep[];
}

interface RecoveryStep {
 name: string;
 command: string;
 timeout: number;
 retries: number;
 rollbackCommand?: string;
}

export class DisasterRecoveryOrchestrator {
 private config: DisasterRecoveryConfig;
 private recoveryLog: string[] = [];
 private startTime: Date;
 
 constructor(configPath: string) {
 this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
 this.startTime = new Date();
 }

 async initiateRecovery(scenario: string): Promise<boolean> {
 this.log(`Initiating disaster recovery for scenario: ${scenario}`);
 
 try {
 // Step 1: Validate recovery environment
 await this.validateEnvironment();
 
 // Step 2: Download latest backups
 await this.downloadBackups();
 
 // Step 3: Execute recovery in priority order
 await this.executeRecovery();
 
 // Step 4: Verify recovery success
 await this.verifyRecovery();
 
 // Step 5: Update monitoring and alerts
 await this.updateMonitoring();
 
 this.log('Disaster recovery completed successfully');
 await this.sendNotification('success', 'Disaster recovery completed');
 
 return true;
 
 } catch (error) {
 this.log(`Disaster recovery failed: ${error.message}`);
 await this.initiateRollback();
 await this.sendNotification('failure', error.message);
 return false;
 }
 }

 private async validateEnvironment(): Promise<void> {
 this.log('Validating recovery environment...');
 
 // Check disk space
 const diskUsage = execSync('df -h / | tail -1 | awk \'{print $5}\'', { encoding: 'utf8' }).trim();
 const usagePercent = parseInt(diskUsage.replace('%', ''));
 
 if (usagePercent > 80) {
 throw new Error(`Insufficient disk space: ${usagePercent}% used`);
 }
 
 // Check network connectivity
 try {
 execSync('ping -c 1 8.8.8.8', { timeout: 5000 });
 } catch {
 throw new Error('Network connectivity test failed');
 }
 
 // Check required services
 const requiredServices = ['docker', 'systemctl'];
 for (const service of requiredServices) {
 try {
 execSync(`which ${service}`, { timeout: 5000 });
 } catch {
 throw new Error(`Required service not found: ${service}`);
 }
 }
 
 this.log('Environment validation completed');
 }

 private async downloadBackups(): Promise<void> {
 this.log('Downloading backup files...');
 
 for (const source of this.config.backupSources) {
 try {
 switch (source.location) {
 case 's3':
 await this.downloadFromS3(source);
 break;
 case 'azure':
 await this.downloadFromAzure(source);
 break;
 case 'gcp':
 await this.downloadFromGCP(source);
 break;
 case 'local':
 // Local backups should already be available
 break;
 }
 } catch (error) {
 this.log(`Warning: Failed to download backup from ${source.location}: ${error.message}`);
 }
 }
 }

 private async downloadFromS3(source: BackupSource): Promise<void> {
 const command = `aws s3 sync ${source.path} /tmp/recovery/backups/${source.type}/`;
 execSync(command, { timeout: 300000 }); // 5 minute timeout
 this.log(`Downloaded ${source.type} backups from S3`);
 }

 private async downloadFromAzure(source: BackupSource): Promise<void> {
 const command = `az storage blob download-batch --source ${source.path} --destination /tmp/recovery/backups/${source.type}/`;
 execSync(command, { timeout: 300000 });
 this.log(`Downloaded ${source.type} backups from Azure`);
 }

 private async downloadFromGCP(source: BackupSource): Promise<void> {
 const command = `gsutil -m rsync -r ${source.path} /tmp/recovery/backups/${source.type}/`;
 execSync(command, { timeout: 300000 });
 this.log(`Downloaded ${source.type} backups from GCP`);
 }

 private async executeRecovery(): Promise<void> {
 this.log('Executing recovery procedures...');
 
 // Sort targets by priority
 const sortedTargets = this.config.recoveryTargets.sort((a, b) => a.priority - b.priority);
 
 for (const target of sortedTargets) {
 await this.recoverTarget(target);
 }
 }

 private async recoverTarget(target: RecoveryTarget): Promise<void> {
 this.log(`Starting recovery for target: ${target.name}`);
 
 // Check dependencies
 for (const dependency of target.dependencies) {
 if (!await this.verifyTargetHealth(dependency)) {
 throw new Error(`Dependency not ready: ${dependency}`);
 }
 }
 
 // Execute recovery steps
 for (const step of target.recoverySteps) {
 await this.executeRecoveryStep(step);
 }
 
 this.log(`Completed recovery for target: ${target.name}`);
 }

 private async executeRecoveryStep(step: RecoveryStep): Promise<void> {
 this.log(`Executing step: ${step.name}`);
 
 let attempts = 0;
 while (attempts <= step.retries) {
 try {
 execSync(step.command, { 
 timeout: step.timeout * 1000,
 stdio: 'pipe'
 });
 this.log(`Step completed: ${step.name}`);
 return;
 } catch (error) {
 attempts++;
 if (attempts > step.retries) {
 throw new Error(`Step failed after ${step.retries} retries: ${step.name}`);
 }
 this.log(`Step failed, retry ${attempts}/${step.retries}: ${step.name}`);
 await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
 }
 }
 }

 private async verifyRecovery(): Promise<void> {
 this.log('Verifying recovery success...');
 
 // Check service health
 const healthChecks = [
 'curl -f http://localhost:3000/health',
 'systemctl is-active argos-mcp',
 'pg_isready -h localhost -p 5432'
 ];
 
 for (const check of healthChecks) {
 try {
 execSync(check, { timeout: 10000 });
 } catch (error) {
 throw new Error(`Health check failed: ${check}`);
 }
 }
 
 // Verify data integrity
 await this.verifyDataIntegrity();
 
 this.log('Recovery verification completed');
 }

 private async verifyDataIntegrity(): Promise<void> {
 // Database connectivity test
 try {
 execSync('node -e "require(\'./dist/index.js\').testConnections()"', { timeout: 30000 });
 } catch (error) {
 throw new Error(`Database connectivity test failed: ${error.message}`);
 }
 
 // Configuration validation
 try {
 execSync('node dist/setup.js --validate', { timeout: 10000 });
 } catch (error) {
 throw new Error(`Configuration validation failed: ${error.message}`);
 }
 }

 private async updateMonitoring(): Promise<void> {
 this.log('Updating monitoring configuration...');
 
 // Restart monitoring services
 const monitoringServices = ['prometheus', 'grafana', 'alertmanager'];
 for (const service of monitoringServices) {
 try {
 execSync(`systemctl restart ${service}`, { timeout: 30000 });
 } catch (error) {
 this.log(`Warning: Failed to restart ${service}: ${error.message}`);
 }
 }
 
 // Update alert rules for post-recovery monitoring
 const alertConfig = {
 groups: [{
 name: 'disaster_recovery',
 rules: [{
 alert: 'DisasterRecoveryCompleted',
 expr: 'up{job="argos-mcp"}',
 labels: {
 severity: 'info',
 recovery_time: this.getRecoveryTime()
 },
 annotations: {
 summary: 'Disaster recovery completed successfully',
 description: `Recovery completed in ${this.getRecoveryTime()} minutes`
 }
 }]
 }]
 };
 
 fs.writeFileSync('/etc/prometheus/recovery_rules.yml', JSON.stringify(alertConfig, null, 2));
 }

 private async initiateRollback(): Promise<void> {
 this.log('Initiating rollback procedures...');
 
 // Stop any partially started services
 try {
 execSync('systemctl stop argos-mcp', { timeout: 30000 });
 } catch {
 // Service may not be running
 }
 
 // Restore original configuration if backup exists
 if (fs.existsSync('/tmp/config_backup_original.tar.gz')) {
 execSync('tar -xzf /tmp/config_backup_original.tar.gz -C /', { timeout: 30000 });
 }
 
 // Clean up recovery artifacts
 execSync('rm -rf /tmp/recovery/', { timeout: 10000 });
 
 this.log('Rollback completed');
 }

 private async verifyTargetHealth(targetName: string): Promise<boolean> {
 // Implement health check logic for specific targets
 try {
 switch (targetName) {
 case 'database':
 execSync('pg_isready -h localhost -p 5432', { timeout: 5000 });
 return true;
 case 'config':
 return fs.existsSync('config.ini');
 default:
 return true;
 }
 } catch {
 return false;
 }
 }

 private async sendNotification(status: 'success' | 'failure', message: string): Promise<void> {
 for (const channel of this.config.notificationChannels) {
 try {
 switch (channel.type) {
 case 'email':
 await this.sendEmail(channel, status, message);
 break;
 case 'slack':
 await this.sendSlack(channel, status, message);
 break;
 case 'webhook':
 await this.sendWebhook(channel, status, message);
 break;
 }
 } catch (error) {
 this.log(`Failed to send notification via ${channel.type}: ${error.message}`);
 }
 }
 }

 private getRecoveryTime(): string {
 const elapsed = Date.now() - this.startTime.getTime();
 return Math.round(elapsed / 60000).toString(); // minutes
 }

 private log(message: string): void {
 const timestamp = new Date().toISOString();
 const logEntry = `[${timestamp}] ${message}`;
 this.recoveryLog.push(logEntry);
 console.log(logEntry);
 
 // Write to recovery log file
 fs.appendFileSync('/var/log/argos/disaster-recovery.log', logEntry + '\n');
 }
}

// Usage example
const recovery = new DisasterRecoveryOrchestrator('/etc/argos/disaster-recovery.json');
recovery.initiateRecovery('database_failure');
```

### Recovery Testing and Validation

```bash
#!/bin/bash
# recovery-test.sh - Automated recovery testing

set -euo pipefail

TEST_ENV="recovery_test"
ORIGINAL_CONFIG_BACKUP="/tmp/original_config_backup.tar.gz"
TEST_RESULTS_DIR="/tmp/recovery_tests"

log() {
 echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${TEST_RESULTS_DIR}/test.log"
}

# Prepare test environment
prepare_test_environment() {
 log "Preparing recovery test environment..."
 
 mkdir -p "${TEST_RESULTS_DIR}"
 
 # Backup current configuration
 tar -czf "${ORIGINAL_CONFIG_BACKUP}" config.ini .env* certs/ 2>/dev/null || true
 
 # Create isolated test environment
 docker network create recovery-test-net 2>/dev/null || true
 
 log "Test environment prepared"
}

# Test configuration recovery
test_config_recovery() {
 log "Testing configuration recovery..."
 
 # Simulate configuration corruption
 cp config.ini config.ini.backup
 echo "corrupted_config=true" > config.ini
 
 # Run recovery
 ./scripts/config-backup.sh restore "$(find /backups/argos-mcp -name "config_*.tar.gz" | head -1)"
 
 # Validate recovery
 if grep -q "database.production" config.ini; then
 log " Configuration recovery test PASSED"
 echo "PASS" > "${TEST_RESULTS_DIR}/config_recovery.result"
 else
 log " Configuration recovery test FAILED"
 echo "FAIL" > "${TEST_RESULTS_DIR}/config_recovery.result"
 cp config.ini.backup config.ini
 fi
}

# Test database recovery
test_database_recovery() {
 log "Testing database recovery..."
 
 local test_db="recovery_test_db"
 local latest_backup=$(find /backups/postgresql -name "full_*.sql.gz" | head -1)
 
 if [ -z "$latest_backup" ]; then
 log " No database backup found for testing"
 echo "SKIP" > "${TEST_RESULTS_DIR}/database_recovery.result"
 return
 fi
 
 # Restore to test database
 ./scripts/postgresql-backup.sh restore "$latest_backup" "$test_db"
 
 # Validate restore
 local table_count=$(psql -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" "$test_db" 2>/dev/null || echo "0")
 
 if [ "$table_count" -gt 0 ]; then
 log " Database recovery test PASSED ($table_count tables restored)"
 echo "PASS" > "${TEST_RESULTS_DIR}/database_recovery.result"
 else
 log " Database recovery test FAILED"
 echo "FAIL" > "${TEST_RESULTS_DIR}/database_recovery.result"
 fi
 
 # Cleanup test database
 dropdb "$test_db" 2>/dev/null || true
}

# Test point-in-time recovery
test_pitr() {
 log "Testing point-in-time recovery..."
 
 local test_db="pitr_test_db"
 local target_time=$(date -d "1 hour ago" '+%Y-%m-%d %H:%M:%S')
 local full_backup=$(find /backups/postgresql -name "full_*.sql.gz" | head -1)
 
 if [ -z "$full_backup" ]; then
 log " No full backup found for PITR test"
 echo "SKIP" > "${TEST_RESULTS_DIR}/pitr.result"
 return
 fi
 
 # Perform PITR
 ./scripts/postgresql-backup.sh pitr "$full_backup" "$target_time" "$test_db" || {
 log " Point-in-time recovery test FAILED"
 echo "FAIL" > "${TEST_RESULTS_DIR}/pitr.result"
 return
 }
 
 # Validate PITR
 if psql -l | grep -q "$test_db"; then
 log " Point-in-time recovery test PASSED"
 echo "PASS" > "${TEST_RESULTS_DIR}/pitr.result"
 else
 log " Point-in-time recovery test FAILED"
 echo "FAIL" > "${TEST_RESULTS_DIR}/pitr.result"
 fi
 
 # Cleanup
 dropdb "$test_db" 2>/dev/null || true
}

# Test disaster recovery orchestration
test_disaster_recovery() {
 log "Testing full disaster recovery orchestration..."
 
 # Create test scenario
 local scenario_config="/tmp/test_disaster_recovery.json"
 cat > "$scenario_config" <<EOF
{
 "backupSources": [
 {
 "type": "configuration",
 "location": "local",
 "path": "/backups/argos-mcp"
 }
 ],
 "recoveryTargets": [
 {
 "name": "configuration",
 "priority": 1,
 "dependencies": [],
 "recoverySteps": [
 {
 "name": "restore_config",
 "command": "echo 'test recovery step'",
 "timeout": 30,
 "retries": 2
 }
 ]
 }
 ],
 "notificationChannels": [],
 "recoveryTimeObjective": 30,
 "recoveryPointObjective": 60
}
EOF
 
 # Run disaster recovery test
 if node -e "
 const { DisasterRecoveryOrchestrator } = require('./dist/disaster-recovery');
 const recovery = new DisasterRecoveryOrchestrator('$scenario_config');
 recovery.initiateRecovery('test_scenario').then(success => {
 process.exit(success ? 0 : 1);
 });
 "; then
 log " Disaster recovery orchestration test PASSED"
 echo "PASS" > "${TEST_RESULTS_DIR}/disaster_recovery.result"
 else
 log " Disaster recovery orchestration test FAILED"
 echo "FAIL" > "${TEST_RESULTS_DIR}/disaster_recovery.result"
 fi
 
 rm -f "$scenario_config"
}

# Performance testing
test_recovery_performance() {
 log "Testing recovery performance..."
 
 local start_time=$(date +%s)
 local test_backup=$(find /backups/argos-mcp -name "config_*.tar.gz" | head -1)
 
 if [ -n "$test_backup" ]; then
 # Time the recovery process
 ./scripts/config-backup.sh restore "$test_backup" >/dev/null 2>&1
 local end_time=$(date +%s)
 local duration=$((end_time - start_time))
 
 # Check if within RTO (Recovery Time Objective)
 local rto=300 # 5 minutes
 if [ $duration -le $rto ]; then
 log " Recovery performance test PASSED (${duration}s <= ${rto}s)"
 echo "PASS" > "${TEST_RESULTS_DIR}/performance.result"
 else
 log " Recovery performance test FAILED (${duration}s > ${rto}s)"
 echo "FAIL" > "${TEST_RESULTS_DIR}/performance.result"
 fi
 
 echo "$duration" > "${TEST_RESULTS_DIR}/recovery_time.txt"
 else
 log " No backup found for performance testing"
 echo "SKIP" > "${TEST_RESULTS_DIR}/performance.result"
 fi
}

# Generate test report
generate_test_report() {
 log "Generating recovery test report..."
 
 local report_file="${TEST_RESULTS_DIR}/recovery_test_report.html"
 local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
 
 cat > "$report_file" <<EOF
<!DOCTYPE html>
<html>
<head>
 <title>Recovery Test Report</title>
 <style>
 body { font-family: Arial, sans-serif; margin: 20px; }
 .pass { color: green; font-weight: bold; }
 .fail { color: red; font-weight: bold; }
 .skip { color: orange; font-weight: bold; }
 table { border-collapse: collapse; width: 100%; }
 th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
 th { background-color: #f2f2f2; }
 </style>
</head>
<body>
 <h1>Argos-MCP Recovery Test Report</h1>
 <p>Generated: $timestamp</p>
 
 <h2>Test Results Summary</h2>
 <table>
 <tr><th>Test</th><th>Result</th><th>Details</th></tr>
EOF
 
 # Add test results to report
 for result_file in "${TEST_RESULTS_DIR}"/*.result; do
 if [ -f "$result_file" ]; then
 local test_name=$(basename "$result_file" .result)
 local result=$(cat "$result_file")
 local css_class=$(echo "$result" | tr '[:upper:]' '[:lower:]')
 
 echo "<tr><td>$test_name</td><td class=\"$css_class\">$result</td><td>-</td></tr>" >> "$report_file"
 fi
 done
 
 cat >> "$report_file" <<EOF
 </table>
 
 <h2>Recovery Time</h2>
 <p>Last recovery time: $(cat "${TEST_RESULTS_DIR}/recovery_time.txt" 2>/dev/null || echo "N/A") seconds</p>
 
 <h2>Test Log</h2>
 <pre>$(cat "${TEST_RESULTS_DIR}/test.log" 2>/dev/null || echo "No log available")</pre>
</body>
</html>
EOF
 
 log "Test report generated: $report_file"
}

# Cleanup test environment
cleanup_test_environment() {
 log "Cleaning up test environment..."
 
 # Restore original configuration
 if [ -f "${ORIGINAL_CONFIG_BACKUP}" ]; then
 tar -xzf "${ORIGINAL_CONFIG_BACKUP}" 2>/dev/null || true
 rm -f "${ORIGINAL_CONFIG_BACKUP}"
 fi
 
 # Cleanup Docker resources
 docker network rm recovery-test-net 2>/dev/null || true
 
 log "Test environment cleanup completed"
}

# Main execution
main() {
 local test_type="${1:-all}"
 
 prepare_test_environment
 
 case "$test_type" in
 "config")
 test_config_recovery
 ;;
 "database")
 test_database_recovery
 ;;
 "pitr")
 test_pitr
 ;;
 "disaster")
 test_disaster_recovery
 ;;
 "performance")
 test_recovery_performance
 ;;
 "all")
 test_config_recovery
 test_database_recovery
 test_pitr
 test_disaster_recovery
 test_recovery_performance
 ;;
 *)
 echo "Usage: $0 {config|database|pitr|disaster|performance|all}"
 exit 1
 ;;
 esac
 
 generate_test_report
 cleanup_test_environment
 
 log "Recovery testing completed"
}

# Execute main function
main "$@"
```

## Best Practices Summary

### Backup Strategy Best Practices

1. **3-2-1 Rule**: 3 copies of data, 2 different media types, 1 offsite
2. **Regular Testing**: Test backups monthly to ensure recoverability
3. **Encryption**: Encrypt backups both in transit and at rest
4. **Automation**: Automated backup processes with monitoring
5. **Documentation**: Clear recovery procedures and runbooks
6. **Retention Policies**: Appropriate retention based on business needs

### Recovery Planning Best Practices

1. **RTO/RPO Definition**: Clear Recovery Time and Point Objectives
2. **Prioritized Recovery**: Critical systems recovered first
3. **Communication Plan**: Clear escalation and communication procedures
4. **Regular Drills**: Quarterly disaster recovery testing
5. **Alternative Sites**: Prepared recovery locations
6. **Dependency Mapping**: Understanding of system dependencies

## Conclusion

This comprehensive backup and recovery guide provides the foundation for protecting the Argos-MCP against data loss and ensuring rapid recovery from disasters. Regular testing and refinement of these procedures ensures they remain effective as the system evolves.

The combination of automated backups, tested recovery procedures, and orchestrated disaster recovery provides multiple layers of protection for critical data and services.
