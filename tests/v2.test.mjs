import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { THEMES, newPlanning, validatePlanning, generatePlan, changeTheme, promptFor, promptsText, defaultAssignments, assignImages, phraseIndex, applyCaptions, validateV2Data, alphaState } from '../studio-v2.js';
import { validateProject, removeBackground, brush } from '../core.js';
import { renderPlanner } from '../planner-view.js';
import { renderImportReview, renderWorkflow, renderFinish } from '../workflow-view.js';
import { harness, Element } from './support/dom.mjs';
const fixture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNImXbiPwAF5gLCP3lq6QAAAABJRU5ErkJggg==';
const slots = () => Array(8).fill(null);
const draft = () => ({ ...newPlanning(), name: 'もちねこ', appearance: '白い丸顔、青い目、短いしっぽ', clothing: '赤いリボン', palette: '白と赤と青' });
const planned = () => generatePlan(draft());
const project = () => ({ version: 1, name: '作品', id: 'legacy-project', slots: slots(), main: 0, tab: 0 });
const filled = () => assignImages(slots(), Array.from({ length: 8 }, () => ({ src: fixture })), Array.from({ length: 8 }, (_, i) => i));
const dimensions = async () => ({ width: 600, height: 500 });

for (const theme of Object.keys(THEMES)) test(`${theme}: exactly eight deterministic, editable plans and prompts`, () => {
  const input = { ...draft(), theme, phrases: THEMES[theme].rows.map(r => r[0]) };
  const p = generatePlan(input);
  assert.equal(p.cards.length, 8); assert.equal(new Set(p.phrases).size, 8);
  assert.deepEqual(generatePlan(input), p); assert.equal(input.cards.length, 0);
  for (let i = 0; i < 8; i++) {
    const r = promptFor(p, i); assert.equal(r.number, String(i + 1).padStart(2, '0'));
    for (const common of [p.name, p.appearance, p.clothing, p.palette, p.style]) assert.ok(r.ja.includes(common));
    assert.ok(r.ja.includes('全身')); assert.ok(r.ja.includes('余白')); assert.ok(r.ja.includes('文字・セリフ・数字'));
    assert.ok(r.ja.includes('キャラクター1体')); assert.ok(r.en.includes('No text'));
  }
});
test('manual phrase/expression changes are reflected without stale prompts', () => {
  const p = planned(); p.phrases[2] = '明日もよろしく'; p.cards[2].expression = 'にっこり'; p.cards[2].pose = '片手を振る';
  const r = promptFor(p, 2); assert.ok(r.ja.includes('明日もよろしく')); assert.equal(r.expression, 'にっこり');
  p.name = '新しい名前'; assert.ok(promptFor(p, 2).ja.includes('新しい名前'));
});
test('theme updates untouched suggestions, preserves manual captions', () => {
  let p = changeTheme(draft(), 'work'); assert.deepEqual(p.phrases, THEMES.work.rows.map(r => r[0]));
  p.phrases[0] = '手入力'; p = changeTheme(p, 'love'); assert.equal(p.phrases[0], '手入力');
});
test('white background differs from transparent preference without claiming guarantees', () => {
  const p = planned(); assert.ok(promptFor(p, 0).ja.includes('可能なら透明背景'));
  p.background = 'white'; assert.ok(promptFor(p, 0).ja.includes('均一な白背景')); assert.ok(!promptFor(p, 0).en.includes('Prefer a real transparent'));
});
test('TXT contains eight numbered prompts and optional English, no AI-generated claim', () => {
  const text = promptsText(planned(), true);
  assert.equal((text.match(/【スタンプ \d{2}/g) || []).length, 8);
  assert.equal((text.match(/English instructions/g) || []).length, 8);
  assert.ok(text.includes('生成AIは呼び出していません'));
});
test('required character, empty captions, hostile theme keys and malformed drafts are rejected', () => {
  assert.throws(() => generatePlan(newPlanning()), /キャラクター名/);
  const p = draft(); p.phrases[3] = ''; assert.throws(() => generatePlan(p), /04/);
  for (const theme of ['constructor', '__proto__', [], null]) assert.throws(() => validatePlanning({ ...draft(), theme }));
  assert.throws(() => validatePlanning({ ...draft(), phrases: ['wrong'] }));
  assert.throws(() => validatePlanning({ ...draft(), appearance: '長'.repeat(601) }));
});
test('eight assignments, duplicate prevention and replacement permission are atomic', () => {
  const before = slots(); const items = Array.from({ length: 8 }, () => ({ src: fixture }));
  const targets = defaultAssignments(before, 0, 8);
  assert.deepEqual(targets, [0,1,2,3,4,5,6,7]);
  assert.throws(() => assignImages(before, items, [0,0,2,3,4,5,6,7]), /重複/);
  assert.deepEqual(before, slots());
  const after = assignImages(before, items, targets); assert.ok(after.every(Boolean));
  for (let i = 0; i < 8; i++) { assert.equal(after[i].planIndex, i); assert.equal(after[i].original, fixture); }
  assert.throws(() => assignImages(after, [{ src: fixture }], [0]), /差し替え/);
  assert.equal(assignImages(after, [{ src: fixture }], [0], true)[1], after[1]);
  assert.equal(after[0].text, null);
});
test('default targets favor unused slots and image/phrase correspondence survives reorder', () => {
  const s = filled(); s[1] = null; s[5] = null;
  assert.deepEqual(defaultAssignments(s, 0, 3), [0,1,5]);
  const a = filled(); [a[0], a[7]] = [a[7], a[0]];
  assert.equal(phraseIndex(a[0], 0), 7);
});
test('bulk captions apply eight phrases and preserve source pixels/history', async () => {
  const s = filled(), p = planned(); const snapshot = structuredClone(s);
  const result = await applyCaptions(s, p, { dimensions });
  assert.equal(result.applied, 8); assert.equal(result.skipped, 0); assert.deepEqual(s, snapshot);
  result.slots.forEach((slot, i) => {
    assert.equal(slot.text.value, p.phrases[i]); assert.equal(slot.current, fixture); assert.equal(slot.original, fixture);
    assert.deepEqual(slot.undo, []); assert.ok(slot.text.size >= 8 && slot.text.size <= 300);
  });
});
test('existing individual text is kept by default; opt-in changes only text value', async () => {
  let s = (await applyCaptions(filled(), planned(), { dimensions })).slots;
  s[0].text = { value: '手動編集', x: 30, y: 40, size: 18, color: '#123456', outline: '#ffffff', stroke: 1 };
  const r = await applyCaptions(s, planned(), { dimensions }); assert.equal(r.applied, 0); assert.equal(r.skipped, 8);
  assert.equal(r.slots[0].text.value, '手動編集');
  const replaced = await applyCaptions(s, planned(), { overwrite: true, dimensions });
  assert.equal(replaced.slots[0].text.value, 'おはよう');
  assert.deepEqual({ ...replaced.slots[0].text, value: '手動編集' }, s[0].text);
});
test('failed caption dimension decode never mutates the original project', async () => {
  const s = filled(), copy = structuredClone(s); let n = 0;
  await assert.rejects(applyCaptions(s, planned(), { dimensions: async () => { if (++n === 3) throw new Error('decode failure'); return dimensions(); } }), /decode failure/);
  assert.deepEqual(s, copy);
});
test('bulk caption mapping follows the assigned plan, including reordered images', async () => {
  const s = filled(); [s[0], s[7]] = [s[7], s[0]];
  const r = await applyCaptions(s, planned(), { dimensions }); assert.equal(r.slots[0].text.value, 'おやすみ');
});
test('legacy and Ver.2 backup schemas both validate without modifying original data', () => {
  const legacy = project(); legacy.slots = filled(); delete legacy.slots[0].planIndex;
  const before = JSON.stringify(legacy); assert.equal(validateV2Data(validateProject(legacy)), legacy); assert.equal(JSON.stringify(legacy), before);
  const v2 = { ...structuredClone(legacy), planning: planned() };
  const restored = validateV2Data(validateProject(JSON.parse(JSON.stringify(v2)))); assert.deepEqual(restored.planning, v2.planning);
  assert.equal(restored.version, 1); assert.equal(restored.id, legacy.id);
  restored.slots[0].planIndex = 42; assert.throws(() => validateV2Data(restored), /対応付け/);
});
test('transparency preflight distinguishes fully transparent, opaque and cutout images', () => {
  assert.equal(alphaState(new Uint8ClampedArray([0,0,0,0])), 'empty');
  assert.equal(alphaState(new Uint8ClampedArray([255,255,255,255])), 'opaque');
  assert.equal(alphaState(new Uint8ClampedArray([255,255,255,128])), 'transparent');
  assert.equal(alphaState(new Uint8ClampedArray([255,255,255,255,0,0,0,0])), 'transparent');
});
test('existing background removal keeps enclosed white character and original transparency', () => {
  const image = { width: 5, height: 5, data: new Uint8ClampedArray(100).fill(255) };
  for (const i of [6,7,8,11,13,16,17,18]) image.data.set([0,0,0,255], i*4);
  image.data[3] = 0; const original = structuredClone(image);
  removeBackground(image, [255,255,255], 0, true);
  assert.equal(image.data[3], 0); assert.equal(image.data[12*4+3], 255); assert.equal(image.data[4*4+3], 0);
  brush(image, original, 4, 0, 1, true); assert.equal(image.data[4*4+3], 255);
});

