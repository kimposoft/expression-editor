/**
 * createV4ExpressionHost.lowerText 判据：ƒ 面板确定后落进模型的必须是**可读原文**，
 * 不能是 tokenize 出的 `[单号]#{r1}`——适配层把 text_source.text 原样当 source_text、refs 留空等收口，
 * 带标记却无绑定表会被服务端拒「未提供稳定引用 #{r1} 的绑定」。
 */
import { describe, expect, it, vi } from 'vitest';
import { createV4ExpressionHost, textSourceToV4ExpressionDocument } from './v4ExpressionHostAdapter';
import type { AliceV4Host } from './types';
import type { ExpressionHost } from '../host';

function v4Host(overrides: Partial<AliceV4Host> = {}): AliceV4Host {
  return {
    loadCatalog: vi.fn(async () => ({ renamed: false, sources: [], report: { tables: [] }, staging: { columns: [] }, functions: [], keywords: [] })),
    diagnose: vi.fn(async () => ({ ok: true, tokens: [], ast: null, refs: [], envelope: null, digest: '', diagnostics: [] })),
    tokenize: vi.fn(async () => ({
      ok: true,
      source_text: '[单号]#{r1}',
      refs: [{ ref_id: 'r1', kind: 'report_field' as const, table_id: 'tbl-main', field_id: 'fld-no', last_label: '本报表.[采购订单的主表].[单号]' }],
      digest: 'd1',
      diagnostics: []
    })),
    restore: vi.fn(async () => ({ ok: true, text: '', digest: '', diagnostics: [] })),
    compile: vi.fn(async () => ({ ok: true, targets: [] })),
    ...overrides
  };
}

describe('createV4ExpressionHost.lowerText（V4 承接 3.4 降级）', () => {
  it('🔴 成功时 value/text_source 保留用户可读原文，不落 token 化文本；refs 带回稳定 ID + 显示标签', async () => {
    const host = createV4ExpressionHost({} as unknown as ExpressionHost, v4Host());
    const res = await host.lowerText!({ text: '本报表.[采购订单的主表].[单号]', purpose: 'value', refs: [], locale: 'zh-CN' } as never);
    expect(res.value).toMatchObject({ kind: 'raw', text: '本报表.[采购订单的主表].[单号]' });
    expect(res.text_source).toMatchObject({ text: '本报表.[采购订单的主表].[单号]', digest: 'd1' });
    expect(res.text_source?.refs).toEqual([{ stable_id: 'r1', label: '本报表.[采购订单的主表].[单号]' }]);
    // 🔴 判据收窄自「整份结果不含 #{r1}」：token 化源码现在**刻意**随 sidecar.v4 带回，
    // 整份 JSON 必然含 `#{r1}`。原判据真正要守的是「落进模型的两处（value 本体与 text_source.text）
    // 是可读原文」——改为逐字段断言，守护力不减、且不再与随身包互斥。
    expect(res.value?.text).not.toContain('#{r1}');
    expect(res.text_source?.text).not.toContain('#{r1}');
  });

  it('🔴 成功时 sidecar 带 V4 随身包（token 化源码 + 完整 refs），textSourceToV4ExpressionDocument 能还原整份文档', async () => {
    const host = createV4ExpressionHost({} as unknown as ExpressionHost, v4Host());
    const res = await host.lowerText!({ text: '本报表.[采购订单的主表].[单号]', purpose: 'where', refs: [], locale: 'zh-CN' } as never);

    expect(res.text_source?.v4).toEqual({
      source_text: '[单号]#{r1}',
      refs: [{ ref_id: 'r1', kind: 'report_field', table_id: 'tbl-main', field_id: 'fld-no', last_label: '本报表.[采购订单的主表].[单号]' }]
    });

    const doc = textSourceToV4ExpressionDocument(res.text_source!, 'cond-1', 'condition');
    expect(doc).toEqual({
      expression_id: 'cond-1',
      purpose: 'condition',
      source_text: '[单号]#{r1}',
      // 完整 refs（kind/table_id/field_id 俱全）——3.4 sidecar 的二元组 refs 还原不了这些。
      refs: [{ ref_id: 'r1', kind: 'report_field', table_id: 'tbl-main', field_id: 'fld-no', last_label: '本报表.[采购订单的主表].[单号]' }],
      normalized_digest: 'd1'
    });
  });

  it('sidecar 无 V4 随身包（3.4 链路产出或历史存档）⇒ textSourceToV4ExpressionDocument 返回 null，不半造文档', () => {
    const doc = textSourceToV4ExpressionDocument(
      { text: 'A > 1', pack_revision: 'v3', digest: 'd0', refs: [{ stable_id: 's1', label: 'A' }] },
      'cond-1',
      'condition'
    );
    expect(doc).toBeNull();
  });

  it('wherePurpose 缺省 ⇒ where 档落 filter（取数②筛选条件既有链路零回归）', async () => {
    const bridge = v4Host();
    const host = createV4ExpressionHost({} as unknown as ExpressionHost, bridge);
    await host.lowerText!({ text: 'A > 1', purpose: 'where', refs: [], locale: 'zh-CN' } as never);
    expect(bridge.tokenize).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'filter' }));
  });

  it('wherePurpose=condition ⇒ where 档落 condition，value 档仍是 output', async () => {
    const bridge = v4Host();
    const host = createV4ExpressionHost({} as unknown as ExpressionHost, bridge, { wherePurpose: 'condition' });

    await host.lowerText!({ text: 'A > 1', purpose: 'where', refs: [], locale: 'zh-CN' } as never);
    expect(bridge.tokenize).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'condition' }));

    await host.lowerText!({ text: 'A + 1', purpose: 'value', refs: [], locale: 'zh-CN' } as never);
    expect(bridge.tokenize).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: 'output' }));
  });

  it('tokenize 不通过 ⇒ 不产出 text_source（既有判失败口径），诊断原样带回', async () => {
    const host = createV4ExpressionHost(
      {} as unknown as ExpressionHost,
      v4Host({
        tokenize: vi.fn(async () => ({
          ok: false, source_text: '', refs: [], digest: '',
          diagnostics: [{ code: 'E', phase: 'bind', severity: 'error' as const, message: '找不到来源实例', rune_start: 0, rune_end: 3 }]
        }))
      })
    );
    const res = await host.lowerText!({ text: '[x].[y]', purpose: 'value', refs: [], locale: 'zh-CN' } as never);
    expect(res.text_source).toBeUndefined();
    expect(res.diagnostics[0]?.message).toBe('找不到来源实例');
  });
});
