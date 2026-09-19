/**
 * Prepara la cuenta de cobro de una prueba en producción.
 *
 * La prueba se repite entera —P1 a P9— por cada cuenta de cobro nueva o cada
 * banco nuevo (`docs/Integraciones/baneco/03-prueba-en-produccion.md` §1), y
 * cada cuenta tiene su propio archivo de credenciales en `~/.manejoqr/`. Esta
 * herramienta crea ese archivo con la plantilla y los permisos correctos; los
 * valores los escribe el dueño en su editor, que es el único que los tiene.
 *
 * Qué **no** hace, a propósito: imprimir el contenido del archivo, pedir una
 * contraseña por consola, o sobrescribir un archivo que ya existe.
 *
 * Uso:
 *   npm run prueba:cuenta -- sucursal-2      # crea el archivo y dice qué falta
 *   npm run prueba:cuenta -- sucursal-2 --revisar   # solo dice qué falta
 *   npm run prueba:cuenta -- --listar        # qué cuentas hay preparadas
 *
 * Y una modalidad que no es para el dueño sino para `prueba:emulador`:
 *   node dist/main.js --dir sucursal-2       # imprime la carpeta de datos
 */

import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { archivoDeCredenciales, esAliasDeCuenta } from '@mqs/composicion';

import { plantilla, variablesSinCompletar } from './plantilla.js';

/** El mismo directorio que usan los scripts `prueba:*` y la bitácora. */
function directorio(): string {
  return process.env['MANEJOQR_DIR'] ?? join(homedir(), '.manejoqr');
}

const USO = [
  'Uso:',
  '  npm run prueba:cuenta -- <alias>             crea ~/.manejoqr/baneco-<alias>.env',
  '  npm run prueba:cuenta -- <alias> --revisar   dice qué variables faltan completar',
  '  npm run prueba:cuenta -- --listar            lista las cuentas preparadas',
  '',
  'El alias empieza con letra y sigue con minúsculas, números y guiones (hasta',
  '24 caracteres). Es un rótulo —"prod", "sucursal-2"—, y no puede ser el número',
  'de cuenta: se muestra en la consola, se guarda en el emulador y encabeza el',
  'informe que se archiva en el repositorio.',
].join('\n');

/**
 * El directorio de la prueba, verificado antes de escribir nada en él.
 *
 * Mismo criterio que la bitácora (docs/06 §3): tiene que ser un directorio de
 * verdad y del usuario del proceso. Si `~/.manejoqr` es un enlace —por ejemplo
 * a un volumen cifrado que hoy no está montado—, escribir igual dejaría las
 * credenciales en otro lado del que el dueño cree.
 */
async function directorioVerificado(): Promise<string> {
  const base = directorio();
  try {
    const info = await lstat(base);
    if (info.isSymbolicLink()) {
      throw new Error(`${base} es un enlace simbólico; apuntá MANEJOQR_DIR al directorio real`);
    }
    if (!info.isDirectory()) {
      throw new Error(`${base} existe y no es un directorio`);
    }
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new Error(`${base} es de otro usuario`);
    }
    // 700 también si ya existía con permisos más flojos.
    await chmod(base, 0o700);
  } catch (causa) {
    if (typeof causa === 'object' && causa !== null && 'code' in causa && causa.code === 'ENOENT') {
      await mkdir(base, { recursive: true, mode: 0o700 });
      return base;
    }
    throw causa instanceof Error ? causa : new Error('no se pudo preparar el directorio');
  }
  return base;
}

async function listar(): Promise<number> {
  const base = directorio();
  let nombres: string[];
  try {
    nombres = await readdir(base);
  } catch {
    console.log(`No hay ninguna cuenta preparada todavía (${base} no existe).`);
    return 0;
  }
  const alias = nombres
    .map((n) => /^baneco-(.+)\.env$/.exec(n)?.[1])
    .filter((a): a is string => a !== undefined)
    .sort();
  if (alias.length === 0) {
    console.log(`No hay ninguna cuenta preparada todavía en ${base}.`);
    return 0;
  }
  console.log(`Cuentas preparadas en ${base}:`);
  for (const a of alias) {
    console.log(`  ${a}`);
  }
  console.log('\nPara probar con una de ellas:  CUENTA=<alias> npm run prueba:api');
  return 0;
}

