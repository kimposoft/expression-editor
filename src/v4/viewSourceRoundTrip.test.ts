/**
 * 视图来源在取数节点适配器（expressionModelAdapter.ts）与
 * 作用域信封（types.ts hostScopeFromDocument）里的往返保真单测。
 */
import { describe, expect, it } from 'vitest';
import {
  v4DocToExpressionModel,
  expressionModelToV4Doc,
  type V4ModelAdapterContext
} from './expressionModelAdapter';
import { hostScopeFromDocument } from './types';
import type { V4ExtractNodeDocument } from './nodeDocument';

const CTX: V4ModelAdapterContext = {
  templateId: 'tpl-1',
  readableTextOf: (_id, tokenized) => tokenized
};

/** 一份最小取数节点文档：仅一个本报表来源（占位根），供各用例在其基础上追加视图来源。 */
function makeDoc(): V4ExtractNodeDocument {
  return {
    schema_version: 'kimpo.extract-node/v4',
    syntax_profile: 'kimposql.mssql/v1',
    query: {
      sources: [{ kind: 'report', instance_id: 'rpt-main-a1', alias: '本表', table_id: 'tbl-main', table_role: 'main' }],
      joins: [],
      options: { distinct: true }
    },
    targets: []
  };
}

describe('视图来源（kind=view）正向翻译：V4 文档 → 3.4 模型', () => {
  it('落成 source_type=view，template_id/data_table_id 恒空串，view_id/app_id 原样透传', () => {
    const doc = makeDoc();
    doc.query.sources.push({
      kind: 'view',
      instance_id: 'view-1',
      alias: '应收汇总',
      app_id: 'app_fin',
      view_id: 'vw_ar_summary'
    });
    const model = v4DocToExpressionModel(doc, CTX);
    const viewTable = model.source.tables.find(t => t.alias === 'view-1');
    expect(viewTable).toMatchObject({
      source_type: 'view',
      template_id: '',
      data_table_id: '',
      view_id: 'vw_ar_summary',
      app_id: 'app_fin',
      is_context: false
    });
  });

  it('当前应用的视图（app_id 与 ctx.appId 相同也好、未提供也好）：app_id 为空串时 3.4 侧不写该字段', () => {
    const doc = makeDoc();
    doc.query.sources.push({ kind: 'view', instance_id: 'view-1', alias: '本应用视图', app_id: '', view_id: 'vw_x' });
    const model = v4DocToExpressionModel(doc, CTX);
    const viewTable = model.source.tables.find(t => t.alias === 'view-1');
    expect(viewTable?.app_id).toBeUndefined();
  });
});

describe('视图来源（kind=view）反向翻译：3.4 模型 → V4 文档（显示别名重算，同 catalogSourceAlias 一条规则）', () => {
  const withViewLabels: V4ModelAdapterContext = {
    ...CTX,
    viewLabelOf: viewId => ({ vw_ar_summary: '应收汇总', vw_ap_summary: '应付汇总' })[viewId]
  };

  it('新加视图来源：alias 按视图名落定（不用 instance_id 占位），instance_id 沿用 3.4 别名', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      { alias: 't1', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_ar_summary', is_context: false }
    ];
    const back = expressionModelToV4Doc(model, doc, withViewLabels);
    expect(back.query.sources.find(s => s.kind === 'view')).toMatchObject({
      kind: 'view',
      instance_id: 't1',
      alias: '应收汇总'
    });
  });

  it('跨应用视图：新加时 app_id 取来源自带值；未带时按 ctx.appId 兜底（与目录来源同一顺序）', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      {
        alias: 't1',
        source_type: 'view',
        template_id: '',
        data_table_id: '',
        view_id: 'vw_ar_summary',
        app_id: 'app_fin',
        is_context: false
      }
    ];
    const back = expressionModelToV4Doc(model, doc, { ...withViewLabels, appId: 'app_current' });
    expect(back.query.sources.find(s => s.kind === 'view')).toMatchObject({ app_id: 'app_fin' });

    // 未带 app_id（当前应用的视图，picker 不下发）：回落 ctx.appId。
    model.source.tables[model.source.tables.length - 1] = {
      alias: 't1',
      source_type: 'view',
      template_id: '',
      data_table_id: '',
      view_id: 'vw_ar_summary',
      is_context: false
    };
    const back2 = expressionModelToV4Doc(model, doc, { ...withViewLabels, appId: 'app_current' });
    expect(back2.query.sources.find(s => s.kind === 'view')).toMatchObject({ app_id: 'app_current' });
  });

  it('已存在的视图绑定：alias 每次都按当前目录重算（视图改名后自愈），instance_id 不动', () => {
    const doc = makeDoc();
    doc.query.sources.push({ kind: 'view', instance_id: 'view-9', alias: '旧名占位', app_id: 'app_fin', view_id: 'vw_ar_summary' });
    const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, withViewLabels);
    expect(back.query.sources.find(s => s.kind === 'view')).toMatchObject({ instance_id: 'view-9', alias: '应收汇总' });
  });

  it('同一视图两个实例：按加入顺序追加 (1)(2)——与数据表来源 instanceSuffix 同一条规则', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      { alias: 't1', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_ar_summary', is_context: false },
      { alias: 't2', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_ar_summary', is_context: false }
    ];
    const back = expressionModelToV4Doc(model, doc, withViewLabels);
    expect(back.query.sources.find(s => s.kind === 'view' && s.instance_id === 't1')?.alias).toBe('应收汇总(1)');
    expect(back.query.sources.find(s => s.kind === 'view' && s.instance_id === 't2')?.alias).toBe('应收汇总(2)');
  });

  it('查不到视图名（目录未加载/未提供钩子）：保持原别名，不擅自改', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      { alias: 't9', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_unknown', is_context: false }
    ];
    const back = expressionModelToV4Doc(model, doc, withViewLabels);
    expect(back.query.sources.find(s => s.kind === 'view')?.alias).toBe('t9');
  });

  it('往返两次稳定：doc → model → doc 后视图来源逐字节等价（跨应用场景）', () => {
    const doc = makeDoc();
    doc.query.sources.push({ kind: 'view', instance_id: 'view-9', alias: '应收汇总', app_id: 'app_fin', view_id: 'vw_ar_summary' });
    const model = v4DocToExpressionModel(doc, withViewLabels);
    const back = expressionModelToV4Doc(model, doc, withViewLabels);
    expect(back.query.sources.find(s => s.kind === 'view')).toEqual(doc.query.sources.find(s => s.kind === 'view'));
  });
});

