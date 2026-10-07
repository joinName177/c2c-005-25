import { describe, expect, it } from 'vitest';
import { describeFeatureSource, validateCropRange } from '../models';

describe('validateCropRange', () => {
  it('rejects a negative start', () => expect(validateCropRange({ start: -1, end: 3 }, 5)).toContain('起点'));
  it('rejects reversed endpoints', () => expect(validateCropRange({ start: 4, end: 2 }, 5)).toContain('终点'));
  it('rejects clips longer than ten seconds', () => expect(validateCropRange({ start: 0, end: 11 }, 12)).toContain('10 秒'));
  it('accepts an exact ten-second clip', () => expect(validateCropRange({ start: 0, end: 10 }, 10)).toBeUndefined());
});

describe('describeFeatureSource', () => {
  it('never guesses an unknown source', () => {
    expect(describeFeatureSource(undefined)).toBe('来源未知');
  });
  it('records original and replacement provenance with method', () => {
    expect(describeFeatureSource({ kind: 'original', method: 'recording', at: '2026-10-07' })).toContain('原始录音');
    expect(describeFeatureSource({ kind: 'replacement', method: 'import', at: '2026-10-07', basedOnLabel: '温柔姐姐' })).toContain('声音替换 · 导入文件');
    expect(describeFeatureSource({ kind: 'replacement', method: 'import', at: '2026-10-07', basedOnLabel: '温柔姐姐' })).toContain('温柔姐姐');
  });
});