/** Qué falta completar. Imprime nombres de variable, nunca valores. */
async function revisar(ruta: string, alias: string): Promise<number> {
  let contenido: string;
  try {
    contenido = await readFile(ruta, 'utf8');
  } catch {
    console.error(`✖ No existe ${ruta}. Crealo con:  npm run prueba:cuenta -- ${alias}`);
    return 1;
  }
  const faltan = variablesSinCompletar(contenido);
  if (faltan.length === 0) {
    console.log(`✔ ${ruta} está completo.`);
    console.log(`  Probá con esta cuenta:  CUENTA=${alias} npm run prueba:api`);
    return 0;
  }
  console.log(`Faltan completar en ${ruta}:`);
  for (const variable of faltan) {
    console.log(`  ${variable}`);
  }
  console.log('\nAbrilo con tu editor y reemplazá cada <…> por su valor.');
  console.log(
    '  Si alguna de esas ya la completaste y tu valor real empieza con "<" y termina\n' +
      '  con ">", es un falso positivo: avisá en vez de cambiarlo, porque un login\n' +
      '  fallido acerca al bloqueo del usuario API (pregunta B4).',
  );
  return 2;
}

async function crear(ruta: string, alias: string): Promise<number> {
  try {
    await directorioVerificado();
  } catch (causa) {
    console.error(`✖ ${causa instanceof Error ? causa.message : 'no se pudo preparar el directorio'}.`);
    return 1;
  }
  try {
    // 'wx': si el archivo ya existe, no se toca. Adentro puede haber
    // credenciales en uso, y pisarlas sería destruir lo que no se puede leer.
    await writeFile(ruta, plantilla(alias), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (causa) {
    const codigo = typeof causa === 'object' && causa !== null && 'code' in causa ? causa.code : null;
    if (codigo === 'EEXIST') {
      console.log(`El archivo ${ruta} ya existe; no se toca.`);
      return revisar(ruta, alias);
    }
    console.error(`✖ No se pudo crear ${ruta}: ${causa instanceof Error ? causa.message : 'error desconocido'}`);
    return 1;
  }
  // La ruta resuelta, no la que se tipeó: si hubiera enlaces por el medio, el
  // dueño tiene que ver dónde quedaron de verdad sus credenciales.
  console.log(`✔ Creado ${await realpath(ruta)} (permisos 600).`);
  console.log('\nAhora, con tu editor, reemplazá cada <…> por su valor:');
  for (const variable of variablesSinCompletar(plantilla(alias))) {
    console.log(`  ${variable}`);
  }
  console.log('\nCuando termines:');
  console.log(`  npm run prueba:cuenta -- ${alias} --revisar     (dice si quedó algo sin completar)`);
  console.log(`  CUENTA=${alias} npm run prueba:emulador`);
  console.log(`  CUENTA=${alias} npm run prueba:api`);
  console.log(`  CUENTA=${alias} npm run prueba:satelite`);
  console.log('  npm run prueba:consola');
  return 0;
}

/**
 * La carpeta de datos de una cuenta, impresa sola en la salida estándar.
 *
 * La usa `prueba:emulador`, que es el único de los cuatro procesos que no pasa
 * por Node y no podría validar el alias por su cuenta. Sin esto, un `CUENTA`
 * mal escrito levanta un emulador vacío sobre una carpeta distinta y nadie se
 * entera: los cobros del día anterior quedan fuera de vista y "Cerrar la
 * prueba" no llega a anular en el banco los QRs que nadie pagó.
 */
function carpetaDeDatos(alias: string): number {
  process.stdout.write(`${join(directorio(), `emulador-${alias}`)}\n`);
  return 0;
}

async function main(): Promise<number> {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes('--ayuda') || argumentos.includes('-h')) {
    console.log(USO);
    return 0;
  }
  if (argumentos.includes('--listar')) {
    return listar();
  }
  const alias = argumentos.find((a) => !a.startsWith('--'));
  if (argumentos.includes('--dir')) {
    if (alias === undefined || !esAliasDeCuenta(alias)) {
      console.error(
        `✖ «${alias ?? ''}» no sirve como alias de cuenta.\n` +
          '  El alias empieza con letra y sigue con minúsculas, números y guiones.\n' +
          '  Arrancá las cuatro terminales con el mismo CUENTA=<alias>.',
      );
      return 1;
    }
    return carpetaDeDatos(alias);
  }
  if (alias === undefined) {
    console.error('✖ Falta el alias de la cuenta.\n');
    console.error(USO);
    return 1;
  }
  if (!esAliasDeCuenta(alias)) {
    console.error(`✖ «${alias}» no sirve como alias.\n`);
    console.error(USO);
    return 1;
  }
  const ruta = join(directorio(), archivoDeCredenciales(alias));
  return argumentos.includes('--revisar') ? revisar(ruta, alias) : crear(ruta, alias);
}

process.exit(await main());
