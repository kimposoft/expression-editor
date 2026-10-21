/**
 * expressionModelAdapter 往返保真单测。
 */
import { describe, expect, it, vi } from 'vitest';
import { v4DocToExpressionModel, expressionModelToV4Doc, stripUnconfiguredOutputs, fillEmptyStagingNamesForPreview, v4ExpressionToValueRef, valueRefToV4Expression, reportInstanceId, reportInstanceTableId, stagingInstanceId, STAGING_INSTANCE_PREFIX, type V4ModelAdapterContext, isImplicitReportJoin } from './expressionModelAdapter';
import type { V4ExtractNodeDocument } from './nodeDocument';
import type { ExpressionModel } from '../types';

const CTX: V4ModelAdapterContext = {
  templateId: 'tpl-1',
  readableTextOf: (_id, tokenized) => tokenized,
  sourceOf: alias => makeDoc().query.sources.find(x => x.instance_id === alias),
  fieldLabelOf: (_inst, fieldId) =>
    ({ 'fld-no': '单号', 'fld-order-no': '单号', 'fld-amt': '金额', 'fld-name': '品名', 'fld-total': '合计' })[fieldId] ??
    fieldId
};

/** 一份覆盖各段的文档夹具：两个来源（本报表 + 跨模板）、一条关联、筛选、两个目标、一个图表。 */
function makeDoc(): V4ExtractNodeDocument {
  return {
    schema_version: 'kimpo.extract-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [
        { kind: 'report', instance_id: 'rpt-main-a1', alias: '本表', table_id: 'tbl-main', table_role: 'main' },
        {
          kind: 'catalog',
          instance_id: 'cat-order-b2',
          alias: '订单表',
          app_id: 'app-1',
          template_id: 'tpl-order',
          data_table_id: 'tbl-order'
        }
      ],
      joins: [
        {
          join_id: 'j1',
          sequence: 1,
          left_instance_id: 'rpt-main-a1',
          right_instance_id: 'cat-order-b2',
          join_type: 'left',
          on: {
            expression_id: 'join:rpt-main-a1:cat-order-b2',
            purpose: 'join_on',
            source_text: '[单号]#{r1} = [单号]#{r2}',
            refs: [
              // 本报表来源的字段引用是 report_field（引擎按 table_id 查 Scope.Report），
              // 不是 source_field——夹具按引擎的真实口径写，往返断言才有意义。
              {
                ref_id: 'r1',
                kind: 'report_field',
                source_instance_id: 'rpt-main-a1',
                table_id: 'tbl-main',
                field_id: 'fld-no',
                last_label: '单号'
              },
              { ref_id: 'r2', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-order-no', last_label: '单号' }
            ]
          }
        }
      ],
      filter: {
        expression_id: 'filter',
        purpose: 'filter',
        source_text: '[金额]#{r1} > 0',
        refs: [
          { ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-amt', last_label: '金额' }
        ]
      },
      options: { distinct: true, take: 100 }
    },
    targets: [
      {
        target_id: 'tgt-main',
        target_data_table_id: 'tbl-main',
        table_role: 'main',
        distinct: true,
        take: 0,
        outputs: [
          {
            target_field_id: 'fld-total',
            expression: {
              expression_id: 'out:tbl-main:fld-total',
              purpose: 'output',
              source_text: '[金额]#{r1}',
              refs: [
                { ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-amt', last_label: '金额' }
              ]
            },
            fill_strategy: 'overwrite'
          }
        ],
        clear: { mode: 'mapped', timing: 'before' },
        auto_row_match: false,
        order_by: [{ target_field_id: 'fld-total', direction: 'desc' }]
      },
      {
        target_id: 'tgt-detail',
        target_data_table_id: 'tbl-detail',
        table_role: 'detail',
        distinct: true,
        take: 0,
        outputs: [
          {
            target_field_id: 'fld-item',
            label: '明细项',
            expression: {
              expression_id: 'out:tbl-detail:fld-item',
              purpose: 'output',
              source_text: '[品名]#{r1}',
              refs: [
                { ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-name', last_label: '品名' }
              ]
            },
            fill_strategy: 'merge',
            separator: '、'
          }
        ]
      }
    ],
    chart_targets: [
      {
        chart_id: 'chart-1',
        chart_form: 'categorySeries',
        layout: 'wide',
        row_limit: 500,
        aggregate: 'sum',
        slots: {
          category: {
            expression_id: 'chart:chart-1:category',
            purpose: 'output',
            source_text: '[品名]#{r1}',
            refs: [
              { ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-name', last_label: '品名' }
            ]
          },
          values: [
            {
              name_key: '金额',
              expression: {
                expression_id: 'chart:chart-1:value0',
                purpose: 'output',
                source_text: '[金额]#{r1}',
                refs: [
                  { ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-amt', last_label: '金额' }
                ]
              }
            }
          ]
        }
      }
    ]
  };
}

describe('expressionModelAdapter separator 只跟随 merge', () => {
  it('overwrite 输出不得带 separator，merge 输出照常带', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    const target = (model.targets ?? [model.target])[0] as any;
    // 造一份「两条输出、策略不同、都带分隔符」的编辑态——这正是 UI 上给某列选了合并、
    // 另一列保持覆盖时 3.4 模型的真实形状（分隔符下拉有默认值，不会因为切成覆盖就清空）。
    target.outputs = [
      { ...target.outputs[0], fill_strategy: 'overwrite', separator: ',' },
      { ...target.outputs[0], target_field_id: 'out_b', fill_strategy: 'merge', separator: ';' }
    ];
    const back = expressionModelToV4Doc(model, doc, CTX);
    const outs = back.targets[0].outputs;
    expect(outs[0].fill_strategy).toBe('overwrite');
    expect(outs[0].separator).toBeUndefined();
    expect(outs[1].fill_strategy).toBe('merge');
    expect(outs[1].separator).toBe(';');
  });
});

describe('expressionModelAdapter 自动按行列匹配的匹配键回填 outputs[].fill_strategy', () => {
  it('match_keys 命中的输出字段：fill_strategy 改写为 row_match，即便存量/用户配置仍是 overwrite/merge', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    const target = (model.targets ?? [model.target])[1] as any; // tgt-detail，唯一输出 fld-item（原 fill_strategy: 'merge'）
    target.auto_row_match = true;
    // 模拟 ExpressionEditor.vue reconcile ⓪/③ 段的产物：条件段「本报表.[tbl-detail].[fld-item] =
    // [订单表].[品名]」被提取成的内存匹配键——目标侧只剩裸 form_field_id，来源侧是完整 ValueRef。
    target.match_keys = [
      { source_expr: { kind: 'source_field', alias: 'cat-order-b2', field_id: 'fld-name' }, form_field_id: 'fld-item' }
    ];

    const back = expressionModelToV4Doc(model, doc, CTX);
    const detailTarget = back.targets.find(t => t.target_data_table_id === 'tbl-detail')!;
    expect(detailTarget.auto_row_match).toBe(true);
    expect(detailTarget.outputs[0]).toMatchObject({ target_field_id: 'fld-item', fill_strategy: 'row_match' });
    // row_match 不是 merge，separator 不该再跟着走。
    expect(detailTarget.outputs[0].separator).toBeUndefined();
  });

  it('反证：auto_row_match=false（手动模式）时不受影响，match_keys 即便存在也不改写 fill_strategy', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    const target = (model.targets ?? [model.target])[1] as any;
    target.auto_row_match = false; // 手动模式：match_keys 权威改由 outputs 里的 row_match 声明反推，不读这个字段
    target.match_keys = [
      { source_expr: { kind: 'source_field', alias: 'cat-order-b2', field_id: 'fld-name' }, form_field_id: 'fld-item' }
    ];

    const back = expressionModelToV4Doc(model, doc, CTX);
    const detailTarget = back.targets.find(t => t.target_data_table_id === 'tbl-detail')!;
    expect(detailTarget.outputs[0].fill_strategy).toBe('merge'); // 未被误改写，原配置原样透传
  });

  it('反证：auto_row_match=true 但 match_keys 为空（尚未配筛选条件）时不改写任何输出', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    const target = (model.targets ?? [model.target])[1] as any;
    target.auto_row_match = true;
    target.match_keys = [];

    const back = expressionModelToV4Doc(model, doc, CTX);
    const detailTarget = back.targets.find(t => t.target_data_table_id === 'tbl-detail')!;
    expect(detailTarget.outputs[0].fill_strategy).toBe('merge');
  });
});

