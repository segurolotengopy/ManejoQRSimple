# Demo local

Ejercita el **sistema entero sin banco y sin WhatsApp**: la máquina de estados, la
conciliación y la persistencia son las de verdad; lo único simulado es el mundo exterior.

Todo corre contra el **emulador** de Firestore. Las herramientas se niegan a arrancar si
`FIRESTORE_EMULATOR_HOST` no está definida: siembran y borran datos, y hacerlo contra el
proyecto real sería destructivo.

## El ciclo completo, en un comando

```bash
npm run demo
```

Levanta el emulador, siembra cuatro cobros y muestra el estado. Después:

```bash
npm run demo:ui                      # emulador con UI en localhost:4000
npm run demo:sembrar                 # cobros de demostración
npm run demo:pagar -- demo-001       # simula el pago exacto
npm run satelite:demo                # una pasada del satélite
npm run demo:estado                  # estados + rastro de evidencia
```

Los últimos cuatro necesitan el emulador ya corriendo (`npm run demo:ui` en otra
terminal) o `FIRESTORE_EMULATOR_HOST=localhost:8080` en el entorno.

## Qué probar

Los cuatro cobros sembrados llevan a desenlaces distintos a propósito:

| Qué hacés | Qué pasa | Por qué |
|---|---|---|
| `demo:pagar -- demo-001` | → **CONFIRMADO** | Monto exacto, dentro de vigencia. |
| `demo:pagar -- demo-002 --monto 4549` | → **EN_REVISION** | Un centavo de menos. El monto no tiene tolerancia (regla #1). |
| `demo:pagar -- demo-003 --tarde` | → **EN_REVISION** | Abono posterior al vencimiento, fuera de la tolerancia. |
| No pagar `demo-003` | queda **ENVIADO** | El satélite lo sigue mirando. |
| `demo-004` | → **VENCIDO** | Nace con vigencia negativa. |
| Repetir el mismo `demo:pagar` | nada cambia | El id del abono es la clave de deduplicación (regla #7). |

`demo:estado` imprime el rastro append-only de cada cobro: se ve **por qué** cada uno
está donde está, con timestamp y origen de cada transición.

## Lo que el demo simula, y lo que no

**Simulado:** el banco (`QR_PROVIDER=mock`) y el envío por WhatsApp.

**Real:** la máquina de estados, la conciliación, la política de vencimiento, la
deduplicación, la evidencia append-only y la persistencia en Firestore — incluidas las
escrituras con `create()` que hacen imposible sobrescribir un registro.

Los abonos simulados se escriben en `abonos/*`, que es **el mismo lugar** donde los
dejará el `yape-scraper` (docs/05 §2). El watcher que los lee
(`PAYMENT_WATCHER=simulado`) no es un mock: es el lado lector de ese diseño.

## Una diferencia deliberada con el satélite en producción

El sembrador usa el mock de mensajería; el satélite en producción usa
`MensajeriaNoConfigurada`, que **falla a propósito**.

No es incoherencia. En producción, que el envío falle en silencio sería creer que el
cliente fue avisado cuando no lo fue. En el demo, si el envío fallara los cobros se
quedarían en `QR_ACTIVO` —`enviarQr` no transiciona a `ENVIADO` si el mensaje no salió,
y con razón— y no habría nada que el satélite pudiera mirar.

Eso expone algo que conviene tener presente: **mientras `wa-bridge` no exista, ningún
cobro real puede pasar de `QR_ACTIVO`.** No es solo que el cliente no reciba el aviso;
el flujo entero se detiene ahí (docs/04 §2).

## Nota sobre `firebase.demo.json`

El demo usa una configuración de emulador **sin** `firestore.rules`. El CLI de Firebase
vigila ese archivo con inotify, y en máquinas con `fs.inotify.max_user_instances`
agotado eso revienta con `ENOSPC`. El demo escribe con el Admin SDK, que pasa por encima
de las reglas de todos modos, así que no se pierde nada.

Para correr el emulador **con** las reglas (`firebase.json`), puede hacer falta:

```bash
sudo sysctl fs.inotify.max_user_instances=512
```
