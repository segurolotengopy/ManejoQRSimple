# Acta de pase a producción — ManejoQRSimple v0.1.0 (preparación)

> **Esta acta NO autoriza ningún pase.** Es la preparación: recorre el checklist canónico del
> estándar (`05-checklist-pase-a-produccion.md`, versión 2.3, de SeguridadGeneral) con la evidencia
> que se pudo reunir el 2026-10-01 y concluye que el pase **no procede todavía**. Se rehace, con el
> mismo formato, cuando se decida cómo corre el sistema en producción. El análisis de fondo, las
> opciones y el plan están en `docs/11-produccion-brechas-y-plan.md`.

| Campo | Valor |
|---|---|
| Proyecto | `manejoqrsimple` (según `.devsecops.yml`) |
| Versión propuesta / commit | `v0.1.0`, sobre `b45fc8e` (`origin/main`, 2026-10-01) |
| Modo de operación | A (repositorio público) |
| Tipo de pase | Primer pase |
| Componentes | ninguno desplegado: la API, el satélite y la consola corren a mano en la máquina del dueño |
| Run del pipeline | run 36960149104 (CI de `main`, en verde): https://github.com/segurolotengopy/ManejoQRSimple/actions/runs/36960149104 |
| Informe de seguridad local | `.security-reports/20261001-232920/resumen.md`: aprobado, CRITICAL 0, HIGH 0, MEDIUM 0, LOW 0 |
| Preparado por | Claude Code, con la habilidad `pase-a-produccion` |
| Aprueba | Andres (pendiente) |

## Resultado: NO PROCEDE

Hay **28 controles bloqueantes en Rojo o sin verificar**. Basta uno para impedir el pase. El
motivo de fondo no es una lista de tareas sueltas, sino que **hoy no existe una arquitectura de
producción**: no hay dónde desplegar, ni ambiente de staging, ni proveedor de nube en el
manifiesto, ni Environments, y la API escucha solo en `127.0.0.1`. Casi todos los rojos de las
secciones de nube, datos y operación salen de eso y se resuelven al decidir la arquitectura
(docs/11, D2).

Además hay tres hallazgos de código que habría que cerrar antes de abrir la barrera de la prueba
controlada, aunque se eligiera cualquier arquitectura (docs/11 §2.3):
- **G2, crítico.** La barrera T11 acepta `QR_PROVIDER=baneco` con `PAYMENT_WATCHER=simulado`, un QR
  real «pagado» con un documento escrito a mano. Hoy solo lo impiden los scripts de `npm`.
- **G3.** `verificadorFirebase` daría acceso de dueño a cualquier usuario del proyecto de
  Firebase, y las reglas dejan leer los cobros a cualquier usuario autenticado.
- **G5.** La API no responde `500` ante una excepción no prevista, el satélite no se reinicia
  solo y la API sigue emitiendo QRs cuando nadie los vigila.

## Versión propuesta

`v0.1.0`. El único tag del repositorio, `final-contrato`, no es semántico y no es alcanzable desde
`main`, así que no hay punto de partida. El historial usa Conventional Commits, con `feat` desde el
origen: eso es un `minor`, y como el sistema nunca estuvo en producción corresponde `0.1.0` y no
`1.0.0`.

## Qué incluiría el primer pase

El riel Baneco completo, probado con plata real de monto mínimo en dos cuentas de cobro (P1 a P9,
`docs/Integraciones/baneco/02-hallazgos-produccion.md`); el dominio puro `qr-core` con su máquina de
estados; el satélite de conciliación y cierre diario; la API con el contrato para consumidores
(`/api/v1`), su aviso firmado de confirmación y una cuenta de cobro por consumidor (bloques 1 a 3,
ensayados los dos primeros contra el banco real); la consola de revisión; y el estándar DevSecOps v2
en su versión 2.8. 1000 pruebas y 80 del emulador en verde.

## Resultado del checklist

Solo se cuentan los controles bloqueantes (nivel B). La columna «No verificado» cuenta como no
cumplida: «no verificado» nunca es «cumple».

