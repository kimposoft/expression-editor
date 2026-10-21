import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import {
  escapeBracketIdent,
  hostScopeFromDocument,
  provideAliceV4DemoHost,
  useAliceV4DemoHost,
  type AliceV4DemoHost,
  type V4HostScopeReportCatalogTable
} from './types';
import { reportInstanceId } from './expressionModelAdapter';
import { emptyExtractNodeDocument } from './emptyNodeDocument';
import type { V4ExtractNodeDocument } from './nodeDocument';

/**
 * - useAliceV4DemoHost() 在未 provide 时抛错（不静默白屏）；
 * - provideAliceV4DemoHost() 后子组件能正确取到同一个 host 实例；
 * - escapeBracketIdent 的方括号转义规则。
 */

function makeHost(): AliceV4DemoHost {
  return {
    loadCatalog: async () => ({
      renamed: false,
      sources: [],
      report: { tables: [] },
      staging: { columns: [] },
      functions: [],
      keywords: []
    }),
    diagnose: async () => ({ ok: true, tokens: [], ast: null, refs: [], envelope: null, digest: '', diagnostics: [] })
  };
}

describe('useAliceV4DemoHost', () => {
  it('未 provide 时抛错，且错误信息指向 provideAliceV4DemoHost', () => {
    const Consumer = defineComponent({
      setup() {
        useAliceV4DemoHost();
        return () => h('div');
      }
    });
    expect(() => mount(Consumer)).toThrow(/ALICE_V4_DEMO_HOST/);
  });

  it('provide 之后，子组件取到的是同一个 host 实例', () => {
    const host = makeHost();
    let received: AliceV4DemoHost | null = null;
    const Consumer = defineComponent({
      setup() {
        received = useAliceV4DemoHost();
        return () => h('div');
      }
    });
    const Harness = defineComponent({
      setup() {
        provideAliceV4DemoHost(host);
        return () => h(Consumer);
      }
    });
    mount(Harness);
    expect(received).toBe(host);
  });
});

describe('escapeBracketIdent', () => {
  it('不含 ] 的名称原样返回', () => {
    expect(escapeBracketIdent('金额')).toBe('金额');
    expect(escapeBracketIdent('t1')).toBe('t1');
  });

  it('] 转义为 ]]（可能不止一个）', () => {
    expect(escapeBracketIdent('异常]字段')).toBe('异常]]字段');
    expect(escapeBracketIdent(']]')).toBe(']]]]');
  });
});

