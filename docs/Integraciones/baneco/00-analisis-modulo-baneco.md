# Análisis — Módulo de cobros QR con Banco Económico (Baneco)

**Fecha:** 2026-08-27 · **Autor:** análisis de sesión Cowork para el dueño del proyecto
**Alcance solicitado:** (1) generar QRs de un solo uso con monto fijo; (2) validar que el
monto haya sido pagado en la cuenta destino del QR.
**Fuentes:** los cuatro documentos entregados por el dueño (ver §2) + docs propios del
proyecto (01, 02, 06, 07, CLAUDE.md).

---

## 1. Resumen ejecutivo

Banco Económico S.A. ofrece una **API oficial REST** ("API Market", espec. v1.3.0 del
28-abr-2025) que cubre **por completo y de forma nativa** los dos requisitos:

1. **QR de un solo uso con monto fijo:** `POST /api/qrsimple/generateQR` con
   `singleUse=true` y `modifyAmount=false`. El banco rechaza pagos con importe distinto
   y consume el QR tras el primer pago. Existe además `DELETE /api/qrsimple/cancelQR`
   para anularlo mientras esté pendiente.
2. **Validación del pago en la cuenta destino:** tres mecanismos complementarios —
   webhook `notifyPaymentQR` (push), `GET /api/qrsimple/v2/statusQR/{qrId}` (consulta
   activa) y `GET /api/qrsimple/v2/paidQR/{fecha}` (conciliación batch diaria). Como
   verificación de segundo nivel a nivel de cuenta existe `POST /api/accounts/history`
   (extracto de movimientos de la cuenta de abono).

**Implicación estratégica:** esto es, para Baneco, la **Fase 3 del plan (API oficial)
llegando antes de tiempo** — exactamente el escenario que ADR-002 preparó. El módulo se
implementa como un **adaptador nuevo** (`@mqs/baneco-gateway`) detrás de los puertos
`QrProvider` y `PaymentWatcher` ya definidos: `qr-core`, la máquina de estados y la
conciliación **no se tocan**. El scraper de Yape BCP queda como segundo proveedor (o en
pausa), sin conflicto arquitectónico.

**Los tres puntos críticos** que este análisis identifica y que condicionan el diseño:

- **El webhook del banco no trae firma ni autenticación en la especificación oficial.**
  Por lo tanto, igual que el comprobante de WhatsApp (ADR-005), el webhook **jamás
  confirma por sí solo**: dispara `PAGO_DETECTADO` y la confirmación se corrobora con
  una llamada saliente autenticada a `statusQR`. La regla inviolable #1 se extiende:
  *la única fuente de verdad es la respuesta del banco a una consulta nuestra*.
- **Los documentos entregados contienen credenciales de producción reales** (usuario y
  llave AES). La regla inviolable #2 aplica: **no se pueden commitear tal cual** al
  repositorio. Ver §8.1 antes de copiar cualquiera de los cuatro archivos a `docs/`.
- **Cloud Functions en plan Spark no puede hacer llamadas salientes** a
  `apimkt.baneco.com.bo`. Hay que decidir dónde corre el cliente HTTP (§7, decisión D2).

---

## 2. Inventario y fiabilidad de las fuentes

No todas las fuentes tienen el mismo peso. Gobernanza propuesta, coherente con la regla
"no inventar parámetros ni endpoints" de `docs/Integraciones/README.md`:

| Documento | Naturaleza | Peso |
|---|---|---|
| **Api Market Baneco v1.3.0 (PDF)** | Especificación técnica **oficial** del banco (historial de versiones 2021→2025). | **Gobierna.** Todo endpoint, campo y valor que se codifique debe estar aquí. |
| **"Baneco ambiente de producción para integración" (DOCX)** | Comunicación **oficial** del banco con credenciales y URL de producción. | Gobierna para datos de entorno. **Contiene secretos — no va al repo** (§8.1). |
| **Cobros QR Baneco (PPTX)** | Presentación comercial/introductoria del banco. | Contexto; no aporta contrato técnico adicional. |
| **"Manual Técnico de Integración" (MD)** | Documento **derivado, no oficial** (elaborado con asistencia de IA sobre las fuentes anteriores). Incluye ingeniería inversa del cifrado y una propuesta de infraestructura AWS/Cloudflare. | **Solo referencia.** Sus afirmaciones se verifican contra el PDF o contra el ambiente de certificación antes de codificarse. Su sección de infraestructura AWS **no aplica** a este proyecto (ADR-004: Firebase). También contiene las credenciales de producción — no va al repo tal cual. |

