# ESTADO — bitácora de avance para retomar sin perder contexto

> **Regla de uso:** este archivo se actualiza al final de cada sesión de
> trabajo y antes de cualquier pausa. Al retomar, leer esto primero.
> Nunca contiene secretos — solo estado, decisiones y próximos pasos.

**Última actualización:** 2026-09-20, sesión "contrato para consumidores" (cerró sin cuenta de pruebas del banco: decisión 21) — **bloques 1
y 2** del frente `Prompts/cobrador-contrato-para-consumidores.md`. El cobro por QR se
abre a otros productos con cuatro operaciones en `/api/v1/…` y **ninguna que confirme un
pago** (`docs/10-contrato-consumidores.md`), más el **aviso de confirmación firmado**,
que es un acelerador y no la fuente de verdad. Bloque 1: **PR #38 mergeado**. Bloque 2:
**PR #40 mergeado** (2026-09-20, con el OK del dueño en el chat).
Antes, el mismo día: **PR #36 mergeado**, la prueba en producción admite **varias
cuentas**, cada una con su alias, sus credenciales y sus datos, y la **segunda cuenta
corrió P1–P9 ok** (`02-hallazgos-produccion.md` §5). Además se cerró **C9: no hay
comisión bancaria** (decisión 17).
Antes: prueba con Baneco P1–P9 ok, hallazgos en
`docs/Integraciones/baneco/02-hallazgos-produccion.md`; el banco no tiene cuenta de pruebas,
así que B0 queda limitado al login y los ensayos se hacen en producción: decisión 21)

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
    periódica. Implementado en PR #21 y PR #24.
