# Secuencia de prompts para Claude Code — ManejoQRSimple

Copiar y pegar en orden. Antes de cada bloque nuevo: `/clear`. Para cualquier
prompt marcado con 🗺️, entrar primero en modo plan con `/plan`, revisar la
propuesta y recién después aprobar.

> **Actualización 2026-08-27 — riel Baneco.** El proveedor activo del desarrollo
> es **Banco Económico (API oficial)**, según las decisiones D1–D6 registradas en
> `docs/ESTADO.md` (decisión 9) y `docs/Integraciones/baneco/00-analisis-modulo-baneco.md`
> §7.1. El riel Yape BCP (scraping) queda **diferido** al final de este documento
> hasta contar con su documentación completa (D1). Toda la información necesaria
> vive en el repo: estas sesiones no requieren contexto externo.

---

## Preparación (una sola vez, en la terminal)

```bash
cd ~/ManejoQRSimple          # esta carpeta, ya poblada con docs y config
chmod +x .claude/hooks/*.sh
git init
git remote add origin git@github-segurolotengo:segurolotengopy/ManejoQRSimple.git
gh auth status               # verificar credenciales de GitHub
firebase login:list          # verificar cuenta alberdi.andres@gmail.com
claude
```

Dentro de Claude Code, primera vez:

```
/doctor
/agents        ← deben aparecer los 6 agentes
/hooks         ← debe aparecer no-secrets.sh
/permissions   ← revisar que cargó .claude/settings.json
```

Antes de la Sesión 2 (Hito B0), el dueño completa a mano en `.env` (nunca en
`.env.example` ni en el repo) las variables `BANECO_CERT_*` con los valores del
PDF oficial que está en `docs/Integraciones/baneco/privado-no-gh/`. Las de
producción NO se cargan en ninguna máquina hasta el pase formal (Hito B4).

---

## Sesión 1 — Verificación de contexto y fundación

**1.1 — Verificar el contexto**

```
Lee completos: CLAUDE.md, docs/01-arquitectura.md, docs/ESTADO.md,
docs/Integraciones/baneco/README.md, docs/Integraciones/baneco/
00-analisis-modulo-baneco.md y 01-preguntas-al-banco.md. Después resume en
15 líneas: cuál es el flujo del cobro, cuáles reglas no se pueden violar,
qué es fuente de verdad de un pago con Baneco (regla BANECO-1), qué
resolvieron las decisiones D1–D6, y qué está pendiente del dueño y del
banco. No escribas código todavía.
```

Si el resumen tiene algo mal, corregirlo ahora — todo lo que sigue depende de esto.

**1.2 🗺️ — Monorepo instalable (con riel Baneco incorporado)**

```
Crea el esqueleto del monorepo según docs/01-arquitectura.md §4 MÁS el
paquete nuevo @mqs/baneco-gateway (docs/Integraciones/baneco/
00-analisis-modulo-baneco.md §5): seis paquetes @mqs/* con su package.json,
tsconfig y un test trivial cada uno; eslint.config.mjs y
.dependency-cruiser.cjs que valide la regla de dependencias (qr-core no
importa a nadie; ningún adaptador importa a otro adaptador; Playwright solo
en yape-scraper; nada fuera de baneco-gateway conoce la API de Baneco).
Además: (a) redacta ADR-006 en docs/01-arquitectura.md §6 — adaptador API
oficial Baneco tras los puertos QrProvider/PaymentWatcher, ejecución como
proceso satélite (D2 opción b), sin webhook en la primera etapa (D3); (b)
aplica los impactos documentales del §8.2 del análisis (docs/02 §5, docs/06
amenaza T9, docs/07, tabla de CLAUDE.md); (c) agrega a .env.example, sin
valores, el bloque BANECO_*: BANECO_ENV=cert, BANECO_CERT_BASE_URL,
BANECO_CERT_USERNAME, BANECO_CERT_PASSWORD, BANECO_CERT_AES_KEY,
BANECO_CERT_ACCOUNT_CREDIT, BANECO_PROD_* (vacíos, comentados como
"solo Hito B4"), BANECO_QR_TTL_HORAS=72, BANECO_POLL_INTERVAL_SECONDS=180,
y los selectores de adaptador QR_PROVIDER=mock|baneco|yape y
PAYMENT_WATCHER=mock|baneco|yape-scraper que reemplazan al INTEGRATION_MODE
único (D1: multi-proveedor). Objetivo: npm ci && npm run lint && npm run
typecheck && npm test && npm run deps:check en verde. No implementes
dominio ni cliente HTTP todavía.
```

**1.3 — Primer commit, GitHub y protecciones**

