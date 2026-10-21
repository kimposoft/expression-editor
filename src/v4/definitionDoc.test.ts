import { describe, expect, it } from 'vitest';
import type { V4ExpressionDocument } from './definition';
import {
  FILTER_EXPRESSION_ID,
  applyDefinitionToState,
  buildDefinition,
  generateDefinitionId,
  joinExpressionId,
  outputExpressionId,
  type BuildDefinitionInput
} from './definitionDoc';

/**
 * definitionDoc.ts 单测：ExtractDefinitionV4 文档 ⇄ 页面状态 纯函数转换（批 1）。
 * 全部同步断言，不 mock 网络——buildDefinition/applyDefinitionToState 本身不发请求，
 * tokenize/restore 由调用方（页面）先行完成，这里直接构造已 tokenize/restore 好的输入。
 */

function makeDoc(expressionId: string, purpose: V4ExpressionDocument['purpose'], text = 'x'): V4ExpressionDocument {
  return {
    expression_id: expressionId,
    purpose,
    source_text: text,
    refs: [],
    normalized_digest: `digest-${expressionId}`
  };
}

describe('definitionDoc.ts — expression_id 约定', () => {
  it('joinExpressionId 按 join:<left>:<right> 拼接', () => {
    expect(joinExpressionId('si_customer', 'si_receivable')).toBe('join:si_customer:si_receivable');
  });
  it('outputExpressionId 按 output:<target_field_id> 拼接', () => {
    expect(outputExpressionId('f_r_customer_name')).toBe('output:f_r_customer_name');
  });
  it('FILTER_EXPRESSION_ID 固定为 filter', () => {
    expect(FILTER_EXPRESSION_ID).toBe('filter');
  });
});

describe('definitionDoc.ts — generateDefinitionId', () => {
  it('生成 def_ + 8 位小写 hex 的稳定形状，且两次调用不同', () => {
    const id1 = generateDefinitionId();
    const id2 = generateDefinitionId();
    expect(id1).toMatch(/^def_[0-9a-f]{8}$/);
    expect(id2).toMatch(/^def_[0-9a-f]{8}$/);
    expect(id1).not.toBe(id2);
  });
});

describe('definitionDoc.ts — buildDefinition', () => {
  const baseInput: BuildDefinitionInput = {
    definitionId: 'def_aabbccdd',
    revision: 0,
    label: '客户应收',
    sourceIds: ['si_customer', 'si_receivable'],
    catalogSources: [
      { instance_id: 'si_customer', alias: '客户主数据', app_id: 'app1', template_id: 'tpl1', data_table_id: 'dt1' },
      { instance_id: 'si_receivable', alias: '应收汇总', app_id: 'app1', template_id: 'tpl1', data_table_id: 'dt2' }
    ],
    join: {
      leftInstanceId: 'si_customer',
      rightInstanceId: 'si_receivable',
      joinType: 'inner',
      doc: makeDoc(joinExpressionId('si_customer', 'si_receivable'), 'join_on')
    },
    filterDoc: makeDoc(FILTER_EXPRESSION_ID, 'filter'),
    outputs: [{ targetFieldId: 'f_r_customer_name', doc: makeDoc(outputExpressionId('f_r_customer_name'), 'output') }],
    distinct: false
  };

  it('装配出符合 schema 的基础形状（schema_version/syntax_profile 固定常量，sources/joins/outputs 齐全）', () => {
    const def = buildDefinition(baseInput);
    expect(def.schema_version).toBe('alice.extract/v4');
    expect(def.syntax_profile).toBe('kimposql.mssql/v1');
    expect(def.definition_id).toBe('def_aabbccdd');
    expect(def.revision).toBe(0);
    expect(def.label).toBe('客户应收');
    expect(def.sources).toEqual([
      {
        kind: 'catalog',
        instance_id: 'si_customer',
        alias: '客户主数据',
        app_id: 'app1',
        template_id: 'tpl1',
        data_table_id: 'dt1'
      },
      {
        kind: 'catalog',
        instance_id: 'si_receivable',
        alias: '应收汇总',
        app_id: 'app1',
        template_id: 'tpl1',
        data_table_id: 'dt2'
      }
    ]);
    expect(def.joins).toHaveLength(1);
    expect(def.joins[0]).toMatchObject({
      join_id: 'join_1',
      sequence: 1,
      left_instance_id: 'si_customer',
      right_instance_id: 'si_receivable',
      join_type: 'inner'
    });
    expect(def.filter).toBeDefined();
    expect(def.outputs).toHaveLength(1);
    expect(def.outputs[0].target_field_id).toBe('f_r_customer_name');
    // business_timezone 恒为常量 'UTC'（后端约定：非 UTC 会被拒绝保存），与调用方是否传入无关。
    expect(def.options).toEqual({ distinct: false, business_timezone: 'UTC' });
  });

  it('无关联时 joins 为空数组', () => {
    const def = buildDefinition({ ...baseInput, join: null });
    expect(def.joins).toEqual([]);
  });

  it('无筛选文本时不带 filter 字段（而不是 filter:undefined）', () => {
    const def = buildDefinition({ ...baseInput, filterDoc: null });
    expect('filter' in def).toBe(false);
  });

  it('catalog 里找不到对应来源时，alias 退回 instance_id、三个标识字段退回空串（不落 undefined）', () => {
    const def = buildDefinition({ ...baseInput, catalogSources: [] });
    expect(def.sources[0]).toEqual({
      kind: 'catalog',
      instance_id: 'si_customer',
      alias: 'si_customer',
      app_id: '',
      template_id: '',
      data_table_id: ''
    });
  });
});

