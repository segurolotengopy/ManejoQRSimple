# ManejoQRSimple — Cobros por QR Simple (Bolivia)

Sistema **modular** de cobros mediante QR sobre la billetera **Yape (BCP Bolivia)**,
bajo el estándar interoperable de pagos QR del BCB. Genera y renueva QRs de cobro,
los envía a los clientes por WhatsApp (vía **WhatsAppModular**), recibe sus
comprobantes y **confirma cada pago leyendo la consola web de la billetera**
mientras no exista una API oficial del banco. Proyecto independiente —
Bolivia (+591). Dueño: Andres Alberdi.

Este es un **entorno de demostración**: no va a producción hasta contar con las
API oficiales. Las reglas de negocio y de seguridad son reales y completas.

**Un cobro marcado como pagado que no existe en el banco es fraude, no un bug.**
Prioriza corrección y seguridad sobre velocidad, siempre.

---

## Fuente de verdad

Lee el documento relevante antes de trabajar en un área. No asumas su contenido
de memoria si pasó tiempo desde la última lectura.

| Archivo | Úsalo para... |
| :---- | :---- |
| `docs/01-arquitectura.md` | Módulos del monorepo, puertos, flujo del cobro, ADRs vigentes. |
| `docs/02-qr-simple-bolivia.md` | Qué es QR Simple/QR BCB, ciclo de vida y vencimiento del QR, límites regulatorios a verificar. |
| `docs/03-scraping-yape-bcp.md` | Estrategia y reglas de contención del scraper de la consola Yape BCP. **Los selectores reales se mapean desde las capturas del dueño en `docs/consola-yape/` — nunca se inventan.** |
| `docs/04-integracion-whatsapp-modular.md` | Contrato con WhatsAppModular: envío del QR con datos del cobro y recepción del comprobante. |
| `docs/05-firebase-demo.md` | Proyecto Firebase ManejoQRSimple, Firestore, Functions, Hosting, emuladores y reglas de seguridad. |
| `docs/06-seguridad.md` | Modelo de amenazas, gestión de secretos, checklist de seguridad. |
| `docs/07-plan-fases.md` | Fases del proyecto y criterios de salida de cada una. |
| `docs/Integraciones/baneco/` | Integración con Banco Económico (**línea principal** desde 2026-08-27): análisis del módulo, preguntas al banco y sus respuestas, manual saneado. La espec. oficial "Api Market v1.3.0" gobierna y vive en `privado-no-gh/` (git-ignored). |
| `docs/ESTADO.md` | Bitácora de avance. **Leerla al empezar y actualizarla al cerrar cada sesión.** |

La documentación técnica de proveedores externos (BCP, BCB, Meta) va en
`docs/Integraciones/`, nunca suelta en la raíz de `docs/`. Las capturas de la
consola Yape van en `docs/consola-yape/`.

---

## Comandos

```bash
npm ci                    # instalar
npm run dev               # demo-web + emuladores de Firebase
npm test                  # Vitest, toda la suite (objetivo: < 10 s)
npm run lint              # ESLint (--max-warnings=0)
npm run typecheck         # tsc --noEmit en todos los paquetes
npm run build
npm run scraper:dry       # yape-scraper en modo lectura sin escritura a Firestore
npm run satelite:baneco   # satélite de Baneco (--una para una sola pasada)
npm run test:emulador     # tests de integración contra el emulador de Firestore
npm run demo              # demo local completo sin banco (ver tools/demo-local)
npm run api               # API HTTP del demo (ver packages/functions)
```

Antes de cualquier commit: `npm run typecheck && npm run lint && npm test` deben pasar.

---

## Stack

Node.js 22 LTS · TypeScript estricto · npm workspaces · Zod · Vitest ·
Playwright (solo en `yape-scraper`) · Firebase (Firestore + Functions + Hosting,
proyecto **ManejoQRSimple**, cuenta alberdi.andres@gmail.com) · React + Vite en `demo-web`.

## Estructura

```
packages/qr-core/         Dominio puro. NO importa nada. Cobros, QRs, máquina
                          de estados, conciliación, política de vencimiento.
packages/baneco-gateway/  Adaptador de la API oficial de Banco Económico
                          (QrProvider + PaymentWatcher). Único paquete que
                          conoce esa API. Corre como satélite (ADR-006).
packages/yape-scraper/    Adaptador Playwright de la consola Yape BCP.
                          SOLO LECTURA. Corre en la ThinkPad del dueño
                          (Fase 2: promovible a VM OCI — ver ADR-003).
packages/firestore-store/ Adaptadores CobroRepository y EvidenceStore sobre
                          Firestore. Único paquete que conoce el SDK de
                          Firebase; recibe la conexión inyectada (ADR-007).
packages/composicion/     Raíz de composición compartida: elige los adaptadores
                          por QR_PROVIDER / PAYMENT_WATCHER y arma los puertos.
packages/baneco-satelite/ Proceso que verifica los pagos contra Baneco y los
                          concilia (ADR-006, D2 opción b). Sin reglas de negocio.
packages/wa-bridge/       Cliente de WhatsAppModular (envío de QR, recepción
                          de comprobantes por webhook).
packages/functions/       Cloud Functions: API HTTP del demo y triggers Firestore.
packages/demo-web/        Consola del comerciante (React + Vite, Firebase Hosting).
docs/                     Documentación (ver docs/00-INDICE.md)
```

