// src/classes/QueryCache.ts
import { createHash } from 'node:crypto';
import type { QueryResult } from '../types/index.js';

const NON_DETERMINISTIC_RE = /\b(now|rand|uuid|current_timestamp|sysdate|newid|random)\s*\(/i;
// Audit H5: extended to cover MERGE, UPSERT, GRANT, REVOKE, ATTACH, DETACH,
// VACUUM, REINDEX, and COPY — all of which modify data or schema and therefore
// must invalidate cached SELECT results. Without these, a MERGE could leave
// cached SELECTs stale for up to cache_ttl_seconds.
const MUTATION_RE =
  /^\s*(insert|update|delete|drop|truncate|alter|create|replace|merge|upsert|grant|revoke|attach|detach|vacuum|reindex|copy)\b/i;
const SELECT_RE = /^\s*select\b/i;

interface CacheEntry {
  result: QueryResult;
  expiresAt: number;
}
interface QueryCacheOptions {
  maxEntriesPerDb?: number;
}

function normalise(sql: string): string {
  return sql.replace(/\s+/g, ' ').toLowerCase().trim();
}

function makeKey(dbName: string, sql: string, params: unknown[]): string {
  return createHash('sha256')
    .update(dbName + '\x00' + normalise(sql) + '\x00' + JSON.stringify(params))
    .digest('hex');
}

/**
 *
 */
export class QueryCache {
  private readonly store = new Map<string, Map<string, CacheEntry>>();
  private readonly maxEntries: number;

  constructor(options: QueryCacheOptions = {}) {
    this.maxEntries = options.maxEntriesPerDb ?? 100;
  }

  /**
   *
   */
  shouldCache(sql: string): boolean {
    if (!SELECT_RE.test(sql)) return false;
    if (NON_DETERMINISTIC_RE.test(sql)) return false;
    return true;
  }
  /**
   *
   */
  isMutation(sql: string): boolean {
    return MUTATION_RE.test(sql);
  }

  /**
   *
   */
  get(dbName: string, sql: string, params: unknown[]): QueryResult | undefined {
    if (!this.shouldCache(sql)) return undefined;
    const db = this.store.get(dbName);
    if (!db) return undefined;
    const key = makeKey(dbName, sql, params);
    const entry = db.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      db.delete(key);
      return undefined;
    }
    db.delete(key);
    db.set(key, entry); // refresh LRU
    return entry.result;
  }

  /**
   *
   */
  set(
    dbName: string,
    sql: string,
    params: unknown[],
    result: QueryResult,
    ttlSeconds: number
  ): void {
    if (!this.shouldCache(sql)) return;
    let db = this.store.get(dbName);
    if (!db) {
      db = new Map();
      this.store.set(dbName, db);
    }
    const key = makeKey(dbName, sql, params);
    if (db.size >= this.maxEntries && !db.has(key)) {
      const oldest = db.keys().next().value;
      if (oldest !== undefined) db.delete(oldest);
    }
    db.set(key, { result, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /**
   *
   */
  invalidate(dbName: string): void {
    this.store.get(dbName)?.clear();
  }
}
