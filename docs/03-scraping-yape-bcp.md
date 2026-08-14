# 03 — Scraping de la consola Yape BCP

Cómo el sistema sabe que un cliente pagó, mientras no exista API oficial.
Este documento gobierna `packages/yape-scraper`. Sus reglas de contención
tienen la misma jerarquía que las reglas inviolables de `CLAUDE.md`.

## 1. Posición del scraper en el sistema

`yape-scraper` implementa el puerto `PaymentWatcher` (y opcionalmente
`QrProvider`, ver §5) usando **Playwright** contra la consola web de Yape/BCP a
la que el dueño accede como cliente. Es un **adaptador temporal** (ADR-002): el
día que haya API oficial se reemplaza sin tocar el dominio.

## 2. Reglas de contención (no negociables)

1. **SOLO LECTURA.** El scraper navega y lee. Ninguna rutina hace clic en
   acciones transaccionales (transferir, aprobar, autorizar, cambiar datos).
   Toda función nueva que requiera modificar algo en la consola se detiene y
   se consulta al dueño.
2. **El login es del dueño, siempre manual.** El scraper jamás conoce, pide,
   almacena ni tipea credenciales. Reutiliza la sesión vía `storageState` de
   Playwright generado por el dueño (ver §4).
3. **`storageState` fuera del repo:** vive en `~/.manejoqr/yape-storage-state.json`
   (o la ruta de `SCRAPER_STORAGE_STATE_PATH`), permisos `600`, listado en
   `.gitignore` y con regla propia en `.gitleaks.toml` por si alguien lo mueve.
4. **Sesión expirada ⇒ avisar, nunca reintentar login.** Sin la regla, un bug
   podría disparar bloqueos de cuenta del lado del banco.
5. **Minimización:** del movimiento detectado solo se extraen y persisten
   monto, moneda, fecha/hora, referencia/glosa y el hash de deduplicación.
   Sin capturas de pantalla persistidas, sin saldos, sin otros movimientos.
6. **Ritmo humano:** intervalo de sondeo configurable
   (`SCRAPER_POLL_INTERVAL_SECONDS`, por defecto 300), con jitter aleatorio y
   respeto de horarios configurables. Nada de martillar la consola.
7. **Tests contra fixtures, jamás contra la consola viva.** Las fixtures son
   HTML saneado (datos ficticios) guardado en el paquete. CI nunca toca al banco.
8. **No inventar selectores ni URLs** (regla inviolable #12): solo se codifica
   lo mapeado en §6 desde las capturas de `docs/consola-yape/`.

## 3. Consideraciones de términos de uso y riesgo

Automatizar la lectura de la propia banca en línea puede estar restringido por
los términos de servicio del BCP y puede disparar controles antifraude del
banco (sesiones simultáneas, patrones no humanos). Mitigaciones adoptadas:
solo lectura, sesión única, ritmo humano, ejecución desde ubicaciones estables
del dueño (ThinkPad; OCI solo tras decisión explícita). **Riesgo residual
aceptado por el dueño para el demo con su propia cuenta**; para producción, el
camino es la API oficial (docs/02 §5). Cualquier cambio de comportamiento de la
consola que sugiera bloqueo → detener el scraper y anotar en `docs/ESTADO.md`.

## 4. Sesión: generación y renovación del `storageState`

```bash
npm run scraper:login     # abre Chromium HEADED apuntando a la consola;
                          # el dueño se loguea a mano (usuario, clave, 2FA);
                          # al cerrar, se persiste el storageState en
                          # SCRAPER_STORAGE_STATE_PATH con permisos 600.
```

- La renovación es el mismo procedimiento cuando la sesión expira.
- Para la promoción a OCI (Fase 2): el `storageState` se genera en la laptop y
  se copia por SSH (`scp`) al destino — nunca por repositorio, nube de
  archivos ni chat.

## 5. Origen del QR de cobro (dos variantes, decidir tras el mapeo)

- **Variante A — carga asistida (por defecto, mínimo riesgo):** el dueño genera
  el QR en su app/consola Yape con la vigencia máxima permitida y lo registra
  en demo-web (imagen + monto + vencimiento). `QrProvider` = repositorio de QRs
  cargados.
- **Variante B — generación por consola:** si el mapeo (§6) confirma que la
  consola web permite generar QRs de cobro, `yape-scraper` puede automatizar esa
  generación. **Excepción acotada a la regla de solo lectura**, que requiere
  aprobación explícita del dueño por tratarse de una acción de escritura no
  transaccional (no mueve dinero). Se documenta como decisión en ESTADO.md
  antes de implementarse.

## 6. Mapa de la consola (PENDIENTE — se llena con capturas reales)

> **Estado: pendiente de las capturas del dueño en `docs/consola-yape/`.**
> Hasta completar esta sección, el scraper no se implementa. La sesión de mapeo
> se hace con las capturas + (opcional) inspección guiada con Playwright MCP
> desde la máquina del dueño.

Por cada vista, registrar: URL, propósito, selectores estables (privilegiar
`data-*`/aria/texto por sobre clases CSS generadas), campos disponibles del
movimiento, paginación, formato de fecha y de monto, y comportamiento de
expiración de sesión.

| Vista | URL | Qué se lee | Selectores | Notas |
|---|---|---|---|---|
| Login (solo detección de "sesión vencida") | _pendiente_ | — | _pendiente_ | El scraper NUNCA interactúa aquí |
| Listado de movimientos/abonos | _pendiente_ | fila: fecha, monto, glosa/ref, contraparte | _pendiente_ | base de `PaymentWatcher` |
| Detalle de movimiento | _pendiente_ | referencia completa | _pendiente_ | si el listado no alcanza |
| Generación de QR (si existe) | _pendiente_ | vigencia máx., imagen | _pendiente_ | habilitaría Variante B (§5) |

## 7. Requisitos de promoción a OCI (Fase 2, ADR-003)

Antes de mover el scraper a la nube, TODOS deben cumplirse:

- [ ] Contenedor dedicado, sin puertos públicos; administración solo por túnel SSH
      (patrón del laboratorio Evolution de WhatsApp-Modular).
- [ ] `storageState` cifrado en reposo en la VM (age/gocryptfs o equivalente)
      y `600`; copiado solo por `scp` desde la laptop.
- [ ] Credencial de Firestore de mínimo privilegio exclusiva del scraper
      (docs/05 §4), revocable de inmediato.
- [ ] Alerta al dueño (vía WhatsAppModular) por: sesión expirada, cambio de
      estructura de la consola, error repetido.
- [ ] Decisión registrada en ESTADO.md sobre destino: co-hosteo en VM existente
      (B) o VM E2.1.Micro dedicada (C), con su justificación.

## 8. Deduplicación y conciliación (contrato con el dominio)

El scraper emite `AbonoDetectado`:

```
hashMovimiento   SHA-256(fechaISO + montoCentavos + referenciaNormalizada)
montoCentavos    entero BOB
fechaHora        ISO 8601, America/La_Paz
referencia       glosa/referencia tal como la muestra la consola (recortada)
vistoEn          timestamp de la pasada del scraper
```

La conciliación contra cobros (`PAGO_DETECTADO → CONFIRMADO`) es del dominio
(`qr-core`), no del scraper: monto exacto, dentro de vigencia con tolerancia
configurada, sin hash duplicado. El scraper no decide; reporta.
