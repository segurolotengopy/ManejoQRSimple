# 07 — Plan de fases

Sin cronograma por semanas: paso a paso, hito por hito (procedimiento del
dueño, heredado de WhatsApp-Modular). Cada fase tiene criterio de salida
verificable. El avance real se registra en `ESTADO.md`.

## Fase 0 — Fundación y dominio (local, sin banco)

- Monorepo instalable con los gates en verde (lint, typecheck, test, deps:check).
- `qr-core` completo con TDD: cobros, máquina de estados, conciliación,
  política de vencimiento/renovación. Adaptadores mock de los puertos.
- Repo en GitHub con CI bloqueante, gitleaks, dependabot y branch protection
  (mismo procedimiento que los proyectos hermanos).
- **Criterio de salida:** un cobro recorre BORRADOR→CONFIRMADO y las ramas
  VENCIDO/renovación y EN_REVISION **en tests**, con adaptadores mock.

## Fase 1 — Demo integrado (Firebase + scraper en ThinkPad + WhatsApp)

- Mapeo de la consola Yape BCP con las capturas del dueño (docs/03 §6) y
  decisión Variante A/B del origen del QR (§5).
- `yape-scraper` contra fixtures + puesta en marcha real en la ThinkPad
  (`scraper:login`, `scraper:dry`, luego escritura a Firestore).
- `wa-bridge` contra el estado real de WhatsAppModular (verificar su API;
  laboratorio Evolution solo con números de prueba propios).
- `functions` + `demo-web` sobre emuladores y luego el proyecto ManejoQRSimple.
- **Criterio de salida (demo E2E real):** el dueño crea un cobro → el cliente
  de prueba recibe el QR por WhatsApp → paga → responde comprobante → el
  scraper detecta el abono en la consola real → el cobro queda `CONFIRMADO` y
  el cliente recibe la confirmación. Todo sin tocar credenciales en el sistema.

## Fase 2 — Operación 24/7 (promoción del scraper a OCI)

- Solo cuando el demo lo necesite. Requisitos duros en docs/03 §7.
- Decidir co-hosteo (VM existente) vs VM E2.1.Micro dedicada; registrar en ESTADO.md.
- **Criterio de salida:** pago detectado y confirmado con la laptop apagada;
  alerta correcta al dueño ante sesión expirada.

## Fase 3 — API oficial (salida del scraping)

- Acceso formal a la API del BCP / OpenBCB (docs/02 §5). Documentación oficial
  a `docs/Integraciones/`.
- Adaptadores `live` de `PaymentWatcher` y `QrProvider`; mismos tests de
  contrato; retiro del scraper y revocación de sus credenciales.
- Recién aquí se evalúa hablar de producción.