describe('视图来源不生成目录主+明细自动 record_id 关联', () => {
  it('两个视图来源之间即便声明 auto_record_id:true，也不会被当成目录主+明细合成系统列等式', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      { alias: 't1', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_a', is_context: false },
      { alias: 't2', source_type: 'view', template_id: '', data_table_id: '', view_id: 'vw_b', is_context: false }
    ];
    model.source.joins = [{ left_alias: 't1', right_alias: 't2', join_type: 'inner', auto_record_id: true }];
    const back = expressionModelToV4Doc(model, doc, CTX);
    const join = back.query.joins.find(j => j.left_instance_id === 't1' && j.right_instance_id === 't2');
    expect(join).toBeDefined();
    // 不应含 sys:record_id/sys:parent_record_id 系统列引用（那是目录 catalog 专属的合成形态）。
    const refFieldIds = (join!.on.refs ?? []).map(r => r.field_id);
    expect(refFieldIds).not.toContain('sys:record_id');
    expect(refFieldIds).not.toContain('sys:parent_record_id');
  });
});

describe('hostScopeFromDocument：view_sources 仅在非空时携带该键', () => {
  it('文档没有视图来源时，返回值不带 view_sources 键', () => {
    const doc = makeDoc();
    const scope = hostScopeFromDocument(doc);
    expect(scope.view_sources).toBeUndefined();
    expect('view_sources' in scope).toBe(false);
  });

  it('文档含视图来源时，view_sources 按 instance_id/app_id/view_id 三件套装配', () => {
    const doc = makeDoc();
    doc.query.sources.push({ kind: 'view', instance_id: 'view-9', alias: '应收汇总', app_id: 'app_fin', view_id: 'vw_ar_summary' });
    const scope = hostScopeFromDocument(doc);
    expect(scope.view_sources).toEqual([{ instance_id: 'view-9', app_id: 'app_fin', view_id: 'vw_ar_summary' }]);
  });

  it('多条视图来源按出现顺序全部收纳', () => {
    const doc = makeDoc();
    doc.query.sources.push(
      { kind: 'view', instance_id: 'view-1', alias: 'A', app_id: 'app_fin', view_id: 'vw_a' },
      { kind: 'view', instance_id: 'view-2', alias: 'B', app_id: 'app_fin', view_id: 'vw_b' }
    );
    const scope = hostScopeFromDocument(doc);
    expect(scope.view_sources).toEqual([
      { instance_id: 'view-1', app_id: 'app_fin', view_id: 'vw_a' },
      { instance_id: 'view-2', app_id: 'app_fin', view_id: 'vw_b' }
    ]);
  });
});
