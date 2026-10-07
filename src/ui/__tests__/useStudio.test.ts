import { describe, expect, it } from 'vitest';
import { useStudio, type StudioDependencies } from '../useStudio';
import { coverPresetFor } from '../../core/cover-presets';
import type { AudioFeatures, VoiceMeme } from '../../core/models';

const OLD_FEATURES: AudioFeatures = { loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2 };
const NEW_FEATURES: AudioFeatures = { loudness:.75,dynamics:.55,pitch:.8,zeroCrossing:.62,pauseRatio:.12,tempoVariation:.6 };

function existingMeme(overrides: Partial<VoiceMeme> = {}): VoiceMeme {
  return { id:'old',title:'旧作品',emotion:'温柔姐姐',confidence:.8,features:{...OLD_FEATURES},audio:new Blob(['old-audio']),duration:1,cover:new Blob(['c']),coverConfig:{...coverPresetFor('温柔姐姐'),title:'旧作品',bubbleText:'手写气泡'},createdAt:'2026-10-05',...overrides };
}

function dependencies(overrides: Partial<StudioDependencies> = {}): StudioDependencies {
  const saved: VoiceMeme[] = [];
  return {
    recorder: { isRecording: false, start: async () => {}, stop: async () => new Blob(['voice'], { type: 'audio/webm' }) },
    analyzer: { analyze: async () => ({ duration: 2, features: { loudness:.75,dynamics:.55,pitch:.8,zeroCrossing:.62,pauseRatio:.12,tempoVariation:.6 } }) },
    cropper: { inspect: async () => ({duration:2,needsCrop:false}), crop: async (blob, range) => ({blob,duration:range.end-range.start}) },
    renderer: { render: async () => new Blob(['cover'], { type: 'image/png' }) },
    repository: { list: async()=>saved, save: async(m)=>{saved.push(m)}, rename:async()=>{}, delete:async()=>{} },
    share: { share: async () => 'shared' },
    ...overrides,
  };
}

describe('useStudio', () => {
  it('turns microphone denial into a recoverable error', async () => {
    const studio = useStudio(dependencies({ recorder: { isRecording:false, start:async()=>{throw new DOMException('denied','NotAllowedError')}, stop:async()=>new Blob() } }));
    await studio.startRecording();
    expect(studio.error.value).toContain('麦克风权限');
    expect(studio.stage.value).toBe('record');
  });
  it('moves recording through crop and emotion with manual override', async () => {
    const studio = useStudio(dependencies()); await studio.startRecording(); await studio.stopRecording();
    expect(studio.stage.value).toBe('crop'); await studio.analyze(); expect(studio.emotion.value?.label).toBe('元气满满');
    studio.selectEmotion('温柔姐姐'); expect(studio.cover.value.label).toBe('温柔姐姐'); expect(studio.stage.value).toBe('emotion');
  });
  it('keeps the draft when saving fails and can edit an existing work', async () => {
    const studio = useStudio(dependencies({ repository: { list:async()=>[], save:async()=>{throw new DOMException('full','QuotaExceededError')}, rename:async()=>{}, delete:async()=>{} } }));
    studio.draft.audio = new Blob(['a']); studio.draft.duration = 1; studio.cover.value = coverPresetFor('温柔姐姐'); studio.emotion.value = { label:'温柔姐姐',confidence:.8,explanation:'柔和',scores:{'暴躁老哥':0,'温柔姐姐':1,'阴阳怪气':0,'元气满满':0} };
    studio.features.value = { loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2 };
    await studio.save(); expect(studio.error.value).toContain('保存失败'); expect(studio.draft.audio?.size).toBe(1);
    const existing = { id:'old',title:'旧作品',emotion:'温柔姐姐' as const,confidence:.8,features:{loudness:.2,dynamics:.2,pitch:.4,zeroCrossing:.2,pauseRatio:.3,tempoVariation:.2},audio:new Blob(['a']),duration:1,cover:new Blob(['c']),coverConfig:coverPresetFor('温柔姐姐'),createdAt:'2026-10-05' };
    studio.editMeme(existing); expect(studio.draft.title).toBe('旧作品'); expect(studio.stage.value).toBe('cover');
  });
});

