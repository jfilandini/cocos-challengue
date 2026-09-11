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
El parámetro `query` es obligatorio: debe contener texto luego de quitar espacios al inicio y al final. Busca coincidencias parciales por ticker **o** nombre, sin distinguir mayúsculas y minúsculas. Los acentos se conservan y los caracteres `%`, `_` y `\` se buscan literalmente.

La búsqueda acepta `page` (por defecto `1`) y `limit` (por defecto `20`, máximo `100`), ambos enteros positivos. Ejemplo: `GET /instruments?query=molin&page=2&limit=2`.

La respuesta es `{ items, total, page, limit, totalPages }`. `items` contiene objetos `{ id, ticker, name, type }` ordenados por ticker e ID. `total` cuenta todas las coincidencias y `totalPages` indica la cantidad de páginas. Esta estructura reemplaza el array anterior; los consumidores deben leer `items`. Incluye acciones y monedas: ARS puede encontrarse por ticker (`ars`) o nombre (`pesos`). Si no hay coincidencias, devuelve `items: []`, `total: 0` y `totalPages: 0`. Una página posterior a la última devuelve `items: []` y conserva los totales. Una búsqueda ausente, vacía o inválida, o parámetros de paginación inválidos, devuelve HTTP 400.

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

src/snapshot/
  domain/account-snapshot.ts                   Modelos y funciones puras de transición de estado
  application/ports/account-snapshot.repository.ts Puerto de salida del repositorio
  infrastructure/persistence/                  Adaptador Prisma y mapper de órdenes
  snapshot.module.ts                           Composición e inyección de dependencias
```

El controlador invoca el caso de uso y convierte errores de entrada en HTTP 400. El caso de uso depende del contrato `InstrumentRepository`; el módulo NestJS lo conecta con `PrismaInstrumentRepository` mediante una fábrica. El adaptador Prisma implementa la búsqueda y el escape de patrones SQL, devolviendo modelos propios. La misma operación puede invocarse desde otro adaptador sin depender de HTTP.

`npm run test:unit` prueba los casos de uso y cálculos sin iniciar NestJS ni PostgreSQL. `npm run test:instruments` ejecuta las pruebas de búsqueda; `npm test` ejecuta toda la suite, incluyendo las funcionales con la base del challenge.

La separación de pruebas por responsabilidad, los escenarios de integración y los comandos de ejecución se detallan en [`test/README.md`](test/README.md).

- `src/shared/infrastructure/database`: proveedor Prisma compartido, con conexión al iniciar y desconexión al cerrar.
- `src/shared/infrastructure/http/health.controller.ts`: consulta `SELECT 1` mediante Prisma; responde 503 si la base no está disponible. Es una comprobación de infraestructura, sin lógica de negocio.
- `prisma/schema.prisma`: mapeo de las tablas originales y de `account_snapshots`, el estado derivado de cada cuenta.
- `prisma.config.ts`: configuración de conexión para la CLI de Prisma.
- `docker/postgres/database.sql`: datos del challenge, con IDs BIGINT y ajustes de esquema del proyecto.

PostgreSQL convierte los identificadores sin comillas a minúsculas. Los modelos usan `@map` para exponer campos como `userId` sin renombrar columnas. La cotización usa `date`, tal como aparece en el SQL.