Puntos donde el manual derivado afirma más de lo que el PDF oficial documenta, y que
por tanto **deben validarse empíricamente en certificación** antes de darse por ciertos:

- **Esquema exacto del cifrado:** el PDF oficial solo dice "AES, llave de 256 bits
  (32 bytes)". El detalle `AES-256-CBC + PKCS7 + IV aleatorio de 16 bytes antepuesto +
  Base64` proviene del análisis del manual derivado. Es plausible y verificable de
  forma barata: cifrar localmente y contrastar con el endpoint utilitario
  `GET /api/authentication/encrypt` **del ambiente de certificación con la llave de
  certificación** (nunca con la de producción: la llave viaja en query string y
  quedaría en logs intermedios).
- La afirmación de que el banco "reintenta el webhook ante respuesta ≠200 o demora >5s"
  no consta en el PDF v1.3.0. Tratarla como no garantizada: el diseño no puede depender
  de reintentos del banco (por eso el polling y el batch son obligatorios, §5.3).

Discrepancias internas de la documentación oficial, a absorber en el borde con Zod:

- `statusQR`: la tabla nombra el campo `statusQRCode`; el ejemplo JSON usa
  `statusQrCode`. El schema debe aceptar ambos y normalizar.
- `currency`: el DOCX escribe `USB` donde el PDF dice `USD` (typo del DOCX).
- Los ejemplos de encrypt/decrypt del PDF apuntan al dominio `apimktdesa.bancavive.com.bo`
  mientras el resto usa `apimktdesa.baneco.com.bo`: nunca hardcodear dominios de
  ejemplos; siempre la URL base configurada por entorno.
- Casing de la URL base: certificación `/ApiGateway/`, producción `/apiGateway/`.
  Configurable, no derivable.

## 3. Cobertura del requisito 1 — QR de un solo uso con monto fijo

### 3.1 Generación

`POST {base}/api/qrsimple/generateQR` con `Authorization: Bearer <jwt>`. Parámetros
relevantes y su mapeo al dominio:

| Campo API | Regla de mapeo desde `qr-core` |
|---|---|
| `transactionId` (texto ≤30, único) | Identificador nuestro: `"{cobroId}-v{qrVersion}"` (validar longitud ≤30 en el borde). Es la llave de correlación banco↔dominio. |
| `accountCredit` (texto ≤10, **cifrado AES**) | Número de cuenta de abono del dueño, cifrado en el adaptador justo antes del envío. La cuenta en claro es config secreta (`BANECO_ACCOUNT_CREDIT`), jamás en Firestore ni logs. |
| `currency` = `"BOB"` | Fijo en la política del demo (el dominio ya trabaja en BOB). |
| `amount` (decimal, 2 dec., punto) | **Conversión centavos→decimal en el borde** (§6.2). El dominio sigue en centavos enteros (regla inviolable #5). |
| `description` (≤100) | Concepto del cobro, recortado a 100. |
| `dueDate` (`yyyy-MM-dd`) | Fecha de vencimiento del QR — el dominio ya la exige (regla #6). Política del dueño: la más extensa razonable (§7, D5). |
| `singleUse` = `true` | **Requisito 1.** Un único pago posible. |
| `modifyAmount` = `false` | **Requisito 1.** El banco rechaza el pago si el importe difiere — el monto fijo lo garantiza el banco, y la conciliación nuestra lo re-verifica (defensa en profundidad). |
| `branchCode` (≤5, opcional) | Opcional; útil si algún día hay multi-punto de venta. Omitir en el demo. |

Respuesta: `qrId` (identificador único del banco) + `qrImage` (PNG en Base64) +
`responseCode/message`. El adaptador persiste vía puertos: la imagen a Storage
(`imagenRef`, `hashImagen` — igual que hoy), y `qrId` como campo nuevo del QR versionado.

**Diferencia clave contra Yape:** el QR ya no se "carga asistido" desde la consola — lo
genera la API con monto y vencimiento exactos por cobro. El `QrProvider` de Baneco es
un QrProvider *pleno* (el primer proveedor que implementa el puerto completo).

### 3.2 Ciclo de vida y encaje en la máquina de estados

Mapeo de `statusQrCode` (0 activo, 1 pagado, 9 anulado) contra la máquina existente:

```
generateQR ok                          → QR_ACTIVO   (luego ENVIADO al salir por WhatsApp)
statusQrCode = 0                       → sigue ACTIVO/ENVIADO (sin transición)
statusQrCode = 1  (+ objeto payment)   → PAGO_DETECTADO → conciliación → CONFIRMADO
statusQrCode = 9                       → coherente con ANULADO (tras cancelQR nuestro)
dueDate alcanzada sin pago             → VENCIDO (transición por reloj del dominio, como hoy)
```

- **Renovación tras `VENCIDO`** (regla #6): `cancelQR` del QR anterior **si sigue
  pendiente** (la API solo permite anular `singleUse=true` no pagado — exactamente
  nuestro caso) y `generateQR` nuevo con el mismo cobro → `qrVersion + 1`, historial
  append-only intacto, reenvío por WhatsApp. Mismo flujo que hoy, con la ventaja de que
  ahora la renovación es programática.
- **`ANULADO`:** la transición de dominio dispara `cancelQR` en el banco (efecto
  externo idempotente: si el banco responde "ya anulado/inexistente", se registra y no
  se reintenta). Importante para que un QR anulado en el sistema no siga siendo pagable.
- Ninguna transición se hace directa: todo pasa por la función única de
  `maquina-estados.ts`, como exige CLAUDE.md. El adaptador solo *propone* eventos.

## 4. Cobertura del requisito 2 — Validación del pago en la cuenta destino

La API ofrece un esquema de validación en **tres capas**, que calza notablemente bien
con la separación `PAGO_DETECTADO` (detección, del adaptador) vs `CONFIRMADO`
(conciliación, del dominio):

### 4.1 Capa 1 — Webhook `notifyPaymentQR` (push, tiempo casi real)

El comercio publica `POST /api/qrsimple/notifyPaymentQR`; el banco lo invoca al
acreditarse el pago, con el objeto `PaymentQR` (qrId, transactionId del banco, fecha,
hora, moneda, importe, banco origen, nombre del pagador, cuenta ofuscada, glosa).
Respuesta esperada: `{"responseCode": 0, "message": ""}` inmediata.

**Análisis de seguridad — el punto más delicado del diseño.** La especificación v1.3.0
**no define firma, HMAC, mTLS ni token** para este endpoint. Un tercero que descubra la
URL puede enviar un `PaymentQR` falso perfectamente formado. Es el equivalente exacto
del comprobante falsificado (amenaza T1 de docs/06), ahora en formato JSON. Por lo tanto:

> **Regla de diseño BANECO-1 (extensión de la regla inviolable #1 y de ADR-005):**
> el webhook **nunca** transiciona un cobro a `CONFIRMADO`. Su único efecto es
> `PAGO_DETECTADO` *candidato* + disparo inmediato de la corroboración activa
> (capa 2). La fuente de verdad es siempre la **respuesta del banco a una consulta
> saliente autenticada nuestra**, nunca un POST entrante.

Mitigaciones adicionales del endpoint (defensa en profundidad, no sustituto de la regla):
ruta con segmento secreto no adivinable (`/hooks/baneco/<token-aleatorio>`), allowlist
de IPs de origen (solicitar al banco sus rangos públicos — dato pendiente, §9),
rate-limiting, validación Zod estricta del payload, y registro de todo intento
rechazado como evidencia.

### 4.2 Capa 2 — Consulta activa `GET /api/qrsimple/v2/statusQR/{qrId}` (la fuente de verdad)

Llamada autenticada (JWT sobre TLS contra el dominio del banco): devuelve
`statusQrCode` y, si está pagado, la lista `payment` con los datos del abono. Esta es
la llamada que **sí** habilita la conciliación:

```
conciliar(cobro, payment) — en qr-core, sin cambios de fondo:
  payment.qrId        == qr vigente del cobro (qrId de la versión actual)
  payment.currency    == BOB
  round(payment.amount * 100) == cobro.montoCentavos   (exacto; modifyAmount=false ya
                                                        lo garantiza banco-side, se
                                                        re-verifica igual)
  payment.transactionId (del banco) no visto antes      (idempotencia, §6.3)
  → CONFIRMADO. Cualquier desviación → EN_REVISION con evidencia completa.
