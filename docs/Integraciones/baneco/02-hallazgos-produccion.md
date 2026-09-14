# 02 — Hallazgos de la prueba controlada en producción

**Corrida:** 2026-09-13 (P1–P8) y 2026-09-14 (P9, y P6–P7 repetidas). Banco Económico,
API de producción, QRs de **Bs 1**, datos en el emulador local. Procedimiento:
[`03-prueba-en-produccion.md`](./03-prueba-en-produccion.md). Se repite completo con cada
cuenta de cobro nueva o banco nuevo (ESTADO, decisión 16).

**Resultado:** **P1–P9 ok.** El ciclo completo del cobro funciona contra el banco real:
autenticación y cifrado, QR interoperable, pagos desde Baneco y desde otro banco,
detección, conciliación, anulación, vencimiento y cierre diario. Hubo un hallazgo del
banco que obligó a corregir el adaptador (§3.1).

Este documento no lleva datos de quien pagó, números de cuenta ni ids de transacción: solo
estados, códigos, horarios y demoras. Las horas van en **hora de Bolivia** (UTC−4).

## 1. Las nueve pruebas

| # | Prueba | Resultado | Evidencia |
|---|---|---|---|
| P1 | Autenticación | ✅ | `authenticate` → HTTP 200, `responseCode 0` (0,9 s). El banco aceptó credenciales y cifrado: confirma end-to-end el esquema AES (B2). |
| P2 | Pago desde la app de Banco Económico | ✅ | `CONFIRMADO` 41 s después de emitido el QR (incluye escanear y pagar). Una sola detección, conciliada. |
| P3 | Pago desde otro banco | ✅ | Desde el **BNB** (Banco Nacional de Bolivia). `CONFIRMADO` 48 s después de emitido. El QR es interoperable (C7). |
| P4 | Pagar un QR anulado | ✅ | Anulado con "Anular en el banco" (`cancelQR` → `responseCode 0`); la app rechazó el pago (observado por el dueño). |
| P5 | Pagar dos veces el mismo QR | ✅ | La app rechazó el segundo pago: el QR es de un solo uso (observado por el dueño). |
| P6 | Anular un QR ya pagado | ✅ | `cancelQR` → HTTP 200, **`responseCode 403`**. El banco no lo anula; el cobro sigue `CONFIRMADO`. |
| P7 | Anular dos veces el mismo QR | ⚠️ ok, pero **no idempotente** | Segunda anulación → HTTP 200, **`responseCode 403`**, el mismo código que P6. Ver §3.1. |
| P8 | El vencimiento anula el QR | ✅ | QR de 5 min: `VENCIDO` 5 min después, con la anulación en el banco en la evidencia; la app rechazó el pago (observado por el dueño). |
| P9 | Cierre diario | ✅ | `cierre 2026-09-13: abonos=3 confirmados=0 enRevision=0 yaRegistrados=3 sinCorroborar=0 huerfanos=0`. |

Tiempos de confirmación: 41, 48, 55 y 66 s desde la emisión del QR, en los cuatro pagos.
Incluyen el tiempo de escanear y pagar; la detección en sí ocurre en la consulta siguiente
(el satélite consulta cada 10 s en la prueba, o al tocar "Ya pagué").

## 2. Lo que confirma sobre el banco

- **B2, esquema AES:** confirmado end-to-end por el login de producción.
- **C7, interoperabilidad:** un pago desde el BNB concilia igual que uno desde Baneco.
- **D5, reflejo en línea:** `statusQR` informa el pago en la primera consulta después de
  pagar.
- **D7, `paidQR` en hora de Bolivia:** los pagos de las 21:00 del 13 (01:00 UTC del 14)
  aparecen en el reporte del día 13, y el cierre los encuentra como ya registrados.
- **`singleUse`:** un QR pagado no admite un segundo pago, y uno anulado o vencido no admite
  ninguno.

Demoras observadas: `authenticate` 0,9 s; `generateQR` 0,8–1,8 s; `statusQR` 0,1–0,5 s;
`cancelQR` 0,15–0,55 s.

## 3. Hallazgos y qué se hizo

### 3.1 `cancelQR` no es idempotente, y su código es ambiguo (corregido)

El banco responde **`responseCode 403`** tanto al anular un QR **ya anulado** (P7) como al
anular uno **pagado** (P6). Hay dos consecuencias:

- **La doble anulación no es idempotente**, y el puerto `QrProvider.anular` exige que lo
  sea. Un reintento de anulación después de un timeout, en el que el banco sí la había hecho,
  daba error. El cobro no avanzaba y se reintentaba sin fin (riesgo B2 de la auditoría).
- **El código solo no distingue los dos casos.** Tratar el 403 como éxito sin mirar sería
  grave: daría por anulado un QR pagado y soltaría un cobro con plata recibida.

**Corrección** (`QrProviderBaneco.anular`): ante un rechazo del banco con `responseCode`,
se consulta `statusQR`. Si el QR figura **anulado**, la anulación ya estaba hecha y es
éxito. En cualquier otro caso (pagado, activo, o la consulta falla) se devuelve el rechazo
original. Tiene tests con la respuesta real.

### 3.2 La protección contra anular un QR pagado funcionó con plata real

El dueño tocó "Anular" sobre un QR que acababa de pagar. La API consultó el banco antes de
anular, vio el pago y respondió **409 `ABONO_DETECTADO`** sin anular nada. El cobro se
confirmó en la verificación siguiente. Es la regla "un cobro no suelta un QR que todavía se
puede pagar sin anularlo antes" (#21), vista del otro lado.

### 3.3 La consola congelaba una tarjeta en `PAGO_DETECTADO` (corregido en #32)

Una tarjeta mostró `PAGO_DETECTADO` con la confirmación ya en su evidencia. En el emulador,
el cobro estaba `CONFIRMADO`. El dominio escribe la evidencia antes que el estado; una
consulta cayó entre las dos escrituras, y la pestaña Pruebas dejaba de refrescar todo lo que
no estuviera esperando pago. No fue un problema del dominio.

### 3.4 Los logs no sobrevivían a un reinicio (corregido en #33)

Los `responseCode` de "Sondear anulación" y la línea del cierre diario se perdían al
reiniciar la API o al cerrar la terminal del satélite. Ahora van a `~/.manejoqr/logs/`
(saneados, 700/600) y la pestaña Logs los muestra aunque los procesos se reinicien.

### 3.5 Los datos del emulador se borraron antes de terminar (guía corregida en #33)

La guía indicaba borrar `~/.manejoqr/emulador-prueba` después de P9, y P6–P7 todavía no
tenían sus códigos anotados. Sin los cobros, no había sobre qué sondear, y hubo que emitir
QRs nuevos (uno pagado, Bs 1 más). La guía dice ahora que se borra recién con el informe
documentado.

## 4. Catálogo empírico de `responseCode` (pregunta E1)

| Operación | `responseCode` | Cuándo |
|---|---|---|
| todas | `0` | Éxito. |
| `cancelQR` | `403` | El QR no se puede anular: **ya estaba anulado o está pagado**. Para saber cuál, hay que consultar `statusQR`. |

## 5. Lo que queda abierto

- **Fixtures reales:** las de `baneco-gateway` siguen derivadas de la especificación. Los
  logs no guardan cuerpos a propósito, así que las respuestas reales saneadas llegarán con
  el modo pago asistido del B0 en certificación (`tools/baneco-b0`, espera la cuenta de
  pruebas A4).
- **Comisiones (C9):** confirmar con el ejecutivo si al abono se le descuenta alguna. En la
  prueba, los pagos se conciliaron por el monto del QR.
