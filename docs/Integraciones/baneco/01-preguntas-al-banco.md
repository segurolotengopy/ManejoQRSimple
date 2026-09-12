# 01 — Batería de preguntas a Banco Económico (previa al desarrollo)

**Fecha de elaboración:** 2026-08-27 · **Destinatario:** oficial de cuenta / equipo de
integraciones API Market de Banco Económico S.A.
**Contexto para el banco:** integración del comercio ALBERDI KULJIS ANDRES a la API de
Cobros QR Simple (espec. v1.3.0) para generar QRs de un solo uso con monto fijo y
validar los pagos acreditados. Se desarrollará primero contra el ambiente de
certificación.

**Estado:** ✅ **respondida por el banco el 2026-09-11** (correo del oficial de cuenta al
dueño). Enviada el 2026-08-27. Queda una sola pregunta sin respuesta: **D1** (rangos de
IP del webhook). Este documento es ahora **fuente de verdad de nivel 1** (ver
`README.md`): ante discrepancia con el PDF oficial, gana lo que dice acá.

**Numeración:** C7 (interoperabilidad) se resolvió internamente y no se envió, así que en
el correo del banco la numeración de la sección C está corrida en uno desde ahí: su
"C7" es nuestra **C8** y su "C8" es nuestra **C9**. Las respuestas están registradas
en la fila que corresponde a cada pregunta, no a su número en el correo.

Prioridades: **[B] bloqueante** — sin respuesta no se puede cerrar el diseño o pasar a
producción; **[I] importante** — condiciona implementación pero hay supuesto razonable;
**[D] deseable** — optimiza operación.

---

## A. Proceso de certificación y pase a producción

| # | P | Pregunta | Respuesta del banco (2026-09-11) | Qué cambia |
|---|---|---|---|---|
| A1 | B | ¿Existe un proceso formal de certificación/homologación antes de habilitar el consumo en producción? Si sí: ¿qué casos de prueba exigen, quién los valida y cuánto suele tardar? | El banco **no exige** un proceso de certificación. | El criterio de salida a producción es enteramente nuestro (docs/07). B0 deja de ser "requisito del banco" y pasa a ser nuestra propia validación de contrato — sigue siendo obligatoria. |
| A2 | B | ¿El ambiente de certificación (`apimktdesa.baneco.com.bo`) permite **simular el pago de un QR** generado por nosotros? ¿Cómo se dispara ese pago de prueba (app de pruebas, endpoint utilitario, solicitud al banco)? | No hay simulación. Para procesar un pago en pruebas se **envía la imagen del QR por correo** al oficial y el banco lo paga. | El camino de pago end-to-end (statusQR = 1, forma real de `payment`, `paidQR` con datos) solo se puede capturar con un QR que **no** se anule y un pago manual del banco. B0 hoy anula todo lo que crea: hace falta un modo "pago asistido". |
| A3 | B | Las credenciales de certificación que figuran como ejemplo en la §1 de la especificación v1.3.0 (usuario y llave AES), ¿son de uso compartido o se nos asignarán credenciales de certificación propias? | Son de **uso compartido** en el ambiente de pruebas. | **Desbloquea B0**: las credenciales del PDF sirven. Al ser compartidas, cualquier otro integrador ve lo que creamos en cert — los sondeos no llevan datos reales. |
| A4 | I | ¿Qué cuenta de abono (`accountCredit`) válida debemos usar en certificación? ¿Hay cuentas de prueba pre-creadas? | El banco **envía un usuario de pruebas con una cuenta** para el testeo. | Falta recibirla (o ubicarla, si vino adjunta). Sin ella, B0 autentica pero no puede generar QRs. Va a `.env` como `BANECO_CERT_*`, nunca al repo. |
| A5 | I | ¿El ambiente de certificación está disponible 24/7 o tiene horarios/ventanas? | Disponible **24/7**. | — |

## B. Autenticación y cifrado

