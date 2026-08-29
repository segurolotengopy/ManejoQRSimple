# 04 — Integración con WhatsAppModular

Contrato entre ManejoQRSimple (consumidor) y **WhatsAppModular** (plataforma de
mensajería del mismo dueño, repo `segurolotengopy/WhatsAppModular`). Gobierna
`packages/wa-bridge`. WhatsAppModular fue ampliado por decisión de su dueño para
mensajería de ida y vuelta genérica (no solo OTP) — este proyecto es su segundo
consumidor.

## 1. Qué necesita ManejoQRSimple de WhatsAppModular

1. **Envío saliente** de un mensaje con **imagen (el QR) + texto** (datos del
   cobro: comercio, concepto, monto, vencimiento, instrucciones) a un número
   +591.
2. **Recepción entrante** del comprobante del cliente (imagen o PDF + texto
   libre), correlacionada con el cobro.
3. **Notificaciones al dueño** (operativas): sesión del scraper expirada,
   cobro en `EN_REVISION`, pago confirmado.

## 2. Estado real de la API — verificado el 2026-08-27

Se leyó el repo de WhatsAppModular (`/home/andres-alberdi/WhatsApp-Modular`).
**El contrato que esta sección proponía no existe.** Lo que hay hoy:

### 2.1 Lo que SÍ está

- **Tipos de mensajería genéricos** en `@wm/core`
  (`packages/core/src/types/messaging.ts`), pensados explícitamente para
  consumidores distintos del OTP. `OutboundContent` ya contempla el caso que
  necesitamos:

  ```ts
  { kind: 'image',
    media: { type: 'url', url } | { type: 'base64', data, mimeType },
    caption?: string }
  ```

  Y `MessageEnvelope` lleva `to`, `content`, `correlationId` e
  `idempotencyKey` — justo lo que hace falta para no duplicar envíos.
- El puerto `MessagingProvider.send(envelope): Promise<ProviderResult>` en
  `packages/core/src/ports/messaging-provider.ts`.
- `@wm/whatsapp-adapter` con `WhatsAppCloudApiClient` y constructores de
  payload (`buildTextPayload`, `buildHeaderTemplatePayload`, `normalizePhone`).

### 2.2 Lo que NO está — los dos bloqueos reales

1. **No hay API HTTP de mensajería genérica.** Los únicos endpoints expuestos
   son `POST /v1/otp/request` y `POST /v1/otp/verify`
   (`packages/otp-service/src/http/app.ts`). El envío de imagen existe como
   **biblioteca**, no como servicio: un proceso externo como ManejoQRSimple no
   tiene hoy cómo invocarlo.
2. **El webhook entrante no entiende imágenes.** `InboundMessage.content` solo
   admite `text`, `button` y `unsupported`, y el parser
   (`packages/webhook-receiver/src/parse.ts`) no extrae `image` ni `document`.
   **El comprobante del cliente llegaría como `unsupported` y se perdería.**

### 2.3 Decisión pendiente del dueño

Para desbloquear `wa-bridge` hay que elegir (son de WhatsAppModular, no de acá):

| Opción | Qué implica |
|---|---|
| **A — Exponer API HTTP** en WhatsAppModular: un `POST /v1/messages` que acepte `MessageEnvelope`. | Es el diseño que esta sección asumía. Mantiene los proyectos desacoplados y despliegues independientes. |
| **B — Consumir `@wm/core` + `@wm/whatsapp-adapter` como biblioteca.** | Sin trabajo del lado de WhatsAppModular, pero acopla los repos: ManejoQRSimple pasaría a depender de sus versiones y a cargar sus credenciales de Meta. |

En cualquiera de las dos, **el webhook entrante necesita soportar `image` y
`document`** para que el comprobante llegue. Eso es trabajo en WhatsAppModular
sí o sí.

Mientras tanto, `@mqs/baneco-satelite` usa `MensajeriaNoConfigurada`, que falla
a propósito en vez de fingir que envió (ver su README).

- `correlationId` = id del cobro. Si el cliente responde sin contexto (sin
  botón/reply), wa-bridge correlaciona por número de teléfono contra los cobros
  `ENVIADO` de ese cliente; ambigüedad ⇒ `EN_REVISION`, nunca adivinar.
- **HMAC del webhook sobre el raw body, antes de parsear** — misma prohibición
  dura que en WhatsAppModular. Comparación con `timingSafeEqual`.
- Idempotencia por `messageId`: la doble entrega del webhook no duplica
  comprobantes.
- Si el envío al cliente ocurre por el laboratorio Evolution mientras el riel
  Meta no esté: **respetar las reglas de contención de ese laboratorio**
  (`docs/13-laboratorio-evolution.md` de WhatsApp-Modular): línea descartable,
  nunca OTPs. Los mensajes de cobro del demo con clientes de prueba propios son
  aceptables ahí; clientes reales, NO — esos esperan al riel oficial de Meta.

## 3. Plantillas de mensaje (borrador para aprobación en Meta)

- `cobro_qr` (saliente, con imagen): "«{comercio}» te envía este QR para pagar
  {concepto}: Bs {monto}. Válido hasta {vencimiento}. Paga desde la app de tu
  banco escaneando el QR. Cuando pagues, puedes responder con tu comprobante."
- `cobro_confirmado`: "Recibimos tu pago de Bs {monto} por {concepto}. ¡Gracias!"
- `cobro_por_vencer` (recordatorio): "El QR de {concepto} vence {fecha}. ..."
- Notificaciones internas al dueño: pueden ir por texto simple dentro de la
  ventana de servicio, sin plantilla.

## 4. Qué NO pasa por WhatsApp

- Credenciales, enlaces de login, datos de la cuenta receptora más allá de los
  que el propio QR ya expone por diseño del estándar.
- Confirmaciones de pago **antes** de `CONFIRMADO` — el mensaje de confirmación
  al cliente sale solo cuando la consola respaldó el pago (regla inviolable #1).
