# 09 — Revisión manual de cobros

Guía operativa para los cobros en `EN_REVISION`: qué son, cuándo alerta la consola y
qué hacer con cada caso. La consola (`npm run dev`, pestaña **Revisión**) muestra la
recomendación de cada caso en una línea; este documento es la versión completa.
Si cambia una, cambia la otra (`packages/demo-web/src/alertas.ts`).

## 1. Qué es un caso en revisión

Un cobro llega a `EN_REVISION` cuando el sistema **no puede decidir solo** y no debe
adivinar. Hay dos familias:

- **Hay plata recibida** (el banco reportó un pago) pero no concilia: monto distinto,
  pago fuera de vigencia, un pago ya usado, o un pago sobre un QR vencido. Del otro lado
  hay un cliente que pagó y espera.
- **No hay plata** pero hay una señal de pago: el cliente mandó un comprobante y el
  banco nunca registró nada hasta que venció el QR.

La misma pestaña muestra además, en su propia sección, los **pagos sin cobro que los
explique**: plata que el cierre diario encontró en la cuenta y que ningún cobro espera
(ver "Pago sin cobro" en §4). No son cobros: no se aceptan ni se rechazan, se cierran
dejando escrito qué se hizo con la plata.

Lo que la consola **no** permite, a propósito:

