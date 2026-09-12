# Integración Banco Económico (Baneco) — Cobros QR Simple

Carpeta de la documentación del proveedor **Banco Económico S.A.** y de los documentos
propios del proyecto sobre esta integración.

## Contenido versionado (sí va a GitHub)

| Archivo | Qué es |
|---|---|
| `00-analisis-modulo-baneco.md` | Análisis de integración: cobertura de requisitos, encaje en puertos, diseño del adaptador `@mqs/baneco-gateway`, riesgos y plan por hitos. Incluye la resolución de las decisiones D1–D6 del dueño. |
| `01-preguntas-al-banco.md` | Batería de preguntas al banco, por tema y prioridad. Enviada el 2026-08-27, **respondida el 2026-09-11** (queda abierta D1). Registra cada respuesta, qué cambia en el diseño y los hallazgos derivados. Fuente de nivel 1. |
| `manual-tecnico-derivado-SANEADO.md` | Copia saneada (sin credenciales) del manual derivado no oficial. Solo referencia; **gobierna el PDF oficial**. |

## Contenido NO versionado — `privado-no-gh/` (git-ignored)

Decisión del dueño (D4, 2026-08-27): los adjuntos recibidos del banco **no se suben a
GitHub** y permanecen únicamente en la ThinkPad, en `privado-no-gh/`:

- `Api-Market-Baneco-v1.3.0.pdf` — **especificación oficial que gobierna el adaptador.**
- `Baneco-ambiente-de-produccion-para-integracion.docx` — **contiene credenciales de
  producción en claro** (usuario, llave AES, URL). Los valores operativos viven en el
  gestor de secretos del dueño y en `.env` local (nunca en el repo).
- `Cobros-QR-Baneco.pptx` — presentación introductoria del banco.
- `manual-tecnico-derivado-ORIGINAL.md` — versión original del manual derivado
  (contiene las mismas credenciales de producción).

La carpeta completa está excluida en `.gitignore`
(`docs/Integraciones/baneco/privado-no-gh/`). Si se agrega cualquier documento nuevo
del banco, entra por esta carpeta primero y solo se versiona una copia saneada.

## Jerarquía de fuentes (ante discrepancia)

1. Respuesta escrita del banco a `01-preguntas-al-banco.md` (más reciente gana).
2. PDF oficial "Api Market v1.3.0".
3. DOCX de datos de producción (solo para datos de entorno).
4. Manual derivado saneado (referencia; verificar antes de codificar).

Regla de esta carpeta (heredada de `docs/Integraciones/README.md`): **no inventar
parámetros ni endpoints distintos a los documentados.**

## Cómo se resuelven estas verificaciones

`tools/baneco-b0/` sondea el ambiente de certificación y produce
`02-hallazgos-certificacion.md` con un veredicto por cada punto de la tabla de abajo y
por cada pregunta que se pueda contestar empíricamente. Se corre con
`npm run baneco:b0`. Las credenciales de certificación del PDF son **de uso compartido**
(respuesta A3) y sirven; falta la **cuenta de abono de pruebas** que el banco envía con
un usuario de pruebas (A4). Sin ella B0 autentica pero no puede generar QRs.

El camino de pago no se puede simular (A2): para capturar un `statusQR` pagado real hay
que mandarle al banco la imagen de un QR vigente por correo y que lo paguen ellos.

## Verificaciones contra el PDF oficial y el ambiente de certificación

El adaptador (`packages/baneco-gateway`) se codificó desde el manual derivado saneado,
que es fuente de nivel 4. Estado de cada punto tras la respuesta del banco:

| # | Punto | Estado |
|---|---|---|
| V1 | **Versionado asimétrico de rutas.** El manual documenta `/api/qrsimple/generateQR` y `/api/qrsimple/cancelQR` sin `v2`, pero `/api/qrsimple/v2/statusQR/{id}` y `/api/qrsimple/v2/paidQR/{fecha}` con `v2`. | ⏳ **Abierto.** El banco no lo trató. Una ruta equivocada es un 404 en la primera llamada real de B0. |
| V2 | **Esquema de cifrado AES**: AES-256-CBC, PKCS7, IV de 16 bytes antepuesto, Base64. | ✅ **Confirmado** (2026-09-12) con el vector oficial del PDF §5.1: `crypto/aes.ts` lo descifra al texto esperado. Falta solo la confirmación end-to-end del login en B0. |
| V3 | **Zona horaria de `paymentDate`/`paymentTime`.** Se interpretan en hora boliviana (UTC-4). | ✅ **Confirmado por escrito** (D7): fecha y hora del pago en hora de Bolivia. |
| V4 | **Nombre del campo de estado**: `statusQrCode` vs `statusQRCode`. | ⏳ **Abierto.** El adaptador acepta ambos. B0 lo resuelve con el primer `statusQR`. |
| V5 | **Catálogo de `responseCode`.** No documentado en la v1.3.0. | ✅ **Cerrado** (E1): no existe catálogo oficial; el `message` trae la descripción. El error opaco pasa a ser el diseño definitivo. |

## Discrepancias entre la respuesta del banco y el PDF

Por la jerarquía de arriba, gana la respuesta escrita:

| Tema | PDF v1.3.0 | Respuesta del banco |
|---|---|---|
| Consulta de movimientos | `POST /api/accounts/history` (§8.1) | El endpoint es `accounts/queryMovements` (F2). |
| Pago a proveedores | `POST /api/batchPayment/upload`, tipo `PROVIDERS` (§9.1) | "No se tiene este servicio, no está desarrollado" (G1). |
| Endpoint de cifrado | `GET /api/authentication/encrypt` (§5.1) | Nombra `/api/authenticate/cypher` (B2). No se usa en operación de todos modos. |