| # | P | Pregunta | Respuesta del banco (2026-09-11) | Qué cambia |
|---|---|---|---|---|
| B1 | B | ¿Cuál es la **vigencia exacta del JWT** emitido por `/api/authentication/authenticate` y la política recomendada de renovación? ¿Hay límite de tokens simultáneos o rate limit sobre ese endpoint? | **30 minutos.** Hoy sin límite (no descartan un rate limit a futuro). | El cliente ya lee el `exp` del token; la vigencia de respaldo (token sin `exp` legible) pasa de 4 a 30 min. Se mantiene el reintento **único** ante 401. |
| B2 | B | ¿Pueden confirmar formalmente el esquema de cifrado AES? Nuestro entendimiento: **AES-256-CBC, padding PKCS7, IV aleatorio de 16 bytes antepuesto al ciphertext, todo codificado Base64**. ¿Disponen de vectores de prueba oficiales (texto plano + llave + resultado esperado)? | "Se debe usar el endpoint `/api/authenticate/cypher`." No confirma el esquema ni da vectores. | Ver nota B2 abajo. **Esquema confirmado por el vector oficial del PDF** (2026-09-12); el endpoint utilitario **no** se usa en el flujo operativo. |
| B3 | I | ¿La llave AES rota periódicamente? ¿Con qué procedimiento y preaviso se comunica un cambio de llave? ¿Podemos solicitar una **rotación de la llave de producción** antes del go-live, dado que la actual circuló por canales ofimáticos? | Llave **única por cliente**, sin rotación periódica. **Al salir a producción se asigna la llave de ese ambiente.** | La llave de producción que circuló por canales ofimáticos no sería la definitiva: se asigna al pasar a producción. Pedirla por un canal que no sea un adjunto de correo. |
| B4 | I | ¿Existe bloqueo del usuario API por intentos fallidos de autenticación? ¿Cuál es el procedimiento de desbloqueo y el contacto? | Bloqueo o cambio de contraseña se solicita **en cualquier agencia** del banco. | Desbloquear cuesta una visita presencial: confirma que ni el cliente ni B0 deben reintentar logins en bucle (ya es así). |

**Nota B2 — por qué no se usa el endpoint de cifrado del banco.** La ruta que nombra el
banco (`/api/authenticate/cypher`) no figura en la v1.3.0; lo que el PDF documenta es
`GET /api/authentication/encrypt?text=…&aesKey=…` (§5.1). Ese endpoint recibe el texto
plano **y la llave** como parámetros de la URL. Usarlo en operación significaría mandar
la contraseña del usuario API y la llave AES en una query string, que es exactamente lo
que terminan registrando proxies, balanceadores y logs de acceso — lo contrario de lo
que el cifrado existe para proteger. Se descarta para operación.

Lo que sí resuelve la pregunta: el PDF trae un **vector oficial** (texto `1234`, la
llave de certificación del ejemplo y el ciphertext esperado). El 2026-09-12 se descifró
ese ciphertext con `packages/baneco-gateway/src/crypto/aes.ts` y dio `1234`; el payload
mide 32 bytes, que es IV (16) + un bloque (16), consistente con IV antepuesto. El
esquema queda **confirmado** sin llamadas de red. La confirmación end-to-end sigue
siendo el login de B0 (si el banco acepta el password que ciframos, descifró lo
nuestro). El vector no se versiona: lleva la llave de certificación.

## C. Generación y ciclo de vida del QR