describe('expressionModelAdapter 往返', () => {
  it('整份文档往返一次后等价（各段都不丢、不变形）', () => {
    const doc = makeDoc();
    const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX);
    expect(back).toEqual(doc);
  });

  it('往返两次稳定（第二圈不再产生任何变化）', () => {
    // 只跑一圈相等还不够：若翻译带「每次都重新生成 ID」之类的副作用，两圈就会漂。
    const doc = makeDoc();
    const once = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX);
    const twice = expressionModelToV4Doc(v4DocToExpressionModel(once, CTX), once, CTX);
    expect(twice).toEqual(once);
  });

  it('来源：本报表落 is_context，跨模板带 app_id，alias 恒取 instance_id', () => {
    const model = v4DocToExpressionModel(makeDoc(), CTX);
    const [report, catalog] = model.source.tables;
    expect(report).toMatchObject({ alias: 'rpt-main-a1', is_context: true, data_table_id: 'tbl-main', role: 'main' });
    expect(catalog).toMatchObject({ alias: 'cat-order-b2', is_context: false, app_id: 'app-1', template_id: 'tpl-order' });
  });

  it('关联 ON：token 文本降级成结构化谓词，两侧字段按 refs 归位', () => {
    const model = v4DocToExpressionModel(makeDoc(), CTX);
    expect(model.source.joins[0]).toMatchObject({ left_alias: 'rpt-main-a1', right_alias: 'cat-order-b2', join_type: 'left' });
    expect(model.source.joins[0].on).toEqual([
      {
        left: { alias: 'rpt-main-a1', field_id: 'fld-no' },
        op: 'eq',
        right: { alias: 'cat-order-b2', field_id: 'fld-order-no' }
      }
    ]);
  });

  it('关联 ON：认不出的复杂表达式留空，不产出被截断的错误结构', () => {
    const doc = makeDoc();
    doc.query.joins[0].on.source_text = 'UPPER([单号]#{r1}) = [单号]#{r2}';
    const model = v4DocToExpressionModel(doc, CTX);
    expect(model.source.joins[0].on).toBeUndefined();
  });

  it('目标：clear/auto_row_match/填充方式/分隔符逐字透传，逐目标 order_by 两侧同搬不互串', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    expect(model.targets?.[0]).toMatchObject({ clear: { mode: 'mapped', timing: 'before' }, auto_row_match: false });
    expect(model.targets?.[1]?.outputs[0]).toMatchObject({ fill_strategy: 'merge', separator: '、' });
    // 排序（用户 2026-09-08 改判）：正向带进各自的 3.4 目标供排序下拉读，反向按目标写回，两个目标互不串。
    expect(model.targets?.[0]?.order_by).toEqual([{ target_field_id: 'fld-total', direction: 'desc' }]);
    expect(model.targets?.[1]?.order_by).toBeUndefined();
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.targets[0].order_by).toEqual([{ target_field_id: 'fld-total', direction: 'desc' }]);
    expect(back.targets[1].order_by).toBeUndefined();
  });

  // 排序可编辑（用户 2026-09-08「扩展表设置排序无效」修复）：改判前反向恒写上一版文档的
  // order_by，编辑器改了也白改。这三条把「改 / 清空 / 整键缺省」三态钉死。
  it('排序：改本目标 order_by 后反向按编辑值写回，不再回落上一版文档', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.targets![0].order_by = [{ target_field_id: 'fld-total', direction: 'asc' }];
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.targets[0].order_by).toEqual([{ target_field_id: 'fld-total', direction: 'asc' }]);
  });

  it('排序：清空成空数组 ⇒ V4 文档不再带 order_by（omitempty），不被上一版文档回灌', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.targets![0].order_by = [];
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.targets[0].order_by).toBeUndefined();
  });

  it('排序：整键缺省（非 V4 路径/未经编辑器的模型）仍回落上一版文档，不误删存量排序', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    delete model.targets![0].order_by;
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.targets[0].order_by).toEqual([{ target_field_id: 'fld-total', direction: 'desc' }]);
  });

  it('stripUnconfiguredOutputs：未配置输出被剔除时，指向它的排序键一并剔除（否则服务端整份拒绝）', () => {
    const doc = makeDoc();
    doc.targets[0].outputs[0].expression.source_text = '   '; // 占位「不填充」行
    const stripped = stripUnconfiguredOutputs(doc);
    expect(stripped.targets[0].outputs).toHaveLength(0);
    expect(stripped.targets[0].order_by).toBeUndefined();
  });

  it('筛选：只产出 where_text_source（表达式态），不产出引导式 where', () => {
    const model = v4DocToExpressionModel(makeDoc(), CTX);
    expect(model.where_text_source?.text).toBe('[金额]#{r1} > 0');
    expect(model.where).toBeUndefined();
  });

  it('图表：V4 顶层 chart_targets 挂到首个目标，按 form 转成判别联合', () => {
    const model = v4DocToExpressionModel(makeDoc(), CTX);
    // 权威位是顶层 model.chart_targets——writeTargets 每次都会剥掉 TargetSpec 内的同名字段。
    const chart = model.chart_targets?.[0];
    expect(chart).toMatchObject({ chart_id: 'chart-1', chart_form: 'categorySeries', row_limit: 500 });
    expect(chart?.mapping).toMatchObject({ form: 'categorySeries', layout: 'wide', aggregate: 'sum' });
  });

  it('图表：编辑器未产出 chart_targets 时保留原有配置，不当成用户删除', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    // 模拟「编辑器只渲染了填充目标、根本没碰图表段」的场景。
    delete model.chart_targets;
    delete model.target.chart_targets;
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.chart_targets).toEqual(doc.chart_targets);
  });

  // ── 图表往返（换轨后的验收判据）────────────────────────────────────────────
  // 取数配置面已换轨到 3.4 ExpressionEditor 本体，图表由它的图表 tab 配置，权威文档仍是 V4
  // 节点文档 —— 「配得出、存得住」这条链路全靠本适配器双向翻译。上面两条只覆盖了正向
  // （V4→3.4）与「没碰图表段就别当删除」，反向回写从未被钉住，故补这两条。

  it('图表往返：V4 → 3.4 模型 → V4，未经用户编辑时逐字回到原样', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.chart_targets).toEqual(doc.chart_targets);
  });

  it('图表往返：用户在 3.4 图表 tab 改了聚合与行数上限，回写进 V4 文档', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    // 模拟用户在图表 tab 上的编辑：聚合 sum → count、行数上限 500 → 100。
    const spec = model.chart_targets![0] as { row_limit?: number; mapping: { aggregate?: string } };
    spec.row_limit = 100;
    spec.mapping.aggregate = 'count';

    const back = expressionModelToV4Doc(model, doc, CTX);
    const chart = back.chart_targets?.[0];
    expect(chart?.row_limit).toBe(100);
    expect(chart?.aggregate).toBe('count');
    // 未被编辑的部分不得受影响：图表身份、形态、布局与槽位表达式原样保留。
    expect(chart?.chart_id).toBe('chart-1');
    expect(chart?.chart_form).toBe('categorySeries');
    expect(chart?.layout).toBe('wide');
    expect(chart?.slots.category?.source_text).toBe('[品名]#{r1}');
  });

  it('关联 ON：引用种类跟着来源种类走（本报表产 report_field 并带 table_id）', () => {
    // 引擎侧 definition.toRefBinding 按 ref.kind 分三条路查 Scope：source_field 查
    // Scope.Sources（键=source_instance_id），report_field 查 Scope.Report（键=table_id）。
    // 本报表来源若产成 source_field，编译期必报「引用的来源字段…在给定 Scope 内找不到」
    //，故此处逐条钉死种类与随行字段。
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    const back = expressionModelToV4Doc(model, doc, CTX);
    const refs = back.query.joins[0].on.refs;
    const left = refs.find(r => r.field_id === 'fld-no');   // 来自 rpt-main-a1（kind=report）
    const right = refs.find(r => r.field_id === 'fld-order-no'); // 来自 cat-order-b2（kind=catalog）
    expect(left).toMatchObject({ kind: 'report_field', table_id: 'tbl-main', source_instance_id: 'rpt-main-a1' });
    expect(right).toMatchObject({ kind: 'source_field', source_instance_id: 'cat-order-b2' });
    expect((right as { table_id?: string }).table_id).toBeUndefined();
  });

  it('关联 ON：刚加的空谓词（字段未选）往返存活，不被当非法丢弃', () => {
    // 3.4 的 addOn 加的就是一条 field_id='' 的空谓词，等用户去选字段。配置面的
    // ExpressionModel 是每次从权威 V4 文档重算的 computed，若往返把它丢了，UI 上就是
    // 「＋ 关联条件点了没反应」。
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.joins[0].on = [
      ...(model.source.joins[0].on ?? []),
      { left: { alias: 'rpt-main-a1', field_id: '' }, op: 'eq', right: { alias: 'cat-order-b2', field_id: '' } }
    ];
    const back = expressionModelToV4Doc(model, doc, CTX);
    const again = v4DocToExpressionModel(back, CTX);
    expect(again.source.joins[0].on).toHaveLength(2);
    expect(again.source.joins[0].on?.[1]).toMatchObject({
      left: { alias: 'rpt-main-a1', field_id: '' },
      right: { alias: 'cat-order-b2', field_id: '' }
    });
  });

  it('暂存目标：带 column_id + 中文显示名的文档往返保真', () => {
    // 3.4 用 outputs[].target_field_id 承载 column_id（稳定键），target_field_label 承载显示名；
    // V4 用 staging_target.columns[].column_id/name 对应。
    const doc = makeDoc();
    doc.staging_target = {
      columns: [
        {
          column_id: 'col_a1b2c3d4',
          name: '物料编号', // 中文显示名——白名单撤销前会被拒，此为核心回归点
          expression: {
            expression_id: 'stg:col_a1b2c3d4',
            purpose: 'output',
            source_text: '[金额]#{r1}',
            refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-amt', last_label: '金额' }]
          }
        }
      ]
    };
    const model = v4DocToExpressionModel(doc, CTX);
    // 3.4 侧：暂存目标混在 targets 里，目标表恒空串。
    const stagingSpec = model.targets?.find(t => t.target_kind === 'staging');
    expect(stagingSpec).toBeDefined();
    expect(stagingSpec?.target_data_table_id).toBe('');
    expect(stagingSpec?.outputs[0].target_field_id).toBe('col_a1b2c3d4'); // = column_id
    expect(stagingSpec?.outputs[0].target_field_label).toBe('物料编号'); // = 显示名

    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.staging_target).toEqual(doc.staging_target);
    // 暂存目标不得混进填充目标。
    expect(back.targets.some(t => !t.target_data_table_id)).toBe(false);
  });

  it('暂存目标：存量文档无 column_id——正向回填为 name，反向写回带上 column_id===name', () => {
    const doc = makeDoc();
    doc.staging_target = {
      columns: [
        {
          // 无 column_id：存量文档（分离前），当年受白名单约束，name 天然合法。
          name: 'balance',
          expression: {
            expression_id: 'stg:balance',
            purpose: 'output',
            source_text: '[金额]#{r1}',
            refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-amt', last_label: '金额' }]
          }
        }
      ]
    };
    const model = v4DocToExpressionModel(doc, CTX);
    const stagingSpec = model.targets?.find(t => t.target_kind === 'staging');
    expect(stagingSpec?.outputs[0].target_field_id).toBe('balance');
    expect(stagingSpec?.outputs[0].target_field_label).toBe('balance');

    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.staging_target?.columns[0].column_id).toBe('balance');
    expect(back.staging_target?.columns[0].name).toBe('balance');
    // expression_id 未变（按 column_id 命中旧列）。
    expect(back.staging_target?.columns[0].expression.expression_id).toBe('stg:balance');
  });

  it('暂存目标：改显示名后写回，column_id 与 expression_id 保持不变（prev 按 column_id 命中）', () => {
    const doc = makeDoc();
    doc.staging_target = {
      columns: [
        {
          column_id: 'col_fixed01',
          name: '旧显示名',
          expression: {
            expression_id: 'stg:col_fixed01',
            purpose: 'output',
            source_text: '[金额]#{r1}',
            refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-amt', last_label: '金额' }]
          }
        }
      ]
    };
    const model = v4DocToExpressionModel(doc, CTX);
    const stagingSpec = model.targets?.find(t => t.target_kind === 'staging')!;
    // 模拟用户改了显示名：target_field_id（column_id）原样不动。
    stagingSpec.outputs = [{ ...stagingSpec.outputs[0], target_field_label: '新显示名' }];
    model.targets = [...(model.targets ?? []).filter(t => t.target_kind !== 'staging'), stagingSpec];

    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.staging_target?.columns[0].column_id).toBe('col_fixed01'); // 改名不变
    expect(back.staging_target?.columns[0].name).toBe('新显示名');
    expect(back.staging_target?.columns[0].expression.expression_id).toBe('stg:col_fixed01'); // 表达式身份未重生成
  });

  it('暂存目标：新建列 target_field_label 为空串——写回 name 保持空串，不回落 column_id', () => {
    const doc = makeDoc();
    doc.staging_target = {
      columns: [
        {
          column_id: 'col_a1b2c3d4',
          name: '占位名', // 反向翻译前的旧值——本用例要验证它被显式空串覆盖，而不是回落成 column_id
          expression: { expression_id: 'stg:col_a1b2c3d4', purpose: 'output', source_text: "'X'", refs: [] }
        }
      ]
    };
    const model = v4DocToExpressionModel(doc, CTX);
    const stagingSpec = model.targets?.find(t => t.target_kind === 'staging')!;
    // 模拟 StagingTargetSection.addColumn 新建列（或用户清空了列名输入框）：target_field_label 显式空串。
    stagingSpec.outputs = [{ ...stagingSpec.outputs[0], target_field_label: '' }];
    model.targets = [...(model.targets ?? []).filter(t => t.target_kind !== 'staging'), stagingSpec];

    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.staging_target?.columns[0].name).toBe(''); // 不被 || 回落成 column_id
  });

  it('暂存目标：target_field_label 缺省（undefined，非 3.4 建模的存量/外部构造）——写回 name 回落 column_id', () => {
    const doc = makeDoc();
    doc.staging_target = {
      columns: [
        {
          column_id: 'col_a1b2c3d4',
          name: '任意旧名',
          expression: { expression_id: 'stg:col_a1b2c3d4', purpose: 'output', source_text: "'X'", refs: [] }
        }
      ]
    };
    const model = v4DocToExpressionModel(doc, CTX);
    const stagingSpec = model.targets?.find(t => t.target_kind === 'staging')!;
    // target_field_label 字段本身缺席（不是空串）：模拟外部构造/存量模型没有这个字段。
    const { target_field_label: _drop, ...rest } = stagingSpec.outputs[0];
    stagingSpec.outputs = [rest];
    model.targets = [...(model.targets ?? []).filter(t => t.target_kind !== 'staging'), stagingSpec];

    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.staging_target?.columns[0].name).toBe('col_a1b2c3d4'); // 回落 column_id
  });

  it('暂存目标：未配置时不产出（不保留 prev）', () => {
    const doc = makeDoc();
    const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX);
    expect(back.staging_target).toBeUndefined();
  });

  it('暂存目标：3.4 侧的暂存目标不被当成填充目标转换', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.targets = [
      ...(model.targets ?? []),
      { target_template_id: 'tpl-1', target_data_table_id: '', target_kind: 'staging', outputs: [] }
    ];
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.targets).toHaveLength(doc.targets.length);
    expect(back.targets.some(t => !t.target_data_table_id)).toBe(false);
  });

  it('暂存目标：刚勾上、还没配列的空暂存目标必须往返存活', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.targets = [
      ...(model.targets ?? []),
      { target_template_id: 'tpl-1', target_data_table_id: '', target_kind: 'staging', outputs: [] }
    ];

    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.staging_target).toEqual({ columns: [] }); // 空目标本身要落下来

    // 关键一跳：再正向翻译一次，暂存 tab 必须还在（这一步此前会把它弄丢）。
    const again = v4DocToExpressionModel(back, CTX);
    expect(again.targets?.some(t => t.target_kind === 'staging')).toBe(true);
    expect(again.targets?.find(t => t.target_kind === 'staging')?.outputs).toEqual([]);
  });

  it('暂存来源：新加时落 kind=staging 并带 producer_node_id，不落成非法 catalog', () => {
    // 3.4 侧的暂存来源恒把 template_id/data_table_id 留空（source_type='staging' 的约定），
    // 若按 catalog 落会产出 template/table 为空的非法绑定、被保存闸拒。
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      { alias: 'stg-n_producer-a1b2c3', source_type: 'staging', template_id: '', data_table_id: '', is_context: false }
    ];
    const back = expressionModelToV4Doc(model, doc, { ...CTX, stagingProducerNodeId: 'n_producer' });
    const added = back.query.sources.find(x => x.instance_id === 'stg-n_producer-a1b2c3');
    expect(added).toMatchObject({
      kind: 'staging',
      producer_node_id: 'n_producer',
      output_schema_revision: 'v1'
    });
    // 不得携带 catalog 专属字段（schema 的 oneOf 互斥会拒）。
    expect((added as { template_id?: string }).template_id).toBeUndefined();
    expect((added as { data_table_id?: string }).data_table_id).toBeUndefined();
  });

  describe('暂存来源实例 ID（2026-09-07 语法检查修复）', () => {
    it('新加暂存来源（3.4 别名 t1）写回后 instance_id 匹配 stg-<producer>-<6hex> 且确定性', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 't1', source_type: 'staging', template_id: '', data_table_id: '', is_context: false }
      ];
      const ctx: V4ModelAdapterContext = { ...CTX, stagingProducerNodeId: 'node-p1', stagingProducerLabel: '上一步暂存区（提取数据）' };
      const back = expressionModelToV4Doc(model, doc, ctx);
      const added = back.query.sources.find(s => s.kind === 'staging' && s.producer_node_id === 'node-p1');
      expect(added).toBeDefined();
      expect(added!.instance_id).toMatch(/^stg-node-p1-[0-9a-f]{6}$/);
      // 与直接调用 stagingInstanceId 逐字节相同——同一 producer 任何会话都算出同一个 ID。
      expect(added!.instance_id).toBe(stagingInstanceId('node-p1'));
      expect(stagingInstanceId('node-p1')).toBe(stagingInstanceId('node-p1')); // 确定性：重复调用同值
      // alias 取 ctx.stagingProducerLabel（上游显示名），不是编辑期占位别名 "t1"。
      expect(added!.alias).toBe('上一步暂存区（提取数据）');
    });

    it('已是 stg- 形态的别名（存量文档往返回来）原样保留，不重新派生', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      const existingId = 'stg-node-p1-abcdef';
      model.source.tables = [
        ...model.source.tables,
        { alias: existingId, source_type: 'staging', template_id: '', data_table_id: '', is_context: false }
      ];
      const back = expressionModelToV4Doc(model, doc, { ...CTX, stagingProducerNodeId: 'node-p1' });
      const added = back.query.sources.find(s => s.kind === 'staging');
      expect(added!.instance_id).toBe(existingId);
      expect(added!.instance_id.startsWith(STAGING_INSTANCE_PREFIX)).toBe(true);
    });

    it('往返（正向再反向）instance_id 不变', () => {
      const doc = makeDoc();
      doc.query.sources.push({
        kind: 'staging',
        instance_id: 'stg-node-p1-a1b2c3',
        alias: '上一步暂存区',
        producer_node_id: 'node-p1',
        output_schema_revision: 'v1'
      });
      const ctx: V4ModelAdapterContext = { ...CTX, stagingProducerNodeId: 'node-p1', stagingProducerLabel: '上一步暂存区' };
      const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, ctx), doc, ctx);
      const added = back.query.sources.find(s => s.kind === 'staging');
      expect(added!.instance_id).toBe('stg-node-p1-a1b2c3');
    });
  });

  describe('目录来源显示别名', () => {
    const LABELS: Record<string, string> = { 'tbl-order': '订单主表', 'tbl-stock': '入库流水的主表' };
    const withLabels: V4ModelAdapterContext = {
      ...CTX,
      tableLabelOf: src => LABELS[src.data_table_id]
    };

    it('新加来源：alias 按目录表名落定，不再用 instance_id 占位', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 't1', source_type: 'template', template_id: 'tpl-stock', data_table_id: 'tbl-stock', is_context: false }
      ];
      const back = expressionModelToV4Doc(model, doc, withLabels);
      expect(back.query.sources.find(x => x.instance_id === 't1')).toMatchObject({ kind: 'catalog', alias: '入库流水的主表' });
    });

    it('已存在的目录绑定：alias 也按当前目录重算（存量 t1 占位由此自愈），instance_id 不动', () => {
      const doc = makeDoc();
      doc.query.sources[1] = { ...doc.query.sources[1], alias: 't1' } as (typeof doc.query.sources)[number];
      const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, withLabels);
      expect(back.query.sources[1]).toMatchObject({ kind: 'catalog', instance_id: 'cat-order-b2', alias: '订单主表' });
    });

    it('同表多实例：按加入顺序追加 (1)(2)——与编辑器 instanceSuffix 同一条规则', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 't1', source_type: 'template', template_id: 'tpl-stock', data_table_id: 'tbl-stock', is_context: false },
        { alias: 't2', source_type: 'template', template_id: 'tpl-stock', data_table_id: 'tbl-stock', is_context: false }
      ];
      const back = expressionModelToV4Doc(model, doc, withLabels);
      expect(back.query.sources.find(x => x.instance_id === 't1')?.alias).toBe('入库流水的主表(1)');
      expect(back.query.sources.find(x => x.instance_id === 't2')?.alias).toBe('入库流水的主表(2)');
    });

    it('查不到表名（目录未加载 / 未提供钩子）：保持原别名，不擅自改', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 't9', source_type: 'template', template_id: 'tpl-x', data_table_id: 'tbl-unknown', is_context: false }
      ];
      expect(expressionModelToV4Doc(model, doc, withLabels).query.sources.find(x => x.instance_id === 't9')?.alias).toBe('t9');
      // 无钩子：既有绑定往返原样（回归既有「往返等价」性质）。
      expect(expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX).query.sources).toEqual(doc.query.sources);
    });

    it('本报表 / 暂存来源不受影响', () => {
      const doc = makeDoc();
      doc.query.sources.push({
        kind: 'staging', instance_id: 'stg-n_producer-a1b2c3', alias: '上一步暂存区',
        producer_node_id: 'n_producer', output_schema_revision: 'v1'
      });
      const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, withLabels);
      expect(back.query.sources[0]).toMatchObject({ kind: 'report', alias: '本表' });
      expect(back.query.sources[2]).toMatchObject({ kind: 'staging', alias: '上一步暂存区' });
    });
  });

  it('sidecar refs 标签：V4 wire 只有 last_label 时也带出（编辑区据此给引用染类型色）', () => {
    const v = v4ExpressionToValueRef(
      {
        expression_id: 'e',
        purpose: 'output',
        source_text: '[金额]#{r1}',
        refs: [{ ref_id: 'r1', kind: 'source_field', source_instance_id: 'o', field_id: 'f', last_label: '[订单表].[金额]' }]
      } as never,
      CTX
    );
    expect(v.text_source?.refs).toEqual([{ stable_id: 'r1', label: '[订单表].[金额]' }]);
  });

  // ── 本报表上下文表 → report 绑定────────────────────────────────
  describe('本报表上下文表（bt*）反向落 report 绑定', () => {
    const withLabels: V4ModelAdapterContext = {
      ...CTX,
      tableLabelOf: src => ({ 'tbl-main': '采购订单的主表', 'tbl-detail': '采购明细' })[src.data_table_id]
    };

    it('编辑器物化的 bt0/bt1 上下文表 ⇒ kind=report，instance_id 为 rpt-<table_id>-<6hex>（确定性），alias 取目录表名，table_role 取编辑器角色', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 'bt0', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-main', is_context: true, role: 'main' },
        { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-detail', is_context: true, role: 'detail' }
      ];
      const back = expressionModelToV4Doc(model, doc, withLabels);
      const main = back.query.sources.find(x => x.kind === 'report' && x.table_id === 'tbl-main' && x.instance_id !== 'rpt-main-a1');
      expect(main).toMatchObject({ kind: 'report', alias: '采购订单的主表', table_role: 'main' });
      expect(main?.instance_id).toMatch(/^rpt-tbl-main-[0-9a-f]{6}$/);
      expect(main?.instance_id).toBe(reportInstanceId({ alias: 'bt0', data_table_id: 'tbl-main' })); // 确定性
      const detail = back.query.sources.find(x => x.kind === 'report' && x.table_id === 'tbl-detail');
      expect(detail).toMatchObject({ kind: 'report', alias: '采购明细', table_role: 'detail' });
      expect(reportInstanceTableId(detail!.instance_id)).toBe('tbl-detail');
    });

    it('未被任何关联引入的 report 来源：补一条从根出发、ON 恒真的 INNER JOIN（V4 Join 图要求非根来源恰好被引入一次）', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-detail', is_context: true, role: 'detail' }
      ];
      const back = expressionModelToV4Doc(model, doc, withLabels);
      const detailId = reportInstanceId({ alias: 'bt1', data_table_id: 'tbl-detail' });
      const added = back.query.joins.find(j => j.right_instance_id === detailId);
      expect(added).toMatchObject({ left_instance_id: back.query.sources[0].instance_id, join_type: 'inner' });
      expect(added?.on).toMatchObject({ purpose: 'join_on', source_text: '1 = 1', refs: [] });
      // 既有关联原样在前，补的关联序号接在最后。
      expect(back.query.joins.map(j => j.sequence)).toEqual([1, 2]);
      // 往返：文档里已有该 report 来源与关联时不再重复补。
      const again = expressionModelToV4Doc(v4DocToExpressionModel(back, CTX), back, withLabels);
      expect(again.query.joins.filter(j => j.right_instance_id === detailId)).toHaveLength(1);
    });

    it('本报表主+明细的自动 record_id 关联（on 恒空）⇒ 恒真 ON 的 INNER JOIN；别名按实例 ID 翻译', () => {
      const doc = makeDoc();
      doc.query.sources = [doc.query.sources[1]]; // 只留目录来源作根
      doc.query.joins = [];
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 'bt0', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-main', is_context: true, role: 'main' },
        { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-detail', is_context: true, role: 'detail' }
      ];
      model.source.joins = [{ left_alias: 'bt0', right_alias: 'bt1', join_type: 'left', auto_record_id: true, on: [] }];
      const back = expressionModelToV4Doc(model, doc, withLabels);
      const mainId = reportInstanceId({ alias: 'bt0', data_table_id: 'tbl-main' });
      const detailId = reportInstanceId({ alias: 'bt1', data_table_id: 'tbl-detail' });
      expect(back.query.joins.map(j => [j.left_instance_id, j.right_instance_id, j.join_type, j.on.source_text])).toEqual([
        [mainId, detailId, 'inner', '1 = 1'],
        ['cat-order-b2', mainId, 'inner', '1 = 1']
      ]);
    });

    it('清掉本报表引用 ⇒ 调和剔除 report 来源后，正向留在模型里的默认关联不再回写（悬空关联剔除）', () => {
      // 第一步：物化 bt1 → 文档有 report 来源 + 默认 `1 = 1` 关联。
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-detail', is_context: true, role: 'detail' }
      ];
      const withReport = expressionModelToV4Doc(model, doc, withLabels);
      const detailId = reportInstanceId({ alias: 'bt1', data_table_id: 'tbl-detail' });
      expect(withReport.query.joins.some(j => j.right_instance_id === detailId)).toBe(true);
      // 第二步：正向回模型——默认关联是隐式关联，不进模型；
      // 再模拟调和剔除了 report 来源，回写时既无悬空关联可留、也不会为已剔除的来源再补默认关联。
      const model2 = v4DocToExpressionModel(withReport, CTX);
      expect(model2.source.joins.some(j => j.right_alias === detailId)).toBe(false);
      model2.source.tables = model2.source.tables.filter(t => t.alias !== detailId);
      const cleared = expressionModelToV4Doc(model2, withReport, withLabels);
      expect(cleared.query.sources.some(s => s.instance_id === detailId)).toBe(false);
      expect(cleared.query.joins.some(j => j.right_instance_id === detailId || j.left_instance_id === detailId)).toBe(false);
      expect(cleared.query.joins.map(j => j.sequence)).toEqual([1]);
    });

    it('用户为同一 report 来源配了真关联 ⇒ 早先补的恒真默认关联让位，只引入一次', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      model.source.tables = [
        ...model.source.tables,
        { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-detail', is_context: true, role: 'detail' }
      ];
      const withDefault = expressionModelToV4Doc(model, doc, withLabels);
      const detailId = reportInstanceId({ alias: 'bt1', data_table_id: 'tbl-detail' });
      const model2 = v4DocToExpressionModel(withDefault, CTX);
      // 用户在关联设计器里补了一条真关联（结构化谓词）。
      model2.source.joins.push({
        left_alias: 'cat-order-b2', right_alias: detailId, join_type: 'left', auto_record_id: false,
        on: [{ left: { alias: 'cat-order-b2', field_id: 'fld-order-no' }, op: 'eq', right: { alias: detailId, field_id: 'fld-no' } }]
      });
      const back = expressionModelToV4Doc(model2, withDefault, withLabels);
      const intro = back.query.joins.filter(j => j.right_instance_id === detailId);
      expect(intro).toHaveLength(1);
      expect(intro[0].on.source_text).not.toBe('1 = 1');
    });

    it('查不到表名时沿用旧绑定别名；rpt-* 形态的既有 report 绑定 instance_id 原样沿用', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      const back = expressionModelToV4Doc(model, doc, CTX);
      // makeDoc 自带的 rpt-main-a1（V4 原生实例 ID）：is_context + rpt- 前缀走本报表路径，ID 不变、alias 无目录时沿用旧值。
      expect(back.query.sources[0]).toEqual(doc.query.sources[0]);
    });
  });

  // ── 目录来源主+明细自动 record_id 关联──────────────────────────────
  // 用户显式加入的同模板主表+明细表（catalog 组，reconcile ②按 `${template_id}::src` 分组）与
  // 本报表 ctx 组走同一段 auto_record_id 产出代码，但两侧是真实数据表实例、V4 目录给它们都追加了
  // 系统字段 sys:record_id / sys:parent_record_id——本节验证合成的是真关联而非空洞 on.source_text=''。
  describe('目录来源主+明细自动 record_id 关联', () => {
    /** 追加一对同模板 catalog 主+明细来源 + 一条 auto_record_id:true/on:[] 的关联（reconcile ② 产物形状）。 */
    function withCatalogMainDetail(model: ExpressionModel, mainAlias = 'c-main', detailAlias = 'c-detail'): void {
      model.source.tables.push(
        { alias: mainAlias, source_type: 'template', template_id: 'tpl-x', data_table_id: 'tbl-x-main', is_context: false, role: 'main' },
        { alias: detailAlias, source_type: 'template', template_id: 'tpl-x', data_table_id: 'tbl-x-detail', is_context: false, role: 'detail' }
      );
      model.source.joins.push({ left_alias: mainAlias, right_alias: detailAlias, join_type: 'left', auto_record_id: true, on: [] });
    }

    it('合成 ON：[明细].[parent_record_id] = [主表].[record_id]，refs 绑两条系统列，join_type 透传 left', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      withCatalogMainDetail(model);
      const back = expressionModelToV4Doc(model, doc, CTX);
      const join = back.query.joins.find(j => j.left_instance_id === 'c-main' && j.right_instance_id === 'c-detail')!;
      expect(join).toBeDefined();
      expect(join.join_type).toBe('left');
      expect(join.on.source_text).toBe('[sys:parent_record_id]#{r1} = [sys:record_id]#{r2}');
      expect(join.on.refs).toEqual([
        { ref_id: 'r1', kind: 'source_field', source_instance_id: 'c-detail', field_id: 'sys:parent_record_id', last_label: 'sys:parent_record_id' },
        { ref_id: 'r2', kind: 'source_field', source_instance_id: 'c-main', field_id: 'sys:record_id', last_label: 'sys:record_id' }
      ]);
      // #{rN} 命名空间独立于其它表达式：本报表↔目录来源那条既有关联的 refs 原样未受影响。
      const otherJoin = back.query.joins.find(j => j.left_instance_id === 'rpt-main-a1')!;
      expect(otherJoin.on.refs.map(r => r.ref_id)).toEqual(['r1', 'r2']);
      expect(otherJoin.on.refs.map(r => r.field_id)).toEqual(['fld-no', 'fld-order-no']);
    });

    it('用户手配 ON 不被覆盖：j.on 非空时按手配谓词生成，不落系统列', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      withCatalogMainDetail(model);
      const join = model.source.joins.find(j => j.left_alias === 'c-main' && j.right_alias === 'c-detail')!;
      join.on = [{ left: { alias: 'c-main', field_id: 'fld-code' }, op: 'eq', right: { alias: 'c-detail', field_id: 'fld-parent-code' } }];
      const back = expressionModelToV4Doc(model, doc, CTX);
      const backJoin = back.query.joins.find(j => j.left_instance_id === 'c-main' && j.right_instance_id === 'c-detail')!;
      expect(backJoin.on.refs.map(r => r.field_id)).toEqual(['fld-code', 'fld-parent-code']);
      expect(backJoin.on.source_text).not.toContain('sys:record_id');
    });

    it('本报表 ctx 组不受影响：仍落恒真 1 = 1（与目录 catalog 组互斥分支）', () => {
      // 复用既有夹具：makeDoc 本身没有 ctx 组 auto_record_id 关联，这里现造一条与上面 catalog 场景
      // 并存，验证两条分支互不干扰。
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      withCatalogMainDetail(model);
      model.source.tables.push(
        { alias: 'bt0', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-main', is_context: true, role: 'main' },
        { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-detail', is_context: true, role: 'detail' }
      );
      model.source.joins.push({ left_alias: 'bt0', right_alias: 'bt1', join_type: 'left', auto_record_id: true, on: [] });
      const back = expressionModelToV4Doc(model, doc, CTX);
      const ctxJoin = back.query.joins.find(j => j.join_type === 'inner' && j.on.source_text === '1 = 1');
      expect(ctxJoin).toBeDefined();
      // 目录组同时存在且未被 ctx 分支的恒真兜底顶替。
      const catalogJoin = back.query.joins.find(j => j.left_instance_id === 'c-main' && j.right_instance_id === 'c-detail')!;
      expect(catalogJoin.on.source_text).not.toBe('1 = 1');
    });

    it('往返稳定：doc→model→doc 两圈后合成的 ON 不再变化（3.4 模型不携带 role，靠沿用上一份文档兜底）', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      withCatalogMainDetail(model);
      const once = expressionModelToV4Doc(model, doc, CTX);
      const twice = expressionModelToV4Doc(v4DocToExpressionModel(once, CTX), once, CTX);
      expect(twice).toEqual(once);
    });

    it('反向识别：合成出的 ON 在 v4DocToExpressionModel 里识别回 auto_record_id:true，on 置空（不当成手配谓词）', () => {
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      withCatalogMainDetail(model);
      const once = expressionModelToV4Doc(model, doc, CTX);
      const again = v4DocToExpressionModel(once, CTX);
      const join = again.source.joins.find(j => j.left_alias === 'c-main' && j.right_alias === 'c-detail')!;
      expect(join.auto_record_id).toBe(true);
      expect(join.on).toBeUndefined();
    });

    it('角色缺失或两侧同角色：不合成、不抛错，退化为空 ON 兜底并打警告', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const doc = makeDoc();
        const model = v4DocToExpressionModel(doc, CTX);
        // 两侧都是 detail：凑不出一主一明细。
        model.source.tables.push(
          { alias: 'd1', source_type: 'template', template_id: 'tpl-y', data_table_id: 'tbl-y-1', is_context: false, role: 'detail' },
          { alias: 'd2', source_type: 'template', template_id: 'tpl-y', data_table_id: 'tbl-y-2', is_context: false, role: 'detail' }
        );
        model.source.joins.push({ left_alias: 'd1', right_alias: 'd2', join_type: 'left', auto_record_id: true, on: [] });
        expect(() => expressionModelToV4Doc(model, doc, CTX)).not.toThrow();
        const back = expressionModelToV4Doc(model, doc, CTX);
        const join = back.query.joins.find(j => j.left_instance_id === 'd1' && j.right_instance_id === 'd2')!;
        expect(join.on.source_text).toBe('');
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('目录来源角色回填', () => {
    /** 一份最小文档：两个同模板 catalog 来源（正向翻译天然不带 role）+ 一条系统列自动
     *  record_id 关联——形态即 evidence/round11-0907/A5/config-save-readback.json 里已保存
     *  成功的 n_w4r11_a5_selfjoin 节点（同模板主表 + 明细做自身来源）。 */
    function makeCatalogSelfJoinDoc(): V4ExtractNodeDocument {
      return {
        schema_version: 'kimpo.extract-node/v4',
        syntax_profile: 'kimposql.mssql/v1',
        query: {
          sources: [
            { kind: 'catalog', instance_id: 'c-main', alias: '主表', app_id: 'app-1', template_id: 'tpl-x', data_table_id: 'tbl-x-main' },
            { kind: 'catalog', instance_id: 'c-detail', alias: '明细', app_id: 'app-1', template_id: 'tpl-x', data_table_id: 'tbl-x-detail' }
          ],
          joins: [
            {
              join_id: 'j-self',
              sequence: 1,
              left_instance_id: 'c-main',
              right_instance_id: 'c-detail',
              join_type: 'left',
              on: {
                expression_id: 'j-self:on',
                purpose: 'join_on',
                source_text: '[parent_record_id]#{r1} = [record_id]#{r2}',
                refs: [
                  { ref_id: 'r1', kind: 'source_field', source_instance_id: 'c-detail', field_id: 'sys:parent_record_id', last_label: 'parent_record_id' },
                  { ref_id: 'r2', kind: 'source_field', source_instance_id: 'c-main', field_id: 'sys:record_id', last_label: 'record_id' }
                ]
              }
            }
          ],
          options: { distinct: false, business_timezone: 'UTC' }
        },
        targets: []
      };
    }

    it('两个目录来源按系统列引用分别回填 main/detail 角色', () => {
      const doc = makeCatalogSelfJoinDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      const main = model.source.tables.find(t => t.alias === 'c-main');
      const detail = model.source.tables.find(t => t.alias === 'c-detail');
      expect(main?.role).toBe('main');
      expect(detail?.role).toBe('detail');
    });

    it('不覆盖已有角色：本报表来源的权威 table_role 不受本函数影响', () => {
      // makeDoc() 的本报表来源 rpt-main-a1 由 sourceBindingToTable 按 table_role='main' 给出 role，
      // 不参与本次系统列关联，回填函数须原样跳过（isCatalogRecordIdJoinOn 对该关联的 ON 判 false）。
      const doc = makeDoc();
      const model = v4DocToExpressionModel(doc, CTX);
      const report = model.source.tables.find(t => t.alias === 'rpt-main-a1');
      expect(report?.role).toBe('main');
    });

    it('非系统列关联（用户手配的普通字段等式）不触发角色回填', () => {
      const doc = makeCatalogSelfJoinDoc();
      doc.query.joins[0].on = {
        expression_id: 'j-self:on',
        purpose: 'join_on',
        source_text: '[code]#{r1} = [code]#{r2}',
        refs: [
          { ref_id: 'r1', kind: 'source_field', source_instance_id: 'c-main', field_id: 'fld-code', last_label: 'code' },
          { ref_id: 'r2', kind: 'source_field', source_instance_id: 'c-detail', field_id: 'fld-code', last_label: 'code' }
        ]
      };
      const model = v4DocToExpressionModel(doc, CTX);
      const main = model.source.tables.find(t => t.alias === 'c-main');
      const detail = model.source.tables.find(t => t.alias === 'c-detail');
      expect(main?.role).toBeUndefined();
      expect(detail?.role).toBeUndefined();
    });
  });

  // ── 占位输出行剔除─────────────────────
  describe('stripUnconfiguredOutputs', () => {
    function docWithPlaceholder(): V4ExtractNodeDocument {
      const doc = makeDoc();
      doc.targets = [
        {
          target_id: 'tgt-x',
          target_data_table_id: 'tbl-x',
          table_role: 'main',
          outputs: [
            { target_field_id: 'fld-a', expression: { expression_id: 'out:tbl-x:fld-a', purpose: 'output', source_text: "'W4'", refs: [] }, fill_strategy: 'overwrite' },
            // ⊞ 空值后 ✕ 清除 / 先选填充方式还没配表达式：编辑期占位，source_text 为空。
            { target_field_id: 'fld-b', expression: { expression_id: 'out:tbl-x:fld-b', purpose: 'output', source_text: '', refs: [] }, fill_strategy: 'merge', separator: ',' },
            { target_field_id: 'fld-c', expression: { expression_id: 'out:tbl-x:fld-c', purpose: 'output', source_text: '   ', refs: [] }, fill_strategy: 'overwrite' }
          ],
          clear: { mode: 'none', timing: 'before' }
        }
      ] as unknown as V4ExtractNodeDocument['targets'];
      // 暂存列同一颗粒度：已配置列 + 表达式为空白的两种占位（空串 / 纯空白）。
      doc.staging_target = {
        columns: [
          { column_id: 'col-a', name: '已配置列', expression: { expression_id: 'stg:col-a', purpose: 'output', source_text: "'X'", refs: [] } },
          { column_id: 'col-b', name: '空表达式列', expression: { expression_id: 'stg:col-b', purpose: 'output', source_text: '', refs: [] } },
          { column_id: 'col-c', name: '空白表达式列', expression: { expression_id: 'stg:col-c', purpose: 'output', source_text: '   ', refs: [] } }
        ]
      };
      return doc;
    }

    it('剔除 source_text 为空白的输出行，其余逐字保留；查询段不动；不改入参', () => {
      const doc = docWithPlaceholder();
      const out = stripUnconfiguredOutputs(doc);
      expect(out.targets[0].outputs.map(o => o.target_field_id)).toEqual(['fld-a']);
      expect(out.targets[0].outputs[0]).toEqual(doc.targets[0].outputs[0]);
      expect(out.query).toEqual(doc.query);
      expect(doc.targets[0].outputs).toHaveLength(3);
    });

    it('③：暂存列同口径剔除表达式为空白的列，已配置列保留，staging_target 对象本身仍保留（不因列被剔而变 undefined）', () => {
      const doc = docWithPlaceholder();
      const out = stripUnconfiguredOutputs(doc);
      expect(out.staging_target?.columns.map(c => c.column_id)).toEqual(['col-a']);
      expect(out.staging_target?.columns[0]).toEqual(doc.staging_target?.columns[0]);
      // staging_target 对象本身保留（空暂存目标必须往返存活的既有口径不变），不入参被改。
      expect(doc.staging_target?.columns).toHaveLength(3);
    });

    it('③：暂存列全被剔空后 staging_target 对象仍保留（columns:[]，由服务端「至少需要 1 列」保存闸兜底，本函数不越权拒绝）', () => {
      const doc = makeDoc();
      doc.staging_target = {
        columns: [{ column_id: 'col-only', name: '唯一列', expression: { expression_id: 'stg:col-only', purpose: 'output', source_text: '', refs: [] } }]
      };
      const out = stripUnconfiguredOutputs(doc);
      expect(out.staging_target).toEqual({ columns: [] });
    });

    it('没有 staging_target 时原样保持 undefined', () => {
      const doc = makeDoc();
      const out = stripUnconfiguredOutputs(doc);
      expect(out.staging_target).toBeUndefined();
    });

    it('编辑期往返仍保留占位行（填充方式等中间态不丢）——剔除只在送服务端前', () => {
      const doc = docWithPlaceholder();
      const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX);
      expect(back.targets[0].outputs.map(o => o.target_field_id)).toEqual(['fld-a', 'fld-b', 'fld-c']);
      expect(back.targets[0].outputs[1]).toMatchObject({ fill_strategy: 'merge', separator: ',' });
      expect(back.staging_target?.columns.map(c => c.column_id)).toEqual(['col-a', 'col-b', 'col-c']);
    });
  });

  // ── 暂存空列名的预览兜底───────────────────────────────
  describe('fillEmptyStagingNamesForPreview（仅用于实时语法检查/编译预览，不用于保存）', () => {
    it('空列名（trim 后为空）替换为 column_id，非空列名不动', () => {
      const doc = makeDoc();
      doc.staging_target = {
        columns: [
          { column_id: 'col-empty', name: '   ', expression: { expression_id: 'stg:col-empty', purpose: 'output', source_text: "'X'", refs: [] } },
          { column_id: 'col-named', name: '已起名', expression: { expression_id: 'stg:col-named', purpose: 'output', source_text: "'Y'", refs: [] } }
        ]
      };
      const out = fillEmptyStagingNamesForPreview(doc);
      expect(out.staging_target?.columns[0].name).toBe('col-empty'); // 空名 → column_id
      expect(out.staging_target?.columns[1].name).toBe('已起名'); // 非空名不动
      // 不改入参。
      expect(doc.staging_target?.columns[0].name).toBe('   ');
    });

    it('空列名且无 column_id 时保持原样（防御：新建列理应恒带 column_id）', () => {
      const doc = makeDoc();
      doc.staging_target = { columns: [{ name: '', expression: { expression_id: 'stg:x', purpose: 'output', source_text: "'X'", refs: [] } }] };
      const out = fillEmptyStagingNamesForPreview(doc);
      expect(out.staging_target?.columns[0].name).toBe('');
    });

    it('没有 staging_target 时原样返回（同一引用，不新建对象）', () => {
      const doc = makeDoc();
      const out = fillEmptyStagingNamesForPreview(doc);
      expect(out).toBe(doc);
    });
  });

  it('暂存来源：已存在的绑定往返原样保留（不被 catalog 兜底覆盖）', () => {
    const doc = makeDoc();
    doc.query.sources.push({
      kind: 'staging', instance_id: 'stg-n_producer-a1b2c3', alias: '上一步暂存区',
      producer_node_id: 'n_producer', output_schema_revision: 'v1'
    });
    const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX);
    expect(back.query.sources).toEqual(doc.query.sources);
  });

  it('选项：distinct/take 往返不丢', () => {
    const doc = makeDoc();
    const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX);
    expect(back.query.options).toEqual({ distinct: true, take: 100 });
  });
});

