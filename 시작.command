#!/bin/bash
# 더블클릭하면 서버와 고정 주소(https://daily-class.com)를 함께 켭니다. 이 창을 닫으면 둘 다 꺼집니다.
cd "$(dirname "$0")"
node server.js &
SP=$!
trap 'kill $SP 2>/dev/null' EXIT
sleep 1
echo "접속 주소: https://daily-class.com"
../성적돋보기-tools/cloudflared tunnel --config ../성적돋보기-tools/config.yml run school
