<script setup lang="ts">
import type { EmotionLabel } from '../../core/models';
import type { ReplacementSession } from '../useStudio';
import WaveformMeter from './WaveformMeter.vue';
defineProps<{ session: ReplacementSession; level: number }>();
const emit = defineEmits<{
  cancel: [];
  importFile: [file: File];
  record: [];
  stop: [];
  rechoose: [];
  updateStart: [n: number];
  updateEnd: [n: number];
  analyze: [];
  selectEmotion: [label: EmotionLabel];
  confirm: [];
}>();
const labels: EmotionLabel[] = ['暴躁老哥','温柔姐姐','阴阳怪气','元气满满'];
</script>
<template>
  <div class="voice-replace-backdrop" data-testid="voice-replace">
    <section class="voice-replace-panel">
      <header><div><span class="kicker">SWAP THE VOICE</span><h2>替换这段声音</h2><p class="replace-hint">作品名称和手写气泡会原样保留；新声音只有在分析后由你确认，保存时才会生效。</p></div><button type="button" class="ghost" data-testid="replace-cancel" @click="emit('cancel')">取消</button></header>
      <p v-if="session.error" class="replace-error">{{ session.error }}</p>

      <!-- 选源：录音或导入 -->
      <div v-if="session.phase==='source'" class="replace-source">
        <div class="time-code"><b>{{ session.recording?'REC':'READY' }}</b><strong>{{ session.recording?'录音中':'--:--' }}</strong><span>00:10 MAX</span></div>
        <WaveformMeter :level="level"/>
        <div class="recorder-actions">
          <button v-if="!session.recording" type="button" class="record-button" data-testid="replace-record" @click="emit('record')"><i></i>录一段新声音</button>
          <button v-else type="button" class="record-button stop" data-testid="replace-stop" @click="emit('stop')">■ 结束录音</button>
          <label>导入音频<input type="file" accept="audio/*" data-testid="replace-file" @change="($event.target as HTMLInputElement).files?.[0] && emit('importFile', ($event.target as HTMLInputElement).files![0])"></label>
        </div>
        <p v-if="session.busy">正在读取声音…</p>
      </div>

      <!-- 超过十秒：先选段 -->
      <div v-else-if="session.phase==='crop'" class="stage-card">
        <h3>选择新声音的保留片段</h3>
        <div class="timeline"><div class="timeline-fill" :style="{left:`${session.cropStart/session.duration*100||0}%`,right:`${100-(session.cropEnd/session.duration*100||0)}%`}"></div></div>
        <div class="range-pair">
          <label>起点 {{ session.cropStart.toFixed(1) }}s<input type="range" min="0" :max="Math.max(0,session.duration-.1)" step=".1" :value="session.cropStart" @input="emit('updateStart',Number(($event.target as HTMLInputElement).value))"></label>
          <label>终点 {{ session.cropEnd.toFixed(1) }}s<input type="range" :min="Math.min(session.duration,session.cropStart+.1)" :max="session.duration" step=".1" :value="session.cropEnd" @input="emit('updateEnd',Number(($event.target as HTMLInputElement).value))"></label>
        </div>
        <p class="replace-limit">片段不超过 10 秒。</p>
        <div class="replace-actions">
          <button type="button" class="ghost" @click="emit('rechoose')">← 重新选声音</button>
          <button type="button" class="acid-button" data-testid="replace-analyze" :disabled="session.busy||(session.cropEnd-session.cropStart)>10" @click="emit('analyze')">{{ session.busy?'分析中…':'分析这段新声音 →' }}</button>
        </div>
      </div>

      <!-- 分析完成：沿用原标签或接受建议 -->
      <div v-else-if="session.phase==='emotion'&&session.emotion" class="stage-card">
        <h3>新声音的分析结果</h3>
        <div class="emotion-hero"><b>{{ session.emotion.label }}</b><strong>{{ Math.round(session.emotion.confidence*100) }}%</strong><p>{{ session.emotion.explanation }}</p></div>
        <p class="replace-limit">原作品标签「{{ session.previousLabel }}」。可以沿用，也可以接受新建议。</p>
        <div class="emotion-options">
          <button v-for="label in labels" :key="label" type="button" :data-emotion="label" :class="{active:session.emotion!.label===label}" @click="emit('selectEmotion',label)">
            {{ label }}<em v-if="label===session.previousLabel">（原标签）</em><em v-else-if="label===session.suggestedLabel">（新建议）</em>
          </button>
        </div>
        <div class="replace-actions">
          <button type="button" class="ghost" @click="emit('rechoose')">← 重新选声音</button>
          <button type="button" class="acid-button" data-testid="replace-confirm" @click="emit('confirm')">确认替换</button>
        </div>
      </div>
    </section>
  </div>
</template>
