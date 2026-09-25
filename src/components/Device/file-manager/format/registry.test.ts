import { describe, expect, it } from 'vitest';

import { describeEntry, isMedia, previewOfHead, resolvePreview, sniffFormat, viewOf } from './registry';

describe('registry', () => {
  it('插件在模块求值时完成注册', () => {
    const png = describeEntry({ name: 'a.png', path: '/a.png', isDirectory: false, isLink: false, size: 1, mtime: 0 });
    expect(png.kind).toBe('图片');
    expect(png.preview).toBe('image');
    expect(isMedia('image')).toBe(true);
  });

  it('未收录的扩展名按扩展名生成类型名', () => {
    const other = describeEntry({ name: 'a.zzz', path: '/a.zzz', isDirectory: false, isLink: false, size: 1, mtime: 0 });
    expect(other.kind).toBe('ZZZ 文件');
    expect(other.preview).toBeNull();
  });

  it('改了后缀的 SQLite 靠文件头认领', () => {
    const head = new TextEncoder().encode('SQLite format 3\0');
    expect(resolvePreview('weird.bin', head)).toBe('sqlite');
    expect(sniffFormat(head)).toBe('SQLite 数据库');
  });

  it('信息面板只在文件头对应的插件带预览时给出入口', () => {
    expect(previewOfHead(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image');
    // MZ 由信息面板自己认领，没有预览组件
    expect(previewOfHead(new TextEncoder().encode('MZ'))).toBeNull();
    expect(previewOfHead(new Uint8Array())).toBeNull();
  });

  it('没有内置预览时返回默认组件', () => {
    expect(viewOf(null)).toBeTruthy();
    expect(viewOf(null)).toBe(viewOf(null));
  });
});
