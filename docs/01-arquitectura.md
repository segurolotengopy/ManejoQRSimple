# 01 — Arquitectura

## 1. Principios de diseño

1. **Modular y consumible por otros sistemas.** ManejoQRSimple no es una app:
   es un conjunto de módulos con contratos claros. Otros proyectos del dueño
   (actuales o futuros) deben poder usar `qr-core` y sus puertos
   sin arrastrar el scraper ni el demo.
2. **El dominio no conoce a los proveedores.** `qr-core` no sabe si los pagos
   los detecta un scraper de Playwright o una API del banco, ni si los mensajes
   salen por WhatsAppModular o por otro canal. Todo entra por puertos.
3. **El scraping es un adaptador temporal, no la arquitectura.** El día que
   exista API oficial (OpenBCB u oferta del BCP), se escribe un adaptador nuevo
   de `PaymentWatcher` y el resto del sistema no se toca (ADR-002).
4. **Cada operación con efecto externo es idempotente y observable.**
5. **Mínima fricción para el cliente final:** el cliente solo recibe un WhatsApp
   con el QR y los datos, paga desde su propia app bancaria, y opcionalmente
   responde con su comprobante. No instala nada, no se registra en nada.

## 2. Vista general

```
                         ┌──────────────────────────────────────────┐
                         │              qr-core (dominio)           │
                         │  cobros · QRs versionados · máquina de   │
                         │  estados · conciliación · evidencia      │
                         └───┬──────────────┬──────────────┬────────┘
                     ports:  │QrProvider    │MessagingProv.│PaymentWatcher
                             │CobroRepo     │              │
        ┌────────────────────┴───┐   ┌──────┴────────┐  ┌──┴─────────────────┐
        │ Firestore (adaptador)  │   │  wa-bridge    │  │   yape-scraper     │
        │ estado + evidencia     │   │ WhatsAppModular│ │ Playwright, SOLO   │
        └────────────────────────┘   │ envío QR /    │  │ LECTURA. ThinkPad  │
                                     │ webhook compr.│  │ → OCI (ADR-003)    │
                                     └───────┬───────┘  └──┬─────────────────┘
                                             │             │
                                        Cliente (+591)   Consola web Yape BCP
```

`functions` expone la API HTTP del demo y los triggers de Firestore;
`demo-web` es la consola del comerciante (crear cobro, ver estado, renovar QR).

## 3. Flujo del cobro (camino feliz)

1. El dueño crea un **cobro** en demo-web: cliente (nombre + teléfono), monto
   en BOB, concepto, vigencia deseada.
2. `QrProvider` asocia al cobro el **QR vigente** de la billetera (ver docs/03 §5
   por las dos variantes: carga asistida o generación por consola).
3. `MessagingProvider` (wa-bridge → WhatsAppModular) envía al cliente el QR con
   los datos del cobro. Estado: `ENVIADO`.
