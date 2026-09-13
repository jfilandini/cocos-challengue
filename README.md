# Cocos Challenge Backend

Base inicial con Node.js 24, TypeScript, NestJS 11, Prisma 7 y PostgreSQL 17.
API para buscar instrumentos financieros, consultar portfolios, enviar y cancelar órdenes, y registrar movimientos de fondos.

## Ejecutar con Docker

Requisitos: Docker Desktop encendido (o Docker Engine con Compose).

```sh
cp .env.example .env
docker compose up -d --wait db
# Solo la primera vez, sobre la base original sin migraciones:
docker compose run --build --rm api npm run db:baseline
docker compose up --build -d --wait
curl http://localhost:3000/health
```

Respuesta esperada: `{"status":"ok","database":"up"}`.

Si el puerto 3000 está ocupado, cambiar `API_PORT` en `.env` (por ejemplo, a 3001) y usar ese puerto en la URL. `PORT` configura el arranque local de Node; dentro del contenedor siempre se usa 3000.

- `api`: compila y ejecuta la aplicación en el puerto 3000; espera a que PostgreSQL esté disponible.
- `db`: PostgreSQL en el puerto 5432, con volumen persistente `postgres_data`.
- Dentro de Compose la API se conecta a `db:5432`; desde la computadora, Prisma usa `localhost:5432`.
- Los puertos se publican solamente en localhost. Las credenciales de ejemplo son para desarrollo local.

```sh
docker compose logs -f api
docker compose ps
docker compose down
```

`down` conserva los datos. Docker ejecuta el SQL original de `docker/postgres/database.sql` solo cuando el volumen está vacío. El baseline se registra una sola vez con el comando indicado arriba. Al arrancar, la API ejecuta `prisma migrate deploy` y aplica únicamente las migraciones pendientes antes de iniciar NestJS. No vuelve a cargar el dataset en bases existentes.

Después de cambiar el código, ejecutar nuevamente `docker compose up --build -d --wait`.

## Desarrollo local

Usar Node.js 24 (`nvm use` si tenés nvm), y copiar `.env.example` a `.env`.

```sh
docker compose up -d db --wait
npm ci
# Solo si esta base original todavía no tiene baseline registrado:
npm run db:baseline
npm run build
npm start
```

Si la API de Docker está corriendo, detenerla con `docker compose stop api` antes de usar su puerto desde Node local.

Para recompilar automáticamente, ejecutar `npm run build:watch` en una terminal y `npm run dev` (o `npm run start:dev`) en otra, después del primer build. Este último reinicia Node cuando cambia el código compilado.

### Lint

La configuración `eslint.config.mjs` usa ESLint 10 y typescript-eslint con análisis de tipos. Revisa código TypeScript, tests TypeScript y configuración; excluye `dist`, `.test-dist`, `node_modules`, cobertura y el cliente Prisma generado.

```sh
# Después de npm ci, generar el cliente para disponer de sus tipos:
npm run prisma:generate
npm run lint
# Aplicar las correcciones automáticas disponibles:
npm run lint:fix
```

Se detectan promesas sin manejar, usos incorrectos de async, variables sin usar e imports de tipos inconsistentes. Los archivos de dominio y aplicación no pueden importar NestJS, Prisma, infraestructura ni código generado. El comando falla ante errores o advertencias. El formato con Prettier queda fuera de este lint inicial.

### Verificación integral y calidad de código

Para validar el proyecto de forma completa antes de commitear o entregar cambios:

```sh
npm run check
```

Este comando ejecuta en secuencia:

1. `npm run lint`: Chequeo de ESLint 10 con reglas arquitectónicas estrictas (aislamiento de capas de dominio y aplicación sin dependencias de infraestructura ni frameworks) y tipos.
2. `npm run typecheck`: Validación estricta de tipos de la aplicación y los tests con el compilador de TypeScript (`tsc --noEmit`).
3. `npm run test:unit`: Suite de pruebas unitarias sobre cálculos de portfolio, órdenes y lógica de negocio.

