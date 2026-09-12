# 03 — Prueba controlada en producción

**Decidida por el dueño el 2026-09-12.** Banco Económico no tiene forma de simular pagos
en certificación (respuesta A2: hay que mandarles la imagen del QR por correo y pagan
ellos, con hasta 48 h de demora). La validación del ciclo completo se hace entonces en
**producción**, con **plata propia** pagada desde cuentas internas, en montos mínimos y
con barreras que no dependen de acordarse de nada.

Esto **no es el pase a producción**: es una prueba acotada de un día. Los datos quedan
en la máquina del dueño.

## 1. Barreras (en el código, no en la disciplina)

| Barrera | Dónde |
|---|---|
| La API y el satélite **no arrancan** contra producción sin `MODO_PRUEBA_PRODUCCION=1` y sin el emulador de Firestore. | `packages/composicion/src/produccion.ts` |
| Cada QR de prueba es de **Bs 1** (configurable hasta un techo fijo de **Bs 10**). El monto lo fija el servidor, no la consola. | `packages/functions/src/modo-prueba.ts` |
| Como máximo **10 QRs** por prueba (techo fijo 30). Se cuentan los pedidos al banco, salgan o no, **vengan del botón de pruebas, del formulario común o de "renovar"**. Reiniciar la API no reinicia el cupo: retoma los cobros del emulador y cuenta los de las últimas 24 h. | `modo-prueba.ts`, `handlers.ts` |
| En modo prueba, **ningún** cobro puede superar el monto de prueba ni vivir más de **24 h**, tampoco los del formulario común. | `handlers.ts`, `crearCobro` |
| Los datos van al **emulador**, que los guarda en `~/.manejoqr/emulador-prueba` al cerrarse. | `npm run prueba:emulador` |
| Las **imágenes de QR** van a `~/.manejoqr/qrs/` (permisos 700/600), fuera del repo. | `packages/functions/src/imagenes.ts` |
| Las **credenciales** viven en `~/.manejoqr/baneco-prod.env` (permisos 600). Ni en el repo ni en `.env`; Claude Code no las lee. | §2 |
| **"Cerrar la prueba"** anula en el banco todo QR que quedó sin pagar —de **todos** los cobros del emulador de la prueba, aunque la API se haya reiniciado—, después de mirar si alguien lo pagó. | consola, pestaña Pruebas |
| La consola compara vencimientos con la **hora del servidor**, no la del navegador. | `Pruebas.tsx` |

## 2. Antes de empezar (dueño)

1. **Credenciales de producción completas.** Hacen falta cuatro datos, y el documento que
   mandó el banco trae tres (usuario, llave AES y URL): **falta la contraseña del usuario
   API**. Si no la tenés, se gestiona en una agencia del banco (respuesta B4).
2. **El número de la cuenta de cobro** (`accountCredit`): la cuenta a la que se acreditan
   los pagos.
3. **Dos cuentas para pagar:** una en Banco Económico y otra en **otro banco** (prueba 3).
4. Crear el archivo de credenciales, con permisos 600:

   ```bash
   mkdir -p ~/.manejoqr && chmod 700 ~/.manejoqr
   ```

   ```bash
   touch ~/.manejoqr/baneco-prod.env && chmod 600 ~/.manejoqr/baneco-prod.env
   ```

   Contenido (completar con un editor reemplazando cada `<…>`, **nunca** pegarlo en un
   chat):

   ```ini
   BANECO_PROD_BASE_URL=<URL de producción del documento del banco>
   BANECO_PROD_USERNAME=<usuario API>
   BANECO_PROD_PASSWORD=<contraseña del usuario API>
   BANECO_PROD_AES_KEY=<llave AES de 32 caracteres>
   BANECO_PROD_ACCOUNT_CREDIT=<número de la cuenta de cobro>
   API_TOKEN_LOCAL=<el mismo valor que VITE_API_TOKEN en packages/demo-web/.env.local>
   # Opcionales, con techo fijo en el código:
   # PRUEBA_MONTO_CENTAVOS=100
   # PRUEBA_MAX_QRS=10
   ```

   La URL va tal cual la escribe el documento del banco (`apiGateway`). Certificación usa
   `ApiGateway`: si la primera llamada da 404, probá con esa mayúscula (verificación V1).

## 3. Arranque: cuatro terminales

```bash
npm run prueba:emulador
```

```bash
npm run prueba:api
```

```bash
npm run prueba:satelite
```

```bash
npm run prueba:consola
```

La API tiene que mostrar `⚠ PRUEBA EN PRODUCCIÓN: QRs reales de Bs 1.00`. Después abrí
**http://localhost:5173** y entrá a la pestaña **Pruebas** (marcada `PROD`). Si la
pestaña no aparece, la API no está en modo prueba o el token de la consola no coincide.

`prueba:consola` sirve la consola compilada (sin recarga en vivo), así que no depende del
límite de inotify.

