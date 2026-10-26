const { DistributionAPI } = require('helios-core/common')
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')

const ConfigManager = require('./configmanager')
const { DISTRO_BASE_URL, DEV_DISTRO_PORT, LARGE_FILES_URL } = require('./distroconfig')

exports.REMOTE_DISTRO_URL = `${DISTRO_BASE_URL}/distribution.json`

// Distribution file kept in the repo. While developing (npm start) the launcher
// reads this file directly instead of downloading the remote one.
exports.LOCAL_DISTRO_PATH = path.join(__dirname, '..', '..', '..', 'distribution', 'distribution.json')

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

/**
 * Copy the repo's distribution file to where helios-core reads dev mode
 * distributions (distribution_dev.json in the launcher directory). Hosted
 * file URLs are pointed at the local server started in index.js, large files
 * (distribution/large/) included.
 */
function copyLocalDistribution(){
    const raw = fs.readFileSync(exports.LOCAL_DISTRO_PATH, 'utf-8')
    const local = `http://127.0.0.1:${DEV_DISTRO_PORT}`
    fs.writeFileSync(
        path.join(ConfigManager.getLauncherDirectory(), 'distribution_dev.json'),
        raw.split(LARGE_FILES_URL).join(`${local}/large`).split(DISTRO_BASE_URL).join(local)
    )
}

/**
 * Point the DistributionAPI at the repo's distribution file.
 *
 * @returns {boolean} Whether the local distribution is now in use.
 */
exports.useLocalDistribution = function(){
    if(!fs.existsSync(exports.LOCAL_DISTRO_PATH)){
        return false
    }
    copyLocalDistribution()
    api.toggleDevMode(true)
    return true
}

/**
 * Download the distribution again (or re-read the repo file in dev mode), so
 * modpack changes show up without restarting or updating the launcher.
 *
 * @returns {Promise<HeliosDistribution>} The new distribution, or the current one if it could not be loaded.
 */
exports.refreshDistribution = function(){
    if(api.isDevMode()){
        copyLocalDistribution()
    }
    return api.refreshDistributionOrFallback()
}

/**
 * Fingerprint of everything that gets installed for a modpack. Any change in
 * the distribution (a mod added, removed or replaced, a new loader, a changed
 * config file) changes it, even if the modpack's version number was not bumped.
 *
 * @param {HeliosServer} server The modpack.
 * @returns {string} The fingerprint.
 */
exports.getModpackFingerprint = function(server){
    const describe = modules => modules.map(m => [
        m.id,
        m.type,
        m.artifact.MD5,
        m.subModules ? describe(m.subModules) : null
    ])
    return crypto.createHash('sha1')
        .update(JSON.stringify([server.rawServer.minecraftVersion, describe(server.rawServer.modules)]))
        .digest('hex')
}

/**
 * @param {HeliosServer} server The modpack.
 * @returns {'unavailable' | 'notInstalled' | 'updateAvailable' | 'installed'} The modpack's install state.
 */
exports.getModpackState = function(server){
    if(server == null || server.modules.length === 0){
        return 'unavailable'
    }
    const installed = ConfigManager.getInstalledModpack(server.rawServer.id)
    if(installed == null){
        return 'notInstalled'
    }
    return installed.fingerprint === exports.getModpackFingerprint(server) ? 'installed' : 'updateAvailable'
}

/**
 * Remember that a modpack's files were downloaded and validated.
 *
 * @param {HeliosServer} server The modpack.
 */
exports.markModpackInstalled = function(server){
    ConfigManager.setInstalledModpack(server.rawServer.id, {
        version: server.rawServer.version,
        fingerprint: exports.getModpackFingerprint(server),
        date: new Date().toISOString()
    })
    ConfigManager.save()
}

/**
 * Delete a modpack: its instance folder (worlds and configs included) and
 * the shared files no other installed modpack uses. Minecraft itself is kept.
 *
 * @param {HeliosServer} server The modpack.
 * @param {HeliosDistribution} distro The distribution.
 */
exports.uninstallModpack = async function(server, distro){
    const modulePaths = modules => modules.flatMap(m => [m.getPath(), ...modulePaths(m.subModules)])
    const inUse = new Set(distro.servers
        .filter(s => s.rawServer.id !== server.rawServer.id && ConfigManager.getInstalledModpack(s.rawServer.id) != null)
        .flatMap(s => modulePaths(s.modules)))
    for(const file of modulePaths(server.modules)){
        if(!inUse.has(file)){
            await fs.remove(file)
        }
    }
    await fs.remove(path.join(ConfigManager.getInstanceDirectory(), server.rawServer.id))
    ConfigManager.setInstalledModpack(server.rawServer.id, null)
    ConfigManager.save()
}

exports.DistroAPI = api
