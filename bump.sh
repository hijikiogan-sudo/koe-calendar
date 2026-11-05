#!/bin/sh
# 公開前に実行：読み込むファイルに新しい版番号を付け、iPhoneに古い版が残らないようにする
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M)
sed -i '' -E "s#(href=\"(style|themes|techo).css)(\?v=[0-9]+)?\"#\1?v=$V\"#; s#(src=\"(config|parse|app).js)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html
sed -i '' -E "s#const APP_VERSION = '[0-9]+'#const APP_VERSION = '$V'#" app.js
printf '{ "version": "%s" }\n' "$V" > version.json
echo "版：$V"
