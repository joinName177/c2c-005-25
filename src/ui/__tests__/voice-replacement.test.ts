import { describe, expect, it } from 'vitest';
import { useStudio, type StudioDependencies } from '../useStudio';
import { coverPresetFor } from '../../core/cover-presets';
import type { VoiceMeme } from '../../core/models';

const oldFeatures = { loudness:.2,dynamics:.2,pitch:.45,zeroCrossing:.2,pauseRatio:.35,tempoVariation:.18 };
const newFeatures = { loudness:.95,dynamics:.85,pitch:.55,zeroCrossing:.7,pauseRatio:.08,tempoVariation:.8 };
function existing(saved: VoiceMeme[] = [], overrides: Partial<StudioDependencies> = {}): { studio: ReturnType<typeof useStudio>; saved: VoiceMeme[] } {
  const meme: VoiceMeme = { id:'old', title:'旧作品名', emotion:'温柔姐姐', confidence:.8, features:{ ...oldFeatures }, audio:new Blob(['old-audio']), duration:2, cover:new Blob(['old-cover']), coverConfig:{ ...coverPresetFor('温柔姐姐'), bubbleText:'手写气泡内容' }, createdAt:'2026-10-01' };
  saved.push(meme);
  const base: StudioDependencies = {
    recorder: { isRecording: false, start: async () => {}, stop: async () => new Blob(['new-recording'], { type: 'audio/webm' }) },
    analyzer: { analyze: async () => ({ duration: 2, features: { ...newFeatures } }) },
    cropper: { inspect: async () => ({ duration: 2, needsCrop: false }), crop: async (blob, range) => ({ blob, duration: range.end - range.start }) },
    renderer: { render: async () => new Blob(['new-cover'], { type: 'image/png' }) },
    repository: { list: async () => saved, save: async (m) => { const i = saved.findIndex((x) => x.id === m.id); if (i >= 0) saved[i] = m; else saved.push(m); }, rename: async () => {}, delete: async () => {} },
    share: { share: async () => 'shared' },
  };
  const studio = useStudio({ ...base, ...overrides });
  studio.editMeme(meme);
  return { studio, saved };
}

