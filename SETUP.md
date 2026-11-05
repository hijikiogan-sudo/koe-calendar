# Koe（コエ）：Googleとつなぐ準備（最初の1回だけ）

この設定をしていない間は、ダミーの予定で「お試し表示」として動きます。

## 1. Google Cloud でプロジェクトを作る
1. https://console.cloud.google.com/ を開き、いつものGoogleアカウントでログイン
2. 上部のプロジェクト選択 →「新しいプロジェクト」→ 名前「声カレンダー」で作成

## 2. 使うAPIを有効にする
「APIとサービス」→「ライブラリ」で次の2つを検索して「有効にする」
- **Google Calendar API**（予定。今すぐ使う）
- **Google Tasks API**（タスク。作る順番の⑥で使うので、ついでに有効化しておく）

## 3. 同意画面（Google Auth Platform）を設定する
1. 「APIとサービス」→「OAuth 同意画面」（または「Google Auth Platform」）
2. アプリ名「声カレンダー」、サポートメールに自分のアドレス
3. 対象：**外部**
4. 「対象ユーザー」→「テストユーザー」に**自分のGmailアドレス**を追加
   - テスト中のままで自分用なら問題なく使える（公開申請は不要）

## 4. クライアントIDを作る
1. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
2. 種類：**ウェブ アプリケーション**
3. 「承認済みの JavaScript 生成元」に次を追加
   - `http://localhost:8000`
4. 作成すると「クライアント ID」（`xxxx.apps.googleusercontent.com`）が出るのでコピー

## 5. アプリに貼る
`config.js` の `GOOGLE_CLIENT_ID: ""` の `""` の中に貼って保存。

```js
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "xxxx.apps.googleusercontent.com"
};
```

## 6. 起動して確認
```bash
cd ~/AI作業場/手帳アプリ && python3 -m http.server 8000
```
ブラウザで http://localhost:8000 を開き「Googleでログイン」。
「このアプリはGoogleで確認されていません」と出たら「詳細」→「声カレンダー（安全ではないページ）に移動」（Google側の登録名は「声カレンダー」のまま）で進む（自分で作ったアプリなので問題ない）。

## メモ
- クライアントIDは公開されても困らない値（パスワードではない）。
- iPhoneで使う方法は下の「iPhoneで使う」を参照。
- ログインは約1時間で切れる。切れたら「Googleでログイン」を押し直す（2回目以降は確認なしで通るはず）。

## iPhoneで使う（公開済み）
- アドレス：https://hijikiogan-sudo.github.io/koe-calendar/
- iPhoneのSafariで開き、共有ボタン →「ホーム画面に追加」でアプリのように使える。
- 初めてマイクを押すと「マイク」と「音声認識」の許可を聞かれるので「許可」。
- コードを直したら `git push` すると、1〜2分でこのアドレスに反映される。
- Google側（OAuth クライアント）の「承認済みの JavaScript 生成元」に `https://hijikiogan-sudo.github.io` を追加済み。
