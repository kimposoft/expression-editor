/**
 * 暂存区列控件对齐普通字段行：
 *   A. 行尾不再有「删除」按钮；值格带 ƒ 与 ✕，✕ 挂「删除此列」提示；
 *   B. 值格 ✕（ExpressionInput 回抛 null）＝删除整列；
 *   C. ⊞ 快捷选择插入字段：显示名为空则用字段名补显示名，已有显示名不覆盖；非字段引用不自动命名；
 *   D. 新列表达式为「不填充」占位 {kind:'const'}，行不带 filled；配置后带 filled。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { NInput } from 'naive-ui';
import StagingTargetSection from './StagingTargetSection.vue';
import ExpressionInput from './ExpressionInput.vue';
import zhCN from './locales/zh-CN';
import type { TargetSpec, TemplateField } from './types';

const F_QTY = { field_id: 'fld_qty', field_name: '数量', data_type: 'number' } as TemplateField;
const F_NAME = { field_id: 'fld_name', field_name: '物料名称', data_type: 'text' } as TemplateField;
const SOURCE_TABLES = [{ alias: 't1', dataTableId: 'tbl_src', name: '采购入库的扩展表', fields: [F_QTY] }];
const FORM_TABLES = [
  { alias: 'bt1', table: { data_table_id: 'tbl_rpt', table_name: '本报表明细' } as any, fields: [F_NAME] }
];

function spec(outputs: TargetSpec['outputs']): TargetSpec {
  return { target_kind: 'staging', target_template_id: '', target_data_table_id: '', outputs } as TargetSpec;
}

function mountSection(model: TargetSpec) {
  return mount(StagingTargetSection, { props: { modelValue: model, sourceTables: SOURCE_TABLES, formTables: FORM_TABLES } });
}

function lastEmitted(wrapper: ReturnType<typeof mountSection>): TargetSpec {
  const calls = wrapper.emitted('update:modelValue')!;
  return calls[calls.length - 1][0] as TargetSpec;
}

describe('StagingTargetSection 列行对齐普通字段行', () => {
  it('A：无「删除」按钮；值格带 ƒ 与 ✕，✕ 挂「删除此列」提示', () => {
    const wrapper = mountSection(spec([{ target_field_id: '', expression: { kind: 'const' } }]));
    const row = wrapper.find('[data-testid="staging-col-row-0"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).not.toContain(zhCN['common.delete']);
    expect(row.find('[data-testid="expr-fx-entry"]').exists()).toBe(true);
    const clear = row.find('[data-testid="expr-clear"]');
    expect(clear.exists()).toBe(true);
    expect(clear.attributes('title')).toBe(zhCN['editor.stagingRemoveColumn']);
    wrapper.unmount();
  });

  it('B：值格 ✕ 回抛 null → 删除该列，其余列保留', async () => {
    const wrapper = mountSection(
      spec([
        { target_field_id: 'a', expression: { kind: 'const', value: 1 } },
        { target_field_id: 'b', expression: { kind: 'const', value: 2 } }
      ])
    );
    const inputs = wrapper.findAllComponents(ExpressionInput);
    expect(inputs).toHaveLength(2);
    inputs[0].vm.$emit('update:modelValue', null);
    const next = lastEmitted(wrapper);
    expect(next.outputs.map(o => o.target_field_id)).toEqual(['b']);
    wrapper.unmount();
  });

  it('C：⊞ 插入字段时显示名为空 → 用字段名补显示名；已有显示名不覆盖；本报表字段按 field_id 找名；常量不命名；column_id 全程不变', async () => {
    const wrapper = mountSection(
      spec([
        { target_field_id: 'col_c1', target_field_label: '', expression: { kind: 'const' } },
        { target_field_id: 'col_c2', target_field_label: '合计', expression: { kind: 'const' } },
        { target_field_id: 'col_c3', target_field_label: '', expression: { kind: 'const' } },
        { target_field_id: 'col_c4', target_field_label: '', expression: { kind: 'const' } }
      ])
    );
    const inputs = wrapper.findAllComponents(ExpressionInput);
    inputs[0].vm.$emit('update:modelValue', { kind: 'source_field', alias: 't1', field_id: 'fld_qty' });
    expect(lastEmitted(wrapper).outputs[0].target_field_label).toBe('数量');
    expect(lastEmitted(wrapper).outputs[0].target_field_id).toBe('col_c1'); // column_id 不受自动补名影响
    inputs[1].vm.$emit('update:modelValue', { kind: 'source_field', alias: 't1', field_id: 'fld_qty' });
    expect(lastEmitted(wrapper).outputs[1].target_field_label).toBe('合计');
    inputs[2].vm.$emit('update:modelValue', { kind: 'form_field', field_id: 'fld_name', table_id: 'tbl_rpt' });
    expect(lastEmitted(wrapper).outputs[2].target_field_label).toBe('物料名称');
    inputs[3].vm.$emit('update:modelValue', { kind: 'const', value: 7 });
    expect(lastEmitted(wrapper).outputs[3].target_field_label).toBe('');
    // 表达式本身也落进对应列。
    expect(lastEmitted(wrapper).outputs[3].expression).toEqual({ kind: 'const', value: 7 });
    wrapper.unmount();
  });

  it('D：「添加列」产出「不填充」占位 {kind:const}；占位行不带 filled，已配置行带 filled', async () => {
    const wrapper = mountSection(spec([{ target_field_id: 'col_x', target_field_label: '已有列', expression: { kind: 'const', value: 1 } }]));
    expect(wrapper.find('[data-testid="staging-col-row-0"]').classes()).toContain('filled');
    await wrapper.find('[data-testid="staging-add-column"]').trigger('click');
    const next = lastEmitted(wrapper);
    expect(next.outputs).toHaveLength(2);
    expect(next.outputs[1].expression).toEqual({ kind: 'const' });
    await wrapper.setProps({ modelValue: next });
    expect(wrapper.find('[data-testid="staging-col-row-1"]').classes()).not.toContain('filled');
    // V4 往返回来的空文本形态同样视为未配置（同 ExpressionEditor 普通字段行判据）。
    await wrapper.setProps({
      modelValue: spec([{ target_field_id: 'col_x', target_field_label: '已有列', expression: { kind: 'raw', text: '', text_source: { text: '' } as any } }])
    });
    expect(wrapper.find('[data-testid="staging-col-row-0"]').classes()).not.toContain('filled');
    wrapper.unmount();
  });

  it('E：「添加列」产出的 target_field_id 是编辑器生成的稳定键 col_<8hex>，target_field_label 为空', async () => {
    const wrapper = mountSection(spec([]));
    await wrapper.find('[data-testid="staging-add-column"]').trigger('click');
    const next = lastEmitted(wrapper);
    expect(next.outputs).toHaveLength(1);
    expect(next.outputs[0].target_field_id).toMatch(/^col_[0-9a-f]{8}$/);
    expect(next.outputs[0].target_field_label).toBe('');
    wrapper.unmount();
  });

  it('F：列名输入框写 target_field_label，不动 target_field_id（column_id 稳定）', () => {
    const wrapper = mountSection(spec([{ target_field_id: 'col_stable', target_field_label: '', expression: { kind: 'const' } }]));
    const nameInput = wrapper.findComponent(NInput);
    nameInput.vm.$emit('update:value', '新列名');
    const next = lastEmitted(wrapper);
    expect(next.outputs[0].target_field_label).toBe('新列名');
    expect(next.outputs[0].target_field_id).toBe('col_stable'); // 未变
    wrapper.unmount();
  });

  it('G：重复判据按 target_field_label——两列显示名相同即判重，target_field_id 不同不影响', () => {
    const wrapper = mountSection(
      spec([
        { target_field_id: 'col_g1', target_field_label: '重名', expression: { kind: 'const', value: 1 } },
        { target_field_id: 'col_g2', target_field_label: '重名', expression: { kind: 'const', value: 2 } }
      ])
    );
    expect(wrapper.find('[data-testid="staging-col-row-0"]').classes()).toContain('dupe');
    expect(wrapper.find('[data-testid="staging-col-row-1"]').classes()).toContain('dupe');
    wrapper.unmount();
  });
});
