# BCP — Riel por API oficial: qué pedir

Fecha: 2026-11-23. Estado: **sin especificación del banco; nada implementado.**

Decisión del dueño (2026-11-23): habrá un tercer riel por la **API oficial del BCP**, junto a
Baneco y BNB, detrás de los mismos puertos (`QrProvider`, `PaymentWatcher`). El riel Yape por
consola (`yape-scraper`) sigue diferido y es otra cosa; esta línea no lo reemplaza.

No hay documento técnico del BCP en el proyecto. **No se inventan rutas, campos ni estados**:
este archivo solo lista lo que hay que obtener, tomado de lo que Baneco y el BNB enseñaron.
Cuando el banco entregue su especificación, ella gobierna.

## 1. Primero: confirmar que existe y por qué canal

- ¿El BCP ofrece una API de cobros por QR a comercios? ¿Para Yape o para QR Simple/BCB?
- ¿Se accede por el BCP directamente o por **OpenBCB** del BCB (ver `docs/02` §5)? Verificar
  en fuente oficial con fecha; hoy solo se vio en prensa.
- Requisitos de afiliación, contacto técnico, costos y plazos.

## 2. Lo que la especificación debe traer (mínimo para integrar)

1. **Generar QR** con monto, moneda, glosa/referencia propia y **vencimiento con hora**.
2. **Anular** un QR no usado, con el estado final documentado y comportamiento idempotente.
3. **Consultar el estado de un QR** con **monto y fecha-hora del pago** (el BNB no los trae
   en el estado; sin ellos no hay conciliación exacta).
4. **Listar pagos por fecha de pago**, para el cierre diario (el BNB lista por generación).
5. **Autenticación** de cada llamada, vigencia del token y rotación de credenciales.
6. **Notificación de pago**, si existe: con firma o secreto, IP de origen y reintentos.
   Siempre solo disparador de verificación (regla 1bis).
7. Zona horaria, unidad del monto, catálogo de estados y de errores.
8. Ambiente de pruebas con pagos simulados, o confirmación de que no existe.
9. Límites de uso, disponibilidad, soporte y política de datos del pagador (no queremos
   nombres de terceros, regla 4).

## 3. Qué cambia en el proyecto cuando llegue

Mismo molde que el BNB: paquete propio que sea el único en conocer la API (`bcp-gateway`),
valores nuevos de origen (`api-bcp`, `watcher-bcp`) en las tablas totales de `qr-core`, clave
de deduplicación con prefijo propio y `bcp` en `QR_PROVIDER` / `PAYMENT_WATCHER`.
Dependencias: ningún adaptador importa a otro.

## 4. Estado de las gestiones (2026-11-24)

- Andres gestiona la **apertura de una cuenta de empresa en el BCP**; el banco enviará sus
  documentos de integración **después** de abrirla. Hasta entonces no hay especificación.
- Contacto con el BCP: lo lleva Andres.
