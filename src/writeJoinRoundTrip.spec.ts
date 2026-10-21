/**
 * 写模式关联往返确定性复现。
 *
 * 症状：写模式关联设计器把右表选成「本报表.出库明细」后，每次选值都会多出一条「手动关联」
 * （左右表落候选池 [0]/[1] 的默认值，即 JoinSettingsPanel.addJoin() 的默认形状），删除按钮点了
 * 也会被补回来。上一张卡已证伪「ExpressionEditor.reconcile() 补手动关联」与「点击穿透」——
 * 本文件专测双向适配器 v4WriteDocToExpressionModel/expressionModelToV4WriteDoc 的往返本身
 * （不挂 ExpressionEditor.vue，不跑 reconcile），只用手工 mutate 模拟 reconcile 会做的事
 * （① 本报表 context 表登记进 source.tables、② 主+明细自动 record_id 关联），逐步核对
 * model.source.joins 里「手动关联」（!auto_record_id）的条数是否往返稳定。
 *
 * 根因定位（本文件断言 + console 输出实测，两处独立缺陷，均在 v4/expressionModelAdapter.ts
 * 的 modelToV4Query 反向翻译 3.4 model → V4 doc 内）：
 *
 * ① 关联 ON 的别名未经 idOf() 翻译（约 :1108-1110）：函数早几行已建好 `idOf()`（3.4 编辑期
 *    别名 → V4 稳定 instance_id 的映射，`j.left_alias`/`j.right_alias` 顶层字段老老实实经过了
 *    它），但处理 `j.on`（关联条件谓词数组）时直接 `predicatesToJoinOn(j.on, expressionID, ctx)`
 *    把**原始未翻译**的 3.4 别名（如本报表上下文表的字面量 'bt1'）喂进去。于是一条刚创建的
 *    手动关联，顶层 right_instance_id 正确翻成了 V4 实例 ID（rpt-<table_id>-<hash>），但
 *    on.refs[].source_instance_id 却停在 'bt1'——两处指代同一张表却是两个不同字符串。
 *    `ctx.sourceOf`（配置面按 instance_id 反查来源种类的口子，宿主实现见
 *    ActionConfigSurface.vue :396）用 'bt1' 反查不到任何来源（真正登记的是 rpt-*），于是这条
 *    引用被误判成种类 source_field 而非 report_field；更严重的是，持久化的文档携带一个指向
 *    **不存在的 instance_id**（'bt1' 从未出现在 query.sources[] 里）的 source_field 引用，
 *    服务端 v4/bind 解析设计态文本或编译期解析 refs 时按 source_instance_id 查 Scope.Sources
 *    必然「找不到」——这正是任务书背景里「节点无法保存」的直接成因。断言见 (a) 步。
 *
 * ② 「补齐尚未引入的 report 来源」默认关联合成段（约 :1150-1160）：`on: hit?.on &&
 *    hit.on.source_text ? hit.on : alwaysTrueJoinOn(expressionID)` 只要 prevQuery 里还留着
 *    一条同起讫点的旧 join 且其 on.source_text 非空——不论那是不是本适配层自己合成的默认
 *    `1 = 1`——就原样复用。用户删除一条手动关联后，只要该 report 来源仍留在 sources 里
 *    （① 缺陷放大器：本文件不挂 ExpressionEditor.reconcile，模拟的正是"表未及时剔除注册"这一
 *    真实存在的中间态），这条判据会把刚被删除的、携带真实字段引用的旧 ON **原样复活**，
 *    使其在下一轮往返翻回 3.4 模型时不再满足 isDefaultJoinOn（真实 ON ≠ 恒真 `1 = 1`），
 *    从而不被 isImplicitReportJoin 隐藏——以「手动关联」形态重新出现，且用户点删除无效。
 *    断言见 (d) 步：判据应改为「只有 hit.on 本身就是本适配层合成的默认恒真关联
 *    （isDefaultJoinOn(hit.on)）时才复用（保 join_id/expression_id 稳定），否则一律用全新的
 *    alwaysTrueJoinOn——不管旧 doc 里躺着什么内容，"未被任何关联引入"就该退回结构占位符，
 *    不该把历史真实配置当占位符误用。
 */
