import { THEMES, STYLES, newPlanning, generatePlan, changeTheme, promptFor, promptsText } from './studio-v2.js';

// All user text is assigned via textContent/value; no user HTML is interpolated.
export function renderPlanner(ui) {
  const { main, project, heading, row, button, field, autosave, notice, download } = ui;
  project.planning ??= newPlanning();
  let p = project.planning;
  heading('AI ASSIST / LOCAL TEMPLATES', 'AIスタンプ企画', '画像生成用プロンプトを作成します。テンプレート方式で、アプリから生成AIは呼び出しません。');
  const intro = document.createElement('p');
  intro.className = 'note';
  intro.textContent = 'このアプリは無料・ログイン不要です。ChatGPTは別サービスで、利用にはログインやプランごとの制限がある場合があります。キャラクターの完全一致・透明背景は保証できません。画像や企画を自動送信することはありません。';
  main.append(intro);
  const form = document.createElement('section'); form.className = 'panel'; main.append(form);
  const outputs = document.createElement('section'); outputs.className = 'prompt-list';
  const update = () => { project.planning = p; autosave(); ui.progress?.(); refreshPrompts(); };
  for (const [key, label, type, max] of [
    ['name', 'キャラクター名', 'text', 80], ['appearance', '外見・特徴（必須）', 'textarea', 600],
    ['clothing', '共通の服装（任意）', 'text', 200], ['palette', '共通の配色（任意）', 'text', 200]
  ]) field(form, label, type, p[key], v => { p[key] = v; update(); }, { maxLength: max });
  function select(labelText, entries, value, fn) {
    const label = document.createElement('label'); label.textContent = labelText;
    const el = document.createElement('select');
    for (const [key, text] of entries) { const option = document.createElement('option'); option.value = key; option.textContent = text; el.append(option); }
    el.value = value; el.onchange = () => fn(el.value); label.append(el); form.append(label); return el;
  }
  select('画風', STYLES.map(s => [s, s]), p.style, v => { p.style = v; update(); });
  select('テーマ', Object.entries(THEMES).map(([k, v]) => [k, v.label]), p.theme, v => {
    p = changeTheme(p, v); phraseFields.forEach((el, i) => { el.value = p.phrases[i]; }); update();
  });
  select('背景の指定', [['transparent', '透明背景を希望（保証なし）'], ['white', '白背景']], p.background, v => { p.background = v; update(); });
  const phraseTitle = document.createElement('h2'); phraseTitle.textContent = '8種類のセリフ'; form.append(phraseTitle);
  const phraseFields = p.phrases.map((value, i) => field(form, `${String(i + 1).padStart(2, '0')} のセリフ`, 'text', value, v => { p.phrases[i] = v; update(); }, { maxLength: 100 }));
  const actions = row(form);
  actions.append(button('セリフを自動提案', () => {
    if (!confirm('編集中の8種類のセリフを、選択テーマの提案に置き換えますか？')) return;
    p.phrases = THEMES[p.theme].rows.map(r => r[0]); phraseFields.forEach((el, i) => { el.value = p.phrases[i]; }); update();
  }), button('8枚の企画を作成', () => {
    if (p.cards.length && !confirm('編集した表情・ポーズをテーマの提案に置き換えますか？セリフは保持します。')) return;
    p = generatePlan(p); project.planning = p; autosave(); ui.progress?.(); renderCards(); notice('8枚の画像生成用プロンプトを作成しました');
    outputs.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 'primary'));
  const tools = row(); let includeEnglish = false;
  const englishLabel = document.createElement('label'), english = document.createElement('input'); english.type = 'checkbox';
  english.onchange = () => { includeEnglish = english.checked; refreshPrompts(); };
  englishLabel.append(english, document.createTextNode(' 英語の指示も含める（設定・表情は原文）')); main.append(englishLabel);
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); notice('プロンプトをコピーしました。ChatGPTに手動で貼り付けてください。'); }
    catch {
      const area = document.createElement('textarea'); area.value = text; area.readOnly = true;
      area.setAttribute('aria-label', 'コピーできない場合はここから選択してください'); area.className = 'copy-fallback';
      main.append(area); area.focus(); area.select(); notice('自動コピーが利用できません。表示された文章を長押ししてコピーしてください。');
    }
  }
  tools.append(button('8枚分を一括コピー', () => copy(promptsText(p, includeEnglish))),
    button('TXTファイル保存', () => download(new Blob([promptsText(p, includeEnglish)], { type: 'text/plain;charset=utf-8' }), 'stamp-studio-prompts.txt')));
  const chat = document.createElement('a'); chat.href = 'https://chatgpt.com/'; chat.target = '_blank'; chat.rel = 'noopener noreferrer'; chat.referrerPolicy = 'no-referrer'; chat.className = 'button'; chat.textContent = 'ChatGPTを開く ↗'; tools.append(chat);
  const next = row(); next.append(button('生成した画像を取り込む →', () => { location.hash = 'images'; }, 'primary'));
  main.append(outputs);
  const promptAreas = [], promptLabels = [];
  function refreshPrompts() {
    for (const [i, area] of promptAreas.entries()) {
      promptLabels[i].textContent = `STAMP ${String(i + 1).padStart(2, '0')} · ${p.phrases[i]}`;
      try { const r = promptFor(p, i); area.value = r.ja + (includeEnglish ? '\n\n[English instructions]\n' + r.en : ''); }
      catch (error) { area.value = error.message; }
    }
  }
  function renderCards() {
    outputs.replaceChildren(); promptAreas.length = 0; promptLabels.length = 0;
    if (!p.cards.length) { const hint = document.createElement('p'); hint.textContent = '入力後「8枚の企画を作成」を押すと、ここに表情・ポーズとプロンプトを表示します。'; outputs.append(hint); return; }
    p.cards.forEach((c, i) => {
      const card = document.createElement('article'); card.className = 'panel';
      const title = document.createElement('h2'); title.textContent = `STAMP ${String(i + 1).padStart(2, '0')}`; card.append(title); promptLabels.push(title);
      field(card, '表情', 'text', c.expression, v => { c.expression = v; update(); }, { maxLength: 200 });
      field(card, 'ポーズ', 'text', c.pose, v => { c.pose = v; update(); }, { maxLength: 200 });
      const label = document.createElement('label'); label.textContent = '画像生成用プロンプト';
      const area = document.createElement('textarea'); area.readOnly = true; area.rows = 10; label.append(area); card.append(label); promptAreas.push(area);
      card.append(button(`${String(i + 1).padStart(2, '0')} のプロンプトをコピー`, () => {
        const r = promptFor(p, i); return copy(r.ja + (includeEnglish ? '\n\n[English instructions]\n' + r.en : ''));
      })); outputs.append(card);
    }); refreshPrompts();
  }
  renderCards();
}