describe('definitionDoc.ts — applyDefinitionToState', () => {
  it('与 buildDefinition 构成往返：还原文本表齐全时状态与原始输入一致', () => {
    const joinDoc = makeDoc(joinExpressionId('si_customer', 'si_receivable'), 'join_on');
    const filterDoc = makeDoc(FILTER_EXPRESSION_ID, 'filter');
    const outDoc = makeDoc(outputExpressionId('f_r_customer_name'), 'output');
    const def = buildDefinition({
      definitionId: 'def_11223344',
      revision: 3,
      label: '往返用例',
      sourceIds: ['si_customer', 'si_receivable'],
      catalogSources: [
        { instance_id: 'si_customer', alias: '客户主数据' },
        { instance_id: 'si_receivable', alias: '应收汇总' }
      ],
      join: { leftInstanceId: 'si_customer', rightInstanceId: 'si_receivable', joinType: 'left', doc: joinDoc },
      filterDoc,
      outputs: [{ targetFieldId: 'f_r_customer_name', doc: outDoc }],
      distinct: true
    });

    const restored = {
      [joinDoc.expression_id]: '[客户主数据].[客户编码] = [应收汇总].[客户编码]',
      [filterDoc.expression_id]: "[客户主数据].[状态] = '启用'",
      [outDoc.expression_id]: '[客户主数据].[客户名称]'
    };
    const state = applyDefinitionToState(def, restored);

    expect(state.definitionId).toBe('def_11223344');
    expect(state.revision).toBe(3);
    expect(state.label).toBe('往返用例');
    expect(state.sourceIds).toEqual(['si_customer', 'si_receivable']);
    expect(state.join).toEqual({
      leftInstanceId: 'si_customer',
      rightInstanceId: 'si_receivable',
      joinType: 'left',
      text: '[客户主数据].[客户编码] = [应收汇总].[客户编码]',
      refs: []
    });
    expect(state.filterText).toBe("[客户主数据].[状态] = '启用'");
    expect(state.filterRefs).toEqual([]);
    expect(state.outputs).toEqual([{ targetFieldId: 'f_r_customer_name', text: '[客户主数据].[客户名称]', refs: [] }]);
  });

  it('无关联/无筛选时对应字段为 null/空串', () => {
    const outDoc = makeDoc(outputExpressionId('f_x'), 'output');
    const def = buildDefinition({
      definitionId: 'def_00000000',
      revision: 0,
      label: '',
      sourceIds: ['si_customer'],
      catalogSources: [],
      join: null,
      filterDoc: null,
      outputs: [{ targetFieldId: 'f_x', doc: outDoc }],
      distinct: false
    });
    const state = applyDefinitionToState(def, { [outDoc.expression_id]: 'v' });
    expect(state.join).toBeNull();
    expect(state.filterText).toBe('');
  });

  it('还原表缺失某个 expression_id 时该项退回空串（防御性兜底，不抛错）', () => {
    const outDoc = makeDoc(outputExpressionId('f_y'), 'output');
    const def = buildDefinition({
      definitionId: 'def_ffffffff',
      revision: 1,
      label: '',
      sourceIds: ['si_customer'],
      catalogSources: [],
      join: null,
      filterDoc: null,
      outputs: [{ targetFieldId: 'f_y', doc: outDoc }],
      distinct: false
    });
    const state = applyDefinitionToState(def, {});
    expect(state.outputs).toEqual([{ targetFieldId: 'f_y', text: '', refs: [] }]);
  });

  // D 卡追加：输出列显示名 label（可选，服务端 Encode 保留/Digest 排除/编译期 TargetLabel 回退 target_field_id）。
  it('有 label 时：buildDefinition 写入、restore 往返后 applyDefinitionToState 原样带回', () => {
    const outDoc = makeDoc(outputExpressionId('f_r_customer_name'), 'output');
    const def = buildDefinition({
      definitionId: 'def_label0001',
      revision: 0,
      label: '',
      sourceIds: ['si_customer'],
      catalogSources: [],
      join: null,
      filterDoc: null,
      outputs: [{ targetFieldId: 'f_r_customer_name', doc: outDoc, label: '自定义显示名' }],
      distinct: false
    });
    expect(def.outputs[0].label).toBe('自定义显示名');

    const state = applyDefinitionToState(def, { [outDoc.expression_id]: 'v' });
    expect(state.outputs).toEqual([{ targetFieldId: 'f_r_customer_name', text: 'v', label: '自定义显示名', refs: [] }]);
  });

  it('无 label（未提供或全空白）时：不写进 definition，applyDefinitionToState 也不带 label 键，交由调用方回落默认占位', () => {
    const outDoc = makeDoc(outputExpressionId('f_r_customer_name'), 'output');
    const def = buildDefinition({
      definitionId: 'def_label0002',
      revision: 0,
      label: '',
      sourceIds: ['si_customer'],
      catalogSources: [],
      join: null,
      filterDoc: null,
      outputs: [{ targetFieldId: 'f_r_customer_name', doc: outDoc, label: '   ' }],
      distinct: false
    });
    expect('label' in def.outputs[0]).toBe(false);

    const state = applyDefinitionToState(def, { [outDoc.expression_id]: 'v' });
    expect('label' in state.outputs[0]).toBe(false);
    expect(state.outputs).toEqual([{ targetFieldId: 'f_r_customer_name', text: 'v', refs: [] }]);
  });

  // D 卡第三刀：#{rN} 逐表达式命名空间——同一个 ref_id（如 r1）在关联 ON / 筛选 / 不同输出行里可各自
  // 指向不同字段，applyDefinitionToState 必须原样按槽位分别带回，不能合并成一份全局 refs。
  it('#{rN} 逐表达式命名空间：join/filter/output 各自的 refs 独立带回，同 ref_id 不互相覆盖', () => {
    const joinDoc: V4ExpressionDocument = {
      expression_id: joinExpressionId('si_customer', 'si_receivable'),
      purpose: 'join_on',
      source_text: '[客户编码]#{r1} = [客户编码]#{r1}',
      refs: [
        {
          ref_id: 'r1',
          kind: 'source_field',
          source_instance_id: 'si_customer',
          field_id: 'f_code',
          last_label: '客户编码'
        }
      ]
    };
    const filterDoc: V4ExpressionDocument = {
      expression_id: FILTER_EXPRESSION_ID,
      purpose: 'filter',
      source_text: '[应收余额]#{r1} > 100',
      refs: [
        {
          ref_id: 'r1',
          kind: 'source_field',
          source_instance_id: 'si_receivable',
          field_id: 'f_balance',
          last_label: '应收余额'
        }
      ]
    };
    const outDoc: V4ExpressionDocument = {
      expression_id: outputExpressionId('f_r_customer_name'),
      purpose: 'output',
      source_text: '[客户名称]#{r1}',
      refs: [
        {
          ref_id: 'r1',
          kind: 'source_field',
          source_instance_id: 'si_customer',
          field_id: 'f_name',
          last_label: '客户名称'
        }
      ]
    };
    const def = buildDefinition({
      definitionId: 'def_nsspace1',
      revision: 0,
      label: '',
      sourceIds: ['si_customer', 'si_receivable'],
      catalogSources: [],
      join: { leftInstanceId: 'si_customer', rightInstanceId: 'si_receivable', joinType: 'inner', doc: joinDoc },
      filterDoc,
      outputs: [{ targetFieldId: 'f_r_customer_name', doc: outDoc }],
      distinct: false
    });

    const state = applyDefinitionToState(def, {
      [joinDoc.expression_id]: joinDoc.source_text,
      [filterDoc.expression_id]: filterDoc.source_text,
      [outDoc.expression_id]: outDoc.source_text
    });

    expect(state.join?.refs).toEqual([
      {
        ref_id: 'r1',
        kind: 'source_field',
        source_instance_id: 'si_customer',
        field_id: 'f_code',
        last_label: '客户编码'
      }
    ]);
    expect(state.filterRefs).toEqual([
      {
        ref_id: 'r1',
        kind: 'source_field',
        source_instance_id: 'si_receivable',
        field_id: 'f_balance',
        last_label: '应收余额'
      }
    ]);
    expect(state.outputs[0].refs).toEqual([
      {
        ref_id: 'r1',
        kind: 'source_field',
        source_instance_id: 'si_customer',
        field_id: 'f_name',
        last_label: '客户名称'
      }
    ]);
    // 三份 r1 各自独立，字段不同，佐证未被合并成一份全局表。
    expect(state.join?.refs[0].field_id).not.toBe(state.filterRefs[0].field_id);
  });
});

