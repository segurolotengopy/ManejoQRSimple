/**
 * La plantilla del archivo de credenciales de una cuenta de cobro.
 *
 * Solo **nombres de variable** y marcadores `<…>`: acá no hay ni puede haber un
 * valor. El archivo se crea vacío de datos y lo completa el dueño en su editor;
 * ni esta herramienta ni Claude Code leen su contenido nunca (regla #2).
 */

/**
 * Variables que el dueño tiene que completar, en el orden en que se piden.
 *
 * `BANECO_PROD_BASE_URL` **no** está: la URL del API Gateway es del banco, no
 * de cada cuenta, y vive en `baneco-gateway/src/config.ts`. Se puede poner
 * igual en el archivo, y manda sobre el valor por defecto, pero no hace falta.
 */
export const VARIABLES = [
  'BANECO_PROD_USERNAME',
  'BANECO_PROD_PASSWORD',
  'BANECO_PROD_AES_KEY',
  'BANECO_PROD_ACCOUNT_CREDIT',
  'API_TOKEN_LOCAL',
] as const;

const PREFIJO_TOKEN = 'CONSUMIDOR_TOKEN_';
const PREFIJO_CUENTA = 'CONSUMIDOR_CUENTA_';

export function plantilla(alias: string): string {
  return [
    `# Credenciales de la cuenta de cobro «${alias}» en Banco Económico.`,
    '#',
    '# Completá cada <…> con tu editor. No pegues estos valores en un chat, ni en',
    '# el repositorio, ni en .env: este archivo vive fuera del repo, con permisos',
    '# 600, y no se versiona ni se sube a ninguna nube (CLAUDE.md, regla #2).',
    '#',
    '# La URL del API Gateway no va acá: es del banco y la misma para toda',
    '# cuenta de cobro, así que ya está en el código.',
    '# No pruebes contraseñas al tanteo: el usuario API se bloquea con intentos',
    '# fallidos y se desbloquea en agencia (pregunta B4).',
    '',
    'BANECO_PROD_USERNAME=<usuario API de esta cuenta>',
    'BANECO_PROD_PASSWORD=<contraseña del usuario API de esta cuenta>',
    'BANECO_PROD_AES_KEY=<llave AES de 32 caracteres de esta cuenta>',
    'BANECO_PROD_ACCOUNT_CREDIT=<número de la cuenta a la que se acreditan los pagos>',
    '',
    '# El mismo valor que VITE_API_TOKEN en packages/demo-web/.env.local:',
    'API_TOKEN_LOCAL=<token local de la consola>',
    '',
    '# Consumidores del contrato de docs/10: un token por proyecto que cobre',
    '# por acá, de 32 caracteres o más. Es opcional — sin ninguno, /api/v1 no le',
    '# responde a nadie. El identificador sale del nombre de la variable, en',
    '# minúsculas (CONSUMIDOR_TOKEN_NOVUCHAT → «novuchat»).',
    '# CONSUMIDOR_TOKEN_NOVUCHAT=<token del consumidor novuchat>',
    '# Cada consumidor cobra en UNA cuenta y tiene que decir cuál: sin esta línea',
    '# la API no arranca. En este archivo, la única cuenta admitida es esta.',
    `# CONSUMIDOR_CUENTA_NOVUCHAT=${alias}`,
    '',
    '# Y si ese consumidor quiere que le avisemos cuando le pagan (docs/10 §4.6),',
    '# su URL https y el secreto con el que firmamos el aviso. Las dos o ninguna:',
    '# una URL sin secreto mandaría avisos que el consumidor no puede distinguir',
    '# de los que le invente cualquiera.',
    '# CONSUMIDOR_AVISO_URL_NOVUCHAT=<https://… del consumidor novuchat>',
    '# CONSUMIDOR_AVISO_SECRETO_NOVUCHAT=<secreto de firma de novuchat>',
    '',
    '# Opcionales; el código tiene techos fijos por encima de esto:',
    '# PRUEBA_MONTO_CENTAVOS=100',
    '# PRUEBA_MAX_QRS=10',
    '',
    '# Solo si el banco mueve su API Gateway; si no, dejalo comentado:',
    '# BANECO_PROD_BASE_URL=',
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

/**
 * Qué consumidores no dicen en qué cuenta cobran, o dicen otra que `alias`.
 *
 * Mira solo las líneas **no comentadas** `CONSUMIDOR_TOKEN_<X>=` con valor, y
 * para cada una devuelve `CONSUMIDOR_CUENTA_<X>` si esa línea falta, está vacía
 * o su valor no es `alias`. Devuelve **nombres de variable**, nunca valores:
 * el de una cuenta mal puesta podría ser un número de cuenta pegado por error.
 */
export function consumidoresSinCuenta(contenido: string, alias: string): readonly string[] {
  const lineas = contenido.split('\n').map((l) => l.trim());
  const valorDe = (variable: string): string | null => {
    const linea = lineas.find((l) => !l.startsWith('#') && l.startsWith(`${variable}=`));
    return linea === undefined ? null : linea.slice(variable.length + 1).trim();
  };

  const faltan: string[] = [];
  for (const linea of lineas) {
    if (linea.startsWith('#') || !linea.startsWith(PREFIJO_TOKEN)) {
      continue;
    }
    const igual = linea.indexOf('=');
    if (igual === -1 || linea.slice(igual + 1).trim() === '') {
      continue;
    }
    const sufijo = linea.slice(PREFIJO_TOKEN.length, igual);
    const cuenta = `${PREFIJO_CUENTA}${sufijo}`;
    if (valorDe(cuenta) !== alias && !faltan.includes(cuenta)) {
      faltan.push(cuenta);
    }
  }
  return faltan;
}
