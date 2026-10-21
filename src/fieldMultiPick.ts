/**
 * FieldMultiPickDialog.vue配套的纯函数：列名去重。
 *
 * 场景：批量勾选多个来源字段作为视图列时，右栏列名默认取字段名——同名字段（同一张表的两个不同
 * 字段本就可能重名？不会，但跨分组/跨表批量选择时很常见，如「订单.金额」与「订单明细.金额」都叫
 * 「金额」）与既有列名（existingNames，视图已有的列）都可能撞车，需要统一的去重口径。
 *
 * 规则：与 existing 或本次候选中更早出现的名字重名时，依次加 (2)、(3)…（半角括号，与编辑器同表
 * 多实例序号写法一致，见 rawSerialize.ts instanceSuffix 的 `(N)` 后缀）。比较前先 trim（前后空白
 * 不计入判重，避免"金额 "与"金额"被误判为不同名字）。
 */
export function dedupeColumnNames(existing: string[], candidates: string[]): string[] {
  // 已占用名字集合：先装入 existing（trim 后），随候选逐个消费再滚动加入，
  // 使"候选之间互相冲突"与"候选和 existing 冲突"走同一套判重逻辑。
  const usedNames = new Set(existing.map(name => name.trim()));
  const result: string[] = [];
  for (const raw of candidates) {
    const base = raw.trim();
    let candidate = base;
    let seq = 2;
    while (usedNames.has(candidate)) {
      candidate = `${base}(${seq})`;
      seq += 1;
    }
    usedNames.add(candidate);
    result.push(candidate);
  }
  return result;
}
