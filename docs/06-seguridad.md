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
| T8 | **Bloqueo de cuenta por el banco** | Patrón de acceso no humano | Ritmo humano con jitter, sesión única, detener ante anomalías (docs/03 §3). |

## 2. Gestión de secretos

| Secreto | Dónde vive | Dónde JAMÁS |
|---|---|---|
| Credenciales Yape/BCP | Solo en la cabeza/gestor del dueño | Repo, .env, logs, Firestore, chat, Claude |
| `storageState` Playwright | `~/.manejoqr/`, 600 | Repo, nube de archivos, Firestore |
| Llave service account scraper | `~/.manejoqr/` | Repo, demo-web, CI |
| `WM_API_TOKEN` (WhatsAppModular) | `.env` local / Secret Manager | Repo, código, fixtures |
| Secreto HMAC webhook | `.env` local / Secret Manager | Repo, código, fixtures |

`.env` nunca se versiona (`.gitignore`); `.env.example` lista todas las
variables sin valores. Variable nueva ⇒ actualizar `.env.example` en el mismo PR.

## 3. Redacción en logs

- Teléfonos: `+591 7** ***56`. Nunca completos.
- Montos y fechas: permitidos (son el corazón de la conciliación).
- Referencias/glosas: recortadas a lo necesario para conciliar.
- Nada de HTML crudo de la consola en logs persistentes; en debug local,
  solo efímero.
- Logs estructurados (pino) con `cobroId` y `correlationId`.

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
