# ESTADO — bitácora de avance para retomar sin perder contexto

> **Regla de uso:** este archivo se actualiza al final de cada sesión de
> trabajo y antes de cualquier pausa. Al retomar, leer esto primero.
> Nunca contiene secretos — solo estado, decisiones y próximos pasos.

**Última actualización:** 2026-09-12 (sesión "respuestas de Baneco" — el banco respondió
la batería de preguntas; respuestas registradas, esquema AES confirmado con el vector
oficial, dos huecos nuevos detectados: QR pagable tras vencer y conciliación diaria sin
correr)

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
    detiene. **El dueño autoriza**; recién entonces Claude mergea. Nunca
    auto-merge ni auto-aprobación (regla de seguridad global del dueño, §4). El
    ruleset solo admite merge o squash: se usa **squash**.
12. **Proyecto Firebase:** project-id **`manejoqrsimple`**, número de proyecto
    `658736385545` (registrado en docs/05 §1). No se despliega nada sin pedido
    explícito del dueño.
13. **"Cablear todo" (sesión de integración):** el sistema debe poder ejercitarse
    de punta a punta en modo demo sin banco ni WhatsApp — de ahí `tools/demo-local`,
    la API de `functions` y la consola `demo-web`.

## Estado actual

**Hito en curso:** Fase 1 — riel Baneco. El sistema completo corre de punta a punta
**en modo demo** (mock/simulado); contra el banco real falta el Hito B0 y, para que un
cobro real llegue a `ENVIADO`, falta `wa-bridge`.

### Hecho

- [x] Análisis de convenciones de los proyectos hermanos (segurolotengo-demo,
      WhatsApp-Modular) y decisión de replicar sus estilos y procedimientos.
