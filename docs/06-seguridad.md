# 06 — Seguridad

## 1. Modelo de amenazas

| # | Amenaza | Vector | Control |
|---|---|---|---|
| T1 | **Comprobante falsificado** | Cliente envía imagen editada de un pago que no hizo | Regla inviolable #1: solo la consola confirma. El comprobante jamás transiciona a `CONFIRMADO`. |
| T2 | **Robo de la sesión bancaria** | Exfiltración del `storageState` | Fuera del repo, `600`, sin nube en Fase 0–1; cifrado en reposo si se promueve a OCI; regla gitleaks dedicada. |
| T3 | **Acción destructiva del scraper** | Bug o prompt-injection hace clic donde no debe | Solo lectura por diseño y por revisión; ninguna rutina de escritura en la consola sin decisión del dueño (docs/03 §2 y §5B). |
| T4 | **Doble confirmación / doble crédito** | Re-scrape, reinicio, doble webhook | Idempotencia estructural: ids de documento = hash/messageId; conciliación deduplica. |
| T5 | **Suplantación del webhook** | Tercero llama a nuestro endpoint de comprobantes | HMAC sobre raw body + `timingSafeEqual`; rechazo sin firma válida. |
| T6 | **Fuga de datos bancarios/personales** | Logs, Firestore, analítica | Minimización (regla #4), enmascarado de teléfonos, sin capturas persistidas, sin analítica de terceros. |
| T7 | **Secretos en el repo** | Commit accidental | Hook pre-tool de Claude Code, `.gitignore`, gitleaks en CI sobre historial completo. |
| T8 | **Bloqueo de cuenta por el banco** | Patrón de acceso no humano | Ritmo humano con jitter, sesión única, detener ante anomalías (docs/03 §3). En Baneco: el usuario API se bloquea por logins fallidos y se desbloquea solo en agencia (B4) — reintento único ante 401, nunca en bucle; polling con piso de 10 s (D6). |
| T9 | **Webhook bancario falsificado** | Tercero que conoce la URL llama a `notifyPaymentQR` con un pago inexistente | Regla **BANECO-1**: el webhook solo dispara la consulta autenticada `statusQR`, nunca confirma. Hoy no hay webhook (D3); si se habilita (Hito B3): token de ruta comparado con `timingSafeEqual`, allowlist de IPs del banco (pregunta D1, sin respuesta) y test adversarial. |
| T10 | **QR pagable después de que el cobro lo soltó** | El banco vence los QR por día (C4): un cobro vencido, renovado o anulado seguiría cobrable hasta la medianoche | La máquina de estados exige la constancia de anulación en el banco (`QrAnulado`) antes de soltar un QR; lo que se escape lo encuentra el cierre diario y queda en la pestaña Revisión (PR #21, PR #27). |
| T11 | **Producción tocada por error** | Correr la API o el satélite con credenciales reales fuera de la prueba controlada | Barrera de código (`composicion/src/produccion.ts`): producción solo con `MODO_PRUEBA_PRODUCCION=1` y el emulador; topes de monto y cantidad (docs/Integraciones/baneco/03). B0 solo corre contra certificación. |

## 2. Gestión de secretos

| Secreto | Dónde vive | Dónde JAMÁS |
|---|---|---|
| Credenciales Yape/BCP | Solo en la cabeza/gestor del dueño | Repo, .env, logs, Firestore, chat, Claude |
| `storageState` Playwright | `~/.manejoqr/`, 600 | Repo, nube de archivos, Firestore |
| Llave service account scraper | `~/.manejoqr/` | Repo, demo-web, CI |
| `WM_API_TOKEN` (WhatsAppModular) | `.env` local / Secret Manager | Repo, código, fixtures |
| Secreto HMAC webhook | `.env` local / Secret Manager | Repo, código, fixtures |
| Baneco certificación (`BANECO_CERT_*`: usuario, contraseña, llave AES, cuenta de pruebas) | `.env` local | Repo, fixtures, informes de B0 (B0 aborta si un secreto aparece en lo que escribe) |
| Baneco producción (`BANECO_PROD_*`: usuario, contraseña, llave AES, cuenta de cobro) | `~/.manejoqr/baneco-prod.env`, 600 — Claude Code no lo lee | Repo, `.env`, chat, logs, Firestore. La llave se pide por un canal que no sea un adjunto de correo (B3) |
| Adjuntos originales del banco | `docs/Integraciones/baneco/privado-no-gh/` (git-ignored, D4) | GitHub, cualquier nube |
| Token de la API local (`API_TOKEN_LOCAL` / `VITE_API_TOKEN`) | `~/.manejoqr/baneco-prod.env` y `demo-web/.env.local` | Repo; queda embebido en el bundle, así que publicar la consola exige Firebase Auth |

`.env` nunca se versiona (`.gitignore`); `.env.example` lista todas las
variables sin valores. Variable nueva ⇒ actualizar `.env.example` en el mismo PR.

## 3. Redacción en logs

- Teléfonos: `+591 7** ***56`. Nunca completos.
- Montos y fechas: permitidos (son el corazón de la conciliación).
- Referencias/glosas: recortadas a lo necesario para conciliar.
- Nada de HTML crudo de la consola en logs persistentes; en debug local,
  solo efímero.
- Logs estructurados (pino) con `cobroId` y `correlationId`.
- **Bitácora en disco** de la API y el satélite (`~/.manejoqr/logs/`, fuera del repo,
  `composicion/src/bitacora.ts`):
  - Cada línea pasa por `sanearTexto` **antes** de escribirse (tokens `Bearer`, teléfonos y
    números de 9 a 17 dígitos enmascarados) y otra vez al leerse, recortada a 500
    caracteres. Solo rutas, estados HTTP, `responseCode`, demoras, conteos y claves del
    banco; nunca cuerpos ni query strings.
  - El directorio y los archivos tienen que ser del usuario del proceso; los permisos se
    corrigen a 700/600 aunque ya existieran, y los archivos se abren sin seguir enlaces
    simbólicos.
  - Tope de 20 MB por archivo (día y proceso). Los pedidos sin token válido (401) no se
    registran y la API escucha solo en `127.0.0.1` (`API_HOST` para cambiarlo): nadie
    llena el disco a fuerza de pedidos.
  - La API lee solo el último MB de cada archivo para la pestaña Logs.
  - No rota sola: borrarla es decisión del dueño.

## 4. Seguridad en el pipeline

Heredado del procedimiento de segurolotengo-demo / WhatsApp-Modular:

- CI bloqueante: lint, typecheck, tests, deps:check + **gitleaks** (binario,
  historial completo con `fetch-depth: 0`).
- `permissions: contents: read` en los workflows.
- Dependabot activo; majors de runtime fijados (Node 22 LTS).
- Branch protection en `main`: checks obligatorios, historia lineal, sin force
  push, squash-merge.
- Secret scanning nativo de GitHub no aplica a repos privados personales → lo
  cubre gitleaks en CI (lección registrada en WhatsApp-Modular).

## 5. Checklist previo a cada merge

- [ ] ¿Ningún camino confirma un cobro sin detección del `PaymentWatcher`?
- [ ] ¿Ningún secreto real en código, tests, fixtures o docs?
- [ ] ¿El webhook valida HMAC sobre raw body antes de parsear?
- [ ] ¿Los datos persistidos respetan la minimización (regla #4 y #9)?
- [ ] ¿Las escrituras a Firestore son idempotentes?
- [ ] ¿El scraper sigue siendo estrictamente de solo lectura?
