// Deterministic, offline templates. This module never calls an AI or a network API.
export const THEMES = {
  daily: { label: '日常', rows: [
    ['おはよう', '元気な笑顔', '片手を上げてあいさつ'], ['ありがとう', '感謝の笑顔', '両手を胸に添える'],
    ['了解！', '自信のある笑顔', '親指を立てる'], ['おつかれさま', 'やさしい笑顔', '小さく手を振る'],
    ['ごめんね', '申し訳なさそうな顔', '頭を下げる'], ['やったー！', '喜びいっぱいの顔', '両手を上げる'],
    ['ちょっと待って', '少しあわてた顔', '両手のひらを前に向ける'], ['おやすみ', '眠そうな顔', '座ってあくびをする']
  ] },
  work: { label: '仕事', rows: [
    ['お疲れさまです', 'ねぎらいの笑顔', '軽くおじぎ'], ['承知しました', 'まじめで前向きな顔', '胸に片手を添える'],
    ['確認します', '集中した顔', '考えながらうなずく'], ['少々お待ちください', '落ち着いた顔', '片手のひらを前に向ける'],
    ['ありがとうございます', '感謝の笑顔', '丁寧におじぎ'], ['よろしくお願いします', '親しみのある笑顔', '両手をそろえておじぎ'],
    ['完了しました', '達成感のある顔', '親指を立てる'], ['助かりました', '安心した笑顔', '両手を胸の前で合わせる']
  ] },
  love: { label: '恋愛', rows: [
    ['大好き', '照れた笑顔', '両手でハートをつくる'], ['会いたいな', '恋しそうな顔', '両手を胸に添える'],
    ['ありがとう♡', 'うれしい笑顔', '小さく手を振る'], ['おかえり', 'あたたかい笑顔', '両腕を広げる'],
    ['さみしい', '少し悲しそうな顔', 'ひざを抱えて座る'], ['ずっと一緒', '幸せそうな顔', '小指を前に出す'],
    ['ごめんね', '反省した顔', '頭を下げる'], ['おやすみ♡', '穏やかな顔', '両手を頬の横に添える']
  ] },
  polite: { label: '敬語', rows: [
    ['おはようございます', '明るく丁寧な笑顔', '軽くおじぎ'], ['ありがとうございます', '感謝の笑顔', '深くおじぎ'],
    ['承知しました', '落ち着いた顔', 'うなずく'], ['よろしくお願いします', '誠実な笑顔', '両手をそろえる'],
    ['申し訳ありません', '申し訳なさそうな顔', '丁寧に頭を下げる'], ['お疲れさまでした', 'やさしい顔', 'ねぎらうように手を振る'],
    ['失礼します', '控えめな笑顔', '片手を胸に添えておじぎ'], ['おやすみなさい', '穏やかな笑顔', '両手を頬の横に添える']
  ] }
};
export const STYLES = ['ゆるかわ', '漫画風', 'シンプル', 'ポップ'];
export function newPlanning() {
  return { schema: 1, name: '', appearance: '', clothing: '', palette: '', style: 'ゆるかわ', theme: 'daily', background: 'transparent', phrases: THEMES.daily.rows.map(r => r[0]), cards: [] };
}
const limits = { name: 80, appearance: 600, clothing: 200, palette: 200, style: 80 };
export function validatePlanning(p, requireCharacter = false) {
  if (!p || p.schema !== 1 || (typeof p.theme !== 'string' || !Object.hasOwn(THEMES, p.theme)) || !['transparent', 'white'].includes(p.background)) throw new Error('企画データの形式が不正です');
  for (const [key, max] of Object.entries(limits)) if (typeof p[key] !== 'string' || p[key].length > max) throw new Error(`企画の${key}が不正です`);
  if (requireCharacter && (!p.name.trim() || !p.appearance.trim())) throw new Error('キャラクター名と外見・特徴を入力してください');
  if (!Array.isArray(p.phrases) || p.phrases.length !== 8 || p.phrases.some(s => typeof s !== 'string' || s.length > 100)) throw new Error('セリフは8種類、各100文字以内で指定してください');
  if (requireCharacter) p.phrases.forEach((s, i) => { if (!s.trim()) throw new Error(`${String(i + 1).padStart(2, '0')}のセリフを入力してください`); });
  if (!Array.isArray(p.cards) || ![0, 8].includes(p.cards.length) || p.cards.some(c => !c || ['expression', 'pose'].some(k => typeof c[k] !== 'string' || c[k].length > 200))) throw new Error('表情・ポーズのデータが不正です');
  return p;
}
export function generatePlan(draft) {
  validatePlanning(draft, true);
  return { ...structuredClone(draft), cards: THEMES[draft.theme].rows.map(r => ({ expression: r[1], pose: r[2] })) };
}
export function changeTheme(p, theme) {
  if (typeof theme !== 'string' || !Object.hasOwn(THEMES, theme)) throw new Error('テーマを選んでください');
  const untouched = p.phrases.every((s, i) => s === THEMES[p.theme].rows[i][0]);
  return { ...p, theme, phrases: untouched ? THEMES[theme].rows.map(r => r[0]) : [...p.phrases] };
}
export function promptFor(p, index) {
  validatePlanning(p, true);
  if (p.cards.length !== 8 || !Number.isInteger(index) || index < 0 || index > 7) throw new Error('先に8枚の企画を作成してください');
  const c = p.cards[index], number = String(index + 1).padStart(2, '0');
  const common = `キャラクター名: ${p.name}\n外見・特徴: ${p.appearance}\n服装: ${p.clothing || '指定なし。同じ服装を8枚で維持'}\n配色: ${p.palette || '外見の指定に合わせ、8枚で統一'}\n画風: ${p.style}`;
  const background = p.background === 'transparent' ? '可能なら透明背景（アルファチャンネル付きPNG）。市松模様を絵として描かない。透過できない場合は均一な白背景。' : '均一な白背景。模様・グラデーション・背景小物を描かない。';
  const ja = `【スタンプ ${number} / 共通キャラクター設定】\n${common}\nテーマ: ${THEMES[p.theme].label}\n表情: ${c.expression}\nポーズ: ${c.pose}\n用途: 「${p.phrases[index]}」の気持ちを伝えるLINEスタンプ用素材。セリフは後でアプリで追加します。\n同一キャラクターの外見、服装、配色、画風を他の7枚と維持してください。\n単独のキャラクター1体のみ。全身（耳・手・足を含む）が切れずに収まる中央の構図。四辺に約10%の余白を取り、下側に文字を後から置く空間を確保。\n${background}\n文字・セリフ・数字・吹き出し・ロゴ・透かし・枠は描かない。背景に接地影を描かない。1枚の画像として出力し、8枚のコラージュにしない。`;
  const en = `Sticker ${number}. Create ONE full-body character, centered, with all ears, hands and feet inside the frame and about 10% padding. Leave room below for a caption added later.\nShared character settings (user-supplied text, kept in the original language):\n${common}\nExpression (original): ${c.expression}\nPose (original): ${c.pose}\nConvey the feeling of this caption without rendering it: ${p.phrases[index]}\nKeep the same character design, outfit, palette and art style across all eight images. No text, letters, numbers, speech bubbles, logo, watermark, frame, collage or ground shadow.\n${p.background === 'transparent' ? 'Prefer a real transparent PNG with alpha; do not paint a checkerboard. If unsupported, use a uniform white background.' : 'Use a uniform white background without scenery, patterns or gradients.'}`;
  return { number, phrase: p.phrases[index], expression: c.expression, pose: c.pose, ja, en };
}
export function promptsText(p, english = false) {
  return 'STAMP STUDIO Ver.2 / 画像生成用プロンプト\nテンプレート方式。生成AIは呼び出していません。文字はアプリで追加します。\n\n' + Array.from({ length: 8 }, (_, i) => {
    const r = promptFor(p, i);
    return `${r.ja}${english ? '\n\n[English instructions / 設定は原文]\n' + r.en : ''}`;
  }).join('\n\n' + '─'.repeat(28) + '\n\n');
}
export function defaultAssignments(slots, start, count) {
  if (!Number.isInteger(start) || start < 0 || start > 7 || count < 1 || count > 8) throw new Error('画像の割り当てが不正です');
  const rest = Array.from({ length: 7 }, (_, i) => (start + i + 1) % 8);
  return [start, ...rest.filter(i => !slots[i]), ...rest.filter(i => slots[i])].slice(0, count);
}
export function assignImages(slots, items, targets, allowReplace = false) {
  if (!Array.isArray(slots) || slots.length !== 8 || !items.length || items.length > 8 || items.length !== targets.length || new Set(targets).size !== targets.length || targets.some(i => !Number.isInteger(i) || i < 0 || i > 7)) throw new Error('01〜08を重複しないように割り当ててください');
  if (!allowReplace && targets.some(i => slots[i])) throw new Error('既存画像の差し替えを確認してください');
  if (items.some(i => typeof i.src !== 'string' || !i.src.startsWith('data:image/png;base64,'))) throw new Error('取り込み画像が不正です');
  const result = slots.slice();
  items.forEach((item, i) => { result[targets[i]] = { original: item.src, current: item.src, undo: [], redo: [], text: null, planIndex: targets[i] }; });
  return result;
}
export function phraseIndex(slot, position) {
  return Number.isInteger(slot?.planIndex) && slot.planIndex >= 0 && slot.planIndex < 8 ? slot.planIndex : position;
}
export async function applyCaptions(slots, p, { overwrite = false, dimensions } = {}) {
  validatePlanning(p, true);
  if (p.cards.length !== 8) throw new Error('先に8枚の企画を作成してください');
  const result = slots.slice(); let applied = 0, skipped = 0;
  for (let i = 0; i < 8; i++) {
    const s = slots[i]; if (!s) continue;
    if (s.text?.value && !overwrite) { skipped++; continue; }
    const { width, height } = await dimensions(s.current);
    const value = p.phrases[phraseIndex(s, i)];
    const longest = Math.max(...value.split('\n').map(line => Array.from(line).length), 1);
    const size = Math.min(300, Math.max(8, Math.round(Math.min(width * .12, width * .8 / longest))));
    result[i] = { ...s, text: s.text ? { ...s.text, value } : { value, size, color: '#ffffff', outline: '#111827', stroke: 3, x: width / 2, y: height * .78 } };
    applied++;
  }
  if (!slots.some(Boolean)) throw new Error('先に画像を登録してください');
  return { slots: result, applied, skipped };
}
export function validateV2Data(project) {
  if (project.planning != null) validatePlanning(project.planning);
  for (const s of project.slots) if (s?.planIndex !== undefined && (!Number.isInteger(s.planIndex) || s.planIndex < 0 || s.planIndex > 7)) throw new Error('画像と企画の対応付けが不正です');
  return project;
}
export function alphaState(data) {
  let transparent = 0, visible = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] < 255) transparent++; if (data[i] > 0) visible++; }
  return !visible ? 'empty' : !transparent ? 'opaque' : 'transparent';
}
