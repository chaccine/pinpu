/* ID3 解析器 Node 单元测试：读取 test/fixtures 下的样本，校验中文标题/歌手/封面与损坏容错。 */
/* 运行： node test/id3_node_test.mjs   （由 run_all.py 在阶段5调用） */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'audio', 'id3.js'));
const mod = await import('data:text/javascript;base64,' + src.toString('base64'));
const { parseTags } = mod;

function blob(name) {
  const buf = readFileSync(join(here, 'fixtures', name));
  return new Blob([buf]);
}

let failed = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  [PASS] ${label}`);
  else { console.log(`  [FAIL] ${label} ${extra}`); failed++; }
}

const v23 = await parseTags(blob('id3v23_cn.mp3'));
check('v2.3 标题', v23 && v23.title === '霓虹夜行', JSON.stringify(v23 && v23.title));
check('v2.3 歌手', v23 && v23.artist === '星轨乐队', JSON.stringify(v23 && v23.artist));
check('v2.3 专辑', v23 && v23.album === '测试专辑', JSON.stringify(v23 && v23.album));
check('v2.3 封面存在', !!(v23 && v23.picture && v23.picture.bytes.length > 0));
check('v2.3 封面mime', !!(v23 && v23.picture && /image\/(png|jpeg)/.test(v23.picture.mime)), v23 && v23.picture && v23.picture.mime);

const v24 = await parseTags(blob('id3v24_utf8.mp3'));
check('v2.4 标题', v24 && v24.title === '极光之下', JSON.stringify(v24 && v24.title));
check('v2.4 歌手', v24 && v24.artist === '陈绮萱', JSON.stringify(v24 && v24.artist));
check('v2.4 封面存在', !!(v24 && v24.picture && v24.picture.bytes.length > 0));

const notag = await parseTags(blob('notag.mp3'));
check('无标签返回空/不崩', notag === null || (notag.title === '' && notag.artist === ''), JSON.stringify(notag));

const corrupt = await parseTags(blob('corrupt.mp3'));
check('损坏文件不抛异常', true, JSON.stringify(corrupt && corrupt.title));

process.exit(failed ? 1 : 0);
