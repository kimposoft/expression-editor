/**
 * viewModelAdapter 往返保真单测。
 *
 * 判据与其余 V4 适配器单测同一原则（见 expressionModelAdapter.test.ts/controlModelAdapter.spec.ts/
 * writeModelAdapter.spec.ts 头注释）：**往返之后文档不变**——`xModelToV4ViewDoc(xDocToModel(doc, CTX), doc, CTX)`
 * 逐字等于 doc。本文件额外钉住视图专属的三处"缺省语义"：列顺序、null 单元格（仅组合视图）、
 * distinct/set_mode 的"未配置过"状态在往返中不被垫成默认值。
 */
import { describe, expect, it } from 'vitest';
import {
  v4ViewDocToRegularModel,
  regularModelToV4ViewDoc,
  v4ViewDocToCombinedModel,
  combinedModelToV4ViewDoc,
  type V4RegularViewModel,
  type V4CombinedViewModel
} from './viewModelAdapter';
import {
  emptyRegularView,
  emptyCombinedView,
  generateViewColumnId,
  generateDataGroupId,
  effectiveViewDistinct,
  effectiveViewSetMode,
  isRegularView,
  isCombinedView
} from './viewDefinition';
import type { V4ViewDocument } from './viewDefinition';
import type { V4ModelAdapterContext } from './expressionModelAdapter';

const CTX: V4ModelAdapterContext = {
  templateId: '',
  readableTextOf: (_id, tokenized) => tokenized
};

/** 一份常规视图文档：一个目录来源 + 两列（其中一列表达式带引用）。 */
function makeRegularDoc(): V4ViewDocument {
  return {
    schema_version: 'kimpo.view/v4',
    view_type: 'regular',
    columns: [
      { column_id: 'col_aaaaaaaa', name: '客户名称' },
      { column_id: 'col_bbbbbbbb', name: '应收余额' }
    ],
    regular: {
      query: {
        sources: [
          { kind: 'catalog', instance_id: 'cat-ar-a1', alias: '应收明细', app_id: 'app-1', template_id: 'tpl-ar', data_table_id: 'tbl-ar' }
        ],
        joins: [],
        options: { distinct: false, business_timezone: 'UTC' }
      },
      values: {
        col_aaaaaaaa: {
          expression_id: 'view:col_aaaaaaaa',
          purpose: 'output',
          source_text: '[客户名称]#{r1}',
          refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-ar-a1', field_id: 'fld-customer', last_label: '[应收明细].[客户名称]' }]
        },
        col_bbbbbbbb: {
          expression_id: 'view:col_bbbbbbbb',
          purpose: 'output',
          source_text: '[应收余额]#{r1}',
          refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-ar-a1', field_id: 'fld-balance', last_label: '[应收明细].[应收余额]' }]
        }
      },
      distinct: false
    }
  };
}

/** 一份组合视图文档：两组，各自不同来源，第二组「应收余额」列显式留空（null）。 */
function makeCombinedDoc(): V4ViewDocument {
  return {
    schema_version: 'kimpo.view/v4',
    view_type: 'combined',
    columns: [
      { column_id: 'col_aaaaaaaa', name: '客户名称' },
      { column_id: 'col_bbbbbbbb', name: '应收余额' }
    ],
    combined: {
      set_mode: 'union_all',
      groups: [
        {
          group_id: 'g_11111111',
          label: '国内客户',
          query: {
            sources: [
              { kind: 'catalog', instance_id: 'cat-ar-a1', alias: '国内应收', app_id: 'app-1', template_id: 'tpl-ar', data_table_id: 'tbl-ar-cn' }
            ],
            joins: [],
            options: { distinct: false, business_timezone: 'UTC' }
          },
          values: {
            col_aaaaaaaa: {
              expression_id: 'view:g_11111111:col_aaaaaaaa',
              purpose: 'output',
              source_text: '[客户名称]#{r1}',
              refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-ar-a1', field_id: 'fld-customer', last_label: '[国内应收].[客户名称]' }]
            },
            col_bbbbbbbb: {
              expression_id: 'view:g_11111111:col_bbbbbbbb',
              purpose: 'output',
              source_text: '[应收余额]#{r1}',
              refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-ar-a1', field_id: 'fld-balance', last_label: '[国内应收].[应收余额]' }]
            }
          }
        },
        {
          group_id: 'g_22222222',
          label: '海外客户',
          query: {
            sources: [
              { kind: 'catalog', instance_id: 'cat-ar-b2', alias: '海外应收', app_id: 'app-1', template_id: 'tpl-ar', data_table_id: 'tbl-ar-os' }
            ],
            joins: [],
            options: { distinct: false, business_timezone: 'UTC' }
          },
          values: {
            col_aaaaaaaa: {
              expression_id: 'view:g_22222222:col_aaaaaaaa',
              purpose: 'output',
              source_text: '[客户名称]#{r1}',
              refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-ar-b2', field_id: 'fld-customer', last_label: '[海外应收].[客户名称]' }]
            },
            // 该组这一列显式留空。
            col_bbbbbbbb: null
          }
        }
      ]
    }
  };
}

