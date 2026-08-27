# 01 — Batería de preguntas a Banco Económico (previa al desarrollo)

**Fecha de elaboración:** 2026-08-27 · **Destinatario:** oficial de cuenta / equipo de
integraciones API Market de Banco Económico S.A.
**Contexto para el banco:** integración del comercio ALBERDI KULJIS ANDRES a la API de
Cobros QR Simple (espec. v1.3.0) para generar QRs de un solo uso con monto fijo y
validar los pagos acreditados. Se desarrollará primero contra el ambiente de
certificación.

**Estado:** 📤 **enviado al banco el 2026-08-27 — a la espera de respuesta.** Al recibirla,
completar la columna "Respuesta" de cada fila con fecha y quién respondió, revisar qué
supuestos de trabajo (§final) quedan invalidados y reflejarlo en `docs/ESTADO.md`.

**Uso interno:** las respuestas se registran en la columna "Respuesta" (o debajo de
cada pregunta) con fecha y quién respondió, y este documento pasa a ser fuente de
verdad de nivel 1 (ver `README.md`). Prioridades: **[B] bloqueante** — sin respuesta no
se puede cerrar el diseño o pasar a producción; **[I] importante** — condiciona
implementación pero hay supuesto razonable; **[D] deseable** — optimiza operación.

---

## A. Proceso de certificación y pase a producción

| # | P | Pregunta | Respuesta |
|---|---|---|---|
| A1 | B | ¿Existe un proceso formal de certificación/homologación antes de habilitar el consumo en producción? Si sí: ¿qué casos de prueba exigen, quién los valida y cuánto suele tardar? | |
| A2 | B | ¿El ambiente de certificación (`apimktdesa.baneco.com.bo`) permite **simular el pago de un QR** generado por nosotros? ¿Cómo se dispara ese pago de prueba (app de pruebas, endpoint utilitario, solicitud al banco)? | |
| A3 | B | Las credenciales de certificación que figuran como ejemplo en la §1 de la especificación v1.3.0 (usuario y llave AES), ¿son de uso compartido o se nos asignarán credenciales de certificación propias? | |
| A4 | I | ¿Qué cuenta de abono (`accountCredit`) válida debemos usar en certificación? ¿Hay cuentas de prueba pre-creadas? | |
| A5 | I | ¿El ambiente de certificación está disponible 24/7 o tiene horarios/ventanas? | |

## B. Autenticación y cifrado

| # | P | Pregunta | Respuesta |
|---|---|---|---|
| B1 | B | ¿Cuál es la **vigencia exacta del JWT** emitido por `/api/authentication/authenticate` y la política recomendada de renovación? ¿Hay límite de tokens simultáneos o rate limit sobre ese endpoint? | |
| B2 | B | ¿Pueden confirmar formalmente el esquema de cifrado AES? Nuestro entendimiento: **AES-256-CBC, padding PKCS7, IV aleatorio de 16 bytes antepuesto al ciphertext, todo codificado Base64**. ¿Disponen de vectores de prueba oficiales (texto plano + llave + resultado esperado)? | |
| B3 | I | ¿La llave AES rota periódicamente? ¿Con qué procedimiento y preaviso se comunica un cambio de llave? ¿Podemos solicitar una **rotación de la llave de producción** antes del go-live, dado que la actual circuló por canales ofimáticos? | |
| B4 | I | ¿Existe bloqueo del usuario API por intentos fallidos de autenticación? ¿Cuál es el procedimiento de desbloqueo y el contacto? | |

## C. Generación y ciclo de vida del QR

| # | P | Pregunta | Respuesta |
|---|---|---|---|
| C1 | B | ¿Cuál es la **vigencia máxima y mínima admitida para `dueDate`**? (Operaremos con vigencias cortas por cobro; necesitamos conocer los límites reales.) | |
| C2 | B | ¿Qué **límites de monto** aplican por transacción QR y por día (normativa BCB/ASFI + política del banco)? ¿Qué error retorna un QR generado por encima del límite y qué ocurre si el pagador excede su propio límite? | |
| C3 | B | ¿La **unicidad de `transactionId`** la valida el banco? ¿Qué `responseCode` retorna un duplicado? ¿La unicidad es global o por día? | |
| C4 | I | Cuando un QR alcanza su `dueDate` sin pago, ¿qué retorna `statusQR`? (La espec. documenta 0 activo, 1 pagado, 9 anulado — ¿existe un estado "vencido" o sigue retornando 0?) ¿Un QR vencido puede aún ser pagado? | |
| C5 | I | `cancelQR` sobre un QR ya vencido o ya anulado: ¿retorna error o éxito idempotente? ¿Qué `responseCode` en cada caso? | |
| C6 | I | Además de `qrImage` (PNG Base64), ¿la API puede entregar el **payload EMV/texto del QR**? (Nos permitiría regenerar la imagen con nuestro propio render y validar su contenido.) | |
| C7 | ✔ | ¿Confirman que el QR generado es **interoperable con el estándar QR BCB**, pagable desde la app de cualquier entidad financiera boliviana (incluidas billeteras como Yape)? | **SÍ — resuelta por el dueño (2026-08-27), no requiere respuesta del banco:** la interoperabilidad universal es la definición misma de "QR Simple" en Bolivia — el estándar de Pagos Inmediatos QR BCB obliga a que todo QR emitido por una entidad sea pagable desde la app de cualquier otra (ver `docs/02-qr-simple-bolivia.md` §1). Puede omitirse del envío al banco. |
| C8 | D | ¿Hay límite de QRs generados por hora/día u otro rate limit general del API Gateway que debamos respetar? | |
| C9 | D | ¿Se aplican **comisiones** al comercio receptor por cobro QR acreditado? ¿Cómo se liquidan (descuento en el abono o cargo aparte)? | |

