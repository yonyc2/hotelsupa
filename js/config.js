// =====================================================
// CONFIGURACIÓN DE SUPABASE
// La clave "publishable" (antes "anon") es PÚBLICA por diseño: la seguridad real está en las
// reglas de la base de datos. NUNCA pongas aquí la clave "secret" / "service_role".
// =====================================================
const CONFIG = {
  SUPABASE_URL: 'https://mbbrcawwjjxbwbbdyzjo.supabase.co',
  SUPABASE_KEY: 'sb_publishable_4VnRAdBkfJbWuVRtSCYisQ_DP7hHE5W',

  // Supabase inicia sesión con correo. Si escribes solo "maria", se usa "maria@" + este dominio.
  // Debe ser el mismo dominio con el que creaste los usuarios en Authentication > Users.
  EMAIL_DOMAIN: 'hotel.local',

  // Cada cuántos milisegundos se revisa si otro dispositivo hizo cambios
  POLL_MS: 4000
};
