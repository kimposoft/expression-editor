import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, type Component } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { NMessageProvider } from 'naive-ui';
import ExpressionEditor from './ExpressionEditor.vue';
import type { ExpressionModel } from './types';
import { provideExpressionHost, provideRefSyntax, type ExpressionHost } from './host';
import { v4DocToExpressionModel, expressionModelToV4Doc, type V4ModelAdapterContext } from './v4/expressionModelAdapter';
import type { V4ExtractNodeDocument } from './v4/nodeDocument';

/**
 *
 * 夹具即 evidence/round11-0907/A5/config-save-readback.json 里已保存成功的 n_w4r11_a5_selfjoin
 * 节点定义（裁剪掉与本复现无关的字段，如动作绑定/其余节点），保留 sources/joins/filter/targets
 * 的完整结构：两个 catalog 来源（W4 夹具单的主表 / W4FX-明细，同模板）+ 一条 left/系统列 ON。
 */

const TEMPLATE_ID = 'tpl_giylwdulzse5xwwd';
const APP_ID = 'app_w4fx';
const MAIN_TABLE_ID = 'tbl_6wits4232vchm6iy';
const DETAIL_TABLE_ID = 'tbl_3nj2qk7srzlon5g6';

function makeSelfJoinDoc(): V4ExtractNodeDocument {
  return {
    schema_version: 'kimpo.extract-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [
        {
          kind: 'catalog',
          instance_id: 'r11_self_main',
          alias: 'W4 夹具单的主表',
          app_id: APP_ID,
          template_id: TEMPLATE_ID,
          data_table_id: MAIN_TABLE_ID
        },
        {
          kind: 'catalog',
          instance_id: 'r11_self_detail',
          alias: 'W4FX-明细',
          app_id: APP_ID,
          template_id: TEMPLATE_ID,
          data_table_id: DETAIL_TABLE_ID
        }
      ],
      joins: [
        {
          join_id: 'w4r11_self_parent',
          sequence: 1,
          left_instance_id: 'r11_self_main',
          right_instance_id: 'r11_self_detail',
          join_type: 'left',
          on: {
            expression_id: 'w4r11_self_parent:on',
            purpose: 'join_on',
            source_text: '[parent_record_id]#{r1} = [record_id]#{r2}',
            refs: [
              {
                ref_id: 'r1',
                kind: 'source_field',
                source_instance_id: 'r11_self_detail',
                field_id: 'sys:parent_record_id',
                last_label: '[W4FX-明细].[parent_record_id]'
              },
              {
                ref_id: 'r2',
                kind: 'source_field',
                source_instance_id: 'r11_self_main',
                field_id: 'sys:record_id',
                last_label: '[W4 夹具单的主表].[record_id]'
              }
            ]
          }
        }
      ],
      filter: {
        expression_id: 'filter',
        purpose: 'filter',
        source_text: "[w4fx_no]#{r1} = 'W4FX-SRC-02'",
        refs: [
          {
            ref_id: 'r1',
            kind: 'source_field',
            source_instance_id: 'r11_self_main',
            field_id: 'fld_xptu4mjygbx32h74',
            last_label: '[W4 夹具单的主表].[w4fx_no]'
          }
        ]
      },
      options: { distinct: false, business_timezone: 'UTC' }
    },
    targets: [
      {
        target_id: 'tgt-tbl_3nj2qk7srzlon5g6',
        target_data_table_id: DETAIL_TABLE_ID,
        table_role: 'detail',
        outputs: [
          {
            target_field_id: 'fld_ijzn37pee4iusvvq',
            expression: {
              expression_id: 'out:tbl_3nj2qk7srzlon5g6:fld_ijzn37pee4iusvvq',
              purpose: 'output',
              source_text: '[w4fx_code]#{r1}',
              refs: [
                {
                  ref_id: 'r1',
                  kind: 'source_field',
                  source_instance_id: 'r11_self_detail',
                  field_id: 'fld_ijzn37pee4iusvvq',
                  last_label: '[W4FX-明细].[w4fx_code]'
                }
              ]
            },
            fill_strategy: 'overwrite'
          },
          {
            target_field_id: 'fld_mgp23whkychjp2ye',
            expression: {
              expression_id: 'out:tbl_3nj2qk7srzlon5g6:fld_mgp23whkychjp2ye',
              purpose: 'output',
              source_text: '[w4fx_amount]#{r1}',
              refs: [
                {
                  ref_id: 'r1',
                  kind: 'source_field',
                  source_instance_id: 'r11_self_detail',
                  field_id: 'fld_mgp23whkychjp2ye',
                  last_label: '[W4FX-明细].[w4fx_amount]'
                }
              ]
            },
            fill_strategy: 'overwrite'
          }
        ]
      }
    ]
  };
}

