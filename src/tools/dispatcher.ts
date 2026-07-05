/**
 * Tool Call Dispatcher
 * Routes MCP tool calls to the appropriate handler
 */

import type { MCPToolResponse } from '../types/index.js';
import {
  isSQLQueryArgs,
  isSQLBatchQueryArgs,
  isSQLGetSchemaArgs,
  isSQLTestConnectionArgs,
} from '../types/index.js';
import {
  handleSqlQuery,
  handleBatchQuery,
  handleAnalyzePerformance,
} from './handlers/query-handlers.js';
import {
  handleGetSchema,
  handleRefreshSchema,
  handleListDatabases,
  handleTestConnection,
} from './handlers/schema-handlers.js';
import {
  handleAddDatabase,
  handleUpdateDatabase,
  handleRemoveDatabase,
  handleGetConfig,
  handleSetMcpConfigurable,
} from './handlers/config-handlers.js';
import { handleGetMetrics } from './handlers/metrics-handlers.js';
import type { ToolHandlerContext } from './handlers/types.js';
import { ValidationError } from '../utils/error-handler.js';

export type ToolDispatchFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<MCPToolResponse>;

// Serialize config-mutating tool calls (add/update/remove/set_mcp_configurable). Each does a
// read-modify-write of the shared config object and config.ini; running them one-at-a-time
// prevents interleaving from corrupting the registry or the file (FIND-117). Read-only tools
// are unaffected.
let configMutationChain: Promise<unknown> = Promise.resolve();
function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = configMutationChain.then(fn, fn);
  // Keep the chain alive regardless of success/failure of the prior mutation.
  configMutationChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 *
 */
export function createToolDispatcher(ctx: ToolHandlerContext): ToolDispatchFn {
  return async (name: string, args: Record<string, unknown>): Promise<MCPToolResponse> => {
    switch (name) {
      case 'sql_query':
        if (!isSQLQueryArgs(args)) {
          throw new ValidationError(
            "Missing required arguments: 'database' and 'query' are required"
          );
        }
        return handleSqlQuery(ctx, args);

      case 'sql_batch_query':
        if (!isSQLBatchQueryArgs(args)) {
          throw new ValidationError(
            "Missing required arguments: 'database' and 'queries' are required"
          );
        }
        return handleBatchQuery(ctx, args);

      case 'sql_analyze_performance':
        if (!args.database || !args.query) {
          throw new ValidationError(
            "Missing required arguments: 'database' and 'query' are required"
          );
        }
        return handleAnalyzePerformance(ctx, {
          database: args.database as string,
          query: args.query as string,
        });

      case 'sql_list_databases':
        return handleListDatabases(ctx);

      case 'sql_get_schema':
        if (!isSQLGetSchemaArgs(args)) {
          throw new ValidationError("Missing required argument: 'database' is required");
        }
        return handleGetSchema(ctx, args);

      case 'sql_test_connection':
        if (!isSQLTestConnectionArgs(args)) {
          throw new ValidationError("Missing required argument: 'database' is required");
        }
        return handleTestConnection(ctx, args);

      case 'sql_refresh_schema':
        if (!args.database) {
          throw new ValidationError("Missing required argument: 'database' is required");
        }
        return handleRefreshSchema(ctx, { database: args.database as string });

      case 'sql_add_database':
        if (!args.name || !args.type) {
          throw new ValidationError("Missing required arguments: 'name' and 'type' are required");
        }
        return withConfigLock(() => handleAddDatabase(ctx, args));

      case 'sql_update_database':
        if (!args.database) {
          throw new ValidationError("Missing required argument: 'database' is required");
        }
        return withConfigLock(() => handleUpdateDatabase(ctx, args));

      case 'sql_remove_database':
        if (!args.database) {
          throw new ValidationError("Missing required argument: 'database' is required");
        }
        return withConfigLock(() => handleRemoveDatabase(ctx, args.database as string));

      case 'sql_get_config':
        if (!args.database) {
          throw new ValidationError("Missing required argument: 'database' is required");
        }
        return handleGetConfig(ctx, args.database as string);

      case 'sql_set_mcp_configurable':
        if (!args.database || args.enabled === undefined) {
          throw new ValidationError(
            "Missing required arguments: 'database' and 'enabled' are required"
          );
        }
        return withConfigLock(() =>
          handleSetMcpConfigurable(ctx, args.database as string, args.enabled as boolean)
        );

      case 'sql_get_metrics':
        return handleGetMetrics(args as { database?: string }, ctx);

      default:
        throw new ValidationError(`Unknown tool: ${name}`);
    }
  };
}
