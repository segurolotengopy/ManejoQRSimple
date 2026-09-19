# 03 — Prueba controlada en producción

**Decidida por el dueño el 2026-09-12.** Banco Económico no tiene forma de simular pagos
en certificación (respuesta A2: hay que mandarles la imagen del QR por correo y pagan
ellos, con hasta 48 h de demora). La validación del ciclo completo se hace entonces en
**producción**, con **plata propia** pagada desde cuentas internas, en montos mínimos y
con barreras que no dependen de acordarse de nada.

Esto **no es el pase a producción**: es una prueba acotada de un día. Los datos quedan
en la máquina del dueño.

**Es un procedimiento que se repite, no una prueba única** (decisión del dueño,
2026-09-14). Se vuelve a correr completo, P1–P9, cada vez que:

- se abre una **cuenta de cobro nueva** en el banco (otra `accountCredit`), o
- se registra **otro banco** como proveedor de QR.

Primera corrida: 2026-09-13/14 con Banco Económico. Pagos desde Baneco y desde el BNB,
P1–P9 ok; hallazgos en `02-hallazgos-produccion.md`.

## 1. Barreras (en el código, no en la disciplina)

| Barrera | Dónde |
|---|---|
| La API y el satélite **no arrancan** contra producción sin `MODO_PRUEBA_PRODUCCION=1` y sin el emulador de Firestore. | `packages/composicion/src/produccion.ts` |
| Cada QR de prueba es de **Bs 1** (configurable hasta un techo fijo de **Bs 10**). El monto lo fija el servidor, no la consola. | `packages/functions/src/modo-prueba.ts` |
| Como máximo **10 QRs** por prueba (techo fijo 30). Se cuentan los pedidos al banco, salgan o no, **vengan del botón de pruebas, del formulario común o de "renovar"**. Reiniciar la API no reinicia el cupo: retoma los cobros del emulador y cuenta los de las últimas 24 h. | `modo-prueba.ts`, `handlers.ts` |
| En modo prueba, **ningún** cobro puede superar el monto de prueba ni vivir más de **24 h**, tampoco los del formulario común. | `handlers.ts`, `crearCobro` |
| Los datos van al **emulador**, que los guarda en `~/.manejoqr/emulador-<cuenta>` al cerrarse. | `npm run prueba:emulador` |
| Las **imágenes de QR** van a `~/.manejoqr/qrs/<cuenta>/` (permisos 700/600), fuera del repo. | `packages/functions/src/imagenes.ts` |
| Las **credenciales** viven en `~/.manejoqr/baneco-<cuenta>.env` (permisos 600). Ni en el repo ni en `.env`; Claude Code no las lee. | §2 |
| **Una cuenta no corre sobre los datos de otra:** el emulador queda marcado con el alias de la cuenta, y un proceso con otro alias no arranca. | `packages/firestore-store/src/cuenta-de-prueba.ts` |
| **"Cerrar la prueba"** anula en el banco todo QR que quedó sin pagar —de **todos** los cobros del emulador de la prueba, aunque la API se haya reiniciado—, después de mirar si alguien lo pagó. | consola, pestaña Pruebas |
| La consola compara vencimientos con la **hora del servidor**, no la del navegador. | `Pruebas.tsx` |

## 2. Antes de empezar (dueño)

1. **Credenciales de producción completas.** Hacen falta cuatro datos, y el documento que
   mandó el banco trae tres (usuario, llave AES y URL): **falta la contraseña del usuario
   API**. Ningún documento del banco explica cómo se obtiene. Hay que pedírsela al oficial
   de cuenta y, si hace falta, gestionarla en una agencia (B4). El procedimiento y el
   borrador del correo están en `01-preguntas-al-banco.md`, sección H (pedido H1). **No
   pruebes contraseñas:** el usuario API se bloquea con intentos fallidos.
2. **El número de la cuenta de cobro** (`accountCredit`): la cuenta a la que se acreditan
   los pagos.
