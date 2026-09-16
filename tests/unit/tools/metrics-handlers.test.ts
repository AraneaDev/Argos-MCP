import { handleGetMetrics } from '../../../src/tools/handlers/metrics-handlers.js';
import type { ToolHandlerContext } from '../../../src/tools/handlers/types.js';

function createMockContext(snapshot: unknown): ToolHandlerContext {
  return {
    metricsManager: {
      getSnapshot: jest.fn().mockReturnValue(snapshot),
    } as any,
  } as ToolHandlerContext;
}

describe('metrics-handlers', () => {
  it('returns metrics for the requested database', async () => {
    const snapshot = { database: 'primary', queries: { total: 3 } };
    const ctx = createMockContext(snapshot);

    const result = await handleGetMetrics({ database: 'primary' }, ctx);

    expect(ctx.metricsManager.getSnapshot).toHaveBeenCalledWith('primary');
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
      _meta: { progressToken: null },
    });
  });

  it('returns metrics for all databases when no database is supplied', async () => {
    const snapshot = [{ database: 'primary' }, { database: 'analytics' }];
    const ctx = createMockContext(snapshot);

    const result = await handleGetMetrics({}, ctx);

    expect(ctx.metricsManager.getSnapshot).toHaveBeenCalledWith();
    expect(result.content[0]).toEqual({
      type: 'text',
      text: JSON.stringify(snapshot, null, 2),
    });
    expect(result._meta).toEqual({ progressToken: null });
  });
});