## D. Notificación y verificación de pagos

| # | P | Pregunta | Respuesta |
|---|---|---|---|
| D1 | B | ¿Desde qué **rangos de IP públicas** invoca el banco el webhook `notifyPaymentQR`? (Los necesitamos para lista blanca; sin este dato el webhook no se habilita.) | |
| D2 | B | ¿Ofrecen algún mecanismo de **autenticación del webhook** (firma HMAC, mTLS, token en header)? Si hoy no existe: ¿está en el roadmap? | |
| D3 | B | ¿Cuál es la **política de reintentos** del webhook (cantidad, intervalos, ante qué respuestas HTTP se reintenta y cuándo se desiste)? | |
| D4 | B | ¿Cómo se **registra y actualiza la URL** del webhook del comercio? ¿Es autogestionable o requiere trámite con el banco? ¿Puede operarse **sin webhook** (solo `statusQR` + `paidQR`), como haremos en la primera etapa? | |
| D5 | I | ¿Qué latencia típica hay entre la acreditación del pago y (a) el disparo del webhook, (b) el reflejo en `statusQR` = 1? | |
| D6 | I | ¿Qué frecuencia de **polling sobre `statusQR`** consideran aceptable por QR pendiente? ¿Hay rate limit específico? | |
| D7 | I | `paidQR/{fecha}`: ¿la fecha corresponde a la fecha de pago en hora boliviana (UTC-4)? ¿A partir de qué hora el listado del día anterior está completo y estable (hora de corte)? | |
| D8 | B | ¿Puede un pago QR ser **revertido/extornado** después de reportarse `statusQrCode = 1`? Si sí: ¿cómo se entera el comercio (webhook, cambio de estado, aviso manual)? | |
| D9 | D | En pagos desde otras entidades (interoperabilidad BCB), ¿`senderBankCode`/`senderName` llegan siempre poblados y con qué catálogo de códigos ASFI debemos mapear? | |

## E. Errores, límites y operación

| # | P | Pregunta | Respuesta |
|---|---|---|---|
| E1 | B | ¿Disponen del **catálogo oficial de `responseCode` y `message`** de error de todos los servicios? (La espec. v1.3.0 no lo incluye.) | |
| E2 | I | ¿Cuál es el canal de **soporte técnico** para la integración (contacto, horario, SLA) y el canal de aviso de **incidentes y ventanas de mantenimiento** del API Gateway? | |
| E3 | D | ¿Está prevista una versión futura de la especificación (v1.4+) con cambios que debamos anticipar? ¿Cómo se comunican los cambios de API (deprecaciones, versionado)? | |

## F. Cuenta de abono y conciliación

| # | P | Pregunta | Respuesta |
|---|---|---|---|
| F1 | I | ¿Cada pago QR se acredita como **movimiento individual** en la cuenta de abono, o puede consolidarse (la espec. menciona abonos por total por sucursal vía `branchCode`)? ¿Qué glosa/referencia lleva el crédito en el extracto para cuadrarlo con el `qrId`/`transactionId`? | |
| F2 | D | `accounts/history`: ¿qué profundidad máxima de histórico permite por consulta y existe paginación para rangos con muchos movimientos? | |
| F3 | D | ¿El servicio de consulta de movimientos usa el mismo usuario API o requiere permisos adicionales sobre la cuenta? | |

---

## Supuestos de trabajo mientras llegan las respuestas

Para no bloquear el arranque en Claude Code, el desarrollo contra **certificación**
procede con estos supuestos explícitos, cada uno atado a su pregunta:

1. JWT de corta duración renovado de forma anticipada y reintento único ante 401 (B1).
2. Cifrado AES-256-CBC/PKCS7/IV-prepended/Base64, validado empíricamente contra el
   endpoint utilitario de certificación en el Hito B0 (B2).
3. Operación **sin webhook**: detección por polling de `statusQR` (intervalo
   conservador de 2–5 min por QR pendiente) + conciliación diaria `paidQR` (D4, D6).
4. Vigencia corta por cobro (72 h por defecto, configurable) hasta conocer los límites
   reales de `dueDate` (C1).
5. Todo `responseCode != 0` se trata como error opaco: se registra como evidencia, no
   transiciona estados y alimenta el catálogo empírico de errores (E1).
6. Ningún supuesto pasa a producción sin la respuesta correspondiente del banco o
   verificación formal en certificación.
