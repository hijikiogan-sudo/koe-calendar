#!/bin/sh
# Web版のファイルをアプリ用にまとめて、Xcodeのプロジェクトへ渡す
set -e
cd "$(dirname "$0")/.."
rm -rf www && mkdir -p www/js
cp index.html style.css themes.css techo.css notes.css config.js parse.js rokuyo.js manifest.webmanifest www/
cp js/*.js www/js/
cp -R icons www/icons
# アプリではGoogleのWeb用ログイン部品を読み込まない（ログインはiOSの仕組みで行う）
sed -i '' '/accounts\.google\.com\/gsi\/client/d' www/index.html
# アプリの部品を読み込む（Web版には入れない）
cp node_modules/@capacitor/core/dist/capacitor.js www/capacitor.js
sed -i '' 's#<script src="config.js#<script src="capacitor.js"></script>\
<script src="config.js#' www/index.html
npx cap sync ios
