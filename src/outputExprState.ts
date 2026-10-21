/**
 * 输出表达式「空/未配置」判据（2026-09-07 从 ExpressionEditor.vue 抽出成纯模块）：
 * ③目标段普通字段行与暂存区列行共用同一份——凡按「有值/无值」决定 UI 态（filled 高亮、✕ 显隐、空态
 * 短横杠）或确认时剔行的地方，一律用这里的两个函数，不得各写一份。
 */
import type { ValueRef } from './types';

/** 「不填充」占位：整个缺省，或 {kind:'const'} 且 value 缺省（ExpressionInput ✕ 清空 / ƒ 面板删光文本
 *  emptyAsUnconfigured 落成的形态）。用户主动填 ''/0/null 的 const 不算空。 */
export function isEmptyExpr(v?: ValueRef | null): boolean {
  if (!v) return true;
  if (v.kind === 'const') return v.value === undefined;
  return false;
}

/** 「已配置」的反面：除 isEmptyExpr 的占位外，还要认 V4 壳往返回来的空文本形态——占位经适配层反向翻译成
 *  source_text:''，再正向翻译回来就是 {kind:'raw', text:'', text_source:{text:''}}；它和占位一样都是
 *  「没配」。3.4 口径不变：用户主动填 ''/0/null 的 const 仍算已配置。 */
export function isUnconfiguredOutputExpr(v?: ValueRef | null): boolean {
  if (isEmptyExpr(v)) return true;
  if (v!.kind === 'raw' || v!.text_source) return !(v!.text_source?.text ?? v!.text ?? '').trim();
  return false;
}