Prisma 7 utiliza el adaptador PostgreSQL y genera el cliente en `src/generated/prisma`, excluido de Git y generado durante el build. Referencia: [configuración de Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

### Gestión del esquema y base de datos preexistente

El diseño toma la base proporcionada como punto de partida y adopta un supuesto conservador: pertenece a un ecosistema externo y la aplicación no es responsable de administrar su esquema ni tiene autoridad para modificarlo automáticamente. Por eso se respetan los nombres y convenciones existentes mediante los mapeos de Prisma, y no se utiliza **Prisma Migrate** para gestionar su evolución. Este supuesto se refiere a la administración del esquema, no a las lecturas y escrituras de negocio que realiza la API.

La entrega incluye ajustes de esquema necesarios para la solución, documentados en `docker/postgres/database.sql` y reflejados en `prisma/schema.prisma`; no implica que la base original permanezca intacta. En un entorno administrado externamente, esos ajustes deberían coordinarse y aplicarse por el responsable de la base antes de desplegar la aplicación. Para reproducir el challenge localmente, el SQL inicializa el esquema únicamente sobre un volumen vacío; la aplicación no aplica esos cambios al arrancar.

Si la aplicación fuera propietaria del esquema y responsable de su evolución, se habría utilizado **Prisma Migrate** para versionar los cambios y aplicarlos de forma controlada durante el despliegue.

El dataset conserva la inconsistencia conocida del usuario 1: BMA tiene una compra ejecutada de 20 acciones y una venta ejecutada de 30. El tratamiento se documenta en la sección Portfolio.

La prueba funcional de envío de órdenes está en `test/e2e/orders.e2e.test.mjs` y usa una base de pruebas aislada.

## Portfolio

También se puede consultar mediante `GET /accounts/:accountNumber/portfolio`, por ejemplo `/accounts/10001/portfolio`. Devuelve el mismo contrato que la búsqueda por usuario, incluido el `userId` resuelto. `findByAccountNumber` usa igualdad exacta y mantiene los ceros iniciales; solo quita espacios al inicio y al final. Acepta de 1 a 20 caracteres, acorde con la columna original.

La resolución del portfolio por número de cuenta busca el usuario correspondiente sin bloqueos. Una cuenta inexistente devuelve 404, una entrada inválida 400 y números de cuenta duplicados 409. El SQL original no garantiza unicidad: se detecta la ambigüedad sin elegir arbitrariamente un usuario ni modificar el esquema.

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
- **Lectura no bloqueante (*Lock-free Read*):** El portfolio lee el snapshot existente y las cotizaciones mediante consultas directas sin bloqueos pesimistas ni transacciones de escritura, aprovechando el aislamiento MVCC de PostgreSQL. Esto garantiza que las consultas de portfolio nunca bloqueen ni sean bloqueadas por el envío concurrente de órdenes, y que múltiples lecturas corran en paralelo.
- **Inicialización diferida (*Lazy fallback*):** Únicamente en caso de que el snapshot aún no exista en la base de datos (`null`), se adquiere un bloqueo pesimista `SELECT ... FOR UPDATE` sobre la fila del usuario para reconstruirlo a partir del historial de órdenes y guardarlo de forma atómica y consistente por primera vez.

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
- No se agregan comisiones ni se admiten ventas en corto. Cada transactionId nuevo crea una orden; los reintentos equivalentes del mismo usuario devuelven la orden existente con HTTP 200; otra solicitud o usuario con el mismo identificador recibe HTTP 409.

El caso de uso depende de un puerto transaccional. Prisma bloquea la fila del usuario con `SELECT ... FOR UPDATE` parametrizado antes de leer recursos y guardar la orden. Se usa `ReadCommitted` para que una solicitud que esperó el bloqueo vea la orden ya confirmada por la anterior. La ejecución y la persistencia del rechazo suceden dentro de esa transacción. Cancelaciones, transferencias y compras/ventas usan el mismo bloqueo por usuario.

`orders` es el registro de órdenes y la fuente de verdad; `account_snapshots` almacena su estado derivado. El portfolio y la validación de recursos leen el snapshot. Guardar una orden aceptada o cancelarla actualiza su snapshot dentro de la misma transacción. La cancelación tiene una ruta específica; el envío por número de cuenta queda fuera de este endpoint.

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


## Documentación Swagger / OpenAPI

La API cuenta con documentación interactiva generada con Swagger (OpenAPI 3.0):

- **Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs) (o el puerto configurado en `API_PORT` / `PORT`)
- **Especificación OpenAPI (JSON):** [http://localhost:3000/docs-json](http://localhost:3000/docs-json)

Desde la interfaz web de Swagger es posible consultar y probar los endpoints de:
- **Instruments:** Búsqueda de activos por ticker o nombre (`GET /instruments`).
- **Portfolio:** Consulta de portfolio por usuario (`GET /users/:userId/portfolio`) o por número de cuenta (`GET /accounts/:accountNumber/portfolio`).
- **Orders:** Envío de órdenes MARKET y LIMIT, transferencias CASH_IN y CASH_OUT (`POST /users/:userId/orders`) y cancelación de órdenes en estado NEW (`POST /users/:userId/orders/:orderId/cancel`).


## Registro de Órdenes y Snapshot de Cuenta

Para evitar recorrer y recalcular el historial de órdenes del usuario en cada consulta de portfolio o validación de recursos, una vez inicializado el snapshot:

- **Registro de órdenes como fuente de verdad (`orders`):** Conserva las órdenes y su estado actual (`FILLED`, `NEW`, `REJECTED`, `CANCELLED`). Las cancelaciones actualizan el estado de las órdenes pendientes; no se conserva un historial inmutable de eventos ni la fecha de cada transición. Las órdenes ejecutadas no se modifican desde la API.
- **Snapshot de estado (`account_snapshots`):** Almacena una proyección consolidada por usuario con su saldo contable (`settledcash`), pesos reservados por compras pendientes (`reservedcash`) y sus posiciones vigentes. Se gestiona desde su propio módulo [`src/snapshot/`](src/snapshot).
- **Actualización transaccional incremental (Escritura con bloqueo pesimista):** Las órdenes ejecutadas modifican saldos y posiciones, las pendientes reservan recursos y las cancelaciones liberan reservas, dentro de la misma transacción ACID que persiste la orden o su cambio de estado. Utiliza `SELECT ... FOR UPDATE` sobre el usuario para serializar la validación de fondos y evitar condiciones de carrera (*lost updates*). Las órdenes rechazadas no alteran esos recursos.
- **Lectura desacoplada y no bloqueante (*Lock-free Read*):** Las consultas de portfolio leen la proyección materializada directamente sin abrir transacciones de bloqueo pesimista (`FOR UPDATE`), permitiendo lecturas concurrentes y maximizando el throughput sin interferir con los envíos de órdenes.
- **Costo de las operaciones habituales:** El snapshot evita reproducir el historial de órdenes en cada consulta o validación. El trabajo sigue dependiendo de las posiciones y cotizaciones involucradas: se recorren y ordenan posiciones, y sus datos se leen y persisten como JSON.
- **Reconstrucción:** Si falta el snapshot, se inicializa automáticamente bajo bloqueo seguro desde las órdenes del usuario. Ante modificaciones manuales o mantenimiento, el estado actual puede regenerarse mediante `npm run snapshots:rebuild`, que vuelve a procesar el historial. Esto no permite reconstruir las reservas a una fecha pasada, porque no se conservan todas las transiciones de estado.


## Deduplicación e Idempotencia de Órdenes

Para garantizar la consistencia de la base de datos y evitar el procesamiento de órdenes duplicadas ante reintentos de red:

- **Validación de `transactionId`:** Cada solicitud de orden valida un identificador único (`transactionId`). Un identificador nuevo crea la orden con HTTP 201. Si se repite con el mismo usuario y solicitud equivalente, devuelve la orden existente con HTTP 200 y su estado actual, sin recalcular precios, modificar el snapshot ni ejecutar nuevamente. Una solicitud o usuario diferente recibe HTTP 409.
- **Compatibilidad con datos iniciales:** La columna permite valores `NULL` exclusivamente para preservar la compatibilidad con el dataset provisto inicialmente en el challenge.
- **Comparación de solicitudes:** `orders.originalrequest` guarda una representación normalizada de instrumento, side, type, size, amount y price. Los importes equivalentes (`10` y `"10.00"`) coinciden; cambiar de size a amount se considera otra solicitud. El precio de ejecución MARKET no participa de la comparación. Órdenes anteriores sin esta información devuelven 409; no se infiere la intención original a partir del resultado.
- **Esquema existente:** El SQL inicial incluye `originalRequest TEXT`. Para una base ya creada, ejecutar `ALTER TABLE orders ADD COLUMN IF NOT EXISTS originalrequest TEXT;` antes de arrancar la nueva versión.
- **Identificador obligatorio:** El cliente debe proporcionar `transactionId`; si falta, la API devuelve 400. El índice único global se conserva para proteger también las solicitudes simultáneas.


## Consideraciones para Entornos Productivos

Para la evolución de esta solución hacia un entorno de producción de alta escala y criticidad financiera, se destacan las siguientes sugerencias arquitectónicas:

### 1. Observabilidad y Monitoreo de Métricas (APM)

En un entorno productivo se sugiere implementar un agente de seguimiento de métricas y rendimiento de aplicaciones (APM), como **Datadog** o **New Relic** (o soluciones basadas en **OpenTelemetry**), para supervisar en tiempo real latencias (p95/p99), throughput, tasas de error, saturación del connection pool de la base de datos y trazabilidad distribuida de transacciones.

### 2. Sugerencia de Desacople en Microservicios y Patrón Saga

Como sugerencia de evolución arquitectónica, para escenarios de alta concurrencia y crecimiento de equipos, el proyecto podría desacoplarse en **microservicios** especializados según sus contextos delimitados (por ejemplo, servicios independientes para *Orders*, *Portfolio/Ledger*, *Market Data* y *Accounts*).

En un esquema distribuido con bases de datos independientes por servicio, para coordinar los flujos transaccionales y mantener la consistencia de los datos de forma organizada y mantenible, se debería implementar el **Patrón Saga** (adoptando cualquiera de sus dos modalidades: **orquestación** con un coordinador o **coreografía** orientada a eventos con un message broker).

### 3. Mantenimiento y Auditoría de Dependencias

- **Resolución de avisos de `npm audit`:** Resolver las advertencias de dependencias transitivas asociadas a la CLI de Prisma cuando se publiquen parches compatibles upstream, evitando aplicar *downgrades* mayores forzados.

### 4. Auditoría de Operaciones

Actualmente se conserva el estado de las órdenes, pero no un historial completo de sus transiciones. Para un entorno productivo, se propone incorporar un registro de auditoría **append-only** (sin modificar ni eliminar registros previos) de los eventos relevantes de negocio, como la creación, ejecución, rechazo y cancelación de órdenes y los movimientos de fondos. Cada registro incluiría la operación, el actor, la fecha, el identificador de correlación y los estados anterior y nuevo, cuando corresponda. Este historial complementaría los logs técnicos de la aplicación.

La persistencia del registro de auditoría debería ser atómica con la operación de negocio. Inicialmente podría almacenarse en una tabla de PostgreSQL, sin requerir una base separada. Si se publica a un sistema externo, podría utilizarse el patrón **transactional outbox**, guardando el evento en la misma transacción y publicándolo posteriormente con reintentos y deduplicación.

### 5. Normalización de Posiciones del Snapshot

Actualmente `account_snapshots` almacena las posiciones de cada usuario en un campo JSON. Esta representación simplifica la persistencia para el alcance del challenge, aunque la implementación lee el conjunto de posiciones y vuelve a guardar el JSON completo cuando cambia una posición.

Si aumenta la cantidad de posiciones por cuenta o se necesitan consultas individuales, se podría migrar a una tabla `account_snapshot_positions`, con una fila por usuario e instrumento y una clave única sobre `(user_id, instrument_id)`. Cada fila almacenaría cantidad, cantidad reservada, costo acumulado e indicador de historial inconsistente. Esto permitiría consultar y actualizar la posición afectada sin reescribir las demás, además de incorporar claves foráneas y restricciones sobre los datos.

Los saldos y reservas de efectivo permanecerían en `account_snapshots`. La actualización de la orden, el efectivo y las posiciones debería conservarse en una misma transacción; esta normalización no elimina por sí sola la necesidad de coordinar las operaciones concurrentes sobre los recursos del usuario. Las posiciones seguirían siendo estado derivado del registro de órdenes.