- [x] Documentación de arranque completa: CLAUDE.md, docs/00–08, este ESTADO.
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
- [x] **`@mqs/baneco-satelite`** (PR #9): una pasada = vencer lo vencido y consultar
      el resto; no emite ni renueva.
- [x] **`@mqs/composicion`** (PR #11): `MODOS = mock | simulado | baneco | yape`; la
      persistencia se elige por parámetro (`db`), nunca por variable de entorno;
      mensajería honesta (falla) por defecto, `MESSAGING_PROVIDER=mock` la simula.
- [x] **`tools/demo-local`** (PR #12), **API HTTP en `functions`** (PR #13: auth
      antes que ruteo, token fijo comparado con `timingSafeEqual`, mínimo 16
      caracteres o no arranca) y **consola `demo-web`** (PR #14, React 19 + Vite 8).
      Comandos: `npm run demo`, `npm run api`, `npm run dev`. 462 tests en verde.
- [x] **WhatsAppModular verificado** (docs/04 §2 reescrito desde el código real):
      solo expone `/v1/otp/request` y `/v1/otp/verify`; `OutboundContent` admite
      `kind:'image'` como tipo de **biblioteca**, y su webhook entrante solo entiende
      `text|button|unsupported` — un comprobante en imagen se perdería.
- [x] **2026-09-11/12 — Respuestas del banco registradas** (rama
      `docs/baneco-respuestas-del-banco`, PR de esta sesión). En
      `01-preguntas-al-banco.md`: respuesta + "qué cambia" por fila, nueva sección G
      (pago a proveedores: no existe; Bec QR Connect: manuales a pedido), hallazgos
      derivados y estado de cada supuesto. La numeración C del correo del banco está
      corrida en uno (su C7 = nuestra C8). Lo esencial:
      - **A3:** las credenciales de cert del PDF son compartidas → B0 desbloqueado,
        salvo la cuenta de abono de pruebas (A4), que el banco envía.
      - **A2:** no hay simulación de pagos; se manda la imagen del QR por correo y el
        banco lo paga.
      - **B1:** JWT de 30 min. **D6:** polling desde 10 s. **D7:** fechas en hora de
        Bolivia, día anterior completo desde 00:00:01. **D8:** no hay reversiones.
        **E1:** no hay catálogo de errores. **C3:** el banco no valida la unicidad
        de `transactionId`. **C4:** no hay estado "vencido"; el QR vencido no se
        puede pagar. **D2:** el webhook puede llevar Bearer/Basic (BANECO-1 no
        cambia). **F2:** el endpoint de movimientos es `accounts/queryMovements`.
- [x] **Esquema AES confirmado sin red** (2026-09-12): el ejemplo oficial del PDF §5.1
      descifra con `crypto/aes.ts` al texto esperado (payload de 32 bytes = IV +
      un bloque). No se versiona el vector (lleva la llave de cert). El endpoint
      utilitario de cifrado que sugirió el banco **no** se usa en operación: lleva
      texto plano y llave en la query string.
- [x] **Ajustes derivados** (mismo PR): respaldo de vigencia del token 4 → 30 min
      (`auth/token.ts`); satélite con intervalo por defecto 180 → **30 s** y piso
      30 → **10 s** (`baneco-satelite/src/main.ts`); comentarios de supuestos
      convertidos en hechos (`mapeo.ts`, `aes.ts`, B0); docs/02 §4.1 con los límites
      de Baneco; README de Baneco con V1–V5 actualizados y tabla de discrepancias
      respuesta-vs-PDF; análisis §4.1, §4.4, §9 y riesgos R3 (cerrado), R8 y R9
      (nuevos).
- [x] **Tests que dependían de la fecha, arreglados** (mismo PR, commit aparte). Desde
      el 2026-09-12, 25 tests fallaban **también en `main`**: los proveedores de QR
      (`QrProviderEnMemoria`, `QrProviderBaneco`) toman `emitidoEn` del reloj real,
      mientras los tests fijan su propio "ahora" y un vencimiento fijo; al pasar esa
      fecha, el QR salía emitido después de vencer y la guarda de
      `maquina-estados.ts` lo rechazaba. Ahora cada test inyecta su reloj, y
      `qr-core` exporta `INSTANTE_DE_CONTRATO` para los casos de contrato. Regla
      para tests nuevos: **todo proveedor con reloj inyectable recibe el reloj del
      test**.

### En espera (bloqueos externos)

| Qué | Desde | Bloquea | Mientras tanto |
|---|---|---|---|
| Cuenta de abono de pruebas de Baneco (A4) | 2026-09-11 | Que B0 genere QRs (sin ella solo prueba el login) | El login y el cifrado se pueden probar ya con las credenciales compartidas del PDF. |
| Pago manual de un QR de prueba por el banco (A2) | — | Capturar un `statusQR` pagado y un `paidQR` con datos reales → reemplazar las fixtures derivadas de la espec. | Hace falta primero el modo "pago asistido" de B0 (ver Próximo paso). |
| IPs del webhook (D1) | 2026-08-27 | Solo el Hito B3 (webhook) | Se opera sin webhook. |
| Decisión del dueño sobre WhatsAppModular (docs/04 §2.3) | 2026-08-27 | `wa-bridge` — **sin él ningún cobro real pasa de `QR_ACTIVO`** | Demo con `MESSAGING_PROVIDER=mock`. |
| Capturas de la consola Yape BCP | — | Riel Yape (diferido, D1) | Sin impacto en Baneco. |

### Riesgos abiertos detectados en esta sesión

- **R8 — QR pagable en el banco después de que el cobro lo abandonó.** `dueDate` es
  un día, no un instante (C4): un QR sigue pagable hasta la medianoche boliviana de su
  `dueDate` aunque nuestro cobro esté `VENCIDO`, renovado o `ANULADO`. Hoy **ningún
  camino llama a `cancelQR`** (`vencerSiCorresponde`, `renovarYReenviar` y `anular`
  en `qr-core/src/casos-uso/cobrar.ts`). Un pago en esa ventana entra a la cuenta y el
  sistema no lo ve.
- **R9 — la conciliación diaria no corre.** `conciliarDia()` existe en `qr-core` y
  reporta abonos huérfanos, pero el satélite no la invoca. Es la red para R8 y para
  el QR duplicado posible por C3.

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
  implementado del lado de la API).
- `firebase-admin` arrastra 6 avisos moderados transitivos sin versión que los
  corrija (cadena de Google).

### Próximo paso (retomar acá)

**Dueño:**

1. Revisar y **autorizar el PR de esta sesión** (`docs/baneco-respuestas-del-banco`).
   Incluye un cambio operativo para validar: el satélite pasa a consultar cada 30 s.
2. Ubicar (o pedirle al oficial) el **usuario y la cuenta de abono de pruebas** (A4) y
   cargar el bloque `BANECO_CERT_*` en `.env` local — usuario y llave compartidos del
   PDF §1 más esa cuenta. Nunca al repo.
3. Guardar el **catálogo de bancos** que adjuntó el banco (D9) en
   `docs/Integraciones/baneco/privado-no-gh/`.
4. Revisar `.env.example`: si documenta `BANECO_POLL_INTERVAL_SECONDS` con 180,
   actualizarlo a 30 (Claude Code no tiene permiso de lectura sobre `.env.*`).
5. Decidir la opción de WhatsAppModular en docs/04 §2.3.
6. Comercial: negociar comisiones con el ejecutivo (C9) y, al acercarse producción,
   pedir la llave de producción por un canal que no sea un adjunto de correo (B3).
7. Persistir el límite de inotify (archivo en `/etc/sysctl.d/`).

**Claude Code:**

1. **PR "anular en el banco + conciliación diaria" (R8/R9)** — prioridad alta:
   - `vencerSiCorresponde`, `renovarYReenviar` (QR anterior) y `anular` llaman a
     `QrProvider.anular()`; una cancelación fallida queda en evidencia y se
     reintenta en la pasada siguiente.
   - El satélite corre `conciliarDia()` sobre el día anterior pasada la medianoche
     boliviana (D7) y al arrancar; la conciliación busca en el **historial** de QRs,
     no solo en el vigente de los pendientes.
   - **Decisión del dueño antes de codificar:** qué hacer con un abono real sobre un
     cobro `VENCIDO` o `ANULADO`. La máquina de estados no tiene esa transición;
     propuesta: `VENCIDO → EN_REVISION` (cambia el diagrama de CLAUDE.md) y, para
     `ANULADO`, solo reporte de huérfano.
2. **Hito B0:** con la cuenta de pruebas, correr `npm run baneco:b0` (primero el
   login, que confirma end-to-end B2 y resuelve V1/V4). Agregar el modo **pago
   asistido** (A2): un QR que no se anula, su PNG en `tools/baneco-b0/out/`
   (git-ignored) para mandarlo por correo, y una segunda corrida que capture el
   `statusQR` pagado y el `paidQR` como fixtures reales.
3. Barrido documental pendiente de §8.2: docs/02 §5, docs/06 amenaza T9, docs/07
   (partición de fases), docs/05.
4. `wa-bridge`, cuando el dueño decida docs/04 §2.3.

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
