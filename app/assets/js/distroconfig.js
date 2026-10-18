// Where the distribution is hosted. Shared by the launcher and the modpack
// tools (tools/build-modpack.js, tools/publish-modpacks.js), so it must not
// require anything.

// Public GitHub repository that hosts distribution/, served by GitHub Pages.
exports.DISTRO_REPO = 'Javikeee/keee-modpacks'
exports.DISTRO_BASE_URL = 'https://javikeee.github.io/keee-modpacks'

// While developing (npm start) the launcher serves distribution/ on this port
// and rewrites DISTRO_BASE_URL to it, so modpacks can be tested before upload.
exports.DEV_DISTRO_PORT = 8586
