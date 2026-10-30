// Edge Function "create-user": permite que un ADMINISTRADOR cree usuarios desde la aplicación.
// Usa la clave secreta (service_role) que Supabase le da a la función; esa clave NUNCA llega al navegador.
//
// Cómo publicarla (sin instalar nada): Supabase > Edge Functions > Deploy a new function > "Via Editor",
// nómbrala  create-user , pega este código y presiona Deploy.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;

    // 1) Quién llama: se valida su sesión
    const auth = req.headers.get('Authorization') ?? '';
    const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'No autenticado' }, 401);

    // 2) Debe ser administrador activo
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).maybeSingle();
    if (!me || !me.active || me.role !== 'admin') return json({ error: 'Sin permiso para esta acción' }, 403);

    // 3) Validaciones (iguales a las de la aplicación)
    const { username, email, password, full_name, role } = await req.json();
    if (!username || !email || !password || !full_name || !role) return json({ error: 'Todos los campos son requeridos' }, 400);
    if (!['admin', 'recepcion', 'toallero'].includes(role)) return json({ error: 'Rol inválido' }, 400);
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(String(username).trim())) {
      return json({ error: 'El usuario debe tener de 3 a 32 caracteres (letras, números, punto, guion)' }, 400);
    }
    const pw = String(password);
    if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      return json({ error: 'La contraseña debe tener al menos 8 caracteres, con letras y números' }, 400);
    }
    const name = String(full_name).trim();
    if (!name || name.length > 100) return json({ error: 'El nombre completo debe tener de 1 a 100 caracteres' }, 400);

    const { data: dup } = await admin.from('profiles').select('id').ilike('username', String(username).trim()).maybeSingle();
    if (dup) return json({ error: 'Ese usuario ya existe' }, 400);

    // 4) Crear el usuario en Auth (el disparador crea su perfil) y asignarle rol y estado activo
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: String(email).toLowerCase(),
      password: pw,
      email_confirm: true,
      user_metadata: { username: String(username).trim(), full_name: name },
    });
    if (createErr || !created.user) return json({ error: createErr?.message ?? 'No se pudo crear el usuario' }, 400);

    const { error: profErr } = await admin.from('profiles').update({ role, active: true }).eq('id', created.user.id);
    if (profErr) {
      await admin.auth.admin.deleteUser(created.user.id);   // no dejar un usuario a medias
      return json({ error: 'No se pudo asignar el rol del usuario' }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});
