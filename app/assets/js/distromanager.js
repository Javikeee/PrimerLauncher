const { DistributionAPI } = require('helios-core/common')
const fs = require('fs-extra')
const path = require('path')

const ConfigManager = require('./configmanager')

// TODO Replace with the public URL of distribution/distribution.json once it is hosted.
exports.REMOTE_DISTRO_URL = 'https://CAMBIAR-POR-TU-HOSTING/distribution.json'

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
 * Point the DistributionAPI at the repo's distribution file. helios-core reads
 * dev mode distributions from distribution_dev.json in the launcher directory,
 * so the file is copied there.
 *
 * @returns {boolean} Whether the local distribution is now in use.
 */
exports.useLocalDistribution = function(){
    if(!fs.existsSync(exports.LOCAL_DISTRO_PATH)){
        return false
    }
    fs.copySync(exports.LOCAL_DISTRO_PATH, path.join(ConfigManager.getLauncherDirectory(), 'distribution_dev.json'))
    api.toggleDevMode(true)
    return true
}

exports.DistroAPI = api