import { describe, expect, it } from 'vitest';
import { v4WriteDocToExpressionModel, expressionModelToV4WriteDoc } from './v4/writeModelAdapter';
import { reportInstanceId, type V4ModelAdapterContext } from './v4/expressionModelAdapter';
import { emptyWriteNodeDocument } from './v4/writeNodeDocument';
import type { V4WriteNodeDocument } from './v4/writeNodeDocument';
import type { ExpressionModel, JoinSpec } from './types';

// ── 夹具：与 expressionEditorWriteJoinReportTable.spec.ts 同一场景（写模式·右表=本报表明细）──
const REPORT_TEMPLATE_ID = 'tpl_report';
const DT_MAIN = 'dt_po_main';
const DT_DETAIL = 'dt_po_detail';
const CATALOG_TEMPLATE_ID = 'tpl_catalog';
const DT_CATALOG = 'dt_catalog_main';
const CATALOG_INSTANCE = 't1';
// 本报表两张表在编辑器里的字面量别名（reportAlias(i)=`bt<i>`，见 ExpressionEditor.vue :240）：
// 主表恒 bt0、这里的明细恒 bt1（本报表只有两张表，索引固定，测试直接写死不复用生产实现）。
const MAIN_ALIAS = 'bt0';
const DETAIL_ALIAS = 'bt1';
const MAIN_ID = reportInstanceId({ alias: MAIN_ALIAS, data_table_id: DT_MAIN });
const DETAIL_ID = reportInstanceId({ alias: DETAIL_ALIAS, data_table_id: DT_DETAIL });

const TABLE_LABELS: Record<string, string> = {
  [DT_MAIN]: '出库单的主表',
  [DT_DETAIL]: '出库明细',
  [DT_CATALOG]: '商品档案的主表'
};
const FIELD_LABELS: Record<string, string> = {
  f_name: '商品名称',
  f_material: '明细商品'
};

function initialDoc(): V4WriteNodeDocument {
  const doc = emptyWriteNodeDocument('update');
  doc.query.sources = [
    { kind: 'catalog', instance_id: CATALOG_INSTANCE, alias: '商品档案的主表', app_id: 'app-1', template_id: CATALOG_TEMPLATE_ID, data_table_id: DT_CATALOG }
  ];
  doc.target = { instance_id: CATALOG_INSTANCE };
  return doc;
}

/** 适配上下文：sourceOf/fieldLabelOf 按「当前持久化文档」（往返前的那一份）反查——与
 *  ActionConfigSurface.vue :396/:413 的真实实现同一口径（宿主用 `model.value.query.sources`，
 *  这里用 docRef.value.query.sources），docRef 由调用方在每轮往返后原地更新，模拟宿主
 *  `onUpdateModel(doc)` 落盘的效果。 */
function makeCtx(docRef: { value: V4WriteNodeDocument }): V4ModelAdapterContext {
  return {
    templateId: REPORT_TEMPLATE_ID,
    readableTextOf: (_id, tokenized) => tokenized,
    tableLabelOf: src => TABLE_LABELS[src.data_table_id],
    fieldLabelOf: (instanceId, fieldId) => {
      const src = docRef.value.query.sources.find(s => s.instance_id === instanceId);
      return (src ? FIELD_LABELS[fieldId] : undefined) ?? fieldId;
    },
    sourceOf: alias => docRef.value.query.sources.find(s => s.instance_id === alias)
  };
}

/** 手动关联条数（!auto_record_id）——本文件核心不变量。 */
function manualJoinCount(m: ExpressionModel): number {
  return m.source.joins.filter(j => !j.auto_record_id).length;
}

