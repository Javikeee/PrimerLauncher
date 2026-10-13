# Distribución de modpacks

`distribution.json` es la lista de modpacks que muestra Keee Launcher. Cada entrada de `servers` es un modpack.

## Cómo se usa

- **Desarrollo (`npm start`)**: el launcher lee este archivo directamente. Edítalo, reinicia el launcher y verás los cambios.
- **Launcher compilado**: descarga el archivo desde `REMOTE_DISTRO_URL` (`app/assets/js/distromanager.js`). Cuando tengas hosting, sube allí este archivo junto con los mods y cambia esa URL.

## Estado actual

Todos los modpacks tienen `"modules": []`, así que aparecen como **Próximamente** y el botón JUGAR está desactivado. Un modpack es jugable cuando tiene al menos el módulo del loader (Forge o Fabric) y sus mods. Lo más cómodo es generar esos módulos con [Nebula](https://github.com/dscalzi/Nebula).

Los iconos de `app/assets/images/modpacks/` son provisionales. Cuando el archivo esté alojado, `icon` debe ser una URL pública.

## Reglas

- **No cambies el `id` de un modpack ya publicado**: el launcher guarda por `id` la configuración de cada jugador (RAM, mods opcionales).
- **Solo un modpack con `"mainServer": true`**: es el que se selecciona por defecto.
- **NeoForge todavía no está soportado** por helios-core. Para usarlo hay que añadir soporte al launcher.
