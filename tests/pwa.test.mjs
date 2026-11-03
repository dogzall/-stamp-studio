// No browser, server, packages or external network required.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const base = 'https://dogzall.github.io/-stamp-studio/';
const manifest = JSON.parse(read('manifest.json'));
const version = read('sw.js').match(/const VERSION = '([^']+)'/)[1];

function worker({ failInstall = false, offline = false } = {}) {
  const events = {}, removed = [], messages = [], fetched = [], stored = [];
  const cache = {
    async addAll(requests) {
      for (const r of requests) {
        assert.equal(r.cache, 'reload');
        assert.ok(r.url.startsWith(base));
        const file = r.url.slice(base.length) || 'index.html';
        assert.ok(fs.existsSync(new URL(file, root)), file);
      }
      if (failInstall) throw new Error('asset unavailable');
    },
    async match() { return new Response('cached'); },
    async put(url) { stored.push(url); }
  };
  const self = {
    registration: { scope: base }, location: { origin: new URL(base).origin },
    addEventListener(name, fn) { events[name] = fn; },
    async skipWaiting() { messages.push('skipWaiting'); },
    clients: {
      async claim() { messages.push('claim'); },
      async matchAll() { return [
        { url: base, postMessage: value => messages.push(value) },
        { url: 'https://dogzall.github.io/amekaji-studio/', postMessage: () => assert.fail('other app messaged') }
      ]; }
    }
  };
  vm.runInNewContext(read('sw.js'), {
    self, URL, Request, caches: {
      open: async () => cache,
      keys: async () => [version, 'stamp-studio-v1.0.0', 'amekaji-studio-v1'],
      delete: async name => { removed.push(name); }
    },
    fetch: async request => { fetched.push(request); if (offline) throw new Error('offline'); return new Response('network'); }
  });
  const run = async (name, fields = {}) => {
    let pending;
    events[name]({ ...fields, waitUntil(promise) { pending = promise; }, respondWith(promise) { pending = promise; } });
    return await pending;
  };
  return { events, run, removed, messages, fetched, stored };
}

test('Manifest resolves to the correct Pages subpath and standalone identity', () => {
  assert.equal(manifest.name, 'STAMP STUDIO');
  assert.equal(manifest.short_name, 'STAMP');
  assert.equal(manifest.display, 'standalone');
  for (const key of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[key], base + 'manifest.json').href, base);
  assert.notEqual(manifest.prefer_related_applications, true);
  assert.equal(manifest.theme_color, '#111827');
  assert.match(read('index.html'), /rel="manifest" href="\.\/manifest\.json"/);
});
test('192/512/maskable icons contain actual PNG data with declared dimensions', () => {
  for (const icon of manifest.icons) {
    const bytes = fs.readFileSync(new URL(icon.src, root));
    assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  assert.ok(manifest.icons.some(i => i.sizes === '192x192' && i.purpose === 'any'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
});
test('Every precache asset exists at the subpath and HTTP cache is revalidated', async () => {
  const sw = worker(); await sw.run('install');
  assert.deepEqual(sw.removed, []);
  assert.deepEqual(sw.messages, []); // No automatic skipWaiting during editing.
});
test('Failed install preserves active cache and reports error only to STAMP clients', async () => {
  const sw = worker({ failInstall: true });
  await assert.rejects(sw.run('install'), /asset unavailable/);
  assert.deepEqual(sw.removed, [version]);
  assert.equal(sw.messages.length, 1);
  assert.equal(sw.messages[0].type, 'CACHE_ERROR');
});
test('Activation cleans only old STAMP caches; explicit message activates update', async () => {
  const sw = worker(); await sw.run('activate');
  assert.deepEqual(sw.removed, ['stamp-studio-v1.0.0']);
  await sw.run('message', { data: { type: 'SKIP_WAITING' } });
  assert.deepEqual(sw.messages, ['claim', 'skipWaiting']);
});
test('Manifest fetch uses fresh network response and preserves offline fallback', async () => {
  for (const offline of [false, true]) {
    const sw = worker({ offline });
    const response = await sw.run('fetch', { request: new Request(base + 'manifest.json') });
    assert.equal(await response.text(), offline ? 'cached' : 'network');
    assert.equal(sw.fetched[0].cache, 'no-cache');
    assert.deepEqual(sw.stored, offline ? [] : [base + 'manifest.json']);
  }
});
test('Shell still uses cache offline and other origins/apps/POST are not intercepted', async () => {
  const sw = worker({ offline: true });
  assert.equal(await (await sw.run('fetch', { request: new Request(base + 'app.js') })).text(), 'cached');
  for (const request of [new Request('https://example.com/a'), new Request('https://dogzall.github.io/amekaji-studio/'), new Request(base, { method: 'POST' })]) {
    assert.equal(await sw.run('fetch', { request }), undefined);
  }
});

async function lifecycle(controlled) {
  const events = {}, winEvents = {}, posts = [], reloads = [], update = { hidden: true }, button = {};
  const registration = { waiting: { postMessage: m => posts.push(m) }, addEventListener() {} };
  const serviceWorker = {
    controller: controlled ? {} : null,
    addEventListener(name, fn) { events[name] = fn; },
    async register(url, options) {
      assert.equal(url, './sw.js'); assert.equal(options.scope, './'); assert.equal(options.updateViaCache, 'none');
      return registration;
    }
  };
  let saved = false, failSave = false;
  const context = vm.createContext({
    window: { addEventListener(name, fn) { winEvents[name] = fn; } },
    navigator: { serviceWorker },
    document: { querySelector: selector => selector === '#update' ? update : button },
    location: { reload() { reloads.push(true); } },
    Set
  });
  vm.runInContext(read('pwa.js').replaceAll('export ', ''), context);
  context.setupPWA({ save: async () => { if (failSave) throw new Error('quota'); saved = true; }, notice() {} });
  await new Promise(resolve => setImmediate(resolve));
  return { context, events, update, posts, reloads, saved: () => saved, failSave: () => { failSave = true; }, button };
}
test('First SW activation does not force reload of an editing session', async () => {
  const app = await lifecycle(false); app.events.controllerchange();
  assert.equal(app.reloads.length, 0);
});
test('Update saves first, then activates waiting SW and reloads once controller changes', async () => {
  const app = await lifecycle(true);
  assert.equal(app.update.hidden, false);
  await app.button.onclick(); assert.equal(app.saved(), true);
  assert.equal(app.posts[0].type, 'SKIP_WAITING');
  app.events.controllerchange(); assert.equal(app.reloads.length, 1);
});
test('Saving failure prevents activation and reload', async () => {
  const app = await lifecycle(true); app.failSave(); await app.button.onclick();
  app.events.controllerchange(); assert.equal(app.posts.length, 0); assert.equal(app.reloads.length, 0);
});
