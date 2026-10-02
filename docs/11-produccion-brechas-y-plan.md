# 11 — Bloque 4, «el pase a producción»: brechas, opciones y plan

> **Estado: análisis para decidir, no una decisión.** Lo produjo un agente planificador de solo
> lectura el 2026-10-01 y la sesión principal verificó en el código los hallazgos más graves
> (G2, G3 y G5) y las contradicciones de documentación del §2.4. El resto se cita como lo entregó
> el análisis, con archivo y línea, y hay que releerlo en el código antes de construir sobre él.
> El acta con el estado del checklist del estándar está en `produccion/acta-v0.1.0.md`.
>
> **Actualización del 2026-10-02.** (1) **G2 está cerrado dentro de un proceso:** la barrera exige
> los dos adaptadores del banco (ESTADO, «Hecho»). La auditoría de ese cambio encontró dos hallazgos
> anteriores, 4B2 (un watcher simulado de otro proceso confirma un QR real del emulador compartido)
> y 4B3 (el riel de certificación distingue mayúsculas en el host; **corregido**, ver ESTADO), descritos
> en ESTADO, «Próximo paso». (2) **El banco no va a dar otra llave de producción** (Andres,
> ESTADO, decisión 26): la «llave definitiva» del §2.2 y la gestión T1 del §3.3 ya no aplican; la
> llave que circuló por correo es la de producción y no se rotará. Eso implica que **no hay llave de
> staging** (un staging solo puede usar `mock` o `simulado`), que la rotación del checklist (SEC-10)
> no es posible y queda como riesgo aceptado con custodia explícita, y que el plan de rollback debe
> decir qué hacer ante una sospecha de filtración. El resto del análisis sigue como se escribió.

# Bloque 4 «pase a producción»: análisis de brechas (ManejoQRSimple, 2026-10-01)

Lecturas fuera del proyecto, solo lectura y declaradas: fichas `seguridadgeneral.md`, `manejoqrsimple.md`, `novuchat.md` y `whatsapp-modular.md` de `~/Claude-Proyectos/proyectos/`, para saber dónde corre NovuChat, en qué estado está WhatsAppModular y cómo está la VM OCI compartida. En `~/SeguridadGeneral` leí la skill `pase-a-produccion`, `01-seguridad/05-checklist-pase-a-produccion.md`, `02-pipelines/README.md`, `ci-multicloud.yml` y `ci-node-firebase.yml`, para mapear cada opción a un stack del estándar. De esas lecturas traje conocimiento, no estado ni decisiones de esos proyectos. No leí `~/.manejoqr` ni ningún `.env*`. Corrí `npx vitest run`: 1000 pruebas, 49 archivos, todas en verde.

---

## 1. Objetivo

Que el dueño pueda decidir qué significa «producción» y cómo se despliega, con una lista verificada de lo que falta. Queda además un plan por bloques (una rama y un PR por bloque) que separa lo que se puede construir ya de lo que espera una decisión suya o a un tercero. Este documento no decide la arquitectura de despliegue.

## 2. Contexto verificado

### 2.1 Qué es hoy «producción»

| Aspecto | Hecho verificado | Evidencia |
|---|---|---|
| Dónde corre la API | Un proceso `node:http` en la ThinkPad. Escucha solo en `127.0.0.1:8787`. **No es una Cloud Function:** `@mqs/functions` no depende de `firebase-functions`, y el propio código dice que «el día que esto sea Cloud Functions, se escribe otro borde». | `packages/functions/src/main.ts:202,225`; `packages/functions/package.json` (dependencias); `packages/functions/src/index.ts:12-13`; `servidor.ts:8-9` |
| Dónde corre el satélite | Un bucle en una terminal de la ThinkPad. Hace una pasada cada 30 s (10 s en la prueba). Nadie lo supervisa ni lo reinicia. | `packages/baneco-satelite/src/main.ts:50-51,207-302,316-317`; `package.json:41` |
| Quién los arranca | El dueño, a mano, en cuatro terminales: `prueba:emulador`, `prueba:api`, `prueba:satelite` y `prueba:consola`. | `package.json:39-42`; `docs/Integraciones/baneco/03-prueba-en-produccion.md` |
| Dónde viven los datos | En un emulador local de Firestore, uno por cuenta, siempre en el puerto 8080. Usa `firebase.demo.json`, **que no carga reglas**, y **exporta los datos solo al salir** (`--export-on-exit`). | `package.json:39-41`; `firebase.demo.json` (sin `rules`) |
| Imágenes de QR | En disco local, en `~/.manejoqr/qrs/<alias>`. | `functions/src/main.ts:106-108`; `functions/src/imagenes.ts:96-125` |
| Bitácora | Un JSONL por proceso y por día en `~/.manejoqr/logs`. No rota, tiene un tope de 20 MB por archivo y la pestaña Logs además guarda un buffer en memoria. | `composicion/src/bitacora.ts:16-25,127`; `functions/src/main.ts:112-121` |
| Autenticación del dueño | Un token fijo, `API_TOKEN_LOCAL`, de 16 caracteres como mínimo, comparado con `timingSafeEqual`. La consola lo lleva **embebido en el bundle** (`VITE_API_TOKEN`). | `functions/src/auth.ts:32,79-88`; `demo-web/src/main.tsx:4-8,18-19` |
| Autenticación con Firebase | `verificadorFirebase` existe pero **no lo usa nadie**: `main.ts` solo arma el token fijo. Además da identidad de dueño a **cualquier** ID token válido del proyecto, porque no compara contra una lista de UID. | `auth.ts:101-112`; `main.ts:60` |
| Autenticación de consumidores | Un token por consumidor, de 32 caracteres como mínimo, con su `CONSUMIDOR_CUENTA_<ID>`. La API no arranca si la configuración es ambigua. | `auth.ts:42,162-254,329-342` |
| Secretos | Todos en `~/.manejoqr/baneco-<alias>.env` (permisos 600), cargados con `node --env-file`. **La API y el satélite tienen las dos las credenciales del banco** y acceso de administrador a toda la base. | `package.json:40-41`; `docs/06-seguridad.md` §2 |
| Firebase real | `firebase.json` declara solo reglas e índices de Firestore: **no tiene `hosting` ni `functions`**. No hay nada desplegado ni configurado para desplegarse. | `firebase.json` |
| Estándar DevSecOps | `solo-ci`, con `produccion: false` y sin ambientes ni DAST. No hay `Dockerfile`, `release.yml` ni tags semánticos: el único tag es `final-contrato`. | `.devsecops.yml`; `git tag` |

