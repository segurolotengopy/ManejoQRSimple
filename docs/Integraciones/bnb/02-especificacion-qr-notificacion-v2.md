# BNB — Especificación «Medio de Pago QR / Notificación V2»: encaje y pendientes

Fecha: 2026-11-23. Estado: **análisis; nada implementado ni decidido.**

Fuente: PDF del banco «Open Banking Medio de Pago QR - Notificación V2» (Api Market).
Es el documento que gobierna una eventual integración. **El PDF no se copia al repo**: como
con Baneco (`docs/Integraciones/baneco/README.md`, D4), los adjuntos del banco no se suben
a GitHub. Sus ejemplos traen credenciales y un token de muestra; no se reproducen acá.
Anula lo que `01-analisis-portal-api.md` decía sobre anulación y webhook: **sí existen**.

## 1. Qué ofrece el banco

Siete operaciones, todas `POST` con JSON y `Authorization: Bearer <token>` salvo el token.

| Operación | Ruta | Para qué |
|---|---|---|
| Generar token | `ClientAuthentication.API/api/v1/auth/token` | `accountId` + `authorizationId` (los da el banco) → token en `message` |
| Cambiar credencial | `…/auth/UpdateCredentials` | Cambio **obligatorio** de `authorizationId` antes del primer uso; ≥15 caracteres, letra, número y símbolo |
| Generar QR | `QRSimple.API/api/v1/main/getQRWithImageAsync` | `currency`, `gloss`, `amount`, `singleUse`, `expirationDate`, `additionalData`, `destinationAccountId` (1 = BOB, 2 = USD). Responde `id` y la imagen (PNG en base64) |
| Estado de un QR | `…/main/getQRStatusAsync` | Por `qrId`: `statusId` (1 no usado, 2 usado, 3 expirado, 4 con error), `expirationDate`, `voucherId` |
| QRs por fecha de generación | `…/main/getQRbyGenerationDateAsync` | Por día: `amount`, `currency`, `generationDate`, `expirationDate`, `statusId`, `transactionDate`, `sourceBank`, `gloss`, `notificationSuccess`, `notificationResponse`, `voucherId` |
| Cancelar QR | `…/main/CancelQRByIdAsync` | Anula un QR **antes de usarse y solo si es de uso único** |
| Notificación de pago | `POST https://<nuestra URL>/ReceiveNotification` | El banco **nos llama**: `QRId`, `Gloss`, `sourceBankId`, `originName`, `VoucherId`, `TransactionDateTime`, `additionalData`. Debemos responder `{"success":true,"message":"OK"}` |

## 2. Cómo encaja en la solución

El diseño de puertos ya lo absorbe, igual que Baneco: un paquete nuevo (`bnb-gateway`) que
es el único que conoce esta API y que implementa `QrProvider` y `PaymentWatcher`.

| Puerto | BNB | Observación |
|---|---|---|
| `QrProvider.emitir` | `getQRWithImageAsync` con `singleUse: true` | `referenciaProveedor` = `id`. La imagen va a Storage, no inline (`imagenRef`, `hashImagen`) |
| `QrProvider.anular` | `CancelQRByIdAsync` | Existe. Solo sirve con `singleUse`, así que **todo QR del cobro será de uso único** |
| `PaymentWatcher.consultarCobro` | `getQRStatusAsync` | `statusId = 2` indica pago, pero la respuesta **no trae monto ni fecha de pago** |
| `PaymentWatcher.listarAbonosDelDia` | `getQRbyGenerationDateAsync`, filtrando `statusId = 2` | Trae monto, `transactionDate` y `voucherId`; ver brecha B3 |
| Aviso de pago | `ReceiveNotification` | Solo **disparador de verificación** (regla 1bis), nunca confirma |

**Detección sin que nadie confirme por afirmación.** La detección sale así: el estado
puntual dice «usado»; con eso se consulta la lista del día de generación para obtener monto
y fecha de pago, y recién ahí se arma la `DeteccionDePago` (monto, `ocurridoEn`, referencia
y clave `bnb:<id>:<voucherId>`). Ambas son consultas salientes autenticadas. Lo que diga la
notificación solo adelanta la consulta.

**Cambios en el dominio**, y todos son decisiones obligadas por tablas totales:
`ORIGENES_QR` gana `api-bnb`, `ORIGENES_DETECCION` gana `watcher-bnb`, `QRS_DEL_RIEL` dice
que `watcher-bnb` paga `api-bnb`, y `claveDelRiel` exige el prefijo `bnb:`. Un detector
simulado o de Baneco no puede confirmar un QR del BNB (regla 4B2). `QR_PROVIDER` y
`PAYMENT_WATCHER` aceptan `bnb` en `@mqs/composicion`, y la barrera de producción exige los
dos adaptadores.

## 3. Reglas del proyecto y cómo se cumplen

