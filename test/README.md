# Organización de las pruebas

Las pruebas están escritas en TypeScript y mantienen el runner nativo `node:test`. `npm run build:test` limpia su salida anterior y compila la aplicación y los tests con `test/tsconfig.json` en `.test-dist/`; los comandos de pruebas ejecutan el JavaScript generado. El build productivo continúa generando únicamente la aplicación en `dist/`.

## Unitarias (`unit/`)

No levantan una aplicación Nest ni requieren PostgreSQL. Las pruebas de adaptadores usan dobles de sus dependencias. Los casos de uso reciben implementaciones completas de sus puertos, con operaciones no configuradas que fallan explícitamente. Los fixtures de persistencia usan los tipos generados por Prisma.

| Archivo | Responsabilidad |
| --- | --- |
| `orders-domain.unit.test.ts` | Cálculo de cantidad y decisión de aceptación de órdenes, con solicitudes ya tipadas. |
| `orders-schema.unit.test.ts` | Validación y normalización de solicitudes. |
| `id-validator.unit.test.ts` | Formato y rango de IDs, incluida la pérdida de precisión en números JSON. |
| `orders-use-cases.unit.test.ts` | Coordinación de repositorios, inicialización, reintentos y cancelación. |
| `snapshot.unit.test.ts` | Transiciones de efectivo, posiciones y reservas; reconstrucción del estado. |
| `snapshot-order-mapper.unit.test.ts` | Conversión y validación de filas persistidas para reconstruir snapshots. |
| `account-snapshot-repository.unit.test.ts` | Lectura e inicialización sin escrituras o reconstrucciones innecesarias. |
| `portfolio.unit.test.ts` | Valuación y rendimientos a partir de escenarios de movimientos. |
| `portfolio-use-cases.unit.test.ts` | Búsqueda por usuario o cuenta, validación y resultados inexistentes. |
| `portfolio-repository.unit.test.ts` | Detección de cuentas ambiguas antes de consultar snapshots o cotizaciones. |
| `search-instruments.unit.test.ts` | Normalización, paginación y comunicación con el puerto de búsqueda. |
| `domain-exception-filter.unit.test.ts` | Traducción de errores a respuestas HTTP. |

## Funcionales e integración (`e2e/`)

Requieren PostgreSQL. Instrumentos y portfolio verifican los contratos HTTP sobre el dataset del challenge. Órdenes usa usuarios e instrumentos propios e incluye tanto recorridos HTTP completos como pruebas directas de integración con los repositorios.

La suite de órdenes se agrupa con `describe` por envío y transferencias, cancelación, concurrencia, IDs y valuación, snapshots, idempotencia e integración transaccional. Comparte el arranque y la limpieza de fixtures; cada escenario crea sus propios datos. Las carreras se provocan dentro de los tests correspondientes.

No se eliminan casos solo por compartir una regla: una prueba unitaria verifica la decisión aislada; una funcional verifica además HTTP, persistencia y efectos observables. Los fallos posteriores a una escritura, los fallos al guardar el snapshot y los reintentos después de rollback cubren garantías diferentes.

## Criterio para mantener la suite

Cada prueba debe expresar un comportamiento o una garantía observable. Variantes equivalentes se agrupan en tablas; las reglas de formato se detallan en unitarias y los recorridos HTTP verifican también el contrato y la ausencia o presencia de escrituras. Usamos Given/When/Then (preparar, ejecutar, comprobar) sin exigir comentarios mecánicos en cada bloque.

La revisión consolidó el mapeo de errores HTTP en una tabla, integró el historial vacío en la prueba de reconstrucción y eliminó la repetición del escenario de decimales conservando sus assertions. También retiró el mock de cotizaciones del repositorio de portfolio: esa consulta pertenece ahora al caso de uso mediante el puerto de instrumentos.

Se conservan por separado los fallos después de guardar, los fallos al escribir el snapshot, la inicialización revertida y el reintento después de rollback: comprueban puntos de fallo diferentes. La carrera forzada del índice único tampoco equivale a enviar solicitudes HTTP simultáneas, que pueden ejecutarse sin alcanzar el mismo interleaving.

Los escenarios existentes comprueban además que una cotización faltante no deja órdenes ni snapshots persistidos, que vender concurrentemente agota las acciones una sola vez y que consultar un portfolio con snapshot existente no abre una transacción. No se agregaron tests individuales para cada assertion.

## Tipos y utilidades compartidas

`npm run typecheck` verifica tanto la aplicación como las pruebas, y `npm run lint` aplica análisis de tipos a ambas. No se usan `any` ni conversiones de tipo para simular puertos incompletos. La regla `require-await` se desactiva solo en tests para permitir dobles asíncronos que devuelven fixtures.

`support/` contiene dobles tipados de puertos, validación Zod de respuestas HTTP, una aserción de presencia y mocks acotados a cada prueba para simular fallas de persistencia conservando la transacción real. Los imports terminan en `.js` porque apuntan al archivo que emitirá TypeScript.

## Ejecución

```sh
npm run test:unit
npm run test:db:up
# Una vez por cada base temporal nueva; omitir si ya tiene baseline:
npm run test:db:baseline
npm run test:db:migrate
npm test
# Solo órdenes, incluyendo dominio, esquema y casos de uso:
npm run test:orders
```

`npm test`, `test:e2e` y `test:orders` cargan la configuración de pruebas. `test:instruments` y `test:portfolio` conservan la configuración local de `.env`; la consulta de portfolio puede inicializar snapshots faltantes. Para ejecutar toda la suite sobre la base aislada, usar `npm test`. Las variables ya exportadas en la terminal tienen prioridad sobre los archivos de entorno.