4. El cliente paga desde su propia app bancaria escaneando el QR.
5. Dos caminos convergentes, en cualquier orden:
   - El cliente responde con su **comprobante** → webhook de wa-bridge →
     `COMPROBANTE_RECIBIDO`. El comprobante NUNCA confirma (regla inviolable #1);
     acelera la conciliación y sirve de evidencia auxiliar.
   - `yape-scraper` detecta el **abono** en la consola → `PAGO_DETECTADO`.
6. `qr-core` **concilia**: monto exacto, vigencia, sin duplicados →
   `CONFIRMADO`. wa-bridge envía al cliente la confirmación de pago recibido.
7. Si el QR vence sin pago: `VENCIDO` → renovación (`qrVersion + 1`) → reenvío.

La máquina de estados completa, con los caminos de excepción (`EN_REVISION`,
`RECHAZADO`, `ANULADO`), está en `CLAUDE.md` y gobierna la implementación de
`packages/qr-core/src/cobro/maquina-estados.ts`.

## 4. Módulos del monorepo

| Paquete | Responsabilidad | Restricciones |
|---|---|---|
| `@mqs/qr-core` | Dominio puro: cobros, QRs versionados, máquina de estados, conciliación, políticas (vencimiento, tolerancias), puertos | No importa nada. Sin I/O. Sin SDKs. |
| `@mqs/baneco-gateway` | Adaptador `QrProvider` + `PaymentWatcher` sobre la API oficial de Cobros QR Simple de Banco Económico (ADR-006) | Único paquete que conoce la API de Baneco: URLs, DTOs, cifrado y códigos. Corre como satélite. |
| `@mqs/yape-scraper` | Adaptador `PaymentWatcher` + (opcional, docs/03 §5) `QrProvider` sobre la consola Yape BCP con Playwright | Solo lectura. Único paquete con Playwright. Corre fuera de Firebase. |
| `@mqs/wa-bridge` | Adaptador `MessagingProvider`: cliente HTTP de WhatsAppModular + receptor de webhooks de comprobantes | Único paquete que conoce WhatsAppModular. |
| `@mqs/firestore-store` | Adaptadores `CobroRepository`, `EvidenceStore` y `AbonosSinConciliarStore` sobre Firestore (ADR-007) | Único paquete que conoce el SDK de Firebase. Recibe la conexión inyectada. |
| `@mqs/avisos-consumidor` | Adaptador `NotificadorConsumidor`: arma, firma (HMAC-SHA256) y entrega por HTTP el aviso de confirmación a un proyecto consumidor (docs/10 §4.6) | Único paquete que sabe que el aviso viaja por HTTP y con qué firma. Lo cablea solo `composicion`. |
| `@mqs/composicion` | Raíz de composición compartida: elige adaptadores por variable de entorno y arma los puertos | Sin reglas de negocio. La usan los procesos, nunca el dominio. |
| `@mqs/baneco-satelite` | Proceso satélite que verifica los pagos contra Baneco y los concilia (ADR-006) | Raíz de composición: cablea puertos y repite. Sin reglas de negocio. Corre fuera de Firebase. |
| `@mqs/functions` | Cloud Functions: API HTTP del demo, triggers de Firestore, endpoint del webhook de wa-bridge | Orquesta; no contiene reglas de negocio. |
| `@mqs/demo-web` | Consola del comerciante: React + Vite sobre Firebase Hosting | Sin lógica de negocio; consume la API. |

**Regla de dependencias** (validada en CI con dependency-cruiser): `qr-core` no
importa a nadie; ningún adaptador importa a otro adaptador; `demo-web` solo
consume la API HTTP.

## 5. El scraper como proceso satélite

`yape-scraper` NO corre en Firebase: necesita la sesión bancaria autenticada del
dueño. Corre como proceso propio (ThinkPad en Fase 0–1, VM OCI en Fase 2) y se
comunica con el resto del sistema **solo** escribiendo detecciones en Firestore
a través de `CobroRepository`/`EvidenceStore` con una credencial de servicio de
**mínimo privilegio** (solo las colecciones que le corresponden — ver docs/05 §4).

Ciclo: cada `SCRAPER_POLL_INTERVAL_SECONDS` abre la consola con el
`storageState` persistido → lee los movimientos nuevos → normaliza → deduplica
por hash → escribe candidatos `PAGO_DETECTADO`. Si la sesión expiró, NO intenta
loguearse: notifica al dueño (por WhatsAppModular, plantilla interna) y espera.

## 6. Decisiones de arquitectura (ADR resumidos)

**ADR-001 — Monorepo npm workspaces (Node 22 + TS estricto).**
Mismo patrón que WhatsApp-Modular: módulos publicables por separado, un solo
lockfile, gates compartidos. Alternativa descartada: app Next.js única (estilo
segurolotengo-demo) — menos reutilizable por otros sistemas, que es requisito.

**ADR-002 — El scraping vive detrás del puerto `PaymentWatcher`.**
Contexto: no hay API del banco. Decisión: el dominio define la interfaz de
detección de pagos; el scraper es UNA implementación. Consecuencia: migrar a la
API oficial (OpenBCB del BCB apunta a APIs de pago estandarizadas; verificar
oferta concreta del BCP) es escribir un adaptador, no re-arquitecturar.
El mock, el scraper y la futura API comparten los mismos tests de contrato.

**ADR-003 — Ejecución del scraper: híbrido evolutivo (decisión del dueño, 14-ago-2026).**
Fase 0–1: ThinkPad del dueño — la sesión bancaria no sale de su máquina.
Fase 2 (cuando el demo requiera 24/7): promoción a OCI, con dos sub-opciones
documentadas: (B) co-hosteo en contenedor aislado en la VM existente
Odoo-Server-ProyectoA (patrón del laboratorio Evolution de WhatsApp-Modular;
cupo Ampere A1 ya consumido — no crear más A1) o (C) VM nueva `E2.1.Micro`
del Always Free (cupo separado del A1; 1 GB RAM, ajustado pero viable —
verificar disponibilidad en la tenancy). El paquete se diseña agnóstico al
lugar de ejecución: misma imagen, configuración por entorno, `storageState`
portable. Requisitos de promoción en docs/03 §7.

**ADR-004 — Firestore como almacén de estado y evidencia.**
Nativo del proyecto Firebase del demo, tiempo real para demo-web, reglas de
seguridad declarativas. La evidencia es append-only por convención de repositorio
+ reglas de Firestore que niegan update/delete en la colección de evidencia.
Alternativa descartada: DynamoDB (estilo segurolotengo-demo) — otra nube, sin
beneficio para este demo.

**ADR-005 — El comprobante no confirma; concilia la consola.**
Contexto: el comprobante que envía el cliente es una imagen trivial de
falsificar. Decisión: `COMPROBANTE_RECIBIDO` y `PAGO_DETECTADO` son estados
independientes; solo la detección en la consola (más conciliación de dominio)
lleva a `CONFIRMADO`. Consecuencia: un OCR de comprobantes, si algún día se
agrega, solo puede *acelerar* la búsqueda del abono, jamás sustituirla.

**ADR-006 — Baneco entra como adaptador de API oficial detrás de los mismos puertos
(decisión del dueño, 27-ago-2026).**
Contexto: apareció una API oficial real —Banco Económico, "Api Market v1.3.0",
Cobros QR Simple— que cubre de forma nativa lo que el scraping resolvía a mano:
generación de QR de un solo uso con monto fijo y verificación del pago.
Decisión: se implementa como paquete `@mqs/baneco-gateway` que satisface
`QrProvider` (generateQR/cancelQR) y `PaymentWatcher` (statusQR/paidQR), sin tocar
ninguna regla de `qr-core`. Es la **primera validación real de ADR-002**: cambiar de
scraping a API oficial resultó ser escribir un adaptador, tal como se había previsto.
Consecuencias:
- **Convivencia, no reemplazo.** `yape-scraper` sigue siendo una implementación
  alternativa de `PaymentWatcher`, hoy diferida (D1). La selección es por
  configuración y por puerto: `QR_PROVIDER` y `PAYMENT_WATCHER` reemplazan al
  `INTEGRATION_MODE` único, y cada cobro lleva un campo `provider`.
- **Ejecución como proceso satélite** (D2, opción b): mismo patrón que el scraper
  —ThinkPad hoy, OCI después—, escribiendo a Firestore por repositorio con
  credencial de mínimo privilegio. Se escala a Functions + Blaze solo si hace falta.
  Materializado en `@mqs/baneco-satelite`: **verifica y concilia, no emite ni
  renueva QRs** — la emisión la decide el dueño desde la consola, porque un proceso
  que renueva solo podría reemitir indefinidamente sobre un cobro que nadie va a pagar.
- **Primera etapa sin webhook** (D3): detección por polling de `statusQR` más
  conciliación diaria `paidQR`. La espec. marca el webhook como opcional.
- **Regla BANECO-1** (extiende ADR-005 al mundo Baneco): el webhook
  `notifyPaymentQR` del banco **jamás** confirma un pago — es un disparador de
  verificación. Solo la consulta saliente autenticada es fuente de verdad. El
  razonamiento es idéntico al del comprobante del cliente: lo que llega sin
  autenticar puede ser falsificado por cualquiera que conozca la URL.
- **Idempotencia mejorada** (regla #7): Baneco entrega identificadores propios, así
  que la clave natural de deduplicación pasa de un hash de fecha+monto+referencia a
  `baneco:{qrId}:{transactionId}`. Mismo mecanismo, mejor clave.

**ADR-007 — La persistencia es un adaptador más: `@mqs/firestore-store`.**
Contexto: `CobroRepository` y `EvidenceStore` necesitaban implementación real, y
sus dos consumidores son distintos — las Cloud Functions (dentro de Firebase) y
el satélite de Baneco (fuera, ADR-006/D2). Poner el adaptador dentro de
`packages/functions` habría obligado al satélite a importar el paquete de
despliegue de Functions para poder guardar un cobro.
Decisión: paquete propio `@mqs/firestore-store`, tratado como cualquier otro
adaptador. Es el **único** que conoce el SDK de Firebase, y la regla se valida en
CI igual que la de Playwright con `yape-scraper`.
Consecuencias:
- La conexión se **inyecta**: el adaptador recibe una `Firestore`, no la crea.
  Los tests corren contra el emulador y el satélite contra el proyecto real sin
  que el adaptador sepa la diferencia — y sin que exista un camino por el que un
  test termine escribiendo en el proyecto de verdad.
- **Append-only por construcción**: la evidencia y el historial de QRs se
  escriben con `create()`, que falla si el documento ya existe. No sobrescribir
  deja de ser algo que hay que acordarse de no hacer y pasa a ser algo que la
  base rechaza (reglas #6 y #8).
- Los tests de integración contra el emulador viven aparte
  (`*.emulador.test.ts`, `npm run test:emulador`) y **no corren en CI**: necesitan
  Java y firebase-tools. La suite de CI sigue siendo hermética.
- Alternativa descartada: que cada consumidor hablara con Firestore por su cuenta.
  Habría multiplicado el conocimiento del esquema y roto la premisa de ADR-002.

**ADR-008 — El contrato para consumidores es una superficie de la API, no un
paquete nuevo (2026-09-19).**
Contexto: el principio nº 1 de este documento decía que otros proyectos tienen
que poder usar el cobro sin arrastrar el scraper ni el demo. Llegó el primer
consumidor real (NovuChat) y hubo que decidir cómo se lo expone.
Decisión: un **prefijo propio en la API HTTP** (`/api/v1/cobros`), con su
identidad y sus handlers, sobre los mismos casos de uso del dominio. No un
paquete nuevo ni un SDK: lo que un consumidor necesita es un contrato estable
sobre la red, y un paquete lo ataría a nuestro runtime y a nuestro calendario
de versiones.
Consecuencias:
- **La identidad es un tipo, no un permiso.** `Identidad` es
  `{dueño} | {consumidor}`, y el enrutador decide por ella antes de mirar la
  ruta. Agregar una ruta sin decidir de qué lado está no compila. Un cruce
  responde 404 y no 403: un 403 confirmaría que la ruta del otro lado existe.
- **La asimetría es estructural, no una omisión.** El contrato no tiene
  operación de confirmación, y no puede tenerla sin una `ConciliacionAprobada`
  (ADR-005, BANECO-1). Un test recorre las rutas que no existen y exige 404:
  si alguna apareciera, el test la encuentra.
- **La idempotencia se apoya en el id, no en una búsqueda.** El id del cobro de
  un consumidor se deriva de `(consumidorId, referenciaExterna)` con SHA-256, y
  la creación es atómica (`CobroRepository.crear`). Un "buscar y si no existe
  crear" habría dejado una ventana por la que un reintento emite un segundo QR
  y le cobra dos veces al cliente del consumidor (regla #7).
- **Un cobro sin teléfono es un estado legítimo del dominio**, no un dato
  faltante: el envío al pagador es del consumidor. `enviarQr()` lo rechaza en
  vez de inventar un destinatario.
- Alternativa descartada: reutilizar `/api/cobros` con un campo "consumidor" en
  el cuerpo. Habría dejado a un token de consumidor a un descuido de distancia
  de `POST /api/cobros/:id/resolver`, que confirma cobros.

El contrato completo, con ejemplos, está en `10-contrato-consumidores.md`.

**ADR-009 — El aviso de confirmación es una bandeja de salida, y nunca bloquea
un cobro (2026-09-20).**
Contexto: el bloque 2 del contrato pide avisarle al consumidor cuando su cobro
queda confirmado. La tentación es hacer el POST dentro de la confirmación.
Decisión: **encolar dentro de la transición, entregar fuera**. `aplicar()`
encola el aviso en `AvisosStore` en cuanto el estado `CONFIRMADO` quedó
guardado; el satélite lo entrega en una pasada posterior, con reintentos.
Consecuencias:
- **Un consumidor caído no puede demorar ni hacer fracasar un cobro.** Si el
  POST viviera dentro de `verificarPago()`, un servidor que no responde
  bloquearía la conciliación de un pago que el banco ya reportó.
- **El orden importa y es al revés de lo intuitivo:** el aviso se encola
  *después* de que el estado quedó escrito, nunca antes. Un aviso de un pago
  que no llegó a registrarse haría que el consumidor entregue lo que vendió.
  Al revés —estado guardado y aviso perdido— el consumidor llega al mismo
  resultado por `estadoCobro`, que es lo que el contrato le promete. Por eso
  encolar tampoco puede hacer fracasar la transición: si falla, se informa y
  se registra.
- **Entrega "al menos una vez", con contenido fresco.** El aviso se arma
  leyendo el cobro y su evidencia *al enviarlo*, no de una copia guardada al
  encolar: una copia sería un segundo lugar donde desincronizarse, y podría
  anunciar un pago que después resultó otra cosa. Si el cobro ya no sostiene
  el aviso, no se entrega.
- **`idEvento` estable y firma obligatoria.** El consumidor deduplica por
  `idEvento`; la firma HMAC sobre el cuerpo crudo, con marca de tiempo
  adentro, es lo que impide que cualquiera que conozca su URL le invente un
  "te pagaron" (amenaza T15). Es el mismo esquema que docs/06 T5 exige para el
  webhook entrante, en la dirección opuesta.
- **Sin tope de intentos.** La espera crece hasta una vez por día y ahí se
  queda. Abandonar un aviso sería perderlo sin que nadie se entere; reintentar
  a diario no cuesta nada.
- Alternativa descartada: derivar los avisos pendientes barriendo los cobros
  confirmados. No hay dónde anotar "ya avisado" sin inventar un estado igual,
  y el barrido crecería con el historial.


## 7. No-objetivos explícitos de la Fase 0–1

- Multi-comerciante / multi-cuenta (el demo opera la billetera del dueño).
- Devoluciones y contracargos automatizados.
- OCR del comprobante (solo se archiva como evidencia).
- Panel para el cliente final (el cliente solo interactúa por WhatsApp).
- Cualquier acción de escritura sobre la consola bancaria.
