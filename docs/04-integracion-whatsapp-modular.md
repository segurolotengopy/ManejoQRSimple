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

## 2. Contrato propuesto (a validar contra el estado real de WhatsAppModular)

> WhatsAppModular está en Fase 0 (riel Meta pendiente) y tiene un laboratorio
> Evolution API operativo bajo reglas de contención propias. **Antes de
> implementar `wa-bridge`, verificar en el repo de WhatsAppModular qué expone
> hoy su API pública** y ajustar esta sección. No inventar endpoints.

```
POST {WM_BASE_URL}/messages/media     Authorization: Bearer {WM_API_TOKEN}
  { to, mediaRef|mediaBase64, caption, correlationId }   → { messageId }

Webhook entrante (wa-bridge expone, WhatsAppModular llama):
POST {NUESTRO}/webhooks/wa-inbound    firmado (HMAC sobre raw body)
  { from, messageId, timestamp, media?, text?, correlationId? }
```

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
