# ESTADO — bitácora de avance para retomar sin perder contexto

> **Regla de uso:** este archivo se actualiza al final de cada sesión de
> trabajo y antes de cualquier pausa. Al retomar, leer esto primero.
> Nunca contiene secretos — solo estado, decisiones y próximos pasos.

**Última actualización:** 2026-08-18 (sesión 0.1 — repo en la org, push y branch protection)

---

## Decisiones transversales vigentes (del dueño del proyecto)

1. **Caso de uso:** cobros por QR Simple en Bolivia, análogo a SeguroLoTengo
   (Paraguay) pero para el mercado boliviano. **Demo**, no producción, hasta
   contar con las API oficiales.
2. **Billetera:** **Yape de BCP Bolivia**. Su consola web (autenticada) es la
   fuente de verdad de pagos vía scraping. El dueño aportará capturas de la
   consola a `docs/consola-yape/` — el mapeo de selectores (docs/03 §6) espera
   esas capturas.
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
6. **Repo:** `git@github.com:segurolotengopy/ManejoQRSimple.git` (decisión del
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
9. **Playwright MCP local:** el dueño decidió instalarlo en su app de escritorio
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

### Próximo paso (retomar acá)

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