- **Regla 1 / 1bis.** Solo `getQRStatusAsync` y la lista confirman. `ReceiveNotification`
  no trae firma ni autenticación documentada; cualquiera que conozca la URL puede llamarla.
- **Regla 4 y 9 — `originName`.** La notificación trae el **nombre del titular que pagó**.
  Se descarta en el borde (Zod) y nunca se guarda ni se registra. Tampoco `sourceBank`
  más allá de un código si hiciera falta.
- **Regla 5.** `amount` llega como número (`1`, `20`): hay que confirmar si son bolivianos
  con decimales. Se convierte a centavos enteros en el borde, sin pasar por `float`.
- **Regla 6 y `QrAnulado`.** El vencimiento del banco es por **día** (`expirationDate`
  `2022-06-15` figura vencido el `2022-06-16T00:00:00`), como Baneco C4. Un cobro vencido
  o anulado en nuestro reloj exige antes la constancia de anulación; `CancelQRByIdAsync`
  la da, siempre que el QR sea de uso único.
- **Regla 2.** `accountId` y `authorizationId` son credenciales bancarias: viven fuera del
  repo, con permisos 600, como las de Baneco. El cambio obligatorio de `authorizationId` lo
  hace Claude con un script que no muestra el valor, con la autorización de Andres.
- **Regla 7.** Clave de deduplicación estable por `(id, voucherId)`.

## 4. Brechas de la especificación (por qué no se puede codificar todavía)

- **B1. Monto sin unidad.** `amount: 1`. ¿Bolivianos con decimales? ¿Máximo de decimales?
- **B2. El estado no trae monto ni fecha de pago.** Solo la lista por fecha de generación
  los trae. La conciliación exige monto exacto y fecha dentro de la vigencia.
- **B3. La lista es por fecha de generación, no de pago.** El cierre diario necesita los
  pagos de un día. Un QR generado ayer y pagado hoy solo aparece consultando ayer.
- **B4. Estado tras cancelar.** No dice qué `statusId` queda: ¿3, 4 u otro? Sin eso no se
  distingue «anulado» de «vencido» ni se prueba la idempotencia de `anular`.
- **B5. Cancelar un QR ya usado.** No dice qué responde, y es la carrera que importa:
  pago y anulación casi a la vez.
- **B6. `statusId` inconsistente.** En el estado figura 3 = expirado; en la lista, solo
  1, 2 y 4.
- **B7. Zona horaria.** `TransactionDateTime` viene como `19/10/2020 17:30:15`, sin zona
  (Baneco: hora de Bolivia, V3). Y `transactionDate` usa `0001-01-01` cuando no hay pago.
- **B8. Seguridad de la notificación.** Sin firma, sin token y con URL `https://XXXX`.
  No dice si reintenta, con qué frecuencia, desde qué IP, ni qué espera ante un error.
- **B9. Ejemplos con errores.** En la respuesta de «Generar QR», `message` trae una fecha;
  el ejemplo de la lista dice `Prueba QR` y `Prueba qr`; hay varias rutas con espacios.
- **B10. HTTP en pruebas.** La URL de prueba es `http://` (token y credenciales en claro).
  Producción tiene que ser HTTPS; no hay URL de producción en el documento.
- **B11. Vigencia del token, errores y límites.** No hay duración del token, catálogo de
  errores, límites de uso ni tope por QR o por día.
- **B12. Longitudes.** `gloss`, `additionalData` y `qrId` sin largo máximo ni formato.

## 5. Pendientes para solicitar al BNB

Están en `03-preguntas-al-banco.md`, listas para enviar, ordenadas por prioridad. Las que
bloquean la integración son: monto y estado con fecha de pago (B1, B2, B3), anulación y su
estado final (B4, B5), y seguridad de la notificación (B8).

## 6. Lo que no se construye, y por qué

- **Un riel por notificación sola.** No: sin firma, confirmaría por afirmación del que
  llame a la URL.
- **Guardar `originName`.** No: nombre de un tercero ajeno al cobro (regla 4).
- **QR de uso múltiple.** No: sin él no hay anulación, y sin anulación no se cumple la
  regla de no soltar un QR pagable.
- **Producción.** Sigue bloqueada por las decisiones D1 y D2 de
  `docs/11-produccion-brechas-y-plan.md`; la notificación además necesita una URL pública
  HTTPS que hoy no existe.

## 7. Decisiones del dueño

1. ~~¿El BNB será un segundo riel junto a Baneco o lo reemplaza?~~ **Decidido el 2026-11-23 (Andres): segundo riel.** Baneco sigue como línea principal y el BNB se suma detrás de los mismos puertos.
2. ¿Hay una cuenta de empresa en el BNB para recibir los cobros (o hay que abrirla)?
3. ¿Se empieza solo con **consulta periódica** y la notificación se activa después?
   (Recomendado: no necesita URL pública y no cambia el modelo de confianza.)
