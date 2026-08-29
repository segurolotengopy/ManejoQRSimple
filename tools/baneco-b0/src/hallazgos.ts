/**
 * Hallazgos de la corrida y el informe que producen.
 *
 * Cada hallazgo se ata a la pregunta del banco que responde
 * (`docs/Integraciones/baneco/01-preguntas-al-banco.md`), para que el informe
 * se pueda leer al lado de esa batería y se vea qué supuesto quedó confirmado,
 * cuál refutado y cuál sigue abierto.
 */

export type Veredicto = 'CONFIRMADO' | 'REFUTADO' | 'NO_CONCLUYENTE' | 'NO_EJECUTADO';

export type Hallazgo = {
  /** Pregunta de 01-preguntas-al-banco.md que este hallazgo toca (p. ej. `B2`). */
  readonly pregunta: string;
  readonly titulo: string;
  readonly veredicto: Veredicto;
  readonly detalle: string;
};

/** Un `responseCode` observado, para el catálogo empírico (pregunta E1). */
export type CodigoObservado = {
  readonly operacion: string;
  readonly codigo: string;
  readonly mensaje: string;
  readonly contexto: string;
};

const SIMBOLO: Readonly<Record<Veredicto, string>> = {
  CONFIRMADO: '✅',
  REFUTADO: '❌',
  NO_CONCLUYENTE: '⚠️',
  NO_EJECUTADO: '⏭️',
};

export function informe(args: {
  readonly fecha: Date;
  readonly baseUrl: string;
  readonly hallazgos: readonly Hallazgo[];
  readonly codigos: readonly CodigoObservado[];
}): string {
  const { fecha, baseUrl, hallazgos, codigos } = args;
  const cuando = fecha.toISOString();

  const filas = hallazgos
    .map(
      (h) =>
        `| ${h.pregunta} | ${h.titulo} | ${SIMBOLO[h.veredicto]} ${h.veredicto} | ${escapar(h.detalle)} |`,
    )
    .join('\n');

  const catalogo =
    codigos.length === 0
      ? '_No se observó ningún `responseCode` distinto de 0 en esta corrida._'
      : [
          '| Operación | `responseCode` | `message` | Contexto |',
          '|---|---|---|---|',
          ...codigos.map(
            (c) =>
              `| \`${c.operacion}\` | \`${c.codigo}\` | ${escapar(c.mensaje)} | ${escapar(c.contexto)} |`,
          ),
        ].join('\n');

  return `# 02 — Hallazgos de certificación (Hito B0)

> **Generado automáticamente** por \`npm run baneco:b0\` el ${cuando}.
> Ambiente: certificación (\`${baseUrl}\`). **Nunca se corre contra producción.**
> Este documento no contiene credenciales ni datos personales: la herramienta
> sanea toda respuesta antes de escribirla y aborta si detecta un secreto.

## Qué es esto

El Hito B0 contrasta contra el ambiente real del banco los supuestos con los que
se construyó \`@mqs/baneco-gateway\`. Cada fila apunta a la pregunta de
[\`01-preguntas-al-banco.md\`](./01-preguntas-al-banco.md) que responde — o que
deja abierta.

Un veredicto **REFUTADO** significa que el código está mal y hay que corregirlo
antes de seguir. **NO_CONCLUYENTE** significa que la corrida no alcanzó para
decidir y la pregunta sigue dependiendo de la respuesta escrita del banco.

## Hallazgos

| Pregunta | Qué se probó | Veredicto | Detalle |
|---|---|---|---|
${filas}

## Catálogo empírico de \`responseCode\` (pregunta E1)

La especificación v1.3.0 no incluye el catálogo de códigos de error. Se construye
observando el comportamiento real; toda respuesta distinta de 0 queda registrada acá.

${catalogo}

## Qué hacer con esto

1. Actualizar la columna "Respuesta" de \`01-preguntas-al-banco.md\` con lo que
   esta corrida haya resuelto, marcando que la fuente es observación empírica y
   no confirmación escrita del banco.
2. Corregir en \`packages/baneco-gateway\` cualquier supuesto **REFUTADO**.
3. Reemplazar las fixtures derivadas de la especificación por las capturas reales
   que dejó esta corrida en \`packages/baneco-gateway/fixtures/\`.
4. Tachar de la tabla V1–V5 del [README](./README.md) los puntos que quedaron
   confirmados.
`;
}

/**
 * Evita que un detalle rompa la tabla markdown.
 *
 * La barra invertida se escapa **primero**: si se escaparan antes los pipes, un
 * `\\` de la entrada quedaría comiéndose la barra que agregamos nosotros y el
 * pipe volvería a partir la celda (CodeQL `js/incomplete-sanitization`).
 */
function escapar(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
