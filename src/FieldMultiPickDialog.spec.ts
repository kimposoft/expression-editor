import { afterEach, describe, expect, it } from 'vitest';
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { NInput } from 'naive-ui';
import FieldMultiPickDialog from './FieldMultiPickDialog.vue';
import zhCN from './locales/zh-CN';

/**
 * FieldMultiPickDialog.vue单测。
 *
 * 🔴 挂载方式说明：本组件内层是 NModal，内容经 Teleport 挂到 document.body 之下、脱离
 * wrapper.element 自身的渲染子树——`wrapper.find()`/`wrapper.findAll()` 只在组件自身挂载点下
 * 查找，找不到被传送出去的节点（已用最小复现验证：探测用例见 zzModalProbe，未提交）。本文件对
 * 弹窗内的原生 DOM（按钮/勾选行/复选框）一律走 `document.body.querySelector` + DOMWrapper 包一层，
 * 复用 .trigger()/.classes()/.text() 等既有 API；naive-ui 组件实例（NInput）用 wrapper.findComponent
 * 仍然可行——findComponent 走的是 Vue 组件树而非 DOM 树，Teleport 不改变组件父子关系
 * （同一处已用最小复现验证 vm.$emit 能正确回写并反映到被传送的 DOM 上）。此手法与
 * expressionEditorWriteJoinReportTable.spec.ts 的既有先例一致。
 */

interface Group {
  key: string;
  label: string;
  badge?: string;
  colorIndex: number;
  fields: Array<{ id: string; label: string; dataType: string }>;
}

const GROUPS: Group[] = [
  {
    key: 'g1',
    label: '订单',
    badge: '常规视图',
    colorIndex: 0,
    fields: [
      { id: 'f1', label: '金额', dataType: 'number' },
      { id: 'f2', label: '备注', dataType: 'text' },
      { id: 'f3', label: '附件', dataType: 'attachment' }
    ]
  },
  {
    key: 'g2',
    label: '客户',
    colorIndex: 1,
    fields: [{ id: 'f4', label: '名称', dataType: 'text' }]
  }
];

let currentWrapper: VueWrapper | null = null;

function mountDialog(
  overrides: Partial<{ addedKeys: string[]; unsupportedFieldTypes: string[]; existingNames: string[]; groups: Group[] }> = {}
): VueWrapper {
  currentWrapper = mount(FieldMultiPickDialog, {
    props: {
      show: true,
      groups: overrides.groups ?? GROUPS,
      addedKeys: overrides.addedKeys ?? ['g1::f2'],
      unsupportedFieldTypes: overrides.unsupportedFieldTypes ?? ['attachment'],
      existingNames: overrides.existingNames ?? ['金额']
    }
  }) as VueWrapper;
  return currentWrapper;
}

afterEach(() => {
  currentWrapper?.unmount();
  currentWrapper = null;
});

function body(selector: string): Element | null {
  return document.body.querySelector(selector);
}
function bodyAll(selector: string): Element[] {
  return Array.from(document.body.querySelectorAll(selector));
}
/** 断言存在后包一层 DOMWrapper，复用 .trigger()/.classes()/.text() 等 API；找不到直接抛错，
 *  不把"找不到"悄悄坍缩成对 null 属性的 TypeError（同 expressionEditorWriteJoinReportTable.spec.ts 先例）。 */
function need(selector: string): DOMWrapper<Element> {
  const el = body(selector);
  expect(el, `expected to find "${selector}" in document.body`).not.toBeNull();
  return new DOMWrapper(el as Element);
}
function colNameInputs(wrapper: VueWrapper) {
  return wrapper.findAllComponents(NInput).filter(w => w.attributes('data-testid') === 'fmp-col-name-input');
}

