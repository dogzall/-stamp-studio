// PWA lifecycle only. Project data and image processing are managed by app.js.
let registration;
let deferredPrompt;
let lastError = '';
const listeners = new Set();
const changed = () => listeners.forEach(fn => fn());

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;
  changed();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  changed();
});
window.addEventListener('online', changed);
window.addEventListener('offline', changed);

// Unlike start_url/scope/icons, id is resolved against start_url's ORIGIN.
// W3C Web App Manifest: https://www.w3.org/TR/appmanifest/#id-member
export function resolveManifestIdentity(manifest, manifestURL) {
  const start = new URL(manifest.start_url, manifestURL);
  const scope = new URL(manifest.scope, manifestURL);
  scope.search = '';
  scope.hash = '';
  let id = new URL(start.href);
  if (typeof manifest.id === 'string' && manifest.id !== '') {
    try {
      const candidate = new URL(manifest.id, start.origin + '/');
      if (candidate.origin === start.origin) id = candidate;
    } catch { /* Invalid id falls back to start_url, per the specification. */ }
  }
  id.hash = '';
  return { start, scope, id };
}

export async function installApp(notice) {
  if (matchMedia('(display-mode: standalone)').matches) {
    notice('すでにアプリモードで起動しています。');
    return;
  }
  if (!deferredPrompt) {
    notice('Chromeの通常タブで開き、画面を操作して30秒ほど待ってください。「PWA設定を確認」で登録状況を確認できます。Chromeの「インストール済み」表示だけではWebAPKの登録完了は判定できません。');
    return;
  }
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  await prompt.userChoice;
  changed();
}

export function setupPWA({ save, notice }) {
  if (!('serviceWorker' in navigator)) {
    lastError = 'このブラウザではService Workerを利用できません。';
    return;
  }
  // The first installation must not reload an in-progress editing session.
  const hadController = !!navigator.serviceWorker.controller;
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    changed();
    if (hadController && updating) location.reload();
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'CACHE_ERROR') {
      lastError = event.data.message;
      changed();
      notice('オフライン資産の保存に失敗しました。使い方画面のPWA設定を確認してください。');
    }
  });
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then(r => {
      registration = r;
      const show = () => {
        document.querySelector('#update').hidden = !(r.waiting && navigator.serviceWorker.controller);
        changed();
      };
      const watch = worker => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'redundant' && !r.waiting) {
            lastError = 'Service Workerのインストールに失敗しました。PWA設定を確認してください。';
          }
          show();
        });
      };
      show();
      watch(r.installing);
      r.addEventListener('updatefound', () => watch(r.installing));
    })
    .catch(error => {
      lastError = `${error.name}: ${error.message}`;
      notice('オフライン機能を登録できません。使い方画面のPWA設定を確認してください。');
      changed();
    });
  document.querySelector('#updateNow').onclick = async () => {
    try {
      await save();
      if (!registration?.waiting) return;
      updating = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      updating = false;
      notice(error.message);
    }
  };
}

export function renderPWAStatus(parent) {
  const panel = document.createElement('section');
  panel.className = 'note';
  const state = document.createElement('p');
  state.setAttribute('aria-live', 'polite');
  const details = document.createElement('pre');
  details.className = 'pwa-details';
  const refresh = () => {
    state.textContent = `PWA修正版 1.0.2 / ${matchMedia('(display-mode: standalone)').matches ? 'アプリモード' : 'ブラウザモード'} / ${navigator.onLine ? 'オンライン' : 'オフライン'} / ${deferredPrompt ? 'インストール案内を表示できます' : 'インストール案内は未検出'}`;
  };
  refresh();
  // Re-rendered settings screens must not accumulate listeners.
  listeners.clear();
  listeners.add(refresh);
  const check = document.createElement('button');
  check.textContent = 'PWA設定を確認';
  check.onclick = async () => {
    check.disabled = true;
    const lines = [`HTTPS: ${isSecureContext ? '有効' : '無効'}`];
    try {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) throw new Error('Manifestリンクがありません');
      lines.push(`Manifest: ${link.href}`);
      const response = await fetch(link.href, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
      const manifest = await response.json();
      const { start, scope, id } = resolveManifestIdentity(manifest, response.url || link.href);
      const expectedScope = new URL('./', link.href);
      lines.push(`id（宣言）: ${manifest.id ?? '未指定'}`, `id（解決後）: ${id.href}`,
        `start_url: ${start.href}`, `scope: ${scope.href}`, `display: ${manifest.display}`);
      if (manifest.display !== 'standalone' || start.origin !== location.origin || !start.href.startsWith(scope.href)) {
        throw new Error('Manifestの起動先・表示設定を確認してください');
      }
      if (id.href !== expectedScope.href) {
        throw new Error(`STAMP専用idが不一致です。期待値: ${expectedScope.href}。新版を反映後、通常タブを開き直してください。`);
      }
      for (const size of [192, 512]) {
        const icon = manifest.icons?.find(i => i.sizes === `${size}x${size}` && (!i.purpose || i.purpose.split(' ').includes('any')));
        if (!icon) throw new Error(`${size}pxのアイコン設定がありません`);
        const image = new Image();
        image.src = new URL(icon.src, response.url || link.href).href;
        await image.decode();
        if (image.naturalWidth !== size || image.naturalHeight !== size) throw new Error(`${size}pxアイコンの実サイズが不正です`);
        lines.push(`PNGアイコン ${size}×${size}: 読み込み成功`);
      }
      const r = await navigator.serviceWorker?.getRegistration(expectedScope.href);
      const controller = navigator.serviceWorker?.controller;
      lines.push(`SW scope: ${r?.scope || '未登録'}`, `SW script: ${r?.active?.scriptURL || '未有効'}`,
        `SW状態: ${r?.active?.state || r?.installing?.state || '未有効'}`,
        `ページ制御: ${controller?.scriptURL || '未制御（再読込で確認）'}`,
        `更新待ち: ${r?.waiting ? 'あり・保存して更新してください' : 'なし'}`);
      if (r && r.scope !== expectedScope.href) {
        lines.push('警告: このアプリ以外のスコープのSWが見つかりました。削除せず、この結果を報告してください。');
      }
      if (controller && controller.scriptURL !== new URL('./sw.js', expectedScope).href) {
        lines.push('警告: 現在のページを別のSWが制御しています。削除せず、この結果を報告してください。');
      }
      lines.push('WebAPKの登録状況はこの画面から取得できません。Android Chromeの chrome://webapks で別途確認してください。');
      lines.push('この確認だけではAndroidでのインストール成功は保証できません。');
    } catch (error) {
      lines.push(`確認エラー: ${error.name}: ${error.message}`);
    } finally {
      if (lastError) lines.push(`SWエラー: ${lastError}`);
      details.textContent = lines.join('\n');
      check.disabled = false;
      refresh();
    }
  };
  panel.append(state, check, details);
  parent.append(panel);
}
