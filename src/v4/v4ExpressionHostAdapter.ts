/**
 *
 * 为什么这样做：取数配置面换轨为直接挂载 ExpressionEditor（3.4 本体）后，编辑器及其子组件对宿主的
 * 全部要求都收在 ExpressionHost 这一个接口上。其中只有 `lowerText`（把用户写的文本降级成结构化
 * 表达式）在两条链路上语义不同——3.4 降级成 ValueRef/ConditionGroup，V4 则是 tokenize 成
 * 「token 化源码 + 稳定引用绑定表」。把这一处在 host 层转接掉，**包内组件一行都不用改**：
 * ExpressionEditor / AdvancedExpressionPanel（lowerText 的全部两个调用点都在它里面）以为自己在
 * 跟 3.4 宿主对话，实际拿到的是 V4 的绑定结果。
 *
 * 其余方法（listTemplates/listApps/fetchTree/listTables/listFields/loadCatalog…）与 V4 无关，
 * 直接委派给宿主注入的真实 domain:expression 桥，不做任何加工。
 *
 * 成功判据对齐：3.4 侧用 `isLowerTextSuccess()` 判成功——**text_source 在场且无 error 级诊断**。
 * 故 V4 tokenize 失败（ok=false）时不产出 text_source，让既有判据自然走失败分支，不另造信号。
 */

import type {
  ExpressionHost
} from '../host';
import type {
  LowerTextDiagnostic,
  LowerTextPurpose,
  LowerTextRequest,
  LowerTextResult,
  TextSource,
  TextSourceRef
} from '../types';
import type { AliceV4Host, V4Diagnostic, V4Purpose } from './types';
import type { V4ExpressionDocument, V4ExpressionRefWire } from './definition';
import { EMPTY_CONDITION_GROUP } from './expressionModelAdapter';

/** where 档可落到的两个 V4 谓词根用途（见 createV4ExpressionHost 的 options.wherePurpose）。 */
export type V4WherePurpose = Extract<V4Purpose, 'filter' | 'condition'>;

/** 3.4 用途 → V4 用途。3.4 只有 where/value 两档：where=谓词根（筛选），value=取值根（输出/ON）。
 *  V4 的 join_on 在编辑器里也走 value 档（关联 ON 是一条表达式，不是 3.4 的结构化谓词数组），
 *  故本映射把 value 统一落到 output——两者在 V4 绑定期的处理一致，差别只在编译期的用途标注，
 *  而编译期读的是 V4 文档自己写死的 purpose，不读这里。
 *  where 档则由调用方经 wherePurpose 指定落 filter（取数②筛选条件，缺省）还是 condition
 * 。 */
function toV4Purpose(purpose: LowerTextPurpose, wherePurpose: V4WherePurpose): V4Purpose {
  return purpose === 'where' ? wherePurpose : 'output';
}

/** V4 稳定引用 → 3.4 sidecar 引用项（稳定 ID + 降级当时的显示标签，两侧二元组逐字对应）。 */
function toTextSourceRefs(refs: V4ExpressionRefWire[]): TextSourceRef[] {
  return refs.map(r => ({ stable_id: r.ref_id, label: r.last_label }));
}

/** V4 诊断 → 3.4 诊断。V4 的位置只有 rune 偏移（可选），3.4 的 start/end 是字节偏移且必填——
 *  取不到时一律填 0：位置只用于编辑器里的波浪线高亮，取不到就退化为「整条不定位」，
 *  绝不因为缺位置把诊断本身吞掉（message 才是用户要看的东西）。 */
function toLowerTextDiagnostic(d: V4Diagnostic): LowerTextDiagnostic {
  const runeStart = d.rune_start ?? 0;
  const runeEnd = d.rune_end ?? 0;
  return {
    code: d.code,
    severity: d.severity,
    message: d.message,
    start: runeStart,
    end: runeEnd,
    rune_start: runeStart,
    rune_end: runeEnd
  };
}

