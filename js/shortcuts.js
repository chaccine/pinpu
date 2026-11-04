/* 快捷键单一配置表：键盘绑定与帮助浮层都从这里生成，保证文档与代码一致。 */
/* match(e) 判断按键，run(actions) 执行动作；keys/label 用于帮助表展示。 */

const letter = (e, ch) => !e.ctrlKey && !e.metaKey && !e.altKey
  && (e.key || '').toLowerCase() === ch;

export const SHORTCUTS = [
  { id: 'play', keys: '空格', label: '播放 / 暂停', match: (e) => e.code === 'Space', run: (a) => a.togglePlay() },
  { id: 'modes', keys: '1 – 5', label: '切换视觉模式', match: (e) => /^[1-5]$/.test(e.key), run: (a, e) => a.setMode(Number(e.key) - 1) },
  { id: 'theme', keys: 'T', label: '切换配色主题', match: (e) => letter(e, 't'), run: (a) => a.cycleTheme() },
  { id: 'fullscreen', keys: 'F', label: '全屏 / 沉浸模式', match: (e) => letter(e, 'f'), run: (a) => a.toggleFullscreen() },
  { id: 'mute', keys: 'M', label: '静音 / 取消静音', match: (e) => letter(e, 'm'), run: (a) => a.toggleMute() },
  { id: 'next', keys: 'N', label: '下一首', match: (e) => letter(e, 'n'), run: (a) => a.next() },
  { id: 'prev', keys: 'P', label: '上一首', match: (e) => letter(e, 'p'), run: (a) => a.prev() },
  { id: 'playlist', keys: 'L', label: '打开 / 关闭播放列表', match: (e) => letter(e, 'l'), run: (a) => a.togglePlaylist() },
  { id: 'loop', keys: 'S', label: '切换播放模式', match: (e) => letter(e, 's'), run: (a) => a.cycleLoop() },
  { id: 'seekBack', keys: '←', label: '快退 5 秒', match: (e) => e.key === 'ArrowLeft', run: (a) => a.seekBy(-5) },
  { id: 'seekFwd', keys: '→', label: '快进 5 秒', match: (e) => e.key === 'ArrowRight', run: (a) => a.seekBy(5) },
  { id: 'volUp', keys: '↑', label: '音量 +5%', match: (e) => e.key === 'ArrowUp', run: (a) => a.volumeBy(0.05) },
  { id: 'volDown', keys: '↓', label: '音量 −5%', match: (e) => e.key === 'ArrowDown', run: (a) => a.volumeBy(-0.05) },
  { id: 'help', keys: '? / H', label: '快捷键帮助', match: (e) => e.key === '?' || letter(e, 'h'), run: (a) => a.toggleHelp() },
];
