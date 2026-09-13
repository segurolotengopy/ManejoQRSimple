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

Se bifurca por proveedor (análisis Baneco §8.2):

- **Baneco — ya en curso.** La API oficial llegó antes que el scraping: el riel
  Baneco no pasa por el scraper. Hitos (análisis Baneco §8.3): B0 validación de
  contrato en certificación (escrito, espera la cuenta de pruebas A4); B1
  adaptador contra fixtures (hecho); B2 flujo E2E (cubierto por la prueba
  controlada en producción, docs/Integraciones/baneco/03, porque el banco no
  simula pagos); B3 webhook (diferido, D3); B4 pase a producción.
  **Criterio de salida:** informe de la prueba en producción sin hallazgos
  abiertos, fixtures reales en `baneco-gateway`, `wa-bridge` operativo y la
  llave de producción definitiva (B3 del banco).
- **Yape/BCP — espera API.** Acceso formal a la API del BCP / OpenBCB (docs/02
  §5); documentación oficial a `docs/Integraciones/`. Adaptadores `live` de
  `PaymentWatcher` y `QrProvider`; mismos tests de contrato; retiro del scraper y
  revocación de sus credenciales.
- Recién aquí se evalúa hablar de producción.
