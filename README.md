# Cocos Challenge Backend

Base inicial con Node.js 24, TypeScript, NestJS 11, Prisma 7 y PostgreSQL 17.
Incluye conexión a la base, `GET /health`, búsqueda de activos con `GET /instruments` y portfolio con `GET /users/:userId/portfolio`.

## Ejecutar con Docker

Requisitos: Docker Desktop encendido (o Docker Engine con Compose).

```sh
cp .env.example .env
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

`down` conserva los datos. El SQL de `docker/postgres/database.sql` se carga **solo cuando el volumen está vacío**. Modificarlo o reiniciar los servicios no vuelve a cargarlo. `docker compose down -v` elimina los datos locales y permite una inicialización desde cero al levantar nuevamente.

Después de cambiar el código, ejecutar nuevamente `docker compose up --build -d --wait`.

## Documentación Swagger / OpenAPI

La API cuenta con documentación interactiva generada con Swagger (OpenAPI 3.0):

- **Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs) (o el puerto configurado en `API_PORT` / `PORT`)
- **Especificación OpenAPI (JSON):** [http://localhost:3000/docs-json](http://localhost:3000/docs-json)

Desde la interfaz web de Swagger es posible consultar y probar los endpoints de:
- **Instruments:** Búsqueda de activos por ticker o nombre (`GET /instruments`).
- **Portfolio:** Consulta de portfolio por usuario (`GET /users/:userId/portfolio`) o por número de cuenta (`GET /accounts/:accountNumber/portfolio`).
- **Orders:** Envío de órdenes MARKET y LIMIT, transferencias CASH_IN y CASH_OUT (`POST /users/:userId/orders`) y cancelación de órdenes en estado NEW (`POST /users/:userId/orders/:orderId/cancel`).

## Desarrollo local

### Lint

La configuración `eslint.config.mjs` usa ESLint 10 y typescript-eslint con análisis de tipos. Revisa código TypeScript, tests JavaScript y configuración; excluye `dist`, `node_modules`, cobertura y el cliente Prisma generado.

```sh
# Después de npm ci, generar el cliente para disponer de sus tipos:
npm run prisma:generate
npm run lint
# Aplicar las correcciones automáticas disponibles:
npm run lint:fix
```

Se detectan promesas sin manejar, usos incorrectos de async, variables sin usar e imports de tipos inconsistentes. Los archivos de dominio y aplicación no pueden importar NestJS, Prisma, infraestructura ni código generado. El comando falla ante errores o advertencias. El formato con Prettier queda fuera de este lint inicial.

Usar Node.js 24 (`nvm use` si tenés nvm), y copiar `.env.example` a `.env`.

```sh
docker compose up -d db --wait
npm ci
npm run build
npm start
```

Si la API de Docker está corriendo, detenerla con `docker compose stop api` antes de usar su puerto desde Node local.

Para recompilar automáticamente, ejecutar `npm run build:watch` en una terminal y `npm run dev` (o `npm run start:dev`) en otra, después del primer build. Este último reinicia Node cuando cambia el código compilado.

### Verificación integral y calidad de código

Para validar el proyecto de forma completa antes de commitear o entregar cambios:

```sh
npm run check
```

Este comando ejecuta en secuencia:
1. `npm run lint`: Chequeo de ESLint 10 con reglas arquitectónicas estrictas (aislamiento de capas de dominio y aplicación sin dependencias de infraestructura ni frameworks) y tipos.
2. `npm run typecheck`: Validación estricta de tipos con el compilador de TypeScript (`tsc --noEmit`).
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

## Buscar activos

```sh
curl 'http://localhost:3000/instruments?query=ypf'
curl 'http://localhost:3000/instruments?query=molinos'
```

Usar el puerto configurado en `API_PORT` (3001 si se eligió ese valor).
El parámetro `query` es obligatorio: entre 1 y 255 caracteres luego de quitar espacios al inicio y al final. Busca coincidencias parciales por ticker **o** nombre, sin distinguir mayúsculas y minúsculas. Los acentos se conservan y los caracteres `%`, `_` y `\` se buscan literalmente.

La respuesta es un array de objetos `{ id, ticker, name, type }` ordenados por ticker. Incluye acciones y monedas: ARS puede encontrarse por ticker (`ars`) o nombre (`pesos`). Si no hay coincidencias, devuelve `[]`. Una búsqueda ausente, vacía o inválida devuelve HTTP 400.

Las pruebas funcionales usan la base con el SQL original y no modifican datos:

```sh
docker compose up -d db --wait
npm run test:instruments
```

## Estructura y decisiones

La aplicación usa arquitectura hexagonal organizada por funcionalidad. El dominio y los casos de uso no importan NestJS, Prisma ni componentes de infraestructura.

```text
src/instruments/
  domain/instrument.ts                         Modelo independiente de Prisma
  application/search-instruments.use-case.ts   Caso de uso y validación
  application/ports/instrument.repository.ts   Puerto de salida
  infrastructure/http/                        Adaptador de entrada HTTP
  infrastructure/persistence/                 Adaptador de salida Prisma
  instruments.module.ts                       Composición e inyección de dependencias