| Sección | Bloqueantes | Verde | Rojo | No verificado | N/A |
|---|---|---|---|---|---|
| Repositorio y Git | 8 | 7 | 1 | 0 | 0 |
| Pipeline | 12 | 4 | 5 | 0 | 3 |
| Secretos e identidad | 10 | 2 | 3 | 1 | 4 |
| Aplicación | 12 | 5 | 6 | 0 | 1 |
| Datos | 6 | 0 | 3 | 1 | 2 |
| Operación | 8 | 0 | 8 | 0 | 0 |
| **Total** | **56** | **18** | **26** | **2** | **10** |
| Nube (sección 4) | — | — | — | — | N/A: el manifiesto declara `proveedor: ninguno`; se completa al elegir la arquitectura (docs/11, D2) |
| Modo B (sección 8) | — | — | — | — | N/A: el repositorio es público, Modo A |

## Checklist detallado

### Repositorio y Git

| ID | Nivel | Control | Estado | Evidencia |
|---|---|---|---|---|
| REP-01 | B | Manifiesto `.devsecops.yml` completo y validado | **Verde** | `validar-manifiesto.py`: «valida contra el esquema»; job `preparar` en verde (run 36960149104) |
| REP-02 | B | `main` protegida por ruleset con `compuerta-pr` | **Verde** | `gh api …/rulesets/20972960`: PR obligatorio, historial lineal, sin force push ni borrado, check `compuerta-pr`, sin bypass |
| REP-03 | B | Revisión obligatoria ≥ 1 | **Verde** | mismo ruleset: 1 aprobación de code owner, hilos resueltos, aprobación descartada al empujar |
| REP-04 | B | `CODEOWNERS` cubre lo sensible | **Verde** | `.github/CODEOWNERS` cubre `.github/`, `.devsecops.yml`, `firestore.rules`, `firebase.json`, `package*.json` y `docs/`; `infra/` y `Dockerfile*` no existen |
| REP-05 | B | Historial sin secretos | **Verde** | Gitleaks 8.30.1, informe `.security-reports/20261001-232920`: sin hallazgos; job de secretos del CI en verde |
| REP-06 | B | `.gitignore` base; sin `.env`, claves ni `tfvars` versionados | **Verde** | `git ls-files` filtrado por esos patrones: ninguno |
| REP-07 | R | Plantilla de PR, Conventional Commits y squash | **Verde** | `.github/pull_request_template.md`; el ruleset permite solo squash |
| REP-08 | B | Tag semántico por `release.yml`, release inmutable | **Rojo** | no hay `release.yml` ni tags semánticos; el único tag, `final-contrato`, no es semántico y no es alcanzable desde `main` |
| REP-09 | B | Dependabot activo según aplique | **Verde** | `.github/dependabot.yml`: `npm` y `github-actions` (docker y terraform no aplican) |
| REP-10 | R | Forks deshabilitados | **N/A** | solo Modo B; el repositorio es público (Modo A) |

### Pipeline