describe('valueRefToV4Expression 「未编辑」判据', () => {
  const PREV = {
    expression_id: 'out:tbl-main:fld-total',
    purpose: 'output' as const,
    source_text: '[金额]#{r1}',
    refs: [{ ref_id: 'r1', kind: 'source_field' as const, source_instance_id: 'cat-order-b2', field_id: 'fld-amt', last_label: '[订单表].[金额]' }],
    normalized_digest: 'digest-1'
  };
  const READABLE: Record<string, string> = { 'out:tbl-main:fld-total': '[订单表].[金额]' };
  const ctxReadable: V4ModelAdapterContext = { ...CTX, readableTextOf: (id, tokenized) => READABLE[id] ?? tokenized };

  it('文本等于 prev 的可读渲染 ⇒ 未编辑：整份沿用 prev（token 形态源码 + refs + digest 都不丢）', () => {
    const ref = { kind: 'raw' as const, text: '[订单表].[金额]', text_source: { text: '[订单表].[金额]', pack_revision: 'v4', digest: '', refs: [] } };
    const out = valueRefToV4Expression(ref, PREV.expression_id, 'output', PREV, ctxReadable);
    expect(out).toEqual(PREV);
  });

  it('文本等于 prev 的 token 形态（restore 未返回/失败时正向翻译回退的就是它）⇒ 同样未编辑', () => {
    const ref = { kind: 'raw' as const, text: '[金额]#{r1}', text_source: { text: '[金额]#{r1}', pack_revision: 'v4', digest: '', refs: [] } };
    expect(valueRefToV4Expression(ref, PREV.expression_id, 'output', PREV, ctxReadable)).toEqual(PREV);
    // 没给 readableTextOf 的调用方退回原口径：token 相等仍算未编辑。
    expect(valueRefToV4Expression(ref, PREV.expression_id, 'output', PREV)).toEqual(PREV);
  });

  it('文本真的改了 ⇒ 以用户文本为准、refs 留空等 tokenize 重绑', () => {
    const ref = { kind: 'raw' as const, text: '[订单表].[金额] * 2', text_source: { text: '[订单表].[金额] * 2', pack_revision: 'v4', digest: '', refs: [] } };
    expect(valueRefToV4Expression(ref, PREV.expression_id, 'output', PREV, ctxReadable)).toEqual({
      expression_id: PREV.expression_id,
      purpose: 'output',
      source_text: '[订单表].[金额] * 2',
      refs: [],
      normalized_digest: undefined
    });
  });

  it('修前必红（用户 2026-09-07 截图）：同一张表第二次加入来源，往返后存量输出/筛选仍是 token 形态且 refs 在，别名落成 (1)(2)', () => {
    const doc = makeDoc();
    const readable: Record<string, string> = {
      'out:tbl-main:fld-total': '[订单表].[金额]',
      'out:tbl-detail:fld-item': '[订单表].[品名]',
      filter: '[订单表].[金额] > 0'
    };
    const ctx: V4ModelAdapterContext = {
      ...CTX,
      readableTextOf: (id, tokenized) => readable[id] ?? tokenized,
      tableLabelOf: src => ({ 'tbl-order': '订单表' })[src.data_table_id]
    };
    // 打开节点：编辑器拿到的是可读文本。
    const model = v4DocToExpressionModel(doc, ctx);
    expect(model.targets?.[0]?.outputs?.[0]?.expression?.text_source?.text).toBe('[订单表].[金额]');
    // 用户再次加入同一张表（同 template/data_table），未动任何表达式。
    model.source.tables = [
      ...model.source.tables,
      { alias: 't1', source_type: 'template', template_id: 'tpl-order', data_table_id: 'tbl-order', is_context: false }
    ];
    const back = expressionModelToV4Doc(model, doc, ctx);
    // 别名按同表实例序号重算。
    expect(back.query.sources.find(x => x.instance_id === 'cat-order-b2')?.alias).toBe('订单表(1)');
    expect(back.query.sources.find(x => x.instance_id === 't1')?.alias).toBe('订单表(2)');
    // 存量表达式：token 形态源码与稳定引用原样保留（修前：source_text 变成可读文本、refs 被清空）。
    const out0 = back.targets[0].outputs[0].expression;
    expect(out0.source_text).toBe('[金额]#{r1}');
    expect(out0.refs).toHaveLength(1);
    expect(out0.refs[0]).toMatchObject({ ref_id: 'r1', source_instance_id: 'cat-order-b2', field_id: 'fld-amt' });
    const out1 = back.targets[1].outputs[0].expression;
    expect(out1.source_text).toBe('[品名]#{r1}');
    expect(out1.refs).toHaveLength(1);
    expect(back.query.filter?.source_text).toBe('[金额]#{r1} > 0');
    expect(back.query.filter?.refs).toHaveLength(1);
  });
});

