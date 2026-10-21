import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import AdvancedExpressionPanel from './AdvancedExpressionPanel.vue';
import { EXPRESSION_HOST, type ExpressionHost } from './host';
import {
  ensureCatalogLoaded,
  isCompareOperatorAvailable,
  publicExpressionCapabilities,
  type ExpressionCatalog,
  type PublicExpressionCapabilities
} from './useExpressionContext';

vi.mock('naive-ui', () => ({
  useMessage: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn() })
}));

function catalog(capability: PublicExpressionCapabilities): ExpressionCatalog {
  return { system_variables: [], functions: [], window_functions: [], public_capabilities: capability };
}

function capability(mode: 'NATIVE' | 'UNSUPPORTED'): PublicExpressionCapabilities {
  return {
    schema_version: 2,
    text_equality_distinct_ordering: 'TARGET_DATABASE_NATIVE',
    pattern_matching_mode: mode,
    compare_operators: mode === 'NATIVE' ? ['eq', 'neq', 'in', 'not_in', 'like'] : ['eq', 'neq', 'in', 'not_in']
  };
}

function host(loadCatalog: () => Promise<ExpressionCatalog>): ExpressionHost {
  return { loadCatalog } as ExpressionHost;
}

function mountAdvancedPanel() {
  return mount(AdvancedExpressionPanel, {
    props: { show: true, modelValue: null, sourceTables: [], formTables: [], shellHeight: 660 },
    global: {
      provide: { [EXPRESSION_HOST as unknown as string]: {} },
      stubs: { FieldTreeDock: true, OperatorFunctionBar: true }
    }
  });
}

