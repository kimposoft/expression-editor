/**
 * 目录来源角色回填 → 同模板主表 + 扩展表自动 record_id 关联（视图设计器场景为主，取数/写动作同受益）。
 *
 * 缺陷背景：V4 的 catalog SourceBinding 不落 table_role，打开一份已保存的文档时显式数据表来源的
 * role 只能从"文档里已有的自动关联 ON"反推（applyCatalogRoleFromJoins）。于是「先只选主表保存 →
 * 重开后再加扩展表」这条顺序里旧来源 role 恒缺失，reconcile ② 的 byTemplate 分组找不到 main，
 * 自动关联永远补不出来——视图设计器里表现为「选了同一模板的主表和扩展表却没有按 record_id /
 * parent_record_id 关联」。修法：reconcile ② 之前按 ctx.tablesCache（onMounted 已预取）现查角色补齐。
 *
 * 本文件挂载真实 ExpressionEditor（视图设计器的挂载形态：template-id="" + hideImplicitMain），
 * 判据落在 reconcile 落定后的 model.source.joins 上。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import type { ExpressionModel, SourceTable, TemplateDataTable } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';

const TPL = 'tpl_view_demo';
const MAIN_TABLE = 'tbl_main';
const DETAIL_TABLE = 'tbl_detail';

/** 后端表清单：主表 + 扩展表（table_role 是角色权威，见 types.ts tableRoleOf）。 */
function tablesOfTemplate(): TemplateDataTable[] {
  return [
    {
      data_table_id: MAIN_TABLE, table_code: 'main', table_name: '主表', physical_table_name: 'p_main',
      table_role: 'main', sort_no: 0, field_count: 3, version_no: 1
    },
    {
      data_table_id: DETAIL_TABLE, table_code: 'detail', table_name: '明细', physical_table_name: 'p_detail',
      table_role: 'extension', extension_mode: 'detail', sort_no: 0, field_count: 2, version_no: 1
    }
  ];
}

/** 「打开已保存视图」后的初始模型：两张同模板目录来源、**role 缺失**（V4 文档不落 table_role）、无关联。 */
function openedModel(joins: ExpressionModel['source']['joins'] = []): ExpressionModel {
  const table = (alias: string, dataTableId: string): SourceTable => ({
    alias, source_type: 'template', template_id: TPL, data_table_id: dataTableId, is_context: false
  });
  return {
    schema_version: 2,
    source: { tables: [table('cat-main', MAIN_TABLE), table('cat-det', DETAIL_TABLE)], joins },
    target: { target_template_id: '', target_data_table_id: '', outputs: [] }
  };
}

const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_p, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough, NButton: SlotPassthrough, NEmpty: SlotPassthrough, NSpin: SlotPassthrough,
  NTag: SlotPassthrough, NTooltip: SlotPassthrough, NPopover: SlotPassthrough, NRadioGroup: SlotPassthrough,
  NRadio: SlotPassthrough, NSwitch: SlotPassthrough, SourceTreePicker: SlotPassthrough,
  JoinDesignerDialog: SlotPassthrough, ConditionTree: SlotPassthrough, ConditionEditorDialog: SlotPassthrough,
  ExpressionInput: SlotPassthrough, ChartTargetSection: SlotPassthrough, StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

function makeHost(tables: TemplateDataTable[]): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async (templateId: string) => (templateId === TPL ? tables : []),
    listFields: async () => [],
    compilePreview: async () => ({ valid: true, arg_count: 0 }),
    loadCatalog: async () => ({ system_variables: [], functions: [], window_functions: [] }),
    lowerText: async req => ({
      purpose: req.purpose,
      text_source: { text: req.text, pack_revision: 'test', digest: 'd' },
      diagnostics: []
    })
  };
}

/** 视图设计器的挂载形态：template-id=""（视图没有本报表）+ hideImplicitMain。 */
async function mountViewEditor(initial: ExpressionModel, tables: TemplateDataTable[]) {
  const current = ref<ExpressionModel>(initial);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost(tables));
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: '',
              hideImplicitMain: true,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
  return { wrapper, current };
}

describe('视图设计器：同模板主表 + 扩展表按 record_id/parent_record_id 自动关联', () => {
  it('打开已保存文档（role 缺失、无关联）后，按表清单回填角色并补出 main→detail 的自动关联', async () => {
    const { wrapper, current } = await mountViewEditor(openedModel(), tablesOfTemplate());
    try {
      expect(current.value.source.tables.map(t => t.role)).toEqual(['main', 'detail']);
      expect(current.value.source.joins).toEqual([
        { left_alias: 'cat-main', right_alias: 'cat-det', join_type: 'left', auto_record_id: true, on: [] }
      ]);
    } finally {
      wrapper.unmount();
    }
  });

  it('明细已被别的关联引入（right_alias 命中）时不再补——V4 的 Join 图要求非根来源恰好被一条关联引入', async () => {
    const manual = [
      {
        left_alias: 'cat-main',
        right_alias: 'cat-det',
        join_type: 'left' as const,
        auto_record_id: false,
        on: [{ left: { alias: 'cat-main', field_id: 'fld_a' }, op: 'eq' as const, right: { alias: 'cat-det', field_id: 'fld_b' } }]
      }
    ];
    const { wrapper, current } = await mountViewEditor(openedModel(manual), tablesOfTemplate());
    try {
      expect(current.value.source.joins).toHaveLength(1);
      expect(current.value.source.joins[0].auto_record_id).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('表清单拿不到（宿主未下发/表已删）时角色保持缺失、不乱补关联——误判方向比补不出更危险', async () => {
    const { wrapper, current } = await mountViewEditor(openedModel(), []);
    try {
      expect(current.value.source.tables.every(t => t.role === undefined)).toBe(true);
      expect(current.value.source.joins).toEqual([]);
    } finally {
      wrapper.unmount();
    }
  });
});
