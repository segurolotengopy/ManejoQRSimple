# ESTADO — bitácora de avance para retomar sin perder contexto

> **Regla de uso:** este archivo se actualiza al final de cada sesión de
> trabajo y antes de cualquier pausa. Al retomar, leer esto primero.
> Nunca contiene secretos — solo estado, decisiones y próximos pasos.

**Última actualización:** 2026-08-27 (sesión Baneco 3 — preguntas enviadas al banco por
correo, a la espera de respuesta; riel Baneco pasa a ser la línea principal y Yape queda
diferido)

---

## Decisiones transversales vigentes (del dueño del proyecto)

1. **Caso de uso:** cobros por QR Simple en Bolivia, análogo a SeguroLoTengo
   (Paraguay) pero para el mercado boliviano. **Demo**, no producción, hasta
   contar con las API oficiales.
2. **Proveedor de cobro — orden vigente (actualizado 2026-08-27):** la línea
   principal es **Banco Económico (Baneco), API Cobros QR Simple v1.3.0** —
   integración por API oficial. **Yape de BCP Bolivia queda diferido** (riel
   secundario, decisión D1): su consola web autenticada seguiría siendo fuente de
   verdad vía scraping, y el mapeo de selectores (docs/03 §6) sigue esperando las
   capturas del dueño en `docs/consola-yape/`. Nada del trabajo Yape se descarta:
   se retoma cuando haya documentación completa, y el diseño multi-proveedor
   (campo `provider` por cobro) mantiene la puerta abierta.
3. **Stack:** monorepo npm workspaces, Node 22 LTS + TypeScript estricto
   (estilo WhatsApp-Modular). Paquetes: `qr-core`, `yape-scraper`, `wa-bridge`,
   `functions`, `demo-web` (React + Vite).
4. **Ejecución del scraper: híbrido evolutivo (ADR-003).** Fase 0–1 en la
   ThinkPad del dueño; promoción a OCI cuando se necesite 24/7. En OCI, el cupo
   Ampere A1 gratuito ya está consumido por la VM Odoo-Server-ProyectoA (que
   co-hostea el laboratorio Evolution de WhatsApp-Modular): las opciones son
   co-hosteo en contenedor aislado (B) o VM E2.1.Micro del Always Free, cupo
   separado, a verificar (C).
5. **Firebase:** proyecto **ManejoQRSimple**, cuenta alberdi.andres@gmail.com.
   Verificar project-id exacto con `firebase projects:list` y registrarlo en
   docs/05 §1. Mantener sin billing mientras se pueda (criterio heredado).
6. **Repo:** `git@github.com:segurolotengopy/ManejoQRSimple.git` — clonado con:

   ```bash
   git clone git@github.com:segurolotengopy/ManejoQRSimple.git
   ```

   (decisión del
   2026-08-14: se movió de la cuenta personal AndresAlberdi a la org
   segurolotengopy, que es de pago y trae herramientas adicionales). En esta
   máquina el remoto `origin` usa el alias SSH `github-segurolotengo`, igual
   que segurolotengo-demo. Procedimiento de seguridad heredado de
   segurolotengo-demo / WhatsApp-Modular: CI bloqueante + gitleaks (binario,
   historial completo) + dependabot + branch protection; re-evaluar qué
   controles nativos (secret scanning, etc.) habilita el plan de la org.
7. **Integración WhatsApp:** por **WhatsAppModular** (envío de QR + datos del
   cobro; recepción del comprobante). Verificar su API pública real antes de
   implementar `wa-bridge` (ese proyecto está en Fase 0 del riel Meta, con
   laboratorio Evolution operativo bajo reglas de contención — nunca clientes
   reales por esa vía).
8. **Regla de oro del dominio:** el comprobante del cliente jamás confirma un
   pago; confirma la consola de la billetera (ADR-005).
9. **Baneco — decisiones D1–D6 del dueño (2026-08-27,** sobre
   `docs/Integraciones/baneco/00-analisis-modulo-baneco.md` §7**):**
   - **D1:** el proyecto **se concibe multi-proveedor** (el modelo de datos lleva
     `provider` por cobro desde el inicio), pero el desarrollo continúa **solo con
     Baneco**; Yape u otros integradores se retoman cuando haya documentación
     completa de ellos.
   - **D2:** el cliente Baneco corre como **proceso satélite (opción b)** — patrón
     del scraper, ThinkPad→OCI, escribiendo a Firestore vía repositorio con
     credencial mínima. Se escala a Functions+Blaze (opción a) solo si es necesario.
   - **D3:** primera etapa **sin webhook**: detección por polling de `statusQR` +
     conciliación diaria `paidQR` (la espec. marca el webhook como opcional).
   - **D4:** los adjuntos del banco **no se suben a GitHub**; permanecen en la
     ThinkPad en `docs/Integraciones/baneco/privado-no-gh/` (git-ignored). No se
     solicita rotación de llave por ahora (superficie de riesgo acotada).
   - **D5:** **vigencia corta** de `dueDate` por cobro (72 h por defecto,
     configurable); la renovación programática la abarata.
   - **D6:** se enviará al banco la batería de preguntas
     `docs/Integraciones/baneco/01-preguntas-al-banco.md` (proceso de
     certificación incluido). **Ejecutada el 2026-08-27: correo enviado, a la
     espera de respuesta** (ver "En espera").
