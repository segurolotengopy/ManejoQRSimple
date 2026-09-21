# Hito B0 — validación del contrato de Baneco contra certificación

Herramienta **manual del dueño**. No corre en CI, no se usa en producción y no forma
parte del sistema: existe para contrastar contra el ambiente real del banco los
supuestos con los que se construyó `@mqs/baneco-gateway`.

```bash
npm run baneco:b0
```

Requiere `.env` con el bloque `BANECO_CERT_*` cargado (`BANECO_ENV=cert`).

> **Alcance real (2026-09-20):** el banco no tiene cuenta de abono de pruebas (A4), así
> que en certificación B0 solo verifica el login y el cifrado. Generar y pagar QRs se
> verifica en la prueba controlada en producción
> (`docs/Integraciones/baneco/03-prueba-en-produccion.md`).

## Qué produce

| Salida | Qué es |
|---|---|
| `docs/Integraciones/baneco/02-hallazgos-certificacion.md` | El informe: un veredicto por cada supuesto, atado a la pregunta de `01-preguntas-al-banco.md` que responde. |
| `packages/baneco-gateway/fixtures/*.json` | Respuestas reales **saneadas**, para reemplazar a las fixtures derivadas de la especificación. |
| `tools/baneco-b0/out/` | La imagen del QR de prueba. Git-ignored: no es evidencia versionable. |

## Qué sondea

| Paso | Pregunta | Qué contesta |
|---|---|---|
| Autenticación | A3, B2, B1 | Si las credenciales de certificación sirven, si el esquema AES es el correcto y cuál es la vigencia real del JWT. |
| `generateQR` + `statusQR` | V4 | La forma real de la respuesta y con qué mayúsculas viene el campo de estado. |
| `cancelQR` ×2 | C4, C5 | Qué estado informa un QR anulado y si la doble anulación es idempotente. |
| `transactionId` repetido | C3 | Si la unicidad la valida el banco o queda de nuestro lado. |
| Escalera de vigencias | C1 | Hasta qué `dueDate` acepta el banco (7, 30, 90, 365 días). |
| `paidQR` | D7 | La forma del reporte diario. |
| Todos | E1 | Catálogo empírico de `responseCode`, que la espec. v1.3.0 no documenta. |

## Pago asistido (respuesta A2)

Certificación no simula pagos: el banco paga un QR de prueba si se le manda la imagen
por correo al oficial de cuenta, con una demora de hasta 48 h (E2). Por eso el camino
de pago se captura en dos corridas:

```bash
npm run baneco:b0 -- --pago-asistido
```

Emite **un** QR de 1 BOB, válido 4 días, que **no se anula**. Guarda la imagen y un
archivo de estado (`pago-asistido.json`, solo ids) en `tools/baneco-b0/out/`, con
permisos 600. Mandá la imagen al oficial y pedile que la pague.

```bash
npm run baneco:b0 -- --capturar-pago
```

Cuando el banco confirme el pago:

- Guarda como fixtures saneadas `statusQR-pagado.json` y `paidQR-con-pago.json`.
- Sondea qué responde `cancelQR` sobre un QR **ya pagado** y si el estado cambia.
- Escribe `docs/Integraciones/baneco/02-hallazgos-pago-asistido.md`:
  - **A2:** el pago se capturó.
  - **V4:** el monto es el del QR.
  - **D7:** el pago figura en el `paidQR` de su día.
  - **C5:** el banco no anula un QR pagado.

Si el QR todavía no se pagó, no toca nada y termina con código 3.

```bash
npm run baneco:b0 -- --anular-pendiente
```

Desiste: anula el QR si nunca se pagó. Si ya está pagado se niega, y hay que
capturarlo.

Solo puede haber **un** QR de pago asistido por vez: emitir otro con uno pendiente se
rechaza.

## Reglas duras

- **Solo certificación.** Dos barreras independientes: `leerConfig` rechaza una URL de
  producción en ambiente `cert`, y `main.ts` rechaza `BANECO_ENV=prod` aunque la URL
  fuera otra.