```
Haz el commit inicial y súbelo a origin/main. Verifica ANTES con `git
status --ignored` que docs/Integraciones/baneco/privado-no-gh/ queda
ignorado y que ningún archivo del commit contiene credenciales (gitleaks
local). Después configura con gh: branch protection en main (checks
obligatorios: verify y gitleaks; historia lineal; sin force push),
squash-merge único, Dependabot alerts y security fixes. Mismo procedimiento
que los proyectos hermanos (ver docs/ESTADO.md decisión 6). Reporta el
resultado real de cada paso.
```

**1.4 — Cierre**

```
/actualizar-estado
```

---

## Sesión 2 🗺️ — Hito B0: validación de contrato contra certificación Baneco

Requiere `.env` con `BANECO_CERT_*` cargado (ver Preparación). No requiere
dominio implementado.

```
Hito B0 según docs/Integraciones/baneco/00-analisis-modulo-baneco.md §8.3 y
los supuestos de trabajo al pie de 01-preguntas-al-banco.md. Crea
tools/baneco-b0/: script TypeScript autónomo (tsx, sin dependencia de los
workspaces, sin librerías nuevas — solo node:crypto y fetch nativo),
ejecutable con `npm run baneco:b0`, que lea BANECO_CERT_* de .env y, contra
EXCLUSIVAMENTE la URL base de certificación:
1. Valide el esquema de cifrado: cifra "1234" localmente (AES-256-CBC,
   PKCS7, IV aleatorio de 16 bytes antepuesto, Base64) y contrasta ambas
   direcciones con GET /api/authentication/encrypt y /decrypt del ambiente
   de certificación. Deben cuadrar ida y vuelta.
2. Autentique (password cifrado con la llave de cert), decodifique el JWT
   sin verificar firma y registre su exp (vigencia real — pregunta B1).
3. Genere un QR de prueba: singleUse=true, modifyAmount=false, BOB, monto
   1.00, dueDate a 72 horas, transactionId "B0-<fecha>-<n>". Guarde qrId y
   la imagen decodificada en tools/baneco-b0/out/ (carpeta git-ignored).
4. Consulte /api/qrsimple/v2/statusQR/{qrId} (esperado statusQrCode=0,
   aceptando también la variante statusQRCode) y guarde la respuesta cruda
   como fixture SANEADA (sin datos personales reales) en
   packages/baneco-gateway/fixtures/ para el Hito B1.
5. Pruebe cancelQR y re-consulte el estado (esperado 9). Repita cancelQR
   para registrar el comportamiento ante doble anulación (pregunta C5).
6. Sondee el máximo de dueDate aceptado por bisección (7, 30, 90, 365
   días…) generando y anulando QRs de prueba (pregunta C1).
7. Registre TODO responseCode/message observado (catálogo empírico,
   pregunta E1).
Reglas duras: jamás la URL ni credenciales de producción; ningún secreto en
logs, fixtures ni commits; si la autenticación de certificación falla
(pregunta A3: credenciales posiblemente compartidas), registra el hallazgo
y termina limpio sin reintentos agresivos. Salida obligatoria:
docs/Integraciones/baneco/02-hallazgos-certificacion.md con los hallazgos
fechados, y actualización de los supuestos de 01-preguntas-al-banco.md que
hayan quedado confirmados o refutados. Entrega por PR.
```

Cierre: `/actualizar-estado`. Si el banco ya respondió la batería de
preguntas, registrar las respuestas en `01-preguntas-al-banco.md` antes de
la sesión siguiente.

---

## Sesión 3 🗺️ — Dominio: cobros y máquina de estados (TDD)

```
Implementa en packages/qr-core, con TDD estricto:
1. Los tipos del Cobro y sus sub-objetos (cliente mínimo, QR versionado,
   evidencia) con Zod y montos en centavos enteros. El Cobro lleva campo
   provider ('baneco' | 'yape' | 'mock') desde el diseño (decisión D1) y el
   QR versionado lleva providerQrId opcional (qrId del banco).
2. La máquina de estados exacta de CLAUDE.md, con una única función de
   transición que valide transiciones legales y registre evidencia
   append-only. Estados terminales sin salida.
3. La política de vencimiento y renovación (qrVersion + 1, historial;
   vigencia corta por defecto, BANECO_QR_TTL_HORAS).
4. Tests: toda transición ilegal rechazada; VENCIDO→renovación conserva el
   cobro; CONFIRMADO/RECHAZADO/ANULADO sin salida; reloj inyectado.
Consulta a test-engineer para la tabla de casos antes de implementar.
```

## Sesión 4 🗺️ — Dominio: conciliación y puertos