| ID | Nivel | Control | Estado | Evidencia |
|---|---|---|---|---|
| PIP-01 | B | Run completo en verde para el tag, fases 0 a 7 | **Rojo** | no hay tag ni workflow de despliegue; el CI de `main` (run 36960149104) tiene solo calidad y seguridad |
| PIP-02 | B | Acciones fijadas por SHA | **Verde** | `grep` sobre `.github/workflows`: ningún `uses:` sin SHA de 40 caracteres |
| PIP-03 | B | `permissions: contents: read` a nivel de workflow | **Verde** | `ci.yml`, `codeql.yml` y `_reusable-security.yml`: `{contents: read}` |
| PIP-04 | B | `concurrency` y `timeout-minutes` en todos los jobs | **Rojo** | los jobs `verify` y `gitleaks` de `ci.yml` no tienen `timeout-minutes` (`concurrency` sí). Corrección planificada |
| PIP-05 | B | `seguridad-estatica` sin CRITICAL/HIGH | **Verde** | job en verde (run 36960149104); Code Scanning 0, Dependabot 0 y secret scanning 0 alertas abiertas |
| PIP-06 | B | Cobertura ≥ `cobertura_minima` | **Rojo** | el manifiesto no declara `cobertura_minima` ni `vitest.config.ts` un umbral; medido: 73,52 % de sentencias y 68,15 % de ramas |
| PIP-07 | B | Imagen escaneada, SBOM y attestation | **N/A** | no se construye imagen hoy; pasa a Rojo si se elige Cloud Run u OCI (docs/11, D2) |
| PIP-08 | B | Imagen firmada y verificada con cosign | **N/A** | ídem PIP-07 |
| PIP-09 | B | DAST contra staging | **N/A** | `seguridad.dast: false` en el manifiesto, justificado hoy por no haber ambiente; pasa a Rojo con una API pública |
| PIP-10 | B | `probar-identidad` en verde para `production` | **Rojo** | no hay federación de identidad ni ese workflow |
| PIP-11 | B | CodeQL o Semgrep con reglas OWASP | **Verde** | CodeQL (`javascript-typescript` y `actions`) y Semgrep CE en verde (run 36960149104) |
| PIP-12 | R | Scorecard ≥ 7 (Modo A) | **No verificado** | no hay `scorecard.yml` en `.github/workflows` |
| PIP-13 | O | `harden-runner` (opcional) | **N/A** | no adoptado |
| PIP-14 | B | Rollback automático configurado | **Rojo** | no hay despliegue, y por lo tanto tampoco rollback |

### Secretos e identidad

| ID | Nivel | Control | Estado | Evidencia |
|---|---|---|---|---|
| SEC-01 | B | Inventario de secretos con propietario y fecha de rotación | **Rojo** | `docs/06` §2 lista los secretos, sin propietario ni fecha de rotación |
| SEC-02 | B | Ningún secreto prohibido en GitHub | **Verde** | `gh secret list`: sin secretos de repositorio; solo la variable `CODEQL_LENGUAJES` |
| SEC-03 | B | Secretos de producción en el Environment `production` | **Rojo** | `gh api …/environments`: no existe ninguno |
| SEC-04 | B | Secretos de aplicación en un gestor nativo | **Rojo** | viven en `~/.manejoqr/baneco-<cuenta>.env`, permisos 600, no en un gestor |
| SEC-05 | B | Secretos distintos entre staging y producción | **N/A** | no hay staging |
| SEC-06 | B | Secret scanning y push protection activos | **Verde** | `gh api …`: `secret_scanning` y `secret_scanning_push_protection` en `enabled` |
| SEC-07 | B | Federación GCP | **N/A** | no hay nube de despliegue; pasa a Rojo con D2 |
| SEC-08 | B | Federación AWS | **N/A** | no hay nube de despliegue |
| SEC-09 | B | Federación OCI | **N/A** | no hay nube de despliegue |
| SEC-10 | B | Ninguna rotación vencida | **No verificado** | no existe el inventario con fechas (SEC-01). Además, la llave AES de Baneco **no se puede rotar**: el banco no emite otra (ESTADO, decisión 26) |
| SEC-11 | R | Bypasses de push protection revisados | **No verificado** | el endpoint de bypasses respondió 404 con las credenciales de esta sesión |

### Aplicación