describe('viewDefinition：判别守卫 / 空白构造 / id 生成', () => {
  it('isRegularView/isCombinedView 按 view_type 与对应段是否非空判别', () => {
    const regular = makeRegularDoc();
    const combined = makeCombinedDoc();
    expect(isRegularView(regular)).toBe(true);
    expect(isCombinedView(regular)).toBe(false);
    expect(isRegularView(combined)).toBe(false);
    expect(isCombinedView(combined)).toBe(true);
  });

  it('emptyRegularView：无列、query 为空查询、values 为空映射、排除重复默认开', () => {
    const doc = emptyRegularView();
    expect(doc.view_type).toBe('regular');
    expect(doc.columns).toEqual([]);
    expect(doc.regular?.query.sources).toEqual([]);
    expect(doc.regular?.values).toEqual({});
    expect(doc.regular?.distinct).toBe(true);
  });

  it('emptyCombinedView：默认两个数据组，group_id 格式合法且互不相同', () => {
    const doc = emptyCombinedView();
    expect(doc.view_type).toBe('combined');
    expect(doc.combined?.groups).toHaveLength(2);
    const ids = doc.combined!.groups.map(g => g.group_id);
    for (const id of ids) expect(id).toMatch(/^g_[0-9a-f]{8}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('generateViewColumnId：col_ + 8 位小写十六进制', () => {
    const id = generateViewColumnId();
    expect(id).toMatch(/^col_[0-9a-f]{8}$/);
  });

  it('generateDataGroupId：g_ + 8 位小写十六进制，重复调用不撞号', () => {
    const a = generateDataGroupId();
    const b = generateDataGroupId();
    expect(a).toMatch(/^g_[0-9a-f]{8}$/);
    expect(b).toMatch(/^g_[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it('effectiveViewDistinct/effectiveViewSetMode：未提供时回落产品默认值，提供时按字面值', () => {
    expect(effectiveViewDistinct(undefined)).toBe(true);
    expect(effectiveViewDistinct(false)).toBe(false);
    expect(effectiveViewDistinct(true)).toBe(true);
    expect(effectiveViewSetMode(undefined)).toBe('union');
    expect(effectiveViewSetMode('union_all')).toBe('union_all');
  });
});

describe('viewModelAdapter：常规视图往返', () => {
  it('正向：列顺序与 doc.columns 一致，取值表达式的可读文本正确', () => {
    const doc = makeRegularDoc();
    const { model, columns, distinct } = v4ViewDocToRegularModel(doc, CTX);
    expect(columns.map(c => c.column_id)).toEqual(['col_aaaaaaaa', 'col_bbbbbbbb']);
    expect(columns[0]).toMatchObject({ name: '客户名称' });
    expect(columns[0]?.value?.text_source?.text).toBe('[客户名称]#{r1}');
    expect(distinct).toBe(false);
    expect(model.source.tables).toHaveLength(1);
    expect(model.source.tables[0]).toMatchObject({ source_type: 'template', data_table_id: 'tbl-ar' });
  });

  it('往返逐字保真（含 distinct=false 显式值）', () => {
    const doc = makeRegularDoc();
    const input = v4ViewDocToRegularModel(doc, CTX);
    const back = regularModelToV4ViewDoc(input, doc, CTX);
    expect(back).toEqual(doc);
  });

  it('distinct 缺省语义原样保留：文档没有 distinct 键时，往返后仍没有这个键（不被垫成 true）', () => {
    const doc = makeRegularDoc();
    delete doc.regular!.distinct;
    const input = v4ViewDocToRegularModel(doc, CTX);
    expect(input.distinct).toBeUndefined();
    const back = regularModelToV4ViewDoc(input, doc, CTX);
    expect(back.regular).not.toHaveProperty('distinct');
    expect(back).toEqual(doc);
  });

  it('v4ViewDocToRegularModel 对非常规视图文档具名抛错', () => {
    const combined = makeCombinedDoc();
    expect(() => v4ViewDocToRegularModel(combined, CTX)).toThrow();
  });

  it('编辑：改一列的取值表达式后，写回时该列 expression_id 保持不变（按 column_id 命中 prev）', () => {
    const doc = makeRegularDoc();
    const input = v4ViewDocToRegularModel(doc, CTX);
    input.columns[0]!.value = { kind: 'raw', text: '[客户简称]#{r1}', text_source: { text: '[客户简称]#{r1}', pack_revision: 'alice-v4', digest: '', refs: [] } };
    const back = regularModelToV4ViewDoc(input, doc, CTX);
    expect(back.regular!.values.col_aaaaaaaa!.expression_id).toBe('view:col_aaaaaaaa');
    expect(back.regular!.values.col_aaaaaaaa!.source_text).toBe('[客户简称]#{r1}');
    // 未改动的第二列表达式逐字不变（未编辑判据沿用 expressionModelAdapter 的 valueRefToV4Expression）。
    expect(back.regular!.values.col_bbbbbbbb).toEqual(doc.regular!.values.col_bbbbbbbb);
  });

  it('新建空白常规视图 → 加一列 → 写回：column_id 与 values 键一致，query 为空查询', () => {
    const blank = emptyRegularView();
    const input = v4ViewDocToRegularModel(blank, CTX);
    const columnId = generateViewColumnId();
    const model: V4RegularViewModel = {
      ...input,
      columns: [{ column_id: columnId, name: '新列', value: { kind: 'raw', text: '1' } }]
    };
    const back = regularModelToV4ViewDoc(model, blank, CTX);
    expect(back.columns).toEqual([{ column_id: columnId, name: '新列' }]);
    expect(back.regular!.values[columnId]?.source_text).toBe('1');
    expect(back.regular!.query.sources).toEqual([]);
  });
});

describe('viewModelAdapter：组合视图往返', () => {
  it('正向：每组各自的 ExpressionModel 来源不互串，null 单元格原样识别', () => {
    const doc = makeCombinedDoc();
    const { columns, set_mode, groups } = v4ViewDocToCombinedModel(doc, CTX);
    expect(columns).toEqual([
      { column_id: 'col_aaaaaaaa', name: '客户名称' },
      { column_id: 'col_bbbbbbbb', name: '应收余额' }
    ]);
    expect(set_mode).toBe('union_all');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.model.source.tables[0]).toMatchObject({ data_table_id: 'tbl-ar-cn' });
    expect(groups[1]!.model.source.tables[0]).toMatchObject({ data_table_id: 'tbl-ar-os' });
    // 第二组第二列（应收余额）显式留空。
    expect(groups[1]!.values.find(v => v.column_id === 'col_bbbbbbbb')?.value).toBeNull();
    expect(groups[1]!.values.find(v => v.column_id === 'col_aaaaaaaa')?.value).not.toBeNull();
  });

  it('往返逐字保真（含 union_all 与 null 单元格）', () => {
    const doc = makeCombinedDoc();
    const input = v4ViewDocToCombinedModel(doc, CTX);
    const back = combinedModelToV4ViewDoc(input, doc, CTX);
    expect(back).toEqual(doc);
  });

  it('set_mode 缺省语义原样保留：文档没有 set_mode 键时，往返后仍没有这个键（不被垫成 union）', () => {
    const doc = makeCombinedDoc();
    delete doc.combined!.set_mode;
    const input = v4ViewDocToCombinedModel(doc, CTX);
    expect(input.set_mode).toBeUndefined();
    const back = combinedModelToV4ViewDoc(input, doc, CTX);
    expect(back.combined).not.toHaveProperty('set_mode');
    expect(back).toEqual(doc);
  });

  it('v4ViewDocToCombinedModel 对非组合视图文档具名抛错', () => {
    const regular = makeRegularDoc();
    expect(() => v4ViewDocToCombinedModel(regular, CTX)).toThrow();
  });

  it('把某组某列从「留空」改成「填表达式」：写回该组该列不再是 null，其余组/列不受影响', () => {
    const doc = makeCombinedDoc();
    const input = v4ViewDocToCombinedModel(doc, CTX);
    const cell = input.groups[1]!.values.find(v => v.column_id === 'col_bbbbbbbb')!;
    cell.value = { kind: 'raw', text: '0', text_source: { text: '0', pack_revision: 'alice-v4', digest: '', refs: [] } };
    const back = combinedModelToV4ViewDoc(input, doc, CTX);
    expect(back.combined!.groups[1]!.values.col_bbbbbbbb).toMatchObject({ source_text: '0' });
    expect(back.combined!.groups[0]!.values).toEqual(doc.combined!.groups[0]!.values);
  });

  it('反过来：把已填的单元格改成留空（null），写回该键落 null 而不是空文本表达式', () => {
    const doc = makeCombinedDoc();
    const input = v4ViewDocToCombinedModel(doc, CTX);
    input.groups[0]!.values.find(v => v.column_id === 'col_bbbbbbbb')!.value = null;
    const back = combinedModelToV4ViewDoc(input, doc, CTX);
    expect(back.combined!.groups[0]!.values.col_bbbbbbbb).toBeNull();
  });

  it('新增一个数据组（prev 没有对应 group_id）：query 退回空查询，不报错', () => {
    const doc = makeCombinedDoc();
    const input = v4ViewDocToCombinedModel(doc, CTX);
    const newGroupId = generateDataGroupId();
    const extended: V4CombinedViewModel = {
      ...input,
      groups: [
        ...input.groups,
        {
          group_id: newGroupId,
          label: '港澳台客户',
          model: v4ViewDocToRegularModel(emptyRegularView(), CTX).model,
          values: input.columns.map(c => ({ column_id: c.column_id, value: null }))
        }
      ]
    };
    const back = combinedModelToV4ViewDoc(extended, doc, CTX);
    expect(back.combined!.groups).toHaveLength(3);
    const added = back.combined!.groups.find(g => g.group_id === newGroupId);
    expect(added?.query.sources).toEqual([]);
    expect(added?.values).toEqual({ col_aaaaaaaa: null, col_bbbbbbbb: null });
  });
});
