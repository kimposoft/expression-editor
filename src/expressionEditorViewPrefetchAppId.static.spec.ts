import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, './ExpressionEditor.vue'), 'utf-8');

describe('ExpressionEditor 视图来源字段预取透传 app_id', () => {
  it('onMounted 迁移段：ensureViewFields 与 ensureViewMeta 都按来源 app_id 取（跨应用视图字段面板不再「无字段」）', () => {
    expect(source).toContain("...viewSources.map(t => ctx.ensureViewFields(t.view_id as string, t.app_id || undefined))");
    expect(source).toContain("...viewSources.map(t => ctx.ensureViewMeta(t.view_id as string, t.app_id || undefined))");
    expect(source).not.toContain('ctx.ensureViewFields(t.view_id as string))');
  });
});
