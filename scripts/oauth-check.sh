#!/usr/bin/env bash
# Google sign-in self-test.
#
#   ./scripts/oauth-check.sh                      # checks whatever origin you point it at
#   BASE=https://your-host ./scripts/oauth-check.sh
#
# Proves the parts that do not need Google's cooperation — which is everything
# except the account picker:
#   * the redirect URI matches the hostname the visitor is actually on
#   * an unconfigured deployment says so instead of dead-ending
#   * with credentials saved, the consent redirect carries the right redirect_uri
#   * a forged callback is rejected by the signed state
#
# It saves throwaway credentials into the key vault to reach the configured
# states, then removes them again — including on failure.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${BASE:-http://127.0.0.1:8088}"
ENV_FILE="$ROOT/backend/.env"

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
json() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

ADMIN_EMAIL=$(grep -m1 '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)
ADMIN_PASSWORD=$(grep -m1 '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

echo "Google sign-in check against $BASE"

TOKEN=$(curl -s --max-time 20 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  --data "$(python3 -c "import json,sys;print(json.dumps({'email':sys.argv[1],'password':sys.argv[2]}))" "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" \
  | json "['token']")
if [ -z "$TOKEN" ]; then echo "  cannot sign in as the admin account — is the backend up?"; exit 2; fi

HOST_HEADER=$(printf '%s' "$BASE" | sed -E 's#^https?://##')
AUTH=(-H "Authorization: Bearer $TOKEN")

# ── 1. redirect URI belongs to this hostname ────────────────────────────────
STATUS=$(curl -s --max-time 20 "$BASE/api/auth/google/status")
REDIRECT=$(printf '%s' "$STATUS" | json "['redirectUri']")
ORIGIN=$(printf '%s' "$STATUS" | json "['javascriptOrigin']")
echo "$REDIRECT" | grep -q "$HOST_HEADER/api/auth/google/callback" \
  && ok "redirect URI follows the request host: $REDIRECT" \
  || bad "redirect URI does not match the host: $REDIRECT"
[ "$ORIGIN" = "$BASE" ] && ok "authorised origin reported: $ORIGIN" || bad "origin is $ORIGIN, expected $BASE"

# ── 2. unconfigured deployment explains itself ──────────────────────────────
CONFIGURED=$(printf '%s' "$STATUS" | json "['configured']")
if [ "$CONFIGURED" = "False" ]; then
  LOC=$(curl -s -o /dev/null -D - --max-time 20 "$BASE/api/auth/google" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
  case "$LOC" in *"/login?error=google_not_configured") ok "button is honestly reported as off (redirects to $LOC)";;
                *) bad "expected a /login?error=google_not_configured redirect, got: $LOC";; esac
else
  ok "credentials are already saved — skipping the unconfigured check"
fi

# ── cleanup of anything a previous interrupted run left behind ──────────────
stale=$(curl -s --max-time 20 "$BASE/api/admin/api-keys" "${AUTH[@]}" \
  | python3 -c "import sys,json;print(' '.join(k['_id'] for k in json.load(sys.stdin).get('keys',[]) if k.get('label')=='oauth-check (temporary)'))" 2>/dev/null)
for id in $stale; do curl -s -o /dev/null --max-time 20 -X DELETE "$BASE/api/admin/api-keys/$id" "${AUTH[@]}"; done
[ -n "$stale" ] && ok "removed $(echo $stale | wc -w) leftover check key(s) from an earlier run"

# ── 3. configured: consent redirect carries redirect_uri + state ─────────────
created=()
for pair in "GOOGLE_CLIENT_ID:1234567890-oauthcheck.apps.googleusercontent.com" \
            "GOOGLE_CLIENT_SECRET:GOCSPX-oauthcheck-0123456789abcdef"; do
  name="${pair%%:*}"; value="${pair#*:}"
  id=$(curl -s --max-time 20 -X POST "$BASE/api/admin/api-keys" "${AUTH[@]}" -H 'Content-Type: application/json' \
        --data "$(python3 -c "import json,sys;print(json.dumps({'envName':sys.argv[1],'value':sys.argv[2],'label':'oauth-check (temporary)'}))" "$name" "$value")" \
        | json "['key']['_id']")
  [ -n "$id" ] && created+=("$id")
done

if [ "${#created[@]}" -eq 2 ]; then
  STATUS2=$(curl -s --max-time 20 "$BASE/api/auth/google/status")
  [ "$(printf '%s' "$STATUS2" | json "['configured']")" = "True" ] \
    && ok "saved credentials switch the button on ($(printf '%s' "$STATUS2" | json "['clientIdMasked']"))" \
    || bad "credentials saved but the status still says not configured"

  CONSENT=$(curl -s -o /dev/null -D - --max-time 20 "$BASE/api/auth/google" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
  case "$CONSENT" in
    https://accounts.google.com/*)
      ok "consent redirect points at Google"
      ENCODED=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$BASE/api/auth/google/callback")
      printf '%s' "$CONSENT" | grep -q "redirect_uri=$ENCODED" \
        && ok "consent carries redirect_uri for $HOST_HEADER" \
        || bad "redirect_uri in the consent URL is not $BASE/api/auth/google/callback"
      printf '%s' "$CONSENT" | grep -q "state=" \
        && ok "consent carries a signed state parameter" \
        || bad "no state parameter on the consent URL"
      ;;
    *) bad "expected a redirect to accounts.google.com, got: $CONSENT";;
  esac

  LOC2=$(curl -s -o /dev/null -D - --max-time 20 "$BASE/api/auth/google/callback?state=forged" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
  case "$LOC2" in *"/login?error=oauth_state") ok "a forged callback is rejected (state check)";;
                *) bad "forged callback was not rejected with oauth_state: $LOC2";; esac
else
  bad "could not save temporary credentials to the key vault"
fi

# ── cleanup: always ─────────────────────────────────────────────────────────
for id in "${created[@]:-}"; do
  [ -n "$id" ] && curl -s -o /dev/null --max-time 20 -X DELETE "$BASE/api/admin/api-keys/$id" "${AUTH[@]}"
done
if [ "${#created[@]}" -gt 0 ]; then
  if [ "$(curl -s --max-time 20 "$BASE/api/auth/google/status" | json "['configured']")" = "False" ]; then
    ok "temporary credentials removed — back to the unconfigured state"
  else
    bad "temporary credentials are still in the vault; remove the 'oauth-check' keys by hand"
  fi
fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
