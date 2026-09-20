# 10 — Contrato para proyectos consumidores

Cómo otro producto —NovuChat es el primero, y habrá más— pide un cobro por QR,
sabe cuándo se pagó y lo anula, **sin conocer nada del banco**.

Este documento es el contrato. Lo que no está acá, no es parte del contrato.

---

## 1. La regla que explica todo lo demás

**Ninguna operación de este contrato confirma un pago.**

Un consumidor puede crear un cobro, preguntar su estado, anularlo y listar los
suyos. No hay —ni va a haber— una operación con la que diga "esto ya se pagó".
Lo que un consumidor afirme sobre un pago vale exactamente lo mismo que el
comprobante que manda un pagador: es una señal, no una verdad (reglas #1 y
BANECO-1 de `CLAUDE.md`).

Un cobro pasa a `CONFIRMADO` por un solo camino: la **consulta saliente
autenticada** de este sistema al banco, conciliada por el dominio. La sostiene
el tipo `ConciliacionAprobada`, que solo fabrica `conciliar()`; no hay forma de
escribir una confirmación por otra vía sin que el compilador la rechace.

Consecuencia práctica para quien consume: **el estado que devuelve
`estadoCobro` es la fuente de verdad**. Cuando exista el aviso de confirmación
(bloque 2), será un acelerador: llega antes, pero se puede perder, y preguntar
por `estadoCobro` tiene que llevar siempre al mismo resultado.

## 2. Qué no hace este proyecto por el consumidor

- **No le manda nada al pagador.** El QR se entrega como imagen; hacerlo llegar
  —WhatsApp, correo, pantalla— es del consumidor, por su canal. Por eso un
  cobro de consumidor no tiene teléfono: lo que no se recibe no se puede
  filtrar.
- **No guarda datos de su cliente.** La referencia externa es opaca. Sin
  nombre, sin teléfono, sin NIT. Este sistema no necesita saber de quién es el
  cobro.
- **No lleva ninguna lógica de negocio del consumidor.** Planes, meses
  adelantados, cortes, recordatorios y reintentos de cobranza son de quien
  cobra, no de quien emite el QR.

## 3. Autenticación

Un token por consumidor, en el header estándar:

```
Authorization: Bearer <token del consumidor>
```

El token se configura en el entorno de la API como `CONSUMIDOR_TOKEN_<ID>`
—por ejemplo `CONSUMIDOR_TOKEN_NOVUCHAT`—, con un mínimo de 32 caracteres. El
identificador del consumidor sale del nombre de la variable, en minúsculas y
con los guiones bajos convertidos en guiones: `CONSUMIDOR_TOKEN_NOVUCHAT` es el
consumidor `novuchat`.

Una variable por consumidor, y no una lista dentro de una sola: así cada token
se rota, se revoca y se audita por separado. Un token corto, o el marcador de
la plantilla sin llenar, **corta el arranque de la API**.

Cada consumidor tiene además un **cupo de QRs por hora**
(`CONSUMIDOR_MAX_QRS_POR_HORA`, 60 por defecto). No es contra el uso normal:
es contra un token filtrado pidiendo QRs en bucle, porque cada QR emitido
queda pagable hasta la medianoche y cientos no se alcanzan a anular. Pasado el
cupo, `crearCobro` responde `429 CUPO_POR_HORA_AGOTADO`.

**Ningún token puede valer para dos identidades.** Si el del dueño y el de un
consumidor —o los de dos consumidores— fueran iguales, la API no arranca: uno
entraría como el otro.

Dos superficies separadas, no dos niveles de permiso de la misma:

| Prefijo | Quién | Qué |
| :--- | :--- | :--- |
| `/api/…` | el dueño | su consola: crear, enviar, renovar, revisar, resolver |
| `/api/v1/…` | un consumidor | este contrato |

Un token de consumidor no abre **ninguna** ruta del dueño, ni siquiera de
lectura, y el dueño no entra por el contrato. El cruce responde **404**, no
403: un 403 confirmaría que la ruta del otro lado existe. Por el mismo motivo,
el cobro de otro consumidor responde 404 y no 403.

## 4. Las cuatro operaciones

Todos los montos van y vienen como **texto decimal con punto** (`"150.50"`),
nunca como número: un `number` de JSON ya perdió cuántos decimales traía y
arrastra el error de punto flotante que la regla #5 prohíbe.

### 4.1 `crearCobro` — `POST /api/v1/cobros`