10. **Playwright MCP local:** el dueño decidió instalarlo en su app de escritorio
   (guía entregada en la sesión: ruta absoluta de npx por nvm,
   `--user-data-dir` persistente, chmod 700). Estado: **pendiente de
   verificación** (al reiniciar la app, pedir a Claude que confirme que las
   herramientas `playwright__*` aparecen).

## Estado actual

**Hito en curso:** Fase 0 — fundación (docs/07).

### Hecho

- [x] Análisis de convenciones de los proyectos hermanos (segurolotengo-demo,
      WhatsApp-Modular) y decisión de replicar sus estilos y procedimientos.
- [x] Documentación de arranque completa: CLAUDE.md, docs/00–08, este ESTADO.
- [x] Configuración de Claude Code: settings.json (allow/deny), 6 agentes,
      comandos, hook anti-secretos, .mcp.json.
- [x] Configuración de repo: .gitignore, .gitleaks.toml, CI, dependabot,
      PR template, .env.example, package.json y tsconfig.json raíz.
- [x] Decisiones de arquitectura ADR-001…005 documentadas (docs/01 §6).
- [x] Independencia del proyecto asentada en los docs: se quitaron las
      menciones de pertenencia al "ecosistema SeguroLoTengo" (quedan solo
      las referencias históricas de procedencia de las decisiones).
- [x] Repo publicado: rama `main` (renombrada desde `master`) pusheada a
      `segurolotengopy/ManejoQRSimple`; remoto `origin` por el alias SSH
      `github-segurolotengo`.
- [x] Branch protection activa: ruleset `main-protegida` (id 20972960),
      réplica del de SeguroLoTengoDemo — sin borrado ni force-push, todo
      cambio por PR (0 aprobaciones, merge/squash), checks requeridos
      "Lint · Types · Tests · Build" y "Secretos en el historial", bypass
      solo para administradores del repo.
- [x] Ajustes de configuración commiteados: patrones deny corregidos en
      `.claude/settings.json`, `.mcp.json` sin header manual (el MCP de
      GitHub usa OAuth propio) y `*.bak` en `.gitignore`.
- [x] **2026-08-27 — Análisis de integración con Banco Económico (Baneco).**
      El dueño obtuvo la especificación oficial "API Market v1.3.0" y
      credenciales de producción de la API de Cobros QR Simple de Baneco.
      Análisis completo en `docs/Integraciones/baneco/00-analisis-modulo-baneco.md`:
      la API cubre de forma nativa los QR de un solo uso con monto fijo
      (`generateQR` con `singleUse=true`, `modifyAmount=false`) y la validación
      del pago (webhook + `statusQR` + `paidQR`). Se propone adaptador
      `@mqs/baneco-gateway` detrás de `QrProvider`/`PaymentWatcher` (primera
      materialización real de ADR-002). Regla nueva propuesta BANECO-1: el
      webhook del banco jamás confirma — solo la consulta saliente autenticada.
      **Ojo:** los documentos recibidos contienen credenciales de producción en
      claro; NO commitearlos sin sanear (ver §8.1 del análisis).
- [x] **2026-08-27 — Ingesta segura y organización de la documentación Baneco.**
      `docs/Integraciones/baneco/` con lo versionable (`README.md`,
      `00-analisis-modulo-baneco.md`, `01-preguntas-al-banco.md`,
      `manual-tecnico-derivado-SANEADO.md`) y `privado-no-gh/` git-ignored para
      los adjuntos del banco con credenciales en claro (PDF oficial v1.3.0, DOCX
      de producción, PPTX y manual derivado original). Regla D4 aplicada: todo
      documento nuevo del banco entra primero por `privado-no-gh/` y solo se
      versiona una copia saneada. Jerarquía de fuentes registrada en el README de
      la carpeta (respuesta escrita del banco > PDF oficial > DOCX > manual
      derivado).
- [x] **2026-08-27 — Batería de preguntas enviada al banco (D6 ejecutada).**
      `01-preguntas-al-banco.md` (secciones A–F, 5 bloqueantes de certificación,
      autenticación/cifrado, ciclo de vida del QR, notificación de pagos, errores
      y conciliación) salió por correo al oficial de cuenta / equipo de
      integraciones API Market. C7 (interoperabilidad QR BCB) ya venía resuelta
      por el dueño y se omitió del envío. **A la espera de respuesta.**

### En espera (bloqueos externos, no bloquean el desarrollo)

