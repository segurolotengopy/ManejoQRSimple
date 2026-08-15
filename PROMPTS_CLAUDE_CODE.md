# Secuencia de prompts para Claude Code — ManejoQRSimple

Copiar y pegar en orden. Antes de cada bloque nuevo: `/clear`. Para cualquier
prompt marcado con 🗺️, entrar primero en modo plan con `/plan`, revisar la
propuesta y recién después aprobar.

---

## Preparación (una sola vez, en la terminal)

```bash
cd ~/ManejoQRSimple          # esta carpeta, ya poblada con docs y config
chmod +x .claude/hooks/*.sh
git init
git remote add origin git@github-segurolotengo:segurolotengopy/ManejoQRSimple.git
gh auth status               # verificar credenciales de GitHub
firebase login:list          # verificar cuenta alberdi.andres@gmail.com
claude
```

Dentro de Claude Code, primera vez:

```
/doctor
/agents        ← deben aparecer los 6 agentes
/hooks         ← debe aparecer no-secrets.sh
/permissions   ← revisar que cargó .claude/settings.json
```

---

## Sesión 1 — Verificación de contexto y fundación

**1.1 — Verificar el contexto**

```
Lee CLAUDE.md, docs/01-arquitectura.md y docs/ESTADO.md completos. Después
resume en 10 líneas: cuál es el flujo del cobro, cuáles reglas no se pueden
violar, qué es fuente de verdad de un pago, y qué está pendiente del dueño.
No escribas código todavía.
```

Si el resumen tiene algo mal, corregirlo ahora — todo lo que sigue depende de esto.

**1.2 🗺️ — Monorepo instalable**

```
Crea el esqueleto del monorepo según docs/01-arquitectura.md §4: los cinco
paquetes @mqs/* con su package.json, tsconfig y un test trivial cada uno;
eslint.config.mjs y .dependency-cruiser.cjs que valide la regla de
dependencias (qr-core no importa a nadie; ningún adaptador importa a otro
adaptador; Playwright solo en yape-scraper). Objetivo: npm ci && npm run
lint && npm run typecheck && npm test && npm run deps:check en verde.
No implementes dominio todavía.
```

**1.3 — Primer commit, GitHub y protecciones**

```
Haz el commit inicial y súbelo a origin/main. Después configura con gh:
branch protection en main (checks obligatorios: verify y gitleaks; historia
lineal; sin force push), squash-merge único, Dependabot alerts y security
fixes. Mismo procedimiento que los proyectos hermanos (ver docs/ESTADO.md
decisión 6). Reporta el resultado real de cada paso.
```

**1.4 — Cierre**

```
/actualizar-estado
```

---

## Sesión 2 🗺️ — Dominio: cobros y máquina de estados (TDD)

```
Implementa en packages/qr-core, con TDD estricto:
1. Los tipos del Cobro y sus sub-objetos (cliente mínimo, QR versionado,
   evidencia) con Zod y montos en centavos enteros.
2. La máquina de estados exacta de CLAUDE.md, con una única función de
   transición que valide transiciones legales y registre evidencia
   append-only. Estados terminales sin salida.
3. La política de vencimiento y renovación (qrVersion + 1, historial).
4. Tests: toda transición ilegal rechazada; VENCIDO→renovación conserva el
   cobro; CONFIRMADO/RECHAZADO/ANULADO sin salida; reloj inyectado.
Consulta a test-engineer para la tabla de casos antes de implementar.
```

## Sesión 3 🗺️ — Dominio: conciliación y puertos

```
Implementa la conciliación (AbonoDetectado × Cobro → PAGO_DETECTADO →
CONFIRMADO) según docs/03 §8 y las cinco interfaces de puertos con sus
adaptadores mock y tests de contrato compartidos (docs/01 §6, ADR-002).
Casos obligatorios: duplicado por hash no confirma dos veces; ambigüedad de
monto → EN_REVISION; comprobante jamás confirma (regla inviolable #1).
```

## Sesión 4 — Mapeo de la consola Yape BCP (requiere capturas del dueño)

```
Con las capturas de docs/consola-yape/, usa scraper-yape para completar el
mapa de docs/03 §6 (URLs, selectores, campos, formatos de fecha y monto).
Propón la decisión Variante A/B del origen del QR (docs/03 §5) con pros y
contras para que el dueño decida. No escribas código del scraper hasta que
el mapa esté aprobado.
```

## Sesiones siguientes

En orden, cada una con `/plan` y cerrando con `/actualizar-estado`:

5. `yape-scraper` contra fixtures (TDD) + `scraper:login` + `scraper:dry` real.
6. `wa-bridge`: verificar la API real de WhatsAppModular, implementar cliente
   y webhook con HMAC (docs/04).
7. `functions` + reglas de Firestore (docs/05) sobre emuladores.
8. `demo-web`: crear cobro, ver estado, renovar QR.
9. Demo E2E de Fase 1 (criterio de salida en docs/07).

Antes de cada merge a main: `/revisar-seguridad`.
