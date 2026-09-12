# ESTADO — bitácora de avance para retomar sin perder contexto

> **Regla de uso:** este archivo se actualiza al final de cada sesión de
> trabajo y antes de cualquier pausa. Al retomar, leer esto primero.
> Nunca contiene secretos — solo estado, decisiones y próximos pasos.

**Última actualización:** 2026-09-12 (sesión "respuestas de Baneco" — respuestas del
banco registradas y mergeadas (#20); ventana de pago del QR cerrada y cierre diario en el
satélite (PR #21); consola de revisión manual con alertas (PR apilado sobre #21). Los dos
PRs esperan la autorización del dueño)

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
   `functions`, `demo-web` (React + Vite). *(Ampliada en la práctica: hoy son
   nueve paquetes — se sumaron `baneco-gateway`, `firestore-store`, `composicion`
   y `baneco-satelite`; la lista vigente está en CLAUDE.md, "Estructura".)*
4. **Ejecución del scraper: híbrido evolutivo (ADR-003).** Fase 0–1 en la
   ThinkPad del dueño; promoción a OCI cuando se necesite 24/7. En OCI, el cupo
   Ampere A1 gratuito ya está consumido por la VM Odoo-Server-ProyectoA (que
   co-hostea el laboratorio Evolution de WhatsApp-Modular): las opciones son
   co-hosteo en contenedor aislado (B) o VM E2.1.Micro del Always Free, cupo
   separado, a verificar (C).
5. **Firebase:** proyecto **ManejoQRSimple**, cuenta alberdi.andres@gmail.com.
   Mantener sin billing mientras se pueda (criterio heredado). *(El "verificar
   project-id" quedó resuelto por la decisión 12.)*
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
   reales por esa vía). *(Verificada: ver "En espera" — falta la decisión del
   dueño en docs/04 §2.3.)*
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
     *(Confirmado por el banco el 2026-09-11, respuesta D4: el webhook no es
     obligatorio.)*
   - **D4:** los adjuntos del banco **no se suben a GitHub**; permanecen en la
     ThinkPad en `docs/Integraciones/baneco/privado-no-gh/` (git-ignored). No se
     solicita rotación de llave por ahora (superficie de riesgo acotada).
     *(Matiz del banco, B3: la llave de producción se asigna al salir a
     producción — la que circuló no sería la definitiva.)*
   - **D5:** **vigencia corta** de `dueDate` por cobro (72 h por defecto,
     configurable); la renovación programática la abarata.
   - **D6:** se envió al banco la batería de preguntas
     `docs/Integraciones/baneco/01-preguntas-al-banco.md` el 2026-08-27.
     **Respondida el 2026-09-11** (queda abierta solo D1, IPs del webhook).
10. **Playwright MCP local:** el dueño decidió instalarlo en su app de escritorio
   (guía entregada en la sesión: ruta absoluta de npx por nvm,
   `--user-data-dir` persistente, chmod 700). Estado: **pendiente de
   verificación** (al reiniciar la app, pedir a Claude que confirme que las
   herramientas `playwright__*` aparecen).
11. **Flujo de PRs (2026-08-27, reafirmado en cada sesión):** Claude Code arma el
    PR **completo** —rama, commits, push, `gh pr create`, checks en verde— y se
    detiene. **El dueño autoriza en el chat, PR por PR**; recién entonces Claude
    mergea (squash; el ruleset no admite rebase). Nunca auto-merge ni
    auto-aprobación. Desde el 2026-09-12 la regla de seguridad global del dueño
    (§4) exige además que el merge **deje constancia escrita** de quién autorizó,
    cuándo y por qué medio (en el mensaje del squash), y que un OK no se extienda a
    pushes posteriores que cambien el contenido del PR.
12. **Proyecto Firebase:** project-id **`manejoqrsimple`**, número de proyecto
    `658736385545` (registrado en docs/05 §1). No se despliega nada sin pedido
    explícito del dueño.
13. **"Cablear todo" (sesión de integración):** el sistema debe poder ejercitarse
    de punta a punta en modo demo sin banco ni WhatsApp — de ahí `tools/demo-local`,
    la API de `functions` y la consola `demo-web`.
14. **`VENCIDO → EN_REVISION` y revisión manual periódica (2026-09-12):** un pago
    que llega sobre un QR vencido va a revisión manual (evento `ABONO_TARDIO`). Los
    casos en revisión se atienden desde una consola con alertas, con revisión
    periódica. Implementado en PR #21 y en el PR de la consola.
15. **Pendiente de OK del dueño — `QR_ACTIVO → PAGO_DETECTADO`** (propuesto en PR
    #21 a raíz de la auditoría de seguridad): si WhatsApp entrega el QR pero reporta
    una falla, el cliente puede pagar un cobro que nunca pasó a `ENVIADO`. Manda el
    banco, no nuestro registro del envío (regla #1). Autorizar #21 es aceptar este
    cambio al diagrama de CLAUDE.md.

## Estado actual

**Hito en curso:** Fase 1 — riel Baneco. El sistema completo corre de punta a punta
**en modo demo** (mock/simulado); contra el banco real falta el Hito B0 y, para que un
cobro real llegue a `ENVIADO`, falta `wa-bridge`.

### Hecho

- [x] Análisis de convenciones de los proyectos hermanos (segurolotengo-demo,
      WhatsApp-Modular) y decisión de replicar sus estilos y procedimientos.
- [x] Documentación de arranque completa: CLAUDE.md, docs/00–09, este ESTADO.
- [x] Configuración de Claude Code: settings.json (allow/deny), 6 agentes,
      comandos, hook anti-secretos, .mcp.json.
- [x] Configuración de repo: .gitignore, .gitleaks.toml, CI, dependabot,
      PR template, .env.example, package.json y tsconfig.json raíz.
- [x] Decisiones de arquitectura ADR-001…005 documentadas (docs/01 §6).
- [x] Independencia del proyecto asentada en los docs.
- [x] Repo publicado en `segurolotengopy/ManejoQRSimple`, rama `main`; remoto
      `origin` por el alias SSH `github-segurolotengo`.
- [x] Branch protection: ruleset `main-protegida` (id 20972960) — sin borrado ni
      force-push, todo cambio por PR (0 aprobaciones, **solo merge/squash**; el
      rebase-merge es rechazado), checks requeridos "Lint · Types · Tests · Build"
      y "Secretos en el historial", bypass solo para administradores.
- [x] **2026-08-27 — Análisis de integración con Baneco** y **ingesta segura** de sus
      documentos (`docs/Integraciones/baneco/`, con `privado-no-gh/` git-ignored).
      Jerarquía de fuentes en el README de esa carpeta.
- [x] **2026-08-27 — Fase 0: monorepo con gates en verde** (PR #1). TypeScript con
      project references (`tsconfig.base.json` / `tsconfig.json` solución /
      `tsconfig.typecheck.json` con paths a `src`), ESLint strictTypeChecked, regla
      de dependencias en dependency-cruiser (verificada introduciendo violaciones).
- [x] **Dominio `qr-core`** (PR #2) y **casos de uso + E2E** (PR #5). Montos como
      tipo marcado `Centavos`; `CONFIRMADO` exige una `ConciliacionAprobada` que
      solo fabrica `conciliar()` (lo sostiene el compilador). Casos de uso en
      `casos-uso/cobrar.ts`; `aplicar()` escribe evidencia **antes** que estado.
      Política por defecto: tolerancia de vencimiento de 10 min (elección técnica,
      no documentada por el banco).
- [x] **Hito B1 — `@mqs/baneco-gateway` contra fixtures** (PR #4). Cifrado AES,
      schemas Zod en todos los bordes (sobre `responseCode` validado antes que la
      forma completa, para no perder el código de error), token con renovación
      anticipada y reintento único ante 401.
- [x] **Hito B0 escrito, no corrido** (PR #6): `npm run baneco:b0`, en
      `tools/baneco-b0/`. Solo corre con `BANECO_ENV=cert` (doble barrera), anula
      todo QR que crea, sanea fixtures y se niega a escribir un archivo que contenga
      un secreto. Distingue "no llegué al banco" (NO_CONCLUYENTE) de "me rechazó"
      (REFUTADO).
- [x] **Licencia Apache-2.0** (PRs #3 y #7).
- [x] **Seguridad del CI** (PR #10, del dueño): la org exige acciones **pineadas a
      SHA completo**; CodeQL activo. Tres rondas de CodeQL (clear-text-logging) se
      cerraron envolviendo los secretos en `Secreto` **al leerlos**
      (`baneco-gateway/src/secreto.ts`); quitar el valor del log no alcanzaba.
- [x] **`@mqs/firestore-store`** (PR #8): `create()` (no `set()`) para evidencia e
      historial de QRs; id de documento = clave natural; ids de evidencia con
      contador monotónico para desempatar en el mismo milisegundo.
- [x] **`@mqs/baneco-satelite`** (PR #9), **`@mqs/composicion`** (PR #11:
      `MODOS = mock | simulado | baneco | yape`; persistencia por parámetro, nunca
      por variable de entorno; mensajería honesta por defecto).
- [x] **`tools/demo-local`** (PR #12), **API HTTP en `functions`** (PR #13: auth
      antes que ruteo, token fijo comparado con `timingSafeEqual`, mínimo 16
      caracteres o no arranca) y **consola `demo-web`** (PR #14, React 19 + Vite 8).
- [x] **WhatsAppModular verificado** (docs/04 §2 reescrito desde el código real):
      solo expone `/v1/otp/request` y `/v1/otp/verify`; `OutboundContent` admite
      `kind:'image'` como tipo de **biblioteca**, y su webhook entrante solo entiende
      `text|button|unsupported` — un comprobante en imagen se perdería.
- [x] **2026-09-12 — Respuestas del banco registradas (PR #20, mergeado).** En
      `01-preguntas-al-banco.md`: respuesta + "qué cambia" por fila, sección G (pago a
      proveedores: no existe; Bec QR Connect: manuales a pedido), hallazgos derivados y
      estado de cada supuesto. La numeración C del correo del banco está corrida en uno
      (su C7 = nuestra C8). Lo esencial: credenciales de cert del PDF compartidas (A3);
      sin simulación de pagos — se manda la imagen del QR por correo (A2); JWT de 30 min
      (B1); polling desde 10 s (D6); fechas en hora de Bolivia, día anterior completo
      desde 00:00:01 (D7); sin reversiones (D8); sin catálogo de errores (E1); el banco
      no valida la unicidad de `transactionId` (C3); no hay estado "vencido" y el QR
      vencido no se paga (C4); movimientos en `accounts/queryMovements` (F2). El
      catálogo de bancos que dijeron adjuntar (D9) **no llegó**.
      Mismo PR: esquema AES confirmado sin red con el vector oficial del PDF (no se
      versiona: lleva la llave de cert); token de respaldo 4 → 30 min; satélite cada
      **30 s** (piso 10 s); y 25 tests que dependían de la fecha, arreglados (regla
      para tests nuevos: **todo proveedor con reloj inyectable recibe el reloj del
      test**).
- [x] **2026-09-12 — Ventana de pago del QR cerrada (PR #21, abierto).** Rama
      `feat/cerrar-ventana-de-pago`, dos commits (el cambio y las correcciones de la
      auditoría de seguridad):
      - La máquina de estados exige una constancia `QrAnulado` (tipo marcado, solo la
        produce `anularEnProveedor()` en `qr-core/src/cobro/anulacion.ts`) para soltar
        un QR pagable: `QR_VENCIDO`, `VENTANA_AGOTADA`, `ANULADO`.
      - Evento `ABONO_TARDIO` (`VENCIDO → EN_REVISION`). Propuesto: `QR_ACTIVO →
        PAGO_DETECTADO` (decisión 15).
      - `vigilar()` reemplaza a `vencerSiCorresponde()`: consulta, anula en el banco,
        **vuelve a consultar**, y recién entonces vence. `anular()` y `renovar()` miran
        el banco antes y después.
      - Toda escritura de estado es condicional (`guardar(cobro, estadoEsperado)`,
        transacción en Firestore, error `CONFLICTO` → 409). Efecto visible:
        `demo:sembrar` ya no pisa cobros existentes.
      - Satélite: cierre diario `paidQR` sobre los últimos 3 días no cerrados (hora de
        Bolivia), idempotente; `conciliarDia()` busca cada abono por la referencia de
        su QR (`CobroRepository.buscarPorReferenciaQr`) y solo da un abono por
        registrado si figura en la evidencia.
      - Verificado: 516 tests, emulador 16/16, y en vivo (demo-004 venció con
        `qrAnulado` en la evidencia).
- [x] **2026-09-12 — Consola de revisión manual (PR apilado sobre #21, abierto).**
      Rama `feat/consola-revision`:
      - Dominio: `qr-core/src/revision/revision.ts` arma cada caso desde la evidencia
        (motivo, desde cuándo, abono del banco, nivel de alerta). Umbrales: con pago
        recibido, atrasado a las 4 h y crítico a las 24 h; sin pago, 24 h y 72 h.
      - `casos-uso/revisar.ts`: `listarRevision`, `resolverRevision` (confirmar
        **exige un abono del banco en la evidencia** — `SIN_DETECCION_DEL_BANCO` si no;
        el evento nombra el `idDeduplicacion` aceptado) y `buscarAbonoEnRevision`.
        Evento nuevo `DETECCION_EN_REVISION` (`EN_REVISION → EN_REVISION`), que usan
        esa búsqueda y el cierre diario.
      - API: `GET /api/revision`, `POST /api/cobros/:id/resolver` (motivo ≥ 10
        caracteres), `POST /api/cobros/:id/buscar-abono`.
      - Consola: pestaña **Revisión** con insignia coloreada, contador en el título
        del navegador, avisos del sistema operativo por críticos nuevos (opt-in),
        recordatorio de revisión cada 24 h (`localStorage`), recomendación por caso.
      - Guía operativa: `docs/09-revision-manual.md`.
      - Verificado: 584 tests, y en vivo en el navegador (cola, insignia, título,
        diferencia de monto, resolución por la API con evidencia `accion-manual`).

### En espera (bloqueos externos)

| Qué | Desde | Bloquea | Mientras tanto |
|---|---|---|---|
| Autorización del dueño: PR #21 y luego el de la consola | 2026-09-12 | Que la ventana de pago y la consola lleguen a `main` | Los dos PRs tienen checks en verde. |
| Cuenta de abono de pruebas de Baneco (A4) | 2026-09-11 | Que B0 genere QRs (sin ella solo prueba el login) | El login y el cifrado se pueden probar ya con las credenciales compartidas del PDF. |
| Catálogo de bancos (D9) | 2026-09-12 | Nada (deseable) | El banco dijo adjuntarlo y no llegó: pedirlo de nuevo. |
| Pago manual de un QR de prueba por el banco (A2) | — | Capturar un `statusQR` pagado y un `paidQR` reales → fixtures reales | Hace falta primero el modo "pago asistido" de B0. |
| IPs del webhook (D1) | 2026-08-27 | Solo el Hito B3 (webhook) | Se opera sin webhook. |
| Decisión del dueño sobre WhatsAppModular (docs/04 §2.3) | 2026-08-27 | `wa-bridge` — **sin él ningún cobro real pasa de `QR_ACTIVO`** | Demo con `MESSAGING_PROVIDER=mock`. |
| Capturas de la consola Yape BCP | — | Riel Yape (diferido, D1) | Sin impacto en Baneco. |

### Riesgos abiertos

- **R8 y R9 mitigados en PR #21** (ver `00-analisis-modulo-baneco.md` §10). Queda la
  carrera de segundos entre la última consulta y la anulación, que cubre el cierre
  diario.
- **Los abonos huérfanos y sin corroborar solo van al log del satélite**
  (`! abono para revisar a mano: …`). No están en la consola. Hay que leer el log
  después de cada cierre hasta que se persistan.
- **Doble anulación (B2 de la auditoría):** reintentar `cancelQR` sobre un QR ya
  anulado depende de que el banco lo trate como idempotente (C5 no lo responde). Lo
  sondea B0 (P4); si el banco devuelve error, el adaptador tiene que mapear ese
  `responseCode` a éxito.
- **Las alertas de revisión viven en la consola abierta.** Con la consola cerrada
  nadie avisa. El paso natural, cuando exista `wa-bridge`, es avisar al dueño por
  WhatsApp los casos críticos.

### Notas de entorno (no obvias)

- Node 22+ por nvm (hay v24): `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24`.
  El `/usr/bin/node` del sistema es v18 y rompe Vitest (`node:util does not provide
  styleText`).
- Límite de inotify: `sudo sysctl fs.inotify.max_user_instances=512` (el valor por
  defecto, 128, rompe el emulador de Firestore con reglas y `vite dev`). Sin eso,
  `firebase.demo.json` levanta el emulador sin reglas.
- gitleaks se escanea con el binario **8.24.3** (la misma versión que el CI).
- El token de `demo-web/.env.local` queda embebido en el bundle al compilar: vale
  para la máquina del dueño; publicar la consola exige pasar a Firebase Auth (ya
  implementado del lado de la API). Para una prueba sin tocar `.env.local`, las
  variables `VITE_*` del entorno tienen prioridad sobre el archivo.
- `demo:sembrar` no pisa cobros existentes (escritura condicional): para sembrar de
  cero, reiniciar el emulador.
- `firebase-admin` arrastra 6 avisos moderados transitivos sin versión que los
  corrija (cadena de Google).

### Próximo paso (retomar acá)

**Dueño:**

1. Revisar y **autorizar PR #21** (ventana de pago). Autorizarlo incluye aceptar el
   cambio al diagrama `QR_ACTIVO → PAGO_DETECTADO` (decisión 15). Después, autorizar
   el PR de la consola de revisión, que está apilado encima.
2. Pedirle al oficial de Baneco, en un mismo correo: el **usuario y la cuenta de
   abono de pruebas** (A4), el **catálogo de bancos** que no llegó (D9) y, si
   interesa, los manuales de **Bec QR Connect** (G2). Cargar `BANECO_CERT_*` en el
   `.env` local, nunca en el repo.
3. Revisar `.env.example`: si documenta `BANECO_POLL_INTERVAL_SECONDS` con 180,
   actualizarlo a 30 (Claude Code no tiene permiso de lectura sobre `.env.*`).
4. Decidir la opción de WhatsAppModular en docs/04 §2.3.
5. Comercial: negociar comisiones con el ejecutivo (C9) y, al acercarse producción,
   pedir la llave de producción por un canal que no sea un adjunto de correo (B3).
6. Adoptar la rutina de `docs/09-revision-manual.md` §3: una revisión diaria de la
   pestaña Revisión.
7. Persistir el límite de inotify (archivo en `/etc/sysctl.d/`).

**Claude Code:**

1. Tras la autorización: mergear #21 y luego la consola (squash, con constancia de
   la autorización en el mensaje), y rebasar la consola sobre `main` si hace falta.
2. **Hito B0**, apenas llegue la cuenta de pruebas: correr `npm run baneco:b0`
   (primero el login, que confirma end-to-end el cifrado y resuelve V1/V4) y agregar
   el modo **pago asistido** (A2): un QR que no se anula, su PNG en
   `tools/baneco-b0/out/` (git-ignored) para mandarlo por correo, y una segunda
   corrida que capture el `statusQR` pagado y el `paidQR` como fixtures reales.
   Incluir el sondeo de doble anulación (riesgo B2).
3. **Persistir los abonos huérfanos y sin corroborar** del cierre diario y
   mostrarlos en la pestaña Revisión (hoy solo van al log del satélite).
4. Barrido documental pendiente de §8.2: docs/02 §5, docs/06 amenaza T9, docs/07
   (partición de fases), docs/05.
5. `wa-bridge`, cuando el dueño decida docs/04 §2.3; con él, aviso de casos
   críticos por WhatsApp.

**Riel Yape — diferido** (retomar cuando haya documentación completa, D1): capturas
en `docs/consola-yape/`, verificación del Playwright MCP local y sesión de mapeo de
la consola (docs/03 §6).

<details>
<summary>Planes anteriores (2026-08-27), ya ejecutados o reemplazados</summary>

La secuencia de `PROMPTS_CLAUDE_CODE.md` (riel Baneco) quedó ejecutada hasta la
Sesión 6: fundación del monorepo, dominio con `provider` por cobro, `baneco-gateway`
contra fixtures (B1) y satélite + Firestore (D2 opción b). La Sesión 2 (Hito B0)
quedó escrita pero sin correr, a la espera de la cuenta de pruebas (A4). El plan
previo, cuando Yape era la línea principal, quedó reemplazado por la decisión 2.

</details>
