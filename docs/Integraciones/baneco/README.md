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
