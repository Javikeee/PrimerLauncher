// Where the distribution is hosted. Shared by the launcher and the modpack
// tools (tools/build-modpack.js, tools/publish-modpacks.js), so it must not
// require anything.

// Public GitHub repository that hosts distribution/, served by GitHub Pages.
exports.DISTRO_REPO = 'Javikeee/keee-modpacks'
exports.DISTRO_BASE_URL = 'https://javikeee.github.io/keee-modpacks'

// GitHub rejects files over 100 MB in a repository, so bigger files are
// uploaded as assets of this release of DISTRO_REPO instead.
exports.LARGE_FILES_TAG = 'files'
exports.LARGE_FILES_URL = `https://github.com/${exports.DISTRO_REPO}/releases/download/${exports.LARGE_FILES_TAG}`

// Folder inside each instance with the modpack's default files (player
// settings). They are copied into the instance only if the player does not
// have that file yet, so the player's changes are kept.
exports.DEFAULT_FILES_DIR = '.keee-defaults'

// While developing (npm start) the launcher serves distribution/ on this port
// and rewrites DISTRO_BASE_URL to it, so modpacks can be tested before upload.
exports.DEV_DISTRO_PORT = 8586