const FIELD_LABELS: Record<string, string> = {
  fld_xptu4mjygbx32h74: 'w4fx_no',
  fld_ijzn37pee4iusvvq: 'w4fx_code',
  fld_mgp23whkychjp2ye: 'w4fx_amount',
  'sys:record_id': 'record_id',
  'sys:parent_record_id': 'parent_record_id'
};
const TABLE_LABELS: Record<string, string> = {
  [MAIN_TABLE_ID]: 'W4 夹具单的主表',
  [DETAIL_TABLE_ID]: 'W4FX-明细'
};

function makeCtx(doc: V4ExtractNodeDocument): V4ModelAdapterContext {
  return {
    templateId: TEMPLATE_ID,
    appId: APP_ID,
    readableTextOf: (_id, tokenized) => tokenized,
    sourceOf: alias => doc.query.sources.find(s => s.instance_id === alias),
    fieldLabelOf: (_inst, fieldId) => FIELD_LABELS[fieldId] ?? fieldId,
    tableLabelOf: ({ data_table_id }) => TABLE_LABELS[data_table_id]
  };
}

function makeHost(): ExpressionHost {
  return {
    listTemplates: async () => [],
    listTables: async () => [],
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

// 自定义包内组件整体打桩（同 autoRowMatchV4Toggle.spec.ts 惯例）：本文件只关心 reconcile 落定后的
// model.source.joins 形状，不驱动这些子组件的交互，打桩避免它们各自的异步加载/host 调用节外生枝。
const SlotPassthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { slots }) {
    return () => h('div', [slots.trigger?.(), slots.default?.()]);
  }
});
const componentStubs: Record<string, Component> = {
  NSelect: SlotPassthrough,
  NButton: SlotPassthrough,
  NEmpty: SlotPassthrough,
  NSpin: SlotPassthrough,
  NTag: SlotPassthrough,
  NTooltip: SlotPassthrough,
  NPopover: SlotPassthrough,
  NRadioGroup: SlotPassthrough,
  NRadio: SlotPassthrough,
  NSwitch: SlotPassthrough,
  SourceTreePicker: SlotPassthrough,
  JoinDesignerDialog: SlotPassthrough,
  ConditionTree: SlotPassthrough,
  ConditionEditorDialog: SlotPassthrough,
  ExpressionInput: SlotPassthrough,
  ChartTargetSection: SlotPassthrough,
  StagingTargetSection: SlotPassthrough,
  FieldTreeDock: SlotPassthrough
};

async function flushMounted(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await nextTick();
}

async function mountEditor(initial: ExpressionModel): Promise<{ wrapper: VueWrapper; current: { value: ExpressionModel } }> {
  const current = ref<ExpressionModel>(initial);
  const Harness = defineComponent({
    setup() {
      provideExpressionHost(makeHost());
      provideRefSyntax('brackets');
      return () =>
        h(NMessageProvider, null, {
          default: () =>
            h(ExpressionEditor, {
              modelValue: current.value,
              templateId: TEMPLATE_ID,
              'onUpdate:modelValue': (value: ExpressionModel) => {
                current.value = value;
              }
            })
        });
    }
  });
  const wrapper = mount(Harness, { attachTo: document.body, global: { stubs: componentStubs } });
  await flushMounted();
  return { wrapper, current };
}

describe('动作设计器重开取数节点后目录自动关联被 reconcile 剔除', () => {
  it('挂载 ExpressionEditor（=重开节点）后，目录主+明细自动 record_id 关联仍存活、两侧均未判"未关联"', async () => {
    const doc = makeSelfJoinDoc();
    const ctx = makeCtx(doc);
    // 模拟「动作设计器重开该节点」：宿主用保存成功的 V4 文档重新翻译出 ExpressionModel 喂给编辑器。
    const initialModel = v4DocToExpressionModel(doc, ctx);

    const { wrapper, current } = await mountEditor(initialModel);
    try {
      // 断言①：join 保留——ExpressionEditor onMounted 里的 reconcile() 不得把这条自动关联剔除。
      const joins = current.value.source.joins;
      const join = joins.find(j => j.left_alias === 'r11_self_main' && j.right_alias === 'r11_self_detail');
      expect(join).toBeDefined();
      expect(join?.auto_record_id).toBe(true);

      const isIntroduced = (alias: string) => joins.some(j => j.left_alias === alias || j.right_alias === alias);
      expect(isIntroduced('r11_self_main')).toBe(true);
      expect(isIntroduced('r11_self_detail')).toBe(true);

      const backDoc = expressionModelToV4Doc(current.value, doc, ctx);
      const backJoin = backDoc.query.joins.find(
        j => j.left_instance_id === 'r11_self_main' && j.right_instance_id === 'r11_self_detail'
      );
      expect(backJoin).toBeDefined();
      expect(backJoin?.on.refs.map(r => r.field_id).sort()).toEqual(['sys:parent_record_id', 'sys:record_id']);
      const introducedInBackDoc = new Set(backDoc.query.joins.map(j => j.right_instance_id));
      expect(introducedInBackDoc.has('r11_self_detail')).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});