/** 打印一步的 sources/joins 快照，供汇报贴关键输出。 */
function snapshot(label: string, model: ExpressionModel, doc: V4WriteNodeDocument): void {
  // eslint-disable-next-line no-console
  console.log(
    `\n[${label}] model.source.tables=`,
    JSON.stringify(model.source.tables.map(t => ({ alias: t.alias, is_context: t.is_context, role: t.role }))),
    `\n[${label}] model.source.joins=`,
    JSON.stringify(model.source.joins),
    `\n[${label}] doc.query.sources=`,
    JSON.stringify(doc.query.sources),
    `\n[${label}] doc.query.joins=`,
    JSON.stringify(doc.query.joins.map(j => ({ l: j.left_instance_id, r: j.right_instance_id, auto: j.on.refs.length === 0 && j.on.source_text.replace(/\s+/g, '') === '1=1', on: j.on })))
  );
}

/** 模拟 ExpressionEditor.reconcile() 会为「用户把手动关联右表选成本报表明细」这一操作做的最小
 *  必要登记：① 把 bt1（明细）+ bt0（主表锚点）纳入 source.tables；② 补一条 bt0↔bt1 的自动
 *  record_id 关联。本文件刻意不引入 ExpressionEditor.vue 本体（任务书①要求先在纯适配器层
 *  复现），故手写这一小段等价效果——真实 reconcile 实现见 ExpressionEditor.vue :350 起。 */
function registerReportDetailAnchor(m: ExpressionModel): void {
  if (!m.source.tables.some(t => t.alias === DETAIL_ALIAS)) {
    m.source.tables.push({ alias: DETAIL_ALIAS, source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: DT_DETAIL, is_context: true, role: 'detail' });
  }
  if (!m.source.tables.some(t => t.alias === MAIN_ALIAS)) {
    m.source.tables.push({ alias: MAIN_ALIAS, source_type: 'template', template_id: REPORT_TEMPLATE_ID, data_table_id: DT_MAIN, is_context: true, role: 'main' });
  }
  if (!m.source.joins.some(j => j.auto_record_id && j.left_alias === MAIN_ALIAS && j.right_alias === DETAIL_ALIAS)) {
    m.source.joins.push({ left_alias: MAIN_ALIAS, right_alias: DETAIL_ALIAS, join_type: 'left', auto_record_id: true, on: [] });
  }
}

