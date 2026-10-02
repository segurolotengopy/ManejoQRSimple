# ESTADO — bitácora de avance para retomar sin perder contexto

> **Regla de uso:** este archivo se actualiza al final de cada sesión de
> trabajo y antes de cualquier pausa. Al retomar, leer esto primero.
> Nunca contiene secretos — solo estado, decisiones y próximos pasos.

**Última actualización:** 2026-10-01, sesión «bloque 4: el pase a producción». **Empezó con un
análisis y un acta, no con un pase, y la conclusión es que no procede todavía** (decisión 25). Hoy
no existe una arquitectura de producción: el sistema corre a mano en la máquina del dueño, sin
dónde desplegar ni staging, y de los 56 controles bloqueantes del checklist del estándar hay 18 en
verde, 26 en rojo, 2 sin verificar y 10 que no aplican (`docs/produccion/acta-v0.1.0.md`). El
análisis de brechas, las opciones de despliegue y el plan por bloques están en
`docs/11-produccion-brechas-y-plan.md`. **Lo que sigue necesita decisiones del dueño, sobre todo
qué significa «producción» (D1) y cómo se despliega (D2).**

Antes, el mismo día, sesión «bloque 3: una cuenta de cobro por consumidor». Cada consumidor de
`/api/v1` queda atado a **una** cuenta de cobro, y cada cobro y cada abono sin conciliar guardan la
suya (decisión 24, ADR-010). **PR #70 y #71 mergeados**: 1000 pruebas y 80 del emulador en verde,
revisión de código y tres auditorías de seguridad, la última sin hallazgos. Antes de arrancar la API
con él hay una decisión del dueño sobre los datos ya guardados (D-A, abajo); el consumidor de ensayo
ya tiene su línea de cuenta y su certificado.

Antes, el mismo día, sesión «prueba intermitente de AES». El test de
`descifrar()` con otra llave fallaba una de cada ~250 corridas; se hizo determinista con un
vector fijo, **PR #67 mergeado** (squash `fe4cf62`), y no se tocó `aes.ts` (decisión 23).

Antes, el mismo día, sesión «adopción del estándar DevSecOps v2». Después de
adoptarlo se **actualizó a la versión 2.8** (reusable 2.8, `gitleaks.toml` 2.2 y pre-commit 2.1,
commit `0bf9b9d` de SeguridadGeneral), en un PR propio. Lo que sigue describe la adopción.
El repositorio quedó en el estándar de SeguridadGeneral, **stack `solo-ci`, reusable 2.7**
(commit `0ab6e88` de SeguridadGeneral), con **PRs #54, #55 y #56** mergeados; el run que lo
prueba es el 36890902794, CI verde en `main`, head `d0cdc6e`. Antes se resolvieron los
**diez PRs de Dependabot**: #42 se fusionó tal cual y los otros nueve se reemplazaron por
tres PRs propios, #48, #52 y #53, que juntan los que se pisaban en el `package-lock.json`.
`npm audit` quedó en cero. Después aparecieron siete PRs más de Dependabot, sobre las acciones
del reusable: se fusionaron #57, #58, #59, #61 y #63, #65 reemplazó a #62 y #60 se cerró solo
al fusionar #61. **El ruleset de `main` se cambió el 2026-10-01** a las 14:21 de Bolivia, con
el OK del dueño en el chat: exige `compuerta-pr` y una aprobación (decisión 22).

