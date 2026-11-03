# STAMP STUDIO Ver.1

LINEスタンプ用の画像編集を端末内で行う静的Webアプリです。
公開先: https://dogzall.github.io/-stamp-studio/

画像編集・IndexedDB保存・ローカル同梱JSZipによる出力コードを含む開発途中版です。
ブラウザ統合テスト・Android実機テストは未完了です。

## PWAインストール調査・修正（1.0.2）

### 見つかった設定上の問題

旧Manifestの `id: "./"` は `https://dogzall.github.io/` になり、
STAMP専用の識別子になっていませんでした。`id` は `start_url` の**オリジン**を基準に解決され、
Manifestファイルが置かれたディレクトリを基準にはしません。
前回（1.0.1）の調査・テストではこの点を取り違えており、今回訂正しました。

`id` を `/-stamp-studio/` に修正しました。今後この識別子をバージョン番号などで変更しないでください。
これにより同じホストの別アプリや旧ルート識別子と区別できます。
ただし、端末上のWebAPK生成失敗・「インストール済み」誤判定の直接原因が
この設定だけであるとまでは確認できていません。

仕様: https://www.w3.org/TR/appmanifest/#id-member
参考: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id

### AMEKAJI STUDIOとの読み取り比較

AMEKAJI側のコードは変更していません。GitHub mainの現在の設定との比較です。

| 項目 | STAMP STUDIO | AMEKAJI STUDIO |
| --- | --- | --- |
| id | 旧 `./`（ルート）→ **`/-stamp-studio/`** | `/amekaji-studio/` |
| start_url | `./` → `/-stamp-studio/` | `/amekaji-studio/` |
| scope | `./` → `/-stamp-studio/` | `/amekaji-studio/` |
| display | `standalone` | `standalone` |
| Manifest参照 | `./manifest.json` | `./manifest.webmanifest` |
| アイコン | 192/512px PNG（any）、512px maskable | 同じ種類・サイズの指定 |
| SW登録 | `./sw.js`、scope `./` | 同じ相対指定 |
| SW更新 | `updateViaCache: none` | 同じ指定 |

`start_url`・`scope`・HTMLのManifest参照は元から正しいサブパスを指しています。
PNG署名と実サイズをローカルで確認済みです。`.json` と `.webmanifest` の拡張子の違いだけでは
必須設定の不足とは言えないため、参照先やアイコンは変更していません。
現在のAMEKAJIのidは旧STAMPのルートidとも異なるため、両者が直接衝突している証拠はありません。
端末に登録済みの古い識別子やWebAPKの内部状態は、この環境から取得できません。

### 今回の変更

- Manifestのidを専用パスへ修正。
- 診断画面にidの宣言値と、仕様に従って解決した値を表示。
- 期待するSTAMPのidと異なる場合に警告。
- SWのスコープ・スクリプトURL・ページを制御するSWを表示し、異なるアプリのSWなら警告。
  登録解除・他アプリの変更は行いません。
- Chromeの「インストール済み」やイベント未検出だけで、WebAPKの有無を判断しない案内に訂正。
- SWキャッシュを `stamp-studio-v1.0.2` に更新。
- 前回テストの誤ったid解決を訂正し、旧設定を再現する回帰テストを追加。

1.0.1で追加したオンラインでのManifest再検証・オフライン時のキャッシュ利用、
新資産の取得失敗時に旧版を維持する処理、保存後の明示的な更新切り替えは維持しています。
画像処理、背景除去、文字入れ、ZIP生成、IndexedDBのコードは今回変更していません。
アプリのid変更は保存済みプロジェクトの削除処理を伴いません。

## Galaxy / Android Chromeでの再確認

1. 念のため、既存プロジェクトをアプリ内の「バックアップ」で保存する。
2. Pagesのデプロイ完了後、Chromeの通常タブで公開URLを直接開く。
   アプリ内ブラウザやシークレットタブ、古いホーム画面アイコンは使わない。
