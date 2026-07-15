# Conectar ATC24 Web con Discord (login real)

Sigue estos pasos en tu propia cuenta de Discord. Nadie más que tú ve el Client Secret ni el Bot Token — pégalos solo en el archivo `.env` de este folder (nunca en el chat).

## 1. Crear la aplicación

1. Entra a https://discord.com/developers/applications (con tu cuenta de Discord).
2. **New Application** → ponle un nombre, por ejemplo `ATC24 Español`.
3. En la pestaña **OAuth2 → General**:
   - Copia el **Client ID** → pégalo en `.env` como `DISCORD_CLIENT_ID`.
   - Clic en **Reset Secret**, copia el **Client Secret** → pégalo como `DISCORD_CLIENT_SECRET`.

## 2. Configurar el redirect

1. Sigue en **OAuth2 → General**, sección **Redirects**.
2. Clic en **Add Redirect** y pega exactamente:
   ```
   http://localhost:3000/auth/discord/callback
   ```
3. Guarda los cambios (**Save Changes** abajo).
4. Este mismo valor va en `.env` como `DISCORD_REDIRECT_URI` (ya viene puesto en el `.env.example`).

## 3. Crear el bot (para leer roles del servidor)

1. Pestaña **Bot** → **Add Bot** (si no existe todavía).
2. Clic en **Reset Token**, copia el token → pégalo en `.env` como `DISCORD_BOT_TOKEN`.
3. No hace falta activar ningún "Privileged Gateway Intent" para esto.

## 4. Meter el bot a tu servidor

1. Pestaña **OAuth2 → URL Generator**.
2. En **Scopes** marca solo `bot`.
3. En **Bot Permissions** no necesitas marcar nada (o `View Channels` si quieres).
4. Copia la URL generada abajo, ábrela en el navegador, elige tu servidor (ATC24 Español) y autoriza.

## 5. Conseguir el ID de tu servidor

1. En Discord (app o web): **Ajustes de usuario → Avanzado → Modo desarrollador** → actívalo.
2. Clic derecho sobre el ícono de tu servidor → **Copiar ID del servidor**.
3. Pégalo en `.env` como `DISCORD_GUILD_ID`.

## 6. Conseguir los IDs de los roles

1. **Ajustes del servidor → Roles**.
2. Clic derecho sobre cada rol que quieras mapear (piloto, controlador, admin) → **Copiar ID**.
3. Pégalos en `.env`:
   - `ROLE_ID_PILOT`
   - `ROLE_ID_CONTROLLER`
   - `ROLE_ID_ADMIN`
   (Si algún rol no existe todavía en tu servidor, déjalo vacío — a esos usuarios se les asigna "pilot" por defecto en cuanto se verifiquen.)

## 7. Completar `.env`

1. Copia `backend/.env.example` a `backend/.env`.
2. Pega ahí los valores que juntaste arriba.
3. `SESSION_SECRET` puede ser cualquier texto largo y aleatorio — solo se usa para firmar la sesión localmente, no lo compartas.

## 8. Levantar todo

```
cd backend
npm install   # si no lo hiciste ya
npm start
```

Abre `http://localhost:3000` — el sitio y el login real de Discord corren desde ahí (mismo puerto, sin CORS).

## Notas

- Sin `.env` completo, el servidor no arranca y te dice exactamente qué variable falta.
- El login necesita internet siempre (llama a la API de Discord) — el resto del sitio funciona sin conexión.
- Si un usuario hace login pero no es miembro de tu servidor, se le manda de vuelta con un aviso — no se cuela sin pertenecer al Discord.