| ID | Nivel | Control | Estado | Evidencia |
|---|---|---|---|---|
| APP-01 | B | Control de acceso por ruta y por propiedad | **Verde** | contrato: pruebas negativas de 404 por cobro ajeno y de otra cuenta, y 401 (`consumidores.test.ts`, `enrutador.test.ts`). La superficie del dueño usa un único token (APP-07) |
| APP-02 | B | Fallos criptográficos | **Verde** | tokens con `timingSafeEqual`, sin contraseñas propias, Semgrep y CodeQL sin hallazgos |
| APP-03 | B | Inyección | **Verde** | Zod en todo borde externo, sin SQL; Semgrep y CodeQL en 0 |
| APP-04 | R | Diseño inseguro: límites con pruebas | **Verde** | topes de monto y de cantidad, cupo por consumidor y vigencia del QR, con pruebas |
| APP-05 | B | Mala configuración: CORS y cabeceras | **Rojo** | CORS de un solo origen (`API_ORIGEN_PERMITIDO`, por defecto `localhost`), sin cabeceras de seguridad; la API escucha en `127.0.0.1` por HTTP (docs/11, G4 y G16) |
| APP-06 | B | Componentes vulnerables | **Verde** | npm audit, OSV y Trivy en 0 (informe `20261001-232920`) |
| APP-07 | B | Fallos de autenticación | **Rojo** | el dueño usa un token fijo embebido en el bundle de la consola; `verificadorFirebase` no está cableado y daría acceso de dueño a cualquier usuario del proyecto (docs/11, G3, verificado en `auth.ts:101-112`) |
| APP-08 | B | Integridad de software y datos | **N/A** | sin `pickle` ni imágenes que firmar |
| APP-09 | B | Registro y monitoreo | **Rojo** | bitácora JSONL local sin `request_id`, sin retención definida y sin alertas fuera de la consola abierta (docs/11, G14) |
| APP-10 | R (B si la API acepta URLs) | SSRF | **Verde** | los destinos salientes son el banco y la URL https de aviso de cada consumidor, ambos de configuración, nunca del pedido (`destinos.ts`) |
| APP-11 | R (B si API pública) | Rate limiting | **Rojo** | el cupo por consumidor vive en la memoria del proceso y no hay WAF (docs/11, G7) |
| APP-12 | B | Dominio propio con TLS y HSTS | **Rojo** | no hay dominio: la API escucha en `127.0.0.1` por HTTP |
| APP-13 | B | Backups probados con restauración real | **Rojo** | no hay backups: los datos viven en un emulador local que exporta solo al salir (docs/11, G1) |
| APP-14 | B | Endpoint `/health` sin autenticación | **Rojo** | `grep` de `/health`, `/healthz` y `/readyz` en `packages/functions/src`: no existe; el enrutador exige token en todo |
| APP-15 | B | Errores sin trazas al cliente | **Verde** | `grep` de `.stack` en `packages/functions/src`: ninguno hacia la respuesta |
| APP-16 | R (B si aplica normativa) | Datos personales: inventario, base legal, retención | **No verificado** | las reglas 4 y 9 de `CLAUDE.md` minimizan los datos, pero no hay inventario de PII ni política de retención escrita |

### Datos

| ID | Nivel | Control | Estado | Evidencia |
|---|---|---|---|---|
| DAT-01 | B | Reglas de Firestore probadas con el emulador en CI | **Rojo** | `grep` de `rules-unit-testing` y `assertFails` en `packages` y `tools`: ninguna prueba de `firestore.rules` |
| DAT-02 | B | Reglas desplegadas idénticas a las del tag | **Rojo** | las reglas nunca se desplegaron: el emulador de la prueba usa `firebase.demo.json`, que no las carga |
| DAT-03 | B (RLS: R si no hay multiusuario) | PostgreSQL con usuario acotado y RLS | **N/A** | no hay PostgreSQL |
| DAT-04 | B | Backups automáticos con retención y PITR | **Rojo** | no hay Firestore real ni backups |
| DAT-05 | B | Cifrado en reposo con clave gestionada | **No verificado** | Firestore real todavía no se usa |
| DAT-06 | R | Exportación programada de Firestore | **Rojo** | no hay Firestore real |
| DAT-07 | B | Datos de producción no copiados a staging | **N/A** | no hay staging |

### Operación

| ID | Nivel | Control | Estado | Evidencia |
|---|---|---|---|---|
| OPS-01 | B | Monitoreo de disponibilidad externo con alerta | **Rojo** | no hay `PROD_URL` ni monitoreo |
| OPS-02 | B | Alertas de error, latencia y salud | **Rojo** | las alertas de revisión solo existen con la consola abierta (docs/11, G14) |
| OPS-03 | B | Presupuesto y alerta de costo | **Rojo** | no hay cuenta de nube con presupuesto |
| OPS-04 | B | Runbook de rollback por componente | **Rojo** | no existe `docs/produccion/runbook-rollback.md` |
| OPS-05 | B | Lista de contactos y canal de incidentes | **Rojo** | no existe |
| OPS-06 | B | Prueba de rollback en staging en los últimos 90 días | **Rojo** | no hay staging |
| OPS-07 | B | RTO y RPO definidos | **Rojo** | no definidos |
| OPS-08 | R | Dashboards mínimos | **Rojo** | no existen |
| OPS-09 | B | Retención de logs definida y sin PII | **Rojo** | sin retención definida (APP-09) |

