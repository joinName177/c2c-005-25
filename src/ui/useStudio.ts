import { reactive, ref } from 'vue';
import { classifyEmotion } from '../core/emotion-engine';
import { coverPresetFor } from '../core/cover-presets';
import { validateCropRange } from '../core/models';
import type { AudioFeatures, CoverConfig, EmotionLabel, EmotionResult, LabelSource, StudioStage, VoiceMeme } from '../core/models';
import type { RecorderPort } from '../ports/recorder.port';
import type { AudioAnalyzerPort } from '../ports/audio-analyzer.port';
import type { AudioCropperPort } from '../ports/audio-cropper.port';
import type { CoverRendererPort } from '../ports/cover-renderer.port';
import type { MemeRepository } from '../ports/meme-repository.port';
import type { SharePort } from '../ports/share.port';

export interface StudioDependencies { recorder: RecorderPort; analyzer: AudioAnalyzerPort; cropper: AudioCropperPort; renderer: CoverRendererPort; repository: MemeRepository; share: SharePort }
export interface ReplacementDraft { token: number; source?: Blob; audio?: Blob; duration: number; cropStart: number; cropEnd: number; features?: AudioFeatures; suggestion?: EmotionResult; busy: boolean }
export function useStudio(deps: StudioDependencies) {
  const stage = ref<StudioStage>('record'); const error = ref(''); const notice = ref(''); const level = ref(0);
  const draft = reactive<{ id?: string; title: string; audio?: Blob; duration: number; cropStart: number; cropEnd: number }>({ title: '我的声音表情', duration: 0, cropStart: 0, cropEnd: 0 });
  const emotion = ref<EmotionResult>(); const features = ref<AudioFeatures>(); const cover = ref<CoverConfig>(coverPresetFor('元气满满')); const collection = ref<VoiceMeme[]>([]);
  const labelSource = ref<LabelSource | undefined>(); const replacement = ref<ReplacementDraft>(); let replaceToken = 0;

  async function startRecording() { error.value = ''; try { await deps.recorder.start((value) => { level.value = value; }); notice.value = '正在录音，最长 10 秒'; } catch { error.value = '无法使用麦克风权限，请在浏览器设置中允许访问或导入音频。'; } }
  async function stopRecording() { try { draft.audio = await deps.recorder.stop(); const info = await deps.cropper.inspect(draft.audio); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; notice.value = info.needsCrop ? '音频超过 10 秒，请选择保留片段' : '录音完成，可以试听并分析'; } catch (cause) { error.value = cause instanceof Error ? cause.message : '录音结束失败'; } }
  async function importAudio(blob: Blob) { draft.audio = blob; const info = await deps.cropper.inspect(blob); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; }
  async function analyze() { if (!draft.audio) { error.value = '请先录制或导入一段声音'; return; } const cropped = await deps.cropper.crop(draft.audio, { start: draft.cropStart, end: draft.cropEnd }); draft.audio = cropped.blob; draft.duration = cropped.duration; const result = await deps.analyzer.analyze(cropped.blob); features.value = result.features; emotion.value = classifyEmotion(result.features); labelSource.value = 'analysis'; cover.value = coverPresetFor(emotion.value.label); stage.value = 'emotion'; }
  function selectEmotion(label: EmotionLabel) { const current = emotion.value ?? classifyEmotion({ loudness:0,dynamics:0,pitch:0,zeroCrossing:0,pauseRatio:1,tempoVariation:0 }); emotion.value = { ...current, label, explanation: `已手动选择「${label}」标签。` }; labelSource.value = 'manual'; cover.value = { ...coverPresetFor(label), title: cover.value.title || label }; }
  function goCover() { stage.value = 'cover'; }
  async function save(target?: HTMLCanvasElement) { if (!draft.audio || !emotion.value || !features.value) { error.value = '作品信息尚未完整，请先完成声音分析'; return; } try { const coverBlob = await deps.renderer.render(cover.value, target); const meme: VoiceMeme = { id: draft.id ?? `meme-${Date.now()}`, title: draft.title.trim() || '未命名声音', emotion: emotion.value.label, confidence: emotion.value.confidence, features: features.value, audio: draft.audio, duration: draft.duration, cover: coverBlob, coverConfig: { ...cover.value }, createdAt: new Date().toISOString(), ...(labelSource.value ? { labelSource: labelSource.value } : {}) }; await deps.repository.save(meme); await loadCollection(); stage.value = 'collection'; notice.value = '作品已保存到本地'; } catch { error.value = '保存失败，本次编辑内容仍保留，请检查浏览器存储空间。'; } }
  async function loadCollection() { collection.value = (await deps.repository.list()).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  function editMeme(meme: VoiceMeme) { discardReplacement(); Object.assign(draft, { id:meme.id,title:meme.title,audio:meme.audio,duration:meme.duration,cropStart:0,cropEnd:meme.duration }); features.value = meme.features; emotion.value = { label:meme.emotion,confidence:meme.confidence,explanation:'编辑已保存作品',scores:{'暴躁老哥':0,'温柔姐姐':0,'阴阳怪气':0,'元气满满':0} }; labelSource.value = meme.labelSource; cover.value = { ...meme.coverConfig }; stage.value = 'cover'; }
  async function deleteMeme(id: string) { await deps.repository.delete(id); await loadCollection(); }
  async function shareMeme(meme: VoiceMeme) { const result = await deps.share.share(meme); notice.value = result === 'shared' ? '已打开系统分享' : '浏览器不支持文件分享，已下载音频和封面'; }
  function newRecording() { discardReplacement(); draft.id = undefined; draft.title = '我的声音表情'; draft.audio = undefined; emotion.value = undefined; features.value = undefined; labelSource.value = undefined; stage.value = 'record'; error.value = ''; }

  function discardReplacement(message?: string) { replaceToken += 1; replacement.value = undefined; if (message) notice.value = message; }
  async function startReplace(file: Blob) {
    error.value = ''; const token = ++replaceToken;
    replacement.value = { token, source: file, duration: 0, cropStart: 0, cropEnd: 0, busy: true };
    try {
      const info = await deps.cropper.inspect(file);
      if (replacement.value?.token !== token) return;
      replacement.value = { token, source: file, duration: info.duration, cropStart: 0, cropEnd: Math.min(10, info.duration), busy: false };
      notice.value = info.needsCrop ? '新声音超过 10 秒，请先选择保留片段' : '新声音已就绪，请确认选段并分析';
    } catch { if (replacement.value?.token !== token) return; replacement.value = undefined; error.value = '无法读取所选音频，替换已取消，原作品未改动。'; }
  }
  async function analyzeReplacement() {
    const current = replacement.value; if (!current?.source) { error.value = '请先选择要替换的音频文件'; return; }
    const invalid = validateCropRange({ start: current.cropStart, end: current.cropEnd }, current.duration); if (invalid) { error.value = invalid; return; }
    replacement.value = { ...current, busy: true };
    try {
      const cropped = await deps.cropper.crop(current.source, { start: current.cropStart, end: current.cropEnd });
      const result = await deps.analyzer.analyze(cropped.blob);
      if (replacement.value?.token !== current.token) return;
      replacement.value = { ...current, busy: false, audio: cropped.blob, duration: cropped.duration, cropStart: 0, cropEnd: cropped.duration, features: result.features, suggestion: classifyEmotion(result.features) };
      notice.value = '新声音分析完成，确认后才会替换原声音';
    } catch { if (replacement.value?.token !== current.token) return; replacement.value = undefined; error.value = '新声音分析失败，替换已取消，原作品未改动。'; }
  }
  function confirmReplace(choice: 'keep' | 'accept') {
    const current = replacement.value; if (!current?.audio || !current.features || !current.suggestion) { error.value = '新声音尚未完成分析，无法确认替换'; return; }
    draft.audio = current.audio; draft.duration = current.duration; draft.cropStart = 0; draft.cropEnd = current.duration;
    features.value = current.features;
    if (choice === 'accept') {
      emotion.value = current.suggestion; labelSource.value = 'analysis';
      cover.value = { ...coverPresetFor(current.suggestion.label), title: cover.value.title, bubbleText: cover.value.bubbleText, bubbleX: cover.value.bubbleX, bubbleY: cover.value.bubbleY, filter: cover.value.filter, ratio: cover.value.ratio };
    } else {
      const kept = emotion.value?.label ?? current.suggestion.label;
      emotion.value = { ...(emotion.value ?? current.suggestion), label: kept, explanation: `已沿用原标签「${kept}」。` }; labelSource.value = 'inherited';
    }
    discardReplacement('声音已替换，保存后生效');
  }
  function cancelReplace() { discardReplacement('已取消替换，保留原声音'); }

  return { stage,error,notice,level,draft,emotion,features,cover,collection,labelSource,replacement,startRecording,stopRecording,importAudio,analyze,selectEmotion,goCover,save,loadCollection,editMeme,deleteMeme,shareMeme,newRecording,startReplace,analyzeReplacement,confirmReplace,cancelReplace };
}
