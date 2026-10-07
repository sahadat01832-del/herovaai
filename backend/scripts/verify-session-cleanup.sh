#!/usr/bin/env bash
# Proves the session lifecycle is honest and does not leak browsers:
#   1. connecting a NEW session leaves it awaiting a scan (never "connected")
#   2. connecting again while that scan is pending does not launch a second browser
#   3. deleting the session kills the browser it started and removes its profile dir
# Requires the backend on :5000 and an admin token in $TOKEN (or /tmp/_wa_token).
set -u
API="${API:-http://localhost:5000/api}"
TOKEN="${TOKEN:-$(cat /tmp/_wa_token 2>/dev/null)}"
NAME="${NAME:-cleanup_probe}"
PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: expected $3, got $2"; fi; }

# Count only real browser processes, so the counting command cannot match itself.
browsers() {
  ps -eo args | grep -c "^/opt/brave.com/brave.*--user-data-dir=.*${NAME}"
}

if [ -z "$TOKEN" ]; then echo "No admin token available"; exit 2; fi

echo "== 1. new session awaits a scan =="
CREATE=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$API/whatsapp/sessions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"sessionName\":\"$NAME\"}")
CODE=$(echo "$CREATE" | tail -1)
BODY=$(echo "$CREATE" | head -n -1)
SID=$(echo "$BODY" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "create returns 201" "$CODE" "201"
echo "  session id: ${SID:-<none>}"

STATUS=$(curl -s -m 15 "$API/whatsapp/sessions/$SID" -H "Authorization: Bearer $TOKEN" \
  | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ "$STATUS" = "qr_pending" ]; then ok "status is qr_pending, not connected"; else bad "status: expected qr_pending, got $STATUS"; fi

sleep 8
N1=$(browsers)
if [ "$N1" -gt 0 ]; then ok "browser launched for the pending session ($N1 process(es))"; else bad "no browser process found"; fi

# A scan is only possible if the QR the UI is handed is a real image, so decode its header
# rather than trusting that a non-empty string was set. WhatsApp Web takes a few seconds to
# load, so this waits for it and reports how long it took.
QR=""
QR_WAIT=0
while [ $QR_WAIT -lt 40 ]; do
  QR=$(curl -s -m 15 "$API/whatsapp/sessions/$SID" -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['session'].get('qrCode') or '')")
  [ -n "$QR" ] && break
  sleep 2
  QR_WAIT=$((QR_WAIT + 2))
done
if [ -n "$QR" ]; then ok "QR reached the session record after ~${QR_WAIT}s"; else bad "no QR after ${QR_WAIT}s"; fi
case "$QR" in
  data:image/png\;base64,*) ok "QR is a PNG data URI ($(( ${#QR} / 1024 ))kB base64)" ;;
  "") : ;;
  *) bad "QR payload is not a PNG data URI: ${QR:0:40}" ;;
esac
QR_DIMS=$(QR="$QR" python3 -c "
import base64, os, struct
raw = os.environ.get('QR','')
head, _, b64 = raw.partition(',')
try:
    data = base64.b64decode(b64, validate=False)
except Exception:
    data = b''
print('%dx%d' % struct.unpack('>II', data[16:24]) if data[:8] == b'\x89PNG\r\n\x1a\n' else 'not-a-png')")
size=${QR_DIMS%%x*}
if [ "$QR_DIMS" != "not-a-png" ] && [ "${size:-0}" -ge 200 ]; then ok "QR decodes to a $QR_DIMS image"; else bad "QR image check: $QR_DIMS"; fi

echo "== 2. connecting again does not start a second browser =="
AGAIN=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$API/whatsapp/sessions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"sessionName\":\"$NAME\"}")
A_CODE=$(echo "$AGAIN" | tail -1)
A_BODY=$(echo "$AGAIN" | head -n -1)
check "second connect returns 200" "$A_CODE" "200"
check "second connect reports alreadyRunning" "$(echo "$A_BODY" | grep -o '"alreadyRunning":[a-z]*' | cut -d: -f2)" "true"
check "second connect reports pendingScan" "$(echo "$A_BODY" | grep -o '"pendingScan":[a-z]*' | cut -d: -f2)" "true"
sleep 4
N2=$(browsers)
if [ "$N2" -le $((N1 + 1)) ]; then ok "no second browser launched ($N1 -> $N2)"; else bad "browser count grew $N1 -> $N2"; fi

echo "== 3. deleting the session stops the browser and removes its profile =="
PROFILE="$PWD/tokens/$(echo "$BODY" | grep -o '"sessionName":"[^"]*"' | head -1 | cut -d'"' -f4)"
DEL=$(curl -s -m 60 -w '\n%{http_code} %{time_total}' -X DELETE "$API/whatsapp/sessions/$SID" -H "Authorization: Bearer $TOKEN")
DEL_CODE=$(echo "$DEL" | tail -1 | awk '{print $1}')
DEL_SEC=$(echo "$DEL" | tail -1 | awk '{print $2}')
check "delete returns 200" "$DEL_CODE" "200"

# The delete must not wait for the scan: stopping a browser that is still showing a QR is a
# kill, not a graceful close, so it should settle in seconds.
DEL_MS=$(awk -v s="$DEL_SEC" 'BEGIN { printf "%d", s * 1000 }')
if [ "$DEL_MS" -lt 8000 ]; then ok "delete is prompt (${DEL_MS}ms)"; else bad "delete took ${DEL_MS}ms"; fi

N3=$(browsers)
check "no browser left running" "$N3" "0"
if [ -d "$PROFILE" ]; then bad "profile dir still exists: $PROFILE"; else ok "profile dir removed"; fi

LEFT=$(curl -s -m 15 "$API/whatsapp/sessions" -H "Authorization: Bearer $TOKEN" | grep -c "$SID")
check "session record is gone" "$LEFT" "0"

echo "== 4. disconnecting stops the browser but keeps the login profile =="
CREATE2=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$API/whatsapp/sessions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"sessionName\":\"${NAME}2\"}")
BODY2=$(echo "$CREATE2" | head -n -1)
SID2=$(echo "$BODY2" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)
NAME2="$NAME"2
# browsers() counts NAME, so this step counts its own session inline.
browsers2() { ps -eo args | grep -c "^/opt/brave.com/brave.*--user-data-dir=.*${NAME}2"; }
sleep 8
if [ "$(browsers2)" -gt 0 ]; then ok "second session's browser launched"; else bad "second session has no browser"; fi

DIS=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$API/whatsapp/sessions/$SID2/disconnect" -H "Authorization: Bearer $TOKEN")
check "disconnect returns 200" "$(echo "$DIS" | tail -1)" "200"
check "disconnect left no browser running" "$(browsers2)" "0"

STATUS2=$(curl -s -m 15 "$API/whatsapp/sessions/$SID2" -H "Authorization: Bearer $TOKEN" \
  | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
check "disconnected session reports disconnected" "$STATUS2" "disconnected"
PROFILE2="$PWD/tokens/$(echo "$BODY2" | grep -o '"sessionName":"[^"]*"' | head -1 | cut -d'"' -f4)"
if [ -d "$PROFILE2" ]; then ok "profile kept so a reconnect needs no rescan"; else bad "profile dir was deleted on disconnect"; fi

curl -s -m 60 -o /dev/null -X DELETE "$API/whatsapp/sessions/$SID2" -H "Authorization: Bearer $TOKEN"
if [ -d "$PROFILE2" ]; then bad "delete after disconnect did not remove the profile"; else ok "delete removed the profile"; fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
