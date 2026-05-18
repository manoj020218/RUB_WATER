#!/bin/sh
set -e

echo '---HEALTH---'
curl -s http://127.0.0.1:4080/health
echo

echo '---LOGIN---'
cat >/tmp/floodguard-login.json <<'JSON'
{"login_id":"demo","password":"123456","device_name":"android","app_type":"ANDROID"}
JSON

LOGIN_RESPONSE="$(curl -s -X POST http://127.0.0.1:4080/api/auth/login -H 'content-type: application/json' --data @/tmp/floodguard-login.json)"
rm -f /tmp/floodguard-login.json

echo "$LOGIN_RESPONSE"

TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | node -e "let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{try{const parsed=JSON.parse(data);process.stdout.write((parsed.data&&parsed.data.token)||'');}catch{process.exit(0);}});")"

if [ -n "$TOKEN" ]; then
  echo '---ME---'
  curl -s http://127.0.0.1:4080/api/auth/me -H "authorization: Bearer $TOKEN"
  echo
fi