describe('本报表上下文表的隐式关联不进设计态模型', () => {
  const mainId = reportInstanceId({ alias: 'bt0', data_table_id: 'tbl-main' });
  const detailId = reportInstanceId({ alias: 'bt1', data_table_id: 'tbl-detail' });
  const withLabels: V4ModelAdapterContext = { ...CTX, tableLabelOf: src => ({ 'tbl-order': '订单主表' } as Record<string, string>)[src.data_table_id] };
  /** 目录来源作根 + 本报表主/明细两张 report 来源，关联为写回时补出的形态：根→主 恒真、主→明细 恒真。 */
  function docWithImplicitReportJoins(): V4ExtractNodeDocument {
    const doc = makeDoc();
    doc.query.sources = [
      doc.query.sources[1],
      { kind: 'report', instance_id: mainId, alias: '采购订单的主表', table_id: 'tbl-main', table_role: 'main' },
      { kind: 'report', instance_id: detailId, alias: '采购明细', table_id: 'tbl-detail', table_role: 'detail' }
    ];
    doc.query.joins = [
      { join_id: 'cat-order-b2:' + mainId, sequence: 1, left_instance_id: 'cat-order-b2', right_instance_id: mainId, join_type: 'inner', on: { expression_id: 'join:cat-order-b2:' + mainId, purpose: 'join_on', source_text: '1 = 1', refs: [] } },
      { join_id: mainId + ':' + detailId, sequence: 2, left_instance_id: mainId, right_instance_id: detailId, join_type: 'inner', on: { expression_id: 'join:' + mainId + ':' + detailId, purpose: 'join_on', source_text: '1 = 1', refs: [] } }
    ];
    return doc;
  }

  it('恒真 ON 且任一端是 report 来源的关联不翻进模型：单来源节点的模型 joins 为空（不再显示「已关联」「表关联 · 2」）', () => {
    const doc = docWithImplicitReportJoins();
    const model = v4DocToExpressionModel(doc, CTX);
    expect(model.source.joins).toEqual([]);
    // 来源表本身照常翻进模型（本报表上下文表隐式、由 ExpressionEditor 按 is_context 不在来源卡片显示）。
    expect(model.source.tables.map(t => t.alias)).toEqual(['cat-order-b2', mainId, detailId]);
    const ids = new Set([mainId, detailId]);
    expect(doc.query.joins.every(j => isImplicitReportJoin(j, ids))).toBe(true);
  });

  it('往返稳定：模型里没有隐式关联，写回时按原规则补齐，每张 report 来源恰好被引入一次，既有关联的 join_id 复用', () => {
    const doc = docWithImplicitReportJoins();
    const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, withLabels);
    const introducers = back.query.joins.filter(j => j.right_instance_id === mainId || j.right_instance_id === detailId);
    expect(introducers.map(j => j.right_instance_id).sort()).toEqual([mainId, detailId].sort());
    expect(introducers.every(j => j.on.source_text === '1 = 1' && j.join_type === 'inner')).toBe(true);
    // 根→主 这条在上一份文档里已存在，join_id 原样复用。
    expect(back.query.joins.find(j => j.right_instance_id === mainId)?.join_id).toBe('cat-order-b2:' + mainId);
    // 再往返一次形状不变。
    const again = expressionModelToV4Doc(v4DocToExpressionModel(back, CTX), back, withLabels);
    expect(again.query.joins.map(j => [j.join_id, j.left_instance_id, j.right_instance_id, j.on.source_text])).toEqual(
      back.query.joins.map(j => [j.join_id, j.left_instance_id, j.right_instance_id, j.on.source_text])
    );
  });

  it('用户为 report 来源手配了真实 ON（非恒真）：照常翻进模型为手动关联', () => {
    const doc = docWithImplicitReportJoins();
    doc.query.joins[0].on = {
      expression_id: 'join:cat-order-b2:' + mainId,
      purpose: 'join_on',
      source_text: '[单号]#{r1} = [单号]#{r2}',
      refs: [
        { ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-order-no', last_label: '单号' },
        { ref_id: 'r2', kind: 'report_field', source_instance_id: mainId, table_id: 'tbl-main', field_id: 'fld-no', last_label: '单号' }
      ]
    };
    const model = v4DocToExpressionModel(doc, CTX);
    expect(model.source.joins).toHaveLength(1);
    expect(model.source.joins[0]).toMatchObject({ left_alias: 'cat-order-b2', right_alias: mainId, auto_record_id: false });
    expect(model.source.joins[0].on?.length).toBe(1);
  });

  it('makeDoc 夹具：根是 report 来源、关联带真实 ON ⇒ 不被当成隐式关联（既有往返用例的前提不变）', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    expect(model.source.joins).toHaveLength(doc.query.joins.length);
  });
});