**Regla de dependencias:** `qr-core` no importa a nadie. Ningún adaptador importa
a otro adaptador. Nada fuera de `yape-scraper` importa Playwright ni conoce la
consola del banco. Nada fuera de `baneco-gateway` conoce la API de Baneco. Nada
fuera de `wa-bridge` llama a WhatsAppModular. Nada fuera de `firestore-store`
importa el SDK de Firebase. Se valida en CI (`npm run deps:check`).

---

## Reglas de negocio inviolables

El código debe hacerlas **imposibles de violar**, no solo evitarlas.

1. **La única fuente de verdad de un pago es la consola de la billetera** (y en el
   futuro, la API oficial). Un comprobante enviado por el cliente **jamás**
   transiciona un cobro a `CONFIRMADO`: es evidencia auxiliar y disparador de
   verificación. El comprobante falsificado es el vector de fraude nº 1 de este dominio.
1bis. **BANECO-1 — el webhook del banco tampoco confirma.** El webhook
   `notifyPaymentQR` de Banco Económico es un **disparador de verificación**, no una
   confirmación: llega sin autenticar y cualquiera que conozca la URL puede
   falsificarlo. Solo la consulta saliente autenticada (`statusQR`, `paidQR`)
   transiciona un cobro. Mismo razonamiento que la regla #1 aplicada al comprobante.
2. **Credenciales bancarias: nunca.** Ni en el repo, ni en `.env`, ni en logs, ni
   en Firestore, ni en tests. El login en la consola lo hace el dueño a mano; el
   scraper solo reutiliza el `storageState` de Playwright, que vive **fuera del
   repo** (`~/.manejoqr/`, permisos 600) y jamás se versiona ni se sube a la nube.
3. **El scraper es de SOLO LECTURA.** Navega y lee movimientos. Nunca ejecuta
   acciones transaccionales (transferir, aprobar, cambiar configuración) en la
   consola. Si una función nueva requiere "hacer clic en algo que modifica",
   se detiene y se consulta al dueño.
4. **Minimización de datos bancarios:** de la consola solo salen hacia Firestore
   monto, moneda, fecha/hora, referencia/glosa y un hash de deduplicación.
   Nunca saldos de cuenta, nombres de terceros ajenos al cobro, ni capturas de
   pantalla de la consola.
5. **Montos en centavos enteros (BOB).** Nunca float, nunca string con coma.
6. **Todo QR tiene vencimiento explícito.** Nunca se envía un QR vencido. La
   renovación crea una **versión nueva** del QR sobre el mismo cobro
   (`qrVersion + 1`); el historial de QRs emitidos es append-only.
7. **Idempotencia de detección:** el mismo abono visto en dos pasadas del scraper
   (o en re-lecturas tras un reinicio) produce **una sola** confirmación.
   Deduplicación por hash estable del movimiento (fecha + monto + referencia).
8. **Evidencia append-only:** cada transición de estado registra timestamp,
   origen (scraper, webhook WA, acción manual del dueño) y datos mínimos.
   Nunca se sobrescribe ni se borra un registro de evidencia.
9. **Datos personales de clientes: mínimos y enmascarados.** Teléfonos en logs
   siempre como `+591 7** ***56`. Nada de datos de clientes hacia analítica ni
   servicios de terceros.
10. **`crypto.randomInt()`, nunca `Math.random()`.** Comparaciones de tokens o
    firmas con `crypto.timingSafeEqual()`, nunca `===`.
11. **Nunca `any`.** Si no conoces el tipo, es `unknown` y lo estrechas. Todo
    input externo (webhook, API, fila scrapeada) se valida con Zod en el borde.
12. **No inventes selectores, URLs ni estructura de la consola Yape.** Solo se
    codifica lo que esté mapeado desde capturas o inspección real registrada en
    `docs/03-scraping-yape-bcp.md`. Si falta un dato, se pide al dueño una
    captura nueva — no se improvisa.

---

## Máquina de estados del cobro

