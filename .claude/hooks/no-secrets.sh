#!/usr/bin/env bash
# Hook PreToolUse (Write|Edit): bloquea la escritura de material sensible.
# Lee el JSON de la invocación por stdin y busca patrones prohibidos en el
# contenido a escribir. Salida 2 = bloquear (Claude ve el motivo en stderr).
set -euo pipefail

INPUT="$(cat)"

CONTENT=$(printf '%s' "$INPUT" | python3 -c '
import json,sys
d=json.load(sys.stdin)
ti=d.get("tool_input",{})
print(ti.get("content","") + "\n" + ti.get("new_string",""))
' 2>/dev/null || true)

FILE=$(printf '%s' "$INPUT" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(d.get("tool_input",{}).get("file_path",""))
' 2>/dev/null || true)

deny() { echo "no-secrets.sh BLOQUEADO: $1 (archivo: ${FILE:-desconocido})" >&2; exit 2; }

# Archivos que jamás se escriben desde Claude Code
case "$FILE" in
  *storage-state*.json|*service-account*.json|*.pem|*.key|*/.env|*/.env.*)
    [[ "$FILE" == *.env.example ]] || deny "ruta de secretos" ;;
esac

# Patrones de credenciales en el contenido
printf '%s' "$CONTENT" | grep -qiE 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' && deny "clave privada"
printf '%s' "$CONTENT" | grep -qiE '"private_key_id"|"client_email".*gserviceaccount' && deny "service account JSON"
printf '%s' "$CONTENT" | grep -qiE '(yape|bcp)[_-]?(user|usuario|pass|clave|password|pin)\s*[:=]\s*["'"'"'][^"'"'"']{4,}' && deny "posible credencial bancaria"
printf '%s' "$CONTENT" | grep -qE 'AIza[0-9A-Za-z_-]{35}' && deny "API key de Google en claro"
printf '%s' "$CONTENT" | grep -qiE '(wm_api_token|api_bearer_token|hmac[_-]?secret)\s*[:=]\s*["'"'"'][^"'"'"']{12,}' && deny "token en claro"

exit 0
