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
   confirmable en la consola sin que tengas que buscarlo.

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
El banco reporta un pago que ya había confirmado otro paso del sistema.
- Casi siempre es una **doble lectura**, no un segundo pago. Mirá el extracto: si hay un
  solo crédito, rechazá. Si hay dos, aceptá y devolvé el sobrante.

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

### Cuando rechazás un caso con plata recibida
Rechazar **no devuelve el dinero**: el sistema no mueve fondos (regla #3). La devolución
se hace por fuera, por transferencia, y conviene dejar la referencia en el motivo del
rechazo.

## 5. Límites conocidos (demo)

- **Las alertas viven en la consola abierta.** Con la consola cerrada, nadie avisa. Cuando
  exista `wa-bridge`, el paso natural es avisarle al dueño por WhatsApp los casos
  críticos.
- **Los abonos sin cobro no están en la consola.** Los pagos que el cierre diario no puede
  asociar a ningún cobro (huérfanos o sin corroborar) van al log del satélite
  (`! abono para revisar a mano: …`). Hay que leer ese log después de cada cierre hasta
  que se persistan.
- **La marca de "revisión hecha" es local** del navegador (`localStorage`). No es
  evidencia ni se comparte entre dispositivos.
