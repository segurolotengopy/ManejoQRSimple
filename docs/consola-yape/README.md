# Capturas de la consola Yape BCP

Carpeta para las capturas de pantalla que aporta el dueño. Son la **fuente de
verdad del mapeo de selectores** del scraper (`docs/03-scraping-yape-bcp.md` §6):
sin captura, no se codifica.

Qué capturar (enmascarar saldos y datos de terceros antes de subir):

1. Listado de movimientos/abonos (con al menos un abono QR visible).
2. Detalle de un movimiento.
3. Pantalla de generación de QR de cobro, si la consola la tiene
   (habilitaría la Variante B de docs/03 §5).
4. Pantalla de sesión vencida / login (solo para que el scraper la DETECTE).

Nomenclatura: `NN-descripcion.png` (ej. `01-listado-movimientos.png`).