- **No reintenta.** El usuario API del banco puede bloquearse por intentos fallidos
  (pregunta B4). Si la autenticación falla, escribe el informe y termina.
- **Todo QR que crea, lo anula.** Los sondeos dejan objetos reales en el ambiente del
  banco. La única excepción es el QR del pago asistido, que existe para que el banco lo
  pague: es uno solo por vez, y `--anular-pendiente` lo limpia si nunca se paga.
- **Solo el host de certificación.** Una tercera barrera exige que la URL base sea
  exactamente `apimktdesa.baneco.com.bo`. Por lista blanca, así una IP o un alias de
  producción no pasan.
- **Nada se escribe sin sanear.** Las respuestas crudas traen nombre, documento y
  cuenta del pagador. `sanear.ts` las procesa en tres capas:
  1. **Dentro de cada pago** deja solo los campos permitidos (`qrId`, `transactionId`,
     fecha, hora, moneda, monto, banco de origen y sucursal). Todo lo demás se
     reemplaza, incluida la glosa.
  2. **Fuera de los pagos** reemplaza toda clave que suene a persona o cuenta, sin
     importar las mayúsculas.
  3. **Una verificación final** rechaza escribir si el resultado contiene un secreto
     de configuración **o cualquier valor del pagador** que haya pasado por las
     respuestas de la corrida.

  Si algo se omite, la herramienta termina con código 4 y no informa éxito. El
  informe del pago asistido no incluye el `message` del banco, que puede nombrar al
  pagador, y `paidQR-con-pago.json` guarda solo el pago de nuestro QR, porque el
  usuario de certificación es compartido (A3).
- **El QR del pago asistido nunca queda sin control.**
  - Antes de emitir se toma una reserva atómica del archivo de estado, así que dos
    corridas simultáneas no pueden emitir dos QRs.
  - Si el banco no responde, la reserva queda con el `transactionId`, porque pudo
    haber creado el QR igual, y bloquea todo hasta verificarlo con el oficial. Solo
    un rechazo explícito del banco la libera; un 4xx del gateway no. La corrida
    siguiente muestra el `transactionId` y qué consultar.
  - Si `paidQR` trae los pagos con una forma inesperada (otra clave, anidados), el
    filtro falla cerrado: la fixture no se escribe.
  - Si el banco devuelve un `qrId` que no se puede guardar con seguridad, o el
    estado no se puede escribir, el QR se anula en la misma corrida.
- **Solo https.** La barrera de host exige además `https:`: por http el JWT viajaría
  en claro.

## Dos desviaciones respecto de `PROMPTS_CLAUDE_CODE.md`

**1. Reusa `@mqs/baneco-gateway` en vez de ser un script autónomo.** El prompt original
pedía un script independiente con solo `node:crypto` y `fetch`, porque cuando se
escribió no existía el monorepo. Ahora sí, y reusar el adaptador hace que B0 valide
**el código que realmente va a producción** en lugar de una implementación paralela
que podría coincidir consigo misma y estar mal igual.

No se pierde independencia: el oráculo es el banco, no nuestro código.

**2. No usa el endpoint utilitario `/api/authentication/encrypt`.** Su contrato —ruta
exacta, parámetros, forma de la respuesta— no está en ninguna fuente documentada de
este repositorio; aparece solo en el prompt. La regla del proyecto es no inventar
endpoints.

No hace falta: **que el login funcione es la validación del esquema AES.** El banco
descifra con su llave el password que ciframos nosotros; si lo acepta, el esquema
—AES-256-CBC, PKCS7, IV de 16 bytes antepuesto, Base64— es el correcto. Es una
prueba end-to-end contra la única autoridad que importa.

Si el contrato del endpoint utilitario aparece en el PDF oficial, agregarlo es un paso
más — pero sería confirmación redundante, no la prueba principal.