```json
{
  "referenciaExterna": "plan-2026-09-cliente-4471",
  "concepto": "Plan mensual septiembre",
  "monto": "150.50",
  "horasDeVigencia": 72
}
```

| Campo | Obligatorio | Qué |
| :--- | :--- | :--- |
| `referenciaExterna` | sí | Opaca y única por consumidor. Letras, números y `: _ . -`, hasta 120 caracteres. |
| `concepto` | sí | Hasta 100 caracteres. **Lo ve quien paga, en su app bancaria**: no pongas ahí datos de tu cliente. |
| `monto` | sí | Decimal con punto, hasta dos decimales. |
| `horasDeVigencia` | no | Por defecto, la del servidor (72 h). |

Respuesta **201** (cobro nuevo) o **200** (reintento: ya existía):

```json
{
  "cobro": {
    "id": "cons-9f2a…",
    "referenciaExterna": "plan-2026-09-cliente-4471",
    "estado": "QR_ACTIVO",
    "monto": "150.50",
    "moneda": "BOB",
    "concepto": "Plan mensual septiembre",
    "creadoEn": "2026-09-19T14:03:11.000Z",
    "qr": { "version": 1, "venceEn": "2026-09-22T14:03:11.000Z", "imagenDisponible": true },
    "pago": null
  },
  "imagenQrBase64": "iVBORw0KGgo…"
}
```

**Idempotencia por referencia externa.** Dos pedidos con la misma
`referenciaExterna` devuelven el mismo cobro y **un solo QR**. Es lo que impide
que un reintento —un timeout, un reinicio a mitad de camino— le cobre dos veces
al mismo cliente. No es una búsqueda previa, que sería una carrera: el id del
cobro se deriva de `(consumidor, referenciaExterna)` y la creación es atómica.

Un pedido con la misma referencia y **otro importe** no es un reintento: es un
error de quien llama, y se rechaza con `409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA`
en vez de elegir uno de los dos importes.

Lo que se compara es **solo el importe**. Si repetís la referencia con otro
concepto u otra vigencia, recibís el cobro original tal como estaba: el
concepto y el vencimiento del primero son los que valen. Y si ese cobro ya
está `VENCIDO`, `ANULADO`, `RECHAZADO` o `CONFIRMADO`, también lo recibís tal
cual, con 200 — **una referencia externa no se recicla**. Mirá el `estado`
antes de mostrarle el QR a alguien; para volver a cobrar, usá una referencia
nueva.

| Respuesta | Cuándo |
| :--- | :--- |
| `201` | Cobro nuevo, con su QR. |
| `200` | Ya existía: mismo cobro, mismo QR, ningún cargo nuevo. |
| `400 CUERPO_INVALIDO` · `400 MONTO_INVALIDO` | El pedido está mal formado. |
| `409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA` | Misma referencia, otro importe. |
| `429 CUPO_POR_HORA_AGOTADO` | Este consumidor pidió demasiados QRs en la última hora. |
| `502 PROVEEDOR_RECHAZO` | El banco rechazó la emisión. |
| `502 QR_SUELTO_EN_EL_PROVEEDOR` | No se pudo registrar el QR **y** el banco tampoco lo anuló. No hay cobro, pero puede haber un QR cobrable: avisá y no reintentes con la misma referencia hasta que se revise. |
| `503 SERVICIO_NO_DISPONIBLE` | Un servicio externo no respondió. Reintentable, y el reintento es seguro. |

En la prueba controlada en producción se suman `400 MONTO_SOBRE_LIMITE_DE_PRUEBA`
y `409 LIMITE_DE_PRUEBA`: son los topes de esa prueba, no del contrato.

### 4.2 `estadoCobro` — `GET /api/v1/cobros/:id` · `GET /api/v1/cobros/por-referencia/:referencia`

Las dos devuelven lo mismo. Usá la que te quede cómoda: la referencia externa
es tuya y no tenés que guardar nuestro id si no querés.

```json
{
  "cobro": {
    "id": "cons-9f2a…",
    "referenciaExterna": "plan-2026-09-cliente-4471",
    "estado": "CONFIRMADO",
    "monto": "150.50",
    "moneda": "BOB",
    "concepto": "Plan mensual septiembre",
    "creadoEn": "2026-09-19T14:03:11.000Z",
    "qr": { "version": 1, "venceEn": "2026-09-22T14:03:11.000Z", "imagenDisponible": true },
    "pago": {
      "confirmadoEn": "2026-09-19T14:04:02.000Z",
      "ocurridoEn": "2026-09-19T14:03:52.000Z",
      "monto": "150.50",
      "riel": "api-baneco",
      "confirmadoPor": "automatico"
    }
  }
}
```

