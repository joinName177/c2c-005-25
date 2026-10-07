import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import MemeGallery from '../components/MemeGallery.vue';
import type { StudioDependencies } from '../useStudio';
import type { VoiceMeme } from '../../core/models';

function deps(options: { denied?: boolean } = {}): StudioDependencies {
  const works: VoiceMeme[] = [];
  return {
    recorder:{isRecording:false,start:async()=>{if(options.denied)throw new DOMException('denied','NotAllowedError')},stop:async()=>new Blob(['voice'],{type:'audio/webm'})},
    analyzer:{analyze:async()=>({duration:2,features:{loudness:.75,dynamics:.55,pitch:.8,zeroCrossing:.62,pauseRatio:.12,tempoVariation:.6}})},
    cropper:{inspect:async()=>({duration:2,needsCrop:false}),crop:async(blob,range)=>({blob,duration:range.end-range.start})},
    renderer:{render:async()=>new Blob(['cover'],{type:'image/png'})},
    repository:{list:async()=>works,save:async(m)=>{works.push(m)},rename:async()=>{},delete:async(id)=>{const i=works.findIndex(w=>w.id===id);if(i>=0)works.splice(i,1)}},
    share:{share:async()=> 'shared'},
  };
}

describe('Voice meme App', () => {
  it('shows the studio stages, time limit and sharing disclosure', () => {
    const wrapper = mount(App,{props:{dependencies:deps()}});
    expect(wrapper.text()).toContain('声音表情包工坊');
    expect(wrapper.text()).toContain('00:10 MAX');
    expect(wrapper.text()).toContain('分享链接不包含原始声音');
  });
  it('shows a recoverable microphone permission error', async () => {
    const wrapper=mount(App,{props:{dependencies:deps({denied:true})}}); await wrapper.get('[data-testid="record"]').trigger('click'); await Promise.resolve();
    expect(wrapper.text()).toContain('麦克风权限');
  });
  it('creates, labels, edits and saves a work to the gallery', async () => {
    const wrapper=mount(App,{props:{dependencies:deps()}}); await wrapper.get('[data-testid="record"]').trigger('click'); await wrapper.get('[data-testid="stop"]').trigger('click'); await Promise.resolve();
    await wrapper.get('[data-testid="analyze"]').trigger('click'); await Promise.resolve(); await wrapper.get('[data-emotion="温柔姐姐"]').trigger('click'); expect(wrapper.text()).toContain('已手动选择');
    await wrapper.get('[data-testid="to-cover"]').trigger('click'); await wrapper.get('[aria-label="气泡文字"]').setValue('轻轻说一句'); await wrapper.get('[data-testid="save-work"]').trigger('click'); await Promise.resolve(); await Promise.resolve();
    expect(wrapper.text()).toContain('作品集'); expect(wrapper.text()).toContain('我的声音表情');
  });
  it('replaces the voice of a saved work while keeping title and handwritten bubble', async () => {
    const instance = deps();
    const wrapper = mount(App, { props: { dependencies: instance } });
    // 先保存一个作品
    await wrapper.get('[data-testid="record"]').trigger('click');
    await wrapper.get('[data-testid="stop"]').trigger('click');
    await Promise.resolve();
    await wrapper.get('[data-testid="analyze"]').trigger('click');
    await Promise.resolve();
    await wrapper.get('[data-testid="to-cover"]').trigger('click');
    await wrapper.get('[aria-label="气泡文字"]').setValue('老气泡');
    await wrapper.get('[data-testid="save-work"]').trigger('click');
    await Promise.resolve(); await Promise.resolve();
    // 进入编辑，打开替换浮层
    await wrapper.get('.work-card footer button').trigger('click');
    expect(wrapper.text()).toContain('替换声音');
    await wrapper.get('[data-testid="open-replace-voice"]').trigger('click');
    expect(wrapper.find('[data-testid="voice-replace"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('作品名称和手写气泡会原样保留');
    // 模拟选文件：替身默认时长 2s，直接进入选段
    const input = wrapper.get('[data-testid="replace-file"]').element as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['new-voice'], 'new.webm', { type: 'audio/webm' })] });
    await input.dispatchEvent(new Event('change'));
    await Promise.resolve(); await Promise.resolve();
    await wrapper.get('[data-testid="replace-analyze"]').trigger('click');
    await Promise.resolve(); await Promise.resolve();
    expect(wrapper.text()).toContain('原作品标签');
    // 取消不应改动作品
    await wrapper.get('[data-testid="replace-cancel"]').trigger('click');
    expect(wrapper.find('[data-testid="voice-replace"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('仍使用原来的声音');
    // 再次替换并确认
    await wrapper.get('[data-testid="open-replace-voice"]').trigger('click');
    const input2 = wrapper.get('[data-testid="replace-file"]').element as HTMLInputElement;
    Object.defineProperty(input2, 'files', { configurable: true, value: [new File(['new-voice-2'], 'new2.webm', { type: 'audio/webm' })] });
    await input2.dispatchEvent(new Event('change'));
    await Promise.resolve(); await Promise.resolve();
    await wrapper.get('[data-testid="replace-analyze"]').trigger('click');
    await Promise.resolve(); await Promise.resolve();
    await wrapper.get('[data-testid="replace-confirm"]').trigger('click');
    expect(wrapper.text()).toContain('声音与分析依据已替换');
    // 名称默认、手写气泡仍在
    expect((wrapper.get('[aria-label="气泡文字"]').element as HTMLTextAreaElement).value).toBe('老气泡');
    await wrapper.get('[data-testid="save-work"]').trigger('click');
    await Promise.resolve(); await Promise.resolve();
    expect(wrapper.text()).toContain('声音替换');
  });
  it('shows unknown provenance honestly instead of guessing', async () => {
    const works: VoiceMeme[] = [{ id:'legacy', title:'老作品', emotion:'温柔姐姐' as const, confidence:.7, features:{loudness:0,dynamics:0,pitch:0,zeroCrossing:0,pauseRatio:0,tempoVariation:0}, audio:new Blob(['x']), duration:1, cover:new Blob(['c']), coverConfig:{ label:'温柔姐姐',title:'老作品',bubbleText:'b',bubbleX:1,bubbleY:1,palette:['#a','#b','#c'],filter:'none',ratio:'square' }, createdAt:'2020-01-01' }];
    const gallery = mount(MemeGallery, { props: { items: works } });
    expect(gallery.text()).toContain('来源未知');
    expect(gallery.text()).not.toContain('原始录音');
  });
});