| # | P | Pregunta | Respuesta del banco (2026-09-11) | Qué cambia |
|---|---|---|---|---|
| C1 | B | ¿Cuál es la **vigencia máxima y mínima admitida para `dueDate`**? (Operaremos con vigencias cortas por cobro; necesitamos conocer los límites reales.) | Mínimo: la **fecha del día** en que se genera. Máximo: **2 años**. | Las 72 h por defecto (D5) están holgadas dentro del rango. Ojo: `dueDate` es una **fecha**, no un instante — ver C4. |
| C2 | B | ¿Qué **límites de monto** aplican por transacción QR y por día (normativa BCB/ASFI + política del banco)? ¿Qué error retorna un QR generado por encima del límite y qué ocurre si el pagador excede su propio límite? | **No hay límite** para generar el QR; el límite del pagador depende de **su** entidad financiera. | Un QR válido puede no ser pagable para un cliente dado por límites de su banco. No es un error nuestro ni del banco receptor: el cobro simplemente no se paga y vence. |
| C3 | B | ¿La **unicidad de `transactionId`** la valida el banco? ¿Qué `responseCode` retorna un duplicado? ¿La unicidad es global o por día? | **No la valida**: para el banco es un dato referencial. Recomiendan usar el id de la orden en nuestro sistema. | Ya usamos el `cobroId`. Consecuencia: el banco no protege contra doble emisión — si un `generateQR` se reintenta tras un timeout en el que el banco sí lo creó, queda un QR **pagable** que no conocemos. La red de seguridad es la conciliación diaria (reporta abonos huérfanos). |
| C4 | I | Cuando un QR alcanza su `dueDate` sin pago, ¿qué retorna `statusQR`? (La espec. documenta 0 activo, 1 pagado, 9 anulado — ¿existe un estado "vencido" o sigue retornando 0?) ¿Un QR vencido puede aún ser pagado? | **No existe estado vencido**: `statusQR` sigue devolviendo lo mismo, pero el QR **ya no se puede pagar**. | El vencimiento lo decide nuestro reloj, como ya estaba. Pero `dueDate` es de granularidad **día**: del lado del banco, el QR sigue pagable hasta que termina el día de `dueDate`, aunque nuestro cobro ya esté `VENCIDO`, renovado o anulado. Ver "Hallazgos derivados" abajo. |
| C5 | I | `cancelQR` sobre un QR ya vencido o ya anulado: ¿retorna error o éxito idempotente? ¿Qué `responseCode` en cada caso? | **Se puede anular un QR vencido.** No dice qué pasa con uno ya anulado. | Anular al vencer es posible. La doble anulación sigue sin respuesta escrita: la sondea B0 (P4). |
| C6 | I | Además de `qrImage` (PNG Base64), ¿la API puede entregar el **payload EMV/texto del QR**? (Nos permitiría regenerar la imagen con nuestro propio render y validar su contenido.) | **No.** La interpretación de la imagen solo la pueden hacer las entidades financieras habilitadas. | La imagen del banco se usa tal cual. `hashImagen` sigue siendo la única huella del QR emitido. |
| C7 | ✔ | ¿Confirman que el QR generado es **interoperable con el estándar QR BCB**, pagable desde la app de cualquier entidad financiera boliviana (incluidas billeteras como Yape)? | **SÍ — resuelta por el dueño (2026-08-27), no se envió al banco:** la interoperabilidad universal es la definición misma de "QR Simple" en Bolivia (ver `docs/02-qr-simple-bolivia.md` §1). | — |
| C8 | D | ¿Hay límite de QRs generados por hora/día u otro rate limit general del API Gateway que debamos respetar? | **Sin límites** para generar QR ni rate limit general hoy (no se descarta a futuro). | Sin cambios: el cliente no reintenta en bucle de todos modos. |
| C9 | D | ¿Se aplican **comisiones** al comercio receptor por cobro QR acreditado? ¿Cómo se liquidan (descuento en el abono o cargo aparte)? | Se **negocian con el ejecutivo de negocios**. | Pendiente comercial del dueño, no técnico. Si la comisión se descuenta del abono, el monto acreditado no sería el del QR — hay que saberlo antes de producción. |

## D. Notificación y verificación de pagos