describe('写模式关联往返确定性复现（写文档 ⇄ 3.4 模型，不挂组件）', () => {
  it('(a)(b)(c)(d) 手动关联往返稳定：加关联→再往返→补 ON→删除，全程手动关联条数 1/1/1/0', () => {
    const docRef = { value: initialDoc() };
    const ctx = makeCtx(docRef);

    // (a) 加一条手动关联：左=商品档案(t1)，右=出库明细别名(bt1)，字段未选（addJoin() 默认形状：
    //     on 携带一条谓词但两侧 field_id 为空串，见 JoinSettingsPanel.vue :67 addJoin()）。
    const modelA = v4WriteDocToExpressionModel(docRef.value, ctx);
    expect(manualJoinCount(modelA)).toBe(0);
    registerReportDetailAnchor(modelA);
    const manualJoin: JoinSpec = {
      left_alias: CATALOG_INSTANCE,
      right_alias: DETAIL_ALIAS,
      join_type: 'left',
      auto_record_id: false,
      on: [{ left: { alias: CATALOG_INSTANCE, field_id: '' }, op: 'eq', right: { alias: DETAIL_ALIAS, field_id: '' } }]
    };
    modelA.source.joins.push(manualJoin);
    const docA = expressionModelToV4WriteDoc(modelA, docRef.value, ctx);
    docRef.value = docA;
    // 根因钉点：手动关联的 ON 里，右侧引用的 source_instance_id 必须与 docA.query.sources 里
    // 真正登记的本报表明细来源 instance_id（DETAIL_ID，rpt-<table_id>-<hash> 形态）一致——
    // 而不是未翻译的 3.4 编辑期字面量别名 'bt1'。此断言在根因未修时会失败（实际值是 'bt1'）。
    const manualJoinInDocA = docA.query.joins.find(j => j.on.refs.some(r => r.field_id === ''));
    expect(manualJoinInDocA).toBeTruthy();
    expect(manualJoinInDocA?.right_instance_id).toBe(DETAIL_ID);
    const rightRefInDocA = manualJoinInDocA?.on.refs.find(r => r.source_instance_id !== CATALOG_INSTANCE);
    expect(rightRefInDocA?.source_instance_id).toBe(DETAIL_ID);
    expect(rightRefInDocA?.kind).toBe('report_field');
    expect(docA.query.sources.some(s => s.instance_id === MAIN_ID)).toBe(true);
    const modelAfterA = v4WriteDocToExpressionModel(docA, ctx);
    snapshot('(a) 加关联后往返', modelAfterA, docA);
    expect(manualJoinCount(modelAfterA)).toBe(1);

    // (b) 再往返一次：不做任何新编辑（模拟用户没碰关联、但界面其余交互又触发了一次
    //     update()/reconcile() 循环）——手动关联条数不应因为"什么都没做"而多出一条。
    const docB = expressionModelToV4WriteDoc(modelAfterA, docRef.value, ctx);
    docRef.value = docB;
    const modelAfterB = v4WriteDocToExpressionModel(docB, ctx);
    snapshot('(b) 空转再往返一次', modelAfterB, docB);
    expect(manualJoinCount(modelAfterB)).toBe(1);

    // (c) 补上关联条件：商品名称(f_name) = 明细商品(f_material)。
    const joinToFill = modelAfterB.source.joins.find(j => !j.auto_record_id);
    expect(joinToFill).toBeTruthy();
    expect(joinToFill?.on?.[0]).toBeTruthy();
    joinToFill!.on![0].left.field_id = 'f_name';
    joinToFill!.on![0].right.field_id = 'f_material';
    const docC = expressionModelToV4WriteDoc(modelAfterB, docRef.value, ctx);
    docRef.value = docC;
    const modelAfterC = v4WriteDocToExpressionModel(docC, ctx);
    snapshot('(c) 补 ON 字段后往返', modelAfterC, docC);
    expect(manualJoinCount(modelAfterC)).toBe(1);
    const filledJoin = modelAfterC.source.joins.find(j => !j.auto_record_id);
    // ON 两侧字段须保持用户选的值，且别名须与该关联当前的 left_alias/right_alias 一致
    //（不能停在往返前的旧别名，否则前端字段下拉会读到"别的表"的字段目录）。
    expect(filledJoin?.on?.[0]?.left).toEqual({ alias: filledJoin?.left_alias, field_id: 'f_name' });
    expect(filledJoin?.on?.[0]?.right).toEqual({ alias: filledJoin?.right_alias, field_id: 'f_material' });

    // (d) 删除该手动关联（JoinSettingsPanel.removeJoin：按下标 splice，不触碰其余表/关联）。
    modelAfterC.source.joins = modelAfterC.source.joins.filter(j => j.auto_record_id);
    const docD = expressionModelToV4WriteDoc(modelAfterC, docRef.value, ctx);
    docRef.value = docD;
    const modelAfterD = v4WriteDocToExpressionModel(docD, ctx);
    snapshot('(d) 删除关联后往返', modelAfterD, docD);
    expect(manualJoinCount(modelAfterD)).toBe(0);

    const docD2 = expressionModelToV4WriteDoc(modelAfterD, docRef.value, ctx);
    const modelAfterD2 = v4WriteDocToExpressionModel(docD2, ctx);
    snapshot('(d’) 删除后再空转一轮', modelAfterD2, docD2);
    expect(manualJoinCount(modelAfterD2)).toBe(0);
  });
});
