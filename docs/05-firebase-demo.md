# 05 — Firebase: proyecto del demo

## 1. Proyecto

- **Proyecto Firebase:** ManejoQRSimple — cuenta **alberdi.andres@gmail.com**.
  - **project-id:** `manejoqrsimple`
  - **número de proyecto:** `658736385545`
  - Dato aportado por el dueño el 2026-08-27. Queda fijado en `.firebaserc`,
    así que ningún comando tiene que adivinarlo. Ni el id ni el número son
    secretos: identifican el proyecto, no dan acceso a él.
- **Plan:** empezar en Spark (gratuito). Functions HTTP puede requerir Blaze;
  si es el caso, decidir con el dueño ANTES de habilitar billing y registrar la
  decisión en ESTADO.md — mismo criterio de WhatsApp-Modular con GCP
  (su proyecto se mantuvo sin billing hasta necesitarlo).
- **Servicios:** Firestore, Cloud Functions (`packages/functions`), Hosting
  (`packages/demo-web`), Storage (imágenes de QR y comprobantes).
- Todo el desarrollo local corre contra los **emuladores**
  (`firebase emulators:start`); ninguna prueba automatizada toca el proyecto real.

## 2. Colecciones de Firestore

```
cobros/{cobroId}                 estado, cliente (mínimo), montoCentavos,
                                 concepto, qrVersion, vencimiento
cobros/{cobroId}/qrs/{version}   historial de QRs emitidos (append-only)
cobros/{cobroId}/evidencia/{n}   transiciones y hechos (append-only)
abonos/{hashMovimiento}          detecciones del watcher (dedup por id de doc)
comprobantes/{messageId}         entradas del webhook (dedup por id de doc)
```

Los ids de documento hacen la idempotencia estructural: escribir dos veces el
mismo `hashMovimiento` o `messageId` es un no-op detectable, no un duplicado.

## 3. Reglas de seguridad (principios)

- Cliente web (demo-web) autenticado con Firebase Auth (cuenta del dueño);
  nadie anónimo lee nada.
- `evidencia/*` y `qrs/*`: **create-only** (niega update y delete a todos los
  clientes; solo Functions con Admin SDK bajo las reglas del dominio).
- `abonos/*`: escribe únicamente la credencial del scraper (§4); demo-web solo lee.
- Datos del cliente final: nombre y teléfono, nada más (regla inviolable #9).

## 4. Credencial del scraper (mínimo privilegio)

Service account dedicada SOLO para `yape-scraper` con permiso de escritura
acotado (custom role o reglas por auth uid) a `abonos/*` y lectura de los cobros
activos. La llave JSON vive en `~/.manejoqr/` (nunca en el repo — cubierta por
`.gitignore` y `.gitleaks.toml`), se rota si se sospecha exposición y se revoca
al retirar el scraper. La promoción a OCI exige una llave DISTINTA para la VM,
revocable por separado.

## 5. Entornos

| Entorno | Dónde | Datos |
|---|---|---|
| local | emuladores Firebase | sintéticos, semilla en `scripts/seed.ts` |
| demo | proyecto ManejoQRSimple | cobros reales de demostración del dueño |

Sin entorno de producción hasta tener API oficial (alcance declarado del proyecto).

## 6. Despliegue

`firebase deploy` SOLO manual y pedido explícitamente por el dueño (está en la
lista deny de `.claude/settings.json`). CI valida; no despliega. Si más adelante
se automatiza, será con Workload Identity Federation como en WhatsApp-Modular
(docs/09 de ese repo), nunca con llaves estáticas en GitHub.