describe('voice replacement draft', () => {
  it('keeps original voice, evidence, title and bubble when cancelled', async () => {
    const { studio } = existing();
    studio.startVoiceReplacement();
    const newFile = new Blob(['new-import'], { type: 'audio/webm' });
    await studio.importReplacementAudio(newFile);
    expect(studio.replacement.value?.phase).toBe('crop');
    studio.cancelVoiceReplacement();
    expect(studio.replacement.value).toBeUndefined();
    expect(studio.draft.audio).toEqual(new Blob(['old-audio']));
    expect(studio.features.value).toEqual(oldFeatures);
    expect(studio.emotion.value?.label).toBe('温柔姐姐');
    expect(studio.draft.title).toBe('旧作品名');
    expect(studio.cover.value.bubbleText).toBe('手写气泡内容');
    expect(studio.draft.featureSource).toBeUndefined();
  });

  it('cannot confirm before the new voice is analyzed', () => {
    const { studio } = existing();
    studio.startVoiceReplacement();
    expect(studio.stage.value).toBe('cover');
    studio.confirmVoiceReplacement();
    expect(studio.draft.audio).toEqual(new Blob(['old-audio']));
  });

  it('commits new voice and new evidence together with provenance; save/read-back/share all use the confirmed voice', async () => {
    const shared: VoiceMeme[] = [];
    const { studio, saved } = existing([], { share: { share: async (m) => { shared.push(m); return 'shared'; } } });
    studio.startVoiceReplacement();
    await studio.importReplacementAudio(new Blob(['new-import'], { type: 'audio/webm' }));
    await studio.analyzeReplacement();
    // 接受新建议（暴躁老哥）；名称与气泡不在草稿中，天然不会被改
    expect(studio.replacement.value?.suggestedLabel).toBe('暴躁老哥');
    studio.confirmVoiceReplacement();
    expect(studio.replacement.value).toBeUndefined();
    expect(studio.draft.audio).toEqual(new Blob(['new-import'], { type: 'audio/webm' }));
    expect(studio.features.value).toEqual(newFeatures);
    expect(studio.emotion.value?.label).toBe('暴躁老哥');
    expect(studio.draft.title).toBe('旧作品名');
    expect(studio.cover.value.bubbleText).toBe('手写气泡内容');
    expect(studio.draft.featureSource).toMatchObject({ kind: 'replacement', method: 'import', basedOnLabel: '温柔姐姐' });
    await studio.save();
    const stored = saved.find((m) => m.id === 'old');
    expect(stored?.audio).toEqual(new Blob(['new-import'], { type: 'audio/webm' }));
    expect(stored?.title).toBe('旧作品名');
    expect(stored?.coverConfig.bubbleText).toBe('手写气泡内容');
    expect(stored?.featureSource).toMatchObject({ kind: 'replacement' });
    // 回读与分享都对应确认后的声音
    studio.editMeme(stored!);
    expect(studio.draft.audio).toEqual(stored!.audio);
    expect(studio.features.value).toEqual(newFeatures);
    await studio.shareMeme(stored!);
    expect(shared[0]?.audio).toEqual(new Blob(['new-import'], { type: 'audio/webm' }));
    expect(shared[0]?.title).toBe('旧作品名');
  });

  it('records provenance as original for brand new works', async () => {
    const saved: VoiceMeme[] = [];
    const { studio } = existing(saved);
    // 模拟新建流程的最小状态
    studio.newRecording();
    studio.draft.audio = new Blob(['a']); studio.draft.duration = 1; studio.draft.method = 'recording'; studio.draft.acquiredAt = '2026-10-07T00:00:00Z';
    studio.cover.value = coverPresetFor('元气满满');
    studio.emotion.value = { label:'元气满满', confidence:.8, explanation:'', scores:{ '暴躁老哥':0,'温柔姐姐':0,'阴阳怪气':0,'元气满满':1 } };
    studio.features.value = newFeatures;
    await studio.save();
    expect(saved[0]?.featureSource).toMatchObject({ kind: 'original', method: 'recording' });
  });

  it('analysis failure never leaves the new voice paired with old evidence', async () => {
    const { studio } = existing([], {
      analyzer: { analyze: async () => { throw new Error('decode boom'); } },
    });
    studio.startVoiceReplacement();
    await studio.importReplacementAudio(new Blob(['bad']));
    await studio.analyzeReplacement();
    expect(studio.replacement.value?.error).toContain('分析失败');
    // 主作品声音/依据未动；无法确认
    expect(studio.draft.audio).toEqual(new Blob(['old-audio']));
    expect(studio.features.value).toEqual(oldFeatures);
    studio.confirmVoiceReplacement();
    expect(studio.draft.audio).toEqual(new Blob(['old-audio']));
    // 取消后原作品完好
    studio.cancelVoiceReplacement();
    expect(studio.features.value).toEqual(oldFeatures);
  });

  it('a late-resolving earlier file cannot overwrite the later pick', async () => {
    const inspectCalls: string[] = [];
    let resolveFirst: ((v: { duration: number; needsCrop: boolean }) => void) | undefined;
    const { studio } = existing([], {
      cropper: {
        inspect: async (blob) => { inspectCalls.push(blob.type); return blob.type === 'audio/first'
          ? await new Promise((r) => { resolveFirst = r; })
          : { duration: 3, needsCrop: false }; },
        crop: async (blob, range) => ({ blob, duration: range.end - range.start }),
      },
      analyzer: { analyze: async () => ({ duration: 2, features: { ...newFeatures } }) },
    });
    studio.startVoiceReplacement();
    const first = studio.importReplacementAudio(new Blob(['first'], { type: 'audio/first' }));
    await Promise.resolve();
    await studio.importReplacementAudio(new Blob(['second'], { type: 'audio/second' }));
    expect(studio.replacement.value?.audio).toEqual(new Blob(['second'], { type: 'audio/second' }));
    resolveFirst!({ duration: 9, needsCrop: false });
    await first;
    expect(studio.replacement.value?.audio).toEqual(new Blob(['second'], { type: 'audio/second' }));
    // 确认时分析的也是后选文件
    await studio.analyzeReplacement();
    studio.confirmVoiceReplacement();
    expect(studio.draft.audio).toEqual(new Blob(['second'], { type: 'audio/second' }));
  });

  it('releases the microphone when replacing is cancelled mid recording', async () => {
    let stopped = false;
    const { studio } = existing([], {
      recorder: { isRecording: true, start: async () => {}, stop: async () => { stopped = true; return new Blob(['x']); } },
    });
    studio.startVoiceReplacement();
    await studio.startReplacementRecording();
    studio.cancelVoiceReplacement();
    expect(stopped).toBe(true);
    expect(studio.draft.audio).toEqual(new Blob(['old-audio']));
  });

  it('forces a crop stage for imports longer than ten seconds', async () => {
    const { studio } = existing([], {
      cropper: { inspect: async () => ({ duration: 23, needsCrop: true }), crop: async (blob, range) => ({ blob, duration: range.end - range.start }) },
    });
    studio.startVoiceReplacement();
    await studio.importReplacementAudio(new Blob(['long']));
    expect(studio.replacement.value?.phase).toBe('crop');
    expect(studio.replacement.value?.cropEnd).toBe(10);
    expect(studio.replacement.value?.error).toContain('10 秒');
  });

  it('allows keeping the original label and records the choice', async () => {
    const { studio } = existing();
    studio.startVoiceReplacement();
    await studio.importReplacementAudio(new Blob(['new']));
    await studio.analyzeReplacement();
    studio.selectReplacementEmotion('温柔姐姐');
    expect(studio.replacement.value?.emotion?.explanation).toContain('沿用原作品标签');
    studio.confirmVoiceReplacement();
    expect(studio.emotion.value?.label).toBe('温柔姐姐');
    expect(studio.features.value).toEqual(newFeatures);
    expect(studio.draft.featureSource).toMatchObject({ kind: 'replacement', basedOnLabel: '温柔姐姐' });
  });
});
