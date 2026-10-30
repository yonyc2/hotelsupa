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
