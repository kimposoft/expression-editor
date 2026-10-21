import { describe, expect, it } from 'vitest';
import { dedupeColumnNames } from './fieldMultiPick';

/**
 * FieldMultiPickDialog.vue配套纯函数 dedupeColumnNames 的单测。
 * 规则见该文件头注释：与 existing 或候选之间更早出现的名字重名时依次加 (2)/(3)…（半角括号），trim 后比较。
 */
describe('dedupeColumnNames', () => {
  it('无冲突：候选与 existing、候选彼此都不重名，原样返回（仅 trim）', () => {
    expect(dedupeColumnNames(['已有列A', '已有列B'], ['金额', '数量'])).toEqual(['金额', '数量']);
  });

  it('与已有列冲突：加 (2)；existing 本身不受影响', () => {
    expect(dedupeColumnNames(['金额'], ['金额'])).toEqual(['金额(2)']);
  });

  it('候选之间冲突：第二、第三个同名候选依次加 (2)/(3)，与 existing 无关', () => {
    expect(dedupeColumnNames([], ['金额', '金额', '金额'])).toEqual(['金额', '金额(2)', '金额(3)']);
  });

  it('候选与 existing 中已存在的 (2) 变体冲突时，跳过 (2) 直接落到 (3)', () => {
    // existing 里已经有「金额(2)」——说明「金额」「金额(2)」都已被占用，新候选「金额」应落到「金额(3)」。
    expect(dedupeColumnNames(['金额', '金额(2)'], ['金额'])).toEqual(['金额(3)']);
  });

  it('trim 比较：前后空白不计入判重，输出为 trim 后的名字', () => {
    expect(dedupeColumnNames(['金额'], ['  金额  '])).toEqual(['金额(2)']);
    // existing 里的名字也按 trim 后参与比较。
    expect(dedupeColumnNames(['  金额  '], ['金额'])).toEqual(['金额(2)']);
  });

  it('existing 与候选都为空：返回空数组', () => {
    expect(dedupeColumnNames([], [])).toEqual([]);
  });

  it('大小写敏感（不做大小写归一化，只做 trim）：不同大小写视为不同名字', () => {
    expect(dedupeColumnNames(['Amount'], ['amount'])).toEqual(['amount']);
  });
});
