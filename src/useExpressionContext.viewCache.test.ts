import { describe, expect, it } from 'vitest';
import { useExpressionContext } from './useExpressionContext';
import type { ExpressionHost, ViewCatalogEntry } from './host';

function makeHost(overrides: Partial<ExpressionHost> = {}): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async () => [],
    listFields: async () => [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    ...overrides
  };
}

/** 在 Vue 响应式上下文之外直接调用 useExpressionContext 时，用 options.host 显式传入
 *  （见 useExpressionContext.ts ExpressionContextOptions.host 注释），避免必须搭一个真实的
 *  setup()/inject 环境才能测这段纯逻辑。 */
function makeCtx(host: ExpressionHost) {
  return useExpressionContext({ templateId: 'tpl_x', host });
}

describe('useExpressionContext().ensureViewFields（appId, viewId 组合键）', () => {
  it('①未传 appId：调用 host.getViewSchema 时 appId 实参为 undefined，与改造前单参调用行为一致', async () => {
    const calls: Array<[string, string | undefined]> = [];
    const ctx = makeCtx(
      makeHost({
        getViewSchema: async (viewId, appId) => {
          calls.push([viewId, appId]);
          return { view_name: '视图A', columns: [{ code: 'a', name: 'A', type: 'text' }] };
        }
      })
    );
    const fields = await ctx.ensureViewFields('v1');
    expect(calls).toEqual([['v1', undefined]]);
    expect(fields.map(f => f.field_id)).toEqual(['a']);
  });

  it('②透传 appId：host.getViewSchema 收到显式 appId 实参', async () => {
    const calls: Array<[string, string | undefined]> = [];
    const ctx = makeCtx(
      makeHost({
        getViewSchema: async (viewId, appId) => {
          calls.push([viewId, appId]);
          return { view_name: '视图A', columns: [] };
        }
      })
    );
    await ctx.ensureViewFields('v1', 'app-b');
    expect(calls).toEqual([['v1', 'app-b']]);
  });

  it('③同一 view_id、不同 appId：各自独立缓存，各发一次请求，互不覆盖', async () => {
    let calls = 0;
    const ctx = makeCtx(
      makeHost({
        getViewSchema: async (viewId, appId) => {
          calls += 1;
          return {
            view_name: `视图-${appId ?? 'current'}`,
            columns: appId === 'app-b' ? [{ code: 'x', name: 'X', type: 'text' }] : [{ code: 'y', name: 'Y', type: 'text' }]
          };
        }
      })
    );
    const currentFields = await ctx.ensureViewFields('v1');
    const otherFields = await ctx.ensureViewFields('v1', 'app-b');
    expect(calls).toBe(2);
    expect(currentFields.map(f => f.field_id)).toEqual(['y']);
    expect(otherFields.map(f => f.field_id)).toEqual(['x']);
    // 缓存命中：再次以相同参数调用不重复请求。
    await ctx.ensureViewFields('v1');
    await ctx.ensureViewFields('v1', 'app-b');
    expect(calls).toBe(2);
  });

  it('④缺省调用（appId 缺省）缓存命中逻辑与改造前一致：连续两次裸 viewId 调用只发一次请求', async () => {
    let calls = 0;
    const ctx = makeCtx(
      makeHost({
        getViewSchema: async () => {
          calls += 1;
          return { view_name: '视图A', columns: [] };
        }
      })
    );
    await ctx.ensureViewFields('v1');
    await ctx.ensureViewFields('v1');
    expect(calls).toBe(1);
  });
});

describe('useExpressionContext().ensureViewMeta', () => {
  const CATALOG: ViewCatalogEntry[] = [
    { view_id: 'v1', view_name: '出入库流水', view_type: 'regular', column_count: 5 },
    { view_id: 'v2', view_name: '汇总视图', view_type: 'combined', column_count: 3 }
  ];

  it('①按 view_id 命中目录条目，返回类型 + 列数', async () => {
    const ctx = makeCtx(makeHost({ listViews: async () => CATALOG }));
    await expect(ctx.ensureViewMeta('v1')).resolves.toEqual({ view_type: 'regular', column_count: 5 });
    await expect(ctx.ensureViewMeta('v2')).resolves.toEqual({ view_type: 'combined', column_count: 3 });
  });

  it('②同一 appId 下的目录只整批拉取一次，供多个视图复用', async () => {
    let calls = 0;
    const ctx = makeCtx(
      makeHost({
        listViews: async () => {
          calls += 1;
          return CATALOG;
        }
      })
    );
    await ctx.ensureViewMeta('v1');
    await ctx.ensureViewMeta('v2');
    expect(calls).toBe(1);
  });

  it('③宿主未实现 listViews：不抛错，返回 undefined', async () => {
    const ctx = makeCtx(makeHost());
    await expect(ctx.ensureViewMeta('v1')).resolves.toBeUndefined();
  });

  it('④目录里找不到该 view_id：返回 undefined，不阻断', async () => {
    const ctx = makeCtx(makeHost({ listViews: async () => CATALOG }));
    await expect(ctx.ensureViewMeta('v-unknown')).resolves.toBeUndefined();
  });

  it('⑤host.listViews 调用失败：静默返回 undefined，与"不支持"走同一降级路径', async () => {
    const ctx = makeCtx(
      makeHost({
        listViews: async () => {
          throw new Error('boom');
        }
      })
    );
    await expect(ctx.ensureViewMeta('v1')).resolves.toBeUndefined();
  });

  it('⑥appId 缺省与显式传入分别缓存（不同应用目录互不覆盖）', async () => {
    const calls: Array<string | undefined> = [];
    const ctx = makeCtx(
      makeHost({
        listViews: async appId => {
          calls.push(appId);
          return appId === 'app-b' ? [{ view_id: 'v1', view_name: 'B视图', view_type: 'combined', column_count: 9 }] : CATALOG;
        }
      })
    );
    await expect(ctx.ensureViewMeta('v1')).resolves.toEqual({ view_type: 'regular', column_count: 5 });
    await expect(ctx.ensureViewMeta('v1', 'app-b')).resolves.toEqual({ view_type: 'combined', column_count: 9 });
    expect(calls).toEqual([undefined, 'app-b']);
  });
});