```

Usos del polling: (a) corroboración inmediata tras cada webhook; (b) fallback
periódico para cobros `ENVIADO`/`COMPROBANTE_RECIBIDO` con QR vigente (intervalo
moderado, p. ej. 2–5 min, configurable — es una API formal, no una consola scrapeada:
el ritmo puede ser mayor que el del scraper, pero sigue siendo cortés); (c) refresco
manual desde demo-web.

### 4.3 Capa 3 — Conciliación batch `GET /api/qrsimple/v2/paidQR/{yyyyMMdd}` (cierre de caja)

Una vez al día (y al re-arrancar tras una caída) se listan **todos** los QR pagados de
la fecha y se contrastan contra Firestore. Detecta pagos cuyo webhook se perdió y cuyo
polling no alcanzó (p. ej. sistema caído). Toda discrepancia genera evidencia y, si
corresponde, la detección tardía sigue el mismo camino `PAGO_DETECTADO → conciliación`.

### 4.4 Capa opcional — `POST /api/accounts/history` (verificación a nivel de cuenta)

El requisito 2 pide validar el pago "en la cuenta destino". Las tres capas anteriores
validan a nivel de **QR** (que es lo que el banco liquida contra la cuenta indicada en
`accountCredit`). Para una verificación de segundo nivel a nivel de **extracto**, la API
de consulta de movimientos permite confirmar el crédito (`transactionType: "C"`, importe
positivo) en la cuenta. Recomendación: **no** incluirla en el flujo transaccional (añade
latencia y otra credencial cifrada en tránsito) y usarla solo como verificación batch
semanal o bajo sospecha, registrando únicamente el mínimo de la regla #4 (monto, fecha,
referencia — jamás saldos: `accountHeader.balance*` **no se persiste**).

## 5. Encaje arquitectónico

### 5.1 Nuevo paquete `@mqs/baneco-gateway`

```
                      ┌──────────────────────────────────────────┐
                      │              qr-core (dominio)           │
                      │        (SIN CAMBIOS DE REGLAS)           │
                      └───┬──────────────┬──────────────┬────────┘
                  ports:  │ QrProvider   │ MessagingP.  │ PaymentWatcher
                          │              │              │
             ┌────────────┴───────┐      │       ┌──────┴──────────────────┐
             │  baneco-gateway    │   wa-bridge  │  baneco-gateway         │
             │  (QrProvider LIVE) │              │  (PaymentWatcher LIVE)  │
             │  generateQR/cancel │              │  webhook + statusQR +   │
             └────────────────────┘              │  paidQR                 │
                          (yape-scraper queda como└─────────────────────────┘
                           implementación alternativa de PaymentWatcher)