## Riesgos aceptados

Ninguno. `seguridad.excepciones` del manifiesto está vacío, y este pase no se apoya en excepciones.

## Plan de rollback

**No definido todavía** (OPS-04, OPS-06 y PIP-14 en Rojo): depende de dónde corra el sistema. Lo que
existe hoy es el procedimiento de la prueba controlada: antes de apagar, el botón «Cerrar la
prueba» de la consola anula en el banco los QR que quedaron sin pagar, después de mirar si alguien
los pagó (`docs/Integraciones/baneco/03-prueba-en-produccion.md` §6). El runbook con comandos reales
por componente se escribe junto con la arquitectura elegida.

## Pendientes antes de aprobar

1. **Decisiones del dueño**, en `docs/11` §3.3: qué significa «el pase a producción» (D1) y la
   arquitectura de despliegue (D2) son las que destraban el resto; después el plan Blaze (D3), el
   aislamiento entre cuentas (D4), la consola (D5), WhatsAppModular (D6), los datos de la prueba (D7),
   los topes de producción (D8), negarse a emitir sin vigilancia (D9), el canal de alertas (D10),
   cómo se ejecuta el pase (D11) y un proyecto de staging (D12).
2. **Lo que se puede hacer ya, sin esperar decisiones** (docs/11 §4): corregir la documentación
   desactualizada, endurecer la barrera contra mezclas de adaptadores (G2), el endpoint de salud y la
   robustez de los procesos (G5), la cuenta obligatoria fuera de la prueba, el registro persistente
   del cierre, el latido y el lease del satélite, el cupo compartido, y los tiempos límite de dos
   jobs del CI (PIP-04).
3. **Datos reales del banco:** capturar y sanear respuestas reales de `statusQR` y `paidQR`, que
   requiere que el dueño pague un QR de Bs 1.
4. **Terceros:** preguntarle al banco si su API de producción filtra por IP de origen, que hay que
   saber antes del primer despliegue fuera de la máquina del dueño. La llave de producción
   definitiva **ya no se pide**: el banco no emite otra (ESTADO, decisión 26, 2026-10-02), así que la
   llave que circuló por correo es la de producción y no se rotará. Eso es un **riesgo aceptado con
   custodia explícita** que hay que registrar cuando se rehaga el acta.
5. **El criterio de salida de la Fase 3** (`docs/07`) incluye `wa-bridge` operativo. Si D1 es que
   NovuChat cobre por el contrato, `wa-bridge` no hace falta, y el criterio debe cambiarse
   explícitamente.

## Cómo se ejecutaría el pase, cuando proceda

La habilidad `pase-a-produccion` dice que la ejecución es humana. **Para este proyecto rige la
regla del dueño:** Claude Code ejecuta cada paso con el OK explícito de Andres en el chat y le
informa el resultado real; lo único que hace una persona es lo que el sistema exige que haga, por
ejemplo aprobar el Environment `production` en GitHub (D11). No se entregan ahora los comandos del
tag, porque el pase no procede.

## Decisión

- [ ] APROBADO: todos los bloqueantes en verde.
- [ ] APROBADO CON EXCEPCIONES: excepciones registradas en el manifiesto con vencimiento.
- [x] **RECHAZADO:** bloqueantes en rojo o sin verificar: REP-08, PIP-01, PIP-04, PIP-06, PIP-10, PIP-14, SEC-01, SEC-03, SEC-04, SEC-10, APP-05, APP-07, APP-09, APP-12, APP-13, APP-14, DAT-01, DAT-02, DAT-04, DAT-05, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-09.

| Rol | Nombre | Fecha | Firma |
|---|---|---|---|
| Líder técnico (ejecuta) | Claude Code, con el OK del dueño | 2026-10-01 | — |
| Arquitecto (autoriza) | Andres | pendiente | pendiente |
