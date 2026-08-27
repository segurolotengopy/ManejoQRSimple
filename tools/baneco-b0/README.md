# Hito B0 — validación del contrato de Baneco contra certificación

Herramienta **manual del dueño**. No corre en CI, no se usa en producción y no forma
parte del sistema: existe para contrastar contra el ambiente real del banco los
supuestos con los que se construyó `@mqs/baneco-gateway`.

```bash
npm run baneco:b0
```

Requiere `.env` con el bloque `BANECO_CERT_*` cargado (`BANECO_ENV=cert`).

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

## Reglas duras

- **Solo certificación.** Dos barreras independientes: `leerConfig` rechaza una URL de
  producción en ambiente `cert`, y `main.ts` rechaza `BANECO_ENV=prod` aunque la URL
  fuera otra.
- **No reintenta.** El usuario API del banco puede bloquearse por intentos fallidos
  (pregunta B4). Si la autenticación falla, escribe el informe y termina.
- **Todo QR que crea, lo anula.** Los sondeos dejan objetos reales en el ambiente del
  banco.
- **Nada se escribe sin sanear.** Las respuestas crudas traen nombre, documento y
  cuenta del pagador. `sanear.ts` los reemplaza por marcadores y una segunda capa
  verifica que el resultado no contenga ningún secreto de configuración; si lo
  contiene, **no escribe el archivo**. Es la única parte de esta herramienta con
  tests, porque es la única que puede filtrar datos al repositorio.

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
