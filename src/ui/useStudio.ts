import { reactive, ref } from 'vue';
import { classifyEmotion } from '../core/emotion-engine';
import { coverPresetFor } from '../core/cover-presets';
import type { AudioFeatures, AudioMethod, CoverConfig, EmotionLabel, EmotionResult, FeatureSource, StudioStage, VoiceMeme } from '../core/models';
import type { RecorderPort } from '../ports/recorder.port';
import type { AudioAnalyzerPort } from '../ports/audio-analyzer.port';
import type { AudioCropperPort } from '../ports/audio-cropper.port';
import type { CoverRendererPort } from '../ports/cover-renderer.port';
import type { MemeRepository } from '../ports/meme-repository.port';
import type { SharePort } from '../ports/share.port';

export interface StudioDependencies { recorder: RecorderPort; analyzer: AudioAnalyzerPort; cropper: AudioCropperPort; renderer: CoverRendererPort; repository: MemeRepository; share: SharePort }

/**
 * 替换声音的独立草稿。它与主 draft / features / emotion / cover 完全隔离：
 * 只有 confirmVoiceReplacement 一个提交点会把内容写入主编辑状态，
 * 取消或失败直接丢弃整个对象，因此不可能出现“新声音配旧依据”。
 */
export interface ReplacementSession {
  /** 代际令牌：每次重新选文件/开始录音/改选都会自增，在途的旧异步结果凭它作废 */
  token: number;
  phase: 'source' | 'crop' | 'emotion';
  method: AudioMethod;
  previousLabel: EmotionLabel;
  suggestedLabel?: EmotionLabel;
  acquiredAt: string;
  audio?: Blob;
  duration: number;
  cropStart: number;
  cropEnd: number;
  features?: AudioFeatures;
  emotion?: EmotionResult;
  busy: boolean;
  recording: boolean;
  error: string;
}

interface StudioDraft {
  id?: string;
  title: string;
  audio?: Blob;
  duration: number;
  cropStart: number;
  cropEnd: number;
  method: AudioMethod;
  acquiredAt: string;
  /** 已确认声音的依据来源；旧作品可能为 undefined（来源未知，禁止猜测） */
  featureSource?: FeatureSource;
}

