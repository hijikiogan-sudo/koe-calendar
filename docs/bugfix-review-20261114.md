# 不具合確認と修正（2026-11-14）

## 修正

1. GoogleのOAuth設定が空でも、Koe内保存・Appleカレンダーを優先して起動する。ネイティブの初回起動は使い方を選択できる。Webのお試し表示は維持。
2. Koe内保存の通知候補は、予定の開始日ではなく通知の発火日時で60日以内を判定する。例：70日先の予定の28日前通知（42日先）が漏れない。最大60件の予約上限は維持。
3. 音声から来た単一通知も、カスタム複数通知と同じ範囲・数値検証を通す。4週間超などの値をGoogle送信・ローカル保存前に拒否する。
4. 開始日を変更して終了日を連動したあとに、重複確認を再実行する。
5. 重複確認の通信失敗を画面に表示する。失敗したPromiseをキャッシュから外して、同じ日の確認を再試行できるようにする。

## 検証

- Nodeの自動試験35件成功。起動分岐、通知予約範囲、通知入力、従来の音声・日時・保存処理を含む。
- 既存の聞き取り文字列81例、命令・日付・辞書・六曜の試験成功。
- Playwright/Chromiumで、Google設定なしのKoe内保存・Apple起動（ネイティブ機能は模擬）、開始日変更、重複確認の通信失敗からの復旧を確認。
- 実際のGoogle予定は変更していない。Apple通知の実配信・Xcodeビルド・iPhone/iPad/Mac実機は未検証。音声認識精度の実測は今回の検証に含まない。

## 再実行

```sh
TZ=Asia/Tokyo node --test tests/countdown.js tests/descriptions.js tests/event-update.js tests/notifications.js tests/schedule-range.js tests/speech.js tests/startup.js
TZ=Asia/Tokyo node tests/run.js
TZ=Asia/Tokyo node tests/cmd.js
TZ=Asia/Tokyo node tests/date.js
TZ=Asia/Tokyo node tests/dict.js
TZ=Asia/Tokyo node tests/rokuyo.js
```

ブラウザ試験はPlaywrightとChromiumが利用できる開発環境で行う。アプリ実行用の追加依存ではない。

```sh
# 別ターミナル
python3 -m http.server 8000
# LinuxでシステムChromiumを使う場合
CHROMIUM_PATH=/usr/bin/chromium node tests/browser-regressions.cjs
# Playwright付属Chromiumが導入済みの場合
node tests/browser-regressions.cjs
```