/**
 * 用 V4 引擎的 tokenize 承接 3.4 的 lowerText。
 *
 * 产出的 ValueRef 本体是 kind='raw' 占位——V4 链路的执行面读的是 V4 文档自己的 source_text，
 * 从不读这个占位（同 ./expressionModelAdapter.ts 文件头的约定）；3.4 UI 读 text_source 显示原文，
 * 正是恒表达式模式下的既有渲染路径。
 * where 档需要一个合法的 ConditionGroup 才不会让调用方拿到 undefined，故给空组占位：V4 没有
 * 引导式条件，筛选的真实内容全在 text_source.text 里。
 */
async function lowerTextViaV4(
  v4Host: AliceV4Host,
  req: LowerTextRequest,
  wherePurpose: V4WherePurpose
): Promise<LowerTextResult> {
  const res = await v4Host.tokenize({ text: req.text, purpose: toV4Purpose(req.purpose, wherePurpose) });
  const sidecar: TextSource = {
    text: req.text,
    locale: req.locale,
    pack_revision: 'alice-v4',
    digest: res.digest,
    refs: toTextSourceRefs(res.refs ?? [])
  };
  const diagnostics = (res.diagnostics ?? []).map(toLowerTextDiagnostic);
  if (!res.ok) {
    // 不产出 text_source ⇒ isLowerTextSuccess() 自然判失败（既有判据，不另造信号）。
    return { purpose: req.purpose, diagnostics };
  }
  // V4 随身包：上面的 `refs` 是 3.4 二元组口径，还原不了绑定；条件节点要存整份 V4
  // 文档（token 化 source_text + 完整 refs），故成功时把 tokenize 的原始产物一并挂在 sidecar 上。
  // 只在成功分支写：失败时根本不产出 text_source，不存在半成品随身包。取数链路照旧不读该字段
  // （它走 expressionModelToV4Doc 自己重新 tokenize），多带一份不改变其行为。
  sidecar.v4 = { source_text: res.source_text, refs: res.refs ?? [] };
  return {
    purpose: req.purpose,
    value: req.purpose === 'value' ? { kind: 'raw', text: req.text, text_source: sidecar } : undefined,
    condition: req.purpose === 'where' ? EMPTY_CONDITION_GROUP : undefined,
    text_source: sidecar,
    diagnostics
  };
}

/**
 * 造一个「表达式能力走 V4、其余走宿主原桥」的 ExpressionHost。
 *
 * @param base    宿主注入的真实 domain:expression 桥（目录/表/字段等全部原样委派给它）。
 * @param v4Host  宿主注入的 domain:alice-v4 桥（表达式绑定走它）。
 * @param options wherePurpose：where 档（谓词根）落到哪个 V4 用途。缺省 'filter' —— 取数②筛选
 *                条件这条既有链路一字不改（零回归）；动作条件分支传 'condition'。
 */
export function createV4ExpressionHost(
  base: ExpressionHost,
  v4Host: AliceV4Host,
  options?: { wherePurpose?: V4WherePurpose }
): ExpressionHost {
  const wherePurpose = options?.wherePurpose ?? 'filter';
  return {
    ...base,
    lowerText: (req: LowerTextRequest) => lowerTextViaV4(v4Host, req, wherePurpose)
  };
}

/**
 * 3.4 sidecar → 整份 V4 表达式文档（纯函数，无副作用）。
 *
 * 缺随身包 ⇒ 返回 null（不猜、不半造）：这只在 sidecar 不是本适配器产出时发生
 * （如 3.4 链路的 sidecar、或历史存档），调用方据此走「旧格式，请重新配置」分支。
 *
 * @param textSource   编辑器确认后回传的 sidecar。
 * @param expressionId 文档的 expression_id（条件节点即 condition_id）。
 * @param purpose      文档用途（条件节点恒 'condition'）。
 */
export function textSourceToV4ExpressionDocument(
  textSource: TextSource,
  expressionId: string,
  purpose: V4Purpose
): V4ExpressionDocument | null {
  const carried = textSource.v4;
  if (!carried) return null;
  return {
    expression_id: expressionId,
    purpose,
    source_text: carried.source_text,
    refs: carried.refs,
    // digest 由服务端在绑定期算出，前端只原样带回（供「未改」判定与保存闸核验）。
    normalized_digest: textSource.digest
  };
}