**La barrera T11** (`packages/composicion/src/produccion.ts`):
- `hablaConProduccion` (líneas 21-23) es verdadera si `BANECO_ENV=prod` y alguno de los dos adaptadores es `baneco`.
- Cuando es verdadera, `verificarProduccion` (líneas 26-51) exige `MODO_PRUEBA_PRODUCCION=1` (línea 30) y `FIRESTORE_EMULATOR_HOST` (línea 36), y rechaza `SATELITE_SIN_FIRESTORE=1` (línea 42).
- La llaman la API (`main.ts:99`) y el satélite (`main.ts:79`).
- Con `MODO_PRUEBA_PRODUCCION=1` la API aplica topes con techos fijos en el código: Bs 10 por QR y 30 QRs por corrida (`functions/src/modo-prueba.ts:139-141,195-222`).

**Qué habría que reemplazar para salir de la prueba controlada:**

1. Una segunda rama de `verificarProduccion` para un modo de producción explícito. Tendría que exigir:
   - Firestore real, nunca el emulador.
   - Los dos adaptadores en `baneco`.
   - Mensajería que no sea `mock`.
   - Cuenta declarada, sin el valor por defecto.
   - Estado compartido (cupo e imágenes).
   - Autenticación del dueño que no sea un token embebido.
2. Sacar la cuenta del proceso de `PRUEBA_CUENTA`. Hoy, si falta, cae en `'prod'` (`composicion/src/cuenta.ts:16,42-45`).
3. Decidir los topes de producción, que son una decisión de negocio (D8).

La prueba controlada tiene que seguir funcionando tal cual: es el procedimiento de la decisión 16.

### 2.2 Condiciones que el proyecto ya fijó para producción, y su estado

**Criterio de salida de la Fase 3, riel Baneco** (`docs/07-plan-fases.md:49-51`):

| Condición | Estado | Evidencia |
|---|---|---|
| Informe de la prueba en producción sin hallazgos abiertos | **Parcial** | `02-hallazgos-produccion.md`: P1–P9 bien en dos cuentas y C1–C10 del contrato bien. §3.1 está corregido, pero §7 sigue abierto con las fixtures reales. |
| Fixtures reales en `baneco-gateway` | **Pendiente** | ESTADO, «Claude Code» 1; `02-hallazgos` §7. Hace falta que el dueño pague un QR de Bs 1. |
| `wa-bridge` operativo | **Pendiente, bloqueado por decisión** | `packages/wa-bridge/src/index.ts` es un esqueleto de 18 líneas y `composicion/src/mensajeria.ts` falla a propósito. Espera la decisión del dueño sobre docs/04 §2.3. |
| Llave de producción definitiva (B3 del banco) | **~~Pendiente, depende de un tercero~~ Cerrada el 2026-10-02: el banco no emite otra; la actual es la de producción** | `01-preguntas-al-banco.md` B3: «al salir a producción se asigna la llave». ESTADO, «Dueño» 7. |

**Condiciones previas que dejó el bloque 3** (ESTADO, «Riesgos abiertos», líneas 686-702, y la decisión 24):

| Condición | Estado | Evidencia |
|---|---|---|
| La consola del dueño no filtra por cuenta en `listarRecientes`, `listarPorEstado` ni `buscarAbonoEnRevision` | **Pendiente** | Las firmas no reciben cuenta: `qr-core/src/ports/puertos.ts:141,148` |
| `buscarPorReferenciaQr` busca en toda la base | **Pendiente** | `puertos.ts:157` |
| El cupo de `reanudarCorrida` no distingue cuenta, y un satélite equivocado puede cerrar avisos como `SIN_DESTINO` | **Pendiente** | ESTADO:686-690. Hoy no se alcanza porque cada cuenta tiene su emulador. |
| Desplegar los dos índices antes que el código | **Pendiente** | `firestore.indexes.json:17-48`. No se desplegó nada. **Ojo:** el valor por defecto del estándar es `--only hosting,firestore:rules` y **no incluye `firestore:indexes`** (`ci-node-firebase.yml:431,617`). |
| Índice sin uso `(consumidor.consumidorId, creadoEn desc)` | **Pendiente**, trivial | `firestore.indexes.json:3-16` |
| Cupo por consumidor en memoria del proceso | **Pendiente** | `functions/src/api/cupo-consumidor.ts:12-16,50` |
| D-A, los datos guardados en los emuladores | **No verificable leyendo** | ESTADO lo da por abierto; no leí `~/.manejoqr`. |
| D-B, D-C y D-F, supuestos a confirmar por el dueño | **Pendiente** | Decisión 24 |
| D-D, una API o un satélite para varias cuentas | **Pospuesto al bloque 4** | Decisión 24; ADR-010 |
| La consola publicada necesita Firebase Auth | **Pendiente, y el código contradice el documento** | ESTADO:713-716 dice «ya implementado del lado de la API». No está cableado y no tiene lista de UID (§2.1). |
| Checklist del estándar más la aprobación del dueño | **Pendiente** | Decisión 21. En el checklist 05 hay controles bloqueantes en rojo hoy: APP-14 `/healthz`, DAT-01 pruebas de reglas, DAT-04 backups, OPS-01/02 monitoreo, OPS-04 runbook, SEC-04 gestor de secretos, PIP-14 rollback, REP-08 release. |

**Diferido o bloqueado por terceros:**
- D1, IPs del webhook: no bloquea, porque se opera sin webhook.
- D9, catálogo de bancos: no bloquea.
- Riel Yape: diferido.
- **Pregunta nueva, sin registrar en ningún documento:** si la API de producción del banco filtra por IP de origen. Hasta hoy todo se llamó desde la conexión de la ThinkPad. Salir de esa máquina sin saberlo puede terminar en rechazos o en logins fallidos. Recordar B4: el usuario API se bloquea por intentos fallidos y se desbloquea solo en agencia.

### 2.3 Brechas técnicas que nadie anotó

Gravedad medida para un sistema de cobros: **Crítica** = puede confirmar un pago inexistente o perder evidencia; **Alta** = deja plata real sin vigilar o abre acceso; **Media** = degrada la operación; **Baja** = higiene.