// 查询选项卡新增：options.take/order_by 的 omitempty 语义 + business_timezone 恒 UTC + 往返回填。
describe('definitionDoc.ts — buildDefinition/applyDefinitionToState 查询选项（take/orderBy）', () => {
  const outDoc = makeDoc(outputExpressionId('f_r_customer_name'), 'output');
  const minimalInput: BuildDefinitionInput = {
    definitionId: 'def_opts0001',
    revision: 0,
    label: '',
    sourceIds: ['si_customer'],
    catalogSources: [],
    join: null,
    filterDoc: null,
    outputs: [{ targetFieldId: 'f_r_customer_name', doc: outDoc }],
    distinct: false
  };

  it('take 为 undefined/0 时不写 options.take 键（omitempty）', () => {
    expect('take' in buildDefinition(minimalInput).options).toBe(false);
    expect('take' in buildDefinition({ ...minimalInput, take: 0 }).options).toBe(false);
  });

  it('orderBy 为 undefined/空数组时不写 options.order_by 键（omitempty）', () => {
    expect('order_by' in buildDefinition(minimalInput).options).toBe(false);
    expect('order_by' in buildDefinition({ ...minimalInput, orderBy: [] }).options).toBe(false);
  });

  it('business_timezone 恒为常量 UTC，不受调用方是否传入 take/orderBy 影响', () => {
    expect(buildDefinition(minimalInput).options.business_timezone).toBe('UTC');
    expect(
      buildDefinition({
        ...minimalInput,
        take: 5,
        orderBy: [{ targetFieldId: 'f_r_customer_name', direction: 'desc' }]
      }).options.business_timezone
    ).toBe('UTC');
  });

  it('take/orderBy 均提供时正确写入 options（distinct/take/order_by 三键齐全）', () => {
    const def = buildDefinition({
      ...minimalInput,
      distinct: true,
      take: 5,
      orderBy: [{ targetFieldId: 'f_r_customer_name', direction: 'desc' }]
    });
    expect(def.options).toEqual({
      distinct: true,
      take: 5,
      order_by: [{ target_field_id: 'f_r_customer_name', direction: 'desc' }],
      business_timezone: 'UTC'
    });
  });

  it('applyDefinitionToState 往返：take/orderBy 原样带回（targetFieldId 由 target_field_id 换算）', () => {
    const def = buildDefinition({
      ...minimalInput,
      distinct: true,
      take: 5,
      orderBy: [{ targetFieldId: 'f_r_customer_name', direction: 'desc' }]
    });
    const state = applyDefinitionToState(def, { [outDoc.expression_id]: 'v' });
    expect(state.options).toEqual({
      distinct: true,
      take: 5,
      orderBy: [{ targetFieldId: 'f_r_customer_name', direction: 'desc' }]
    });
  });

  it('未提供 take/orderBy 时，applyDefinitionToState 回填 take:null、orderBy:[]（而非 undefined）', () => {
    const def = buildDefinition(minimalInput);
    const state = applyDefinitionToState(def, { [outDoc.expression_id]: 'v' });
    expect(state.options).toEqual({ distinct: false, take: null, orderBy: [] });
  });
});

