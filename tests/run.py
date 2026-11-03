"""Offline local integration suite: Python stdlib + Pillow + Playwright.
Run: python tests/run.py (CHROMIUM_PATH can select an installed Chromium).
"""
import io, json, os, re, shutil, subprocess, sys, tempfile, threading, unittest, zipfile
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'
RESULTS.mkdir(exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT.parent)))
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
        cls.base=f'http://127.0.0.1:{cls.server.server_port}/stamp-studio/'
        cls.pw=sync_playwright().start()
        binary=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        cls.browser=cls.pw.chromium.launch(**({'executable_path':binary} if binary else {}),headless=True,args=['--no-sandbox'])
        cls.fixture=io.BytesIO()
        im=Image.new('RGBA',(120,100),'white');d=ImageDraw.Draw(im)
        d.rectangle((25,20,94,79),fill=(90,130,220,255));d.rectangle((45,35,74,64),fill='white')
        d.rectangle((0,0,4,4),fill=(0,0,0,0))
        im.save(cls.fixture,format='PNG');cls.image=cls.fixture.getvalue()
        cls.version=cls.browser.version
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        self.context=self.browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True,accept_downloads=True)
        self.page=self.context.new_page();self.errors=[];self.external=[];self.uploads=[]
        self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        self.context.on('request',lambda r:self.external.append(r.url) if not r.url.startswith((self.base,'data:','blob:')) else None)
        self.context.on('request',lambda r:self.uploads.append(r.method) if r.method not in ['GET','HEAD'] else None)
        self.page.goto(self.base)
        self.page.get_by_role('button',name='＋ 制作をはじめる',exact=True).wait_for()
        self.page.evaluate('navigator.serviceWorker.ready.then(() => true)')
        self.page.wait_for_function('!!navigator.serviceWorker.controller')
    def tearDown(self):
        self.assertEqual(self.errors,[],f'Browser errors: {self.errors}')
        self.assertEqual(self.external,[],f'External requests: {self.external}')
        self.assertEqual(self.uploads,[],f'Image upload requests: {self.uploads}')
        self.context.close()
    def new(self,count=1):
        self.page.get_by_role('button',name='＋ 制作をはじめる',exact=True).click()
        self.page.get_by_role('heading',name='8枚のスタンプを登録').wait_for()
        self.page.locator('#files').set_input_files([{'name':f'{i}.png','mimeType':'image/png','buffer':self.image} for i in range(count)])
        self.page.get_by_role('button',name='この割り当てで登録',exact=True).click()
        self.page.wait_for_function("document.querySelectorAll('.card img').length === " + str(count))
    def route(self,route):
        self.page.evaluate('(r)=>location.hash=r',route)
    def module(self,body,arg=None):
        return self.page.evaluate('async (arg)=>{const c=await import("./core.js");'+body+'}',arg)
    def test_01_manifest_icons(self):
        m=self.page.evaluate('fetch("./manifest.json").then(r=>r.json())')
        self.assertEqual(m['name'],'STAMP STUDIO');self.assertEqual(m['short_name'],'STAMP')
        for k in ['start_url','scope']:self.assertEqual(m[k],'./')
        self.assertEqual(m['id'],'/-stamp-studio/')
        self.assertEqual(m['display'],'standalone')
        self.assertEqual(m['theme_color'],'#111827');self.assertEqual(m['background_color'],'#111827')
        for i in m['icons']:
            with Image.open(ROOT/i['src']) as image:
                s=int(i['sizes'].split('x')[0]);self.assertEqual(image.size,(s,s));self.assertEqual(image.format,'PNG')
        self.assertTrue(any(i['purpose']=='maskable' for i in m['icons']))
    def test_02_service_worker_subpath_cache(self):
        result=self.page.evaluate('''async()=>{const r=await navigator.serviceWorker.ready;return {scope:r.scope,keys:await caches.keys(),assets:(await (await caches.open('stamp-studio-v2.0.0')).keys()).map(r=>r.url)};}''')
        self.assertEqual(result['scope'],self.base)
        self.assertIn('stamp-studio-v2.0.0',result['keys'])
        self.assertEqual(len(result['assets']),15)
        self.assertTrue(all(v.startswith(self.base) for v in result['assets']))
    def test_03_offline_reload_edit_zip(self):
        self.context.set_offline(True);self.page.reload()
        self.page.get_by_role('heading',name=re.compile('そのひらめきを')).wait_for()
        self.new(8);self.route('edit')
        self.page.get_by_role('button',name='背景を自動除去',exact=True).click()
        self.route('text');self.page.get_by_label('日本語テキスト（改行可）').fill('ありがとう')
        self.page.get_by_text('端末に保存済み',exact=True).wait_for()
        self.page.reload();self.page.get_by_label('日本語テキスト（改行可）').wait_for()
        self.assertEqual(self.page.get_by_label('日本語テキスト（改行可）').input_value(),'ありがとう')
        self.route('export');self.export_and_check('offline.zip')
    def test_04_transparency_and_background(self):
        result=self.module('''const a=c.canvas(7,7),x=a.getContext('2d');x.fillStyle='white';x.fillRect(0,0,7,7);x.fillStyle='black';x.fillRect(1,1,5,5);x.fillStyle='white';x.fillRect(2,2,3,3);x.clearRect(3,3,1,1);const d=x.getImageData(0,0,7,7);c.removeBackground(d,[255,255,255],0,true);return [d.data[3],d.data[(2*7+2)*4+3],d.data[(3*7+3)*4+3],d.data[(1*7+1)*4+3]];''')
        self.assertEqual(result,[0,255,0,255])
    def test_05_tolerance_global_and_restore(self):
        result=self.module('''const a=c.canvas(3,1),x=a.getContext('2d');x.fillStyle='rgb(240,240,240)';x.fillRect(0,0,3,1);let d=x.getImageData(0,0,3,1),o=new ImageData(new Uint8ClampedArray(d.data),3,1);c.removeBackground(d,[255,255,255],10,false);const before=d.data[3];c.removeBackground(d,[255,255,255],20,false);const after=d.data[3];c.brush(d,o,0,0,1,true);const restored=d.data[3];c.brush(d,o,0,0,1,false);return [before,after,restored,d.data[3]];''')
        self.assertEqual(result,[255,0,255,0])
    def test_06_undo_redo_ui(self):
        self.new();self.route('edit');self.page.locator('#editorCanvas').wait_for()
        before=self.page.locator('canvas').evaluate('(c)=>c.toDataURL()')
        self.page.get_by_role('button',name='背景を自動除去',exact=True).click()
        self.page.wait_for_function('(before)=>document.querySelector("canvas").toDataURL()!==before',arg=before)
        after=self.page.locator('canvas').evaluate('(c)=>c.toDataURL()')
        self.page.get_by_role('button',name='Undo',exact=True).click()
        self.page.wait_for_function('(before)=>document.querySelector("canvas")?.toDataURL()===before',arg=before)
        self.page.get_by_role('button',name='Redo',exact=True).click()
        self.page.wait_for_function('(after)=>document.querySelector("canvas")?.toDataURL()===after',arg=after)
    def test_07_japanese_text_and_drag(self):
        self.new();self.route('text');self.page.get_by_label('日本語テキスト（改行可）').fill('ありがとう\nおつかれさま')
        self.page.get_by_text('端末に保存済み',exact=True).wait_for()
        result=self.page.evaluate('''async()=>{const {db}=await import('./db.js');const p=(await db('list'))[0];const {compose}=await import('./core.js');return {value:p.slots[0].text.value,different:(await compose(p.slots[0])).toDataURL()!==p.slots[0].current};}''')
        self.assertEqual(result['value'],'ありがとう\nおつかれさま');self.assertTrue(result['different'])
        box=self.page.locator('canvas').bounding_box()
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.down();self.page.mouse.move(box['x']+box['width']*.7,box['y']+box['height']*.7);self.page.mouse.up()
    def test_08_eight_images_reorder_delete_replace(self):
        self.new(8);self.assertEqual(self.page.locator('.card img').count(),8)
        self.page.locator('.card').first.get_by_role('button',name='→',exact=True).click()
        self.page.get_by_text('端末に保存済み',exact=True).wait_for()
        self.page.once('dialog',lambda d:d.accept())
        self.page.locator('.card').first.get_by_role('button',name='削除',exact=True).click()
        self.page.wait_for_function("document.querySelectorAll('.card img').length===7")
        self.page.get_by_role('button',name='画像1を登録').click()
        self.page.locator('#files').set_input_files({'name':'replace.png','mimeType':'image/png','buffer':self.image})
        self.page.get_by_role('button',name='この割り当てで登録',exact=True).click()
        self.page.wait_for_function("document.querySelectorAll('.card img').length===8")
    def test_09_line_conversion(self):
        self.new();result=self.page.evaluate('''async()=>{const {db}=await import('./db.js');const c=await import('./core.js');const s=(await db('list'))[0].slots[0];const out=[];for(const [w,h] of [[370,320],[240,240],[96,74]]){const a=await c.output(s,w,h),b=await c.toBlob(a);await c.validatePNG(b,w,h);out.push([a.width,a.height,b.type]);}return out;}''')
        self.assertEqual(result,[[370,320,'image/png'],[240,240,'image/png'],[96,74,'image/png']])
    def export_and_check(self,name):
        self.page.get_by_role('button',name='検証してZIPを作成',exact=True).wait_for()
        self.page.once('dialog',lambda d:d.accept())
        with self.page.expect_download() as pending:self.page.get_by_role('button',name='検証してZIPを作成',exact=True).click()
        path=RESULTS/name;pending.value.save_as(path)
        names=[f'{i:02}.png' for i in range(1,9)]+['main.png','tab.png']
        with zipfile.ZipFile(path) as z:
            self.assertEqual(z.namelist(),names);self.assertIsNone(z.testzip())
            for i,n in enumerate(names):
                with Image.open(io.BytesIO(z.read(n))) as im:
                    self.assertEqual(im.format,'PNG');self.assertEqual(im.size,(370,320) if i<8 else (240,240) if i==8 else (96,74))
                    self.assertEqual(im.mode,'RGBA');self.assertEqual(im.getpixel((0,0))[3],0)
        if shutil.which('unzip'):
            result=subprocess.run(['unzip','-t',str(path)],text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        else:self.fail('unzip command unavailable: external-tool interoperability unverified')
    def test_10_zip_general_unzip(self):
        self.new(8);self.route('export');self.export_and_check('verified.zip')
    def test_11_indexeddb_reload_history_backup_restore(self):
        self.new();self.route('edit');self.page.get_by_role('button',name='背景を自動除去',exact=True).click()
        self.page.get_by_text('端末に保存済み',exact=True).wait_for();self.route('images')
        with self.page.expect_download() as pending:self.page.get_by_role('button',name='バックアップ',exact=True).click()
        data=Path(pending.value.path()).read_bytes();backup=json.loads(data)
        self.assertEqual(len(backup['slots'][0]['undo']),1)
        self.page.reload();self.page.get_by_role('heading',name='8枚のスタンプを登録').wait_for()
        self.assertEqual(self.page.locator('.card img').count(),1)
        self.route('projects');self.page.get_by_role('button',name='バックアップを復元',exact=True).click()
        self.page.locator('#restoreFile').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':data})
        self.page.get_by_role('heading',name='8枚のスタンプを登録').wait_for()
        result=self.page.evaluate('''async()=>{const {db}=await import('./db.js');const all=await db('list');return {count:all.length,history:all.every(p=>p.slots[0].undo.length===1)};}''')
        self.assertEqual(result,{'count':2,'history':True})
    def test_12_mobile_layout(self):
        self.new(8)
        for route in ['home','plan','images','finish','edit','text','preview','export','help','projects']:
            self.route(route);self.page.wait_for_timeout(120)
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),route)
        self.route('home');self.page.screenshot(path=str(RESULTS/'mobile-home.png'),full_page=True)
        self.route('edit');self.page.locator('canvas').wait_for();self.page.screenshot(path=str(RESULTS/'mobile-editor.png'),full_page=True)
    def test_13_malicious_input_rejected(self):
        self.new();self.page.locator('#files').set_input_files({'name':'bad.svg','mimeType':'image/svg+xml','buffer':b'<svg/>'})
        self.page.get_by_role('status').filter(has_text='PNG・JPEG・WebP').wait_for()
        self.assertEqual(self.page.locator('.card img').count(),1)
        self.page.locator('#restoreFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{"version":1,"name":"bad","slots":[]}'})
        self.page.get_by_role('status').filter(has_text='バックアップ形式が不正').wait_for()
    def test_14_xss_text_is_plain(self):
        self.new();self.page.get_by_label('プロジェクト名').fill('<img src=x onerror=alert(1)>')
        self.page.get_by_text('端末に保存済み',exact=True).wait_for();self.route('projects')
        self.page.get_by_role('heading',name='<img src=x onerror=alert(1)>',exact=True).wait_for()
        self.assertEqual(self.page.locator('img[src=x]').count(),0)
    def test_15_incomplete_and_transparent_export(self):
        self.new();self.route('export');self.page.get_by_role('button',name='検証してZIPを作成').click()
        self.page.get_by_role('status').filter(has_text='8枚すべて').wait_for()
        result=self.module('''const a=c.canvas(4,4);try{await c.output({current:a.toDataURL(),text:null},370,320);return false;}catch(e){return e.message.includes('完全に透明');}''')
        self.assertTrue(result)
    def test_16_pwa_update_and_old_cache_cleanup(self):
        # Use another isolated copy on a localhost port, serving this exact app with only SW version substituted.
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)/'stamp-studio';shutil.copytree(ROOT,folder,ignore=shutil.ignore_patterns('.git','test-results','node_modules'))
            server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=tmp));threading.Thread(target=server.serve_forever,daemon=True).start()
            ctx=self.browser.new_context();p=ctx.new_page();base=f'http://127.0.0.1:{server.server_port}/stamp-studio/'
            try:
                p.goto(base);p.evaluate('navigator.serviceWorker.ready');p.wait_for_function('!!navigator.serviceWorker.controller')
                p.get_by_role('button',name='＋ 制作をはじめる').click()
                p.get_by_label('プロジェクト名').fill('更新前の作品')
                p.get_by_text('端末に保存済み',exact=True).wait_for()
                sw=folder/'sw.js';sw.write_text(sw.read_text().replace('v2.0.0','v2.0.1'))
                p.evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update())')
                p.locator('#update').wait_for(state='visible')
                self.assertIn('stamp-studio-v2.0.0',p.evaluate('caches.keys()'))
                p.get_by_role('button',name='保存して更新',exact=True).click()
                p.wait_for_function("navigator.serviceWorker.controller && caches.keys().then(k=>k.includes('stamp-studio-v2.0.1')&&!k.includes('stamp-studio-v2.0.0'))")
                p.get_by_label('プロジェクト名').wait_for();self.assertEqual(p.get_by_label('プロジェクト名').input_value(),'更新前の作品')
                ctx.set_offline(True);p.reload();p.get_by_label('プロジェクト名').wait_for()
                self.assertEqual(p.get_by_label('プロジェクト名').input_value(),'更新前の作品')
            finally:ctx.close();server.shutdown();server.server_close()
    def test_17_save_failure_shown(self):
        self.page.evaluate('''()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('Full','QuotaExceededError')};}''')
        self.page.get_by_role('button',name='＋ 制作をはじめる',exact=True).click()
        self.page.get_by_role('status').filter(has_text='空き容量').wait_for()
        self.assertIn('保存失敗',self.page.locator('#saveState').inner_text())

    def create_plan(self):
        self.route('plan')
        self.page.get_by_label('キャラクター名',exact=True).fill('もちねこ')
        self.page.get_by_label('外見・特徴（必須）',exact=True).fill('白い丸顔、青い目')
        self.page.get_by_label('共通の服装（任意）',exact=True).fill('赤いリボン')
        self.page.get_by_role('button',name='8枚の企画を作成',exact=True).click()
        self.page.get_by_role('button',name='01 のプロンプトをコピー',exact=True).wait_for()
        self.page.get_by_text('端末に保存済み',exact=True).wait_for()
    def test_18_v2_prompt_clipboard_and_txt(self):
        self.new();self.create_plan()
        self.context.grant_permissions(['clipboard-read','clipboard-write'])
        self.page.get_by_role('button',name='01 のプロンプトをコピー',exact=True).click()
        self.page.wait_for_function("navigator.clipboard.readText().then(t=>t.includes('スタンプ 01'))")
        self.page.get_by_role('button',name='8枚分を一括コピー',exact=True).click()
        self.page.wait_for_function("navigator.clipboard.readText().then(t=>(t.match(/【スタンプ /g)||[]).length===8)")
        with self.page.expect_download() as pending:self.page.get_by_role('button',name='TXTファイル保存',exact=True).click()
        content=Path(pending.value.path()).read_text()
        self.assertEqual(len(re.findall('【スタンプ ',content)),8)
        self.assertIn('もちねこ',content)
    def test_19_v2_offline_plan_finish_and_zip(self):
        self.new(8);self.context.set_offline(True);self.create_plan();self.route('finish')
        self.page.get_by_role('button',name='セリフの文字入れを一括適用',exact=True).click()
        self.page.get_by_text('端末に保存済み',exact=True).wait_for()
        self.page.wait_for_function("document.querySelectorAll('.finish-grid img').length===8")
        self.route('text');self.page.get_by_label('日本語テキスト（改行可）').fill('手動で修正')
        self.page.get_by_text('端末に保存済み',exact=True).wait_for();self.page.reload()
        self.page.get_by_label('日本語テキスト（改行可）').wait_for()
        self.assertEqual(self.page.get_by_label('日本語テキスト（改行可）').input_value(),'手動で修正')
        self.route('export');self.export_and_check('v2-offline.zip')
    def test_20_v2_mapping_confirmation_is_required(self):
        self.new();self.page.locator('#files').set_input_files({'name':'new.png','mimeType':'image/png','buffer':self.image})
        self.page.get_by_role('button',name='この割り当てで登録',exact=True).wait_for()
        self.assertEqual(self.page.locator('.card img').count(),1)
        self.page.get_by_role('button',name='この割り当てで登録',exact=True).click()
        self.page.get_by_role('status').filter(has_text='差し替えを確認').wait_for()
        self.assertEqual(self.page.locator('.card img').count(),1)
        self.page.get_by_label('選択した番号の既存画像を差し替えることを確認しました').check()
        self.page.get_by_role('button',name='この割り当てで登録',exact=True).click()
        self.page.get_by_role('status').filter(has_text='画像を登録しました').wait_for()
    def test_21_v2_keeps_legacy_project_and_restores_planning_backup(self):
        self.new();self.page.evaluate("""async()=>{const {db}=await import('./db.js');const p=(await db('list'))[0];delete p.planning;for(const s of p.slots)if(s)delete s.planIndex;await db('put',p);} """)
        self.page.reload();self.page.get_by_role('heading',name='8枚のスタンプを登録').wait_for()
        self.assertEqual(self.page.locator('.card img').count(),1)
        self.create_plan();self.route('images')
        with self.page.expect_download() as pending:self.page.get_by_role('button',name='バックアップ',exact=True).click()
        data=Path(pending.value.path()).read_bytes();backup=json.loads(data)
        self.assertEqual(backup['version'],1);self.assertEqual(len(backup['planning']['cards']),8)
        self.page.locator('#restoreFile').set_input_files({'name':'v2.json','mimeType':'application/json','buffer':data})
        self.page.get_by_role('status').filter(has_text='復元しました').wait_for();self.route('plan')
        self.page.get_by_label('キャラクター名',exact=True).wait_for()
        self.assertEqual(self.page.get_by_label('キャラクター名',exact=True).input_value(),'もちねこ')

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(StudioTests)
    runner=unittest.TextTestRunner(verbosity=2)
    result=runner.run(suite)
    (RESULTS/'summary.json').write_text(json.dumps({'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'success':result.wasSuccessful(),'chromium':getattr(StudioTests,'version','unavailable')},indent=2))
    sys.exit(0 if result.wasSuccessful() else 1)
