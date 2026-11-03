import { defaultAssignments, assignImages, phraseIndex, applyCaptions } from './studio-v2.js';

export function renderWorkflow(container, page, project) {
  container.replaceChildren();
  const steps = [['plan', '企画'], ['plan', 'コピー'], ['chat', 'ChatGPTで生成'], ['images', '画像取込'], ['finish', '自動仕上げ'], ['preview', '確認'], ['export', 'ZIP保存']];
  const list = document.createElement('ol'); list.className = 'workflow-steps';
  for (const [i, [target, title]] of steps.entries()) {
    const li = document.createElement('li'), a = document.createElement('a');
    a.textContent = `${i + 1}. ${title}`; a.href = target === 'chat' ? 'https://chatgpt.com/' : `#${target}`;
    if (target === 'chat') { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; a.title = '別サービスへ手動で移動します'; }
    if ((page === target && (target !== 'plan' || i === 0)) || (['edit', 'text'].includes(page) && target === 'finish')) a.setAttribute('aria-current', 'step');
    li.append(a); list.append(li);
  }
  const status = document.createElement('p'); status.className = 'caption';
  status.textContent = `企画 ${project?.planning?.cards.length === 8 ? '8/8' : '未作成'} · 画像 ${project?.slots.filter(Boolean).length || 0}/8 · 文字 ${project?.slots.filter(s => s?.text?.value).length || 0}/8 ｜ ChatGPTでの生成は手動操作です`;
  container.append(list, status);
}

export function renderImportReview(ui, pending, onCommit, onCancel) {
  const { main, project, row, button } = ui;
  const panel = document.createElement('section'); panel.className = 'panel import-review';
  panel.setAttribute('aria-label', '取り込み先の確認');
  const title = document.createElement('h2'); title.textContent = '画像と01〜08の割り当てを確認'; panel.append(title);
  const desc = document.createElement('p'); desc.textContent = 'まだ登録していません。番号とセリフを確認して「この割り当てで登録」を押してください。差し替える画像の元データ・編集履歴は置き換わるため、必要なら先にバックアップしてください。'; panel.append(desc);
  pending.targets ??= defaultAssignments(project.slots, pending.start, pending.items.length);
  const lines = [];
  const selectedPhrase = index => project.planning?.cards.length === 8 ? project.planning.phrases[index] : '企画なし';
  pending.items.forEach((item, i) => {
    const card = document.createElement('article'); card.className = 'import-row';
    const img = document.createElement('img'); img.src = item.src; img.alt = item.name; card.append(img);
    const info = document.createElement('div'); const name = document.createElement('p'); name.textContent = item.name; info.append(name);
    const label = document.createElement('label'); label.textContent = '割り当て先'; const select = document.createElement('select');
    for (let n = 0; n < 8; n++) { const o = document.createElement('option'); o.value = n; o.textContent = `${String(n + 1).padStart(2, '0')}${project.slots[n] ? '（既存画像あり）' : ''}`; select.append(o); }
    select.value = pending.targets[i];
    const phrase = document.createElement('p'); phrase.className = 'caption';
    const refresh = () => { phrase.textContent = `セリフ: ${selectedPhrase(pending.targets[i])}`; };
    refresh(); select.onchange = () => { pending.targets[i] = Number(select.value); refresh(); }; label.append(select); info.append(label, phrase); card.append(info); panel.append(card); lines.push(card);
  });
  const label = document.createElement('label'), allow = document.createElement('input'); allow.type = 'checkbox';
  label.append(allow, document.createTextNode(' 選択した番号の既存画像を差し替えることを確認しました')); panel.append(label);
  const actions = row(panel); const commit = button('この割り当てで登録', async () => {
    const next = assignImages(project.slots, pending.items, pending.targets, allow.checked);
    commit.disabled = true;
    try { await onCommit(next); } finally { commit.disabled = false; }
  }, 'primary'); actions.append(commit, button('取り込みをキャンセル', onCancel));
  main.append(panel);
}

export async function renderFinish(ui) {
  const { main, project, heading, row, button, save, notice, loadImage, compose, navigateEditor, isCurrent } = ui;
  heading('AUTO FINISH / KEEP ORIGINALS', 'セリフを一括で仕上げる', '元画像は保持します。まず文字を適用し、背景・文字位置を1枚ずつ確認してください。');
  if (project.planning?.cards.length !== 8) {
    main.append(button('先にAIスタンプ企画を作成', () => { location.hash = 'plan'; }, 'primary')); return;
  }
  const note = document.createElement('div'); note.className = 'note'; note.textContent = '背景透過は「背景を調整」から行います。同色の被写体が欠ける場合があるため、自動除去後はUndo・復元ブラシと白／黒／市松背景で確認してください。長いセリフは文字入れ画面で改行・サイズを調整できます。'; main.append(note);
  const label = document.createElement('label'), overwrite = document.createElement('input'); overwrite.type = 'checkbox';
  label.append(overwrite, document.createTextNode(' 既存の文字も企画のセリフへ更新する（位置・色・サイズは維持）')); main.append(label);
  const actions = row(); const apply = button('セリフの文字入れを一括適用', async () => {
    apply.disabled = true;
    try {
      if (overwrite.checked && project.slots.some(s => s?.text?.value) && !confirm('既存の文字内容を企画のセリフに置き換えますか？位置・色・サイズは保持します。')) return;
      const result = await applyCaptions(project.slots, project.planning, { overwrite: overwrite.checked, dimensions: loadImage });
      if (!isCurrent()) return;
      const previous = project.slots; project.slots = result.slots;
      try { await save(); } catch (error) { project.slots = previous; throw error; }
      notice(`${result.applied}枚に適用しました。既存文字を保持: ${result.skipped}枚`);
      await ui.rerender();
    } finally { apply.disabled = false; }
  }, 'primary'); actions.append(apply, button('透過・文字をプレビュー →', () => { location.hash = 'preview'; }));
  const grid = document.createElement('div'); grid.className = 'grid finish-grid'; main.append(grid);
  for (let i = 0; i < 8; i++) {
    const s = project.slots[i], card = document.createElement('article'); card.className = 'card';
    const title = document.createElement('h2'); title.textContent = `STAMP ${String(i + 1).padStart(2, '0')}`; card.append(title);
    const caption = document.createElement('p'); caption.textContent = `企画: ${project.planning.phrases[phraseIndex(s, i)]}`; caption.className = 'caption'; card.append(caption);
    if (s) {
      const c = await compose(s); if (!isCurrent()) return;
      const image = document.createElement('img'); image.src = c.toDataURL(); image.alt = `仕上がり ${i + 1}`; image.className = 'checker-preview'; card.append(image);
      const actual = document.createElement('p'); actual.className = 'caption'; actual.textContent = `現在の文字: ${s.text?.value || '未設定'}`; card.append(actual);
      const controls = row(card); controls.append(button('背景を調整', () => navigateEditor(i, 'edit'), 'tiny'), button('文字を調整', () => navigateEditor(i, 'text'), 'tiny'));
    } else { card.append(button('画像を登録', () => { location.hash = 'images'; })); }
    grid.append(card);
  }
}