describe('写模式关联往返（modelToV4Query 共用逻辑，取数/写节点同构）', () => {
  const mainId = reportInstanceId({ alias: 'bt0', data_table_id: 'tbl-main' });
  const detailId = reportInstanceId({ alias: 'bt1', data_table_id: 'tbl-detail' });
  const withLabels: V4ModelAdapterContext = { ...CTX, tableLabelOf: src => ({ 'tbl-detail': '采购明细' } as Record<string, string>)[src.data_table_id] };

  it('根因①：手动关联右表刚选中「本报表明细」（尚未登记进任何持久化文档）⇒ ON 引用须翻成真实 instance_id / report_field，不得原样带出编辑期字面量别名', () => {
    const doc = makeDoc();
    doc.query.sources = [doc.query.sources[1]]; // 只留目录来源 cat-order-b2 作根
    doc.query.joins = [];
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-detail', is_context: true, role: 'detail' }
    ];
    // 用户在关联设计器里新建一条手动关联：左=目录来源，右=本报表明细字面量别名 'bt1'
    //（JoinSettingsPanel.addJoin() 默认形状：on 携带一条谓词，字段暂未选择）。
    model.source.joins = [
      { left_alias: 'cat-order-b2', right_alias: 'bt1', join_type: 'left', auto_record_id: false, on: [{ left: { alias: 'cat-order-b2', field_id: '' }, right: { alias: 'bt1', field_id: '' }, op: 'eq' }] }
    ];
    const back = expressionModelToV4Doc(model, doc, withLabels);
    const join = back.query.joins.find(j => j.right_instance_id === detailId);
    expect(join).toBeTruthy();
    // 核心断言：refs 里指向本报表明细一侧的 source_instance_id 必须是真实 V4 实例 ID（detailId），
    // 不能是未翻译的编辑期字面量 'bt1'——'bt1' 从未出现在 query.sources[] 里，服务端按
    // instance_id 反查 Scope 会具名报「找不到」，这正是任务书背景描述的「节点无法保存」。
    const rightRef = join!.on.refs.find(r => r.source_instance_id !== 'cat-order-b2');
    expect(rightRef?.source_instance_id).toBe(detailId);
    // 引用种类须跟着来源种类走（本报表来源 ⇒ report_field，见 sourceOf 头注释）：翻译前的缺陷
    // 会因查不到来源种类而误落成 source_field。
    expect(rightRef?.kind).toBe('report_field');
  });

  it('根因②：report 来源的手动关联被用户删除后（表仍留在来源清单里）⇒ 补的占位关联须是全新恒真 ON，不得原样复用旧文档里那条携带真实字段引用的关联', () => {
    // prev 文档：根来源 cat-order-b2，report 明细来源 bt1，两者有一条**真实**手动关联
    //（非默认 1=1，用户已经配好了具体字段等式）——模拟用户配置成功过一次的历史状态。
    const doc = makeDoc();
    doc.query.sources = [
      doc.query.sources[1],
      { kind: 'report', instance_id: detailId, alias: '采购明细', table_id: 'tbl-detail', table_role: 'detail' }
    ];
    doc.query.joins = [
      {
        join_id: 'cat-order-b2:' + detailId,
        sequence: 1,
        left_instance_id: 'cat-order-b2',
        right_instance_id: detailId,
        join_type: 'left',
        on: {
          expression_id: 'join:cat-order-b2:' + detailId,
          purpose: 'join_on',
          source_text: '[单号]#{r1} = [单号]#{r2}',
          refs: [
            { ref_id: 'r1', kind: 'source_field', source_instance_id: 'cat-order-b2', field_id: 'fld-order-no', last_label: '单号' },
            { ref_id: 'r2', kind: 'report_field', source_instance_id: detailId, table_id: 'tbl-detail', field_id: 'fld-no', last_label: '单号' }
          ]
        }
      }
    ];
    const model = v4DocToExpressionModel(doc, withLabels);
    expect(model.source.joins).toHaveLength(1); // 真实 ON，不被 isImplicitReportJoin 隐藏。

    // 用户点击关联设计器的删除按钮：JoinSettingsPanel.removeJoin 只 splice 掉这一条 join，
    // 不触碰 source.tables（表的去留是 ExpressionEditor.reconcile 的职责，本函数不依赖它）。
    model.source.joins = [];

    const back = expressionModelToV4Doc(model, doc, withLabels);
    const join = back.query.joins.find(j => j.right_instance_id === detailId);
    expect(join).toBeTruthy();
    // 核心断言：该 report 来源本轮"未被任何关联引入"，理应补一条全新的恒真占位符——不得原样
    // 沿用旧文档里那条携带真实字段引用的关联（否则下一轮往返翻回 3.4 模型时，这条真实 ON 不再
    // 满足 isDefaultJoinOn，不被 isImplicitReportJoin 识别为隐式关联，会以「幽灵手动关联」形态
    // 复活——用户点删除无效）。
    expect(join!.on.source_text.replace(/\s+/g, '')).toBe('1=1');
    expect(join!.on.refs).toEqual([]);
    // 往返：翻回 3.4 模型后，这条关联应保持隐式（不显示为手动关联）。
    const modelAfterDelete = v4DocToExpressionModel(back, withLabels);
    expect(modelAfterDelete.source.joins).toHaveLength(0);
  });
});