// D 卡（本报表/暂存表作为来源）：sources 按 kind 生成（catalog/report/staging）+ 追加关联 joins +
// applyDefinitionToState 回填 tempSources/tempJoins，往返不丢失、不与目录来源混淆。
describe('definitionDoc.ts — 临时源（本报表/暂存表作为来源，D 卡新增）', () => {
  const outDoc = makeDoc(outputExpressionId('f_r_customer_name'), 'output');
  const reportJoinDoc = makeDoc(joinExpressionId('si_customer', 'rpt-dt_report_customer-c0ffee'), 'join_on');
  const stagingJoinDoc = makeDoc(joinExpressionId('si_customer', 'stg-staging_area-c0ffee'), 'join_on');

  const inputWithTempSources: BuildDefinitionInput = {
    definitionId: 'def_temp0001',
    revision: 0,
    label: '',
    sourceIds: ['si_customer'],
    catalogSources: [{ instance_id: 'si_customer', alias: '客户主数据', app_id: 'app1', template_id: 'tpl1', data_table_id: 'dt1' }],
    join: null,
    tempSources: [
      {
        instanceId: 'rpt-dt_report_customer-c0ffee',
        kind: 'report',
        alias: '客户信息',
        tableId: 'dt_report_customer',
        tableRole: 'main'
      },
      { instanceId: 'stg-staging_area-c0ffee', kind: 'staging', alias: '暂存表' }
    ],
    tempJoins: [
      { leftInstanceId: 'si_customer', rightInstanceId: 'rpt-dt_report_customer-c0ffee', joinType: 'inner', doc: reportJoinDoc },
      { leftInstanceId: 'si_customer', rightInstanceId: 'stg-staging_area-c0ffee', joinType: 'inner', doc: stagingJoinDoc }
    ],
    filterDoc: null,
    outputs: [{ targetFieldId: 'f_r_customer_name', doc: outDoc }],
    distinct: false
  };

  it('buildDefinition：sources 按 kind 生成——catalog 三元身份齐全、report 带 table_id/table_role、staging 带固定 producer_node_id/output_schema_revision', () => {
    const def = buildDefinition(inputWithTempSources);
    expect(def.sources).toEqual([
      { kind: 'catalog', instance_id: 'si_customer', alias: '客户主数据', app_id: 'app1', template_id: 'tpl1', data_table_id: 'dt1' },
      {
        kind: 'report',
        instance_id: 'rpt-dt_report_customer-c0ffee',
        alias: '客户信息',
        table_id: 'dt_report_customer',
        table_role: 'main'
      },
      {
        kind: 'staging',
        instance_id: 'stg-staging_area-c0ffee',
        alias: '暂存表',
        producer_node_id: 'staging_area',
        output_schema_revision: 'v1'
      }
    ]);
  });

  it('buildDefinition：无目录对目录关联时，追加关联从 join_1 开始按顺序编号', () => {
    const def = buildDefinition(inputWithTempSources);
    expect(def.joins).toHaveLength(2);
    expect(def.joins[0]).toMatchObject({
      join_id: 'join_1',
      sequence: 1,
      left_instance_id: 'si_customer',
      right_instance_id: 'rpt-dt_report_customer-c0ffee'
    });
    expect(def.joins[1]).toMatchObject({
      join_id: 'join_2',
      sequence: 2,
      left_instance_id: 'si_customer',
      right_instance_id: 'stg-staging_area-c0ffee'
    });
  });

  it('buildDefinition：有目录对目录关联时，追加关联紧随其后从 join_2 继续编号', () => {
    const catalogJoinDoc = makeDoc(joinExpressionId('si_customer', 'si_receivable'), 'join_on');
    const def = buildDefinition({
      ...inputWithTempSources,
      sourceIds: ['si_customer', 'si_receivable'],
      catalogSources: [
        ...inputWithTempSources.catalogSources,
        { instance_id: 'si_receivable', alias: '应收汇总', app_id: 'app1', template_id: 'tpl1', data_table_id: 'dt2' }
      ],
      join: { leftInstanceId: 'si_customer', rightInstanceId: 'si_receivable', joinType: 'inner', doc: catalogJoinDoc }
    });
    expect(def.joins.map(j => j.join_id)).toEqual(['join_1', 'join_2', 'join_3']);
    expect(def.joins[0].right_instance_id).toBe('si_receivable'); // 目录对目录关联恒排第一。
  });

  it('applyDefinitionToState：往返回填 tempSources/tempJoins，sourceIds 仅含目录来源（不混入临时源实例）', () => {
    const def = buildDefinition(inputWithTempSources);
    const restored = {
      [reportJoinDoc.expression_id]: '[客户主数据].[客户编码] = 本报表.[客户信息].[客户编码]',
      [stagingJoinDoc.expression_id]: '[客户主数据].[客户编码] = 暂存表.[客户编码]',
      [outDoc.expression_id]: '[客户主数据].[客户名称]'
    };
    const state = applyDefinitionToState(def, restored);

    expect(state.sourceIds).toEqual(['si_customer']);
    expect(state.join).toBeNull(); // 无目录对目录关联。
    expect(state.tempSources).toEqual([
      {
        instanceId: 'rpt-dt_report_customer-c0ffee',
        kind: 'report',
        alias: '客户信息',
        tableId: 'dt_report_customer',
        tableRole: 'main'
      },
      { instanceId: 'stg-staging_area-c0ffee', kind: 'staging', alias: '暂存表' }
    ]);
    expect(state.tempJoins).toHaveLength(2);
    expect(state.tempJoins[0]).toMatchObject({
      leftInstanceId: 'si_customer',
      rightInstanceId: 'rpt-dt_report_customer-c0ffee',
      joinType: 'inner',
      text: '[客户主数据].[客户编码] = 本报表.[客户信息].[客户编码]'
    });
    expect(state.tempJoins[1]).toMatchObject({
      leftInstanceId: 'si_customer',
      rightInstanceId: 'stg-staging_area-c0ffee',
      joinType: 'inner',
      text: '[客户主数据].[客户编码] = 暂存表.[客户编码]'
    });
  });

  it('applyDefinitionToState：有目录对目录关联时，目录关联单独回填到 state.join，不落入 tempJoins', () => {
    const catalogJoinDoc = makeDoc(joinExpressionId('si_customer', 'si_receivable'), 'join_on');
    const def = buildDefinition({
      ...inputWithTempSources,
      sourceIds: ['si_customer', 'si_receivable'],
      catalogSources: [
        ...inputWithTempSources.catalogSources,
        { instance_id: 'si_receivable', alias: '应收汇总', app_id: 'app1', template_id: 'tpl1', data_table_id: 'dt2' }
      ],
      join: { leftInstanceId: 'si_customer', rightInstanceId: 'si_receivable', joinType: 'inner', doc: catalogJoinDoc }
    });
    const restored = {
      [catalogJoinDoc.expression_id]: '[客户主数据].[客户编码] = [应收汇总].[客户编码]',
      [reportJoinDoc.expression_id]: '[客户主数据].[客户编码] = 本报表.[客户信息].[客户编码]',
      [stagingJoinDoc.expression_id]: '[客户主数据].[客户编码] = 暂存表.[客户编码]',
      [outDoc.expression_id]: '[客户主数据].[客户名称]'
    };
    const state = applyDefinitionToState(def, restored);
    expect(state.sourceIds).toEqual(['si_customer', 'si_receivable']);
    expect(state.join).toMatchObject({ leftInstanceId: 'si_customer', rightInstanceId: 'si_receivable' });
    expect(state.tempJoins).toHaveLength(2);
    expect(state.tempJoins.map(tj => tj.rightInstanceId)).toEqual([
      'rpt-dt_report_customer-c0ffee',
      'stg-staging_area-c0ffee'
    ]);
  });

  it('无临时源时 tempSources/tempJoins 均回填空数组（不影响既有单目录来源用例）', () => {
    const def = buildDefinition({ ...inputWithTempSources, tempSources: undefined, tempJoins: undefined });
    const state = applyDefinitionToState(def, { [outDoc.expression_id]: 'v' });
    expect(state.tempSources).toEqual([]);
    expect(state.tempJoins).toEqual([]);
  });

  // report_field 引用带 source_instance_id（D 卡）：与既有 source_field 一样原样透传/往返，
  // 不做任何特殊改写——共享包 V4DiagnoseRef/服务层 V4ExpressionRefWire 的 source_instance_id
  // 字段本就对所有 kind 通用，buildDefinition/applyDefinitionToState 不需要为此新增分支。
  it('report_field 引用（带 source_instance_id）随 refs 原样往返，不被丢弃或改写', () => {
    const outDocWithReportFieldRef: V4ExpressionDocument = {
      expression_id: outputExpressionId('f_r_receivable_total'),
      purpose: 'output',
      source_text: '[应收合计]#{r1}',
      refs: [
        {
          ref_id: 'r1',
          kind: 'report_field',
          source_instance_id: 'rpt-dt_report_customer-c0ffee',
          table_id: 'dt_report_customer',
          field_id: 'f_r_receivable_total',
          last_label: '应收合计'
        }
      ]
    };
    const def = buildDefinition({
      ...inputWithTempSources,
      outputs: [{ targetFieldId: 'f_r_receivable_total', doc: outDocWithReportFieldRef }]
    });
    const state = applyDefinitionToState(def, {
      [reportJoinDoc.expression_id]: 'x',
      [stagingJoinDoc.expression_id]: 'x',
      [outDocWithReportFieldRef.expression_id]: outDocWithReportFieldRef.source_text
    });
    expect(state.outputs[0].refs).toEqual([
      {
        ref_id: 'r1',
        kind: 'report_field',
        source_instance_id: 'rpt-dt_report_customer-c0ffee',
        table_id: 'dt_report_customer',
        field_id: 'f_r_receivable_total',
        last_label: '应收合计'
      }
    ]);
  });
});
