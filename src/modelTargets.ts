/**
 * 多填充目标归一化工具（目标由单数 target 升级为多数 targets 的兼容层）。
 *
 * 背景：ExpressionModel 曾只有单个 `target: TargetSpec`（含内嵌 `chart_targets`）。多目标改造后
 * 新增 `targets?: TargetSpec[]`（多填充目标表）与顶层 `chart_targets?: ChartTargetSpec[]`
 * （图表目标升为与表目标平级），但 `target` 保留为 legacy 镜像字段以兼容旧读者。
 *
 * 本文件是读写这套双写策略的唯一入口：
 * - 读：readTargets / readChartTargets 做归一化，调用方不必关心新旧字段先后顺序。
 * - 写：writeTargets 原地写新字段，并同步维护 target 镜像，保证旧读者继续可用。
 *
 * 纯函数，不依赖 Vue / 组件层，供 ExpressionEditor.vue 等后续接线任务复用。
 */

import type { ChartTargetSpec, ExpressionModel, TargetSpec, ValueRef } from './types';
import { isStagingTarget } from './types';

/** 读取多填充目标表：model.targets 优先；否则 model.target 存在则包一层数组；都无返回空数组。 */
export function readTargets(model: ExpressionModel): TargetSpec[] {
  if (model.targets) return model.targets;
  if (model.target) return [model.target];
  return [];
}

/** 读取「表目标」子集（Phase B，动作暂存区）：readTargets() 剔除暂存目标（target_kind==='staging'）与
 *  占位空壳（target_data_table_id===''，即"从未配置过"的旧模型骨架）。
 *  背景：ExpressionEditor.vue 里多处曾各自内联 `t.target_data_table_id !== ''` 过滤（③目标多选/tabs/
 *  自动匹配等），暂存目标改造后若不统一收编，这些散落过滤要么把暂存目标误当表目标处理（暂存目标同样
 *  target_data_table_id===''，天然会被该内联过滤排除，看似"安全"，但下面 writeTargets 收尾若拿同一份
 *  裸过滤结果整体回写，会把暂存目标一并静默吞掉），本函数是唯一入口，调用方不必重复这条过滤规则。 */
export function readTableTargets(model: ExpressionModel): TargetSpec[] {
  const list = readTargets(model).filter(t => !isStagingTarget(t) && t.target_data_table_id !== '');
  // 按 target_data_table_id 去重（保留第一条），理由同 readChartTargets 的 dedupeByChartId：
  // tab key 是 `table:${target_data_table_id}`，同 id 出现两次会让 key 冲突、渲染错乱且删不掉。
  const seen = new Set<string>();
  return list.filter(t => {
    if (seen.has(t.target_data_table_id)) return false;
    seen.add(t.target_data_table_id);
    return true;
  });
}

/** 读取暂存目标（Phase B）：一模型至多一个，取首个命中项；不存在返回 undefined。 */
export function readStagingTarget(model: ExpressionModel): TargetSpec | undefined {
  return readTargets(model).find(isStagingTarget);
}

/** 来源段是否已含暂存来源表（Phase B）：一模型至多一张，SourceTreePicker 据此禁选重复添加。 */
export function hasStagingSource(model: ExpressionModel): boolean {
  return model.source.tables.some(t => t.source_type === 'staging');
}

/** 读取图表目标：顶层 model.chart_targets 优先，回落 legacy 的 model.target.chart_targets，
 *  再回落多目标表 model.targets[0].chart_targets（同为 legacy 镜像位置），都无返回空数组。 */
export function readChartTargets(model: ExpressionModel): ChartTargetSpec[] {
  if (model.chart_targets) return dedupeByChartId(model.chart_targets);
  if (model.target?.chart_targets) return dedupeByChartId(model.target.chart_targets);
  if (model.targets?.[0]?.chart_targets) return dedupeByChartId(model.targets[0].chart_targets);
  return [];
}

/**
 * 按 chart_id 去重，**保留第一条**。
 *
 * 写入侧新增分支本就有 `!chartTargets.some(c => c.chart_id === cid)` 守卫、移除分支用 filter 会一次
 * 删净同 id 全部，两者都不会**新产生**重复；这里做的是读侧兜底，让既有脏数据一进内存就归一，
 * 用户下次保存时经 writeTargets 原样写回即自愈。
 *
 * 🔴 保留第一条而非最后一条：UI 侧 activeChartSpec 一直是 `find(c => c.chart_id === …)`（取第一条），
 * 保留第一条＝用户当前所见不变，修复只消除重复 tab，不静默改写他正在编辑的映射内容。
 */
function dedupeByChartId(list: ChartTargetSpec[]): ChartTargetSpec[] {
  const seen = new Set<string>();
  return list.filter(c => {
    if (seen.has(c.chart_id)) return false;
    seen.add(c.chart_id);
    return true;
  });
}