describe('replace voice while editing', () => {
  it('keeps the original work untouched until the replacement is confirmed', async () => {
    const studio = useStudio(dependencies()); const meme = existingMeme(); studio.editMeme(meme);
    await studio.startReplace(new Blob(['new-audio']));
    expect(studio.draft.audio).toBe(meme.audio); expect(studio.features.value).toEqual(OLD_FEATURES);
    await studio.analyzeReplacement();
    expect(studio.draft.audio).toBe(meme.audio); expect(studio.draft.title).toBe('旧作品');
    studio.confirmReplace('accept');
    expect(studio.draft.audio).not.toBe(meme.audio); expect(studio.features.value).toEqual(NEW_FEATURES);
    expect(studio.emotion.value?.label).toBe('元气满满'); expect(studio.labelSource.value).toBe('analysis');
    expect(studio.draft.title).toBe('旧作品'); expect(studio.cover.value.title).toBe('旧作品'); expect(studio.cover.value.bubbleText).toBe('手写气泡');
    expect(studio.replacement.value).toBeUndefined();
  });
  it('lets the user keep the original label and records the inherited source', async () => {
    const studio = useStudio(dependencies()); studio.editMeme(existingMeme());
    await studio.startReplace(new Blob(['new-audio'])); await studio.analyzeReplacement(); studio.confirmReplace('keep');
    expect(studio.emotion.value?.label).toBe('温柔姐姐'); expect(studio.features.value).toEqual(NEW_FEATURES);
    expect(studio.labelSource.value).toBe('inherited'); expect(studio.cover.value.label).toBe('温柔姐姐');
  });
  it('cancel discards the replacement and never guesses the source of an old work', async () => {
    const studio = useStudio(dependencies()); const meme = existingMeme(); studio.editMeme(meme);
    expect(studio.labelSource.value).toBeUndefined();
    await studio.startReplace(new Blob(['new-audio'])); await studio.analyzeReplacement(); studio.cancelReplace();
    expect(studio.draft.audio).toBe(meme.audio); expect(studio.features.value).toEqual(OLD_FEATURES);
    expect(studio.emotion.value?.label).toBe('温柔姐姐'); expect(studio.labelSource.value).toBeUndefined();
    expect(studio.replacement.value).toBeUndefined();
  });
  it('a failed analysis leaves no new voice paired with the old basis', async () => {
    const studio = useStudio(dependencies({ analyzer: { analyze: async () => { throw new Error('decode failed'); } } }));
    const meme = existingMeme(); studio.editMeme(meme);
    await studio.startReplace(new Blob(['broken'])); await studio.analyzeReplacement();
    expect(studio.error.value).toContain('分析失败'); expect(studio.replacement.value).toBeUndefined();
    expect(studio.draft.audio).toBe(meme.audio); expect(studio.features.value).toEqual(OLD_FEATURES);
  });
  it('a late finish of an earlier file never overrides a later file', async () => {
    let resolveFirst!: (info: { duration: number; needsCrop: boolean }) => void; let calls = 0;
    const cropper = { inspect: async () => { calls += 1; return calls === 1 ? new Promise<{ duration: number; needsCrop: boolean }>((resolve) => { resolveFirst = resolve; }) : { duration: 4, needsCrop: false }; }, crop: async (blob: Blob, range: { start: number; end: number }) => ({ blob, duration: range.end - range.start }) };
    const studio = useStudio(dependencies({ cropper })); studio.editMeme(existingMeme());
    const first = studio.startReplace(new Blob(['f1'])); await studio.startReplace(new Blob(['f2']));
    resolveFirst({ duration: 9, needsCrop: false }); await first;
    expect(studio.replacement.value?.duration).toBe(4); expect(studio.replacement.value?.source?.size).toBe(2);
  });
  it('a late analysis of a replaced draft never pollutes the main draft', async () => {
    let resolveAnalyze!: (result: { duration: number; features: AudioFeatures }) => void; let calls = 0;
    const analyzer = { analyze: async () => { calls += 1; return calls === 1 ? new Promise<{ duration: number; features: AudioFeatures }>((resolve) => { resolveAnalyze = resolve; }) : { duration: 2, features: { ...NEW_FEATURES } }; } };
    const studio = useStudio(dependencies({ analyzer })); studio.editMeme(existingMeme());
    await studio.startReplace(new Blob(['f1'])); const pending = studio.analyzeReplacement();
    await studio.startReplace(new Blob(['f2'])); resolveAnalyze({ duration: 2, features: { ...OLD_FEATURES } }); await pending;
    expect(studio.replacement.value?.suggestion).toBeUndefined(); expect(studio.replacement.value?.source?.size).toBe(2);
    expect(studio.features.value).toEqual(OLD_FEATURES);
  });
  it('requires trimming before analysis when the new voice is longer than ten seconds', async () => {
    const studio = useStudio(dependencies({ cropper: { inspect: async () => ({ duration: 12, needsCrop: true }), crop: async (blob: Blob, range: { start: number; end: number }) => ({ blob, duration: range.end - range.start }) } }));
    studio.editMeme(existingMeme()); await studio.startReplace(new Blob(['long-audio']));
    expect(studio.replacement.value?.cropEnd).toBe(10);
    studio.replacement.value!.cropEnd = 12; await studio.analyzeReplacement();
    expect(studio.error.value).toContain('10 秒'); expect(studio.replacement.value?.suggestion).toBeUndefined();
    studio.replacement.value!.cropEnd = 10; await studio.analyzeReplacement();
    expect(studio.replacement.value?.suggestion?.label).toBe('元气满满');
  });
  it('saves, reloads and shares exactly the confirmed voice with its source', async () => {
    const saved: VoiceMeme[] = []; const shared: VoiceMeme[] = [];
    const studio = useStudio(dependencies({
      repository: { list: async () => saved, save: async (m) => { const i = saved.findIndex((item) => item.id === m.id); if (i >= 0) saved.splice(i, 1); saved.push(m); }, rename: async () => {}, delete: async () => {} },
      share: { share: async (m) => { shared.push(m); return 'shared' as const; } },
    }));
    const meme = existingMeme(); saved.push(meme); studio.editMeme(meme);
    await studio.startReplace(new Blob(['confirmed-voice'])); await studio.analyzeReplacement(); studio.confirmReplace('accept');
    await studio.save();
    const stored = saved.find((item) => item.id === 'old')!;
    expect(stored.audio).toBe(studio.draft.audio); expect(stored.features).toEqual(NEW_FEATURES); expect(stored.labelSource).toBe('analysis');
    studio.editMeme(stored); expect(studio.draft.audio).toBe(stored.audio); expect(studio.labelSource.value).toBe('analysis');
    await studio.shareMeme(stored); expect(shared[0].audio).toBe(stored.audio);
  });
});
