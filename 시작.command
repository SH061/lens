#!/bin/bash
# 더블클릭하면 서버와 공개 링크(https)를 함께 켭니다. 이 창을 닫으면 둘 다 꺼집니다.
cd "$(dirname "$0")"
node server.js &
SP=$!
trap 'kill $SP 2>/dev/null' EXIT
sleep 1
echo "아래에 나오는 https://...trycloudflare.com 주소가 선생님들에게 알려 줄 링크입니다."
../성적돋보기-tools/cloudflared tunnel --url http://localhost:3000
