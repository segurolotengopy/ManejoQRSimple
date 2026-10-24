# BNB — Análisis del portal de APIs (Open Banking BNB)

Fecha de lectura: 2026-10-23. Estado: **solo análisis**; nada implementado ni decidido.

Fuentes (públicas):

- https://www.bnb.com.bo/PortalBNB/Api/AllApis
- https://www.bnb.com.bo/PortalBNB/Api/Sandbox

> **Salvedad de método:** las dos páginas se leyeron a través de una herramienta
> que las devuelve resumidas, no en bruto. Antes de codificar nada hay que
> contrastar nombres de campos, estados y URLs con el original o con la
> especificación oficial que entregue el banco. No se probó ningún endpoint ni
> se pidieron credenciales.

## 1. APIs publicadas

| # | API | Relevancia |
| :-- | :-- | :-- |
| 1 | API QR simple (cobros por QR) | **Alta** |
| 2 | API QR simple por terceros | Media (a evaluar para consumidores) |
| 3 | Domiciliación (débitos automáticos) | Ninguna hoy |
| 4 | Extracto de cuentas | Posible, para conciliación (a evaluar) |
| 5 | Consulta de saldo | Ninguna (regla #4: no salen saldos) |
| 6 | Transferencias al exterior | Ninguna |

## 2. QR Simple — versión 2.0.0 (solo sandbox documentado)

- **Autenticación:** `POST /auth/token` con `accountId` y `authorizationId`
  (los entrega el banco). Devuelve el token dentro de `message`. No se documenta
  cómo se envía el token en los demás endpoints.
- **Generar QR:** `/main/getQRWithImageAsync`. Request: `currency`, `gloss`,
  `amount`, `expirationDate`, `singleUse`. Respuesta: imagen como arreglo de
  bytes (el campo no figura entre los documentados), más `success` y `message`.
- **Estado:** `/main/getQRStatusAsync`, por `qrId`. Estados: 1 = no usado,
  2 = usado, 3 = expirado, 4 = con error.
- **Consulta por fecha de generación:** `/main/getQRbyGenerationDateAsync`.
- **Pago de servicios por empresa:** `/Transactions/GetCompanyQRWithImageAsync`.
- Los hosts de sandbox están en `azurewebsites.net`. Para el token hay dos URLs
  sandbox contradictorias, una de ellas por HTTP plano.

## 3. Lo que no está documentado

- **Anulación de QR.** Choca con la regla del proyecto de no soltar un QR que
  todavía se puede pagar sin anularlo en el proveedor.
- **Webhook o notificación de pago.** Habría que consultar el estado; encaja con
  las reglas #1 y 1bis (solo la consulta saliente autenticada confirma).
- **Producción:** URL, requisitos de afiliación y costos.
- **Vencimiento:** `expirationDate` es una fecha sin hora (como Baneco C4); sin
  reglas de cálculo ni comportamiento al vencer.
- Los ejemplos JSON de la página tienen errores de sintaxis.

## 4. Relación con el proyecto

- Una integración sería un adaptador nuevo de `QrProvider` y `PaymentWatcher`
  (paquete propio, único que conozca la API del BNB), como `baneco-gateway`.
- El QR de Baneco ya se pagó desde la app del BNB y concilió
  (`docs/Integraciones/baneco/02-hallazgos-produccion.md`, P3).
- **Pendiente de verificar:** el BCB anunció OpenBCB (CP-44/2025, octubre de
  2025) con generación gratuita de QR, estado y notificaciones. Solo se vio en
  la búsqueda web.

## 5. Preguntas para el banco

1. ¿Existe anulación de QR? ¿Cuál es el endpoint?
2. ¿Hay notificación de pago o solo consulta de estado?
3. ¿El vencimiento es por día o por hora?
4. ¿Cómo se envía el token en las llamadas y cuánto dura?
5. ¿URL de producción, requisitos de afiliación y costos?
6. ¿Qué diferencia hay entre «QR simple» y «QR simple por terceros»?
7. ¿Entregan la especificación oficial completa (como la de Baneco)?