describe('FieldMultiPickDialog：分组渲染 / 搜索 / 全选 / 置灰 / 右栏 / confirm', () => {
  it('分组渲染：组名 / badge（数据表分组不传）/ 色点按 colorIndex、字段行按组分列', () => {
    mountDialog();

    const g1Fields = bodyAll('.fmp-group[data-group-key="g1"] [data-testid="fmp-field-row"]');
    expect(g1Fields.map(el => el.getAttribute('data-field-id'))).toEqual(['f1', 'f2', 'f3']);
    const g2Fields = bodyAll('.fmp-group[data-group-key="g2"] [data-testid="fmp-field-row"]');
    expect(g2Fields.map(el => el.getAttribute('data-field-id'))).toEqual(['f4']);

    expect(need('.fmp-group[data-group-key="g1"] .fmp-group-label').text()).toBe('订单');
    expect(need('.fmp-group[data-group-key="g1"] .fmp-group-badge').text()).toBe('常规视图');
    expect(body('.fmp-group[data-group-key="g2"] .fmp-group-badge')).toBeNull();

    expect(need('.fmp-group[data-group-key="g1"] .ttc-dot').classes()).toContain('ttc-0');
    expect(need('.fmp-group[data-group-key="g2"] .ttc-dot').classes()).toContain('ttc-1');
  });

  it('搜索过滤：按字段名过滤（trim/大小写不敏感），命中 0 个字段的分组整组隐藏', async () => {
    const wrapper = mountDialog();
    const search = wrapper.findAllComponents(NInput).find(w => w.attributes('data-testid') === 'fmp-search');
    expect(search).toBeTruthy();

    // 「名」只命中 g2 的「名称」——g1 三个字段（金额/备注/附件）都不含「名」，整组应隐藏。
    await search!.vm.$emit('update:value', '名');
    expect(body('.fmp-group[data-group-key="g1"]')).toBeNull();
    const g2Fields = bodyAll('.fmp-group[data-group-key="g2"] [data-testid="fmp-field-row"]');
    expect(g2Fields.map(el => el.getAttribute('data-field-id'))).toEqual(['f4']);

    // 清空搜索词，两组恢复。
    await search!.vm.$emit('update:value', '');
    expect(body('.fmp-group[data-group-key="g1"]')).not.toBeNull();
    expect(body('.fmp-group[data-group-key="g2"]')).not.toBeNull();
  });

  it('组头「全选/取消全选」只作用于该组可选字段（已添加/不支持不受影响）', async () => {
    mountDialog();
    const toggleAll = need('[data-testid="fmp-group-toggle-all"][data-group-key="g1"]');
    expect(toggleAll.text()).toBe(zhCN['fieldMultiPick.selectAll']);

    await toggleAll.trigger('click');
    // g1 可选字段只有 f1（金额）——f2 已添加、f3 不支持，全选后右栏只应新增这一行。
    expect(bodyAll('[data-testid="fmp-picked-row"]').map(el => el.getAttribute('data-field-id'))).toEqual(['f1']);
    expect(need('[data-testid="fmp-group-toggle-all"][data-group-key="g1"]').text()).toBe(zhCN['fieldMultiPick.deselectAll']);

    await need('[data-testid="fmp-group-toggle-all"][data-group-key="g1"]').trigger('click');
    expect(bodyAll('[data-testid="fmp-picked-row"]')).toHaveLength(0);
  });

  it('已添加与不支持字段置灰不可选，带对应小标签，点击不加入右栏', async () => {
    mountDialog();

    const addedRow = need('[data-testid="fmp-field-row"][data-field-id="f2"]');
    expect(addedRow.classes()).toContain('fmp-field-row--disabled');
    expect(addedRow.find('[data-testid="fmp-badge-added"]').text()).toBe(zhCN['fieldMultiPick.added']);
    await addedRow.trigger('click');
    expect(bodyAll('[data-testid="fmp-picked-row"]')).toHaveLength(0);

    const unsupportedRow = need('[data-testid="fmp-field-row"][data-field-id="f3"]');
    expect(unsupportedRow.classes()).toContain('fmp-field-row--disabled');
    expect(unsupportedRow.find('[data-testid="fmp-badge-unsupported"]').text()).toBe(zhCN['drawer.fieldTypeUnsupported']);
    await unsupportedRow.trigger('click');
    expect(bodyAll('[data-testid="fmp-picked-row"]')).toHaveLength(0);

    // 可选字段（f1）不受影响，正常可选。
    const okRow = need('[data-testid="fmp-field-row"][data-field-id="f1"]');
    expect(okRow.classes()).not.toContain('fmp-field-row--disabled');
    await okRow.trigger('click');
    expect(bodyAll('[data-testid="fmp-picked-row"]').map(el => el.getAttribute('data-field-id'))).toEqual(['f1']);
  });

  it('右栏列表：来源胶囊「组名.字段名」+ 列名去重预览；✕ 移除对应行', async () => {
    const wrapper = mountDialog();
    await need('[data-testid="fmp-field-row"][data-field-id="f1"]').trigger('click'); // 金额，existingNames 含金额 → 预览 金额(2)
    await need('[data-testid="fmp-field-row"][data-field-id="f4"]').trigger('click'); // 名称，无冲突

    const rows = bodyAll('[data-testid="fmp-picked-row"]');
    expect(rows.map(el => el.getAttribute('data-field-id'))).toEqual(['f1', 'f4']);
    expect(rows[0].querySelector('.fmp-source-chip')?.textContent?.replace(/\s+/g, '')).toBe('订单.金额');
    expect(rows[1].querySelector('.fmp-source-chip')?.textContent?.replace(/\s+/g, '')).toBe('客户.名称');

    const inputs = colNameInputs(wrapper);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].props('value')).toBe('金额(2)');
    expect(inputs[1].props('value')).toBe('名称');

    // 「将添加 N 列」预览文案同步。
    expect(need('.fmp-right-title').text()).toBe(`${zhCN['fieldMultiPick.willAddPrefix']}2${zhCN['fieldMultiPick.willAddUnit']}`);

    await need('[data-testid="fmp-remove-picked"]').trigger('click'); // 移除第一行（DOM 序即数组序）
    expect(bodyAll('[data-testid="fmp-picked-row"]').map(el => el.getAttribute('data-field-id'))).toEqual(['f4']);
  });

  it('confirm 载荷：列名默认按 dedupeColumnNames 去重（与 existingNames 冲突）', async () => {
    const wrapper = mountDialog({ existingNames: ['金额'] });
    await need('[data-testid="fmp-field-row"][data-field-id="f1"]').trigger('click');
    await need('[data-testid="fmp-field-row"][data-field-id="f4"]').trigger('click');

    await need('[data-kdlf="confirm"]').trigger('click');

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual([
      { groupKey: 'g1', fieldId: 'f1', fieldLabel: '金额', columnName: '金额(2)' },
      { groupKey: 'g2', fieldId: 'f4', fieldLabel: '名称', columnName: '名称' }
    ]);
    expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false]);
  });

  it('confirm 载荷：用户手改列名后仍与其他行重名，confirm 时再次去重兜底', async () => {
    const wrapper = mountDialog({ existingNames: [] });
    await need('[data-testid="fmp-field-row"][data-field-id="f1"]').trigger('click'); // 金额
    await need('[data-testid="fmp-field-row"][data-field-id="f4"]').trigger('click'); // 名称

    // 用户把第二行列名手改成和第一行一样。
    const inputs = colNameInputs(wrapper);
    await inputs[1].vm.$emit('update:value', '金额');

    await need('[data-kdlf="confirm"]').trigger('click');
    const payload = wrapper.emitted('confirm')?.[0]?.[0] as Array<{ columnName: string }>;
    expect(payload.map(p => p.columnName)).toEqual(['金额', '金额(2)']);
  });

  it('N=0 时确定按钮禁用，点击不 emit confirm', async () => {
    const wrapper = mountDialog();
    const confirmEl = body('[data-kdlf="confirm"]') as HTMLButtonElement;
    expect(confirmEl.disabled).toBe(true);
    await new DOMWrapper(confirmEl).trigger('click');
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('取消：emit update:show(false)，不 emit confirm', async () => {
    const wrapper = mountDialog();
    await need('[data-kdlf="cancel"]').trigger('click');
    expect(wrapper.emitted('update:show')?.at(-1)).toEqual([false]);
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});