- `pago` es `null` mientras el cobro no esté `CONFIRMADO`.
- `ocurridoEn` es cuándo lo dice el banco; `confirmadoEn`, cuándo lo dio por
  bueno este sistema. En la prueba en producción la diferencia fue de segundos.
- `riel`: `api-baneco` (la consulta autenticada a la API del banco) o
  `scraping-yape` (el riel diferido). `null` si la evidencia no lo registra.
- `confirmadoPor`: `automatico` (concilió solo) o `revision-manual` (lo resolvió
  una persona, sobre un abono que el banco igualmente reportó — sin detección
  del banco no hay confirmación, tampoco manual).

**Esta consulta no toca el banco.** Lee el estado guardado, que mantiene al día
el satélite con su propia consulta autenticada. Así un consumidor que pregunta
seguido no puede, sin querer, generar tráfico contra la cuenta del banco ni
hacer que se bloquee el usuario de la API (amenaza T8).

### 4.3 `anularCobro` — `POST /api/v1/cobros/:id/anular`

Cuerpo opcional: `{ "motivo": "el cliente canceló el plan" }`.

Tres desenlaces, distinguidos:

| Respuesta | Qué pasó |
| :--- | :--- |
| `200 { "resultado": "ANULADO", … }` | El QR quedó muerto en el banco. Repetirlo sobre un cobro ya anulado devuelve lo mismo: el reintento es inofensivo. |
| `409 PAGADO_NO_SE_ANULA` | Hay plata. No se anuló nada. Consultá el estado. |
| `409 PAGO_TARDIO_EN_REVISION` | Llegó un pago sobre el QR vencido. El cobro pasó a revisión manual; lo decide una persona. |

Los dos últimos son errores HTTP y no un `resultado` dentro de un 200 a
propósito: un consumidor que solo mira el código tiene que enterarse de que
**no** anuló.

Por qué hay que anular de verdad y no solo "olvidarse" del cobro: el banco
vence los QR **por día, no por hora** (respuesta C4 de Baneco). Un cobro que
para vos ya no existe seguiría cobrable hasta la medianoche. Por eso este
sistema exige la constancia de anulación del banco antes de soltar un QR.

Y por qué los dos casos se distinguen acá aunque el banco no los distinga: en
la prueba en producción, `cancelQR` devolvió el mismo `responseCode 403` sobre
un QR ya anulado y sobre uno pagado (`Integraciones/baneco/02-hallazgos-produccion.md`
§3.1). El adaptador consulta el estado para desambiguar; el consumidor recibe
la respuesta ya desambiguada.

### 4.4 `listarCobros` — `GET /api/v1/cobros?desde=&hasta=&limite=`

Los cobros propios de un rango, para conciliar contra tu propio sistema.

| Parámetro | Por defecto | Notas |
| :--- | :--- | :--- |
| `desde` | 7 días antes de `hasta` | ISO 8601 **con zona** (`Z` o `±hh:mm`). |
| `hasta` | ahora | Exclusivo, para que dos rangos contiguos no compartan un cobro. |
| `limite` | 50 | De 1 a 100. |

La zona es obligatoria a propósito: el banco informa en hora de Bolivia
(respuesta D7) y el consumidor puede estar en otra. Una fecha sin zona
obligaría a adivinar cuál, y adivinar mal corre un cierre de día entero.

Respuesta:

```json
{
  "desde": "2026-09-12T14:03:11.000Z",
  "hasta": "2026-09-19T14:03:11.001Z",
  "limite": 50,
  "truncado": false,
  "cobros": [ { "id": "cons-9f2a…", "…": "…" } ]
}
```

`truncado: true` significa que vinieron tantos como el límite y puede haber
más: acortá el rango o subí el límite, no supongas que los viste todos.

Rango máximo: 92 días (`400 RANGO_DEMASIADO_LARGO`).

### 4.5 La imagen del QR — `GET /api/v1/cobros/:id/qr`

```json
{ "imagenQrBase64": "iVBORw0KGgo…", "venceEn": "2026-09-22T14:03:11.000Z" }
```

Viene también en la respuesta de `crearCobro`, para que no haga falta una
segunda llamada. Este endpoint sirve para volver a pedirla.

`404 SIN_IMAGEN` si el cobro no tiene la imagen guardada: el QR existe en el
banco igual, pero no se pudo archivar el PNG. El `estado` del cobro sigue
siendo la verdad; la imagen, no.