| Qué | Desde | Bloquea | Mientras tanto |
|---|---|---|---|
| Respuesta de Banco Económico a `01-preguntas-al-banco.md` | 2026-08-27 | Cierre del diseño definitivo y cualquier pase a producción | Se trabaja contra **certificación** con los supuestos explícitos del §"Supuestos de trabajo" de ese documento (JWT corto con reintento único ante 401; AES-256-CBC/PKCS7/IV-prepended/Base64 a validar empíricamente en el Hito B0; operación sin webhook por polling `statusQR` + `paidQR`; `dueDate` 72 h; todo `responseCode != 0` como error opaco). Ningún supuesto pasa a producción sin respuesta escrita o verificación formal. |
| Credenciales/proceso de certificación (A1–A5) | 2026-08-27 | Arranque real del Hito B0 contra el ambiente del banco | Se puede escribir `tools/baneco-b0/` y sus fixtures; la corrida contra certificación espera credenciales propias. |
| Capturas de la consola Yape BCP | — | Riel Yape (diferido, D1) | Sin impacto en la línea principal Baneco. |

**Al llegar la respuesta del banco:** registrarla en la columna "Respuesta" de
`01-preguntas-al-banco.md` con fecha y quién respondió — ese documento pasa a ser
fuente de verdad de nivel 1 — y revisar qué supuestos de trabajo quedan
invalidados antes de seguir codificando.

### Próximo paso (retomar acá)

**Línea principal — riel Baneco.** Seguir `PROMPTS_CLAUDE_CODE.md` (riel Baneco,
2026-08-27), que es autosuficiente:

1. **Dueño:** cargar `BANECO_CERT_*` en `.env` local antes de la Sesión 2
   (valores en `privado-no-gh/`; nunca al repo).
2. **Claude Code, Sesión 1:** fundación del monorepo con 6 paquetes (incluye
   `@mqs/baneco-gateway`), ADR-006, impactos §8.2 y `.env.example` con bloque
   `BANECO_*` + selectores `QR_PROVIDER`/`PAYMENT_WATCHER`. El CI hoy está en
   rojo (no existe código que compilar) y el ruleset ya exige sus checks: el
   primer PR real es el de la fundación del monorepo, y a `main` no se pushea
   directo (salvo bypass de administrador).
3. **Claude Code, Sesión 2:** Hito B0 — `tools/baneco-b0/` contra certificación;
   hallazgos a `02-hallazgos-certificacion.md`. Depende de A1–A5 del banco.
4. **Sesiones 3–4:** dominio (cobros, máquina de estados, conciliación y puertos)
   con campo `provider` por cobro desde el inicio.
5. **Sesión 5:** `baneco-gateway` contra fixtures (Hito B1).
6. **Sesión 6:** satélite Baneco + Firestore (D2, opción b). Hitos B2–B4 en el
   mismo documento de prompts.

**Riel Yape — diferido** (retomar cuando haya documentación completa, D1):

7. **Dueño:** subir capturas de la consola Yape BCP a `docs/consola-yape/`
   (listado de movimientos, detalle, generación de QR si existe, pantalla de
   sesión vencida).
8. **Dueño:** verificar instalación del Playwright MCP local (reiniciar app de
   Claude → confirmar herramientas `playwright__*`).
9. Sesión de mapeo de la consola (docs/03 §6) cuando estén las capturas.

<details>
<summary>Plan anterior (previo al 2026-08-27, cuando Yape era la línea principal)</summary>

1. **Dueño:** subir capturas de la consola Yape BCP a `docs/consola-yape/`
   (listado de movimientos, detalle, generación de QR si existe, pantalla de
   sesión vencida).
2. **Dueño:** verificar instalación del Playwright MCP local (reiniciar app
   de Claude → confirmar herramientas).
3. **Claude Code, sesión 1** (seguir `PROMPTS_CLAUDE_CODE.md`, abierta
   desde este directorio): verificar contexto → fundar el monorepo
   instalable con gates en verde → empezar `qr-core` con TDD. El CI hoy
   está en rojo (no existe código que compilar) y el ruleset ya exige sus
   checks: el primer PR real es el de la fundación del monorepo, y a
   `main` no se pushea directo (salvo bypass de administrador).
4. Sesión de mapeo de la consola (docs/03 §6) cuando estén las capturas.
5. **Baneco (decisiones ya tomadas — ver arriba, punto 9):** seguir la
   secuencia actualizada de `PROMPTS_CLAUDE_CODE.md` (riel Baneco,
   2026-08-27), que es autosuficiente:
   a. **Dueño:** enviar `01-preguntas-al-banco.md` al oficial de cuenta y
      registrar las respuestas en el mismo documento; cargar `BANECO_CERT_*`
      en `.env` local antes de la Sesión 2 (valores en `privado-no-gh/`).
   b. **Claude Code, Sesión 1:** fundación del monorepo con 6 paquetes
      (incluye `@mqs/baneco-gateway`), ADR-006, impactos §8.2 y `.env.example`
      con bloque `BANECO_*` + selectores `QR_PROVIDER`/`PAYMENT_WATCHER`.
   c. **Claude Code, Sesión 2:** Hito B0 — `tools/baneco-b0/` contra
      certificación; hallazgos a `02-hallazgos-certificacion.md`.
   d. Luego dominio (Sesiones 3–4, con campo `provider` por cobro),
      `baneco-gateway` contra fixtures (Hito B1, Sesión 5) y satélite
      opción b (Sesión 6). Hitos B2–B4 en el mismo documento de prompts.

</details>
