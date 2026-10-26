# Distribución de modpacks

`distribution.json` es la lista de modpacks que muestra Keee Launcher. Cada entrada de `servers` es un modpack. La carpeta `files/` contiene los archivos que no están en una web pública (el `version.json` del loader y los configs de cada modpack).

## Importar un perfil de Modrinth App

```
node tools/import-modrinth-profile.js "%APPDATA%\ModrinthApp\profiles\<perfil>" <id> "Nombre"
```

Crea `modpacks/<id>/` con los mods de Modrinth fijados a su versión exacta, los jars que no están en Modrinth en `mods/` y `config/` en `files/config/`. Revisa `files/`: lo que hay ahí se fuerza en cada arranque, así que quita los configs que cada jugador debería poder cambiar (gráficos, Sodium, Iris...). Pon el icono como `modpacks/<id>/icon.png` (o `.avif`, `.svg`, `.webp`).

## Importar un `.mrpack` (exportado desde Modrinth App)

Mete el `.mrpack` en `modpacks/<id>/` junto a un `modpack.json` con el nombre, la descripción, etc. (mira `modpacks/cobblemon-hazte-con-todos`). La versión de Minecraft, el loader, los mods, resource packs, shaders y los overrides salen del `.mrpack`. Para actualizar el modpack, exporta uno nuevo, borra el viejo, sube `version` y vuelve a generar.

- Los jars de `modpacks/<id>/mods/` sustituyen a los del `.mrpack` con el mismo id de mod (aunque sean otra versión), así puedes actualizar tus mods sin reexportar.
- Lo de `modpacks/<id>/files/` gana sobre los overrides del `.mrpack`.
- Los mods desactivados en Modrinth App (`.jar.disabled`) quedan como opcionales y desactivados.
- `"defaults"` en `modpack.json`: rutas que solo se copian si el jugador no las tiene (ajustes de vídeo, minimapa…), para no machacar sus cambios en cada arranque. Acepta carpetas (`config/xaero/`) y `*` (`shaderpacks/*.txt`).
- Los `.mrpack` no se suben a git (pesan demasiado); guárdalos tú.

## Archivos de más de 90 MB

GitHub no acepta archivos de más de 100 MB en un repo, así que `build-modpack.js` los deja en `distribution/large/` y `npm run publish:modpacks` los sube como assets de la release `files` de `Javikeee/keee-modpacks` (necesita `gh` con sesión iniciada). En `npm start` se sirven en local.

## Borradores

Con `"draft": true` en `modpack.json` el modpack funciona en `npm start` pero `npm run publish:modpacks` no lo sube. Quítalo cuando quieras publicarlo.

## Crear o actualizar un modpack

1. Define el modpack en `modpacks/<id>/modpack.json` (mira `modpacks/keee-demo` de ejemplo):
   - `loader`: de momento `fabric` (`"version": "latest"` o una versión concreta).
   - `mods`: lista de mods de [Modrinth](https://modrinth.com) por su *slug* (lo que sale en la URL, p. ej. `modrinth.com/mod/sodium` → `"sodium"`). Opcionales:
     - `"version"`: fija una versión concreta (si no, se usa la última release para esa versión de Minecraft).
     - `"required": false`: el jugador puede desactivarlo en Ajustes › Mods (`"enabledByDefault": false` para que venga desactivado).
   - Todo lo que pongas en `modpacks/<id>/files/` (configs, resource packs…) se copia tal cual a la carpeta del modpack del jugador.
2. Genera la entrada del modpack:

   ```
   node tools/build-modpack.js <id>
   node tools/build-modpack.js --all
   ```

   El script descarga cada archivo para calcular su tamaño y MD5 y reescribe la entrada del modpack en `distribution.json`. El resto de modpacks no se tocan.
3. Súbelo con `npm run publish:modpacks` (lo publica en el repo público `Javikeee/keee-modpacks`, servido por GitHub Pages).

Cuando subas un `distribution.json` nuevo, los launchers lo detectan solos (cada 5 minutos, al volver a la ventana o con *Buscar actualizaciones*) y ofrecen **Actualizar**. No hace falta sacar una versión nueva del launcher. Cualquier cambio en los archivos cuenta como actualización, pero sube también `version` en `modpack.json` para que el jugador vea a qué versión actualiza.

## Hosting

La URL base está en `app/assets/js/distroconfig.js` (`DISTRO_BASE_URL`). El launcher descarga `DISTRO_BASE_URL/distribution.json` y los archivos de `DISTRO_BASE_URL/files/...`. Sirve cualquier hosting de archivos estáticos (Cloudflare R2, GitHub Pages en un repo público, un VPS...). **Hay que configurar la URL antes de compilar el launcher** y volver a generar los modpacks con `build-modpack.js`, porque las URLs de `files/` llevan la URL base dentro.

## Desarrollo (`npm start`)

El launcher lee este archivo directamente (no el del hosting) y sirve la carpeta `distribution/` en `http://127.0.0.1:8586`, así que puedes probar un modpack antes de subirlo. Si editas `distribution.json` con el launcher abierto, pulsa *Buscar actualizaciones* para que lo detecte.

## Estado actual

Solo `keee-demo` tiene módulos. El resto tiene `"modules": []`: aparecen como **Próximamente** y no se pueden instalar.

Los iconos de `app/assets/images/modpacks/` van dentro del launcher. Para poder cambiarlos sin actualizar el launcher, súbelos a `files/` y pon su URL pública en `icon`.

## Reglas

- **No cambies el `id` de un modpack ya publicado**: el launcher guarda por `id` la configuración de cada jugador (RAM, mods opcionales, versión instalada).
- **Solo un modpack con `"mainServer": true`**: es el que se selecciona por defecto.
- **Forge y NeoForge todavía no los genera `build-modpack.js`**. NeoForge además no lo soporta helios-core; hay que añadirle soporte al launcher.