describe('hostScopeFromDocument', () => {
  it('空文档：sources/report_sources 均为空数组', () => {
    expect(hostScopeFromDocument(emptyExtractNodeDocument())).toEqual({ sources: [], report_sources: [] });
  });

  it('按 kind 分拣：catalog 进 sources、report 进 report_sources、staging 两段都不进；别名原样透传', () => {
    const doc: V4ExtractNodeDocument = {
      ...emptyExtractNodeDocument(),
      query: {
        ...emptyExtractNodeDocument().query,
        sources: [
          {
            kind: 'catalog',
            instance_id: 'inst-1',
            alias: '客户表A',
            app_id: 'app-1',
            template_id: 'tpl-1',
            data_table_id: 'dt-1'
          },
          { kind: 'report', instance_id: 'inst-2', alias: '本单主表', table_id: 'tbl-main', table_role: 'main' },
          { kind: 'staging', instance_id: 'inst-3', alias: '暂存', producer_node_id: 'node-x', output_schema_revision: 'v1' }
        ]
      }
    };
    expect(hostScopeFromDocument(doc)).toEqual({
      sources: [{ instance_id: 'inst-1', alias: '客户表A', app_id: 'app-1', template_id: 'tpl-1', data_table_id: 'dt-1' }],
      report_sources: [{ instance_id: 'inst-2', table_id: 'tbl-main', table_role: 'main', alias: '本单主表' }]
    });
  });

  it('多来源：别名各自透传，不互相覆盖', () => {
    const doc: V4ExtractNodeDocument = {
      ...emptyExtractNodeDocument(),
      query: {
        ...emptyExtractNodeDocument().query,
        sources: [
          { kind: 'report', instance_id: 'inst-a', alias: '主表', table_id: 'tbl-1', table_role: 'main' },
          { kind: 'report', instance_id: 'inst-b', alias: '明细（副本 2）', table_id: 'tbl-1', table_role: 'detail' }
        ]
      }
    };
    expect(hostScopeFromDocument(doc)).toEqual({
      sources: [],
      report_sources: [
        { instance_id: 'inst-a', table_id: 'tbl-1', table_role: 'main', alias: '主表' },
        { instance_id: 'inst-b', table_id: 'tbl-1', table_role: 'detail', alias: '明细（副本 2）' }
      ]
    });
  });

  describe('reportCatalogTables 目录兜底', () => {
    it('目录里的表若未被 query.sources 登记，一并补进 report_sources', () => {
      const doc = emptyExtractNodeDocument();
      const catalogTables: V4HostScopeReportCatalogTable[] = [
        { table_id: 'tbl-detail', label: '采购明细', role: 'detail' }
      ];
      expect(hostScopeFromDocument(doc, catalogTables)).toEqual({
        sources: [],
        report_sources: [
          {
            // 与 reportSourceBinding/reconcile() 落库时算出的 instance_id 必须逐字节相同，
            // 否则诊断期临时候选与确认后真正落库的记录会是两个不同身份。
            instance_id: reportInstanceId({ alias: '', data_table_id: 'tbl-detail' }),
            table_id: 'tbl-detail',
            table_role: 'detail',
            alias: '采购明细'
          }
        ]
      });
    });

    it('已被 query.sources 显式登记的表不重复添加、不被目录覆盖', () => {
      const doc: V4ExtractNodeDocument = {
        ...emptyExtractNodeDocument(),
        query: {
          ...emptyExtractNodeDocument().query,
          sources: [{ kind: 'report', instance_id: 'rpt-tbl-detail-abc123', alias: '采购明细（自定义别名）', table_id: 'tbl-detail', table_role: 'detail' }]
        }
      };
      const catalogTables: V4HostScopeReportCatalogTable[] = [{ table_id: 'tbl-detail', label: '采购明细', role: 'detail' }];
      expect(hostScopeFromDocument(doc, catalogTables)).toEqual({
        sources: [],
        report_sources: [{ instance_id: 'rpt-tbl-detail-abc123', table_id: 'tbl-detail', table_role: 'detail', alias: '采购明细（自定义别名）' }]
      });
    });

    it('不传 reportCatalogTables 时行为与改造前逐字节一致（既有调用方不受影响）', () => {
      const doc = emptyExtractNodeDocument();
      expect(hostScopeFromDocument(doc)).toEqual({ sources: [], report_sources: [] });
    });
  });

  describe('staging_source 装配', () => {
    const docWithStaging: V4ExtractNodeDocument = {
      ...emptyExtractNodeDocument(),
      query: {
        ...emptyExtractNodeDocument().query,
        sources: [
          {
            kind: 'staging',
            instance_id: 'stg-node-p1-a1b2c3',
            alias: '上一步暂存区（提取数据）',
            producer_node_id: 'node-p1',
            output_schema_revision: 'v1'
          }
        ]
      }
    };

    it('文档含暂存绑定 + 传入非空列清单：装配 staging_source（column_id=code、label=name、data_type 回落 text）', () => {
      const scope = hostScopeFromDocument(docWithStaging, [], {
        producerNodeId: 'node-p1',
        producerLabel: '上一步暂存区（提取数据）',
        columns: [
          { code: 'col-material', name: '物料名称', type: 'text' },
          { code: 'col-qty', name: '数量' } // 无 type：回落 text
        ]
      });
      expect(scope.staging_source).toEqual({
        instance_id: 'stg-node-p1-a1b2c3',
        producer_node_id: 'node-p1',
        alias: '上一步暂存区（提取数据）',
        columns: [
          { column_id: 'col-material', label: '物料名称', data_type: 'text', nullable: true },
          { column_id: 'col-qty', label: '数量', data_type: 'text', nullable: true }
        ]
      });
    });

    it('文档没有暂存绑定：即便传了列清单也不装配 staging_source', () => {
      const doc = emptyExtractNodeDocument();
      const scope = hostScopeFromDocument(doc, [], {
        producerNodeId: 'node-p1',
        producerLabel: '上一步暂存区',
        columns: [{ code: 'c', name: '列' }]
      });
      expect(scope.staging_source).toBeUndefined();
    });

    it('文档有暂存绑定但未传 stagingSource 参数：不装配 staging_source', () => {
      const scope = hostScopeFromDocument(docWithStaging);
      expect(scope.staging_source).toBeUndefined();
    });

    it('文档有暂存绑定、传了 stagingSource 但列清单为空：不装配 staging_source', () => {
      const scope = hostScopeFromDocument(docWithStaging, [], {
        producerNodeId: 'node-p1',
        producerLabel: '上一步暂存区（提取数据）',
        columns: []
      });
      expect(scope.staging_source).toBeUndefined();
    });
  });
});