```
BORRADOR → QR_ACTIVO → ENVIADO
    ENVIADO ──(watcher detecta abono)────────────► PAGO_DETECTADO → CONFIRMADO
    PAGO_DETECTADO ──(la conciliación rechaza)───► EN_REVISION
    ENVIADO ──(cliente envía comprobante)────────► COMPROBANTE_RECIBIDO
    COMPROBANTE_RECIBIDO ──(watcher detecta)─────► PAGO_DETECTADO
    COMPROBANTE_RECIBIDO ──(ventana agotada)─────► EN_REVISION
    QR_ACTIVO | ENVIADO ──(vence sin pago)───────► VENCIDO ──(renovar)──► QR_ACTIVO
    EN_REVISION ──(resolución manual del dueño)──► CONFIRMADO | RECHAZADO
    BORRADOR | QR_ACTIVO | ENVIADO | VENCIDO ────► ANULADO
```

- `PAGO_DETECTADO` = el watcher reportó un abono **candidato**. `CONFIRMADO` = el
  abono concilió contra el cobro: monto exacto, dentro de la vigencia (con
  tolerancia configurada), sin duplicado previo. Son dos estados a propósito:
  la detección es del adaptador; la conciliación es del dominio.
- Un abono detectado que **no** concilia (monto distinto, fuera de vigencia,
  duplicado) va a `EN_REVISION`, nunca se descarta en silencio ni se redondea
  para que entre. Es el mismo criterio del análisis Baneco §6.2.
- `CONFIRMADO`, `RECHAZADO` y `ANULADO` son terminales.
- La renovación tras `VENCIDO` no crea un cobro nuevo: incrementa `qrVersion`
  del mismo cobro y reenvía por WhatsApp. El QR anterior queda en el historial.
- Toda transición pasa por la función única de transición de
  `packages/qr-core/src/cobro/maquina-estados.ts`. **Ningún handler, trigger ni
  script modifica el estado directamente.**

---

## Arquitectura de puertos y adaptadores

Las integraciones externas viven detrás de interfaces en `packages/qr-core/src/ports/`:

`QrProvider` · `PaymentWatcher` · `MessagingProvider` · `CobroRepository` · `EvidenceStore`

- `QrProvider`: obtención/renovación del QR de cobro. Demo: carga asistida del QR
  generado por el dueño en Yape (ver docs/03 §5). Futuro: API oficial del banco.
- `PaymentWatcher`: detección de abonos. Demo: `yape-scraper`. Futuro: API oficial.
  **El dominio no sabe si detrás hay un scraper o una API** — esa es la garantía
  de que la migración no toca reglas de negocio (ADR-002).
- `MessagingProvider`: envío del QR + datos del cobro y recepción del comprobante.
  Implementación: `wa-bridge` contra WhatsAppModular.
- `CobroRepository` / `EvidenceStore`: Firestore, detrás de interfaz. Nada llama
  al SDK de Firebase fuera de los adaptadores.

La selección de adaptador es por variable de entorno (`QR_PROVIDER` / `PAYMENT_WATCHER`,
valores `mock|baneco|yape`), resuelta en `@mqs/composicion`.
Mocks y adaptadores reales comparten los mismos tests de contrato en
`packages/qr-core/src/ports/__tests__/`.

---

## Checklist antes de cerrar una tarea

Además de `npm run typecheck && npm run lint && npm test`:

1. ¿Alguna transición de estado quedó fuera de la función única de transición?
2. ¿Algún camino permite confirmar un cobro sin detección del `PaymentWatcher`?
3. ¿El cambio respeta la regla de dependencias entre paquetes (`deps:check`)?
4. ¿Quedó algún dato bancario o personal en logs, tests, fixtures o Firestore
   más allá del mínimo de la regla #4?
5. ¿Los selectores o URLs de la consola usados están respaldados por el mapeo
   de `docs/03-scraping-yape-bcp.md`?
6. ¿`.env.example` y la documentación reflejan variables o contratos nuevos?
7. ¿`docs/ESTADO.md` quedó actualizado si la sesión cambió decisiones o avance?

## Qué no hacer

- No agregues librerías sin justificarlo primero (y nunca una que toque
  la consola bancaria fuera de `yape-scraper`).
- No escribas lógica de negocio en componentes React, Cloud Functions ni en el
  scraper — va en `packages/qr-core`.
- No hagas commits que dejen tests en rojo, ni "arregles" un test para que pase
  una implementación.
- No uses la sesión bancaria real en tests ni en CI. Los tests del scraper corren
  contra fixtures HTML guardadas, jamás contra la consola viva.
- No despliegues a Firebase (`firebase deploy`) sin pedirlo explícitamente el dueño.
- No inventes campos, endpoints, selectores ni reglas que no estén en los
  documentos fuente. Ante contradicción entre un pedido y estos documentos,
  avisa en vez de improvisar.