Antes, el 2026-09-20, sesión «contrato para consumidores»: bloques 1 y 2 del frente
`Prompts/cobrador-contrato-para-consumidores.md`, **mergeados y ensayados contra el banco
real** (PR #38 y #40; `02-hallazgos-produccion.md` §6). El cobro por QR se abre a otros
productos con cuatro operaciones en `/api/v1/…` y **ninguna que confirme un pago**
(`docs/10-contrato-consumidores.md`), más el **aviso de confirmación firmado**, que es un
acelerador y no la fuente de verdad. El banco no tiene cuenta de pruebas, así que B0 queda
limitado al login y los ensayos se hacen en producción (decisión 21).
Antes, el mismo día: **PR #36**, la prueba en producción admite **varias cuentas**, cada una
con su alias, y la **segunda cuenta corrió P1–P9 ok** (`02-hallazgos-produccion.md` §5).
Además se cerró **C9: no hay comisión bancaria** (decisión 17).

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
     producción — la que circuló no sería la definitiva. **Superado el 2026-10-02: el banco
     no va a dar otra; la que circuló es la de producción.** Ver la decisión 26.)*
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
22. **Adopción del estándar DevSecOps v2 (Andres, 2026-10-01).** El repositorio sigue el
    estándar de SeguridadGeneral con el stack `solo-ci`: no despliega, y su calidad de
    TypeScript es el job `verify` de `ci.yml`, propio. Lo que se decidió:
    - **`ci-solo-ci.yml` no se copia:** su calidad es de Python. Se agregaron a `ci.yml` solo
      los jobs que faltaban, `seguridad-estatica`, `actionlint y ShellCheck` y `compuerta-pr`.
    - **El job `gitleaks` propio se conserva** junto al del estándar. Hasta la 2.1 la
      allowlist del estándar excluía todos los `docs/**/*.md`; desde la 2.8 los analiza con las
      reglas de proveedor y exime solo `generic-api-key`. Aquí los informes de la prueba en
      producción viven en `docs/`, y un token sin formato de proveedor reconocible es justo lo
      que esa regla exenta detectaría: el job propio, con su `.gitleaks.toml` y todas las
      reglas por defecto, los sigue escaneando. Las cuatro reglas propias (credencial bancaria, `storageState`, token de
      WhatsAppModular y secreto HMAC) también viven ahora en `.github/gitleaks.toml`, que es
      lo único que lee el reusable.
    - **Las excepciones viven solo en `.devsecops.yml`:** hoy no hay ninguna.
    - **Dependabot con `cooldown`** de 7 días, sin retrasar las de seguridad (#56).
    - **El ruleset de `main` pasa a exigir `compuerta-pr` y una aprobación de un code
      owner, con solo squash, hilos resueltos y rama al día.** Aplicado el 2026-10-01 con el OK
      del dueño, sobre el ruleset existente `main-protegida` (mismo id, sin bypass). Hace
      falta una segunda cuenta: los PRs los abre `AndresAlberdi` y los aprueba
      `segurolotengopy`, que Claude Code opera con `GH_CONFIG_DIR=$HOME/.config/gh-pro` y el
      OK del dueño en el chat, PR por PR. Reversible con una sola llamada `PUT` del ruleset
      anterior, que tenía cero aprobaciones y exigía `Lint · Types · Tests · Build` y
      `Secretos en el historial`.
23. **El esquema AES no se toca, y su resultado no es prueba de nada (Andres, 2026-10-01).**
    `aes.ts` hace AES-256-CBC con relleno PKCS#7 y **sin autenticación**, porque así lo
    dicta el banco. Consecuencia: descifrar con una llave equivocada **no siempre falla**,
    porque el relleno valida por azar con probabilidad ≈ 1/256 y entrega texto basura como
    `ok: true`. Se decidió corregir el test que lo daba por garantizado y **no** cambiar
    la función ni el esquema. Regla para lo que venga: quien llame a `descifrar()` valida
    la **estructura** del resultado con Zod (regla 11) y nunca toma «descifró» como
    «era la llave correcta». Hoy los únicos llamadores fuera de `aes.ts` son dos tests de
    `adaptadores.test.ts`, con la llave correcta: nada en producción confía en lo contrario.
24. **Una cuenta de cobro por consumidor (Andres, 2026-10-01, bloque 3, ADR-010).** Se mantiene un
    proceso por cuenta (decisión 16) y el vínculo pasa a ser explícito y persistido:
    - `CONSUMIDOR_CUENTA_<ID>=<alias>` va junto al token, en el archivo de la cuenta. **La API no
      arranca** si falta, si no es un alias válido, si es el de otra cuenta, o si hay una cuenta
      sin token. No hay cuenta por defecto para un consumidor.
    - **La cuenta sale de la identidad, nunca del pedido.** Lo ajeno responde 404, también un
      cobro del mismo consumidor en otra cuenta. El consumidor no ve el alias.
    - `Cobro.cuentaCobro` y `AbonoSinConciliar.cuentaCobro` guardan el **alias**, que empieza con
      letra y por eso no puede ser un número de cuenta. No se renombra mientras existan cobros con él.
    - **El cierre diario no concilia lo de otra cuenta:** un abono cuyo QR es de un cobro de otra
      cuenta va a revisión manual, y se resuelve antes de `verificarPago`.
    - **La API y el satélite se niegan a arrancar si queda un documento sin cuenta o con una
      inválida, o un cobro pendiente de otra cuenta.** Es la defensa contra T10: sin ella, un cobro
      pendiente sin cuenta queda fuera de la consulta por cuenta y el satélite dejaría de vigilar
      un QR todavía pagable, sin ningún error.
    - **La marca del emulador no se crea sobre datos sin cuenta.** Si el emulador no tiene marca y ya
      contiene cobros o abonos sin cuenta válida, el arranque aborta sin crear la marca ni escribir
      nada: una marca puesta por el mismo arranque no dice de quién son los datos, y si se creara, el
      siguiente arranque, o el otro proceso que arranca casi a la vez, atribuiría todo en silencio.
      Lo encontraron dos pasadas de auditoría independientes. **Atribuir es una acción explícita del
      dueño:** arrancar una vez con `ATRIBUIR_DATOS_ANTERIORES_A=<alias>`, igual a la cuenta del
      proceso. Una marca que ya existía y coincide con la cuenta sí permite atribuir.
    Supuestos asumidos, a la espera de la confirmación del dueño: **D-B** una cuenta puede atender
    a varios consumidores y a la consola del dueño; **D-C** el alias es la identidad persistida;
    **D-D** una API o un satélite para varias cuentas se pospone al bloque 4; **D-F** la cuenta
    nunca es entrada del contrato, aunque la tabla del prompt la listaba, y se corrigió `docs/01` §7.
    **D-A queda abierta:** qué hacer con los datos ya guardados en los emuladores (ver «Próximo paso»).
25. **El bloque 4 empieza por un análisis y un acta, y el pase no procede todavía (2026-10-01).** El
    bloque 4 estaba definido como «recorrer el checklist del estándar», pero ese checklist supone
    una aplicación desplegada, y este proyecto no tiene dónde desplegar. Lo que se hizo fue:
    - **Un acta de preparación** (`docs/produccion/acta-v0.1.0.md`) con los 56 controles bloqueantes
      aplicables y su evidencia: 18 en verde, 26 en rojo, 2 sin verificar y 10 N/A. La sección de
      nube no aplica porque el manifiesto declara `proveedor: ninguno`.
    - **Un análisis de brechas** (`docs/11-produccion-brechas-y-plan.md`) hecho por un agente de solo
      lectura, con tres hallazgos verificados por la sesión principal: **G2**, la barrera T11 acepta
      un `QR_PROVIDER=baneco` con un `PAYMENT_WATCHER=simulado` (un QR real «pagado» con un documento
      escrito a mano; hoy solo lo impiden los scripts de `npm`); **G3**, `verificadorFirebase` daría
      acceso de dueño a cualquier usuario del proyecto de Firebase y no está cableado, aunque este
      documento decía «ya implementado»; y **G5**, la API no responde `500` ante una excepción no
      prevista y nada reinicia el satélite.
    - **Lo que el análisis NO decide:** la arquitectura de despliegue. Ofrece cinco opciones, con
      una recomendación marcada como tal, y doce decisiones para el dueño.
    - **Cómo se ejecuta un pase, cuando proceda:** rige la regla del dueño (Claude ejecuta con su OK
      en el chat; él solo aprueba lo que el sistema exige a una persona, como el Environment
      `production`), no la frase de la habilidad `pase-a-produccion` de que «la ejecución es humana».
    - **Se corrigió documentación desactualizada** que el análisis detectó: la API sí llama al banco
      (`docs/05`), no hay `pino` (`docs/06`), V1 de Baneco estaba resuelto, `docs/04` §2 hay que
      volver a verificarlo en la sesión de WhatsAppModular, y se registró la pregunta nueva H4
      (¿filtra por IP la API de producción?).
26. **El banco no emite otra llave de producción (Andres, 2026-10-02).** Baneco había dicho (B3) que la
    llave de producción se asignaría al salir a producción y que la que circuló no sería la
    definitiva. **No será así: la que ya se usa en la prueba controlada, y que circuló por correo, es
    la de producción y no se rotará.** Consecuencias:
    - **La «llave de producción definitiva» deja de ser una condición pendiente de un tercero**
      (criterio de salida de la Fase 3, `docs/07`, y T1 de `docs/11`).
    - **No hay llave de staging.** Un ambiente de staging no puede hablarle al banco: solo `mock` o
      `simulado`. Refuerza la D12 y limita lo que puede probar un DAST. Tampoco hay llaves separadas
      por entorno ni por consumidor: cada cuenta de cobro conserva la suya (`BANECO_PROD_*`).
    - **Una llave que no se puede rotar y que ya circuló por correo es un riesgo aceptado, no
      resuelto**, y obliga a una custodia explícita. Propuesta para el dueño, sin ejecutar nada:
      borrar las copias que sigan en correo o en carpetas compartidas; un único respaldo en un gestor
      de contraseñas; en producción, solo en el gestor de secretos y con acceso mínimo; y escribir en el
      runbook qué se hace ante una sospecha de filtración. La palanca conocida es pedirle al banco que
      bloquee al usuario API, que ya se bloquea con intentos fallidos y se desbloquea solo en agencia
      (B4). Hay que registrarlo como riesgo aceptado cuando se rehaga el acta (SEC-10).

## Estado actual

**Hito en curso:** Fase 1 — riel Baneco. El sistema completo corre de punta a punta
**en modo demo** (mock/simulado); el riel Baneco ya se probó contra el banco real con plata de monto
mínimo (P1 a P9 en dos cuentas, y el contrato para consumidores). No hay entorno de producción:
ver la decisión 25. Para que un cobro real llegue a `ENVIADO` por WhatsApp sigue faltando `wa-bridge`.

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
- [x] **2026-10-01 — Prueba intermitente de AES, resuelta (PR #67, squash `fe4cf62`).**
      Falló en el CI de `main` el paso `npm run test -- --coverage`: «rechaza el payload
      cifrado con otra llave» (`baneco-gateway/src/crypto/aes.test.ts`) recibió `ok: true`
      con texto basura. Causa en la decisión 23.
      - **Confirmada midiendo con la `descifrar()` real:** 427 de 100 000 corridas (0,43 %)
        aceptaron la llave equivocada, con IV aleatorio.
      - **Solución:** vector fijo (llave del test y la otra, IV de 16 ceros, texto
        «secreto»). Descifrado con la llave equivocada, el bloque crudo es
        `5d4b76198d24e465ab7fb18e380cdb09`: termina en `0x09` y sus últimos 9 bytes no son
        todos `0x09`, así que el relleno no valida. El test lleva un comentario con esto y
        con la advertencia de volver a comprobarlo si se cambia llave, IV o texto. La
        aserción es la misma que antes; **no se debilitó**. Solo cambió el archivo de test.
      - Verificado: `typecheck`, `lint` y `npm test` en verde (929 tests), y el archivo repetido
        200 veces sin fallos. Esa repetición prueba poco por sí sola, porque el vector es
        constante: lo que da la garantía es que el test ya no usa IV aleatorio.
      - **Cómo se fusionó:** el PR lo abrió `segurolotengopy` y lo aprobó `AndresAlberdi`
        (al revés de lo escrito en la decisión 22; sirve cualquiera de las dos cuentas
        mientras el autor y quien aprueba sean distintos). Squash con la rama fijada al
        commit aprobado, sin `--admin`, y el mensaje del merge y la revisión dejan constancia
        del OK del dueño en el chat. Antes, la rama se puso al día con `main` (merge, solo
        docs). Después se borraron la rama (local y remota) y su worktree.
- [x] **2026-10-01 — Adopción del estándar DevSecOps v2 (stack `solo-ci`, reusable 2.7).**
      Un PR por tema, todos con el CI verde sobre el `main` vigente: **#54** el reusable, el
      manifiesto `.devsecops.yml`, las copias de `.github/` y los dos jobs nuevos del CI;
      **#55** CODEOWNERS con los dos logins reales, `security-local.sh`, `.pre-commit-config.yaml`
      (sin instalar) y el job de actionlint y ShellCheck; **#56** el `cooldown` de Dependabot.
      Medido en local antes de subir: `security-local.sh` aprobado, Checkov 328 comprobaciones
      sin fallos, actionlint limpio. En `main`, cero alertas abiertas de Code Scanning. Las
      categorías nuevas (`semgrep`, `trivy-fs`, `checkov-workflows`) no dejan categorías
      viejas que borrar y no apareció ningún Environment solo.
- [x] **2026-10-02 — Bloque 4, G2: la barrera exige los dos adaptadores del banco** (rama
      `fix/barrera-adaptadores-produccion`). Contra producción, `QR_PROVIDER` y `PAYMENT_WATCHER`
      tienen que ser los dos `baneco`; antes bastaba con uno, y un QR real vigilado por un watcher
      simulado confirmaba pagos que el banco nunca vio. Es la primera condición de
      `verificarProduccion`, un valor ausente cuenta como distinto de `baneco`, y el mensaje nombra
      variables y nunca valores. Doce pruebas nuevas: nueve fallan sin la corrección, y una **ata la
      barrera a los lectores reales** (`leerModo` y `leerConfig`): para todo entorno con el que el
      sistema arma un adaptador del banco contra producción, la barrera da verdadero, así que falla
      si uno de los dos aprende a tolerar una grafía que el otro no. La prueba controlada y el demo
      siguen arrancando igual: los scripts de `npm` ya fijaban los dos. **Límite:** cierra el hueco
      *dentro de un proceso*. Una auditoría independiente sin bloqueantes encontró dos hallazgos
      anteriores a este cambio, que quedan como los pasos 4B2 y 4B3 de abajo.
- [x] **2026-10-01 — Bloque 4, inicio: acta y análisis de brechas** (decisión 25). Evidencia reunida
      solo con consultas, sin escribir en GitHub: ruleset, Environments y secretos (ninguno), alertas
      (Dependabot, Code Scanning y secretos en 0), `security-local.sh` aprobado (informe
      `20261001-232920`), acciones sin SHA (ninguna), jobs sin `timeout-minutes` (`verify` y
      `gitleaks`), endpoint de salud (no existe), pruebas de `firestore.rules` (no hay) y cobertura
      medida de 73,52 % de sentencias y 68,15 % de ramas, sin umbral. No se ejecutó nada contra
      producción ni se tocó la infraestructura.
- [x] **2026-10-01 — Bloque 3: una cuenta de cobro por consumidor (PR #70, con #71 para el
      `.env.example`; mergeados).** Un proceso por cuenta, con el vínculo explícito (decisión 24).
      - `qr-core`: `Cobro.cuentaCobro`, `PropietarioConsumidor`, `esDelConsumidor` exige consumidor
        **y** cuenta, `listarPendientes(cuenta)`, y en `conciliarDia` el destino `deOtraCuenta`.
      - `firestore-store`: el campo, dos índices nuevos, `atribuirCuentaALoAnterior` y
        `contarSinCuentaDeCobro`. `composicion`: `prepararDatosDeLaCuenta`, común a la API y al satélite.
      - API: `leerConsumidores` con las cuatro variantes nuevas de error, 401 como segunda barrera,
        `buscar` y `cerrarPrueba` del dueño filtrados por cuenta. Satélite: pasada y cierre por cuenta,
        con `cuenta=` en la bitácora. `tools/cuentas`: la plantilla y el aviso por nombre de lo que falta.
      - 993 pruebas y 66 del emulador, typecheck, lint, `deps:check`, build y `security-local.sh`
        aprobado con umbral MEDIUM. **Revisión de código y dos auditorías de seguridad.** La primera
        encontró lo que obligó a rehacer la autorización de la migración y el control de arranque:
        corregido en el cuarto commit, con pruebas.
      - No se ensayó contra el banco real: el adaptador del banco no cambió.
- [x] **2026-10-01 — Actualización a la versión 2.8 del estándar** (commit `0bf9b9d` de
      SeguridadGeneral). Reusable 2.7 a 2.8 y `gitleaks.toml` 2.1 a 2.2, ambos por fusión de tres
      vías, conservando mis SHAs de Dependabot y la sección de reglas propias; pre-commit 2.0 a
      2.1, copia exacta. La 2.8 fija Gitleaks en 8.30.1: la versión que instalaba el CI, la
      8.24.3, ignoraba la allowlist global. `ci-solo-ci.yml` 2.4 no se copia. Medido en local:
      Gitleaks sin hallazgos en el historial, las tres reglas propias disparan, Checkov 344
      comprobaciones sin fallos y `security-local.sh` aprobado con umbral MEDIUM.
- [x] **2026-10-01 — Dependabot, a cero.** #42 (seis dev-menores), #48 (`codeql-action` init y
      analyze juntas: por separado fallaban las dos), #52 (vitest 5 con su coverage-v8, @eslint/js
      10, plugin-react 6 y zod 4.6) y #53 (`grpc-js`, `brace-expansion`, `firebase-admin` y
      `uuid`, con `npm audit` de dos avisos a cero). Verificado además con las 28 pruebas del
      emulador de Firestore. Decisión a revisar: para quitar `uuid`, `npm audit fix` bajó
      `gaxios` de 6.7.1 a 6.3.0, dentro del rango de sus paquetes padre.
