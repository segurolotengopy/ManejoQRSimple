# 02 — QR Simple / Pagos QR en Bolivia

Contexto del estándar sobre el que cobra este sistema. Relevado el 14-ago-2026
con fuentes públicas del BCB y ASFI; ver "Advertencia sobre cifras" en
`00-INDICE.md`.

## 1. Qué es

Bolivia opera un **estándar universal e interoperable de pagos QR** impulsado
por el Banco Central de Bolivia ("Pagos Inmediatos QR BCB"), compatible con
todos los QR implementados por el sistema financiero: bancos, cooperativas,
entidades de vivienda e instituciones de desarrollo. Un QR generado desde la
billetera de una entidad (en nuestro caso, **Yape de BCP Bolivia**) puede ser
pagado desde la app de **cualquier otra** entidad. El QR codifica los datos del
beneficiario (nombre, cuenta, entidad financiera) y, opcionalmente, monto y
vigencia. "QR Simple" es la denominación comercial extendida en el ecosistema
BCP para este tipo de cobro.

Implicación de diseño clave: **no controlamos desde qué app pagará el cliente.**
La confirmación no puede depender de la app del pagador; por eso la fuente de
verdad es el abono acreditado en la cuenta receptora (consola Yape BCP).

## 2. Ciclo de vida del QR que nos importa

- **QR con monto fijo:** un cobro puntual, típico de este sistema. El QR queda
  consumido/inutilizable tras el pago (comportamiento a confirmar en la consola
  real — mapear en docs/03).
- **QR sin monto (reutilizable):** el pagador digita el importe. Útil como QR
  "permanente" del comercio. Menos control de conciliación: dos clientes pueden
  pagar montos iguales el mismo día → la conciliación por monto exacto se
  degrada. El sistema lo soporta como variante, con ventana de conciliación más
  estricta y desempate por referencia/glosa.
- **Vigencia:** el QR se emite con fecha de vencimiento. El requisito del dueño
  es la vigencia **más extensa que la billetera permita** (el máximo real se
  verifica en la consola al generar; no asumir un valor). Al vencer sin pago:
  estado `VENCIDO` → renovación versionada (`qrVersion + 1`) → reenvío por
  WhatsApp, sin crear un cobro nuevo.

## 3. Datos mínimos que el sistema registra por QR emitido

```
qrVersion            entero incremental por cobro
imagenRef            referencia al PNG/JPG del QR en Storage (nunca inline en Firestore)
montoCentavos        entero, BOB; null si es QR sin monto
fechaEmision         ISO 8601, zona America/La_Paz
fechaVencimiento     ISO 8601 — obligatoria (regla inviolable #6)
origen               'carga-manual' | 'consola-asistida' (docs/03 §5)
hashImagen           SHA-256 del archivo, para integridad de evidencia
```

## 4. Límites y cifras — VERIFICAR antes de usar

Estos valores NO están fijados en este documento a propósito: dependen de
normativa BCB/ASFI y de políticas del BCP que cambian, y la consola real es la
fuente operativa de verdad. Al mapear la consola (docs/03), registrar acá:

- [ ] Vigencia máxima de un QR generado desde Yape BCP (requisito: usar el máximo).
- [ ] Monto máximo por transacción QR y por día (normativa + política BCP).
- [ ] Comisiones aplicables al receptor, si las hay.
- [ ] Comportamiento del QR con monto tras el primer pago (¿se invalida?).
- [ ] Datos visibles del pagador en el detalle del movimiento (nombre, banco
      origen, glosa/referencia) — determinan la calidad de la conciliación.
- [ ] Normativa aplicable: reglamento de instrumentos electrónicos de pago del
      BCB y disposiciones sobre el estándar QR (citar resolución exacta cuando
      se tenga el documento en `docs/Integraciones/`; **nunca citar de memoria**
      un número de resolución — misma regla que la matriz de cumplimiento de
      segurolotengo-demo).

## 5. Camino a la API oficial

El BCB anunció **OpenBCB** (oct-2025), una iniciativa de APIs estandarizadas
para pagos QR e inmediatos. Cuando exista acceso formal (vía BCP o vía la
plataforma que el BCB disponga), la migración está prevista por ADR-002:
adaptadores nuevos de `PaymentWatcher` y `QrProvider`, mismos tests de
contrato, dominio intacto. Los avances se registran en `docs/ESTADO.md` y la
documentación oficial que se obtenga va en `docs/Integraciones/`.

## Fuentes

- BCB — Pagos QR BCB Bolivia: https://www.bcb.gob.bo/?q=pagos_qr_bcb_bolivia
- ASFI — "El uso del QR ha dinamizado el sistema de pagos en Bolivia" (jul-2025):
  https://www.asfi.gob.bo/sites/default/files/2025-07/El%20uso%20del%20QR%20ha%20dinamizado%20el%20sistema%20de%20pagos%20en%20Bolivia.pdf
- Lanzamiento OpenBCB (oct-2025): https://mobiletime.la/noticias/20/10/2025/bolivia-lanza-openbcb/