describe('public expression capability', () => {
  it('加载失败与缺失 capability 时 pattern fail-closed，但核心比较保留', async () => {
    await ensureCatalogLoaded(host(async () => catalog(capability('NATIVE'))));
    expect(isCompareOperatorAvailable('like')).toBe(true);

    await ensureCatalogLoaded(host(async () => Promise.reject(new Error('offline'))));
    expect(isCompareOperatorAvailable('like')).toBe(false);
    expect(isCompareOperatorAvailable('eq')).toBe(true);
    expect(isCompareOperatorAvailable('in')).toBe(true);
    // E10：between/not_between 与 eq/in 同属核心比较算子，fail-closed 时同样保留
    // （CORE_COMPARE_OPERATORS 已含它们，见 useExpressionContext.ts）。
    expect(isCompareOperatorAvailable('between')).toBe(true);
    expect(isCompareOperatorAvailable('not_between')).toBe(true);

    await ensureCatalogLoaded(host(async () => ({ system_variables: [], functions: [], window_functions: [] })));
    expect(publicExpressionCapabilities.value.pattern_matching_mode).toBe('UNSUPPORTED');
    expect(isCompareOperatorAvailable('like')).toBe(false);
    expect(isCompareOperatorAvailable('between')).toBe(true);
    expect(isCompareOperatorAvailable('not_between')).toBe(true);
  });

  it('切换 host 时立即清空旧 LIKE，且旧请求迟到不能覆盖新 profile', async () => {
    await ensureCatalogLoaded(host(async () => catalog(capability('NATIVE'))));
    expect(isCompareOperatorAvailable('like')).toBe(true);

    let resolveOld!: (value: ExpressionCatalog) => void;
    const oldRequest = ensureCatalogLoaded(host(() => new Promise(resolve => (resolveOld = resolve))));
    // 新请求一开始就必须清掉上一实例的 capability，不能等待网络返回。
    expect(isCompareOperatorAvailable('like')).toBe(false);

    await ensureCatalogLoaded(host(async () => catalog(capability('UNSUPPORTED'))));
    expect(isCompareOperatorAvailable('like')).toBe(false);

    resolveOld(catalog(capability('NATIVE')));
    await oldRequest;
    expect(isCompareOperatorAvailable('like')).toBe(false);
  });

  it('UNSUPPORTED 响应即使错误携带 like 也会被客户端裁掉', async () => {
    const malformed = capability('UNSUPPORTED');
    malformed.compare_operators.push('like');
    await ensureCatalogLoaded(host(async () => catalog(malformed)));
    expect(isCompareOperatorAvailable('like')).toBe(false);
  });

  it('旧 schema 会 fail-closed，且不恢复旧统一 collation', async () => {
    await ensureCatalogLoaded(host(async () => catalog({
      ...capability('NATIVE'),
      schema_version: 1
    } as unknown as PublicExpressionCapabilities)));
    expect(isCompareOperatorAvailable('like')).toBe(false);
    expect(publicExpressionCapabilities.value).toEqual(expect.objectContaining({
      schema_version: 2,
      text_equality_distinct_ordering: 'TARGET_DATABASE_NATIVE',
      pattern_matching_mode: 'UNSUPPORTED'
    }));
    expect(publicExpressionCapabilities.value).not.toHaveProperty('collation_id');
  });

  it('NATIVE 显示自由文本 LIKE 提示，PG/unknown fail-closed 时隐藏', async () => {
    // MySQL 8 / SQL Server 2019 都由宿主返回同一个 NATIVE 公开形状。
    await ensureCatalogLoaded(host(async () => catalog(capability('NATIVE'))));
    const nativePanel = mountAdvancedPanel();
    expect(nativePanel.find('[data-testid="adv-text-mode-like-hint"]').exists()).toBe(true);
    nativePanel.unmount();

    await ensureCatalogLoaded(host(async () => catalog(capability('UNSUPPORTED'))));
    const postgresPanel = mountAdvancedPanel();
    expect(postgresPanel.find('[data-testid="adv-text-mode-like-hint"]').exists()).toBe(false);
    postgresPanel.unmount();

    await ensureCatalogLoaded(host(async () => Promise.reject(new Error('unknown profile'))));
    const unknownPanel = mountAdvancedPanel();
    expect(unknownPanel.find('[data-testid="adv-text-mode-like-hint"]').exists()).toBe(false);
    unknownPanel.unmount();
  });

  it('between/not_between 是核心比较算子：由服务端逐次声明控制，不因 pattern_matching_mode 增减而自动跟随 like', async () => {
    // UNSUPPORTED 模式下 like 会被拒（见上），但若后端在 compare_operators 里显式声明了 between/
    // not_between，不因 pattern_matching_mode!=='NATIVE' 被裁掉——二者是"区间比较"能力，与"文本模式
    // 匹配"能力（pattern_matching_mode 专管）无关，对齐后端 collation.PublicCapabilityForProfile
    //。
    await ensureCatalogLoaded(host(async () => catalog({
      schema_version: 2,
      text_equality_distinct_ordering: 'TARGET_DATABASE_NATIVE',
      pattern_matching_mode: 'UNSUPPORTED',
      compare_operators: ['eq', 'neq', 'in', 'not_in', 'between', 'not_between']
    })));
    expect(isCompareOperatorAvailable('between')).toBe(true);
    expect(isCompareOperatorAvailable('not_between')).toBe(true);
    expect(isCompareOperatorAvailable('like')).toBe(false);

    await ensureCatalogLoaded(host(async () => catalog({
      schema_version: 2,
      text_equality_distinct_ordering: 'TARGET_DATABASE_NATIVE',
      pattern_matching_mode: 'UNSUPPORTED',
      compare_operators: ['eq', 'neq', 'in', 'not_in']
    })));
    expect(isCompareOperatorAvailable('between')).toBe(false);
    expect(isCompareOperatorAvailable('not_between')).toBe(false);

    // fail-closed（离线/加载失败）：CORE_COMPARE_OPERATORS 已含 between/not_between，与 eq/in 同等级保留。
    await ensureCatalogLoaded(host(async () => Promise.reject(new Error('offline'))));
    expect(isCompareOperatorAvailable('between')).toBe(true);
    expect(isCompareOperatorAvailable('not_between')).toBe(true);
  });
});
