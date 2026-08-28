# Satélite de Baneco

Proceso que verifica los pagos contra el banco y los concilia (ADR-006, decisión D2
opción b). Corre **fuera de Firebase** —ThinkPad en la Fase 0–1, VM de OCI cuando el
demo necesite 24/7— con el mismo patrón que el scraper.

```bash
npm run satelite:baneco            # bucle continuo
npm run satelite:baneco -- --una   # una sola pasada y termina
```

Necesita `.env` con el bloque `BANECO_CERT_*` y una credencial de servicio de Firebase
(`GOOGLE_APPLICATION_CREDENTIALS`), de mínimo privilegio (docs/05 §4).

## Qué hace cada pasada

Por cada cobro pendiente (`ENVIADO` o `COMPROBANTE_RECIBIDO`):

1. **Si el QR venció, lo marca `VENCIDO`.** Antes de consultar al banco: un cobro
   vencido ya no es candidato a confirmarse solo, y dejarlo en `ENVIADO` haría que el
   satélite lo consultara para siempre.
2. **Si sigue vigente, le pregunta al banco y concilia** (`statusQR` → `verificarPago`).

Un cobro que falla no corta la pasada: se anota y se reintenta en la próxima vuelta.
Lo único que corta la pasada entera es no poder listar los pendientes — sin esa lista
no hay forma de saber qué cobros quedaron sin mirar.

## Qué NO hace

- **No emite ni renueva QRs.** Eso lo decide el dueño desde la consola. Un proceso que
  renueva solo podría reemitir QRs indefinidamente sobre un cobro que ya nadie va a pagar.
- **No confirma nada por su cuenta.** Solo llama a `verificarPago`, que exige una
  `ConciliacionAprobada` — y esa únicamente sale de `conciliar()` (reglas #1 y BANECO-1).
- **No contiene reglas de negocio.** Es una raíz de composición: cablea puertos y repite.

## El aviso al cliente todavía no sale

`wa-bridge` no está implementado (docs/ESTADO.md, decisión 7: hay que verificar la API
real de WhatsAppModular antes de escribirlo). El satélite usa
`MensajeriaNoConfigurada`, que **falla a propósito** en vez de fingir éxito.

Pasar el mock en memoria de `qr-core` habría sido peor: devuelve éxito, así que el
satélite creería haber avisado al cliente y nadie se enteraría de que la confirmación
nunca salió. Con este proveedor, cada pasada reporta cuántos avisos quedaron sin enviar.

No rompe nada: `verificarPago` trata el aviso como cortesía, no como parte de la
confirmación. El cobro se confirma igual.

## Cómo se prueba

`pasada.ts` no tiene temporizadores ni conexiones: recibe los puertos y devuelve un
resumen, así que se prueba entera con mocks en CI (`npm test`). El cableado real
—Firestore y el cliente del banco— vive en `main.ts` y se verifica a mano contra el
emulador.
