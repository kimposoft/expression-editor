/**
 * 外部数据表来源在取数节点适配器（expressionModelAdapter.ts）
 * 与作用域信封（types.ts hostScopeFromDocument）里的往返保真单测。
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

/** 一份最小取数节点文档：仅一个本报表来源（占位根），供各用例在其基础上追加外部数据表来源。 */
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

describe('外部数据表来源（kind=external）正向翻译：V4 文档 → 3.4 模型', () => {
  it('落成 source_type=external，template_id/data_table_id 恒空串，external_stable_id 落 external_object_id，app_id 原样透传', () => {
    const doc = makeDoc();
    doc.query.sources.push({
      kind: 'external',
      instance_id: 'ext-1',
      alias: '外部客户表',
      app_id: 'app_crm',
      external_stable_id: 'ext_stable_customer'
    });
    const model = v4DocToExpressionModel(doc, CTX);
    const externalTable = model.source.tables.find(t => t.alias === 'ext-1');
    expect(externalTable).toMatchObject({
      source_type: 'external',
      template_id: '',
      data_table_id: '',
      external_object_id: 'ext_stable_customer',
      app_id: 'app_crm',
      is_context: false
    });
  });
});

describe('外部数据表来源（kind=external）反向翻译：3.4 模型 → V4 文档（app_id 必填，不重算显示别名）', () => {
  it('新加外部表来源：instance_id/alias 沿用 3.4 别名（本次未接线 externalLabelOf，不比照 view 重算）', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      {
        alias: 't1',
        source_type: 'external',
        template_id: '',
        data_table_id: '',
        external_object_id: 'ext_stable_customer',
        app_id: 'app_crm',
        is_context: false
      }
    ];
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.query.sources.find(s => s.kind === 'external')).toMatchObject({
      kind: 'external',
      instance_id: 't1',
      alias: 't1',
      app_id: 'app_crm',
      external_stable_id: 'ext_stable_customer'
    });
  });

  it('跨应用外部表：新加时 app_id 取来源自带值；未带时按 ctx.appId 兜底（与目录/视图来源同一顺序，服务端该分支必填）', () => {
    const doc = makeDoc();
    const model = v4DocToExpressionModel(doc, CTX);
    model.source.tables = [
      ...model.source.tables,
      {
        alias: 't1',
        source_type: 'external',
        template_id: '',
        data_table_id: '',
        external_object_id: 'ext_stable_customer',
        app_id: 'app_crm',
        is_context: false
      }
    ];
    const back = expressionModelToV4Doc(model, doc, { ...CTX, appId: 'app_current' });
    expect(back.query.sources.find(s => s.kind === 'external')).toMatchObject({ app_id: 'app_crm' });

    // 未带 app_id（当前应用的外部表，picker 不下发）：回落 ctx.appId——服务端该分支 app_id 必填，
    // 不能省略（与 view 分支同一兜底顺序）。
    model.source.tables[model.source.tables.length - 1] = {
      alias: 't1',
      source_type: 'external',
      template_id: '',
      data_table_id: '',
      external_object_id: 'ext_stable_customer',
      is_context: false
    };
    const back2 = expressionModelToV4Doc(model, doc, { ...CTX, appId: 'app_current' });
    expect(back2.query.sources.find(s => s.kind === 'external')).toMatchObject({ app_id: 'app_current' });
  });

  it('已存在的外部表绑定：alias 原样沿用 hit（不重算），instance_id/app_id/external_stable_id 不丢', () => {
    const doc = makeDoc();
    doc.query.sources.push({
      kind: 'external',
      instance_id: 'ext-9',
      alias: '存量显示名',
      app_id: 'app_crm',
      external_stable_id: 'ext_stable_customer'
    });
    const back = expressionModelToV4Doc(v4DocToExpressionModel(doc, CTX), doc, CTX);
    expect(back.query.sources.find(s => s.kind === 'external')).toMatchObject({
      instance_id: 'ext-9',
      alias: '存量显示名',
      app_id: 'app_crm',
      external_stable_id: 'ext_stable_customer'
    });
  });

  it('往返两次稳定：doc → model → doc 后外部表来源逐字节等价（跨应用场景，app_id/external_stable_id 不丢）', () => {
    const doc = makeDoc();
    doc.query.sources.push({
      kind: 'external',
      instance_id: 'ext-9',
      alias: '外部客户表',
      app_id: 'app_crm',
      external_stable_id: 'ext_stable_customer'
    });
    const model = v4DocToExpressionModel(doc, CTX);
    const back = expressionModelToV4Doc(model, doc, CTX);
    expect(back.query.sources.find(s => s.kind === 'external')).toEqual(doc.query.sources.find(s => s.kind === 'external'));
  });
});

describe('hostScopeFromDocument：external_sources 仅在非空时携带该键', () => {
  it('文档没有外部数据表来源时，返回值不带 external_sources 键', () => {
    const doc = makeDoc();
    const scope = hostScopeFromDocument(doc);
    expect(scope.external_sources).toBeUndefined();
    expect('external_sources' in scope).toBe(false);
  });

  it('文档含外部数据表来源时，external_sources 按 instance_id/app_id/external_stable_id 三件套装配', () => {
    const doc = makeDoc();
    doc.query.sources.push({
      kind: 'external',
      instance_id: 'ext-9',
      alias: '外部客户表',
      app_id: 'app_crm',
      external_stable_id: 'ext_stable_customer'
    });
    const scope = hostScopeFromDocument(doc);
    expect(scope.external_sources).toEqual([{ instance_id: 'ext-9', app_id: 'app_crm', external_stable_id: 'ext_stable_customer' }]);
  });

  it('多条外部数据表来源按出现顺序全部收纳，与 view_sources 互不干扰（同一文档可同时含两种来源）', () => {
    const doc = makeDoc();
    doc.query.sources.push(
      { kind: 'external', instance_id: 'ext-1', alias: 'A', app_id: 'app_crm', external_stable_id: 'ext_a' },
      { kind: 'view', instance_id: 'view-1', alias: 'B', app_id: 'app_fin', view_id: 'vw_b' },
      { kind: 'external', instance_id: 'ext-2', alias: 'C', app_id: 'app_crm', external_stable_id: 'ext_c' }
    );
    const scope = hostScopeFromDocument(doc);
    expect(scope.external_sources).toEqual([
      { instance_id: 'ext-1', app_id: 'app_crm', external_stable_id: 'ext_a' },
      { instance_id: 'ext-2', app_id: 'app_crm', external_stable_id: 'ext_c' }
    ]);
    expect(scope.view_sources).toEqual([{ instance_id: 'view-1', app_id: 'app_fin', view_id: 'vw_b' }]);
  });
});
