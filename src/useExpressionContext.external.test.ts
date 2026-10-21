import { describe, expect, it } from 'vitest';
import { useExpressionContext, externalColumnToTemplateField } from './useExpressionContext';
import type { ExpressionHost } from './host';

/** 最小可用 ExpressionHost（未用到的方法均给出安全占位实现）。 */
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
 *  （见 useExpressionContext.ts ExpressionContextOptions.host 注释：顶层弹窗自 provide 场景的同一豁免），
 *  避免必须搭一个真实的 setup()/inject 环境才能测这段纯逻辑。 */
function makeCtx(host: ExpressionHost) {
  return useExpressionContext({ templateId: 'tpl_x', host });
}

describe('externalColumnToTemplateField（S2b：logical_type → TemplateField.data_type 映射）', () => {
  it('BOOL/INT/DECIMAL/TEXT/DATE/DATETIME 六档均映射到编辑器既有 data_type 枚举', () => {
    const cases: Array<[string, string]> = [
      ['BOOL', 'boolean'],
      ['INT', 'number'],
      ['DECIMAL', 'number'],
      ['TEXT', 'text'],
      ['DATE', 'date'],
      ['DATETIME', 'datetime']
    ];
    for (const [type, expected] of cases) {
      const field = externalColumnToTemplateField({ code: 'c1', name: '列1', type }, 0);
      expect(field.data_type).toBe(expected);
    }
  });

  it('未知/未来新增类型按 R3 同一兜底规则置 text，不阻断字段面板渲染', () => {
    const field = externalColumnToTemplateField({ code: 'c1', name: '列1', type: 'JSON' }, 0);
    expect(field.data_type).toBe('text');
  });

  it('field_id/field_code 均取列名（code），sort_no 用 index 兜底保持后端声明顺序', () => {
    const field = externalColumnToTemplateField({ code: 'amount', name: '金额', type: 'DECIMAL' }, 3);
    expect(field.field_id).toBe('amount');
    expect(field.field_code).toBe('amount');
    expect(field.field_name).toBe('金额');
    expect(field.sort_no).toBe(3);
    expect(field.is_list_visible).toBe(true);
  });
});

describe('useExpressionContext().ensureExternalFields（S2b：安全恒绿——filter_only 列绝不进入字段列表）', () => {
  it('①只收 access_mode="usable" 列，filter_only 列被过滤掉', async () => {
    const ctx = makeCtx(
      makeHost({
        getExternalSchema: async () => ({
          object_name: '外部客户表',
          columns: [
            { code: 'id', name: 'ID', type: 'TEXT', access_mode: 'usable' },
            { code: 'tenant_id', name: '租户ID', type: 'TEXT', access_mode: 'filter_only' },
            { code: 'amount', name: '金额', type: 'DECIMAL', access_mode: 'usable' }
          ]
        })
      })
    );
    const fields = await ctx.ensureExternalFields('obj_1');
    expect(fields.map(f => f.field_id)).toEqual(['id', 'amount']);
    expect(fields.some(f => f.field_id === 'tenant_id')).toBe(false);
  });

  it('②全部为 filter_only 时字段列表为空（不误把边界列露出）', async () => {
    const ctx = makeCtx(
      makeHost({
        getExternalSchema: async () => ({
          object_name: '外部表',
          columns: [{ code: 'tenant_id', name: '租户ID', type: 'TEXT', access_mode: 'filter_only' }]
        })
      })
    );
    const fields = await ctx.ensureExternalFields('obj_2');
    expect(fields).toEqual([]);
  });

  it('③host 未实现 getExternalSchema：不抛错，静默降级为空字段列表', async () => {
    const ctx = makeCtx(makeHost()); // 不传 getExternalSchema
    await expect(ctx.ensureExternalFields('obj_3')).resolves.toEqual([]);
  });

  it('④host 调用失败：不抛错，与"不支持"走同一降级路径', async () => {
    const ctx = makeCtx(
      makeHost({
        getExternalSchema: async () => {
          throw new Error('boom');
        }
      })
    );
    await expect(ctx.ensureExternalFields('obj_4')).resolves.toEqual([]);
  });

  it('⑤缓存命中：第二次调用不重复请求 host', async () => {
    let calls = 0;
    const ctx = makeCtx(
      makeHost({
        getExternalSchema: async () => {
          calls += 1;
          return { object_name: '外部表', columns: [{ code: 'id', name: 'ID', type: 'TEXT', access_mode: 'usable' as const }] };
        }
      })
    );
    await ctx.ensureExternalFields('obj_5');
    await ctx.ensureExternalFields('obj_5');
    expect(calls).toBe(1);
  });

  it('⑥externalName：加载成功后返回登记对象展示名，未加载/未知时返回 undefined', async () => {
    const ctx = makeCtx(
      makeHost({
        getExternalSchema: async () => ({
          object_name: '外部客户表',
          columns: [{ code: 'id', name: 'ID', type: 'TEXT', access_mode: 'usable' as const }]
        })
      })
    );
    expect(ctx.externalName('obj_6')).toBeUndefined();
    await ctx.ensureExternalFields('obj_6');
    expect(ctx.externalName('obj_6')).toBe('外部客户表');
    expect(ctx.externalName('obj_unknown')).toBeUndefined();
  });
});