```

- Un solo paquete que implementa **dos puertos** (igual que `yape-scraper` implementa
  `PaymentWatcher` y opcionalmente `QrProvider`) — permitido por la regla de
  dependencias: no importa a otros adaptadores, solo a `qr-core` (interfaces).
- **Único paquete que conoce la API de Baneco**, sus DTOs, su cifrado y sus URLs
  (misma disciplina que "nada fuera de `yape-scraper` conoce la consola").
- Comparte los **tests de contrato** existentes de
  `packages/qr-core/src/ports/__tests__/` — ese era el propósito declarado de ADR-002,
  y este módulo es su primera validación real.
- Selección por configuración: `INTEGRATION_MODE` evoluciona de `mock|demo` a una
  selección por puerto, p. ej. `QR_PROVIDER=mock|yape|baneco` y
  `PAYMENT_WATCHER=mock|yape-scraper|baneco`. (Multi-proveedor *simultáneo* por cobro
  es una decisión de alcance del dueño — §7, D1.)

### 5.2 Subcomponentes internos del paquete

```
packages/baneco-gateway/src/
  crypto/aes.ts          cifrado AES-256-CBC IV-prepended (crypto nativo de Node;
                         crypto.randomBytes(16) para el IV — regla #10)
  auth/token.ts          POST /authenticate; caché del JWT en memoria con renovación
                         anticipada y reintento único ante 401 (la vigencia exacta del
                         token no está documentada — medirla en certificación)
  client/qr.ts           generateQR / cancelQR / statusQR / paidQR (Zod en cada borde)
  watcher/webhook.ts     handler del webhook (validación + evento candidato, sin lógica
                         de negocio — la lógica vive en qr-core)
  watcher/poller.ts      corroboración post-webhook + fallback periódico
  watcher/reconciler.ts  job diario paidQR
  schemas.ts             DTOs Zod (absorben statusQrCode/statusQRCode, etc.)
```

`functions` solo *expone* el endpoint HTTP del webhook y orquesta (como hace con
wa-bridge); las reglas siguen en `qr-core`.

## 6. Decisiones técnicas de implementación

### 6.1 Cifrado y credenciales

- `password` (login) y `accountCredit`/`accountCode` viajan cifrados con la llave AES
  del entorno. Implementación local con `node:crypto` (sin librerías nuevas — coherente
  con "no agregar librerías sin justificar"); el endpoint utilitario del banco se usa
  **una sola vez, en certificación**, para validar la compatibilidad del esquema.
- Secretos nuevos y su custodia (extiende la tabla de docs/06 §2):

| Secreto | Dónde vive | Dónde JAMÁS |
|---|---|---|
| `BANECO_USERNAME` / `BANECO_PASSWORD` | `.env` local / Secret Manager | Repo, logs, Firestore, fixtures |
| `BANECO_AES_KEY` (cert y prod, distintas) | `.env` local / Secret Manager | Repo, URLs de herramientas, chat |
| `BANECO_ACCOUNT_CREDIT` (cuenta en claro) | `.env` local / Secret Manager | Repo, Firestore, logs (ni ofuscada) |
| Token del path del webhook | `.env` / Secret Manager | Repo |

- `.env.example` se actualiza con las variables **sin valores** (regla de docs/06) más
  `BANECO_BASE_URL` por entorno.
- Regla de gitleaks: agregar detección genérica de llaves de 32 hex en mayúsculas
  asignadas a variables `*AES*`/`*KEY*` (patrón genérico — **jamás** poner la llave real
  en `.gitleaks.toml`, eso sería el leak).
- El JWT del banco no se persiste (memoria de proceso) y no se loguea.

### 6.2 Montos: centavos enteros ↔ decimal API

La regla #5 (centavos enteros, nunca float) se preserva convirtiendo **solo en el borde**:

- **Salida** (generateQR): construir el decimal por aritmética entera —
  `${Math.trunc(c/100)}.${String(c%100).padStart(2,'0')}` — y serializarlo como número
  JSON con test de propiedad que garantice round-trip exacto para el rango operativo.
  Nunca `centavos/100` a secas dentro de la lógica.
- **Entrada** (webhook/statusQR/paidQR): `Math.round(amount * 100)` con verificación de
  que `amount` tiene ≤2 decimales (Zod refine); cualquier valor anómalo → `EN_REVISION`,
  nunca redondeo silencioso.

### 6.3 Idempotencia (regla #7)

La deduplicación del mundo Yape usa hash(fecha+monto+referencia) porque la consola no
da un identificador. Baneco **sí** lo da: `payment.transactionId` (número de transacción
del banco) + `qrId`. La clave natural de deduplicación pasa a ser
`baneco:{qrId}:{transactionId}` como id de documento de detección — mismo mecanismo
estructural (id de documento = clave natural), mejor clave. Webhook repetido, polling
concurrente y re-lectura de paidQR colapsan en un solo candidato.

### 6.4 Minimización de datos (reglas #4 y #9)

Del objeto `PaymentQR` se persiste: monto, moneda, fecha/hora, `qrId`,
`transactionId` del banco, `senderBankCode` y glosa. **`senderName` completo del
pagador es dato personal de un tercero**: registrar enmascarado (misma política que
los teléfonos) o no registrarlo; `senderAccount` ya llega ofuscado por el banco y se
guarda tal cual llega. De `accounts/history` (si se usa): jamás persistir saldos.

### 6.5 Manejo de errores del banco

`responseCode != 0` ⇒ error con `message`. Catálogo de códigos **no documentado** en
v1.3.0 → construirlo empíricamente en certificación y registrarlo en
`docs/Integraciones/baneco/`. Toda respuesta no-cero en generateQR/cancelQR se
registra como evidencia y no transiciona estados.

## 7. Decisiones que corresponden al dueño (bloqueantes por diseño)

Estas no se improvisan; el análisis deja las opciones sobre la mesa:

- **D1 — Alcance del proveedor.** ¿Baneco *reemplaza* a Yape BCP como proveedor del
  demo (más simple: un solo proveedor activo, elegido por configuración), o el sistema
  se vuelve *multi-proveedor por cobro* (cada cobro nace asociado a un proveedor)?
  Recomendación técnica: empezar con selección por configuración (cambio mínimo:
  variables de entorno) y dejar el multi-proveedor por cobro como evolución — el modelo
  de datos solo necesita un campo `provider` en el cobro para no cerrar la puerta.
  Nota: son cuentas destino distintas (Yape/BCP vs cuenta Baneco) — decisión también
  comercial.
- **D2 — Dónde corre el cliente Baneco.** Cloud Functions con salida a internet exige
  plan **Blaze** (el criterio vigente es "sin billing mientras se pueda"). Opciones:
  (a) activar Blaze (costo ~0 al volumen del demo, pero rompe el criterio); (b) correr
  el cliente como **proceso satélite** (patrón ya existente del scraper: ThinkPad/OCI
  escribe a Firestore vía repositorio con credencial mínima); (c) híbrido — satélite
  ahora, Functions cuando haya billing. La opción (b) reutiliza infraestructura y
  decisiones ya tomadas (ADR-003).
- **D3 — Exposición pública del webhook.** Ligada a D2: si no hay Functions públicas,
  el webhook del demo necesita un túnel/URL pública hacia el satélite (o se pospone el
  webhook y el demo vive de polling + batch, que la propia API considera suficiente —
  el webhook es "(Opcional)" en la espec.). Recomendación para el primer hito:
  **polling + paidQR sin webhook**; incorporar el webhook cuando exista un endpoint
  público estable. Reduce superficie de ataque y desbloquea antes.
- **D4 — Higiene de las credenciales recibidas.** Usuario, llave AES y (pronto) cuenta
  llegaron por documentos ofimáticos/correo. Custodiarlas ya en el gestor del dueño +
  `.env` local 600, purgar copias sueltas, y evaluar pedir al banco **rotación de la
  llave AES** antes del go-live real, dado que circuló en adjuntos.
- **D5 — Política de `dueDate`.** El requisito histórico es "vigencia lo más extensa
  posible". Con API, el vencimiento es por cobro y la renovación es programática: ¿se
  mantiene "lo más extenso que el banco permita" (límite real a descubrir en
  certificación) o se adopta una vigencia corta por cobro (p. ej. 72 h) ahora que
  renovar cuesta una llamada? La vigencia corta mejora la conciliación y reduce QRs
  huérfanos.
- **D6 — Certificación primero.** Todo el desarrollo se valida contra
  `apimktdesa.baneco.com.bo` con las credenciales de certificación del PDF; las de
  producción no se usan hasta el pase formal. ¿El banco exige un proceso/checklist de
  certificación formal antes de habilitar producción? (Preguntar al oficial de cuenta —
  pendiente §9.)

### 7.1 Resolución del dueño (2026-08-27)

| Decisión | Resolución |
|---|---|
| **D1** | El proyecto **se concibe multi-proveedor** (campo `provider` por cobro desde el diseño de Fase 0); el desarrollo continúa **solo con Baneco** hasta contar con documentación completa de otro integrador (Yape, etc.). |
| **D2** | **Opción (b): proceso satélite** (patrón del scraper, ThinkPad→OCI, escritura a Firestore vía repositorio con credencial mínima). Escalar a (a) Functions+Blaze solo si resulta necesario. |
| **D3** | **Se adopta la recomendación:** primera etapa sin webhook — polling de `statusQR` + conciliación diaria `paidQR`. |
| **D4** | Los adjuntos del banco **quedan fuera de GitHub** y permanecen en la ThinkPad (`docs/Integraciones/baneco/privado-no-gh/`, git-ignored). Sin rotación de llave por ahora (superficie de riesgo acotada). |
| **D5** | **Vigencia corta** por cobro (72 h por defecto, configurable). |
| **D6** | Se pregunta al banco: batería formal en `01-preguntas-al-banco.md`. |

## 8. Impacto en el repositorio y la documentación

### 8.1 Ingesta segura de los documentos del banco (previo a todo)

Los cuatro archivos van a `docs/Integraciones/baneco/`, **pero**: el DOCX y el MD
contienen usuario y llave AES de producción en claro (el MD además en su sección
DevSecOps). Antes de commitear: guardar los originales fuera del repo (junto al
gestor de secretos del dueño) y versionar **copias saneadas** con los valores
sustituidos por `<<SECRETO — ver gestor>>`. El PDF y el PPTX no contienen secretos
(las credenciales del PDF son las de certificación, que el banco publica en la espec —
aun así, tratarlas como sensibles y no citarlas fuera de `Integraciones/`).

> **Actualización por D4 (2026-08-27):** el dueño decidió que **los cuatro adjuntos
> originales** quedan fuera de GitHub, en `privado-no-gh/` (git-ignored). Al repo solo
> se versionan los documentos propios (este análisis, `01-preguntas-al-banco.md`,
> `README.md`) y la copia saneada del manual derivado. Ver `README.md` de esta carpeta.

### 8.2 Cambios documentales derivados

| Documento | Cambio |
|---|---|
| `docs/01-arquitectura.md` | Nuevo **ADR-006**: adaptador API oficial Baneco detrás de los puertos; convivencia con yape-scraper; decisión D1/D2 cuando el dueño la tome. |
| `docs/02-qr-simple-bolivia.md` | §5 "Camino a la API oficial": Baneco es la primera API oficial disponible; actualizar. |
| `docs/07-plan-fases.md` | La Fase 3 se bifurca por proveedor: para Baneco la "salida del scraping" ya es posible; para Yape sigue esperando API del BCP. |
| `docs/05-firebase-demo.md` | Resultado de D2/D3 (Blaze o satélite; endpoint del webhook si se adopta). |
| `docs/06-seguridad.md` | Amenaza nueva **T9: webhook bancario falsificado** (control: regla BANECO-1 + allowlist + token de ruta); tabla de secretos ampliada (§6.1). |
| `CLAUDE.md` | Tabla fuente-de-verdad: fila para `docs/Integraciones/baneco/`; regla de negocio: el webhook de Baneco no confirma — solo `statusQR`/`paidQR` confirman. |
| `.env.example` | Variables `BANECO_*` sin valores. |

### 8.3 Plan de implementación propuesto (hito por hito, sin fechas)

1. **Hito B0 — Ingesta y validación de contrato.** Docs saneados a
   `docs/Integraciones/baneco/`; script manual de certificación (fuera de CI) que:
   autentica, valida el esquema de cifrado contra el endpoint utilitario de cert,
   genera un QR de prueba, lo consulta y lo anula. Salida: esquema AES confirmado,
   catálogo inicial de `responseCode`, vigencia máxima real de `dueDate` y del JWT.
2. **Hito B1 — Paquete `baneco-gateway` contra mocks.** DTOs Zod, cifrado con vectores
   de prueba propios, cliente HTTP con fixtures grabadas de certificación (sin llamadas
   vivas en CI — misma regla que el scraper), tests de contrato de `QrProvider` y
   `PaymentWatcher` en verde.
3. **Hito B2 — Flujo E2E en certificación.** Cobro real de prueba: generateQR →
   WhatsApp (número propio) → pago simulado/real en cert si el banco lo permite →
   statusQR → CONFIRMADO → paidQR del día cuadra. Ramas: vencimiento+renovación
   (cancelQR+generateQR), anulación.
4. **Hito B3 — Webhook (si D3 lo aprueba).** Endpoint con token de ruta + allowlist +
   corroboración obligatoria; pruebas de payload falsificado (debe quedar en candidato
   y nunca confirmar).
5. **Hito B4 — Pase a producción del demo.** Solo tras D4 (custodia/rotación) y D6
   (certificación formal del banco), con las credenciales de producción cargadas
   exclusivamente en el entorno de ejecución elegido en D2.

Prerrequisito transversal: la **Fase 0 del monorepo sigue pendiente** (ESTADO.md:
el primer PR de fundación aún no existe). `baneco-gateway` necesita `qr-core` y sus
puertos reales; B1 en adelante depende de que la Fase 0 cierre. B0 no depende de código
y puede hacerse ya.

## 9. Información faltante a solicitar al banco

- Rangos de IP públicas desde los que invoca el webhook (para la allowlist).
- Catálogo oficial de `responseCode`/`message` de error.
- Vigencia del JWT y política de reintentos del webhook (el PDF no las documenta).
- Límite máximo real de `dueDate` y monto máximo por transacción QR (normativa
  BCB/ASFI + política Baneco) — completa los checkboxes de docs/02 §4 para este
  proveedor.
- Proceso formal de certificación/homologación previo a producción, si existe.
- Confirmación de si el ambiente de certificación permite simular pagos de QR
  (imprescindible para el Hito B2).

## 10. Riesgos principales

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | Webhook falsificado confirma un pago inexistente | **Fraude** (el peor caso del dominio) | Regla BANECO-1: webhook nunca confirma; corroboración statusQR obligatoria; allowlist + token de ruta; test adversarial en B3. |
| R2 | Credenciales de producción filtradas al repo | Compromiso de cuenta bancaria | §8.1 (saneado previo), gitleaks con patrón genérico, hook anti-secretos existente, custodia en gestor. |
| R3 | Esquema de cifrado asumido ≠ real | Bloqueo de integración | Validación empírica en B0 contra el endpoint utilitario de certificación. |
| R4 | Functions sin salida a internet (Spark) | El adaptador no puede llamar al banco | Decisión D2 antes de B2; opción satélite ya probada por ADR-003. |
| R5 | Pago sin webhook ni polling oportuno (caída) | Confirmación tardía | Capa 3 (paidQR diario + al re-arranque) garantiza cierre; evidencia de detección tardía. |
| R6 | Doble detección (webhook + polling + batch) | Doble confirmación | Idempotencia por `qrId+transactionId` como id de documento (§6.3). |
| R7 | Desalineación de montos por float | Conciliación errónea | §6.2: aritmética entera en el borde + tests de propiedad. |

---

## Conclusión

La API de Baneco cubre los dos requisitos de forma nativa y con garantías superiores a
las del camino por scraping: generación programática de QR de un solo uso con monto
inmodificable, y validación del pago por consulta autenticada más conciliación batch.
La arquitectura de puertos absorbe el módulo sin tocar el dominio — es la primera
materialización real de ADR-002. Las condiciones para empezar son tres: sanear los
documentos con credenciales antes de commitear (§8.1), resolver las decisiones D1–D3
(alcance, runtime y webhook), y cerrar la Fase 0 del monorepo, de la que depende todo
el código nuevo. El Hito B0 (validación de contrato en certificación) puede ejecutarse
de inmediato y de forma independiente.
