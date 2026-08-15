# ManejoQRSimple — Índice de Documentación

Sistema modular de cobros por **QR Simple (Bolivia)** sobre **Yape BCP Bolivia**,
con envío por WhatsApp (WhatsAppModular) y confirmación de pagos contra la
consola web de la billetera — proyecto independiente (Bolivia, +591).

> **Fecha de elaboración:** 14 de agosto de 2026
> **Estado:** documentación de arranque (pre-código)
> **Runtime elegido:** Node.js 22 LTS + TypeScript
> **Repositorio:** monorepo modular (npm workspaces) — `git@github.com:AndresAlberdi/ManejoQRSimple.git`
> **Firebase:** proyecto **ManejoQRSimple**, cuenta alberdi.andres@gmail.com

---

## Cómo usar estos documentos

Estos `.md` están pensados para vivir **dentro del repositorio** y ser leídos
tanto por el dueño como por Claude Code. El archivo `CLAUDE.md` en la raíz es el
que Claude Code carga automáticamente en cada sesión; los documentos de `docs/`
se referencian desde ahí con la sintaxis `@docs/archivo.md` cuando hacen falta.

**Orden de lectura sugerido:**

1. `01-arquitectura.md` → el diseño del sistema y los ADRs.
2. `02-qr-simple-bolivia.md` → el contexto del estándar QR boliviano.
3. `03-scraping-yape-bcp.md` → cómo (y bajo qué reglas) se confirma un pago.
4. `07-plan-fases.md` → qué se construye primero y qué define "terminado".
5. El resto, a medida que el área lo requiera.

---

## Documentos

| #   | Archivo | Qué resuelve |
| --- | ------- | ------------ |
| 01  | [`01-arquitectura.md`](01-arquitectura.md) | Arquitectura modular, módulos del monorepo, flujo del cobro, decisiones (ADR) |
| 02  | [`02-qr-simple-bolivia.md`](02-qr-simple-bolivia.md) | Estándar QR BCB / QR Simple: interoperabilidad, ciclo de vida, vencimiento, cifras a verificar |
| 03  | [`03-scraping-yape-bcp.md`](03-scraping-yape-bcp.md) | Estrategia de scraping de la consola Yape BCP: sesión, contención, mapeo de selectores, riesgos |
| 04  | [`04-integracion-whatsapp-modular.md`](04-integracion-whatsapp-modular.md) | Contrato con WhatsAppModular: envío del QR con datos del cobro, recepción del comprobante |
| 05  | [`05-firebase-demo.md`](05-firebase-demo.md) | Proyecto Firebase: Firestore, Functions, Hosting, emuladores, reglas de seguridad |
| 06  | [`06-seguridad.md`](06-seguridad.md) | Modelo de amenazas, secretos, redacción en logs, checklist de seguridad |
| 07  | [`07-plan-fases.md`](07-plan-fases.md) | Fases 0–3 con criterios de salida; de demo local a API oficial |
| 08  | [`08-agentes.md`](08-agentes.md) | Subagentes de Claude Code por etapa, con su justificación |
| —   | [`ESTADO.md`](ESTADO.md) | **Bitácora de avance. Leer al empezar, actualizar al cerrar cada sesión.** |

## Carpetas auxiliares

```
docs/consola-yape/       Capturas de la consola Yape BCP aportadas por el dueño.
                         Fuente de verdad del mapeo de selectores del scraper.
docs/Integraciones/      Documentación técnica de proveedores externos
                         (BCP, BCB, Meta). Nunca suelta en la raíz de docs/.
```

## Archivos de configuración incluidos

```
CLAUDE.md                      Instrucciones de proyecto para Claude Code
PROMPTS_CLAUDE_CODE.md         Secuencia de prompts para las primeras sesiones
.claude/settings.json          Permisos, hooks, entorno
.claude/agents/*.md            6 subagentes especializados
.claude/commands/*.md          Comandos slash del proyecto
.claude/hooks/*.sh             Hooks de protección (secretos)
.mcp.json                      Servidores MCP del proyecto
.github/workflows/ci.yml       CI bloqueante (lint, types, tests, gitleaks)
.github/dependabot.yml         Actualizaciones de dependencias
.env.example                   Todas las variables, sin valores reales
.gitleaks.toml                 Reglas de detección de secretos del proyecto
```

---

## Advertencia sobre cifras

Los límites de monto, comisiones y plazos máximos de vigencia del QR en Bolivia
dependen de normativa del BCB y de políticas del BCP que cambian. Los datos de
`02-qr-simple-bolivia.md` se relevaron el **14-ago-2026** con fuentes públicas
del BCB y ASFI, pero **antes de comprometer un vencimiento largo o un monto
máximo, verifícalo contra la consola real de Yape BCP y la normativa vigente**
— la consola es la fuente operativa de verdad de lo que la billetera permite.
