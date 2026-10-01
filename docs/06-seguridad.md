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
| T12 | **Un consumidor ve o toca el cobro de otro** | Un token de consumidor pidiendo un id o una referencia ajena, o una ruta de la consola del dueño | Dos superficies separadas (`/api/…` del dueño, `/api/v1/…` del contrato) resueltas por identidad tipada en el enrutador, no por una comprobación que cada handler recuerde. Lo ajeno responde **404 y no 403**: un 403 confirmaría que existe. Buscar por referencia externa no es una consulta sino una derivación: el id del cobro sale de `(consumidorId, referenciaExterna)`, así que la referencia de un consumidor no puede alcanzar el cobro de otro. El id que llega por la ruta se valida contra su forma antes de tocar la base. |
| T13 | **Un consumidor marca como pagado un cobro que el banco nunca vio** | El contrato de docs/10 abre la creación de cobros a otro producto | No existe ninguna operación de confirmación en el contrato, y no puede escribirse: `CONFIRMADO` exige una `ConciliacionAprobada` que solo fabrica `conciliar()` desde la consulta autenticada (reglas #1 y BANECO-1). Un test recorre las rutas que no existen y exige 404. Es la regla #1 aplicada a un tercero, igual que T1 al pagador. |
| T14 | **Un token de consumidor débil o filtrado** | Otro sistema guarda el token durante meses en su entorno | Mínimo 32 caracteres y un token por consumidor (`CONSUMIDOR_TOKEN_<ID>`), para rotar y revocar de a uno; un token corto o con el marcador de la plantilla **corta el arranque** de la API. Comparación con `timingSafeEqual` y sin cortar en la primera coincidencia, para no filtrar cuántos consumidores hay. Con el token robado se pueden crear y anular cobros, nunca confirmarlos ni ver los de otro, y un **cupo por consumidor y por hora** (`CONSUMIDOR_MAX_QRS_POR_HORA`) corta el bucle de emisión —cada QR queda pagable hasta la medianoche, así que cientos serían T10 a escala—. El cupo vive en memoria del proceso: alcanza para la API local de hoy, y al desplegarla hay que pasarlo a un contador compartido. Ningún token puede valer para dos identidades: la API no arranca si se repite. |

| T15 | **Aviso de confirmación falsificado** | Un tercero que descubre la URL de aviso de un consumidor le manda un «te pagaron» inventado y le hace entregar lo que vendió | Es T9 en la dirección opuesta, y se resuelve igual: **HMAC-SHA256 sobre el cuerpo crudo** con un secreto por consumidor, comparado en tiempo constante, y la marca de tiempo **dentro** de lo firmado para que un aviso interceptado no se pueda reenviar. La URL tiene que ser https o la API no arranca: firmar no sirve si el canal no es privado. Y el contrato le dice al consumidor, en letra grande, que el aviso es un acelerador y `estadoCobro` la fuente de verdad (docs/10 §4.6). |

| T16 | **Dependencia o acción de CI comprometida** | Un paquete de npm o una acción de GitHub publica una versión maliciosa, o un workflow queda con más permisos de los que necesita | Acciones fijadas por SHA, `permissions: contents: read`, Dependabot con `cooldown` de 7 días (que no retrasa las actualizaciones de seguridad), `dependency-review` en los PRs, Trivy y `npm audit` con bloqueo en CRITICAL y HIGH, y Checkov, actionlint y ShellCheck sobre los workflows y scripts. §4 dice qué mide cada uno. |
| T17 | **Un consumidor cobra en una cuenta ajena** | Un token cargado por error en el archivo de otra cuenta, o un campo `cuenta` en el cuerpo del pedido | El vínculo consumidor→cuenta se declara con `CONSUMIDOR_CUENTA_<ID>` y se verifica al arrancar: la API se niega a arrancar si falta, si no es un alias válido o si es de otro proceso. La cuenta viaja en la identidad tipada y nunca sale del pedido; `esDelConsumidor` exige consumidor **y** cuenta, y lo ajeno responde 404. El alias es un rótulo que empieza con letra, así que no puede ser un número de cuenta, y su valor inválido no se imprime. Residual: el mismo consumidor cargado en los archivos de dos cuentas no se detecta desde un solo proceso; hoy cada cuenta tiene su propia base. |

## 2. Gestión de secretos

| Secreto | Dónde vive | Dónde JAMÁS |
|---|---|---|
| Credenciales Yape/BCP | Solo en la cabeza/gestor del dueño | Repo, .env, logs, Firestore, chat, Claude |
| `storageState` Playwright | `~/.manejoqr/`, 600 | Repo, nube de archivos, Firestore |
| Llave service account scraper | `~/.manejoqr/` | Repo, demo-web, CI |
| `WM_API_TOKEN` (WhatsAppModular) | `.env` local / Secret Manager | Repo, código, fixtures |
| Secreto HMAC webhook | `.env` local / Secret Manager | Repo, código, fixtures |
| Baneco certificación (`BANECO_CERT_*`: usuario, contraseña, llave AES, cuenta de pruebas) | `.env` local | Repo, fixtures, informes de B0 (B0 aborta si un secreto aparece en lo que escribe) |
| Baneco producción (`BANECO_PROD_*`: usuario, contraseña, llave AES, cuenta de cobro) | `~/.manejoqr/baneco-<cuenta>.env`, 600 — uno por cuenta de cobro; Claude Code no lo lee | Repo, `.env`, chat, logs, Firestore. La llave se pide por un canal que no sea un adjunto de correo (B3) |
| Adjuntos originales del banco | `docs/Integraciones/baneco/privado-no-gh/` (git-ignored, D4) | GitHub, cualquier nube |
| Token de la API local (`API_TOKEN_LOCAL` / `VITE_API_TOKEN`) | `~/.manejoqr/baneco-<cuenta>.env` y `demo-web/.env.local` | Repo; queda embebido en el bundle, así que publicar la consola exige Firebase Auth |
| Tokens de consumidores (`CONSUMIDOR_TOKEN_<ID>`) | `~/.manejoqr/baneco-<cuenta>.env`, 600 — Claude Code no lo lee | Repo, código, fixtures, chat. Uno por consumidor: se rota y se revoca sin tocar a los demás |
| Cuenta de cobro de un consumidor (`CONSUMIDOR_CUENTA_<ID>`) | `~/.manejoqr/baneco-<cuenta>.env`, junto a su token. **No es un secreto:** es el alias de la cuenta | Repo ni logs con un valor inválido, que podría ser un número de cuenta pegado por error |
| Secretos de firma de los avisos (`CONSUMIDOR_AVISO_SECRETO_<ID>`) | `~/.manejoqr/baneco-<cuenta>.env`, 600 — Claude Code no lo lee | Repo, código, fixtures, chat. Uno por consumidor, distinto de su token: con el token se llama a la API, con el secreto se verifica lo que sale |

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
  - Una ruta que lleva un dato de quien llama no se registra entera: de
    `/api/v1/cobros/por-referencia/:referencia` solo queda el prefijo. La
    referencia es opaca por contrato, pero la elige el consumidor, y el
    enmascarado no cubre un celular boliviano sin prefijo (8 dígitos).
  - La API lee solo el último MB de cada archivo para la pestaña Logs.
  - No rota sola: borrarla es decisión del dueño.

## 4. Seguridad en el pipeline

Desde el 2026-10-01 el repositorio sigue el **estándar DevSecOps de SeguridadGeneral**, stack
`solo-ci` (ESTADO, decisión 22). La calidad de TypeScript es el job `verify` de `ci.yml`, propio;
lo que agrega el estándar es la seguridad estática, y todo junto lo agrega `compuerta-pr`.

**Qué mide cada control, y qué amenaza de §1 cubre:**

| Control | Qué mira | Cubre |
|---|---|---|
| Gitleaks del estándar, con `.github/gitleaks.toml` | Secretos en todo el historial, con cuatro reglas propias: credencial bancaria, `storageState`, token de WhatsAppModular y secreto HMAC | T7, y la parte de T2, T5, T14 y T15 que es «el secreto no está en el repo» |
| Gitleaks propio (job `gitleaks`, `.gitleaks.toml`) | Lo mismo, y con todas las reglas por defecto en `docs/`, donde el estándar exime `generic-api-key` | T6 y T7 en los informes de producción |
| Semgrep CE y CodeQL | SAST sobre el código | Código inseguro en general; ninguna amenaza propia |
| Trivy fs, `npm audit` y `dependency-review` | Vulnerabilidades conocidas en dependencias; bloquean en CRITICAL y HIGH | T16 |
| Checkov, actionlint y ShellCheck | Permisos e inyección en workflows, y errores en scripts | T16 |

Las excepciones viven **solo** en `.devsecops.yml`, con vencimiento de 90 días o menos para
CRITICAL y HIGH. Hoy no hay ninguna.

**Lo que ningún escáner mide.** T1, T4, T5, T9, T12, T13, T14 y T15 no son un patrón que una
herramienta reconozca, sino una propiedad del dominio: que ningún camino confirme un cobro sin la
consulta autenticada, que un consumidor no vea lo ajeno, que la firma se compare en tiempo
constante. Las cubren las reglas inviolables de CLAUDE.md, los tests del dominio y el checklist de
§5. Que el CI esté en verde no demuestra ninguna de ellas.

**Lo demás del pipeline:**

- `permissions: contents: read` en los workflows, y acciones fijadas por SHA.
- Dependabot con `cooldown`; los majors de runtime, fijados (Node 22 LTS).
- Secret scanning nativo y push protection de GitHub, activos: el repositorio es público.
  Gitleaks los complementa con las reglas propias del proyecto.
- Protección de `main`, desde el 2026-10-01: sin force push ni bypass, historia lineal y solo
  squash. Exige un único check, `compuerta-pr`, que agrega la calidad y toda la seguridad
  estática, y una aprobación de un code owner. Los hilos de revisión deben estar resueltos, una
  push nueva descarta las aprobaciones y la rama debe estar al día antes de fusionar. El autor
  no puede aprobar su propio PR, así que hace falta una segunda cuenta (ESTADO, decisión 22).

## 5. Checklist previo a cada merge

- [ ] ¿Ningún camino confirma un cobro sin detección del `PaymentWatcher`?
- [ ] ¿Ningún secreto real en código, tests, fixtures o docs?
- [ ] ¿El webhook valida HMAC sobre raw body antes de parsear?
- [ ] ¿Los datos persistidos respetan la minimización (regla #4 y #9)?
- [ ] ¿Las escrituras a Firestore son idempotentes?
- [ ] ¿El scraper sigue siendo estrictamente de solo lectura?
- [ ] ¿Alguna ruta nueva del contrato (`/api/v1/…`) deja que un consumidor
      confirme un pago, o vea un cobro que no es suyo?
- [ ] ¿Alguna respuesta del contrato le filtra a un consumidor identificadores
      o códigos del banco (el `detalle` técnico que sí ve el dueño)?