**Pestaña Logs** (para depurar): cada pedido a la API con su estado y demora, cada
llamada al banco con su ruta, estado HTTP, `responseCode` y demora, y los errores que vio
la consola. Se actualiza cada 3 s, se puede filtrar ("Llamadas al banco", "Solo avisos y
errores") y pausar. Nunca muestra cuerpos, credenciales, tokens ni query strings, y
enmascara teléfonos y números de cuenta. Los errores también salen por la terminal de la
API. Los logs del satélite están en su propia terminal.

## 4. Las nueve pruebas

La pestaña Pruebas tiene este mismo plan como checklist, y arma el informe.

| # | Prueba | Qué hacer | Qué se espera |
|---|---|---|---|
| P1 | Autenticación | Generá el primer QR. | Aparece el QR: el banco aceptó credenciales y cifrado. |
| P2 | Pago desde Baneco | Escaneá con la app de Banco Económico, pagá y tocá **Ya pagué**. | `CONFIRMADO` en menos de un minuto. |
| P3 | Pago desde otro banco | Otro QR, pagado desde la app de otro banco. | `CONFIRMADO`. Anotá el banco. |
| P4 | Pagar un QR anulado | Otro QR → **Anular en el banco** → intentá pagarlo. | La app rechaza el pago. |
| P5 | Pagar dos veces | Intentá pagar de nuevo el QR de P2. | La app rechaza el segundo pago. |
| P6 | Anular un QR pagado | En el cobro de P2, **Sondear anulación**. | El banco lo rechaza. Anotá el responseCode. |
| P7 | Anular dos veces | En el cobro de P4, **Sondear anulación**. | Éxito o un responseCode para anotar. |
| P8 | El vencimiento anula | QR de **5 min**, no lo pagues, esperá a que venza, intentá pagarlo. | `VENCIDO` con el QR anulado; la app rechaza el pago. |
| P9 | Cierre diario | Al día siguiente: `prueba:emulador` y `prueba:satelite`. | El log dice `yaRegistrados` con los pagos de hoy y `huerfanos=0`. |

P1–P8 se hacen el mismo día, en unos 30–45 minutos. Gasto total: unos Bs 3 (P2, P3 y lo
que se pague por error), más la comisión que corresponda (C9, a confirmar con el
ejecutivo).

**"Sondear anulación"** le pide al banco anular el QR **sin tocar el cobro**, para ver qué
responde (como hace B0). Solo está disponible sobre cobros pagados, anulados o vencidos:
sobre uno vivo dejaría al cliente sin poder pagar.

## 5. Qué anotar

Cada tarjeta muestra un **diagnóstico**. Todo lo que salga en rojo es un hallazgo. Lo
más valioso para el adaptador:

- **Los `responseCode`** que devuelva el banco en cualquier falla. El banco no tiene
  catálogo (E1): lo armamos nosotros.
- **Cuánto tardó** en confirmarse cada pago desde "Ya pagué". El banco dice que es en
  línea (D5).
- **Qué responde `cancelQR`** sobre un QR pagado (P6) y sobre uno ya anulado (P7). De eso
  depende la última carrera que cubre el #21.
- **Desde qué banco** pagaste en P3, y si el cobro llegó igual.

Al terminar, copiá el **Informe** del final de la pestaña y guardalo en
`docs/Integraciones/baneco/02-hallazgos-produccion.md`, o pasáselo a Claude Code para que
lo documente y corrija el adaptador según lo que aparezca. El informe no lleva datos de
quien pagó.

## 6. Cerrar la prueba

1. Botón **Cerrar la prueba**: anula en el banco los QRs que no se pagaron. El resultado
   aparece debajo del botón.
2. `Ctrl+C` en las cuatro terminales. El emulador guarda sus datos al salir, así P9 los
   encuentra mañana.
3. Mañana, después de P9: borrar `~/.manejoqr/emulador-prueba` y `~/.manejoqr/qrs` si ya
   no hacen falta. Las credenciales pueden quedar donde están, con permisos 600.

## 7. Si algo falla

| Síntoma | Qué es | Qué hacer |
|---|---|---|
| La API no arranca y dice que producción solo se admite en la prueba controlada | Falta el modo prueba o el emulador. | Usá los scripts `prueba:*`, no `api`. |
| `FALTA_VARIABLE BANECO_PROD_…` | Falta un dato en el archivo de credenciales. | Completalo (§2). |
| Diagnóstico: **credenciales rechazadas** | El banco rechazó el login. | **No reintentes en bucle**: el usuario API se bloquea y se desbloquea solo en agencia (B4). Revisá los datos y probá una vez. |
| Diagnóstico: **no se llega al banco** | Red, URL o mayúsculas de la URL. | Revisá conexión; probá `ApiGateway` (§2). |
| Pagaste y no se confirma | El banco no lo refleja o el satélite no corre. | Esperá 1 min con "Ya pagué"; mirá la terminal del satélite; anotá la hora. |
| El QR vencido sigue activo | El satélite no está corriendo. | `npm run prueba:satelite`. |
| La pestaña Pruebas no aparece | La API no está en modo prueba, o el token no coincide. | Revisá la terminal de la API y `API_TOKEN_LOCAL` = `VITE_API_TOKEN`. |

## 8. Lo que esta prueba no cubre

- **WhatsApp:** el QR se escanea desde la pantalla. El envío al cliente espera
  `wa-bridge` (docs/04 §2.3).
- **Firebase real:** todo queda en el emulador local.
- **El webhook del banco:** se opera sin webhook (decisión D3).