```

El controlador invoca el caso de uso y convierte errores de entrada en HTTP 400. El caso de uso depende del contrato `InstrumentRepository`; el módulo NestJS lo conecta con `PrismaInstrumentRepository` mediante una fábrica. El adaptador Prisma implementa la búsqueda y el escape de patrones SQL, devolviendo modelos propios. La misma operación puede invocarse desde otro adaptador sin depender de HTTP.

`npm run test:unit` prueba los casos de uso y cálculos sin iniciar NestJS ni PostgreSQL. `npm run test:instruments` ejecuta las pruebas de búsqueda; `npm test` ejecuta toda la suite, incluyendo las funcionales con la base del challenge.

- `src/shared/infrastructure/database`: proveedor Prisma compartido, con conexión al iniciar y desconexión al cerrar.
- `src/shared/infrastructure/http/health.controller.ts`: consulta `SELECT 1` mediante Prisma; responde 503 si la base no está disponible. Es una comprobación de infraestructura, sin lógica de negocio.
- `prisma/schema.prisma`: mapeo de las tablas originales y de `account_snapshots`, el estado derivado de cada cuenta.
- `prisma.config.ts`: configuración de conexión para la CLI de Prisma.
- `docker/postgres/database.sql`: datos del challenge, con IDs BIGINT y ajustes de esquema del proyecto.

PostgreSQL convierte los identificadores sin comillas a minúsculas. Los modelos usan `@map` para exponer campos como `userId` sin renombrar columnas. La cotización usa `date`, tal como aparece en el SQL.

Prisma 7 utiliza el adaptador PostgreSQL y genera el cliente en `src/generated/prisma`, excluido de Git y generado durante el build. Referencia: [configuración de Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

El esquema se inicializa mediante `docker/postgres/database.sql`. En esta etapa del challenge, los cambios de esquema se realizan directamente en ese archivo y se reflejan en `prisma/schema.prisma`. El SQL de inicialización solo se ejecuta sobre un volumen vacío.

El dataset conserva la inconsistencia conocida del usuario 1: BMA tiene una compra ejecutada de 20 acciones y una venta ejecutada de 30. El tratamiento se documenta en la sección Portfolio.

La prueba funcional de envío de órdenes está en `test/orders.e2e.test.mjs` y usa una base de pruebas aislada.

## Dependencias

La auditoría inicial de npm informa cuatro entradas de severidad alta asociadas a la CLI de Prisma 7.10.0 (`prisma`, `@prisma/config`, `deepmerge-ts` y `mysql2`). Queda pendiente resolverlas con una actualización compatible; no se aplicó el downgrade mayor sugerido por `npm audit fix --force`. La poda de npm conserva la CLI por el árbol de dependencias actual, por lo que los avisos también aparecen con `--omit=dev` y la CLI sigue presente en la imagen.

## Portfolio

También se puede consultar mediante `GET /accounts/:accountNumber/portfolio`, por ejemplo `/accounts/10001/portfolio`. Devuelve el mismo contrato que la búsqueda por usuario, incluido el `userId` resuelto. `findByAccountNumber` usa igualdad exacta y mantiene los ceros iniciales; solo quita espacios al inicio y al final. Acepta de 1 a 20 caracteres, acorde con la columna original.

La resolución de la cuenta y la lectura del portfolio comparten la misma transacción. Una cuenta inexistente devuelve 404, una entrada inválida 400 y números de cuenta duplicados 409. El SQL original no garantiza unicidad: se detecta la ambigüedad sin elegir arbitrariamente un usuario ni modificar el esquema.

```sh
curl 'http://localhost:3001/users/1/portfolio'
npm run test:portfolio
npm test
```

El puerto debe coincidir con `API_PORT`. La respuesta incluye `totalValue`, `cashBalance`, `reservedCash`, `availableCash` y `positions`. Los importes y porcentajes se serializan como strings decimales con dos decimales; las cantidades de acciones son enteros. Las cantidades de la posición ARS son strings decimales en pesos, para conservar centavos. El cálculo usa decimal.js con precisión de 40 dígitos y redondea al responder.

- Solo los movimientos `FILLED` modifican saldo, cantidad y costo. Esto incluye LIMIT ejecutadas. `REJECTED` y `CANCELLED` se ignoran.
- Los ingresos y egresos ARS usan `size`; compras y ventas usan `size × price`.
- Las compras LIMIT `NEW` reservan pesos y las ventas LIMIT `NEW` reservan acciones. Es una decisión de diseño: las reservas reducen disponibilidad, sin reducir el valor total de la cuenta.
- `totalValue` coincide con la suma de `marketValue` de todas las posiciones, incluida ARS. Equivale a `cashBalance + suma(quantity × último close)` de las acciones, contando el efectivo una sola vez. La cotización se elige por `date` descendente e `id` como desempate, sin exigir la fecha de hoy.
- `totalReturnPercent` es el rendimiento no realizado de la posición abierta: `(valor de mercado − costo remanente) / costo remanente × 100`. Las compras suman costo; las ventas descuentan cantidad al costo promedio vigente, sin usar el precio de venta como costo. Una posición cerrada se omite y al reabrirse inicia un nuevo costo. No incluye ganancias realizadas, comisiones ni impuestos.
- `dailyReturnPercent = (close − previousClose) / previousClose × 100`; devuelve `null` si falta el cierre anterior o no es mayor que cero.
- Sin cotización válida para una posición abierta se responde HTTP 503, evitando devolver una valuación incompleta. Movimientos relevantes incompletos o inválidos producen HTTP 422. Usuario inexistente devuelve 404 e identificador inválido devuelve 400.
- El portfolio lee el snapshot bajo el mismo bloqueo de usuario que las órdenes, con aislamiento `ReadCommitted`. Las cotizaciones se obtienen en una consulta posterior dentro de esa transacción. No reproduce el historial en cada consulta.

El usuario 1 del SQL original tiene `cashBalance = "753000.00"`, `reservedCash = "125500.00"`, `availableCash = "627500.00"` y `totalValue = "889756.00"`. Incluye BMA con −10 acciones: se conserva el saldo firmado y su valor de mercado negativo, con `inconsistentHistory: true` y `totalReturnPercent: null`. El total refleja literalmente ese historial inconsistente. Los usuarios 2, 3 y 4 tienen valores cero y posiciones vacías.

La funcionalidad sigue la misma arquitectura hexagonal: cálculo en `portfolio/domain`, caso de uso y puerto en `portfolio/application`, HTTP y Prisma en `portfolio/infrastructure`. El dominio no importa NestJS ni Prisma.

La lista `positions` incluye ARS con `type: MONEDA` cuando hay saldo de efectivo o reservas. Usa el identificador real del instrumento, `price: "1.00"`, `marketValue = cashBalance`, `quantity = cashBalance`, `reservedQuantity = reservedCash` y `availableQuantity = availableCash`. Sus rendimientos y `priceDate` son `null`: no requiere cotización. Las posiciones de acciones llevan `type: ACCIONES`. Un portfolio sin efectivo, reservas ni acciones sigue devolviendo `positions: []`.


## Enviar órdenes

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
- No se agregan comisiones ni se admiten ventas en corto. Cada transactionId nuevo crea una orden; los reintentos con el mismo identificador devuelven HTTP 409.

El caso de uso depende de un puerto transaccional. Prisma bloquea la fila del usuario con `SELECT ... FOR UPDATE` parametrizado antes de leer recursos y guardar la orden. Se usa `ReadCommitted` para que una solicitud que esperó el bloqueo vea la orden ya confirmada por la anterior. La ejecución y la persistencia del rechazo suceden dentro de esa transacción. Cancelaciones, transferencias y compras/ventas usan el mismo bloqueo por usuario.

`orders` es el ledger y `account_snapshots` almacena su estado derivado. El portfolio y la validación de recursos leen el snapshot. Guardar una orden o cancelarla actualiza su snapshot dentro de la misma transacción. La cancelación tiene una ruta específica; el envío por número de cuenta queda fuera de este endpoint.

`requests.http` contiene ejemplos para REST Client. Sus POST modifican la cuenta indicada.

## Pruebas de órdenes y suite completa

```sh
npm run test:db:up
npm test
# Solo órdenes:
npm run test:orders
npm run lint
npm run test:db:down
```

`compose.test.yaml` levanta PostgreSQL en localhost:55432, con la base `cocos_test` inicializada desde el SQL del challenge y almacenamiento temporal. `npm test` y `test:orders` cargan `.env.test.example` y permiten overrides desde `.env.test`. Las variables ya exportadas en la terminal tienen prioridad.

Las pruebas de escritura exigen que el nombre de base termine en `_test`, crean usuarios propios y eliminan únicamente sus fixtures al finalizar. No operan sobre el usuario 1 del seed. Al detener y recrear el contenedor de pruebas se reinicializa su almacenamiento temporal. `test:instruments` consulta la configuración local; `test:portfolio` también puede inicializar snapshots faltantes, sin cambiar órdenes del seed.

La cobertura incluye persistencia y cambio del portfolio, redondeo por monto, reservas, rechazos de compras/ventas, entradas inválidas, cotizaciones ausentes y competencia entre solicitudes simultáneas de compra, reserva y venta.


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

Estas transferencias son movimientos simulados del challenge; no ejecutan operaciones contra bancos externos.


### Cancelación

`POST /users/:userId/orders/:orderId/cancel` cambia una orden NEW del usuario a CANCELLED y devuelve HTTP 200 con `{ id, userId, status }`. La fila se conserva, con su cantidad, precio y fecha originales. Las reservas se liberan al dejar de contabilizar la orden como NEW; no se altera la tenencia FILLED ni el saldo contable.

Cancelar FILLED, REJECTED o CANCELLED devuelve 409. Orden inexistente o perteneciente a otro usuario devuelve 404; identificadores inválidos devuelven 400. La validación y actualización ocurren dentro del bloqueo transaccional por usuario, y el UPDATE comprueba nuevamente que el estado sea NEW. Dos cancelaciones simultáneas producen una única cancelación exitosa.

### Verificación de consideraciones funcionales

| Consideración | Implementación y verificación |
| --- | --- |
| Precios en pesos | Cotizaciones y precios de órdenes en ARS; posición MONEDA con precio 1. |
| Sin simulación de mercado | MARKET usa la cotización almacenada; LIMIT no se ejecuta mediante matching. |
| Cantidad o monto, sin fracciones de acciones | Exactamente size o amount; floor(amount / precio), validación de entero positivo. |
| BUY y SELL | Enum de dominio, validación y persistencia de ambos lados. |
| NEW, FILLED, REJECTED, CANCELLED | Estados de dominio implementados y persistidos según el flujo. |
| MARKET inmediata | FILLED si hay recursos; ledger y portfolio reflejan la ejecución. |
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


## Identificadores BIGINT

Las claves primarias, referencias y secuencias usan PostgreSQL BIGINT. El dominio y Prisma trabajan con `bigint`; HTTP devuelve todos los IDs como strings decimales para conservar precisión. Enviar `instrumentId` como string (por ejemplo, `"47"`); los números JSON también se aceptan por compatibilidad. Los parámetros de ruta también se interpretan directamente como bigint, sin pasar por Number.

Los IDs se convierten con `BigInt` sin validaciones de límites numéricos en la aplicación. Los controladores convierten los IDs de respuesta a strings para serializarlos en JSON. `size` conserva INT y sus validaciones de cantidad positiva, sin fracciones. `accountNumber` sigue siendo texto y conserva ceros iniciales.

El archivo `docker/postgres/database.sql` ya define los IDs como BIGINT para nuevas bases. Las pruebas cubren IDs mayores a 2^53, incluyendo usuarios consecutivos, referencias a instrumentos y cancelación de órdenes.


## Ledger y snapshot de cuenta

`orders` conserva el historial de movimientos y sus estados. `account_snapshots` contiene una fila por usuario, identificada por `userid`:

| Columna | Contenido |
| --- | --- |
| `userid` | Clave primaria y referencia a users. |
| `cash` | Saldo contable en pesos (NUMERIC). |
| `reservedcash` | Pesos reservados por compras LIMIT NEW (NUMERIC). |
| `positions` | JSONB con instrumentId, cantidad, cantidad reservada, costo remanente e indicador de inconsistencia por posición. IDs y costos se guardan como strings. |
| `updatedat` | Fecha de actualización del estado derivado. |

No se guardan precios de mercado ni rendimientos en el snapshot: se calculan con las cotizaciones actuales al consultar. ARS se representa mediante cash y reservedcash, y el contrato HTTP sigue incluyéndolo en positions.

Una orden FILLED aplica su efecto incremental; una LIMIT NEW reserva recursos; una cancelación libera únicamente la reserva de la orden original. REJECTED no modifica el snapshot. La fila del usuario se bloquea antes de leer o escribir. Si falla la escritura del snapshot, también se revierte la creación o cancelación de la orden.

`readAccountSnapshot` solo consulta y devuelve null si no existe: nunca reproduce orders ni escribe. El llamador solicita explícitamente `initializeAccountSnapshot` cuando falta, dentro de la misma transacción y bloqueo de usuario. La inicialización construye el estado leyendo orders en lotes de 1000, ordenados por datetime e id, y conserva cualquier snapshot ya existente. `rebuildAccountSnapshot` sigue siendo la operación explícita para reemplazar un snapshot desde el historial. Las operaciones siguientes leen y actualizan una fila y sus posiciones, sin cargar el historial. La inicialización también crea snapshots vacíos para usuarios sin movimientos. Los datos inconsistentes del seed conservan el tratamiento documentado para BMA.

El esquema de la tabla está en el SQL inicial, sin archivos de migración. Para reconstruir snapshots a partir de orders (por ejemplo después de editar o importar órdenes directamente):

```sh
# Local, todos los usuarios:
npm run snapshots:rebuild
# Solo un usuario:
npm run snapshots:rebuild -- 1
# Con la API de Docker ya compilada:
docker compose exec -T api node scripts/rebuild-snapshots.mjs
```

La reconstrucción reemplaza el snapshot de cada usuario bajo el mismo bloqueo y es repetible; no modifica orders. Cambios de órdenes por fuera de la API requieren reconstrucción explícita. No se usa un corte por máximo ID, porque una cancelación cambia el estado de una orden existente. Este snapshot representa el estado actual, no un histórico diario ni un cierre de mercado. No hay un proceso programado necesario para mantenerlo al día.

Las pruebas verifican reconstrucción repetida, lectura paginada, ausencia de consultas al historial con un snapshot existente, precios actuales y rollback conjunto de órdenes, cancelaciones y snapshots, además de los casos de concurrencia.


La validación del envío de órdenes está definida con Zod en `src/orders/application/order.schema.ts`. Usa esquemas estrictos para MARKET y LIMIT, normaliza importes a strings decimales e IDs a bigint, y devuelve errores HTTP 400 con el campo afectado. El dominio conserva las decisiones sobre recursos, cantidad calculada y estado de la orden; no importa Zod.


## Deduplicación de órdenes

Cada envío requiere `transactionId`, un string no vacío de hasta 100 caracteres (se quitan espacios de los extremos; distingue mayúsculas). El cliente lo genera una vez por operación, por ejemplo con `crypto.randomUUID()`, y lo conserva al reintentar por timeout o pérdida de conexión.

La unicidad es global: `UNIQUE(transactionid)` en orders. Un identificador no puede repetirse aunque pertenezca a otro usuario. Dentro del bloqueo de usuario, antes de consultar cotizaciones o recursos:

- Si el transactionId ya existe, devuelve HTTP 409 con `transactionId already exists`. No procesa la orden ni modifica el snapshot, independientemente del contenido enviado o del estado de la orden existente.
- Si no existe, procesa la orden y guarda su transactionId en la misma transacción que el snapshot. Una orden creada devuelve HTTP 201, incluida REJECTED.

Con solicitudes simultáneas para el mismo identificador, incluso desde usuarios distintos, solo una puede crear la orden. La restricción única resuelve la carrera entre usuarios; su violación se traduce a HTTP 409 y revierte la transacción perdedora. El bloqueo por usuario sigue protegiendo sus fondos. No se almacena ni compara un fingerprint del contenido y no se devuelve la orden anterior.

Una orden REJECTED o CANCELLED también conserva su identificador. Los errores de validación y transacciones revertidas no lo consumen. Un 409 confirma que ese identificador ya fue usado; no significa que la orden anterior se haya ejecutado (podría estar rechazada o cancelada). No generar un ID nuevo para reintentar automáticamente una operación de resultado desconocido.

Las órdenes del seed pueden tener transactionId en NULL; los nuevos envíos por API lo requieren. La definición está en `docker/postgres/database.sql` y Prisma, sin un archivo de migración adicional. Las pruebas cubren concurrencia, unicidad entre usuarios, transferencias, rechazos, cancelaciones, rollback y la restricción única de PostgreSQL.
