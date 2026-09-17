/**
 * La plantilla del archivo de credenciales de una cuenta de cobro.
 *
 * Solo **nombres de variable** y marcadores `<…>`: acá no hay ni puede haber un
 * valor. El archivo se crea vacío de datos y lo completa el dueño en su editor;
 * ni esta herramienta ni Claude Code leen su contenido nunca (regla #2).
 */

/** Variables que el dueño tiene que completar, en el orden en que se piden. */
export const VARIABLES = [
  'BANECO_PROD_BASE_URL',
  'BANECO_PROD_USERNAME',
  'BANECO_PROD_PASSWORD',
  'BANECO_PROD_AES_KEY',
  'BANECO_PROD_ACCOUNT_CREDIT',
  'API_TOKEN_LOCAL',
] as const;

export function plantilla(alias: string): string {
  return [
    `# Credenciales de la cuenta de cobro «${alias}» en Banco Económico.`,
    '#',
    '# Completá cada <…> con tu editor. No pegues estos valores en un chat, ni en',
    '# el repositorio, ni en .env: este archivo vive fuera del repo, con permisos',
    '# 600, y no se versiona ni se sube a ninguna nube (CLAUDE.md, regla #2).',
    '#',
    '# La URL va tal cual la escribe el documento del banco (`apiGateway`).',
    '# No pruebes contraseñas al tanteo: el usuario API se bloquea con intentos',
    '# fallidos y se desbloquea en agencia (pregunta B4).',
    '',
    'BANECO_PROD_BASE_URL=<URL de producción del documento del banco>',
    'BANECO_PROD_USERNAME=<usuario API de esta cuenta>',
    'BANECO_PROD_PASSWORD=<contraseña del usuario API de esta cuenta>',
    'BANECO_PROD_AES_KEY=<llave AES de 32 caracteres de esta cuenta>',
    'BANECO_PROD_ACCOUNT_CREDIT=<número de la cuenta a la que se acreditan los pagos>',
    '',
    '# El mismo valor que VITE_API_TOKEN en packages/demo-web/.env.local:',
    'API_TOKEN_LOCAL=<token local de la consola>',
    '',
    '# Opcionales; el código tiene techos fijos por encima de esto:',
    '# PRUEBA_MONTO_CENTAVOS=100',
    '# PRUEBA_MAX_QRS=10',
    '',
  ].join('\n');
}

/**
 * Qué variables faltan: las que no están, las vacías y las que siguen con el
 * marcador `<…>` tal cual salió de la plantilla.
 *
 * Devuelve **nombres de variable**, nunca valores: es lo único que se imprime,
 * y es lo único que hace falta para saber si el archivo está listo.
 */
export function variablesSinCompletar(contenido: string): readonly string[] {
  const lineas = contenido.split('\n').map((l) => l.trim());
  return VARIABLES.filter((variable) => {
    const linea = lineas.find((l) => l.startsWith(`${variable}=`));
    if (linea === undefined) {
      return true;
    }
    const valor = linea.slice(variable.length + 1).trim();
    return valor === '' || (valor.startsWith('<') && valor.endsWith('>'));
  });
}
