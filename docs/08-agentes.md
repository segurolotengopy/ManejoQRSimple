# 08 — Agentes de Claude Code

Los 6 subagentes están en `.claude/agents/`. Se cargan solos al abrir Claude
Code en el repositorio; verificar con `/agents`.

## Mapa: etapa → agente

```
DISEÑO          ██ arquitecto            decide y documenta (ADR)
CONSTRUCCIÓN    ██ backend-dev           implementa qr-core/wa-bridge/functions con TDD
                ██ scraper-yape          todo lo que toque la consola Yape BCP
                ██ test-engineer         diseña y audita la batería de tests
VERIFICACIÓN    ██ code-reviewer         defectos en el diff
                ██ security-auditor      fraude, secretos, contención del scraper
```

## Tabla de referencia

| Agente | Cuándo se invoca | Modelo | Herramientas |
|---|---|---|---|
| `arquitecto` | Funcionalidad nueva, cambio de límites entre módulos, elección entre enfoques | opus | lectura + web + Write (solo ADR) |
| `backend-dev` | Casos de uso, dominio, adaptadores no bancarios, Functions | heredado | lectura, edición, shell |
| `scraper-yape` | Cualquier cambio en `yape-scraper`, mapeo de la consola, fixtures | opus | lectura, edición, shell |
| `test-engineer` | Diseño y auditoría de tests, cobertura, tests intermitentes | heredado | lectura, edición, shell |
| `security-auditor` | Antes de cada merge a `main`; todo lo que toque conciliación, webhook o secretos | opus | solo lectura + shell |
| `code-reviewer` | Antes de abrir un PR | heredado | solo lectura |

> «Heredado» = usa el modelo de la sesión. Los agentes en `opus` son aquellos
> donde un error tiene costo alto y difícil de detectar: diseño, el contrato
> con un sistema externo frágil (la consola del banco), y seguridad.
> `security-auditor` y `code-reviewer` no pueden editar: auditan, no "arreglan".

Criterios de creación/ajuste de agentes: los de `docs/06-agentes.md` de
WhatsApp-Modular (la `description` del frontmatter es el disparador; escribirla
como condición de uso, no como rol).

## Combinaciones que funcionan bien

**Antes de un merge a `main`:**

```
"Usa code-reviewer sobre el diff contra main. Después pasa los hallazgos a
 security-auditor para que verifique impacto de fraude o fuga."
```

**Al empezar el scraper:**

```
"scraper-yape: con las capturas de docs/consola-yape/, completa el mapa de
 docs/03 §6. No escribas código hasta que el mapa esté aprobado."
```