## 5. Estados que puede ver un consumidor

Son los del dominio (`CLAUDE.md`, "Máquina de estados del cobro"):

| Estado | Qué significa para el consumidor |
| :--- | :--- |
| `BORRADOR` | El cobro quedó reservado pero su QR no se llegó a emitir (el banco falló). `qr` viene en `null`. Reintentá `crearCobro` con la **misma** referencia: retoma este cobro en vez de crear otro. |
| `QR_ACTIVO` | El QR existe y se puede pagar. |
| `PAGO_DETECTADO` | El banco reportó un abono; todavía no concilió. **Todavía no cobres por pagado.** |
| `CONFIRMADO` | Plata conciliada. Terminal. |
| `EN_REVISION` | Algo no cerró (monto distinto, pago fuera de vigencia, duplicado). Lo mira una persona. |
| `VENCIDO` | El QR venció sin pago y quedó anulado en el banco. |
| `ANULADO` | Anulado. Terminal. |
| `RECHAZADO` | Una persona resolvió que no correspondía cobrar. Terminal. |

`ENVIADO` y `COMPROBANTE_RECIBIDO` no aparecen en los cobros de consumidor:
son de los cobros que el dueño manda por WhatsApp desde su consola.

**Solo `CONFIRMADO` es "está pagado".** `PAGO_DETECTADO` es una detección sin
conciliar, y existe como estado aparte justamente para que nadie la confunda
con una confirmación.

## 6. Lo que el banco no da, y por eso el contrato no lo da

**El texto del QR.** `generateQR` de Banco Económico devuelve `qrId` y una
imagen PNG, no la cadena EMV del QR. Sacar el texto exigiría decodificar el
PNG, y este proyecto no inventa lo que el proveedor no entrega (regla #12
aplicada al banco). El contrato entrega la imagen.

Queda como pregunta abierta al banco: si `generateQR` puede devolver también el
texto del QR, el contrato sumaría un campo `qr.texto` sin cambiar nada más.

## 7. Errores, en general

Todos los errores tienen la misma forma:

```json
{ "error": { "codigo": "PAGADO_NO_SE_ANULA", "mensaje": "…", "detalle": { } } }
```

`codigo` es estable y es lo que hay que mirar; `mensaje` es para una persona y
puede cambiar. Ningún error lleva datos del pagador, identificadores del banco,
códigos de su API ni el nombre de sus métodos: la superficie del contrato
descarta ese detalle antes de responder. Sirve para que el dueño diagnostique
en su consola, y contarlo acá ataría el contrato al proveedor de hoy.

| HTTP | Cuándo |
| :--- | :--- |
| 400 | El pedido está mal formado (cuerpo, monto, rango). |
| 401 | Falta el token o no es válido. |
| 404 | No existe, o no es tuyo. No se distingue. |
| 405 | El método no aplica a esa ruta. |
| 409 | El pedido está bien, pero el estado del cobro no lo admite. |
| 429 | Se agotó el cupo de QRs por hora de este consumidor. |
| 502 | El banco rechazó la operación. |
| 503 | Un servicio externo no respondió. **Reintentable** — y el reintento es seguro, porque crear es idempotente. |

## 8. Lo que este contrato no tiene (todavía)

- **Aviso de confirmación** (bloque 2): hoy hay que preguntar por
  `estadoCobro`. Cuando exista el aviso, seguirá siendo un acelerador y no la
  fuente de verdad.
- **Renovar un QR vencido desde el contrato**: hoy la renovación la hace el
  dueño desde su consola. Un consumidor que quiera volver a cobrar usa una
  referencia externa nueva.
- **Una cuenta de cobro por consumidor** (bloque 3): hoy todos los cobros van a
  la única cuenta configurada.
- **Paginación por cursor**: el listado se acota por rango y límite.
- **Reciclar una referencia externa**: una vez usada, identifica ese cobro para
  siempre. Para volver a cobrarle lo mismo a alguien, usá otra.

## 9. Referencias

- Reglas de negocio inviolables y máquina de estados: `CLAUDE.md`.
- Por qué el webhook del banco tampoco confirma: `01-arquitectura.md`, ADR-006,
  regla BANECO-1.
- Lo que la prueba con plata real dejó demostrado:
  `Integraciones/baneco/02-hallazgos-produccion.md`.
- `06-seguridad.md` — modelo de amenazas y dónde vive cada credencial.
