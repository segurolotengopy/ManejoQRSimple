# Integración Banco Económico (Baneco) — Cobros QR Simple

Carpeta de la documentación del proveedor **Banco Económico S.A.** y de los documentos
propios del proyecto sobre esta integración.

## Contenido versionado (sí va a GitHub)

| Archivo | Qué es |
|---|---|
| `00-analisis-modulo-baneco.md` | Análisis de integración: cobertura de requisitos, encaje en puertos, diseño del adaptador `@mqs/baneco-gateway`, riesgos y plan por hitos. Incluye la resolución de las decisiones D1–D6 del dueño. |
| `01-preguntas-al-banco.md` | Batería de preguntas al banco previa al desarrollo, por tema y prioridad. **Enviada por correo el 2026-08-27; a la espera de respuesta.** Las respuestas se registran ahí mismo. |
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
`npm run baneco:b0` y **espera credenciales de certificación** (pregunta A3).

## Verificaciones pendientes contra el PDF oficial

El adaptador (`packages/baneco-gateway`) se codificó desde el manual derivado saneado,
que es fuente de nivel 4. Estos puntos hay que contrastarlos con el PDF —y confirmarlos
empíricamente en el Hito B0— antes de considerarlos cerrados:

| # | Punto | Por qué importa |
|---|---|---|
| V1 | **Versionado asimétrico de rutas.** El manual documenta `/api/qrsimple/generateQR` y `/api/qrsimple/cancelQR` sin `v2`, pero `/api/qrsimple/v2/statusQR/{id}` y `/api/qrsimple/v2/paidQR/{fecha}` con `v2`. | Una ruta equivocada es un 404 en la primera llamada real. Está codificado tal cual lo documenta el manual. |
| V2 | **Esquema de cifrado AES** (§2 del manual): AES-256-CBC, PKCS7, IV de 16 bytes antepuesto, Base64. | Es un supuesto declarado (pregunta B2). Lo confirma el endpoint utilitario de certificación en B0, no nosotros. |
| V3 | **Zona horaria de `paymentDate`/`paymentTime`.** Se interpretan en hora boliviana (UTC-4). | Pregunta D7. Un offset equivocado desplaza los pagos de día y rompe la conciliación diaria. Está aislado en una constante de `mapeo.ts`. |
| V4 | **Nombre del campo de estado**: `statusQrCode` vs `statusQRCode`. | La espec. no es consistente. El adaptador acepta ambos: equivocarse significaría no detectar un pago. |
| V5 | **Catálogo de `responseCode`.** No documentado en la v1.3.0. | Pregunta E1. Todo código distinto de 0 se trata como error opaco y se registra para construir el catálogo empírico. |
