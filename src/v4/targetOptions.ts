/**
 * V4 取数节点文档 —— 目标页签选项表（纯函数，无 Vue 依赖，供 V4TargetTabs.vue 与宿主/插件复用）。
 *
 * 每项返回 { value, labelKey }：labelKey 复用包内**已有** `editor.*` 文案键（见 ../ExpressionEditor.vue
 * :1376-1498 与 ../locales/zh-CN.ts 等四语词表），本文件不新增任何词条——3.4 面（ExpressionEditor.vue
 * 内的 clearModeOptionsFor/strategyOptionsFor/separatorOptions）与本表逻辑等价，后续应改为直接引用
 * 本表。
 *
 * 消费方用包内 `useT()`（见 ../host.ts）把 labelKey 换成当前语言文案：
 *   const t = useT(); const label = t(opt.labelKey);
 */
import type { V4TableRole, V4ClearMode, V4ClearTiming, V4FillStrategy } from './nodeDocument';

/** 选项条目通用形状：value 为该项取值，labelKey 为包内既有词表键。 */
export interface V4OptionItem<T extends string> {
  value: T;
  labelKey: string;
}

export function clearModeOptionsFor(role: V4TableRole): V4OptionItem<V4ClearMode>[] {
  const base: V4OptionItem<V4ClearMode>[] = [];
  if (role !== 'main') {
    base.push({ value: 'all', labelKey: 'editor.clearModeAll' });
  }
  base.push({ value: 'mapped', labelKey: 'editor.clearModeMapped' });
  base.push({ value: 'none', labelKey: 'editor.clearModeNone' });
  return base;
}

/** 清空时机选项（对齐 ExpressionEditor.vue:1386 clearTimingOptions），与角色无关，恒两项。 */
export const CLEAR_TIMING_OPTIONS: V4OptionItem<V4ClearTiming>[] = [
  { value: 'before', labelKey: 'editor.clearTimingBefore' },
  { value: 'after', labelKey: 'editor.clearTimingAfter' }
];

/**
 * 填充策略选项（对齐 ExpressionEditor.vue:1469 strategyOptionsFor，V4 版去掉已退役的 append）：
 * - overwrite/merge 恒可选；
 * - row_match 仅明细目标（role='detail'）且未开自动匹配（autoRowMatch=false）时可选——主表全局唯一
 *   一行不存在"该写哪一行"，自动匹配模式下匹配键改由条件段自动提取，两条声明通道不应并存；
 * - current 为 row_match 时即使被上述条件隐藏（如角色/开关随后变化），也保留在列表内可见，避免下拉
 *   静默清空存量配置——交由保存闸在后端真正拒绝（同 ExpressionEditor.vue 既有"前端只是便利"注释口径）。
 */
export function fillStrategyOptionsFor(
  role: V4TableRole,
  autoRowMatch: boolean,
  current?: V4FillStrategy
): V4OptionItem<V4FillStrategy>[] {
  const base: V4OptionItem<V4FillStrategy>[] = [
    { value: 'overwrite', labelKey: 'editor.strategyOverwrite' },
    { value: 'merge', labelKey: 'editor.strategyMerge' }
  ];
  const rowMatchAllowed = role === 'detail' && !autoRowMatch;
  if (rowMatchAllowed || current === 'row_match') {
    base.push({ value: 'row_match', labelKey: 'editor.strategyRowMatch' });
  }
  return base;
}

/** 合并分隔符预设（对齐 ExpressionEditor.vue:1490 separatorOptions，7 项），仅 fill_strategy='merge' 时使用。 */
export const SEPARATOR_PRESETS: V4OptionItem<string>[] = [
  { value: ',', labelKey: 'editor.sepComma' },
  { value: ';', labelKey: 'editor.sepSemicolon' },
  { value: '.', labelKey: 'editor.sepPeriod' },
  { value: ' ', labelKey: 'editor.sepSpace' },
  { value: '+', labelKey: 'editor.sepPlus' },
  { value: '/', labelKey: 'editor.sepSlash' },
  { value: '\n', labelKey: 'editor.sepNewline' }
];

/** 分隔符默认值（对齐 ExpressionEditor.vue outputForIn/upsertOutputIn 新建输出行的默认 separator）。 */
export const DEFAULT_SEPARATOR = ',';
