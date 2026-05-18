#!/bin/sh
set -e

BASE_URL="${1:-https://api.floodguard.iotsoft.in}"

echo "---HEALTH ${BASE_URL}---"
curl -s "${BASE_URL}/health"
echo

cat >/tmp/floodguard-login.json <<'JSON'
{"login_id":"demo","password":"123456","device_name":"android","app_type":"ANDROID"}
JSON

echo "---LOGIN ${BASE_URL}---"
LOGIN_RESPONSE="$(curl -s -X POST "${BASE_URL}/api/auth/login" -H 'content-type: application/json' --data @/tmp/floodguard-login.json)"
rm -f /tmp/floodguard-login.json
echo "$LOGIN_RESPONSE"