```
Implementa la conciliación (AbonoDetectado × Cobro → PAGO_DETECTADO →
CONFIRMADO) y las cinco interfaces de puertos con sus adaptadores mock y
tests de contrato compartidos (docs/01 §6, ADR-002). La clave de
deduplicación la aporta el adaptador (regla inviolable #7): para Baneco es
`baneco:{qrId}:{transactionId}` (00-analisis §6.3); para el futuro scraper,
el hash fecha+monto+referencia. Casos obligatorios: duplicado no confirma
dos veces; ambigüedad o monto distinto → EN_REVISION (nunca redondeo
silencioso); comprobante jamás confirma (regla inviolable #1); una
notificación entrante sin corroboración del watcher jamás confirma (regla
BANECO-1).
```

## Sesión 5 🗺️ — Hito B1: @mqs/baneco-gateway contra fixtures

```
Implementa packages/baneco-gateway según 00-analisis-modulo-baneco.md §5.2
y §6, con los hallazgos de 02-hallazgos-certificacion.md como fuente de
verdad empírica: crypto/aes.ts (vectores de prueba propios + los validados
en B0), auth/token.ts (caché de JWT en memoria, renovación anticipada según
el exp medido, reintento único ante 401), client/qr.ts
(generateQR/cancelQR/statusQR/paidQR con Zod en cada borde, absorbiendo
statusQrCode/statusQRCode), schemas.ts, watcher/poller.ts (corroboración +
fallback periódico) y watcher/reconciler.ts (paidQR diario y al arranque).
Conversión de montos SOLO en el borde por aritmética entera (§6.2) con test
de propiedad de round-trip. Minimización (§6.4): senderName enmascarado,
jamás saldos. Tests contra las fixtures grabadas en B0 — ninguna llamada
viva en CI. Los tests de contrato de QrProvider y PaymentWatcher de la
Sesión 4 deben pasar en verde con este adaptador.
```

## Sesión 6 🗺️ — Satélite Baneco + Firestore (decisión D2, opción b)

```
Implementa el runner satélite del baneco-gateway con el mismo patrón del
scraper (docs/01 §5): proceso propio en la ThinkPad, promovible a OCI, que
ejecuta poller y reconciler y escribe detecciones a Firestore únicamente a
través de CobroRepository/EvidenceStore con credencial de servicio de
mínimo privilegio (docs/05 §4). Configuración por .env
(BANECO_POLL_INTERVAL_SECONDS, QR_PROVIDER/PAYMENT_WATCHER). Modo dry-run
por defecto (detecta y loguea sin escribir), npm run baneco:dry análogo a
scraper:dry. Idempotencia verificada con test de reinicio (re-lectura de
paidQR no duplica confirmaciones). Sin webhook en esta etapa (D3): no
expongas ningún endpoint entrante.
```

## Sesiones siguientes

En orden, cada una con `/plan` y cerrando con `/actualizar-estado`:

7. `wa-bridge`: verificar la API real de WhatsAppModular, implementar cliente
   y webhook de comprobantes con HMAC (docs/04).
8. `functions` + reglas de Firestore (docs/05) sobre emuladores; recordar que
   el cliente Baneco NO corre en Functions (D2: satélite; Spark sin salida a
   internet).
9. `demo-web`: crear cobro, ver estado, renovar QR (cancelQR + generateQR).
10. **Hito B2** — E2E en certificación (criterio: 00-analisis §8.3): cobro →
    QR por WhatsApp a número propio → pago simulado en cert (según respuesta
    A2 del banco) → detección por polling → CONFIRMADO → paidQR cuadra.
    Ramas: vencimiento+renovación y anulación.
11. **Hito B3 (webhook)** — solo si el dueño lo aprueba tras las respuestas
    D1/D2/D3 del banco (IPs, firma, reintentos): endpoint con token de ruta +
    allowlist + corroboración obligatoria vía statusQR; test adversarial de
    payload falsificado (debe quedar en candidato, jamás confirmar).
12. **Hito B4** — pase a producción del demo: requiere certificación formal
    del banco (pregunta A1), credenciales de producción cargadas solo en el
    entorno de ejecución del satélite, y checklist completo de CLAUDE.md.

Antes de cada merge a main: `/revisar-seguridad`.

---

## Riel Yape BCP — DIFERIDO (decisión D1, 2026-08-27)

Se retoma cuando exista documentación completa del integrador. Los prompts
originales se conservan:

**Mapeo de la consola Yape BCP (requiere capturas del dueño)**

```
Con las capturas de docs/consola-yape/, usa scraper-yape para completar el
mapa de docs/03 §6 (URLs, selectores, campos, formatos de fecha y monto).
Propón la decisión Variante A/B del origen del QR (docs/03 §5) con pros y
contras para que el dueño decida. No escribas código del scraper hasta que
el mapa esté aprobado.
```

**yape-scraper** contra fixtures (TDD) + `scraper:login` + `scraper:dry` real,
implementando `PaymentWatcher` con los mismos tests de contrato ya en verde
para mock y baneco-gateway.
