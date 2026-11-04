/* LRC 解析器 Node 单元测试：通过 data: URL 直接 import，覆盖时间戳/元信息/offset/排序/边界。 */
/* 运行： node test/lrc_node_test.mjs   （由 run_all.py 静态检查调用） */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'lyrics', 'lrc.js'));
const mod = await import('data:text/javascript;base64,' + src.toString('base64'));
const { parseLRC, findLineIndex } = mod;

let failed = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label} ${extra}`); failed++; }
}

// ---- 基本解析 + 元信息 ----
const basic = parseLRC('[ti:测试标题]\n[ar:测试歌手]\n[al:测试专辑]\n[00:01.50]第一行\n[00:02.75]第二行');
check('元信息 ti', basic.meta.ti === '测试标题', basic.meta.ti);
check('元信息 ar/al', basic.meta.ar === '测试歌手' && basic.meta.al === '测试专辑', JSON.stringify(basic.meta));
check('基本时间 1.50s', basic.lines.length === 2 && basic.lines[0].time === 1.5, JSON.stringify(basic.lines[0]));
check('秒+三位毫秒 2.750s', basic.lines[1] && basic.lines[1].time === 2.75, JSON.stringify(basic.lines[1]));
check('歌词文本', basic.lines[0] && basic.lines[0].text === '第一行', basic.lines[0] && basic.lines[0].text);

// ---- 一行多个时间戳 ----
const multi = parseLRC('[00:10.00][01:20.500]副歌');
check('多时间戳行数', multi.lines.length === 2, String(multi.lines.length));
check('多时间戳时间', multi.lines[0].time === 10 && multi.lines[1].time === 80.5, JSON.stringify(multi.lines));
check('多时间戳文本去标签', multi.lines.every((l) => l.text === '副歌'), JSON.stringify(multi.lines));

// ---- offset：正值提前、负值延后，最后一条生效 ----
const plus = parseLRC('[offset:+500]\n[00:02.00]提前');
check('正 offset 提前 0.5s', plus.lines[0] && plus.lines[0].time === 1.5, JSON.stringify(plus.lines[0]));
const minus = parseLRC('[offset:-500]\n[00:02.00]延后');
check('负 offset 延后 0.5s', minus.lines[0] && minus.lines[0].time === 2.5, JSON.stringify(minus.lines[0]));
const lastOffset = parseLRC('[offset:+200]\n[00:02.00]A\n[offset:+1000]');
check('多条 offset 取最后', lastOffset.meta.offset === 1000 && lastOffset.lines[0].time === 1,
      `${lastOffset.meta.offset}/${lastOffset.lines[0] && lastOffset.lines[0].time}`);
check('offset 不会得到负时间', parseLRC('[offset:+5000]\n[00:01.00]A').lines[0].time === 0);

// ---- 毫秒位数：.5 / .50 / .500 等价，.05 更小 ----
const frac = parseLRC('[00:01]无小数\n[00:02.5]一位\n[00:03.50]两位\n[00:04.500]三位\n[00:05.05]两位零头');
check('无小数', frac.lines[0].time === 1, String(frac.lines[0].time));
check('一位小数=.5s', frac.lines[1].time === 2.5, String(frac.lines[1].time));
check('两位小数=.50s', frac.lines[2].time === 3.5, String(frac.lines[2].time));
check('三位小数=.500s', frac.lines[3].time === 4.5, String(frac.lines[3].time));
check('两位零头=.05s', frac.lines[4].time === 5.05, String(frac.lines[4].time));

// ---- 未排序输入按时间排序，相同时间保持原始顺序 ----
const sorted = parseLRC('[00:05.00]E\n[00:01.00]A\n[00:03.00]C\n[00:03.00]D');
check('按时间排序', sorted.lines.map((l) => l.text).join('') === 'ACDE',
      sorted.lines.map((l) => l.text).join(''));
check('相同时间稳定', sorted.lines[1].text === 'C' && sorted.lines[2].text === 'D',
      JSON.stringify(sorted.lines.map((l) => l.text)));

// ---- 无效行 / 空行 / BOM / CRLF ----
const invalid = parseLRC('随便一行\n[aa:bb]坏\n[00:--]坏\n[00:01.00]   \n[offset:0]');
check('无效行与空文本忽略', invalid.lines.length === 0 && invalid.meta.offset === 0,
      JSON.stringify(invalid));
const crlf = parseLRC('\uFEFF[ti:BOM]\r\n\r\n[00:01.00]甲\r\n[00:02.00]乙\r\n');
check('BOM/CRLF 兼容', crlf.meta.ti === 'BOM' && crlf.lines.length === 2
      && crlf.lines[0].text === '甲' && crlf.lines[1].text === '乙', JSON.stringify(crlf.meta));
const empty = parseLRC('');
check('空输入返回默认结构', empty.lines.length === 0 && empty.meta.ti === ''
      && empty.meta.ar === '' && empty.meta.al === '' && empty.meta.offset === 0, JSON.stringify(empty));
check('null 输入不抛异常', parseLRC(null).lines.length === 0);

// ---- findLineIndex 边界 ----
const idxLines = parseLRC('[00:01.00]A\n[00:02.00]B\n[00:03.00]C').lines;
check('早于首行返回 -1', findLineIndex(idxLines, 0.99) === -1, String(findLineIndex(idxLines, 0.99)));
check('命中首行', findLineIndex(idxLines, 1) === 0, String(findLineIndex(idxLines, 1)));
check('两行之间取前一行', findLineIndex(idxLines, 1.999) === 0, String(findLineIndex(idxLines, 1.999)));
check('命中中间行', findLineIndex(idxLines, 2) === 1, String(findLineIndex(idxLines, 2)));
check('超过末行取最后一行', findLineIndex(idxLines, 99) === 2, String(findLineIndex(idxLines, 99)));
check('空数组返回 -1', findLineIndex([], 1) === -1 && findLineIndex(null, 1) === -1);

process.exit(failed ? 1 : 0);