3. **Dos cuentas para pagar:** una en Banco Económico y otra en **otro banco** (prueba 3).
4. **El archivo de credenciales de esa cuenta.** Cada cuenta de cobro tiene el suyo, con
   su propio alias:

   | Cuenta | Alias | Archivo | Cómo se arranca |
   |---|---|---|---|
   | La primera | `prod` | `~/.manejoqr/baneco-prod.env` | `npm run prueba:api` |
   | Cualquier otra | el que elija el dueño (`sucursal-2`) | `~/.manejoqr/baneco-sucursal-2.env` | `CUENTA=sucursal-2 npm run prueba:api` |

   El alias empieza con letra y sigue con minúsculas, números y guiones. Es un **rótulo**
   —se muestra en la consola, se guarda en el emulador y encabeza el informe que se
   archiva en el repo—, y por eso **no puede ser el número de cuenta**: que arranque con
   letra lo vuelve imposible, no solo desaconsejado.

   El archivo lo crea Claude Code, con la plantilla y los permisos 600:

   ```bash
   npm run prueba:cuenta -- sucursal-2
   ```

   Lo único que hace el dueño es **abrirlo con su editor y reemplazar cada `<…>`** por su
   valor. Nada de eso se pega en un chat ni entra al repositorio. Para saber si quedó algo
   sin completar —dice qué variable falta, nunca su valor—:

   ```bash
   npm run prueba:cuenta -- sucursal-2 --revisar
   ```

   Las variables son cuatro del banco —`BANECO_PROD_USERNAME`, `BANECO_PROD_PASSWORD`,
   `BANECO_PROD_AES_KEY` y `BANECO_PROD_ACCOUNT_CREDIT`— más `API_TOKEN_LOCAL` (el mismo
   valor que `VITE_API_TOKEN` en `packages/demo-web/.env.local`).

   **La URL del API Gateway no va en el archivo** (dato del dueño, 2026-09-18): es del
   banco y la misma para toda cuenta de cobro, así que vive en el código
   (`baneco-gateway/src/config.ts`, `URL_PRODUCCION`). Si algún día el banco la mueve,
   `BANECO_PROD_BASE_URL` sigue mandando sobre ella. En **certificación** sí hay que
   declarar `BANECO_CERT_BASE_URL`: esa URL cambió de mayúsculas entre documentos
   (`ApiGateway`, verificación V1) y no se adivina.

   Un marcador `<…>` sin reemplazar cuenta como variable faltante y el proceso no
   arranca: probar el login con el texto de la plantilla sería un intento fallido, y el
   usuario API se bloquea con intentos fallidos (B4).

   `npm run prueba:cuenta -- --listar` dice qué cuentas hay preparadas (los alias, no su
   contenido).

## 3. Arranque: cuatro terminales

Con la primera cuenta, tal cual. Con cualquier otra, **las tres primeras llevan el mismo
`CUENTA=<alias>`**: `CUENTA=sucursal-2 npm run prueba:emulador`, y lo mismo en la API y en
el satélite. Si una terminal arranca con otro alias, el proceso se niega: el emulador está
marcado con la cuenta de la que son sus datos.

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

La API tiene que mostrar `⚠ PRUEBA EN PRODUCCIÓN de la cuenta «prod»: QRs reales de
Bs 1.00`, con el alias de la cuenta que corresponde. Después abrí
**http://localhost:5173** y entrá a la pestaña **Pruebas** (marcada `PROD`). Si la
pestaña no aparece, la API no está en modo prueba o el token de la consola no coincide.

La pestaña muestra el alias de la cuenta al lado del aviso de plata real: con dos cuentas
del mismo banco la pantalla es idéntica, y ese chip es lo único que distingue en cuál se
está cobrando. El informe del final también lo lleva en el título.

`prueba:consola` sirve la consola compilada (sin recarga en vivo), así que no depende del
límite de inotify.

**Pestaña Logs** (para depurar): cada pedido a la API con su estado y demora, cada
llamada al banco con su ruta, estado HTTP, `responseCode` y demora, y los errores que vio
la consola, **y las del satélite**: su arranque, los cierres diarios, los errores y sus
llamadas al banco. Se actualiza cada 3 s, se puede filtrar ("Llamadas al banco",
"Satélite", "Solo avisos y errores") y pausar. Nunca muestra cuerpos, credenciales, tokens
ni query strings, y enmascara teléfonos y números de cuenta.