- [x] **2026-09-19/20 — `.env.example` completo (PR #44).** Claude Code no tiene permiso
      sobre `.env.*`, así que, con autorización del dueño en el chat, lo hizo un script que
      solo informó qué cambió, nunca qué decía el archivo. `BANECO_POLL_INTERVAL_SECONDS` pasó
      de 180 a 30; quedaron documentadas `CONSUMIDOR_TOKEN_<ID>`,
      `CONSUMIDOR_AVISO_URL_<ID>` y `CONSUMIDOR_AVISO_SECRETO_<ID>`. La plantilla de
      `npm run prueba:cuenta` también las documenta.
- [x] **2026-09-20 — Ensayo de los bloques 1 y 2 contra el banco real.** Cobro creado
      por el contrato, QR de Bs 1 pagado desde una cuenta propia, confirmado 1 s después
      del pago, y el aviso entregado al primer intento a un receptor local que verifica
      la firma como un consumidor de verdad. Diez comprobaciones, todas ok:
      `02-hallazgos-produccion.md` §6. Con esto los dos bloques quedan cerrados.
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

- ~~**Prueba intermitente de AES (`baneco-gateway/src/crypto/aes.test.ts`).**~~ **Resuelta en
  el PR #67** con un vector fijo (detalle en «Hecho»). Ya no se relanza el CI por ese test: si
  vuelve a ponerse rojo, es un fallo real.
- **`descifrar()` no autentica** (decisión 23). El esquema lo dicta el banco, así que el riesgo no
  se elimina, se acota: descifrar con una llave equivocada puede devolver `ok: true` con texto
  basura (≈ 0,4 %). Hoy no lo sufre ningún camino de producción. **Si alguna vez algo descifra datos
  del banco, hay que validar la estructura del resultado con Zod** antes de usarlo.
- ~~El estándar no escanea los `.md` de `docs/`~~ — **atenuado en la 2.8**, que a raíz de este
  caso los analiza con las reglas de proveedor. Queda exenta `generic-api-key` en esos `.md`, y
  aquí ahí se escriben los informes de la prueba en producción. Lo sigue cubriendo el job
  `gitleaks` propio, que se conserva a propósito (decisión 22). Si algún día se quita, hay que
  decidir antes cómo se cubre esa regla en los documentos.

- **Bloque 3, lo que no cierra y es condición del bloque 4** (base compartida entre cuentas): la
  consola del dueño no filtra por cuenta en `listarRecientes`, `listarPorEstado` ni
  `buscarAbonoEnRevision`; el cupo de `reanudarCorrida` tampoco; los avisos los puede cerrar como
  `SIN_DESTINO` el satélite equivocado; y `buscarPorReferenciaQr` es una búsqueda global. Hoy nada de
  esto es alcanzable: hay un emulador por cuenta, y el control de arranque lo verifica.
- **Los dos índices de Firestore tienen que desplegarse antes que el código** (bloque 4). El emulador no
  los exige; Firestore real rechazaría `listarPendientes` y el satélite quedaría sin vigilancia.
- Deuda menor del bloque 3: el índice `(consumidor.consumidorId, creadoEn desc)` ya no lo usa ninguna
  consulta, y la API lee la cuenta del proceso dos veces.

- **Bloque 3, observaciones de endurecimiento de la última auditoría** (sin escenario concreto hoy):
  la defensa `MARCA_RECIEN_PUESTA` dejaría la marca escrita si algún día se llegara a esa rama, que
  hoy solo alcanza un escritor viejo concurrente; mientras convivan `main` y esta rama sobre el mismo
  emulador, la versión vieja crea la marca sin comprobar nada, así que **antes de arrancar con la
  rama hay que confirmar que `emulador-prod` y `emulador-cuenta-2` ya tienen su marca**; y si el
  dueño deja `ATRIBUIR_DATOS_ANTERIORES_A` en el archivo de la cuenta, queda puesta para siempre: es
  de una sola vez, y el código no lo impone. Conviene quitarla después de usarla.

- **La llave de producción del banco no se puede rotar y ya circuló por correo** (decisión 26): un
  riesgo aceptado que pide custodia explícita. Si se filtra, la única palanca conocida es el
  bloqueo del usuario API por parte del banco.

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
- Los worktrees van en `.claude/worktrees/` (git los ignora) y **recién creados no traen
  `node_modules`**: hay que correr `npm ci` dentro. La herramienta `sync_with_base_branch` de la
  app puede no estar disponible; el respaldo es `git merge origin/main` (nunca rebase si la rama
  ya se subió). Borrar un worktree se hace desde el repo principal con `git worktree remove`.
- El PR lo puede abrir cualquiera de las dos cuentas (`AndresAlberdi` o `segurolotengopy`, esta
  con `GH_CONFIG_DIR=$HOME/.config/gh-pro`); lo que exige el ruleset es que quien aprueba sea otra.

### Próximo paso (retomar acá)

Estado de partida: `main` está sano (CI verde, Dependabot en cero, `npm audit` en cero) y el
PR #67 ya está dentro. Lo que sigue, en orden de importancia.

**Dueño:**

0. **Bloque 4: decidir qué significa «producción» (D1) y cómo se despliega (D2).** Son las que
   destraban el resto; las demás (D3 a D12) están en `docs/11` §3.3, cada una con su recomendación.
   Recomendación del análisis: D1 = NovuChat cobrando por el contrato con poco volumen y un tope
   de monto, y D2 = Cloud Run más Firebase en el proyecto `manejoqrsimple`, lo que exige el plan
   Blaze (D3). **Gestión con el banco, que hace el dueño:** preguntar si su API de producción filtra por IP de
   origen. La llave definitiva ya no se pide: el banco no emite otra (decisión 26). Nada de esto se
   ejecuta ni se crea sin su OK.
0bis. **Bloque 3, antes de arrancar la API con él** (ya está fusionado):
   - **D-A, los datos ya guardados en `~/.manejoqr/emulador-prod` y `emulador-cuenta-2`.** Opciones:
     (a) atribuirlos a su cuenta, con un respaldo previo de cada carpeta: se hace arrancando una vez
     con `ATRIBUIR_DATOS_ANTERIORES_A=<alias>`, o solos si el emulador ya tiene la marca de esa cuenta;
     (b) borrarlos y empezar de cero, que `ESTADO` ya permitía; (c) dejarlos ilegibles.
     Recomendación: **(a)**, pero no se ejecuta nada sin el OK. Un emulador sin marca con datos viejos
     **aborta y no crea la marca** hasta que el dueño decida.
   - **Aprobar o corregir los supuestos de la decisión 24** (D-B, D-C, D-D y D-F).
   - ~~**El consumidor de ensayo se conserva** (pedido del dueño)~~ — **hecho el 2026-10-01**, con el
     OK del dueño: un script, sin mostrar valores, agregó `CONSUMIDOR_CUENTA_ENSAYO=prod` al archivo de
     la cuenta `prod` y regeneró el certificado local, ahora con vigencia de 30 días (vence el
     2026-11-01). `npm run prueba:cuenta -- prod --revisar` lo da por completo. El receptor del aviso y
     el cliente del consumidor de ensayo vivían en la carpeta temporal de otra sesión: hay que
     reescribirlos antes de la próxima prueba.
   - ~~**`.env.example`**~~ — **hecho el 2026-10-01**, con el OK del dueño y el mismo método de script del
     PR #44: `CONSUMIDOR_CUENTA_<ID>` y `ATRIBUIR_DATOS_ANTERIORES_A`, comentadas y sin valores.
1. **Decidir la opción de WhatsAppModular en `docs/04` §2.3.** Es lo que más destraba: sin
   `wa-bridge` ningún cobro real pasa de `QR_ACTIVO`.
2. **Revisar los cambios sin commitear del checkout principal** (`~/ManejoQRSimple`): hay
   modificados `CLAUDE.md` y cuatro agentes de `.claude/agents/` (`backend-dev`, `code-reviewer`,
   `scraper-yape`, `test-engineer`). No son de la sesión del AES: vienen de otra, y esta no los
   tocó. Decir si se commitean (en un PR) o se descartan.
3. Pedirle al oficial el **catálogo de bancos (D9)** y guardarlo en `privado-no-gh/`. Si
   interesa, pedir también los manuales de **Bec QR Connect** (G2).
4. Adoptar la rutina de `docs/09-revision-manual.md` §3: una revisión diaria de la pestaña
   Revisión.
5. Limpieza cuando ya no haga falta: borrar `~/.manejoqr/emulador-prueba`, `~/.manejoqr/qrs`
   y `~/.manejoqr/emulador-cuenta-2` (con `qrs/cuenta-2`); conservar `~/.manejoqr/logs/`. El
   consumidor de ensayo y `~/.manejoqr/ensayo` **se conservan** para las próximas pruebas (pedido
   del dueño, 2026-10-01).
6. Persistir el límite de inotify (archivo en `/etc/sysctl.d/`, ver «Notas de entorno»).
7. ~~Pedir la llave de producción definitiva por un canal que no sea un adjunto de correo (B3)~~ —
   **ya no aplica**: el banco no va a dar otra (decisión 26). En su lugar, la **custodia** de la
   llave actual: borrar las copias que sigan en correo o en carpetas compartidas, y decidir dónde
   queda el respaldo.
8. Si se abre un PR nuevo, dar el OK en el chat PR por PR (decisión 11). Con el ruleset de la
   decisión 22, Claude Code aprueba con la cuenta `segurolotengopy`, pero **la fusión la hace el
   dueño desde GitHub**: el clasificador de permisos bloquea que una misma sesión apruebe y fusione.

**Claude Code:**

1. **Fixtures reales saneadas de `baneco-gateway`.** Sin cuenta de pruebas (decisión 21) tienen
   que salir de la prueba en producción, y los logs no guardan cuerpos a propósito: falta una
   captura saneada en ese modo, con la misma barrera anti-secretos del B0. Con ella, reemplazar
   las fixtures derivadas de la espec. y ajustar el adaptador a los `responseCode` observados
   (por ejemplo, anular un QR pagado). Necesita que el dueño pague un QR de monto mínimo.
2. **Contrato para consumidores, bloque 3**
   (`Prompts/cobrador-contrato-para-consumidores.md`): **hecho** (PR #70 y #71, decisión 24); queda
   la decisión del dueño de arriba. Los bloques 1 y 2 están cerrados y ensayados (PR #38 y #40;
   `02-hallazgos-produccion.md` §6).
3. **Contrato para consumidores, bloque 4:** pase a producción. **Empezado: ver la decisión 25.**
   Hallazgos de la auditoría de la barrera, aún sin construir:
   - **4B2, media (T1, reglas 1 y BANECO-1): un watcher simulado de OTRO proceso confirma un QR real
     del emulador de la prueba.** Con `prueba:emulador` y `prueba:api` arriba, alguien corre
     `demo:pagar -- <id>` y `satelite:demo` con `FIRESTORE_EMULATOR_HOST` exportado: `satelite:demo`
     no tiene `BANECO_ENV`, así que la barrera lo deja pasar, no está en modo prueba y no revisa la
     marca del emulador, y confirma un cobro con un QR real que el banco nunca vio. La evidencia lo
     atribuye al banco: el abono simulado lleva `origen: 'watcher-baneco'`. Corrección propuesta, en
     dos capas: que la API, el satélite y `tools/demo-local` se nieguen a arrancar contra una base que
     tiene la marca de cuenta de la prueba, y que el watcher y el QR simulados lleven un origen propio
     que la conciliación mande a `EN_REVISION`.
   - **4B3, baja: HECHO.** El riel que impide usar el host de producción desde certificación
     comparaba con `includes(HOST_PRODUCCION)` y distinguía mayúsculas: con un host en mayúsculas y las
     credenciales de producción en `BANECO_CERT_*`, la llamada llegaba a producción. Ahora
     `baneco-gateway/src/config.ts` interpreta la URL con `new URL()` y, en certificación, **solo
     admite una lista de permitidos**: `apimktdesa.baneco.com.bo` por `https`, `localhost` y el
     loopback (bancos simulados y pruebas; no `.test` ni `.localhost`, que salen al DNS). El host de
     producción da `URL_DE_PRODUCCION_EN_CERT`; cualquier otro host, `HOST_NO_PERMITIDO_EN_CERT`; una
     URL ilegible o con usuario o clave, `VARIABLE_INVALIDA`. Los errores llevan el host y nunca la URL
     completa. Además `transporteFetch` ya **no sigue redirecciones** (`redirect: 'error'`): un 307/308
     repetía el POST del login en el host de `Location`, saltando el riel (hallazgo de la auditoría;
     vale también en `prod`). Cambio de contrato: un `BANECO_CERT_BASE_URL` que apunte a otro host real
     (un alias del banco, una IP) ya no arranca. Queda pendiente, como **4B3-bis (baja)**: en
     `prod` la URL (`BANECO_PROD_BASE_URL`) tampoco se valida contra el host de producción, así que
     alguien con control del entorno podría mandar las credenciales de producción a otro host.
   El resto del bloque 4 se puede avanzar ya, sin esperar decisiones, con los bloques 4C a 4G y 4K de
   `docs/11` §4: el endpoint de salud y la robustez de los procesos, la cuenta obligatoria, el
   registro persistente del cierre, el latido y lease del satélite, el cupo compartido, los tiempos
   límite de dos jobs del CI (PIP-04) y las fixtures reales. Ya están hechos la documentación al día
   (4A) y la coherencia de adaptadores en la barrera (4B). El resto espera las decisiones D1 a D12.
4. `wa-bridge`, cuando el dueño decida el punto 1; con él, el aviso por WhatsApp de los casos
   críticos de revisión.
5. Al desplegar la API en serio, pasar el cupo de QRs por consumidor a un contador compartido
   (hoy vive en memoria del proceso; ver «Riesgos abiertos»).
6. Cualquier código nuevo que llame a `descifrar()` valida el resultado con Zod (decisión 23).

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