> **Decisión de diseño en desarrollo local:**
> Se optó deliberadamente por mantener `npm run dev` / `start:dev` desacoplado de la ejecución obligatoria de tests y linter para optimizar el ciclo de retroalimentación rápida (*inner dev loop*). Exigir validaciones completas y libres de advertencias en cada arranque local añade latencia y genera fricción artificial durante etapas de refactorización o experimentación.
>
> **Roadmap para producción / trabajo en equipo:**
> En un entorno colaborativo productivo, esta disciplina se automatiza en dos niveles:
> - **Git hooks locales:** Mediante `husky` y `lint-staged` en el hook `pre-commit` (para analizar únicamente archivos modificados en *staged*) y `pre-push` (para pruebas unitarias).
> - **Integración Continua (CI/CD):** Pipeline de GitHub Actions ejecutando `npm run check` y pruebas de integración ante cada Pull Request antes del merge a la rama principal.

```sh
npm run prisma:validate
npm run typecheck
npm run build
npm run prisma:studio
```

## Endpoints

Los ejemplos usan `http://localhost:3000`; ajustar el puerto según `API_PORT`.

Los IDs de usuario, instrumento y orden deben ser enteros positivos de hasta `9223372036854775807` (BIGINT de PostgreSQL). Enviar IDs en JSON como strings decimales, por ejemplo `"9007199254740993"`, para conservar su precisión. Por compatibilidad se aceptan también números enteros positivos hasta `Number.MAX_SAFE_INTEGER` (`9007199254740991`); números mayores se rechazan con HTTP 400 antes de convertirlos a bigint. Los IDs en texto no admiten espacios, ceros iniciales, signos ni notación hexadecimal o exponencial. Esta validación no se aplica al número de cuenta, que conserva sus ceros iniciales.

### Estado del servicio — `GET /health`

Comprueba la conexión con PostgreSQL. Devuelve HTTP 200 con `{"status":"ok","database":"up"}` o HTTP 503 si la base no está disponible.

```sh
curl 'http://localhost:3000/health'
```

### Buscar instrumentos financieros — `GET /instruments`

```sh
# Primera página, hasta 10 resultados
curl 'http://localhost:3000/instruments?query=ypf&page=1&limit=10'
# Segunda página de coincidencias por nombre
curl 'http://localhost:3000/instruments?query=molin&page=2&limit=2'
```

Usar el puerto configurado en `API_PORT` (3001 si se eligió ese valor).
El parámetro `query` es obligatorio: debe contener texto luego de quitar espacios al inicio y al final. Busca coincidencias parciales por ticker **o** nombre, sin distinguir mayúsculas y minúsculas. Los acentos se conservan y los caracteres `%`, `_` y `\` se buscan literalmente.

La búsqueda es **paginada**:

| Parámetro | Descripción |
| --- | --- |
| `query` | Ticker o nombre a buscar; obligatorio. |
| `page` | Página solicitada, entero positivo; por defecto `1`. |
| `limit` | Resultados por página, entero entre `1` y `100`; por defecto `20`. |

Las pruebas funcionales de instrumentos usan la base migrada con el dataset del challenge y no modifican datos:

```sh
docker compose up -d db --wait
npm run db:migrate
npm run test:instruments
```

## Estructura y decisiones

Arquitectura hexagonal organizada por funcionalidad. Dominio y aplicación no dependen de NestJS, Prisma ni infraestructura. `instruments` sirve como ejemplo:

```text
src/instruments/
  domain/instrument.ts                        Modelo de dominio
  application/search-instruments.use-case.ts   Validación y coordinación
  application/ports/instrument.repository.ts   Contrato de persistencia
  infrastructure/http/                        Controller y DTOs
  infrastructure/persistence/                 Implementación con Prisma
  instruments.module.ts                       Composición de dependencias