export function useStudio(deps: StudioDependencies) {
  const stage = ref<StudioStage>('record'); const error = ref(''); const notice = ref(''); const level = ref(0); const repLevel = ref(0);
  const draft = reactive<StudioDraft>({ title: '我的声音表情', duration: 0, cropStart: 0, cropEnd: 0, method: 'recording', acquiredAt: '' });
  const emotion = ref<EmotionResult>(); const features = ref<AudioFeatures>(); const cover = ref<CoverConfig>(coverPresetFor('元气满满')); const collection = ref<VoiceMeme[]>([]);
  const replacement = ref<ReplacementSession | undefined>(undefined);
  let replacementToken = 0;

  async function startRecording() { error.value = ''; try { await deps.recorder.start((value) => { level.value = value; }); notice.value = '正在录音，最长 10 秒'; } catch { error.value = '无法使用麦克风权限，请在浏览器设置中允许访问或导入音频。'; } }
  async function stopRecording() { try { const audio = await deps.recorder.stop(); const info = await deps.cropper.inspect(audio); draft.audio = audio; draft.method = 'recording'; draft.acquiredAt = new Date().toISOString(); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; notice.value = info.needsCrop ? '音频超过 10 秒，请选择保留片段' : '录音完成，可以试听并分析'; } catch (cause) { error.value = cause instanceof Error ? cause.message : '录音结束失败'; } }
  async function importAudio(blob: Blob) { draft.audio = blob; draft.method = 'import'; draft.acquiredAt = new Date().toISOString(); const info = await deps.cropper.inspect(blob); draft.duration = info.duration; draft.cropStart = 0; draft.cropEnd = Math.min(10, info.duration); stage.value = 'crop'; }
  async function analyze() { if (!draft.audio) { error.value = '请先录制或导入一段声音'; return; } const cropped = await deps.cropper.crop(draft.audio, { start: draft.cropStart, end: draft.cropEnd }); draft.audio = cropped.blob; draft.duration = cropped.duration; const result = await deps.analyzer.analyze(cropped.blob); features.value = result.features; emotion.value = classifyEmotion(result.features); cover.value = coverPresetFor(emotion.value.label); stage.value = 'emotion'; }
  function selectEmotion(label: EmotionLabel) { const current = emotion.value ?? classifyEmotion({ loudness:0,dynamics:0,pitch:0,zeroCrossing:0,pauseRatio:1,tempoVariation:0 }); emotion.value = { ...current, label, explanation: `已手动选择「${label}」标签。` }; cover.value = { ...coverPresetFor(label), title: cover.value.title || label }; }
  function goCover() { stage.value = 'cover'; }

  // ---- 编辑已保存作品时的声音替换（独立草稿；主编辑内容全程不动） ----
  function startVoiceReplacement() {
    if (!draft.id) return;
    error.value = ''; notice.value = '';
    replacementToken += 1;
    replacement.value = { token: replacementToken, phase: 'source', method: 'import', previousLabel: emotion.value?.label ?? cover.value.label, acquiredAt: new Date().toISOString(), duration: 0, cropStart: 0, cropEnd: 0, busy: false, recording: false, error: '' };
  }
  /** 丢弃替换草稿；若麦克风仍在录制，先释放媒体轨道再丢弃 */
  function cancelVoiceReplacement() {
    const recording = replacement.value?.recording ?? false;
    replacement.value = undefined; repLevel.value = 0;
    if (recording && deps.recorder.isRecording) void deps.recorder.stop().catch(() => undefined);
    notice.value = '已取消替换，作品仍使用原来的声音与分析依据。';
  }
  /** 回到选源重新挑声音（上一份临时 Blob 随草稿字段清空而释放） */
  function rechooseReplacementAudio() {
    const s = replacement.value; if (!s) return;
    const recording = s.recording;
    replacementToken += 1;
    Object.assign(s, { token: replacementToken, phase: 'source', audio: undefined, features: undefined, emotion: undefined, suggestedLabel: undefined, duration: 0, cropStart: 0, cropEnd: 0, busy: false, recording: false, error: '' });
    if (recording && deps.recorder.isRecording) void deps.recorder.stop().catch(() => undefined);
  }
  /** 连续选文件：令牌自增，较早文件即便更晚返回也无法写入当前草稿 */
  async function importReplacementAudio(blob: Blob) {
    if (!replacement.value) return;
    const token = ++replacementToken;
    const s = replacement.value;
    Object.assign(s, { token, phase: 'source', method: 'import', audio: undefined, features: undefined, emotion: undefined, suggestedLabel: undefined, duration: 0, cropStart: 0, cropEnd: 0, busy: true, recording: false, error: '', acquiredAt: new Date().toISOString() });
    try {
      const info = await deps.cropper.inspect(blob);
      const cur = replacement.value;
      if (!cur || cur.token !== token) return; // 已被更新的选择取代：结果丢弃
      cur.audio = blob; cur.duration = info.duration; cur.cropStart = 0; cur.cropEnd = Math.min(10, info.duration);
      cur.phase = 'crop'; cur.busy = false; cur.error = info.needsCrop ? '新声音超过 10 秒，请先选择不超过 10 秒的片段。' : '';
    } catch (cause) {
      const cur = replacement.value;
      if (cur && cur.token === token) { cur.busy = false; cur.error = cause instanceof Error ? cause.message : '无法读取该音频文件，请换一个文件试试。'; }
    }
  }
  async function startReplacementRecording() {
    if (!replacement.value) return;
    const token = ++replacementToken;
    const s = replacement.value;
    Object.assign(s, { token, phase: 'source', method: 'recording', audio: undefined, features: undefined, emotion: undefined, suggestedLabel: undefined, duration: 0, cropStart: 0, cropEnd: 0, busy: false, recording: true, error: '', acquiredAt: new Date().toISOString() });
    repLevel.value = 0; error.value = '';
    try {
      await deps.recorder.start((value) => { if (replacement.value?.token === token) repLevel.value = value; });
    } catch {
      const cur = replacement.value;
      if (cur && cur.token === token) { cur.recording = false; cur.error = '无法使用麦克风权限，请在浏览器设置中允许访问或导入音频。'; }
    }
  }
  async function stopReplacementRecording() {
    const s = replacement.value;
    if (!s || !s.recording) return;
    const token = s.token;
    try {
      const blob = await deps.recorder.stop();
      const cur0 = replacement.value;
      if (!cur0 || cur0.token !== token) return; // 录制期间已改选文件：录音结果丢弃
      cur0.recording = false; repLevel.value = 0; cur0.busy = true;
      const info = await deps.cropper.inspect(blob);
      const cur = replacement.value;
      if (!cur || cur.token !== token) return;
      cur.audio = blob; cur.duration = info.duration; cur.cropStart = 0; cur.cropEnd = Math.min(10, info.duration);
      cur.phase = 'crop'; cur.busy = false; cur.error = info.needsCrop ? '新声音超过 10 秒，请先选择不超过 10 秒的片段。' : '';
    } catch (cause) {
      const cur = replacement.value;
      if (cur && cur.token === token) { cur.recording = false; cur.busy = false; cur.error = cause instanceof Error ? cause.message : '录音结束失败'; }
    }
  }
  /** 裁剪并分析新声音；失败只在替换草稿内报错，主作品的声音与依据保持原样 */
  async function analyzeReplacement() {
    const s = replacement.value;
    if (!s || !s.audio || s.busy || s.phase === 'emotion') return;
    const token = s.token;
    s.busy = true; s.error = '';
    try {
      const cropped = await deps.cropper.crop(s.audio, { start: s.cropStart, end: s.cropEnd });
      const result = await deps.analyzer.analyze(cropped.blob);
      const cur = replacement.value;
      if (!cur || cur.token !== token) return; // 分析期间改选或取消：新声音与新依据一起丢弃
      const judged = classifyEmotion(result.features);
      cur.audio = cropped.blob; cur.duration = cropped.duration;
      cur.features = result.features; cur.emotion = judged; cur.suggestedLabel = judged.label;
      cur.phase = 'emotion'; cur.busy = false;
    } catch (cause) {
      const cur = replacement.value;
      if (cur && cur.token === token) { cur.busy = false; cur.error = cause instanceof Error ? `新声音分析失败：${cause.message}` : '新声音分析失败，请重试或更换声音。'; }
    }
  }
  /** 沿用原标签或接受新建议（也可改选其他标签）；只写入替换草稿 */
  function selectReplacementEmotion(label: EmotionLabel) {
    const cur = replacement.value;
    if (!cur || !cur.emotion) return;
    const explanation = label === cur.previousLabel
      ? `已沿用原作品标签「${label}」。`
      : label === cur.suggestedLabel
        ? `已接受新声音的建议标签「${label}」。`
        : `已手动选择「${label}」标签。`;
    cur.emotion = { ...cur.emotion, label, explanation };
  }
  /** 唯一提交点：声音、依据成对提交；名称与手写气泡原样保留 */
  function confirmVoiceReplacement() {
    const s = replacement.value;
    if (!s || !s.audio || !s.features || !s.emotion || s.phase !== 'emotion' || s.busy) return;
    const preset = coverPresetFor(s.emotion.label);
    cover.value = { ...cover.value, label: s.emotion.label, palette: preset.palette };
    draft.audio = s.audio; draft.duration = s.duration;
    features.value = s.features; emotion.value = s.emotion;
    draft.featureSource = { kind: 'replacement', method: s.method, at: s.acquiredAt, basedOnLabel: s.previousLabel };
    replacement.value = undefined; repLevel.value = 0;
    notice.value = '声音与分析依据已替换，作品名称和手写气泡保持不变；保存后正式生效。';
  }

  async function save(target?: HTMLCanvasElement) {
    if (!draft.audio || !emotion.value || !features.value) { error.value = '作品信息尚未完整，请先完成声音分析'; return; }
    if (replacement.value) { error.value = '请先完成或取消声音替换，再保存作品。'; return; }
    try {
      const coverBlob = await deps.renderer.render(cover.value, target);
      const featureSource: FeatureSource | undefined = draft.id
        ? draft.featureSource
        : { kind: 'original', method: draft.method, at: draft.acquiredAt || new Date().toISOString() };
      const meme: VoiceMeme = { id: draft.id ?? `meme-${Date.now()}`, title: draft.title.trim() || '未命名声音', emotion: emotion.value.label, confidence: emotion.value.confidence, features: features.value, featureSource, audio: draft.audio, duration: draft.duration, cover: coverBlob, coverConfig: { ...cover.value }, createdAt: new Date().toISOString() };
      await deps.repository.save(meme);
      await loadCollection();
      stage.value = 'collection'; notice.value = '作品已保存到本地'; error.value = '';
    } catch { error.value = '保存失败，本次编辑内容仍保留，请检查浏览器存储空间。'; }
  }
  async function loadCollection() { collection.value = (await deps.repository.list()).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  function editMeme(meme: VoiceMeme) { Object.assign(draft, { id:meme.id,title:meme.title,audio:meme.audio,duration:meme.duration,cropStart:0,cropEnd:meme.duration,featureSource:meme.featureSource }); features.value = meme.features; emotion.value = { label:meme.emotion,confidence:meme.confidence,explanation:'编辑已保存作品',scores:{'暴躁老哥':0,'温柔姐姐':0,'阴阳怪气':0,'元气满满':0} }; cover.value = { ...meme.coverConfig }; replacement.value = undefined; stage.value = 'cover'; notice.value = ''; error.value = ''; }
  async function deleteMeme(id: string) { await deps.repository.delete(id); await loadCollection(); }
  async function shareMeme(meme: VoiceMeme) { const result = await deps.share.share(meme); notice.value = result === 'shared' ? '已打开系统分享' : '浏览器不支持文件分享，已下载音频和封面'; }
  function newRecording() { draft.id = undefined; draft.title = '我的声音表情'; draft.audio = undefined; draft.featureSource = undefined; draft.method = 'recording'; draft.acquiredAt = ''; emotion.value = undefined; features.value = undefined; replacement.value = undefined; stage.value = 'record'; error.value = ''; notice.value = ''; }
  return { stage,error,notice,level,repLevel,draft,emotion,features,cover,collection,replacement,startRecording,stopRecording,importAudio,analyze,selectEmotion,goCover,startVoiceReplacement,cancelVoiceReplacement,rechooseReplacementAudio,importReplacementAudio,startReplacementRecording,stopReplacementRecording,analyzeReplacement,selectReplacementEmotion,confirmVoiceReplacement,save,loadCollection,editMeme,deleteMeme,shareMeme,newRecording };
}