- **Aceptar un pago que el banco no reportó.** El botón "Aceptar el pago del banco"
  solo aparece si hay una detección del banco en la evidencia. Si no la hay, la acción
  es "Buscar el pago en el banco". Un comprobante, una captura o una llamada del cliente
  nunca alcanzan (regla #1: el comprobante falsificado es el fraude nº 1 del dominio).
- **Decidir sin motivo.** Aceptar y rechazar piden un motivo de al menos 10 caracteres,
  que queda en la evidencia con origen `accion-manual` (regla #8).

## 2. Alertas

| Situación | Atrasado desde | Crítico desde |
|---|---|---|
| Con pago recibido | 4 h | 24 h |
| Sin pago (solo comprobante) | 24 h | 72 h |
| Pago sin cobro (cuenta desde que lo encontró el cierre, no desde el pago) | 4 h | 24 h |

La diferencia es deliberada: con plata recibida hay un cliente esperando su
confirmación; sin plata, lo más probable es un pago que no se hizo.

La consola avisa de cuatro maneras:

- La **pestaña Revisión** muestra la cantidad de casos, con el color del caso más urgente.
- El **título del navegador** lleva la cantidad, por ejemplo `(3) Cobros por QR`, así que
  se ve aunque la consola esté en otra pestaña.
- Con **"Activar avisos del navegador"**, cada caso crítico nuevo dispara un aviso del
  sistema operativo. El aviso lleva solo conteos: nada del cliente sale de la página.
- Si hay casos y pasaron **más de 24 h** desde la última vez que marcaste "Revisión
  hecha", aparece un aviso fijo arriba de la cola.

La consola consulta la cola cada minuto mientras está abierta. Las alertas dependen de
eso: con la consola cerrada, nadie avisa (ver §5).

## 3. Rutina recomendada

1. **Una vez por día como mínimo**, a una hora fija (por ejemplo, al abrir la caja): abrí
   la pestaña Revisión, resolvé lo que puedas y tocá **"Marcar revisión hecha"**.
2. **Lo crítico, en el momento.** Un caso crítico con plata recibida es un cliente que
   pagó hace más de un día sin confirmación.
3. **La app del banco a mano.** Varias decisiones requieren mirar el extracto (duplicados,
   pagos de más). El sistema nunca lee saldos ni el extracto (regla #4): eso lo mirás vos.
4. **Después del cierre diario.** El satélite concilia el día anterior pasada la
   medianoche. Si encuentra un pago para un caso en revisión, lo adjunta: el caso queda
   confirmable en la consola sin que tengas que buscarlo. Si encuentra un pago que ningún
   cobro explica, aparece en "Pagos sin cobro que los explique".

## 4. Qué hacer con cada caso

### Monto distinto (`MONTO_NO_COINCIDE`)
El cliente pagó otro monto. La consola muestra la diferencia.
- **Pagó de menos:** rechazá y emití un cobro nuevo por la diferencia. Aceptá solo si
  decidís absorberla, y decilo en el motivo.
- **Pagó de más:** aceptá y devolvé el excedente por transferencia.
- **Nunca** cambies el monto de un cobro para que coincida con el pago.

### Pago fuera de vigencia (`FUERA_DE_VIGENCIA`)
El pago llegó después del vencimiento más la tolerancia (10 min).
- Si la venta o el servicio siguen en pie, aceptá el pago: el cliente pagó.
- Si ya no (el precio o el cupo vencieron), rechazá y devolvé el dinero.

### Pago ya usado (`DUPLICADO`)
El banco reporta un pago cuya clave ya se había usado para conciliar este cobro. Con QR de
un solo uso y la deduplicación por cobro, prácticamente no debería ocurrir.
- Es una **doble lectura** del mismo pago: **no lo aceptes** — aceptarlo confirmaría con
  una clave ya usada, no con un pago nuevo. Rechazalo.
- Mirá el extracto en la app del banco. Si de verdad hay dos créditos, el segundo se
  devuelve por fuera, y conviene reportarlo: significa que algo del sistema no funcionó.

### Pago a un QR vencido (`ABONO_TARDIO`)
El QR ya estaba vencido y anulado, pero el pago entró (carrera de segundos entre la
última consulta y la anulación, o un QR renovado que el cliente no recibió).
- El cliente pagó de verdad: casi siempre corresponde **aceptarlo**.
- **No** renueves ni reenvíes el cobro: le estarías pidiendo que pague dos veces.

### Comprobante sin pago en el banco (`VENTANA_AGOTADA`)
El cliente mandó comprobante y el banco nunca registró el pago.
- **No confirmes por el comprobante.** Es el caso típico de fraude.
- Tocá **"Buscar el pago en el banco"**. Si aparece, el caso pasa a ser confirmable.
- Si no aparece, pedile al cliente el **número de operación** y el **banco desde el que
  pagó**. Con eso, el oficial del banco puede rastrearlo (respuesta E2: hasta 48 h).
- Si igual no aparece, **rechazá**. Si el pago aparece más tarde, entra como abono sin
  cobro en el cierre diario y se atiende a mano.

### Caso atípico (`OTRO`)
Algo que el sistema no esperaba. Revisá el rastro de evidencia completo (pestaña Cobros →
detalle). Si no entendés cómo llegó ahí, **no lo resuelvas**: consultalo.

### Pago sin cobro (`HUERFANO` y `SIN_CORROBORAR`)
El cierre diario compara el reporte de pagos del banco (`paidQR`) con los cobros y
encontró plata que no puede explicar:

- **Huérfano:** ningún cobro espera ese QR. Es un QR anulado que igual se pagó, un QR
  ya renovado que el cliente pagó con la versión vieja, o un QR que el banco creó en un
  pedido que nosotros dimos por fallido (respuesta C3: el banco no valida duplicados).
- **Sin corroborar:** el cobro existe, pero la consulta del QR no confirma el pago, o el
  cobro ya se había confirmado con otro pago.

Qué hacer:

- **Mirá el extracto** en la app del banco. La consola muestra el monto, la hora y la
  clave del banco (`baneco:{qr}:{transacción}`), y el cobro del QR si lo hay.
- **Huérfano de un cobro anulado o renovado:** hablá con el cliente. O le devolvés la
  plata por transferencia, o dejás escrito a qué venta corresponde. **Nunca** lo cargues a
  otro cobro para que cierre.
- **Sin corroborar:** en el cobro, usá "Buscar el pago en el banco". Si sigue sin
  aparecer, consultá al oficial del banco antes de dar nada por pagado.
- **"Ya registra este pago":** el sistema detectó ese mismo pago en su cobro después del
  cierre (la consulta del QR lo vio más tarde). Ya está explicado y deja de alertar.
  **No devuelvas la plata:** cerralo indicando que figura en el cobro.
- Al terminar, **"Cerrar con un motivo"**, que pide 10 caracteres como mínimo. Escribí
  qué se hizo con la plata y la referencia de la devolución si la hubo. Un pago cerrado
  no vuelve a la cola aunque el cierre del día se repita.

Cerrar un pago sin cobro **no confirma ningún cobro**. Si descubrís que era de un cobro
que sigue abierto, ese cobro se resuelve por su propio camino.

### Cuando rechazás un caso con plata recibida
Rechazar **no devuelve el dinero**: el sistema no mueve fondos (regla #3). La devolución
se hace por fuera, por transferencia, y conviene dejar la referencia en el motivo del
rechazo.

## 5. Límites conocidos (demo)

- **Las alertas viven en la consola abierta.** Con la consola cerrada, nadie avisa. Cuando
  exista `wa-bridge`, el paso natural es avisarle al dueño por WhatsApp los casos
  críticos.
- **Un pago sin cobro se cierra, no se asigna.** La consola no ofrece "este pago es del
  cobro X": asignarlo a mano sería confirmar sin detección del banco sobre ese cobro. Si
  hace falta, el cobro se resuelve por su camino y el pago se cierra con el motivo.
- **Un día fuera de la ventana de cierre** (más de 3 días con el satélite apagado) no se
  concilia solo: el satélite lo avisa en su terminal y hay que conciliarlo a mano.
- **La marca de "revisión hecha" es local** del navegador (`localStorage`). No es
  evidencia ni se comparte entre dispositivos.
- **Aceptar confirma el pago que ves en pantalla.** Si mientras decidías el banco reportó
  otro (el cierre diario, o una búsqueda desde otra pestaña), la consola responde
  "El banco reportó otro pago mientras revisabas": actualizá y volvé a mirar.
- **Operaciones simultáneas sobre el mismo caso** (dos pestañas, doble clic, una búsqueda
  justo durante el cierre diario) pueden dejar un registro de más en la evidencia: una
  detección repetida, o una resolución que no se aplicó porque la otra ganó. **Nunca**
  un doble `CONFIRMADO`: el estado se escribe con precondición. El rastro sigue siendo
  auditable, pero conviene operar un caso desde una sola pestaña.
- **La cola muestra hasta 200 casos.** Si hay más, la consola lo avisa y los contadores
  se quedan cortos.
