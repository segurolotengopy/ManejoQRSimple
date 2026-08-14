---
description: Auditoría de seguridad del diff actual contra el checklist del proyecto
argument-hint: "[área a enfocar, opcional]"
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git status), Bash(npm audit:*)
---

Audita el diff actual contra el checklist de @docs/06-seguridad.md.

Diff a revisar:
!`git diff HEAD`

Enfoque adicional pedido: $ARGUMENTS

Revisa específicamente:

- Fraude (T1): ¿algún camino nuevo permite `CONFIRMADO` sin detección del
  `PaymentWatcher`? ¿La conciliación sigue exigiendo monto exacto, vigencia y
  hash no duplicado?
- Sesión bancaria y secretos (T2/T7): ¿algún valor real, ruta de storageState,
  llave de service account o token quedó en código, test, fixture o doc?
- Contención del scraper (T3): ¿alguna interacción de escritura con la consola?
  ¿Selectores o URLs sin respaldo en docs/03 §6?
- Webhook (T5): ¿HMAC sobre raw body ANTES de parsear, `timingSafeEqual`,
  deduplicación por `messageId`?
- Idempotencia (T4): ¿re-scrape o doble entrega pueden duplicar confirmación
  o evidencia?
- Minimización (T6): ¿datos bancarios o personales de más hacia Firestore o
  logs? ¿Teléfonos enmascarados?

Formato del reporte, por hallazgo:
`severidad · archivo:línea · escenario de explotación concreto · corrección`

Un hallazgo sin escenario de explotación concreto no se reporta.
Si no encuentras nada, di "sin hallazgos" — es una respuesta válida.