test('planner view: generate, per-card/all copy, TXT download and explicit ChatGPT link', async () => {
  const p = project(); p.planning = draft(); const ui = harness(p);
  try {
    renderPlanner(ui); ui.findButton('8枚の企画を作成').onclick();
    assert.equal(p.planning.cards.length, 8);
    await ui.findButton('01 のプロンプトをコピー').onclick(); assert.ok(ui.copied[0].includes('スタンプ 01'));
    await ui.findButton('8枚分を一括コピー').onclick(); assert.equal((ui.copied[1].match(/【スタンプ /g)||[]).length, 8);
    ui.findButton('TXTファイル保存').onclick(); assert.equal(ui.downloads[0].name, 'stamp-studio-prompts.txt');
    assert.ok((await ui.downloads[0].blob.text()).includes('もちねこ'));
    const a = ui.all('a')[0]; assert.equal(a.href, 'https://chatgpt.com/'); assert.equal(a.referrerPolicy, 'no-referrer');
    assert.equal(a.rel, 'noopener noreferrer'); assert.ok(ui.saves()>0);
  } finally { ui.close(); }
});
test('planner manual text is safely rendered and updates prompts/clipboard', async () => {
  const p=project();p.planning=planned();const ui=harness(p);
  try {
    renderPlanner(ui);const field=ui.fieldFor('01 のセリフ');field.value='<img src=x onerror=alert(1)>';field.oninput();
    await ui.findButton('01 のプロンプトをコピー').onclick();assert.ok(ui.copied[0].includes(field.value));
    assert.equal(ui.all('img').length,0);
  } finally {ui.close();}
});
test('clipboard denial provides a selectable manual fallback', async () => {
  const p=project();p.planning=planned();const ui=harness(p);
  try {
    navigator.clipboard.writeText=async()=>{throw new Error('permission denied');};renderPlanner(ui);
    await ui.findButton('01 のプロンプトをコピー').onclick();
    assert.ok(ui.all('textarea').some(el=>el.className==='copy-fallback'&&el.selected));
  } finally {ui.close();}
});
test('import view requires confirmation and rejects duplicate choices without mutating project', async () => {
  const p=project();p.planning=planned();const ui=harness(p);let committed=null;
  const pending={start:0,items:Array.from({length:8},(_,i)=>({name:`${i+1}.png`,src:fixture}))};
  try {
    renderImportReview(ui,pending,async next=>{committed=next;},()=>{});
    assert.equal(p.slots.filter(Boolean).length,0);assert.equal(ui.all('img').length,8);
    pending.targets[1]=0;await assert.rejects(ui.findButton('この割り当てで登録').onclick(),/重複/);assert.equal(committed,null);
    pending.targets[1]=1;await ui.findButton('この割り当てで登録').onclick();assert.equal(committed.filter(Boolean).length,8);
  } finally {ui.close();}
});
test('finish view applies planned text and links to existing background/text editors', async () => {
  const p=project();p.planning=planned();p.slots=filled();const ui=harness(p);const routes=[];
  try {
    Object.assign(ui,{loadImage:dimensions,compose:async()=>({toDataURL:()=>fixture}),isCurrent:()=>true,rerender:async()=>{},navigateEditor:(i,r)=>routes.push([i,r])});
    await renderFinish(ui);assert.equal(ui.all('img').length,8);
    await ui.findButton('セリフの文字入れを一括適用').onclick();assert.equal(p.slots[0].text.value,'おはよう');
    ui.findButton('背景を調整').onclick();assert.deepEqual(routes,[[0,'edit']]);
    ui.findButton('文字を調整').onclick();assert.deepEqual(routes[1],[0,'text']);
  } finally {ui.close();}
});
test('finish save failure restores original in-memory slots', async () => {
  const p=project();p.planning=planned();p.slots=filled();const before=p.slots;const ui=harness(p);
  try {
    Object.assign(ui,{loadImage:dimensions,compose:async()=>({toDataURL:()=>fixture}),isCurrent:()=>true,save:async()=>{throw new Error('quota');},rerender:async()=>{},navigateEditor:()=>{}});
    await renderFinish(ui);await assert.rejects(ui.findButton('セリフの文字入れを一括適用').onclick(),/quota/);assert.equal(p.slots,before);
  } finally {ui.close();}
});
test('workflow shows seven real actions and does not claim ChatGPT task completion', () => {
  const ui=harness(project());try {
    const root=new Element('section');renderWorkflow(root,'plan',ui.project);
    const actions=[...root.walk()].filter(e=>e.tagName==='a');assert.equal(actions.length,7);
    assert.equal(actions[2].href,'https://chatgpt.com/');assert.ok([...root.walk()].some(e=>e.textContent.includes('手動操作')));
  } finally {ui.close();}
});
test('database schema and PWA identity are unchanged; every new runtime module is precached', () => {
  const read=n=>fs.readFileSync(new URL('../'+n,import.meta.url),'utf8');
  assert.match(read('db.js'),/indexedDB.open\('stamp-studio',1\)/);
  const m=JSON.parse(read('manifest.json'));assert.equal(m.id,'/-stamp-studio/');assert.equal(m.display,'standalone');
  for(const file of ['studio-v2.js','planner-view.js','workflow-view.js'])assert.ok(read('sw.js').includes(`'./${file}'`));
  for(const file of ['studio-v2.js','planner-view.js','workflow-view.js'])assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(read(file)));
});
test('bundled JSZip generates ten PNG entries, round-trips with CRC, and writes interoperability fixture', async () => {
  const module={exports:{}};
  const context={module,exports:module.exports,require:createRequire(import.meta.url),Buffer,Uint8Array,ArrayBuffer,setImmediate,clearImmediate,setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(new URL('../vendor/jszip.min.js',import.meta.url),'utf8'),context);
  const JSZip=module.exports,zip=new JSZip();
  const names=[...Array.from({length:8},(_,i)=>`${String(i+1).padStart(2,'0')}.png`),'main.png','tab.png'];
  for(const name of names)zip.file(name,Buffer.from(fixture.split(',')[1],'base64'));
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const restored=await JSZip.loadAsync(bytes,{checkCRC32:true});
  assert.deepEqual(Object.keys(restored.files),names);
  for(const name of names)assert.deepEqual(await restored.file(name).async('nodebuffer'),Buffer.from(fixture.split(',')[1],'base64'));
  const dir=new URL('../test-results/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(new URL('zip-smoke.zip',dir),bytes);
});