| # | P | Pregunta | Respuesta del banco (2026-09-11) | Qué cambia |
|---|---|---|---|---|
| D1 | B | ¿Desde qué **rangos de IP públicas** invoca el banco el webhook `notifyPaymentQR`? (Los necesitamos para lista blanca; sin este dato el webhook no se habilita.) | **Sin respuesta.** | Sigue abierta. No bloquea: la primera etapa opera sin webhook (D3 del dueño, confirmado por D4). |
| D2 | B | ¿Ofrecen algún mecanismo de **autenticación del webhook** (firma HMAC, mTLS, token en header)? Si hoy no existe: ¿está en el roadmap? | El banco puede enviar un **Bearer Token o Basic Auth**. | Mejora la defensa en profundidad del webhook, **no cambia BANECO-1**: un secreto estático compartido autentica al emisor, no prueba que el pago exista. El webhook sigue siendo solo un disparador de `statusQR`. Si se habilita (Hito B3), el token se compara con `timingSafeEqual` (regla #10). |
| D3 | B | ¿Cuál es la **política de reintentos** del webhook (cantidad, intervalos, ante qué respuestas HTTP se reintenta y cuándo se desiste)? | **10 reintentos con intervalos de 1 segundo.** | La ventana total es de ~10 s: un handler lento o una caída breve pierde el aviso. Refuerza que el webhook no puede ser la única vía de detección (polling + conciliación diaria). |
| D4 | B | ¿Cómo se **registra y actualiza la URL** del webhook del comercio? ¿Es autogestionable o requiere trámite con el banco? ¿Puede operarse **sin webhook** (solo `statusQR` + `paidQR`), como haremos en la primera etapa? | Se solicita **por correo** con la URL y el código de usuario. El webhook **no es obligatorio**. | Confirma D3 del dueño: primera etapa sin webhook. |
| D5 | I | ¿Qué latencia típica hay entre la acreditación del pago y (a) el disparo del webhook, (b) el reflejo en `statusQR` = 1? | **En línea**, al momento de recibir el pago. | La latencia de detección la pone nuestro intervalo de polling, no el banco. |
| D6 | I | ¿Qué frecuencia de **polling sobre `statusQR`** consideran aceptable por QR pendiente? ¿Hay rate limit específico? | Depende del negocio: con cliente presente, consulta manual del cajero; para venta en línea, **a partir de los 10 segundos**. Sin rate limit hoy (no se descarta). | El satélite pasa a 30 s por defecto (antes 180 s) y 10 s de piso (antes 30 s). El cobro por WhatsApp es venta en línea. |
| D7 | I | `paidQR/{fecha}`: ¿la fecha corresponde a la fecha de pago en hora boliviana (UTC-4)? ¿A partir de qué hora el listado del día anterior está completo y estable (hora de corte)? | Fecha y hora **del pago, en hora de Bolivia**. El día anterior está completo **desde las 00:00:01**. | Confirma V3 (el offset de `mapeo.ts` era correcto). La conciliación del día anterior puede correr apenas pasada la medianoche boliviana. |
| D8 | B | ¿Puede un pago QR ser **revertido/extornado** después de reportarse `statusQrCode = 1`? Si sí: ¿cómo se entera el comercio (webhook, cambio de estado, aviso manual)? | **No existen reversiones** de pagos QR. | `CONFIRMADO` terminal es correcto; no hace falta un estado de reversión. |
| D9 | D | En pagos desde otras entidades (interoperabilidad BCB), ¿`senderBankCode`/`senderName` llegan siempre poblados y con qué catálogo de códigos ASFI debemos mapear? | Dicen adjuntar un **catálogo de bancos**, pero **no llegó** (confirmado por el dueño el 2026-09-12). No dicen si los campos llegan siempre poblados. | Pedirlo de nuevo. Cuando llegue, entra por `privado-no-gh/` (regla D4). No bloquea nada: `senderBankCode` no se usa para conciliar, y `senderName` se sigue descartando en el mapeo (reglas #4 y #9). |

## E. Errores, límites y operación

| # | P | Pregunta | Respuesta del banco (2026-09-11) | Qué cambia |
|---|---|---|---|---|
| E1 | B | ¿Disponen del **catálogo oficial de `responseCode` y `message`** de error de todos los servicios? (La espec. v1.3.0 no lo incluye.) | **No hay catálogo.** En todos los casos `message` trae la descripción del rechazo. | El tratamiento de todo `responseCode != 0` como error opaco deja de ser provisorio: es el diseño definitivo. El `message` no se propaga tal cual (puede nombrar al usuario); B0 lo registra saneado para el catálogo empírico. |
| E2 | I | ¿Cuál es el canal de **soporte técnico** para la integración (contacto, horario, SLA) y el canal de aviso de **incidentes y ventanas de mantenimiento** del API Gateway? | El **oficial que respondió** canaliza las consultas con soporte técnico, en horario de oficina (**9 a 16 h**). Respuesta según el caso, **hasta 48 h**. | No hay canal de incidentes ni aviso de mantenimiento. Un incidente fuera de horario no tiene a quién escalarse: el satélite tiene que degradar solo (ya lo hace — reintenta en la pasada siguiente). |
| E3 | D | ¿Está prevista una versión futura de la especificación (v1.4+) con cambios que debamos anticipar? ¿Cómo se comunican los cambios de API (deprecaciones, versionado)? | No descartan mejoras, **siempre compatibles** con lo que ya está en producción. | Los schemas Zod ya toleran campos extra; un campo nuevo no rompe el adaptador. |

## F. Cuenta de abono y conciliación

| # | P | Pregunta | Respuesta del banco (2026-09-11) | Qué cambia |
|---|---|---|---|---|
| F1 | I | ¿Cada pago QR se acredita como **movimiento individual** en la cuenta de abono, o puede consolidarse (la espec. menciona abonos por total por sucursal vía `branchCode`)? ¿Qué glosa/referencia lleva el crédito en el extracto para cuadrarlo con el `qrId`/`transactionId`? | **Individual**, con glosa: nombre del pagador, entidad de origen y nota del QR. **Opcionalmente**, un abono **por sucursal** con el total del día, al cierre, **sin glosa**. | El abono consolidado por sucursal haría imposible cuadrar el extracto contra cada cobro. **No** se habilita: `BANECO_BRANCH_CODE` sin valor en el demo. La glosa trae el nombre del pagador: si algún día se lee el extracto, ese campo no se persiste (regla #4). |
| F2 | D | `accounts/history`: ¿qué profundidad máxima de histórico permite por consulta y existe paginación para rangos con muchos movimientos? | Hasta **90 días**, **sin paginación**. El endpoint es **`accounts/queryMovements`**. | Discrepa con el PDF (`/api/accounts/history`, §8.1); gana esta respuesta. No hay código que lo use (capa opcional, análisis §4.4). |
| F3 | D | ¿El servicio de consulta de movimientos usa el mismo usuario API o requiere permisos adicionales sobre la cuenta? | **Mismo usuario API**, sin habilitación adicional. | — |

## G. Preguntas adicionales del dueño (fuera de la batería, mismo correo)

| # | Pregunta | Respuesta del banco (2026-09-11) | Qué cambia |
|---|---|---|---|
| G1 | ¿Es posible que nos den el manual y el formato de archivo para cargar **pago a proveedores**? | **No se tiene ese servicio, no está desarrollado.** | Discrepa con el PDF, que documenta `POST /api/batchPayment/upload` (§9.1, tipo `PROVIDERS`). Gana la respuesta: no se diseña nada sobre ese endpoint. |
| G2 | ¿Es posible tener las especificaciones del estándar QR para **leer cualquier QR** desde nuestra plataforma? | Pueden enviar los manuales y especificaciones del servicio **Bec QR Connect**. | Coherente con C6 (solo entidades habilitadas interpretan el QR). Si el dueño lo pide, entra por `privado-no-gh/`. Fuera del alcance actual. |

---

## Hallazgos derivados de las respuestas

Dos consecuencias que no son respuesta a ninguna pregunta en particular, sino de
cruzarlas con el código:

1. **El QR sigue pagable en el banco después de que nuestro cobro lo da por muerto (C4,
   C5, C1).** `dueDate` es un día, no un instante: un QR de 72 h que vence a las 10:00
   sigue pagable hasta la medianoche boliviana de ese día. Hoy el sistema **no anula el
   QR en el banco** en ninguno de los tres casos en que deja de mirarlo: al vencer
   (`vencerSiCorresponde`), al renovar (el QR anterior queda vivo) ni al anular por
   decisión del dueño. Un cliente que paga en esa ventana acredita dinero real que el
   satélite no ve, porque solo consulta el QR vigente de los cobros `ENVIADO` /
   `COMPROBANTE_RECIBIDO`. No es fraude —es plata que entra sin registrarse—, pero
   rompe la conciliación. **Resuelto (PR "cerrar la ventana de pago"):** vencer,
   anular y la ventana agotada exigen anular antes el QR en el banco — lo exige la
   máquina de estados, no la disciplina —, se consulta el banco antes de vencer, y
   un pago que igual llegue sobre un QR vencido lleva el cobro a `EN_REVISION`.
2. **La conciliación diaria existe pero nadie la corre (D7, C3).** `conciliarDia()` está
   en `qr-core` y reporta abonos huérfanos, que es justo la red para el hallazgo 1 y
   para el QR duplicado de C3. El satélite no la invoca. Con D7 ya se sabe cuándo
   correrla: pasada la medianoche boliviana, sobre el día anterior. **Resuelto (mismo
   PR):** el satélite cierra el día anterior al cambiar el día boliviano y al
   arrancar. Además se corrigió un defecto que la habría hecho inservible: solo
   comparaba contra los cobros pendientes, así que todo pago ya confirmado aparecía
   como huérfano al día siguiente. Ahora busca el cobro por la referencia del QR.

## Supuestos de trabajo — estado tras la respuesta

| # | Supuesto (2026-08-27) | Pregunta | Estado |
|---|---|---|---|
| 1 | JWT de corta duración renovado de forma anticipada y reintento único ante 401. | B1 | ✅ **Confirmado**: 30 min. El cliente lee `exp`; respaldo ajustado a 30 min. |
| 2 | Cifrado AES-256-CBC/PKCS7/IV-prepended/Base64, validado empíricamente en B0. | B2 | ✅ **Confirmado** por el vector oficial del PDF (nota B2). Queda la confirmación end-to-end del login en B0. |
| 3 | Operación **sin webhook**: polling de `statusQR` (2–5 min por QR pendiente) + conciliación diaria `paidQR`. | D4, D6 | ✅ **Confirmado**, con el intervalo corregido: el banco acepta desde 10 s. Default del satélite: 30 s. |
| 4 | Vigencia corta por cobro (72 h por defecto, configurable). | C1 | ✅ **Confirmado**: el rango admitido va del día actual a 2 años. Nuevo matiz: granularidad día (hallazgo 1). |
| 5 | Todo `responseCode != 0` se trata como error opaco, registrado como evidencia. | E1 | ✅ **Definitivo**: no existe catálogo oficial. |
| 6 | Ningún supuesto pasa a producción sin respuesta del banco o verificación formal. | — | Vigente. Lo que falta verificar en certificación está en `README.md` (V1, V4 y el camino de pago de A2). |
