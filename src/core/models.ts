export type EmotionLabel = '暴躁老哥' | '温柔姐姐' | '阴阳怪气' | '元气满满';
export type StudioStage = 'record' | 'crop' | 'emotion' | 'cover' | 'collection';
export interface CropRange { start: number; end: number }
export interface AudioFeatures { loudness: number; dynamics: number; pitch: number; zeroCrossing: number; pauseRatio: number; tempoVariation: number }
export interface EmotionResult { label: EmotionLabel; confidence: number; explanation: string; scores: Record<EmotionLabel, number> }
/** 声音获取方式：麦克风录音或导入本地文件 */
export type AudioMethod = 'recording' | 'import';
/**
 * 分析依据来源。只有明确经历过的流程才会记录：
 * - original：新建作品时的首段声音
 * - replacement：编辑已保存作品时确认替换的声音
 * 字段缺省（旧作品）一律视为来源未知，展示层不得猜测。
 */
export type FeatureSource =
  | { kind: 'original'; method: AudioMethod; at: string }
  | { kind: 'replacement'; method: AudioMethod; at: string; basedOnLabel: EmotionLabel };
export function describeFeatureSource(source: FeatureSource | undefined): string {
  if (!source) return '来源未知';
  const method = source.method === 'recording' ? '录音' : '导入文件';
  return source.kind === 'replacement'
    ? `声音替换 · ${method}（原标签「${source.basedOnLabel}」）`
    : `原始${method}`;
}
export interface CoverConfig {
  label: EmotionLabel;
  title: string;
  bubbleText: string;
  bubbleX: number;
  bubbleY: number;
  palette: [string, string, string];
  filter: 'none' | 'mono' | 'saturate' | 'warm' | 'cool';
  ratio: 'square' | 'portrait';
}
export interface VoiceMeme {
  id: string;
  title: string;
  emotion: EmotionLabel;
  confidence: number;
  features: AudioFeatures;
  /** 当前 features 的来源；旧作品可能缺省，展示层按来源未知处理，禁止猜测 */
  featureSource?: FeatureSource;
  audio: Blob;
  duration: number;
  cover: Blob;
  coverConfig: CoverConfig;
  createdAt: string;
}

export function validateCropRange(range: CropRange, duration: number): string | undefined {
  if (range.start < 0) return '裁剪起点不能小于 0';
  if (range.end <= range.start) return '裁剪终点必须晚于起点';
  if (range.end > duration) return '裁剪终点超出音频时长';
  if (range.end - range.start > 10) return '裁剪片段不能超过 10 秒';
  return undefined;
}
