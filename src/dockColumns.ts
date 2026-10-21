import type { DockColumn } from './types';
import { instanceSuffix, type SourceTableLite, type FormTableLite } from './rawSerialize';

/**
 * 树坞列的降级构造器（供 AdvancedExpressionDialog.vue 在拿不到父级 ExpressionEditor 精确分组时兜底）。
 *
 * 背景：ExpressionEditor.vue 手上是完整模型 SourceTable[]（含 template_id），能按模板归属把同模板的
 * 多张来源表合并成一列（见其 sourceColumnsForDock 的分组算法）。但 AdvancedExpressionDialog.vue 的
 * 独立调用方（ConditionTree.vue、表格编辑器字段控件、视图过滤等，见其 sourceTables/formTables 两个 prop）
 * 手上只有 rawSerialize.ts 的 Lite 形态快照——SourceTableLite 里**没有 template_id**，天然无法按模板分组。
 *
 * 降级口径（与 ExpressionEditor.vue:465-499 sourceColumnsForDock 里「拿不到模板归属就一个来源表单独
 * 成一列」的降级分支保持同一语义，只是这里*恒*走该分支，因为 Lite 形态压根不携带模板归属）：
 * - 当前模板列：formTables 直接映射（本报表各表天然一表一别名，不需要 (N) 序号，同
 *   ExpressionEditor.vue currentColumnForDock 的口径）；
 * - 数据源列：每张显式来源表单独成一列，列头/表标签沿用 instanceSuffix 的既有惯例
 *   `${表名}${instanceSuffix(...)}`（同表多实例追加 (N) 序号，判据与 ExpressionEditor.vue 完全一致，
 *   不另发明一套）；字段列表直接透传，不做任何裁剪。
 * - SourceTableLite/FormTableLite 均不携带 viewFieldsUnsupported/stagingUnsupported 降级提示标记
 *   （Lite 快照本就没有这两个字段），故降级产出的 DockTable 也不带这两个提示——这是 Lite 形态本身的
 *   信息缺口，不是本构造器丢的信息。
 */

/** 降级构造器的产出：当前模板列 + 数据源列清单，形状与 FieldTreeDock 的 currentColumn/sourceColumns
 *  两个 prop 一一对应，供 AdvancedExpressionDialog.vue 直接展开使用。 */
export interface DockColumnsBundle {
  current: DockColumn;
  sources: DockColumn[];
}

/** 从 Lite 形态构造树坞列（降级口径：拿不到模板归属，故一张显式来源表单独成一列）。
 *  currentHeader：当前模板列的列头文案，由调用方传入（AdvancedExpressionDialog.vue 无 templateId，
 *  拿不到真实模板名，按 FieldTreePanel 既有「本报表」tab 同一文案回退，不新造一套措辞）。 */
export function buildDockColumnsFromLite(
  sourceTables: SourceTableLite[],
  formTables: FormTableLite[],
  currentHeader: string
): DockColumnsBundle {
  const current: DockColumn = {
    header: currentHeader,
    // 本报表各表按 FormTableLite.alias 直接透传（未带 alias 的理论上不应出现——本报表各表
    // 恒由调用方经 reportAlias 物化隐式别名，此处仍防御性过滤，避免产出无法点选的表节点）。
    tables: formTables
      .filter((ft): ft is FormTableLite & { alias: string } => !!ft.alias)
      .map(ft => ({ alias: ft.alias, label: ft.table.table_name, fields: ft.fields }))
  };
  const sources: DockColumn[] = sourceTables.map(st => {
    // 表标签沿用 instanceSuffix 既有惯例（同表多实例追加 (N)），与 ExpressionEditor.vue 的
    // 「拿不到模板归属」降级分支同一份判据；列头与列内唯一表复用同一份文案，不重复计算。
    const label = `${st.name}${instanceSuffix(st.alias, st.dataTableId, sourceTables)}`;
    return { header: label, tables: [{ alias: st.alias, label, fields: st.fields }] };
  });
  return { current, sources };
}
