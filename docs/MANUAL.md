# Manual de uso

## Roles
- **Administrador**: tiene todos los privilegios. Además de la administración (usuarios, historial, exportar, respaldos), puede usar las pantallas de Recepción y de Toallero; un menú en la barra superior permite pasar de una a otra.
- **Recepción**: registrar y editar huéspedes, check-out.
- **Toallero**: escanear tarjeta, entregar y devolver toallas.

Después de 5 intentos fallidos con un usuario (o 30 en el navegador) el acceso se bloquea 15 minutos.
La sesión se renueva sola mientras uses la aplicación. Los usuarios inactivos no pueden entrar.

## Recepción
1. **Registrar huésped**: nombre, habitación, código de tarjeta (4 a 20 dígitos), límite de toallas, toallas iniciales y comentario.
   - Una habitación o un código solo puede estar activo con un huésped a la vez; tras el check-out se pueden reutilizar.
   - Las toallas iniciales no pueden superar el límite.
2. **Buscar** por nombre, habitación o código; "Mostrar todos" incluye a quienes ya salieron.
3. **Detalle**: editar límite (no menor a las toallas que ya tiene) y comentario.
4. **Check-out**: solo cuando el huésped tiene 0 toallas.

## Toallero
Escanea el código de la tarjeta (o escríbelo y presiona Enter). Se muestran los datos del huésped y los últimos movimientos.
- **Entregar**: no puede superar el límite.
- **Devolver**: no puede dejar la cuenta en negativo.

## Administración
- **Crear usuario**: usuario de 3 a 32 caracteres (letras, números, punto, guion), contraseña de 8 o más con letras y números. Requiere publicar la función `create-user` (ver `supabase/LEEME.md`); si no, crea los usuarios en Supabase > Authentication > Users.
- **Activar/desactivar** usuarios (no puedes desactivarte a ti mismo).
- **Historial**: filtros por texto y acción, y cantidad de registros.
- **Eliminar datos antiguos**: elige una fecha y, hasta ese día (inclusive, hora de CDMX), borra:
  - los huéspedes que ya hicieron check-out, con sus movimientos de toallas;
  - todo el historial anterior a esa fecha;
  - los usuarios desactivados creados hasta esa fecha (también se borran de Authentication en Supabase).

  Muestra cuántos registros y qué usuarios se eliminarían, y pide confirmar escribiendo ELIMINAR.
  Los datos se borran definitivamente de la base de datos y no se crea ningún archivo de respaldo.
  Nunca toca a los huéspedes activos ni a los usuarios activos,
  y no acepta fechas futuras. No se puede deshacer desde la app.
- **Exportar base de datos**:
  1. Descarga un Excel con 4 hojas: Usuarios, Huespedes (activos y con check-out, con todos sus datos), Movimientos e Historial. No incluye contraseñas.
  2. **Borra el historial** de la base de datos. Usuarios, huéspedes y movimientos se conservan.

## Respaldos
Los datos están en Supabase, no en el navegador. Aun así conviene tener copias propias:
- **Elegir carpeta de respaldos automáticos** (Chrome/Edge): al abrir la administración se guarda un `.json` por día con todas las tablas y se conservan los últimos 14. El navegador puede pedir permiso otra vez en cada sesión; "Respaldar ahora" lo reactiva.
- **Respaldar ahora**: guarda un `.json` en la carpeta elegida o lo descarga.
- **Exportar base de datos**: el Excel también sirve como copia de consulta.
- Revisa en Supabase las opciones de respaldo de tu plan (Database > Backups).
- Restaurar un `.json` no se hace desde la app (las tablas están protegidas); si lo necesitas, se hace desde el SQL Editor de Supabase.