**Los logs se guardan en disco** en `~/.manejoqr/logs/`, un archivo por proceso y por día
de Bolivia (`api-AAAA-MM-DD.jsonl`, `satelite-AAAA-MM-DD.jsonl`), con permisos 700/600 y el
mismo saneamiento. Sobreviven a un reinicio: al volver a levantar la API, la pestaña Logs
muestra lo de días anteriores. Un `responseCode` o la línea del cierre diario no hay que
capturarlos en el momento.

La bitácora es **una sola para todas las cuentas**, a propósito: así no se pierde nada al
cambiar de cuenta. Cada corrida queda separada por su línea de arranque —`API iniciada ·
… · cuenta sucursal-2`, `Satélite iniciado · … · cuenta sucursal-2`—, que es la que dice
de qué cuenta es lo que sigue.

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
| P7 | Anular dos veces | En el cobro de P4, **Sondear anulación**. | **Éxito** en la tarjeta: el adaptador trata la doble anulación como hecha. Anotá el `responseCode` crudo del banco desde la pestaña Logs (Baneco: 403). |
| P8 | El vencimiento anula | QR de **5 min**, no lo pagues, esperá a que venza, intentá pagarlo. | `VENCIDO` con el QR anulado; la app rechaza el pago. |
| P9 | Cierre diario | Al día siguiente: `prueba:emulador` y `prueba:satelite`. | El log dice `yaRegistrados` con los pagos de hoy y `huerfanos=0`. |

P1–P8 se hacen el mismo día, en unos 30–45 minutos. Gasto total: unos Bs 3 (P2, P3 y lo
que se pague por error), más la comisión que corresponda (C9, a confirmar con el
ejecutivo).

**Lo que muestra la tarjeta es lo que decide el adaptador, no la respuesta cruda del
banco.** Desde el hallazgo de P7, el adaptador trata la doble anulación como éxito si el QR
ya figura anulado (`02-hallazgos-produccion.md` §3.1). El `responseCode` que devolvió el
banco queda siempre en la pestaña **Logs**, en la línea `DELETE …/cancelQR`; es el dato
para el catálogo.

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
3. **Recién cuando el informe esté documentado** (P1–P9 con sus `responseCode` y la
   corrección del adaptador hecha), borrar `~/.manejoqr/emulador-<cuenta>` y
   `~/.manejoqr/qrs/<cuenta>`. Sin el emulador no hay cobros sobre los que repetir un
   sondeo. Los logs de `~/.manejoqr/logs/` conviene conservarlos: son el registro de la
   prueba. Las credenciales pueden quedar donde están, con permisos 600: la cuenta sigue
   siendo la misma cuando haya que volver a probar.

   Los datos de una cuenta no estorban a otra: cada una tiene su carpeta. `emulador-prueba`
   es el nombre viejo, de cuando había una sola cuenta (corrida del 2026-09-13); si todavía
   está, se puede borrar.

## 7. Si algo falla

| Síntoma | Qué es | Qué hacer |
|---|---|---|
| La API no arranca y dice que producción solo se admite en la prueba controlada | Falta el modo prueba o el emulador. | Usá los scripts `prueba:*`, no `api`. |
| `FALTA_VARIABLE BANECO_PROD_…` | Falta un dato en el archivo de credenciales. | `npm run prueba:cuenta -- <alias> --revisar` dice cuáles faltan (§2). |
| `Los datos de este emulador son de la cuenta «X»…` | Una terminal arrancó con otro `CUENTA` que el resto. | Arrancá las cuatro con el mismo alias, o levantá el emulador de la otra cuenta. |
| `«…» no sirve como alias de cuenta` al levantar el emulador | `CUENTA` mal escrita (mayúsculas, empieza con número). | Corregila. El emulador imprime al arrancar la carpeta que usa: tiene que ser la misma todos los días. |
| `ENOENT … baneco-<alias>.env` | No existe el archivo de credenciales de ese alias. | `npm run prueba:cuenta -- <alias>` lo crea; `-- --listar` dice cuáles hay. |
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
