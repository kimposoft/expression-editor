import { describe, expect, it } from 'vitest';
import { isAttachmentFieldDataType, isSourceTreeHiddenFieldDataType } from './types';

describe('isSourceTreeHiddenFieldDataType', () => {
  it('attachment/image（含大小写与前后空白变体）不再隐藏', () => {
    expect(isSourceTreeHiddenFieldDataType('attachment')).toBe(false);
    expect(isSourceTreeHiddenFieldDataType('ATTACHMENT')).toBe(false);
    expect(isSourceTreeHiddenFieldDataType('  attachment  ')).toBe(false);
    expect(isSourceTreeHiddenFieldDataType('image')).toBe(false);
  });

  it('其余档位（含缺省/空值）不隐藏', () => {
    expect(isSourceTreeHiddenFieldDataType('text')).toBe(false);
    expect(isSourceTreeHiddenFieldDataType('number')).toBe(false);
    expect(isSourceTreeHiddenFieldDataType(undefined)).toBe(false);
    expect(isSourceTreeHiddenFieldDataType(null)).toBe(false);
    expect(isSourceTreeHiddenFieldDataType('')).toBe(false);
  });
});

/** isAttachmentFieldDataType：图片 / 附件档判定，大小写 / 前后空白不敏感。 */
describe('isAttachmentFieldDataType', () => {
  it('attachment/image 判为附件档', () => {
    expect(isAttachmentFieldDataType('attachment')).toBe(true);
    expect(isAttachmentFieldDataType(' ATTACHMENT ')).toBe(true);
    expect(isAttachmentFieldDataType('Image')).toBe(true);
  });
  it('其余档位不是附件档', () => {
    expect(isAttachmentFieldDataType('text')).toBe(false);
    expect(isAttachmentFieldDataType('json')).toBe(false);
    expect(isAttachmentFieldDataType(undefined)).toBe(false);
    expect(isAttachmentFieldDataType('')).toBe(false);
  });
});
