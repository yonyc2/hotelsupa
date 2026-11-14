# Configuración de Supabase

## 1. Base de datos
1. Supabase > **SQL Editor** > New query.
2. Pega todo `supabase/schema.sql` y presiona **Run**.
   - Si ya lo habías corrido antes (versión sin `data_version`), corre solo `supabase/parche-data_version.sql`.

## 2. Primer administrador
Supabase > **Authentication > Users > Add user > Create new user**
- Email: `admin@hotel.local` (el dominio debe ser el de `EMAIL_DOMAIN` en `js/config.js`)
- Password: una contraseña fuerte
- Marca **Auto Confirm User**

El primer usuario creado queda como administrador automáticamente.
Para entrar a la app escribe `admin` (o el correo completo) y la contraseña.

## 3. Authentication
**Authentication > Sign In / Providers > Email**: desactiva *Allow new users to sign up*
(los usuarios los crea un administrador).

## 4. Crear usuarios desde la aplicación (opcional)
Para que el formulario "Crear usuario" de la pantalla de administración funcione:
1. Supabase > **Edge Functions > Deploy a new function > Via Editor**.
2. Nombre: `create-user`.
3. Pega el contenido de `supabase/functions/create-user/index.ts` y presiona **Deploy**.

Sin esto, crea los usuarios en **Authentication > Users** y luego actívalos con rol así (SQL Editor):
```sql
update public.profiles set role = 'recepcion', active = true where username = 'maria';
```
(los usuarios nuevos quedan *inactivos* como `toallero` hasta que los actives).

## Seguridad
- `js/config.js` solo lleva la clave **publishable** (pública por diseño). Nunca pongas la clave *secret* / *service_role*.
- Nadie puede escribir directo en las tablas: todo pasa por funciones que validan el rol y las reglas.

## Actualizaciones de la base (si ya tenías el script instalado)
- `supabase/migracion-quitar-tarjetas.sql`: quita la "cantidad de tarjetas" de los huéspedes. Orden: primero publica la versión nueva de la app y **después** ejecútalo una vez en el SQL Editor (la app nueva funciona con la base vieja y con la nueva, pero la app vieja deja de funcionar con la base nueva).
- `supabase/migracion-eliminar-antiguos.sql`: activa (o actualiza) el botón "Eliminar datos antiguos" de la administración, que borra huéspedes con check-out, historial y usuarios desactivados hasta una fecha. Ejecútalo en el SQL Editor; si ya habías corrido una versión anterior, vuelve a correrlo (la reemplaza). Borrar usuarios requiere permiso sobre `auth.users`, que el SQL Editor y las funciones de Supabase normalmente tienen.
- `supabase/liberar-espacio.sql`: consultas para ver cuánto ocupa cada tabla y compactarlas (`VACUUM FULL`) después de eliminar datos, para devolver el espacio al disco.
- `supabase/migracion-reporte-toallas.sql`: agrega la función del "Reporte de toallas" por día (visible en Recepción, Toallero y Administración). Ejecútalo una vez en el SQL Editor; sin ella el reporte mostrará un error.
- `supabase/migracion-editar-huesped.sql`: permite editar nombre, habitación y código de tarjeta del huésped desde Recepción (botón "Editar" en el detalle). Ejecútalo una vez en el SQL Editor **antes** de publicar la app nueva (la app nueva necesita la función nueva; la vieja sigue funcionando con ella).