15. **Aceptada al autorizar #21 (2026-09-12) — `QR_ACTIVO → PAGO_DETECTADO`** (propuesto en PR
    #21 a raíz de la auditoría de seguridad): si WhatsApp entrega el QR pero reporta
    una falla, el cliente puede pagar un cobro que nunca pasó a `ENVIADO`. Manda el
    banco, no nuestro registro del envío (regla #1). Autorizar #21 es aceptar este
    cambio al diagrama de CLAUDE.md.
16. **Prueba controlada en producción (2026-09-12):** como el banco no simula pagos
    (A2), el ciclo completo se valida en producción con plata propia desde cuentas
    internas: QRs de Bs 1, hasta 10 por corrida, datos en el emulador local,
    credenciales en `~/.manejoqr/baneco-<cuenta>.env` (600, fuera del repo; Claude Code no
    las lee). No es el pase a producción. Guía:
    `docs/Integraciones/baneco/03-prueba-en-produccion.md`.
    **Ampliada el 2026-09-14:** es un procedimiento que se **repite completo (P1–P9)**
    cada vez que se abre una cuenta de cobro nueva en el banco o se registra otro
    banco como proveedor. Primera corrida: 2026-09-13/14 con Baneco, P1–P9 ok.
    **Ampliada el 2026-09-16:** cada cuenta de cobro tiene un **alias** (`prod` la
    primera) y, con él, su archivo de credenciales, su emulador y sus imágenes de QR.
    Se corre con `CUENTA=<alias>` en el emulador, la API y el satélite; el alias se ve
    en la consola y encabeza el informe.
17. **Comisiones (C9) — respondida por el dueño el 2026-09-17:** el **cobro por QR
    Simple no tiene comisión bancaria**; el servicio del banco es gratuito. El dato
    quedó registrado ese día en el registro de proyectos
    (`~/Claude-Proyectos/proyectos/manejoqrsimple.md`) desde otra sesión, y se trae acá
    al cerrar la del 2026-09-19. Consecuencia técnica: **el monto acreditado es el del
    QR**, así que la conciliación por monto exacto no necesita tolerancia por comisión
    — que era justo el riesgo que C9 dejaba abierto. Si alguna vez el banco cobrara
    una, habría que revisar la conciliación antes de producción.

18. **El cobro se abre a proyectos consumidores (2026-09-19, ADR-008).** Otro producto
    —NovuChat es el primero— pide un cobro por `/api/v1/…` sin conocer nada del banco.
    El contrato tiene **cuatro operaciones y ninguna confirma un pago**: esa ausencia
    es el contrato, y es la regla #1 aplicada a un tercero. El consumidor tampoco manda
    datos personales (su referencia externa es opaca) ni recibe el envío al pagador,
    que es suyo. Detalle en `docs/10-contrato-consumidores.md`; la decisión de hacerlo
    una superficie de la API y no un paquete, en `docs/01-arquitectura.md` ADR-008.

19. **El aviso de confirmación al consumidor (2026-09-20, ADR-009).** Cuando un cobro
    de un consumidor queda `CONFIRMADO`, se le avisa por HTTP, **firmado con HMAC-SHA256
    sobre el cuerpo crudo** y con la marca de tiempo dentro de la firma. Dos decisiones
    que valen para cualquier cosa parecida que se agregue después:
    - **Encolar dentro de la transición, entregar afuera.** Un consumidor caído no
      puede demorar ni hacer fracasar un cobro.
    - **El orden es al revés de lo intuitivo:** el aviso se encola *después* de que el
      estado quedó guardado. Perder un aviso es tolerable —`estadoCobro` lleva al mismo
      resultado, y el contrato lo dice— pero avisar un pago que no llegó a registrarse
      haría que el consumidor entregue lo que vendió.
    Es opcional por consumidor: sin URL y secreto configurados, no se manda nada y el
    contrato funciona igual.
20. **El texto EMV del QR no es una pregunta abierta (Andres, 2026-09-20).** Se había
    anotado como límite a consultar al banco. No corresponde: **pagar un QR Simple no
    depende del banco que lo generó** —es un protocolo interoperable, y está probado
    pagando desde el BNB un QR de Baneco (P3)— y **generar el QR es la capa comercial
    del banco originador**, el que tiene la cuenta destino. Ningún sistema le va a pedir
    la cadena EMV a un consumidor para armar un QR. El contrato entrega la imagen y con
    eso alcanza; `docs/10` §6 quedó reescrita.
21. **El banco no tiene cuenta de pruebas (Andres, 2026-09-20).** Baneco no entrega una
    cuenta de abono para certificación, así que **A4 queda cerrada sin cuenta** y no
    bloquea nada. Como la integración ya opera en producción, los ensayos se hacen
    ahí con **pagos internos de monto mínimo**, que es el procedimiento de la decisión
    16. Consecuencias:
    - El B0 en certificación (`tools/baneco-b0`) queda **sin uso para generar ni pagar
      QRs**: solo sirve para el login y el cifrado. No se borra.
    - Los ensayos pendientes de los bloques 1 y 2 del contrato se corren en la próxima
      prueba en producción, pagando el QR con monto mínimo desde una cuenta propia.
      Tiene que ser **el pago del QR**, no una transferencia suelta a la cuenta: una
      transferencia sin QR no aparece en `statusQR` y a lo sumo termina como abono sin
      conciliar en el cierre diario.
    - Las **fixtures reales** de `baneco-gateway` ya no pueden venir de certificación.
      Tienen que salir de la prueba en producción, y hoy los logs no guardan cuerpos a
      propósito: hace falta una captura saneada en ese modo (pendiente de Claude Code).
    - El bloque 4 (pase a producción) ya no espera al banco: queda el checklist del
      estándar DevSecOps y la aprobación del dueño.

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
- [x] **2026-09-12 — Ventana de pago del QR cerrada (PR #21, mergeado).** Rama
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
- [x] **2026-09-12 — Consola de revisión manual (PR #24, mergeado).**
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
- [x] **2026-09-12 — Herramientas de la prueba en producción (PR #25, mergeado).** Barrera de producción compartida
      (`composicion/src/produccion.ts`); modo prueba de la API con topes de monto y
      cantidad (`functions/src/modo-prueba.ts`); imagen del QR guardada fuera del repo
      (`functions/src/imagenes.ts`, adaptador con `AlmacenImagenQr`); endpoints
      `/api/pruebas`, `/api/pruebas/qr`, `/api/pruebas/cerrar`, `/api/cobros/:id/qr` y
      `/api/cobros/:id/sondear-anulacion`; errores con detalle técnico (tipo y
      `responseCode`); pestaña **Pruebas** en la consola con QR para escanear,
      seguimiento del pago, diagnóstico y el checklist de las nueve pruebas con informe;
      scripts `prueba:*`. Pestaña **Logs** (pedidos a la API que escriben o fallan, y
      toda llamada al banco con ruta, HTTP, `responseCode` y demora; sin cuerpos ni
      secretos). Auditoría de seguridad: el cupo cubre también el formulario común y
      "renovar" (vigencia topeada en 24 h), la corrida se retoma del emulador al
      reiniciar la API, y el cierre recorre todos los cobros abiertos. Verificado en
      vivo con el banco simulado (QR, "Ya pagué", `CONFIRMADO`, revisión por pago
      tardío, logs); la consola usa la hora del servidor (el navegador integrado
      mostró un reloj desfasado).
- [x] **2026-09-12 — Pedido de la contraseña del usuario API (PR #26, mergeado).**
      Ningún documento del banco explica cómo se obtiene: pedido H1 en
      `01-preguntas-al-banco.md` §H, con el procedimiento y el borrador del correo (que
      pide también el catálogo de bancos y el usuario de pruebas).
- [x] **2026-09-12 — Abonos sin conciliar persistidos (PR #27, mergeado).**
      Los pagos que el cierre diario no ata a ningún cobro (huérfanos y sin corroborar)
      ya no quedan solo en el log del satélite:
      - Puerto nuevo `AbonosSinConciliarStore` (`registrar` idempotente por clave del
        banco, `listarAbiertos`, `cerrar` una sola vez; sin `borrar`), con adaptador en
        memoria y en Firestore (`abonosSinConciliar/{clave codificada}`, `create()` y
        cierre en transacción) y casos de contrato compartidos.
      - `conciliarDia` exige el almacén (`DepsCierre`) y guarda cada abono **antes** de
        reportarlo; si no puede guardarlo, el abono va a `conError` y el día no cierra.
      - La cola de revisión los suma (umbrales "con abono", desde que los encontró el
        cierre) y las alertas los cuentan. `POST /api/abonos/:id/cerrar` con motivo
        (≥ 10 caracteres). Cerrar no toca ningún cobro.
      - Consola: sección "Pagos sin cobro que los explique" en la pestaña Revisión.
        Guía: `docs/09-revision-manual.md` §4 ("Pago sin cobro").
- [x] **2026-09-13 — Barrido documental del análisis Baneco §8.2 (PR #28, mergeado).**
      docs/02 §5, docs/05 (D2/D3 y entornos), docs/06 (T9–T11, secretos de Baneco),
      docs/07 (Fase 3 bifurcada por proveedor). Solo queda `.env.example`, del dueño.
- [x] **2026-09-13 — El cierre avisa solo por abonos nuevos (PR #29, mergeado).**
      `AbonosSinConciliarStore.registrar` devuelve si lo guardó ahora;
      `ResumenConciliacionDiaria.nuevosParaRevisar`; el satélite ya no repite el aviso
      de abonos ya guardados o cerrados.
- [x] **2026-09-13 — B0: modo pago asistido (PR #30, mergeado).** Tres modos nuevos de
      `npm run baneco:b0`:
      - `--pago-asistido`: un QR de 1 BOB, 4 días, que no se anula.
      - `--capturar-pago`: fixtures `statusQR-pagado` y `paidQR-con-pago`, más el sondeo
        de anular un QR pagado.
      - `--anular-pendiente`: lo anula si nunca se pagó.

      Pasó cuatro rondas de auditoría de seguridad:
      - Dentro de los pagos solo pasan campos permitidos.
      - Lista blanca del sobre de `paidQR`: ante una forma inesperada no se escribe y
        sale con código 4.
      - La verificación final usa también los datos del pagador.
      - Reserva atómica del estado antes de emitir; solo un rechazo explícito del banco
        la libera.
      - Barrera por host exacto de certificación y https.

      No se corrió contra el banco: esperaba la cuenta de pruebas (A4), que el banco no tiene (decisión 21).
- [x] **2026-09-14 — Logs persistentes (PR #33, mergeado).** Pedido del dueño
      durante la prueba en producción: un `responseCode` o la línea del cierre diario se
      perdían al reiniciar la API o al cerrar la terminal del satélite.
      - `composicion/src/bitacora.ts`: un archivo JSONL por proceso y por día de Bolivia en
        `~/.manejoqr/logs/` (700/600, `BITACORA_DIR` para cambiarlo), saneado al escribir
        y al leer.
      - La API carga lo guardado al arrancar; la pestaña Logs suma el origen "satélite"
        (arranque, cierres, errores, pasadas con novedades y sus llamadas al banco) y
        muestra la fecha de cada línea.

      Mergeado como PR #33; la corrección de la doble anulación y los hallazgos de la
      prueba, como PR #34; el refresco de la tarjeta en `PAGO_DETECTADO`, como PR #32.
- [x] **2026-09-16/19 — Varias cuentas de cobro en la prueba (PR #36, mergeado).** El dueño consiguió credenciales de una segunda
      cuenta en Banco Económico, y la prueba P1–P9 se repite por cada cuenta (decisión 16).
      - Cada cuenta tiene un **alias** (`prod` la primera) y, con él, su archivo de
        credenciales `~/.manejoqr/baneco-<alias>.env`, su emulador `emulador-<alias>` y sus
        imágenes `qrs/<alias>/`. Se elige con `CUENTA=<alias>` en `prueba:emulador`,
        `prueba:api` y `prueba:satelite`.
      - `npm run prueba:cuenta -- <alias>` (nuevo, `tools/cuentas`) crea el archivo con la
        plantilla y permisos 600 y dice qué variables faltan **por nombre**; los valores
        los escribe el dueño en su editor. `--revisar` vuelve a decir qué falta;
        `--listar`, qué cuentas hay preparadas.
      - Barrera nueva: el emulador queda marcado con el alias de la cuenta
        (`configuracion/cuentaDePrueba`, solo el rótulo — ningún dato bancario) y un
        proceso con otro alias no arranca. Evita mirar los QRs de una cuenta con las
        credenciales de otra.
      - El alias se ve en la pestaña Pruebas, en el arranque de la API y del satélite, en
        la bitácora (que sigue siendo una sola) y en el título del informe.
      - La carpeta por defecto del emulador pasó de `emulador-prueba` a `emulador-prod`:
        la vieja, si todavía está, ya no se usa y se puede borrar.
      - **La URL del API Gateway de producción es del banco, no de cada usuario API**
        (dato del dueño, 2026-09-18): `https://apimkt.baneco.com.bo/apiGateway`. Quedó
        como `URL_PRODUCCION` en `baneco-gateway/src/config.ts` y ya no se declara en el
        archivo de cada cuenta; `BANECO_PROD_BASE_URL` sigue mandando si el banco la
        mueve. En certificación la URL sigue siendo obligatoria (casing `ApiGateway`, V1).
      - Un marcador `<…>` sin reemplazar cuenta como variable faltante: probar el login
        con el texto de la plantilla sería un intento fallido, y el usuario API se
        bloquea con intentos fallidos (B4).
      - **Estrenado el 2026-09-18/19 con la cuenta `cuenta-2`: P1–P9 ok**, sin hallazgos
        nuevos del banco. Confirmaciones en 18, 24, 33 y 122 s desde la emisión del QR
        (la primera corrida: 41–66 s). Informe en `02-hallazgos-produccion.md` §5.
- [x] **2026-09-19/20 — Contrato para proyectos consumidores, bloque 1 (PR #38,
      mergeado).** Frente nuevo, con su prompt en
      `Prompts/cobrador-contrato-para-consumidores.md` (lo escribió la sesión de
      NovuChat y se trajo acá).
      - `POST /api/v1/cobros`, `GET /api/v1/cobros/:id`,
        `GET /api/v1/cobros/por-referencia/:ref`, `POST /api/v1/cobros/:id/anular`,
        `GET /api/v1/cobros` (rango) y `GET /api/v1/cobros/:id/qr`.
      - **Idempotencia por referencia externa**: el id del cobro se deriva de
        `(consumidorId, referenciaExterna)` con SHA-256 y la creación es atómica
        (`CobroRepository.crear`, `create()` de Firestore). Dos pedidos iguales
        devuelven el mismo cobro y **un solo QR**; la misma referencia con otro importe
        se rechaza.
      - **`emitirQr()` ahora anula el QR que el cobro no llegó a adoptar** cuando la
        transición falla. Corrige un caso real de la amenaza T10 que también existía en
        la consola: el perdedor de una carrera dejaba un QR pagable hasta la medianoche
        (C4) que ningún cobro miraba.
      - Identidad tipada (`dueño | consumidor`): un token de consumidor no abre ninguna
        ruta del dueño ni ve el cobro de otro; el cruce responde **404, no 403**.
        Un token por consumidor en `CONSUMIDOR_TOKEN_<ID>`, mínimo 32 caracteres, y un
        token corto o sin llenar **corta el arranque**.
      - Los topes de la prueba en producción (monto y cupo de QRs) alcanzan también al
        contrato: no es una puerta de atrás a la barrera T11.
      - `Cobro` admite `telefonoCliente: null` y suma `consumidor`. Amenazas T12–T14 en
        `docs/06-seguridad.md`.
      - Pasó **dos revisiones antes de publicarse** (auditoría de seguridad y
        revisión de código), y las dos encontraron cosas que se corrigieron:
        - **Bloqueante:** el token de un consumidor igual al del dueño resolvía
          como **dueño** y abría la consola entera. Los dos viven en el mismo
          archivo y la plantilla los emite adyacentes, así que es un desliz de
          una rotación. Ahora la API no arranca con tokens repetidos y
          `combinarVerificadores` falla cerrado ante la ambigüedad.
        - **Grave:** la anulación compensatoria de `emitirQr()` podía matar un
          QR que el cobro **sí** había adoptado — hay caminos donde el guardado
          falla con el estado ya escrito. Ahora relee antes de anular, y
          `guardar()` escribe estado e historial en la **misma transacción**,
          con lo que ese camino deja de existir.
        - El separador del id era un byte nulo **crudo**: git veía como binario
          el archivo más delicado del PR. Ahora va como `\u0000` y hay un
          vector fijo que rompe el CI si la derivación cambia.
        - Una anulación pedida por el contrato firmaba la evidencia como
          `accion-manual`, igual que una del dueño. Origen nuevo
          `contrato-consumidor`, y el motivo lleva el id del consumidor puesto
          por el servidor.
        - El contrato le devolvía al consumidor el detalle técnico del banco
          (`generateQR`, su `responseCode`). Se descarta en esa superficie.
        - La referencia externa viajaba en la ruta y llegaba a la bitácora en
          disco; el enmascarado no cubre un celular sin prefijo (8 dígitos).
          Ahora ese segmento se registra como `***`.
        - **Cupo por consumidor y por hora** (`CONSUMIDOR_MAX_QRS_POR_HORA`, 60
          por defecto): con un token filtrado, un bucle de emisión dejaba
          cientos de QRs pagables hasta la medianoche (T10 a escala). Vive en
          memoria del proceso — alcanza para la API local, y al desplegarla hay
          que pasarlo a un contador compartido.
        - Se quitó `buscarPorReferenciaExterna` del puerto: el id **se deriva**
          de la referencia, así que `obtener()` es la respuesta exacta. Un
          método, un índice y dos casos de contrato menos, y una fuente de
          divergencia menos.
      - 880 tests (67 nuevos), typecheck, lint, `deps:check` y build en verde.
        **Sin ensayo contra el banco todavía** — ver "Próximo paso".
- [x] **2026-09-20 — Bloque 2: el aviso de confirmación (PR #40, mergeado el
      2026-09-20 con el OK del dueño en el chat; CI en verde).** Cuando un cobro de un consumidor queda
      `CONFIRMADO`, se le avisa (ADR-009, decisión 19).
      - Paquete nuevo **`@mqs/avisos-consumidor`**: arma el cuerpo, lo firma con
        HMAC-SHA256 sobre el cuerpo crudo y lo entrega por HTTPS. Es el único que sabe
        que el aviso va por HTTP; el dominio ve el puerto `NotificadorConsumidor`.
      - Puerto y almacén `AvisosStore` (bandeja de salida, `avisosConsumidor/{cobroId}`
        en Firestore) con sus casos de contrato compartidos. La clave es el `cobroId`:
        un cobro avisa una vez, y reintentar la confirmación no genera otro aviso.
      - `aplicar()` encola el aviso **después** de guardar el estado, y si la cola falla
        el cobro igual queda confirmado: el aviso no puede hacer fracasar un pago.
      - El satélite lo entrega en cada pasada, con espera creciente (30 s → 1 día) y
        **sin tope de intentos**: un aviso no se abandona en silencio.
      - Dos variables por consumidor, opcionales y las dos o ninguna:
        `CONSUMIDOR_AVISO_URL_<ID>` (https obligatorio) y
        `CONSUMIDOR_AVISO_SECRETO_<ID>` (≥ 32 caracteres). Mal configuradas, la API y el
        satélite no arrancan.
      - Amenaza T15 en `docs/06`: el aviso falsificado es T9 en la dirección opuesta.
      - 929 tests (49 nuevos), typecheck, lint, `deps:check` y build en verde.

### En espera (bloqueos externos)

| Qué | Desde | Bloquea | Mientras tanto |
|---|---|---|---|
| ~~Contraseña del usuario API de producción (pedido H1)~~ | 2026-09-12 | — | **Resuelto el 2026-09-13:** el dueño la obtuvo y la prueba en producción corrió P1–P9 ok. |
| ~~Cuenta de abono de pruebas de Baneco (A4)~~ | 2026-09-11 | — | **Cerrada el 2026-09-20:** el banco no tiene cuenta de pruebas (decisión 21). Se ensaya en producción con montos mínimos. |
| Catálogo de bancos (D9) | 2026-09-12 | Nada (deseable) | El banco dijo adjuntarlo y no llegó: pedirlo de nuevo. |
| ~~Pago manual de un QR de prueba por el banco (A2)~~ | — | — | **Reemplazado el 2026-09-20** por pagos propios de monto mínimo en producción (decisión 21). Las fixtures reales salen de ahí. |
| IPs del webhook (D1) | 2026-08-27 | Solo el Hito B3 (webhook) | Se opera sin webhook. |
| Decisión del dueño sobre WhatsAppModular (docs/04 §2.3) | 2026-08-27 | `wa-bridge` — **sin él ningún cobro real pasa de `QR_ACTIVO`** | Demo con `MESSAGING_PROVIDER=mock`. |
| Capturas de la consola Yape BCP | — | Riel Yape (diferido, D1) | Sin impacto en Baneco. |

### Riesgos abiertos

- **R8 y R9 mitigados en PR #21** (ver `00-analisis-modulo-baneco.md` §10). Queda la
  carrera de segundos entre la última consulta y la anulación, que cubre el cierre
  diario.
- ~~Los abonos huérfanos y sin corroborar solo van al log del satélite~~ — resuelto en
  el PR #27: se guardan y aparecen en la pestaña Revisión. Queda un
  límite deliberado: un pago sin cobro se **cierra** con motivo, no se asigna a un cobro
  (`docs/09-revision-manual.md` §5).
- ~~**Doble anulación (B2 de la auditoría)**~~ — **resuelto con evidencia real:** en
  producción, `cancelQR` sobre un QR ya anulado devuelve `responseCode 403`, el mismo
  código que sobre uno pagado. El adaptador consulta `statusQR` ante ese rechazo y solo lo
  trata como éxito si el QR figura anulado (`02-hallazgos-produccion.md` §3.1).
- **Operaciones simultáneas sobre un mismo caso en revisión** (B1 de la auditoría de
  la consola): dos pestañas, un doble clic o una búsqueda durante el cierre diario
  pueden dejar un registro de más en la evidencia (detección repetida o resolución no
  aplicada). Nunca un doble `CONFIRMADO`, porque el estado se escribe con
  precondición. Cerrarlo del todo exige ids de evidencia deterministas para los
  eventos con detección, y evidencia y estado en la misma transacción.
- **Las alertas de revisión viven en la consola abierta.** Con la consola cerrada
  nadie avisa. El paso natural, cuando exista `wa-bridge`, es avisar al dueño por
  WhatsApp los casos críticos.

- **El cupo de QRs por consumidor vive en memoria del proceso** (`api/cupo-consumidor.ts`).
  Reiniciar la API lo pone en cero y, con más de una instancia, cada una tendría el
  suyo. Hoy la API es un proceso local y alcanza; al desplegarla en serio hay que
  pasarlo a un contador compartido.

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

**Dueño — prueba en producción** (guía: `docs/Integraciones/baneco/03-prueba-en-produccion.md`):

0. ~~Conseguir la contraseña y hacer la prueba en producción~~ — **hecho el 2026-09-13/14,
   P1–P9 ok**. Cuando ya no hagan falta, borrar `~/.manejoqr/emulador-prueba` y
   `~/.manejoqr/qrs`; conservar `~/.manejoqr/logs/`. La prueba se repite completa con cada
   cuenta de cobro nueva o banco nuevo (decisión 16).
0bis. ~~Segunda cuenta de cobro~~ — **hecha el 2026-09-18/19, P1–P9 ok** (alias
   `cuenta-2`; informe en `02-hallazgos-produccion.md` §5). Cuatro pagos reales
   conciliados, cierre diario `yaRegistrados=4 huerfanos=0`, ningún QR cobrable suelto y
   ningún hallazgo nuevo del banco. Cuando ya no hagan falta, borrar
   `~/.manejoqr/emulador-cuenta-2` y `~/.manejoqr/qrs/cuenta-2`.
1. Pedirle al oficial el catálogo de bancos (D9). ~~La cuenta de pruebas (A4)~~ — no
   existe (decisión 21). ~~Confirmar las comisiones (C9)~~ —
   respondida (decisión 17).

**Dueño — lo demás:**

1. ~~Autorizar #21, #24 y #25~~ — mergeados el 2026-09-12.
2. Cuando llegue el catálogo de bancos (D9), guardarlo en `privado-no-gh/`. Si
   interesa, pedir los manuales de **Bec QR Connect** (G2). ~~Correr el B0 con la
   cuenta de pruebas~~ — sin cuenta de pruebas, el B0 no genera ni paga QRs
   (decisión 21).
3. ~~Revisar `.env.example`~~ — **hecho el 2026-09-19/20**, con autorización del dueño
   en el chat: Claude Code no tiene permiso sobre `.env.*`, así que lo hizo un script
   que solo informó qué cambió, nunca qué decía el archivo.
   `BANECO_POLL_INTERVAL_SECONDS` pasó de 180 a 30 y se documentó
   `CONSUMIDOR_TOKEN_<ID>`. **Queda pendiente** sumar `CONSUMIDOR_AVISO_URL_<ID>` y
   `CONSUMIDOR_AVISO_SECRETO_<ID>` del bloque 2: el script está listo y espera el «sí»
   del dueño. La plantilla de `npm run prueba:cuenta` ya los documenta.
4. Decidir la opción de WhatsAppModular en docs/04 §2.3.
5. Comercial: al acercarse producción, pedir la llave de producción por un canal que no
   sea un adjunto de correo (B3). Las comisiones (C9) ya están respondidas: no hay.
6. Adoptar la rutina de `docs/09-revision-manual.md` §3: una revisión diaria de la
   pestaña Revisión.
7. Persistir el límite de inotify (archivo en `/etc/sysctl.d/`).

**Claude Code:**

1. ~~Documentar la prueba en producción y ajustar el adaptador~~ — hecho
   (`02-hallazgos-produccion.md`; `cancelQR` 403 → consulta de `statusQR`). Quedan las
   fixtures reales saneadas. Sin cuenta de pruebas (decisión 21) tienen que salir de la
   prueba en producción, y los logs no guardan cuerpos a propósito: falta una captura
   saneada en ese modo, con la misma barrera anti-secretos del B0.
2. ~~**Hito B0** en certificación~~ — sin cuenta de pruebas (decisión 21) se reemplaza
   por la captura saneada del punto 1. Con ella: reemplazar las fixtures derivadas de la
   espec. y ajustar el adaptador a los `responseCode` observados (anular un QR pagado).
3. ~~Persistir los abonos huérfanos y sin corroborar~~ — hecho en el PR #27.
4. ~~Barrido documental pendiente de §8.2~~ — hecho (docs/02 §5, docs/05 §1 y §5,
   docs/06 T9–T11 y secretos, docs/07 Fase 3). Solo queda `.env.example`, del dueño.
5. `wa-bridge`, cuando el dueño decida docs/04 §2.3; con él, aviso de casos
   críticos por WhatsApp.
6. **Contrato para consumidores** (`Prompts/cobrador-contrato-para-consumidores.md`):
   1. Bloque 1 — **mergeado** (PR #38, 2026-09-20). Falta su ensayo con un cobro real
      de monto mínimo pagado desde otro banco, que se corre en la próxima prueba en
      producción: es lo único del bloque que queda pendiente.
   2. Bloque 2 — **mergeado** (PR #40, 2026-09-20). Falta probarlo de
      punta a punta contra un consumidor real: hoy está cubierto por tests, sin ningún
      destino configurado todavía.
   3. Bloque 3 — una cuenta de cobro por consumidor. Hoy cada cuenta es un **proceso**
      con su alias (decisión 16); falta que un consumidor solo use la suya y que los
      cobros queden atribuidos por cuenta para el cierre diario.
   4. Bloque 4 — pase a producción: checklist del estándar DevSecOps. Ya no espera
      una cuenta de pruebas, que el banco no tiene (decisión 21). Lo aprueba el dueño.
   Los ensayos de los bloques 1 y 2 se corren en la próxima prueba en producción,
   **pagando el QR** con monto mínimo desde una cuenta propia (decisión 21).

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
