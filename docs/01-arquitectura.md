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

## 7. No-objetivos explícitos de la Fase 0–1

- Multi-comerciante / multi-cuenta (el demo opera la billetera del dueño).
- Devoluciones y contracargos automatizados.
- OCR del comprobante (solo se archiva como evidencia).
- Panel para el cliente final (el cliente solo interactúa por WhatsApp).
- Cualquier acción de escritura sobre la consola bancaria.