3. 更新案内が出たら「保存して更新」を選ぶ。案内がなければ再読み込みして待つ。
   「使い方」に **PWA修正版 1.0.2** が表示されることを確認する。
4. 保存後にSTAMPを開いているタブを閉じ、通常の新しいタブで公開URLを開き直す。
   アプリ識別子が変わるため、既存ページ内の更新だけでなく、新しい文書でManifestを読み込ませる。
5. 「PWA設定を確認」で次を確認する。
   - id（宣言）: `/-stamp-studio/`
   - id（解決後）・start_url・scope: `https://dogzall.github.io/-stamp-studio/`
   - display: `standalone`
   - 192/512pxアイコン: 読み込み成功
   - SW scope: `https://dogzall.github.io/-stamp-studio/`
   - SW script・ページ制御: `https://dogzall.github.io/-stamp-studio/sw.js`
   - SW状態: `activated`
6. ページを一度操作し30秒程度待って、アプリ内のインストールボタンまたはChromeのメニューから
   インストールを試す。名称「STAMP STUDIO」を確認する。
7. `chrome://webapks` でSTAMP STUDIOが追加されたかを確認する。
   ホーム画面のアイコンやChromeの「インストール済み」表示だけでWebAPK登録を判断しない。
8. 新しくインストールしたSTAMPのアイコンから開き、アドレスバーがなく、使い方画面が
   「アプリモード」になることを確認する。古い単なるショートカットは自動変換されない。
   必要なら古いショートカットだけを「ホーム画面から削除」する。
   AMEKAJIの削除、アプリのアンインストール、サイトデータの削除は行わない。
9. 最後に機内モードで起動・編集・保存と再開・ZIP出力を確認する。

改善しない場合は、「PWA設定を確認」の結果、Galaxy機種、Android/Chromeバージョン、
`chrome://webapks` のSTAMP登録有無を確認してください。
Chrome・Android側のインストール処理やWebAPK生成サービス側の失敗は、静的コードの確認だけでは特定できません。
ブラウザデータの削除は作品を失うおそれがあるため推奨しません。

## 検証

外部通信・パッケージ追加・ブラウザ不要（Node.js 18以上）:

```sh
node tests/pwa.test.mjs
```

今回の実行結果: **14件合格、0件失敗**。
修正前のidで回帰テストが失敗し、修正後に合格することを確認しています。
内容: start_url/scopeの解決、idのオリジン基準の解決と旧設定の再現、AMEKAJIとの識別、
idのフォールバック、PNG署名・サイズ、資産の存在、更新失敗時の保護、旧キャッシュ削除、
Manifestの再検証とオフライン利用、他アプリを扱わないこと、保存後の安全な更新。
SW・ブラウザAPIはモックです。JavaScriptとPythonテストファイルの構文確認も合格。

公開サイトへのWeb取得はこの環境のツールからアクセスできませんでした。
公開先のHTTPステータス・Content-Type、実際のManifest/SW応答、Chromeの判定とWebAPK作成は未確認です。
前回ローカルソケットが環境に禁止されていたため、今回はブラウザ起動を試していません。
Galaxy実機のPWA登録成功は未確認です。

ブラウザ統合テスト `tests/run.py` は今回未実行です。Pillow、Playwright、Chromiumと
ローカルソケットを利用できる環境が必要です。既存の編集・ZIP・保存機能の回帰確認も未実行です。

## GitHub Pages

リポジトリ `dogzall/-stamp-studio` の Settings → Pages で、
Deploy from a branch → `main` → `/ (root)` を選択します。
非公開リポジトリでのPages利用可否はGitHubプラン等の条件に従います。
この修正では公開範囲・公開設定・AMEKAJI STUDIOは変更していません。

ビルド不要で、`.nojekyll`、HTML、CSS、JavaScript、Manifest、PNG、vendorを配信します。
HTTPSと `/-stamp-studio/` 配下の配信を維持してください。
ローカルで動かす場合はファイルを直接開かず、ローカルHTTPサーバーを使用します。