| # | Brecha | Evidencia | Escenario dañino | Gravedad |
|---|---|---|---|---|
| G1 | Los datos de la prueba viven en la memoria del emulador y se exportan **solo al salir** | `package.json:39` (`--export-on-exit`) | Un corte de luz, un `kill -9` o un fallo de Java pierden todo lo ocurrido desde el arranque: cobros, evidencia (regla #8), abonos sin conciliar y la marca de cuenta. | Crítica en cuanto haya plata de terceros; tolerable en la prueba de Bs 1 |
| G2 | La barrera T11 **no exige que los adaptadores sean coherentes**. `PAYMENT_WATCHER=simulado` confirma con lo que encuentre en `abonos/*`, y el emulador corre **sin reglas**. | `produccion.ts:21-51`; `composicion/src/puertos.ts:272-277`; `firebase.demo.json` | `QR_PROVIDER=baneco` con `PAYMENT_WATCHER=simulado` pasa la barrera: un QR real «pagado» con un documento escrito a mano en el emulador. Eso confirma el cobro, encola el aviso y el consumidor entrega lo que vendió. Hoy solo lo impiden los scripts (`package.json:40-41`), o sea la disciplina. | **Crítica** en cuanto se libere la barrera |
| G3 | `verificadorFirebase` mapea **cualquier** UID a dueño, y `firestore.rules:17-19` permite leer con `request.auth != null` | `auth.ts:101-112`; `firestore.rules:17-19` | Si se cablea tal como está y el proyecto admite registro en Firebase Auth, cualquiera que cree una cuenta es dueño: anula, resuelve revisiones y cierra abonos, y lee todos los cobros y la evidencia. Desde el navegador no puede confirmar sin abono del banco, pero puede soltar QRs y cerrar casos. Qué proveedores de Auth tiene activos el proyecto no se puede verificar leyendo el repositorio. | Alta (latente) |
| G4 | La API solo escucha en `127.0.0.1`, en HTTP plano, y el token del dueño va en el bundle | `main.ts:225`; `servidor.ts:12`; `demo-web/src/main.tsx:18-19` | NovuChat, que corre en Firebase según su ficha, no puede llegar a la API: el contrato no tiene URL pública. Publicar la consola así publica el token del dueño. | Alta (bloquea el contrato) |
| G5 | Sin salud ni supervisión. No hay `/healthz` (`enrutador.ts:79-85` exige token en todo). `crearServidor` hace `void atender(...)` sin `catch` (`servidor.ts:33`), así que una excepción no prevista es un `unhandledRejection` y tumba el proceso. El satélite usa `await` de nivel superior sin `catch` (`main.ts:316-317`). Nada los reinicia y no hay latido. | Citada en la columna anterior | El satélite muere de noche y la API **sigue emitiendo QRs** que nadie vigila: nadie se entera. | Alta |
| G6 | Satélite caído con QRs pagables | `pasada.ts:44`; `cierre.ts:35`; `satelite/main.ts:192-193,259-263` | Sin pasadas no se anula nada al vencer, y el banco cobra hasta la medianoche del `dueDate` (C4). El cobro sigue `QR_ACTIVO`; el consumidor ve «sin pagar» y emite otro con una referencia nueva. El cliente paga dos veces y el segundo pago termina en `EN_REVISION`, sin devolución automática (`docs/01` §7). Si la caída dura más de 3 días, los días fuera de la ventana **quedan sin cerrar sin ningún aviso**: el registro de días cerrados vive en memoria y se pierde al reiniciar. | Alta |
| G7 | Estado en memoria o en disco local | Cupo: `cupo-consumidor.ts:50`. Corrida: `modo-prueba.ts:161-162`. Buffer de logs: `registro.ts`. Imágenes: `imagenes.ts:96-125` | Con dos instancias, o después de un reinicio, el cupo se reinicia (T14 a escala). `GET /api/v1/cobros/:id/qr` responde `404 SIN_IMAGEN` si la instancia que atiende no es la que guardó el PNG. Cada instancia ve su propia pestaña Logs. | Media; Alta si se despliega con varias instancias |
| G8 | Un satélite por cuenta sin exclusión mutua | `satelite/main.ts` (no tiene lease) | Dos satélites de la misma cuenta, por ejemplo durante un redespliegue que se solapa o con dos terminales abiertas, mandan `cancelQR` dos veces y entregan avisos duplicados. No hay doble confirmación porque la escritura es condicional. | Media |
| G9 | Un emulador por cuenta, siempre en el puerto 8080 | `package.json:39-41` | Dos cuentas no se pueden vigilar a la vez en la misma máquina. Producción exige vigilar todas en paralelo. | Media |
| G10 | Cuota del plan Spark | Pasadas cada 30 s: 2.880 por día × N cobros pendientes en lecturas (`pasada.ts:44`). El cupo gratuito es de 50.000 lecturas por día ([cuotas de Firestore](https://firebase.google.com/docs/firestore/quotas)). | Con unos 17 pendientes a la vez se pasa el cupo. Con 72 h de vigencia eso son unos 6 cobros por día. Pasado el cupo, `listarPendientes` falla, cada pasada termina en `errorFatal` y **no hay vigilancia hasta que la cuota se reinicia**. No medí cuánto suman las consultas periódicas de la consola. | Media; Alta si se decide quedarse en Spark |
| G11 | Pasada secuencial | `pasada.ts:56-57`; demoras de `statusQR` de 0,1 a 0,5 s (`02-hallazgos` §2) | Entre unos 60 y 300 pendientes, la pasada ya dura más que el intervalo de 30 s. | Baja con poco volumen |
| G12 | Privilegio | `functions/main.ts:49-57`; `satelite/main.ts:68-75`; `package.json:40-41` | Los dos procesos tienen las credenciales del banco y acceso de administrador a toda la base. Lo que dice docs/05 §4 («credencial acotada a colecciones») **no se puede hacer** con el Admin SDK: IAM de Firestore no restringe por colección, pero sí por **base de datos** con condiciones de IAM ([documentación oficial](https://docs.cloud.google.com/firestore/native/docs/security/iam); [administrar bases](https://firebase.google.com/docs/firestore/manage-databases)). | Media |
| G13 | La cuenta cae por defecto en `'prod'` | `composicion/src/cuenta.ts:16,42-45` | En producción, si falta `PRUEBA_CUENTA`, el proceso se rotula con la cuenta `prod` aunque las credenciales cargadas sean de otra. | Media |
| G14 | Logs y alertas | `bitacora.ts:23` (lo que pasa del tope se descarta); ESTADO:664-666 | No hay retención definida (OPS-09). Las alertas solo existen con la consola abierta. Un bloqueo del usuario API (B4) o un cierre fallido quedan en una terminal. | Media |
| G15 | El cierre no tiene registro persistente | `satelite/main.ts:192-193` | Cubierto en G6. Además, cada arranque vuelve a pedir `paidQR` de 3 días, cosa que es correcta porque es idempotente. | Media |
| G16 | Higiene | `servidor.ts:42-48` (CORS de un solo origen; no aplica a llamadas entre servidores); faltan cabeceras de seguridad (APP-05), pruebas de reglas (DAT-01) y `Dockerfile` | — | Baja |

Manejo de señales: la API cierra el servidor y deja terminar los pedidos en curso (`functions/main.ts:250-261`). El satélite termina la pasada en curso (`satelite/main.ts:196-205`). Queda un riesgo menor: un `SIGKILL` justo entre `generateQR` y el guardado deja un QR suelto (C3), y solo lo encuentra el cierre diario si alguien lo paga. Llamar al banco tiene un timeout de 15 s (`baneco-gateway/src/client/http.ts:28`).

### 2.4 Donde el código contradice los documentos

1. **ESTADO** (encabezado y la casilla `[ ]` de la línea 575) da el bloque 3 como «PR abierto, sin fusionar». `git log` muestra `e565675 (#70)` y `b45fc8e (#71)` fusionados, y la ficha del registro también lo da por fusionado. Además, «Estado actual» (línea 273) todavía dice que contra el banco real falta el B0.
2. **docs/05 §1** dice que «Functions no necesita salida a internet». No es así: **la API llama al banco** al emitir, anular y verificar (`handlers.ts:345,431,637,724,741`; `consumidores.ts:366`). Cualquier despliegue de la API necesita salida a internet y, en Firebase o GCP, el plan Blaze.
3. **docs/05 §5** dice «sin entorno de producción hasta tener API oficial». La API oficial ya existe y está probada.
4. **docs/06 §3** dice «logs estructurados (pino)». No hay pino en ningún paquete.
5. El **README de Baneco** deja V1 y V4 «abiertos». P1–P9 corrieron contra esas rutas en producción, así que V1 está resuelto en los hechos. V4 se cierra con las fixtures.
6. **ESTADO:713-716** dice que Firebase Auth está «ya implementado del lado de la API». La función existe, pero no está cableada ni tiene lista de UID (G3).
7. **docs/04 §2** se verificó el 2026-08-27 y se apoya en el laboratorio Evolution. La ficha de WhatsAppModular (2026-09-28) dice que los canales no oficiales «se probaron y se descartaron» y que ya tiene un receptor en producción. Esa sección quedó vieja y **hay que volver a verificarla en la sesión de WhatsAppModular** antes de decidir A o B.
8. El **análisis de Baneco §8.3 B4** pone como condición la «certificación formal del banco», pero A1 dice que no existe.
9. **docs/07 Fase 3** exige «wa-bridge operativo». El contrato de docs/10 §2 no le manda nada al pagador, así que para producción por el contrato `wa-bridge` no hace falta. Si se cambia el alcance, el que decide es el dueño (D1).
10. **CLAUDE.md** dice que «nada fuera de `firestore-store` importa el SDK de Firebase». Las raíces de composición sí lo importan para crear la conexión (`functions/main.ts:30-31`, `satelite/main.ts:38-39`), lo que es coherente con ADR-007 y pasa `deps:check`. Publicar la consola con Firebase Auth metería `firebase/auth` en `demo-web`, y eso **exige una excepción explícita a la regla**: no se puede asumir.

## 3. Decisiones de diseño

### 3.1 Opciones de despliegue (para que decida el dueño)

| Opción | Qué proceso va dónde | Qué cambia en el código | Qué cambia en el estándar | Esfuerzo* | Riesgo principal |
|---|---|---|---|---|---|
| **O1. ThinkPad** (lo de hoy, con Firestore real y un túnel) | API, satélite y consola en la laptop; datos en Firestore | Barrera, `/healthz`, latido | Sigue en `solo-ci`: no despliega nada | Bajo (1–2 bloques) | Laptop apagada = QRs sin vigilar y contrato caído. No cumple la Fase 2 («laptop apagada»). **No es producción.** |
| **O2. Firebase puro** | API como función HTTP de 2.ª generación; satélite como función programada; consola en Hosting; Firestore | Un borde nuevo (`firebase-functions`). El satélite se reescribe como ejecución corta con lease. El intervalo pasa a ≥ 1 min, que es el mínimo de Cloud Scheduler (hoy son 30 s, D6). | `node-firebase` con `FIREBASE_DEPLOY_ONLY` que incluya `functions` y `firestore:indexes` | Medio-alto (4–5 bloques) | Ejecuciones que se solapan y una detección más lenta. El satélite pasa a ser un despliegue distinto del de la prueba. Requiere Blaze. |
| **O3. Cloud Run + Firebase** (en el mismo proyecto `manejoqrsimple`) | API como servicio de Cloud Run; satélite como **otro** servicio con una instancia como mínimo y como máximo y la CPU siempre asignada; consola en Hosting; Firestore | `Dockerfile`, `/healthz`, estado compartido (G7), lease (G8), cuenta obligatoria (G13), secretos en Secret Manager | De `solo-ci` a **`multicloud`**, con componentes `firebase` y `cloudrun`. `python-cloudrun` **no sirve**: su calidad es Python. Hacen falta WIF, los Environments, un proyecto de staging y DAST. | Medio (5–6 bloques) | Costo fijo del satélite siempre encendido. La IP de salida varía, lo que importa si el banco filtra por IP (se resolvería con Cloud NAT). Requiere Blaze. |
| **O4. VM en OCI** (ADR-003) | API y satélite en contenedores en una VM: una E2.1.Micro nueva, o compartida con la VM donde corren otp-service, el receptor y n8n. TLS con Nginx o NPM; Firestore en GCP; consola en Hosting. | `Dockerfile`, `/healthz`, política de reinicio y una llave JSON de una cuenta de servicio de GCP dentro de la VM | `multicloud` (`firebase` + `oci`), pero el adaptador `oci` del estándar **solo hace Terraform** (`ci-multicloud.yml:578-600`): desplegar el contenedor en la VM queda manual. La llave JSON choca con SEC-07 («SA sin claves») y obliga a una excepción. | Medio (5 bloques, más operación manual) | Operación manual: parches y reinicios. Una llave de GCP exportada en otra nube. Si se comparte la VM, el sistema queda junto al OTP de SeguroLoTengo, que está en producción financiera, y el radio de impacto crece. Solo 1 GB de RAM. |
| **O5. Híbrido** (D2 tal cual) | API en Cloud Run y satélite en la VM de OCI | La suma de O3 y O4 | `multicloud` con tres proveedores | Alto (7 bloques o más) | Dos nubes para un sistema chico; las credenciales del banco quedan en las dos. |

\* Esfuerzo en bloques. Supuesto: un bloque es una rama y un PR con implementación, revisión de código y auditoría de seguridad, como los bloques 1 a 3. Es mi estimación, no una medición. No pongo montos en dinero: los de Cloud Run y Firestore hay que sacarlos de la calculadora oficial de GCP antes de decidir.

**RECOMENDACIÓN (no es una decisión): O3, Cloud Run más Firebase en el proyecto `manejoqrsimple`.**
- Firestore, Secret Manager y la identidad de despliegue quedan en el mismo proyecto. No hace falta exportar llaves, que es justo lo que O4 obliga a exceptuar.
- El satélite sigue siendo el mismo bucle de hoy, en una instancia fija. O2 obliga a reescribirlo y a perder la cadencia de 30 s.
- El estándar ya cubre `firebase` + `cloudrun` en `multicloud`.
- WhatsAppModular ya resolvió ese mismo patrón (Cloud Run con federación desde GitHub). Eso lo sé por su ficha; no lo verifiqué en su código.

El costo es habilitar Blaze, una decisión del dueño (D3). Antes hay que confirmar con el banco si filtra por IP (T3).

### 3.2 Decisiones técnicas que tomo en este plan (cada una con su alternativa descartada)

- **La barrera exige `QR_PROVIDER` y `PAYMENT_WATCHER` en `baneco` los dos** cuando se habla con producción, también dentro de la prueba. Descarto confiar en los scripts: G2 es fraude posible, y la regla del proyecto es hacer las violaciones imposibles, no evitarlas.
- **`/healthz` en el borde (`servidor.ts`), antes de la autenticación, y no en el enrutador.** El enrutador conserva su invariante («no hay endpoint de negocio público»). Responde `200 {"ok":true}`, sin versión ni configuración (APP-14). Descarto ponerlo detrás del token: un monitor externo tendría que guardar el token del dueño.
- **Una excepción no prevista en la API responde 500 y el proceso no muere. Un `unhandledRejection` sí termina el proceso con código 1,** para que lo reinicie un supervisor. Descarto tragarse las excepciones a nivel de proceso: un estado corrupto que sigue sirviendo es peor que reiniciar.
- **El satélite atrapa la excepción de cada pasada, la registra y sigue.** Descarto dejarlo morir, porque hoy no hay supervisor (G5).
- **El cupo por consumidor pasa a un puerto con adaptador en Firestore.** Descarto Redis o Memorystore: sería otra dependencia y otro servicio de pago, para una sola necesidad.
- **El registro de días cerrados se persiste.** Descarto agrandar la ventana de `paidQR`: la profundidad histórica de `paidQR` **no está documentada** y no se inventa.

### 3.3 DECISIONES PENDIENTES (solo las puede tomar Andres)

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| **D1** | Qué significa «el pase a producción» | (a) NovuChat cobrando a sus comercios por el contrato `/api/v1`, sin WhatsApp y sin consola publicada; (b) el dueño cobrando a clientes reales por WhatsApp; (c) las dos cosas. Además: el volumen esperado (cobros por día y pendientes a la vez) y el monto máximo por cobro. | **(a) primero**, con poco volumen y un tope de monto. No depende de Meta ni de WhatsAppModular, el contrato ya está ensayado con plata real (§6) y NovuChat ya está en producción esperando una URL pública (según su ficha). Eso obliga a cambiar el criterio de la Fase 3: «wa-bridge operativo» pasa a aplicar solo a (b). |
| **D2** | Arquitectura de despliegue | O1 a O5 (§3.1) | **O3** |
| **D3** | Habilitar el plan Blaze | Contradice la decisión 5 («sin billing mientras se pueda») | **Habilitarlo, con alerta de presupuesto (OPS-03).** O2, O3 y O5 lo exigen, y la API llama al banco. Spark además se rompe con ~17 cobros pendientes (G10). |
| **D4** | D-D: aislamiento entre cuentas | (i) una base compartida, resolviendo la deuda del bloque 3; (ii) **una base de datos de Firestore por cuenta** dentro del mismo proyecto, con IAM condicionado por base; (iii) un proyecto por cuenta | **(ii).** Mantiene «un proceso por cuenta» (decisión 16 y ADR-010), hace inalcanzable la deuda del bloque 3 y da mínimo privilegio real por cuenta (G12). Hay que verificar cómo declara `firebase.json` las reglas e índices por base antes de construir. |
| **D5** | La consola | (i) se queda local en la ThinkPad, apuntando a la API pública con un token del dueño de 32 caracteres o más; (ii) se publica en Hosting con Firebase Auth y una lista de UID, lo que exige la **excepción a la regla de dependencias** (§2.4 punto 10); (iii) la superficie del dueño queda detrás de IAP, como un servicio aparte | **(i) en la primera etapa.** Con D1 (a), la consola no necesita estar publicada. |
| **D6** | WhatsAppModular, docs/04 §2.3 | A: API HTTP en WhatsAppModular. B: usarlo como biblioteca | **A**, después de volver a verificar docs/04 §2 en la sesión de WhatsAppModular (§2.4 punto 7). B metería en este repositorio las credenciales de Meta. Con D1 (a) no bloquea. |
| **D7** | D-A y los supuestos D-B, D-C y D-F; si se migran los datos de la prueba a producción | Migrar o empezar de cero | **No migrar.** Producción empieza de cero; los exportes quedan archivados en `~/.manejoqr`. Para D-A, la opción (a) que ya recomienda ESTADO. |
| **D8** | Topes de producción | Monto máximo por cobro, cupo por consumidor por hora (hoy 60), máximo de cobros pendientes por cuenta | Fijarlos antes de liberar la barrera, con un techo en el código como el de `modo-prueba.ts`. |
| **D9** | Negarse a emitir QRs si no hay vigilancia | Si el último latido del satélite es más viejo que 3 × el intervalo, `crearCobro` responde `503 SERVICIO_NO_DISPONIBLE`, que ya está en el contrato y es reintentable | **Sí.** Cambia la disponibilidad que ve el consumidor a cambio de no emitir QRs que nadie mira (G5, G6). |
| **D10** | Canal de alertas operativas | Correo por Cloud Monitoring, o WhatsApp cuando exista `wa-bridge` | Correo primero (OPS-01/02). |
| **D11** | La habilidad `pase-a-produccion` dice que «la ejecución es humana» y que hay que entregarle los comandos a la persona. La regla global del dueño dice que Claude ejecuta con su «sí» y que él no opera. | — | Que se aplique la **regla del dueño**: Claude ejecuta con su OK en el chat, y el dueño solo aprueba lo que el sistema exige a una persona (el Environment `production` en GitHub). Queda escrito en el acta. |
| **D12** | Proyecto de staging | Un segundo proyecto de Firebase o ninguno | **Sí, uno**, con el banco en `mock`/`simulado` (A4: el banco no tiene cuenta de pruebas). Ahí corren DAST y la prueba de rollback. Producción sigue siendo el único lugar con banco real. |

**Gestiones con terceros (las hace Andres, y yo solo dejo preparado el texto):**
- ~~T1: pedir la llave definitiva (B3) por un canal que no sea un adjunto de correo.~~ **Ya no aplica** (2026-10-02): el banco no emite otra llave.
- T2: el catálogo de bancos (D9, no bloquea).
- **T3, nueva:** preguntar si la API de producción filtra por IP de origen. **Hay que tenerla resuelta antes del primer despliegue fuera de la ThinkPad.**
- WhatsAppModular y Meta: solo para D1 (b).

## 4. Pasos de implementación (un bloque = una rama = un PR)

### Se pueden hacer ya (no esperan decisiones ni al banco)

**4A. Documentación al día.**
- **Archivos:**
  - `docs/ESTADO.md`: bloque 3 fusionado (#70 y #71), y la línea 273.
  - `docs/05-firebase-demo.md`: §1, la API llama al banco; §5, la API oficial ya existe.
  - `docs/06-seguridad.md` §3: quitar «pino».
  - `docs/Integraciones/baneco/README.md`: V1 resuelto por P1–P9.
  - `docs/04-integracion-whatsapp-modular.md` §2: nota de que hay que volver a verificar.
  - `docs/Integraciones/baneco/01-preguntas-al-banco.md` §H: fila H4 con la pregunta T3.
- **Prueba:** ninguna de código. La compuerta del CI en verde.
- **Costo:** bajo, menos de una sesión.
- **No incluye** decisiones del dueño.

**4B. Coherencia de adaptadores en la barrera (G2).**
- **Archivo:** `packages/composicion/src/produccion.ts`. En `verificarProduccion`, justo después de `if (!hablaConProduccion(env)) return null;`, agregar:
  ```ts
  if (env['QR_PROVIDER'] !== 'baneco' || env['PAYMENT_WATCHER'] !== 'baneco') {
    return 'Contra producción, QR_PROVIDER y PAYMENT_WATCHER tienen que ser los dos baneco: ' +
      'un QR real vigilado por un watcher mock o simulado confirmaría pagos que el banco nunca vio.';
  }
  ```
- **Prueba:** en `produccion.test.ts`, que `(baneco,simulado)`, `(baneco,mock)`, `(mock,baneco)` y `(simulado,baneco)` sean rechazados, y que `(baneco,baneco)` con prueba y emulador se acepte. Correr además `npm run prueba:*` en seco, sin banco: no se rompe, porque los scripts ya fijan `baneco/baneco`.
- **Costo:** bajo.
- **No incluye** liberar la barrera, que es el bloque 4J.

**4C. Salud y robustez de los procesos (G5).**
- **`packages/functions/src/servidor.ts`:**
  - Al principio de `atender`, antes de `OPTIONS`: si `req.method === 'GET'` y el pathname es `/healthz`, responder `200` con `{"ok":true}` y las mismas cabeceras, sin leer el cuerpo ni el token.
  - En `crearServidor`, reemplazar `void atender(...)` por `atender(...).catch((causa: unknown) => {...})`. Si `!res.headersSent`, responder `500 {"error":{"codigo":"ERROR_INTERNO","mensaje":"Error interno."}}`. Registrar en `registro` solo `causa instanceof Error ? causa.name : 'desconocido'`, nunca el mensaje (puede llevar datos).
- **`packages/functions/src/main.ts` y `packages/baneco-satelite/src/main.ts`:** `process.on('unhandledRejection', …)` escribe una línea de error, sin el valor, y termina con `process.exit(1)`.
- **`packages/baneco-satelite/src/main.ts`:** envolver el cuerpo del `do { … }` en `try/catch`. Si atrapa algo, registra `✖ Pasada con excepción (<nombre>); se reintenta.` y sigue esperando el intervalo.
- **Pruebas:**
  - `servidor` responde 200 en `/healthz` sin token, y el cuerpo **no** contiene la versión.
  - Un handler que lanza produce un 500 con `ERROR_INTERNO` y el proceso sigue vivo.
  - `/healthz` con `POST` responde 405 o 404, igual que cualquier otra ruta.
  - En el satélite, sacar el `try` a una función `pasadaSegura(deps, …)` en `pasada.ts` para poder probar con un mock que lanza.
- **Costo:** bajo-medio.
- **No incluye** el latido, que es el bloque 4D.

**4D. Latido y lease del satélite (G5, G8, y la mitad técnica de D9).**
- **Archivos:**
  - `qr-core/src/ports/puertos.ts`: interfaz `VigilanciaStore` con:
    - `tomarOrRenovar(cuenta: string, titular: string, ahora: Date, duracionMs: number): Promise<Resultado<'TOMADO' | 'DE_OTRO', ErrorPuerto>>`
    - `ultimoLatido(cuenta: string): Promise<Resultado<Date | null, ErrorPuerto>>`
  - El mock en `ports/mocks.ts`, sus casos de contrato en `ports/contrato.ts`, y el adaptador `VigilanciaFirestore` en `firestore-store`, sobre el documento `configuracion/vigilancia-{cuenta}` con una transacción. Hay que decidir si el lease toma o no el estado `DE_OTRO` vencido: lo toma.
  - En el satélite: `titular = randomUUID()` y `duracion = 3 × intervalo`. Si el resultado es `DE_OTRO`, no corre la pasada y registra un aviso.
  - En `qr-core`, la función pura `vigilanciaVigente(ultimo: Date | null, ahora: Date, maximoMs: number): boolean`. **Usarla en `crearCobro` queda sujeto a D9.**
- **Pruebas:**
  - Contrato: dos titulares no pueden tener la vigilancia a la vez; al vencer, el otro la toma.
  - `npm run test:emulador` para el adaptador.
  - La regla catch-all de `firestore.rules` ya niega `configuracion/*` a los clientes.
- **Costo:** medio.
- **No incluye** el corte de emisión si D9 no está aprobado.

**4E. Cupo por consumidor compartido (G7).**
- **Archivos:**
  - `qr-core/src/ports/puertos.ts`: `interface CupoStore { consumir(clave: string, ahora: Date, ventanaMs: number, maximo: number): Promise<Resultado<boolean, ErrorPuerto>> }`.
  - El mock, sus casos de contrato y `CupoFirestore` en `firestore-store`: documento `cuposConsumidor/{consumidorId}` con una lista de marcas de tiempo de la ventana y una transacción. El máximo del código es 500 (`cupo-consumidor.ts:23`), así que el documento queda muy por debajo de 1 MiB.
  - `functions/src/api/cupo-consumidor.ts` pasa a usar el puerto.
  - **Si el puerto falla, se responde `503 SERVICIO_NO_DISPONIBLE` y no se emite** (se falla cerrado).
- **Pruebas:** el contrato con el máximo justo; que un rechazado no extienda el castigo (se conserva la semántica de `cupo-consumidor.ts:57-61`); dos instancias simuladas sobre el mismo almacén comparten el cupo; y el emulador.
- **Costo:** medio.

**4F. Cierre con registro persistente (G6, G15).**
- **Archivos:**
  - `qr-core/src/ports/puertos.ts`: `interface CierresStore { registrar(cuenta: string, dia: string, cerradoEn: Date): Promise<Resultado<void, ErrorPuerto>>; ultimoCerrado(cuenta: string): Promise<Resultado<string | null, ErrorPuerto>> }`.
  - El adaptador en Firestore, `cierresDiarios/{cuenta}_{yyyy-MM-dd}`, escrito con `create()`.
  - El satélite registra cada día con `cerroCompleto`.
  - Al arrancar, si `ultimoCerrado` es anterior a `hoy − DIAS_DE_CIERRE − 1`, registra `✖ Días sin cerrar desde <día>: conciliarlos a mano contra paidQR.` por cada día del hueco.
  - **No se agranda la ventana**: la profundidad de `paidQR` no está documentada.
- **Pruebas:** un hueco de 5 días produce 2 avisos y un cierre normal de 3 días; además, los casos de contrato y el emulador.
- **Costo:** bajo-medio.

**4G. La cuenta obligatoria fuera de la prueba (G13).**
- **Archivo:** `composicion/src/cuenta.ts`.
  - Nueva función `leerCuentaDeProduccion(env)` que lee `CUENTA_COBRO`, sin valor por defecto, y devuelve `null` si falta o si no es un alias válido.
  - `leerCuentaDeCobro` queda tal cual para la prueba.
  - La usa solo el modo de producción del bloque 4J.
- **Prueba:** que falte, que sea inválida y que sea válida.
- **Costo:** bajo.

**4K. Fixtures reales saneadas** (ESTADO, «Claude Code» 1). Solo hace falta que el dueño pague un QR de Bs 1: no es una decisión, es una acción suya. Cierra V4 y una condición de la Fase 3. **Costo:** medio.

### Dependen de una decisión del dueño

- **4H. Aislamiento entre cuentas (D4).**
  - Con (ii): `firebase.json` con una base por cuenta, `conectarFirestore` recibe el id de la base, y se aplica IAM condicionado por base. Antes hay que verificar en la documentación oficial cómo se declaran reglas e índices por base.
  - Con (i): resolver la deuda del bloque 3 (las firmas de `listarRecientes`, `listarPorEstado` y `buscarPorReferenciaQr` reciben `cuentaCobro`) y los avisos `SIN_DESTINO`.
  - **Costo:** medio.
- **4I. Autenticación de la consola (D5).**
  - Con (i): subir `MINIMO_TOKEN_DUEÑO` de 16 a 32 en `auth.ts:32` cuando se use el modo de producción, y no publicar nunca el bundle.
  - Con (ii): `verificadorFirebase(auth, uidsPermitidos: ReadonlySet<string>)`, que devuelve `null` si el UID no está; `firestore.rules` con `allow read: if false` para todo, porque la consola no lee Firestore directo (`demo-web` no tiene la dependencia de Firebase); y la excepción a la regla de dependencias aprobada por el dueño.
  - **Costo:** bajo con (i), alto con (ii).
- **4J. Imágenes de QR en almacenamiento compartido (G7).** **DECISIÓN PENDIENTE (regla #4):** la imagen identifica la cuenta de cobro, y guardarla en Firestore o en Storage es decidir dónde vive un dato bancario. docs/05 §1 ya prevé Storage. Opciones: Storage (necesita Blaze y un adaptador nuevo) o una colección `imagenesQr/{qrId}` de solo creación. **No se construye sin el OK.**
- **4L. Infraestructura y pipeline (D2, D3, D12).** Para O3:
  - `Dockerfile` en varias etapas para la API y para el satélite.
  - `.devsecops.yml` pasa a `multicloud`, con `produccion: true`, los componentes `consola` (`node`/`firebase`), `api` (`docker`/`cloudrun`) y `satelite-<cuenta>` (`docker`/`cloudrun`), y `dast: true` contra staging.
  - `firebase.json` con `hosting`.
  - `FIREBASE_DEPLOY_ONLY` con `hosting,firestore:rules,firestore:indexes`, **con los índices antes que el código**.
  - Secretos del banco en Secret Manager; WIF; Environments `staging` y `production`; un runbook de rollback (OPS-04); backups y PITR (DAT-04 y DAT-06); un uptime check sobre `/healthz` (OPS-01).
  - Pruebas de reglas con el emulador en el CI (DAT-01).
  - **Costo:** alto, unos 2 bloques. **Cada acción en GCP o en GitHub se pide en el chat.**
- **4M. Alertas (D10).** Satélite sin latido, cierre fallido, día sin cerrar, 401 repetidos del banco y revisiones en estado crítico. **Costo:** medio.
- **4N. Modo de producción en la barrera (va al final; depende de D1, D2, D8 y D9).**
  - En `produccion.ts`, una segunda rama: `MODO_PRODUCCION=1` exige que **no** haya emulador, `leerCuentaDeProduccion` válida, `MESSAGING_PROVIDER` distinto de `mock`, los dos adaptadores en `baneco` (4B), los topes de D8, y que las variables de `MODO_PRUEBA_PRODUCCION` no estén puestas a la vez. Con `MODO_PRODUCCION` y `MODO_PRUEBA_PRODUCCION` juntos no arranca.
  - **Pruebas:** la tabla completa de combinaciones.
  - Después: el acta del pase con la skill, el tag, la aprobación del Environment y **un primer cobro real de monto mínimo** por el contrato antes de abrirle el tráfico a NovuChat.

### Dependen de terceros

- T3 (IP) y T1 (llave): el banco.
- `wa-bridge` (D6): WhatsAppModular, más la aprobación de las plantillas de docs/04 §3 por Meta. **No se construye en el bloque 4** si D1 es (a): el contrato no lo usa.

### Qué no se construye y por qué

- **El webhook (B3):** D3 sigue vigente, y D1 del banco (las IPs) no tiene respuesta.
- **Una API para varias cuentas:** contradice la decisión 16 salvo que D4 diga otra cosa.
- **Renovar QRs desde el contrato:** está fuera del contrato (docs/10 §8).
- **Devoluciones automáticas:** son un no-objetivo (docs/01 §7). El doble pago de G6 se resuelve en revisión manual.
- **Ampliar la ventana del cierre diario:** no está documentado hasta dónde llega `paidQR`.

## 5. Pruebas

- **Nuevas:** las que se listan en cada bloque. Los casos límite que importan:
  - 4B: cualquier mezcla de adaptadores contra producción se rechaza.
  - 4D: el lease vencido justo en el límite (`>=` frente a `>`), y dos titulares en el mismo milisegundo.
  - 4E: el máximo exacto, y un fallo del almacén que termina en 503 y nunca en «hay cupo».
  - 4F: el hueco de días que cruza la medianoche de Bolivia (UTC−4) y no la de UTC.
  - 4C: `/healthz` no filtra nada, y una ruta parecida como `/healthz/x` responde 401.
- **De contrato:** cada puerto nuevo con su mock y su adaptador de Firestore, en `qr-core/src/ports/contrato.ts`.
- **De integración:** `npm run test:emulador` en 4D, 4E, 4F y 4H.
- **Regresión:** la prueba controlada (P1–P9) tiene que seguir arrancando sin cambios hasta 4N. Después de 4N, una corrida completa de P1–P9 en producción **con los topes nuevos**, como manda la decisión 16.

## 6. Riesgos y reversión

- **Datos:** 4D, 4E y 4F agregan colecciones (`configuracion/vigilancia-*`, `cuposConsumidor/*`, `cierresDiarios/*`). No migran nada. Se revierte con el revert del PR; los documentos quedan como basura inofensiva, cubiertos por la regla catch-all.
- **Índices:** si se despliega código antes que los índices, Firestore rechaza `listarPendientes` y **el satélite se queda sin vigilancia** (ESTADO:691-692). Por eso los índices van en un despliegue anterior, en 4L.
- **Barrera:** 4B solo endurece. 4N es el único cambio irreversible en la práctica, porque con él se cobra plata de terceros. Se revierte apagando `MODO_PRODUCCION`, y además los QRs emitidos se anulan con «cerrar la prueba» o con el satélite, que sigue vigilando hasta el `dueDate`.
- **Seguridad:** 4C abre una ruta sin autenticación (`/healthz`), que solo devuelve `{"ok":true}`. 4I (ii) toca la regla de dependencias. 4N, 4H y 4I los audita `security-auditor`.
- **Compatibilidad:** con 4E y D9, el consumidor ve más 503, que el contrato ya documenta como reintentables y seguros.

## 7. Criterio de terminado (por bloque de código)

```
npm run typecheck && npm run lint && npm test && npm run deps:check && npm run build
npm run test:emulador        # en los bloques que tocan firestore-store
./security-local.sh          # umbral MEDIUM, como en el bloque 3
```

Además, el checklist de CLAUDE.md (los 7 puntos), `docs/ESTADO.md` actualizado, y para 4N el acta del pase sin ningún control bloqueante en «Rojo».

## 8. Agente sugerido por paso

| Bloque | Implementa | Revisa |
|---|---|---|
| 4A | `backend-dev` | `code-reviewer` |
| 4B, 4G, 4N | `backend-dev` + `test-engineer` | `code-reviewer` + **`security-auditor`** |
| 4C, 4D, 4F | `backend-dev` + `test-engineer` | `code-reviewer` (+ `security-auditor` en 4D, porque toca la vigilancia de pagos) |
| 4E, 4H, 4I, 4J | `backend-dev` + `test-engineer` | `code-reviewer` + **`security-auditor`** |
| 4K | `backend-dev` (captura saneada) | `security-auditor` (no puede quedar ningún secreto en las fixtures) |
| 4L, 4M | `backend-dev` (el diseño previo con `arquitecto`) | `code-reviewer` + `security-auditor` |

**Orden sugerido:** 4A → 4B → 4C → 4G → 4F → 4D → 4E → 4K, que se puede hacer ya. Después, con D1–D5 decididas: 4H → 4I → 4J → 4L → 4M → 4N.

---

**Fuentes externas consultadas:**
- [Security for server client libraries (IAM de Firestore)](https://docs.cloud.google.com/firestore/native/docs/security/iam)
- [Manage databases (condiciones de IAM por base de datos)](https://firebase.google.com/docs/firestore/manage-databases)
- [Usage and limits de Firestore (cuota gratuita)](https://firebase.google.com/docs/firestore/quotas)
- [Planes de precios de Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
