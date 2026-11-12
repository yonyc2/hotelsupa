# Control de Toallas (HTML + CSS + JavaScript + Supabase)

Aplicación web sin servidor propio: solo archivos estáticos (se puede publicar en Vercel, Netlify,
GitHub Pages o abrir `index.html` directamente) y una base de datos en Supabase compartida por
todos los dispositivos. No usa Node, npm ni librerías externas.

## Puesta en marcha
1. Configura Supabase siguiendo `supabase/LEEME.md` (script de la base, primer administrador).
2. Revisa `js/config.js` (URL, clave publishable y dominio de correo de los usuarios).
3. Abre `index.html` o publica la carpeta en Vercel.
4. Entra con el administrador que creaste en Supabase (escribe el usuario o el correo completo).

## Estructura
```
index.html        entrada: manda a cada rol a su pantalla
login.html        inicio de sesión
recepcion.html    altas, búsqueda, edición y check-out de huéspedes
toallero.html     escaneo de tarjeta y entrega/devolución de toallas
admin.html        usuarios, historial, exportar a Excel, respaldos
css/app.css       estilos y animaciones
js/config.js      URL y clave pública de Supabase
js/supabase.js    cliente mínimo de Supabase (Auth, REST, RPC) sin librerías
js/backend.js     traduce las rutas /api/... a llamadas a Supabase
js/storage.js     sesión del navegador y bloqueo por intentos fallidos
js/xlsx.js        generador de Excel (.xlsx) sin librerías
js/reporte.js     reporte de toallas por día (Recepción, Toallero y Administración)
js/backup.js      respaldos (carpeta automática diaria y manual)
js/common.js      utilidades, protección de páginas y actualización entre dispositivos
js/login.js, recepcion.js, toallero.js, admin.js   lógica de cada pantalla
supabase/schema.sql                      tablas, reglas de negocio y seguridad (RLS)
supabase/functions/create-user/index.ts  función para crear usuarios desde la app (opcional)
supabase/LEEME.md                        guía de configuración de Supabase
```

## Cómo funciona
- Los datos están en Supabase: lo que se registra en un dispositivo lo ven los demás.
- La app revisa cada pocos segundos si hubo cambios (`data_version`) y solo entonces recarga las listas.
- Las reglas (límite de toallas, check-out con 0 toallas, códigos únicos...) viven en la base de datos:
  el navegador no puede escribir directo en las tablas, solo llamar a funciones que validan el rol.
- La clave de `js/config.js` es la *publishable* (pública por diseño). Nunca pongas la *secret* / *service_role*.
- El plan gratuito de Supabase puede pausar el proyecto tras un tiempo sin uso: revisa sus condiciones vigentes.
