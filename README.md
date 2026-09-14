# Cocos Challenge Backend

API para buscar instrumentos financieros, consultar portfolios, enviar y cancelar órdenes, y registrar movimientos de fondos. Desarrollada con Node.js 24, TypeScript, NestJS 11, Prisma 7 y PostgreSQL 17.

## Ejecutar con Docker

Requisitos: Git y Docker con Compose en ejecución.

La base original del challenge se carga en un contenedor PostgreSQL separado de la aplicación. La app aplica sus cambios mediante migraciones sobre esa base existente, reproduciendo un flujo de despliegue sobre una base previamente provisionada.

```sh
git clone https://github.com/jfilandini/cocos-challengue.git
cd cocos-challengue
cp .env.example .env

docker compose up -d --wait db
# Solo para una base nueva; omitir si ya tiene el baseline registrado:
docker compose run --build --rm api npm run db:baseline
docker compose up --build -d --wait

curl http://localhost:3001/health
curl 'http://localhost:3001/instruments?query=ypf'
curl http://localhost:3001/users/1/portfolio
```

Health debe responder `{"status":"ok","database":"up"}`. Para probar todos los endpoints, abrir [Swagger](http://localhost:3001/docs).

Para detener el proyecto conservando los datos:

```sh
docker compose down
```

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

### Verificación de código

```sh
# Generar el cliente antes del primer chequeo de lint:
npm run prisma:generate
npm run check
```

`check` ejecuta lint, validación de tipos y tests unitarios; las pruebas con PostgreSQL se ejecutan por separado en [Pruebas](#pruebas). ESLint detecta errores y advertencias, y protege la separación entre dominio/aplicación e infraestructura. TypeScript verifica tanto la aplicación como los tests.

Comandos auxiliares: `npm run lint:fix` aplica correcciones automáticas, `npm run prisma:validate` valida el esquema y `npm run prisma:studio` permite explorar la base.

## Endpoints

Los ejemplos usan `http://localhost:3001`, tanto con Docker como con Node local. Si se cambia el puerto, ajustar las URLs según `API_PORT` (Docker) o `PORT` (Node local).

Los IDs de usuario, instrumento y orden deben ser enteros positivos de hasta `9223372036854775807` (BIGINT de PostgreSQL). Enviar IDs en JSON como strings decimales, por ejemplo `"9007199254740993"`, para conservar su precisión. Por compatibilidad se aceptan también números enteros positivos hasta `Number.MAX_SAFE_INTEGER` (`9007199254740991`); números mayores se rechazan con HTTP 400 antes de convertirlos a bigint. Los IDs en texto no admiten espacios, ceros iniciales, signos ni notación hexadecimal o exponencial. Esta validación no se aplica al número de cuenta, que conserva sus ceros iniciales.

### Estado del servicio — `GET /health`

Comprueba la conexión con PostgreSQL. Devuelve HTTP 200 con `{"status":"ok","database":"up"}` o HTTP 503 si la base no está disponible.

```sh
curl 'http://localhost:3001/health'
```

### Buscar instrumentos financieros — `GET /instruments`

```sh
# Primera página, hasta 10 resultados
curl 'http://localhost:3001/instruments?query=ypf&page=1&limit=10'
# Segunda página de coincidencias por nombre
curl 'http://localhost:3001/instruments?query=molin&page=2&limit=2'
```

El parámetro `query` es obligatorio: debe contener texto luego de quitar espacios al inicio y al final. Busca coincidencias parciales por ticker **o** nombre, sin distinguir mayúsculas y minúsculas. Los acentos se conservan y los caracteres `%`, `_` y `\` se buscan literalmente.

La búsqueda es **paginada**:

| Parámetro | Descripción |
| --- | --- |
| `query` | Ticker o nombre a buscar; obligatorio. |
| `page` | Página solicitada, entero positivo; por defecto `1`. |
| `limit` | Resultados por página, entero entre `1` y `100`; por defecto `20`. |

### Portfolio — `GET /users/:userId/portfolio`

También se puede consultar mediante `GET /accounts/:accountNumber/portfolio`, por ejemplo `/accounts/10001/portfolio`. Devuelve el mismo contrato que la búsqueda por usuario, incluido el `userId` resuelto. `findByAccountNumber` usa igualdad exacta y mantiene los ceros iniciales; solo quita espacios al inicio y al final. Acepta de 1 a 20 caracteres, acorde con la columna original.

La resolución del portfolio por número de cuenta busca el usuario correspondiente sin bloqueos. Una cuenta inexistente devuelve 404, una entrada inválida 400 y números de cuenta duplicados 409. El SQL original no garantiza unicidad: se detecta la ambigüedad sin elegir arbitrariamente un usuario ni modificar el esquema.

```sh
curl 'http://localhost:3001/users/1/portfolio'
curl 'http://localhost:3001/accounts/10001/portfolio'
```

La respuesta incluye `totalValue`, `cashBalance`, `reservedCash`, `availableCash` y `positions`. Los importes y porcentajes se serializan como strings decimales con dos decimales; las cantidades de acciones son enteros. Las cantidades de la posición ARS son strings decimales en pesos, para conservar centavos. El cálculo usa decimal.js con precisión de 40 dígitos y redondea al responder.

- Solo los movimientos `FILLED` modifican saldo, cantidad y costo. Esto incluye LIMIT ejecutadas. `REJECTED` y `CANCELLED` se ignoran.
- Los ingresos y egresos ARS usan `size`; compras y ventas usan `size × price`.
- Las compras LIMIT `NEW` reservan pesos y las ventas LIMIT `NEW` reservan acciones. Es una decisión de diseño: las reservas reducen disponibilidad, sin reducir el valor total de la cuenta.
- `totalValue` coincide con la suma de `marketValue` de todas las posiciones, incluida ARS. Equivale a `cashBalance + suma(quantity × último close)` de las acciones, contando el efectivo una sola vez. La cotización se elige por `date` descendente e `id` como desempate, sin exigir la fecha de hoy.
- `totalReturnPercent` es el rendimiento no realizado de la posición abierta: `(valor de mercado − costo remanente) / costo remanente × 100`. Las compras suman costo; las ventas descuentan cantidad al costo promedio vigente, sin usar el precio de venta como costo. Una posición cerrada se omite y al reabrirse inicia un nuevo costo. No incluye ganancias realizadas, comisiones ni impuestos.
- `dailyReturnPercent = (close − previousClose) / previousClose × 100`; devuelve `null` si falta el cierre anterior o no es mayor que cero.
- Sin cotización válida para una posición abierta se responde HTTP 503, evitando devolver una valuación incompleta. Movimientos relevantes incompletos o inválidos producen HTTP 422. Usuario inexistente devuelve 404 e identificador inválido devuelve 400.

El usuario 1 del SQL original tiene `cashBalance = "753000.00"`, `reservedCash = "125500.00"`, `availableCash = "627500.00"` y `totalValue = "889756.00"`. Incluye BMA con −10 acciones: se conserva el saldo firmado y su valor de mercado negativo, con `inconsistentHistory: true` y `totalReturnPercent: null`. El total refleja literalmente ese historial inconsistente. Los usuarios 2, 3 y 4 tienen valores cero y posiciones vacías.

La estrategia de lectura e inicialización se describe en [Registro de órdenes y snapshot de cuenta](#registro-de-órdenes-y-snapshot-de-cuenta).

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
- No se agregan comisiones ni se admiten ventas en corto. Los reintentos se describen en [Idempotencia y reintentos](#idempotencia-y-reintentos).

Órdenes, transferencias y cancelaciones comparten la [estrategia transaccional por usuario](#registro-de-órdenes-y-snapshot-de-cuenta). El envío utiliza el ID de usuario; no admite número de cuenta.

#### Transferencias

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

CASH_IN se guarda FILLED. CASH_OUT se guarda FILLED si el saldo disponible (descontando reservas LIMIT) alcanza; en caso contrario se guarda REJECTED y no altera el saldo. No requieren cotización de ARS y se reflejan inmediatamente en el saldo y la posición ARS del portfolio.

#### Idempotencia y reintentos

- **Identificador obligatorio:** `transactionId` debe acompañar cada solicitud; si falta, devuelve 400. Un índice único global protege también las solicitudes simultáneas. La columna admite `NULL` para conservar las órdenes del dataset original.
- **Reintentos:** un identificador nuevo crea la orden con HTTP 201. El mismo usuario y solicitud equivalente obtienen HTTP 200 con el estado actual, sin recalcular precios ni modificar el snapshot. Otro pedido o usuario recibe 409.
- **Comparación:** `orders.originalrequest` guarda instrumento, side, type, size, amount y price normalizados. Los importes `10` y `"10.00"` equivalen; cambiar de size a amount se considera otra solicitud. El precio de ejecución MARKET no participa de la comparación. Órdenes anteriores sin esta información devuelven 409.

### Cancelar órdenes — `POST /users/:userId/orders/:orderId/cancel`

`POST /users/:userId/orders/:orderId/cancel` cambia una orden NEW del usuario a CANCELLED y devuelve HTTP 200 con `{ id, userId, status }`. La fila se conserva, con su cantidad, precio y fecha originales. Las reservas se liberan al dejar de contabilizar la orden como NEW; no se altera la tenencia FILLED ni el saldo contable.

Cancelar FILLED, REJECTED o CANCELLED devuelve 409. Orden inexistente o perteneciente a otro usuario devuelve 404; identificadores inválidos devuelven 400. Dos cancelaciones simultáneas producen una única cancelación exitosa.

## Swagger y ejemplos

- [Swagger UI](http://localhost:3001/docs): contratos y ejecución interactiva de los endpoints.
- [OpenAPI JSON](http://localhost:3001/docs-json): especificación de la API.
- [Colección de Postman](cocos-challenge.postman_collection.json): ejemplos de operaciones, idempotencia y errores. Importar el archivo desde **Import** en Postman y ajustar las variables de la colección.

Los ejemplos de envío y cancelación modifican la cuenta indicada. La colección define estas variables:

| Variable | Valor por defecto | Descripción |
| --- | --- | --- |
| `baseUrl` | `http://localhost:3001` | URL base de la API; ajustar si se cambia el puerto. |
| `userId` | `1` | ID de usuario para pruebas con datos precargados. |
| `accountNumber` | `10001` | Número de cuenta asociado al usuario 1. |
| `instrumentId` | `50` | ID del instrumento para órdenes de acciones (`YPFD`). |
| `arsInstrumentId` | `66` | ID del instrumento para movimientos en pesos (`ARS`). |
| `lastCreatedOrderId` | *(dinámico)* | ID de la última orden creada para probar el endpoint de cancelación. |

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

La infraestructura compartida gestiona la conexión Prisma y el health check. `prisma/schema.prisma` mapea las tablas mediante `@map`; el cliente se genera durante el build.

### Gestión del esquema con Prisma Migrate

Docker inicializa PostgreSQL con el archivo original del challenge (`docker/postgres/database.sql`), conservado sin cambios. Prisma administra únicamente la evolución posterior:

1. `0_challenge_base` contiene el esquema original, sin datos. `db:baseline` verifica que la base coincida con `prisma/baseline.prisma` y lo registra como aplicado, porque Docker ya creó las tablas. Esta migración también permite reconstruir el esquema en la base sombra de Prisma durante el desarrollo.
2. `20260911010000_application_schema` aplica las diferencias hacia `schema.prisma`: IDs, referencias y secuencias BIGINT; importes de precisión 18,2; índices; `transactionid` único y `originalrequest`; y `account_snapshots`. Se ejecuta en una transacción y conserva los datos existentes.

La migración de IDs y referencias de `INT` a `BIGINT`, junto con la ampliación de sus secuencias, contempla un escenario productivo con un alto volumen acumulado de órdenes. Evita que la generación de identificadores quede limitada al máximo positivo de `INT` (2.147.483.647), conservando los IDs existentes y la continuidad de los contadores.

El baseline es un paso explícito de inicialización, ejecutado una sola vez por base. Después, `npm start` y `npm run start:dev` ejecutan únicamente `npm run db:migrate` antes de iniciar Node. En Docker, el comando es `npm run db:migrate && exec node dist/main.js`. Prisma consulta su historial, aplica las migraciones pendientes y utiliza su bloqueo nativo para evitar aplicaciones simultáneas. Si falla, la API no arranca. En modo watch, las migraciones se revisan al iniciar el comando, no en cada reinicio interno de Node.

Si se omite el baseline sobre una base inicializada con el SQL original, Prisma rechazará la adopción de esa base no vacía. Ejecutar `db:baseline` antes del primer arranque; no repetirlo en bases que ya tienen historial.

Las columnas originales conservan su nulabilidad en PostgreSQL. Los campos requeridos en `schema.prisma` expresan el supuesto semántico de la aplicación de que esos datos están presentes; no se agregan restricciones `NOT NULL` sobre ellos. La tabla nueva `account_snapshots` sí define sus campos obligatorios.

Para cambios futuros, editar `schema.prisma`, generar la migración con `npm run db:migrate:dev -- --create-only --name nombre_del_cambio` y revisar el SQL antes de aplicarlo. Prisma puede volver a proponer `SET NOT NULL` por esa diferencia intencional: retirarlos para conservar esta decisión, aplicar con `npm run db:migrate` y versionar el SQL junto con el esquema. En despliegues usar `npm run db:migrate`. `prisma generate` solo genera el cliente; no modifica la base.

### Registro de órdenes y snapshot de cuenta

El snapshot evita recalcular el historial completo en cada consulta de portfolio o validación de recursos:

- **Registro de órdenes como fuente de verdad (`orders`):** Conserva las órdenes y su estado actual (`FILLED`, `NEW`, `REJECTED`, `CANCELLED`). Las cancelaciones actualizan el estado de las órdenes pendientes. Las órdenes ejecutadas no se modifican desde la API.
- **Snapshot de estado (`account_snapshots`):** Almacena una proyección consolidada por usuario con su saldo contable (`settledcash`), pesos reservados por compras pendientes (`reservedcash`) y sus posiciones vigentes. Se gestiona desde su propio módulo [`src/account-snapshot/`](src/account-snapshot).
- **Actualización transaccional incremental (Escritura con bloqueo pesimista):** Las órdenes ejecutadas modifican saldos y posiciones, las pendientes reservan recursos y las cancelaciones liberan reservas, dentro de la misma transacción ACID que persiste la orden o su cambio de estado. El adaptador Prisma utiliza `SELECT ... FOR UPDATE` parametrizado sobre el usuario y aislamiento `ReadCommitted`: una solicitud que espera el bloqueo ve los cambios confirmados por la anterior. Cancelaciones, transferencias y compras/ventas comparten ese bloqueo; al cancelar, el UPDATE comprueba nuevamente que el estado sea NEW. Las órdenes rechazadas no alteran esos recursos.
- **Lectura e inicialización:** Si el snapshot existe, el portfolio lo lee y obtiene las cotizaciones sin abrir una transacción de escritura ni adquirir bloqueos pesimistas. Si falta, abre una transacción y bloquea la fila del usuario con `FOR UPDATE`; vuelve a comprobar su existencia y, si sigue faltando, lo reconstruye y guarda. Esta inicialización comparte el bloqueo por usuario con las órdenes y puede esperar o hacerlas esperar.
- **Costo de las operaciones habituales:** El trabajo depende de las posiciones y cotizaciones involucradas: se recorren y ordenan posiciones, y sus datos se leen y persisten como JSON.
- **Reconstrucción:** Ante modificaciones manuales o mantenimiento, el estado actual puede regenerarse mediante `npm run snapshots:rebuild`, que vuelve a procesar el historial. Esto no permite reconstruir las reservas a una fecha pasada, porque no se conservan todas las transiciones de estado.

## Pruebas

```sh
npm run test:unit
npm run test:db:up
# Una vez por cada base temporal nueva; omitir si ya tiene baseline:
npm run test:db:baseline
npm run test:db:migrate
npm test
```

`compose.test.yaml` levanta PostgreSQL en localhost:55432, con la base `cocos_test` y almacenamiento temporal. Docker carga el SQL original. `test:db:baseline` registra la base inicial y `test:db:migrate` aplica las migraciones; ambos usan la configuración de pruebas. Si la base ya está migrada, omitir `test:db:baseline`. `npm test`, `test:e2e`, `test:orders`, `test:instruments` y `test:portfolio` cargan `.env.test.example` y permiten overrides desde `.env.test`. Las variables ya exportadas en la terminal tienen prioridad.

Las pruebas de escritura exigen que el nombre de base termine en `_test`, crean usuarios propios y eliminan únicamente sus fixtures al finalizar. No operan sobre el usuario 1 del seed. Al detener y recrear el contenedor de pruebas se reinicializa su almacenamiento temporal. Las consultas de portfolio pueden inicializar snapshots faltantes en esa base, sin cambiar órdenes del seed.

La prueba funcional de envío está en `test/e2e/orders.e2e.test.ts`. La cobertura incluye persistencia y cambio del portfolio, redondeo por monto, reservas, rechazos de compras/ventas, entradas inválidas, cotizaciones ausentes y competencia entre solicitudes simultáneas de compra, reserva y venta.

La separación de pruebas por responsabilidad, los escenarios de integración y los comandos de ejecución se detallan en [`test/README.md`](test/README.md).

Para ejecutar una suite individual con la base de tests inicializada:

```sh
npm run test:orders
npm run test:instruments
npm run test:portfolio
```

Al terminar, `npm run test:db:down` elimina el contenedor y su base temporal.

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

## Evolución hacia producción

Estas mejoras quedan fuera del alcance implementado:

- **Automatización:** ejecutar chequeos y tests de integración en CI antes de integrar cambios.
- **Observabilidad:** medir latencias, errores y saturación del pool, con trazabilidad de solicitudes.
- **Auditoría:** conservar un historial append-only de transiciones, con actor y correlación, dentro de la transacción de la operación.
- **Posiciones:** si crecen por cuenta, sustituir el JSON por filas en `account_snapshot_positions`, evitando reescribir todas las posiciones y permitiendo restricciones de integridad.
- **Distribución:** evaluar servicios separados solo si el crecimiento lo justifica, manteniendo juntas las operaciones que requieren consistencia inmediata.