describe('根来源归一（V4 sources[0] 即查询的根）', () => {
  function modelWithDetailFirst(): ExpressionModel {
    return {
      schema_version: 2,
      source: {
        tables: [
          { alias: 'bt1', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-ext', is_context: true, role: 'detail' },
          { alias: 'bt0', source_type: 'template', template_id: 'tpl-1', data_table_id: 'tbl-main', is_context: true, role: 'main' }
        ],
        joins: [{ left_alias: 'bt0', right_alias: 'bt1', join_type: 'left', auto_record_id: true, on: [] }]
      },
      targets: [],
      target: { target_template_id: 'tpl-1', target_data_table_id: '', outputs: [] }
    } as unknown as ExpressionModel;
  }

  it('明细表排在主表前面时，根被换成从不出现在 Join 右侧的那条来源', () => {
    const doc = expressionModelToV4Doc(modelWithDetailFirst(), makeDoc(), CTX);
    const rootId = doc.query.sources[0]!.instance_id;
    const introduced = new Set(doc.query.joins.map(j => j.right_instance_id));
    expect(doc.query.sources).toHaveLength(2);
    // 核心判据：根不得是任何 Join 的右侧。
    expect(introduced.has(rootId)).toBe(false);
    // 其余来源必须各被引入恰好一次。
    for (const s of doc.query.sources.slice(1)) expect(introduced.has(s.instance_id)).toBe(true);
  });

  it('根本来就合法时顺序原样不动（不无谓重排）', () => {
    const model = modelWithDetailFirst();
    model.source.tables = [model.source.tables[1]!, model.source.tables[0]!]; // 主表在前
    const doc = expressionModelToV4Doc(model, makeDoc(), CTX);
    const introduced = new Set(doc.query.joins.map(j => j.right_instance_id));
    expect(introduced.has(doc.query.sources[0]!.instance_id)).toBe(false);
  });
});