```

- **Entrada HTTP:** el controller delega al caso de uso y mapea el resultado al DTO de respuesta, convirtiendo IDs a strings. Los DTOs tipan la salida y documentan Swagger; Zod valida la entrada en el caso de uso. El filtro global traduce errores a HTTP.
- **Aplicación y persistencia:** `SearchInstrumentsUseCase` depende de `InstrumentRepository`. El adaptador Prisma implementa la búsqueda y convierte los datos persistidos a modelos propios; el módulo NestJS conecta ambas partes mediante inyección de dependencias.
- **Pruebas:** esta separación permite probar el negocio sin NestJS ni PostgreSQL y verificar los adaptadores con integración. Ver [organización de pruebas](test/README.md).

La infraestructura compartida gestiona la conexión Prisma y el health check. `prisma/schema.prisma` mapea las tablas existentes mediante `@map`; el cliente se genera durante el build. El SQL original se conserva en `docker/postgres/database.sql` y los cambios de esquema se versionan en `prisma/migrations/`.

### Gestión del esquema con Prisma Migrate

Docker inicializa PostgreSQL con el archivo original del challenge (`docker/postgres/database.sql`), conservado sin cambios. Prisma administra únicamente la evolución posterior:

1. `0_challenge_base` contiene el esquema original, sin datos. `db:baseline` verifica que la base coincida con `prisma/baseline.prisma` y lo registra como aplicado, porque Docker ya creó las tablas. Esta migración también permite reconstruir el esquema en la base sombra de Prisma durante el desarrollo.
2. `20260911010000_application_schema` aplica las diferencias hacia `schema.prisma`: IDs, referencias y secuencias BIGINT; importes de precisión 18,2; índices; `transactionid` único y `originalrequest`; y `account_snapshots`. Se ejecuta en una transacción y conserva los datos existentes.

La migración de IDs y referencias de `INT` a `BIGINT`, junto con la ampliación de sus secuencias, contempla un escenario productivo con un alto volumen acumulado de órdenes. Evita que la generación de identificadores quede limitada al máximo positivo de `INT` (2.147.483.647), conservando los IDs existentes y la continuidad de los contadores.

El baseline es un paso explícito de inicialización, ejecutado una sola vez por base. Después, `npm start` y `npm run start:dev` ejecutan únicamente `npm run db:migrate` antes de iniciar Node. En Docker, el comando es `npm run db:migrate && exec node dist/main.js`. Prisma consulta su historial, aplica las migraciones pendientes y utiliza su bloqueo nativo para evitar aplicaciones simultáneas. Si falla, la API no arranca. En modo watch, las migraciones se revisan al iniciar el comando, no en cada reinicio interno de Node.

Si se omite el baseline sobre una base inicializada con el SQL original, Prisma rechazará la adopción de esa base no vacía. Ejecutar `db:baseline` antes del primer arranque; no repetirlo en bases que ya tienen historial.

Las columnas originales conservan su nulabilidad en PostgreSQL. Los campos requeridos en `schema.prisma` expresan el supuesto semántico de la aplicación de que esos datos están presentes; no se agregan restricciones `NOT NULL` sobre ellos. La tabla nueva `account_snapshots` sí define sus campos obligatorios.

Para cambios futuros, editar `schema.prisma`, generar la migración con `npm run db:migrate:dev -- --create-only --name nombre_del_cambio` y revisar el SQL antes de aplicarlo. Prisma puede volver a proponer `SET NOT NULL` por esa diferencia intencional: retirarlos para conservar esta decisión, aplicar con `npm run db:migrate` y versionar el SQL junto con el esquema. En despliegues usar `npm run db:migrate`. `prisma generate` solo genera el cliente; no modifica la base.

#### Bases existentes modificadas manualmente

Una base con el SQL original debe ejecutar una vez `npm run db:baseline`; luego puede iniciar la app normalmente. Si ya recibió los cambios de la aplicación sin historial Prisma, hacer un backup, revisar las diferencias con `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` y alinearla con el esquema final sin borrar datos. Solo después de comprobar que los cambios de ambas migraciones están presentes, registrar ambas como aplicadas. La comparación con Prisma mostrará los `SET NOT NULL` omitidos intencionalmente; no aplicarlos:

```sh
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
npx prisma migrate resolve --applied 0_challenge_base
npx prisma migrate resolve --applied 20260911010000_application_schema
npm run db:migrate
```

No registrar una migración como aplicada si sus cambios no están presentes. La diferencia intencional de nulabilidad no debe confundirse con cambios pendientes. La aplicación presupone valores presentes en los campos requeridos de Prisma; esa definición no impide por sí sola insertar NULL mediante SQL. No se requiere borrar el volumen.

El dataset conserva la inconsistencia conocida del usuario 1: BMA tiene una compra ejecutada de 20 acciones y una venta ejecutada de 30. El tratamiento se documenta en la sección Portfolio.

La prueba funcional de envío de órdenes está en `test/e2e/orders.e2e.test.ts` y usa una base de pruebas aislada.

## Portfolio

También se puede consultar mediante `GET /accounts/:accountNumber/portfolio`, por ejemplo `/accounts/10001/portfolio`. Devuelve el mismo contrato que la búsqueda por usuario, incluido el `userId` resuelto. `findByAccountNumber` usa igualdad exacta y mantiene los ceros iniciales; solo quita espacios al inicio y al final. Acepta de 1 a 20 caracteres, acorde con la columna original.

La resolución del portfolio por número de cuenta busca el usuario correspondiente sin bloqueos. Una cuenta inexistente devuelve 404, una entrada inválida 400 y números de cuenta duplicados 409. El SQL original no garantiza unicidad: se detecta la ambigüedad sin elegir arbitrariamente un usuario ni modificar el esquema.

```sh
curl 'http://localhost:3000/users/1/portfolio'
curl 'http://localhost:3000/accounts/10001/portfolio'
```

El puerto debe coincidir con `API_PORT`. La respuesta incluye `totalValue`, `cashBalance`, `reservedCash`, `availableCash` y `positions`. Los importes y porcentajes se serializan como strings decimales con dos decimales; las cantidades de acciones son enteros. Las cantidades de la posición ARS son strings decimales en pesos, para conservar centavos. El cálculo usa decimal.js con precisión de 40 dígitos y redondea al responder.

- Solo los movimientos `FILLED` modifican saldo, cantidad y costo. Esto incluye LIMIT ejecutadas. `REJECTED` y `CANCELLED` se ignoran.
- Los ingresos y egresos ARS usan `size`; compras y ventas usan `size × price`.
- Las compras LIMIT `NEW` reservan pesos y las ventas LIMIT `NEW` reservan acciones. Es una decisión de diseño: las reservas reducen disponibilidad, sin reducir el valor total de la cuenta.
- `totalValue` coincide con la suma de `marketValue` de todas las posiciones, incluida ARS. Equivale a `cashBalance + suma(quantity × último close)` de las acciones, contando el efectivo una sola vez. La cotización se elige por `date` descendente e `id` como desempate, sin exigir la fecha de hoy.
- `totalReturnPercent` es el rendimiento no realizado de la posición abierta: `(valor de mercado − costo remanente) / costo remanente × 100`. Las compras suman costo; las ventas descuentan cantidad al costo promedio vigente, sin usar el precio de venta como costo. Una posición cerrada se omite y al reabrirse inicia un nuevo costo. No incluye ganancias realizadas, comisiones ni impuestos.
- `dailyReturnPercent = (close − previousClose) / previousClose × 100`; devuelve `null` si falta el cierre anterior o no es mayor que cero.
- Sin cotización válida para una posición abierta se responde HTTP 503, evitando devolver una valuación incompleta. Movimientos relevantes incompletos o inválidos producen HTTP 422. Usuario inexistente devuelve 404 e identificador inválido devuelve 400.
- **Lectura no bloqueante (*Lock-free Read*):** El portfolio lee el snapshot existente y las cotizaciones mediante consultas directas sin bloqueos pesimistas ni transacciones de escritura, aprovechando el aislamiento MVCC de PostgreSQL. Esto garantiza que las consultas de portfolio nunca bloqueen ni sean bloqueadas por el envío concurrente de órdenes, y que múltiples lecturas corran en paralelo.
- **Inicialización diferida (*Lazy fallback*):** Únicamente en caso de que el snapshot aún no exista en la base de datos (`null`), se adquiere un bloqueo pesimista `SELECT ... FOR UPDATE` sobre la fila del usuario para reconstruirlo a partir del historial de órdenes y guardarlo de forma atómica y consistente por primera vez.

El usuario 1 del SQL original tiene `cashBalance = "753000.00"`, `reservedCash = "125500.00"`, `availableCash = "627500.00"` y `totalValue = "889756.00"`. Incluye BMA con −10 acciones: se conserva el saldo firmado y su valor de mercado negativo, con `inconsistentHistory: true` y `totalReturnPercent: null`. El total refleja literalmente ese historial inconsistente. Los usuarios 2, 3 y 4 tienen valores cero y posiciones vacías.

La funcionalidad sigue la misma arquitectura hexagonal: cálculo en `portfolio/domain`, caso de uso y puerto en `portfolio/application`, HTTP y Prisma en `portfolio/infrastructure`. El dominio no importa NestJS ni Prisma.

La lista `positions` incluye ARS con `type: MONEDA` cuando hay saldo de efectivo o reservas. Usa el identificador real del instrumento, `price: "1.00"`, `marketValue = cashBalance`, `quantity = cashBalance`, `reservedQuantity = reservedCash` y `availableQuantity = availableCash`. Sus rendimientos y `priceDate` son `null`: no requiere cotización. Las posiciones de acciones llevan `type: ACCIONES`. Un portfolio sin efectivo, reservas ni acciones sigue devolviendo `positions: []`.

### Enviar órdenes — `POST /users/:userId/orders`

`POST /users/:userId/orders` acepta:

```json
{
  "transactionId": "00000000-0000-4000-8000-000000000001",
  "instrumentId": "47",
  "side": "BUY",
  "type": "MARKET",
  "size": 2
}
```

- `side`: `BUY`, `SELL`, `CASH_IN` o `CASH_OUT`. BUY/SELL requiere `ACCIONES`; CASH_IN/CASH_OUT requiere el instrumento `ARS` de tipo `MONEDA`.
- Enviar exactamente uno de `size` (entero positivo) o `amount` (pesos positivos). Los importes aceptan números o strings decimales, preferentemente strings para conservar precisión; máximo dos decimales.
- MARKET no acepta `price`: utiliza el `close` de la última fecha disponible y se guarda `FILLED` si hay recursos.
- LIMIT requiere `price` positivo y se guarda `NEW`. No se ejecuta automáticamente aunque su precio cruce el cierre, porque no simulamos mercado.
- Por monto, `size = floor(amount / precio)`, tanto para compra como para venta. En compras se verifica tanto el monto solicitado como el costo de las acciones calculadas contra el saldo disponible. Si `amount` supera el disponible, se guarda REJECTED aunque el redondeo hacia abajo produzca un costo menor; en ventas se comprueba la cantidad calculada contra las acciones disponibles. Un monto que no alcanza para una acción devuelve 400. La cantidad debe caber en un entero PostgreSQL de 32 bits.
- Las compras validan saldo disponible descontando reservas LIMIT; las ventas validan tenencia menos acciones reservadas. Si faltan recursos, se guarda `REJECTED` sin afectar el portfolio.
- Respuesta HTTP 201 para toda orden creada, incluida `REJECTED`: `{ id, transactionId, userId, instrumentId, side, type, size, price, status, datetime }`. El cliente debe consultar `status` para conocer el resultado de negocio. `price` es un string decimal.
- Formato inválido, campos desconocidos o instrumentos no operables: 400. Usuario/instrumento inexistente: 404. Cotización MARKET ausente o inválida: 503. Estos casos no crean órdenes.
- No se agregan comisiones ni se admiten ventas en corto. Cada transactionId nuevo crea una orden; los reintentos equivalentes del mismo usuario devuelven la orden existente con HTTP 200; otra solicitud o usuario con el mismo identificador recibe HTTP 409.

El caso de uso depende de un puerto transaccional. Prisma bloquea la fila del usuario con `SELECT ... FOR UPDATE` parametrizado antes de leer recursos y guardar la orden. Se usa `ReadCommitted` para que una solicitud que esperó el bloqueo vea la orden ya confirmada por la anterior. La ejecución y la persistencia del rechazo suceden dentro de esa transacción. Cancelaciones, transferencias y compras/ventas usan el mismo bloqueo por usuario.

`orders` es el registro de órdenes y la fuente de verdad; `account_snapshots` almacena su estado derivado. El portfolio y la validación de recursos leen el snapshot. Guardar una orden aceptada o cancelarla actualiza su snapshot dentro de la misma transacción. La cancelación tiene una ruta específica; el envío por número de cuenta queda fuera de este endpoint.

`requests.http` contiene ejemplos para REST Client. Sus POST modifican la cuenta indicada.

### Transferencias en el endpoint de órdenes

El mismo `POST /users/:userId/orders` acepta ingresos y egresos:

```json
{
  "transactionId": "00000000-0000-4000-8000-000000000002",
  "instrumentId": "66",
  "side": "CASH_IN",
  "type": "MARKET",
  "amount": "1000.00"
}
```

Usar `CASH_OUT` para retirar pesos. El id 66 corresponde a ARS en el seed; se valida el ticker y tipo del instrumento, sin fijar ese id en la lógica.

Las transferencias requieren MARKET, no aceptan un precio enviado por el cliente y se persisten con `price = 1` y `size` igual a los pesos transferidos. Aceptan exactamente uno de `size` o `amount`. Por compatibilidad con `orders.size INT`, el monto debe ser entero y estar entre 1 y 2147483647 pesos: los centavos se rechazan con 400, nunca se redondean.

CASH_IN se guarda FILLED. CASH_OUT se guarda FILLED si el saldo disponible (descontando reservas LIMIT) alcanza; en caso contrario se guarda REJECTED y no altera el saldo. Ambos usan la misma transacción y bloqueo por usuario que las compras y ventas. No requieren cotización de ARS y se reflejan inmediatamente en el saldo y la posición ARS del portfolio.

#### Idempotencia y reintentos

Para garantizar la consistencia de la base de datos y evitar el procesamiento de órdenes duplicadas ante reintentos de red:

- **Validación de `transactionId`:** Cada solicitud de orden valida un identificador único (`transactionId`). Un identificador nuevo crea la orden con HTTP 201. Si se repite con el mismo usuario y solicitud equivalente, devuelve la orden existente con HTTP 200 y su estado actual, sin recalcular precios, modificar el snapshot ni ejecutar nuevamente. Una solicitud o usuario diferente recibe HTTP 409.
- **Compatibilidad con datos iniciales:** La columna permite valores `NULL` exclusivamente para preservar la compatibilidad con el dataset provisto inicialmente en el challenge.
- **Comparación de solicitudes:** `orders.originalrequest` guarda una representación normalizada de instrumento, side, type, size, amount y price. Los importes equivalentes (`10` y `"10.00"`) coinciden; cambiar de size a amount se considera otra solicitud. El precio de ejecución MARKET no participa de la comparación. Órdenes anteriores sin esta información devuelven 409; no se infiere la intención original a partir del resultado.
- **Esquema existente:** `originalrequest` forma parte de la migración de cambios de la aplicación. Para bases anteriores a Prisma Migrate, seguir el procedimiento de adopción antes de arrancar la API.
- **Identificador obligatorio:** El cliente debe proporcionar `transactionId`; si falta, la API devuelve 400. El índice único global se conserva para proteger también las solicitudes simultáneas.

### Cancelar órdenes — `POST /users/:userId/orders/:orderId/cancel`

`POST /users/:userId/orders/:orderId/cancel` cambia una orden NEW del usuario a CANCELLED y devuelve HTTP 200 con `{ id, userId, status }`. La fila se conserva, con su cantidad, precio y fecha originales. Las reservas se liberan al dejar de contabilizar la orden como NEW; no se altera la tenencia FILLED ni el saldo contable.

Cancelar FILLED, REJECTED o CANCELLED devuelve 409. Orden inexistente o perteneciente a otro usuario devuelve 404; identificadores inválidos devuelven 400. La validación y actualización ocurren dentro del bloqueo transaccional por usuario, y el UPDATE comprueba nuevamente que el estado sea NEW. Dos cancelaciones simultáneas producen una única cancelación exitosa.

## Documentación Swagger / OpenAPI

La API cuenta con documentación interactiva generada con Swagger (OpenAPI 3.0):

- **Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs) (o el puerto configurado en `API_PORT` / `PORT`)
- **Especificación OpenAPI (JSON):** [http://localhost:3000/docs-json](http://localhost:3000/docs-json)

Desde la interfaz web de Swagger es posible consultar y probar los endpoints de:

- **Instruments:** Búsqueda paginada de activos por ticker o nombre (`GET /instruments`).
- **Portfolio:** Consulta de portfolio por usuario (`GET /users/:userId/portfolio`) o por número de cuenta (`GET /accounts/:accountNumber/portfolio`).
- **Orders:** Envío de órdenes MARKET y LIMIT, transferencias CASH_IN y CASH_OUT (`POST /users/:userId/orders`) y cancelación de órdenes en estado NEW (`POST /users/:userId/orders/:orderId/cancel`).

## Pruebas

```sh
npm run test:unit
npm run test:db:up
# Una vez por cada base temporal nueva:
npm run test:db:baseline
npm run test:db:migrate
npm test
# Solo órdenes:
npm run test:orders
npm run lint
npm run test:db:down
```

`compose.test.yaml` levanta PostgreSQL en localhost:55432, con la base `cocos_test` y almacenamiento temporal. Docker carga el SQL original. `test:db:baseline` registra la base inicial y `test:db:migrate` aplica las migraciones; ambos usan la configuración de pruebas. Si la base ya está migrada, omitir `test:db:baseline`. `npm test` y `test:orders` cargan `.env.test.example` y permiten overrides desde `.env.test`. Las variables ya exportadas en la terminal tienen prioridad.

Las pruebas de escritura exigen que el nombre de base termine en `_test`, crean usuarios propios y eliminan únicamente sus fixtures al finalizar. No operan sobre el usuario 1 del seed. Al detener y recrear el contenedor de pruebas se reinicializa su almacenamiento temporal. `test:instruments` consulta la configuración local; `test:portfolio` también puede inicializar snapshots faltantes, sin cambiar órdenes del seed.

La cobertura incluye persistencia y cambio del portfolio, redondeo por monto, reservas, rechazos de compras/ventas, entradas inválidas, cotizaciones ausentes y competencia entre solicitudes simultáneas de compra, reserva y venta.

La separación de pruebas por responsabilidad, los escenarios de integración y los comandos de ejecución se detallan en [`test/README.md`](test/README.md).

Para las suites individuales de lectura:

```sh
npm run test:instruments
npm run test:portfolio
```

### Verificación de consideraciones funcionales

| Consideración | Implementación y verificación |
| --- | --- |
| Precios en pesos | Cotizaciones y precios de órdenes en ARS; posición MONEDA con precio 1. |
| Sin simulación de mercado | MARKET usa la cotización almacenada; LIMIT no se ejecuta mediante matching. |
| Cantidad o monto, sin fracciones de acciones | Exactamente size o amount; floor(amount / precio), validación de entero positivo. |
| BUY y SELL | Enum de dominio, validación y persistencia de ambos lados. |
| NEW, FILLED, REJECTED, CANCELLED | Estados de dominio implementados y persistidos según el flujo. |
| MARKET inmediata | FILLED si hay recursos; el registro de órdenes y el portfolio reflejan la ejecución. |
| LIMIT pendiente | NEW si hay recursos; reserva dinero o acciones. |
| Cancelar solo NEW | Caso de uso de cancelación, control de pertenencia y actualización condicional. |
| Rechazar exceso de fondos o acciones | Se guarda REJECTED; incluye presupuesto amount superior al disponible y reservas previas. |
| CASH_IN y CASH_OUT como órdenes | Instrumento ARS/MONEDA, MARKET, size en pesos y precio 1. |
| Actualizar posiciones al ejecutar | Cada FILLED actualiza el snapshot en la misma transacción; el portfolio consulta ese estado. |
| Movimientos pertinentes y size | Proyección de orders: FILLED para saldos/tenencia; NEW solo para reservas. |
| ARS es MONEDA | Se valida su tipo; se muestra en positions y se cuenta una sola vez en totalValue. |
| Retorno diario | (close − previousClose) / previousClose; null si falta el denominador o es cero. |
| Último close en MARKET | Cotización por date descendente, con id como desempate. |
| FILLED para posiciones y rendimiento | BUY/SELL ejecutadas para cantidad y costo promedio; NEW, REJECTED y CANCELLED no modifican el costo. |

Las pruebas funcionales usan PostgreSQL aislado y verifican persistencia, portfolio, precios, redondeo, transferencias, reservas, cancelaciones y concurrencia. Los supuestos restantes están documentados: rendimiento total de la posición abierta sobre costo promedio, reservas de LIMIT, transferencias en pesos enteros por size INT y el historial inconsistente de BMA provisto en el seed.

## Registro de Órdenes y Snapshot de Cuenta

Para evitar recorrer y recalcular el historial de órdenes del usuario en cada consulta de portfolio o validación de recursos, una vez inicializado el snapshot:

- **Registro de órdenes como fuente de verdad (`orders`):** Conserva las órdenes y su estado actual (`FILLED`, `NEW`, `REJECTED`, `CANCELLED`). Las cancelaciones actualizan el estado de las órdenes pendientes; no se conserva un historial inmutable de eventos ni la fecha de cada transición. Las órdenes ejecutadas no se modifican desde la API.
- **Snapshot de estado (`account_snapshots`):** Almacena una proyección consolidada por usuario con su saldo contable (`settledcash`), pesos reservados por compras pendientes (`reservedcash`) y sus posiciones vigentes. Se gestiona desde su propio módulo [`src/account-snapshot/`](src/account-snapshot).
- **Actualización transaccional incremental (Escritura con bloqueo pesimista):** Las órdenes ejecutadas modifican saldos y posiciones, las pendientes reservan recursos y las cancelaciones liberan reservas, dentro de la misma transacción ACID que persiste la orden o su cambio de estado. Utiliza `SELECT ... FOR UPDATE` sobre el usuario para serializar la validación de fondos y evitar condiciones de carrera (*lost updates*). Las órdenes rechazadas no alteran esos recursos.
- **Lectura desacoplada y no bloqueante (*Lock-free Read*):** Las consultas de portfolio leen la proyección materializada directamente sin abrir transacciones de bloqueo pesimista (`FOR UPDATE`), permitiendo lecturas concurrentes y maximizando el throughput sin interferir con los envíos de órdenes.
- **Costo de las operaciones habituales:** El snapshot evita reproducir el historial de órdenes en cada consulta o validación. El trabajo sigue dependiendo de las posiciones y cotizaciones involucradas: se recorren y ordenan posiciones, y sus datos se leen y persisten como JSON.
- **Reconstrucción:** Si falta el snapshot, se inicializa automáticamente bajo bloqueo seguro desde las órdenes del usuario. Ante modificaciones manuales o mantenimiento, el estado actual puede regenerarse mediante `npm run snapshots:rebuild`, que vuelve a procesar el historial. Esto no permite reconstruir las reservas a una fecha pasada, porque no se conservan todas las transiciones de estado.


## Consideraciones para Entornos Productivos

Para la evolución de esta solución hacia un entorno de producción de alta escala y criticidad financiera, se destacan las siguientes sugerencias arquitectónicas:

### 1. Observabilidad y Monitoreo de Métricas (APM)

En un entorno productivo se sugiere implementar un agente de seguimiento de métricas y rendimiento de aplicaciones (APM), como **Datadog** o **New Relic** (o soluciones basadas en **OpenTelemetry**), para supervisar en tiempo real latencias (p95/p99), throughput, tasas de error, saturación del connection pool de la base de datos y trazabilidad distribuida de transacciones.

### 2. Responsabilidades en Microservicios y Patrón Saga

En un entorno productivo orientado a **microservicios**, las responsabilidades podrían separarse en servicios de *Orders*, *Portfolio/Ledger*, *Market Data* y *Accounts*, cada uno responsable de sus datos.

Cuando una operación afecta bases de datos de varios servicios, se necesita coordinar sus cambios y manejar fallas parciales. Una opción es el **patrón Saga**, mediante orquestación o coreografía: cada servicio ejecuta una transacción local ACID y, si el flujo falla, se aplican acciones compensatorias. Saga permite alcanzar consistencia eventual; no garantiza una transacción ACID global. Los invariantes que requieran consistencia inmediata deberían mantenerse dentro de una misma frontera transaccional.

### 3. Mantenimiento y Auditoría de Dependencias

Se corrigen las vulnerabilidades transitivas con overrides, manteniendo Nest 11 y Prisma 7:

| Dependencia | Versión fijada |
| --- | --- |
| `@nestjs/platform-express → multer` | `2.3.0` |
| `@prisma/config → deepmerge-ts` | `8.0.2` |
| `prisma → mysql2` | `3.24.4` |

`deepmerge-ts` cambia de versión mayor; se verificaron la configuración de Prisma, el build y los tests. Revisar estos overrides al actualizar Nest o Prisma y repetir `npm audit` y `npm test`.

### 4. Auditoría de Operaciones

Incorporar un historial **append-only** de órdenes y movimientos de fondos, con actor, fecha, correlación y estados anterior/nuevo. Guardarlo en PostgreSQL dentro de la misma transacción que la operación. Actualmente solo se conserva el estado de las órdenes, no todas sus transiciones.

### 5. Normalización de Posiciones del Snapshot

Si crecen las posiciones por cuenta, reemplazar el JSON por `account_snapshot_positions`, con una fila por `(user_id, instrument_id)`, cantidad, reservas, costo e indicador de inconsistencia. Permitiría actualizar una posición sin reescribir las demás y agregar restricciones de integridad. Efectivo, posiciones y órdenes deben seguir actualizándose en la misma transacción, conservando la coordinación por usuario.
