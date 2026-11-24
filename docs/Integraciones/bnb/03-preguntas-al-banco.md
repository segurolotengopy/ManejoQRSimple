# Preguntas y pedidos al BNB — QR Simple y Notificación V2

Fecha: 2026-11-23. Estado: **enviadas por correo por Andres (2026-11-24); sin respuesta todavía.** Queda por anotar qué preguntas fueron en el correo.
Base: `02-especificacion-qr-notificacion-v2.md`. Cada respuesta del banco se anota debajo de
su pregunta, con fecha, y la más reciente gana sobre el PDF.

## A. Pedidos comerciales y de acceso (bloquean todo)

- **A1.** Proceso y requisitos para afiliarnos como empresa al servicio de QR Simple
  (documentos, NIT, tipo de cuenta). ¿Aplica «QR simple» o «QR simple por terceros»? ¿Cuál
  es la diferencia?
- **A2.** Entrega de `accountId` y `authorizationId` iniciales, y del ambiente de
  **producción** (URL HTTPS) y del de pruebas.
- **A3.** Costos, comisiones por QR cobrado, y límites por QR, por día y por cuenta.
- **A4.** ¿Hay una cuenta de abono de pruebas y un modo de **simular un pago** en el
  ambiente de pruebas? (Baneco no lo tenía, y obligó a probar en producción con plata.)
- **A5.** ¿Pueden entregarnos la especificación completa en versión actual, con las rutas
  de producción y el catálogo de errores?

## B. Generación y monto

- **B1.** `amount`: ¿en bolivianos con decimales? ¿Cuántos decimales como máximo?
- **B2.** `expirationDate` es una fecha. ¿El QR vence a las 00:00 del día siguiente (el
  ejemplo muestra `2022-06-16T00:00:00` para el 2022-06-15)? ¿Se puede fijar hora?
- **B3.** ¿Un QR de uso único se invalida solo tras el primer pago? ¿Qué pasa con un
  segundo pago al mismo QR?
- **B4.** Largo y caracteres permitidos de `gloss` y `additionalData`. ¿Se devuelven
  idénticos en la notificación?
- **B5.** ¿`id` del QR es único por empresa o global? ¿Es numérico y de qué rango?
- **B6.** ¿La imagen del QR ya incluye el monto y el vencimiento, o es un QR estático?

## C. Verificación de pago (críticas)

- **C1.** `getQRStatusAsync` no devuelve monto ni fecha de pago. ¿Existe una consulta por
  QR con monto, `transactionDate` y `sourceBank`? Si no, ¿se agregan esos campos?
- **C2.** `getQRbyGenerationDateAsync` filtra por fecha de **generación**. ¿Existe una
  consulta por fecha de **pago** para el cierre diario?
- **C3.** `statusId`: la lista del estado de un QR incluye 3 = expirado y la lista por fecha
  no. Pedimos el catálogo completo y vigente.
- **C4.** `transactionDate` y `TransactionDateTime`: ¿en hora de Bolivia? El formato de la
  notificación es `dd/MM/yyyy HH:mm:ss`, el de la consulta es ISO. ¿Qué valor lleva
  `transactionDate` cuando no hay pago?
- **C5.** `voucherId`: ¿siempre 10 caracteres alfanuméricos? ¿Es único por pago? ¿Qué
  muestra un pago pendiente, `null` o `"0"`?
- **C6.** Latencia: ¿cuánto tarda en reflejarse un pago en la consulta de estado?
- **C7.** Frecuencia máxima de consulta permitida y qué respuesta da al excederla.

## D. Anulación

- **D1.** `CancelQRByIdAsync`: ¿qué `statusId` queda en el QR cancelado?
- **D2.** ¿Qué responde si el QR ya fue usado? Es la carrera entre un pago y nuestra
  anulación.
- **D3.** ¿Es idempotente? ¿Qué responde si el QR ya estaba cancelado o vencido?
- **D4.** ¿Se puede cancelar un QR de uso múltiple, o solo los de uso único?

## E. Notificación (`ReceiveNotification`)

- **E1.** ¿Cómo autentica el banco su llamada? Hoy no hay firma ni token, y cualquiera con la
  URL podría falsificarla. ¿Se puede agregar firma, secreto compartido o encabezado?
- **E2.** ¿Desde qué direcciones IP llama el banco? (Para permitirlas y bloquear el resto.)
- **E3.** ¿Reintenta ante un error? ¿Cuántas veces y con qué espaciado? ¿Qué respuesta
  espera para dejar de reintentar?
- **E4.** ¿Se puede **omitir `originName`** (nombre del titular que paga)? No lo necesitamos
  y no queremos recibirlo.
- **E5.** `notificationSuccess` y `notificationResponse` de la consulta: ¿qué registran
  exactamente, y cuánto tiempo?
- **E6.** ¿Hay un ambiente de pruebas que dispare notificaciones a una URL nuestra?
- **E7.** ¿La URL de notificación se registra por empresa, por QR o en cada generación?

## F. Seguridad y operación

- **F1.** Vigencia del token y política de renovación. ¿Cuántos tokens simultáneos?
- **F2.** `UpdateCredentials`: ¿con qué frecuencia debe cambiarse la credencial? ¿Hay
  bloqueo tras intentos fallidos?
- **F3.** Cifrado: la URL de pruebas es `http://`. Confirmen que producción es solo HTTPS y
  qué versión de TLS exigen.
- **F4.** Catálogo de errores y de códigos de respuesta. Hoy `message` trae texto libre.
- **F5.** Ventanas de mantenimiento, disponibilidad comprometida y contacto de soporte
  técnico para incidentes.
- **F6.** ¿Pueden pagar este QR todos los bancos interoperables? (Con Baneco se probó un
  pago desde el BNB.)
- **F7.** Cierre y conciliación: ¿cuándo se acreditan los fondos y cómo se concilian contra
  el extracto?

## G. Errores del documento que pedimos corregir

- G1. En «Generar QR», la respuesta de ejemplo trae `message` con una fecha.
- G2. El estado de ejemplo mezcla `Prueba QR` y `Prueba qr`.
- G3. Hay rutas de ejemplo con espacios (`/main/ CancelQRByIdAsync`).
- G4. El cuerpo de la notificación muestra `"sourceBankId:" 1` con comillas mal cerradas.