/** 产出一个空白 TargetSpec（多目标场景下新增一个填充目标时用）。
 *  形状对齐 emptyExpressionModel()（types.ts）里既有的空 target 骨架：只给必填壳字段，
 *  不预置 clear/match_keys/auto_row_match 等 fill 专属默认值（由取数动作侧按节点类型注入，
 *  避免污染写动作节点，参见 emptyExpressionModel 注释）。 */
export function emptyTarget(templateId = ''): TargetSpec {
  return { target_template_id: templateId, target_data_table_id: '', outputs: [] };
}

/** 产出一个空白暂存目标 TargetSpec（Phase B，动作暂存区：多目标场景下新增暂存目标时用）。
 *  target_template_id/target_data_table_id 恒空串；
 *  不预置 fill_strategy 等取数回填专属默认值——StagingTargetSection.vue 自行构造无策略的 OutputMapping。 */
export function emptyStagingTarget(): TargetSpec {
  return { target_kind: 'staging', target_template_id: '', target_data_table_id: '', outputs: [] };
}

/**
 * 原地写多填充目标 + 图表目标，并同步维护 legacy 镜像字段 target。
 *
 * 双写策略：
 * - targets 非空写 model.targets；为空数组时删除该 key（保持"无多目标配置=零 key"的旧形状）。
 * - chartTargets 非空写顶层 model.chart_targets；为空时删除该 key。
 * - model.target 恒镜像为**首个非暂存目标**（Phase B 修补：暂存目标 target_kind==='staging' 的
 *   target_data_table_id 恒空串，若被选作镜像源，旧读者直读 model.target.target_data_table_id 会误判
 *   "目标未配置"；镜像必须跳过暂存目标取表目标，全部目标皆为暂存目标时镜像退化为 emptyTarget()，
 *   与"无表目标"语义一致）的深拷贝（避免共享引用被后续修改污染两处），并把其
 *   chart_targets 同步镜像为 chartTargets（供未升级到顶层字段的旧读者继续读到图表目标）。
 *   无非暂存目标时，target 镜像为 emptyTarget() 形状的空目标，保持旧读者不因 target 缺失而崩溃。
 */
export function writeTargets(model: ExpressionModel, targets: TargetSpec[], chartTargets: ChartTargetSpec[]): void {
  if (targets.length > 0) {
    // 🔴 写进 model.targets 前必须剥掉每个 target 内嵌的 chart_targets。
    //
    // 内嵌位置只是 **legacy 镜像**：图表目标的权威是顶层 model.chart_targets，镜像由下面的
    // model.target 统一维护。而 readChartTargets 的回落链第三条正是 `model.targets[0].chart_targets`
    // ——旧结构模型（只有单数 target、chart_targets 内嵌其中）上删图表时，targets 数组里装的就是
    // 那个仍带着 chart_targets 的原 target 对象，于是「删掉 → 写回 → 下一次读又从 targets[0] 把它
    // 读回来」，表现为**图表目标怎么点都删不掉**。
    model.targets = targets.map(t => {
      if (!('chart_targets' in t)) return t;
      const { chart_targets: _legacyMirror, ...rest } = t;
      return rest as TargetSpec;
    });
  } else {
    delete model.targets;
  }

  if (chartTargets.length > 0) {
    model.chart_targets = chartTargets;
  } else {
    delete model.chart_targets;
  }

  // legacy 镜像：取首个**非暂存**目标（见上方函数注释），深拷贝避免与 targets 内对象共享引用。
  const firstTableTarget = targets.find(t => !isStagingTarget(t));
  const mirrored: TargetSpec = firstTableTarget ? JSON.parse(JSON.stringify(firstTableTarget)) : emptyTarget();
  if (chartTargets.length > 0) {
    mirrored.chart_targets = JSON.parse(JSON.stringify(chartTargets));
  } else {
    delete mirrored.chart_targets;
  }
  model.target = mirrored;
}

/**
 * 一个图表目标里全部槽位表达式的扁平清单（按形态取用，缺席槽位跳过）。
 */
export function chartSlotExpressions(chart: ChartTargetSpec): ValueRef[] {
  const m = chart.mapping;
  const out: ValueRef[] = [];
  const push = (v: ValueRef | undefined) => {
    if (v) out.push(v);
  };
  if (m.form === 'categorySeries') {
    push(m.category);
    push(m.series);
    push(m.value);
    (m.values ?? []).forEach(vc => push(vc.expression));
  } else if (m.form === 'nameValue') {
    push(m.name);
    push(m.value);
  } else {
    push(m.x);
    push(m.y);
    push(m.series);
  }
  return out;
}
