// Local library of skins the player has used, stored in <launcher dir>/skins.
// Each skin is saved as <sha1>.png and indexed in library.json.

const crypto        = require('crypto')
const fs            = require('fs-extra')
const path          = require('path')

const ConfigManager = require('./configmanager')

function libraryDir(){
    return path.join(ConfigManager.getLauncherDirectory(), 'skins')
}

function indexPath(){
    return path.join(libraryDir(), 'library.json')
}

async function saveIndex(entries){
    await fs.ensureDir(libraryDir())
    await fs.writeJson(indexPath(), entries, { spaces: 4 })
}

/**
 * @returns {Promise<{id: string, name: string, variant: 'classic' | 'slim', addedAt: number}[]>}
 * The saved skins, newest first.
 */
exports.list = async function(){
    try {
        return await fs.readJson(indexPath())
    } catch {
        return []
    }
}

/**
 * Save a skin to the library. Saving the same image again only updates its
 * name and variant, and moves it to the front.
 *
 * @param {Buffer} png The skin image.
 * @param {string} name Display name.
 * @param {'classic' | 'slim'} variant Arm model.
 */
exports.add = async function(png, name, variant){
    const id = crypto.createHash('sha1').update(png).digest('hex')
    const entries = (await exports.list()).filter(e => e.id !== id)
    await fs.ensureDir(libraryDir())
    await fs.writeFile(exports.getPath(id), png)
    const entry = { id, name, variant, addedAt: Date.now() }
    entries.unshift(entry)
    await saveIndex(entries)
    return entry
}

/**
 * @param {string} id The skin id.
 */
exports.remove = async function(id){
    const entries = (await exports.list()).filter(e => e.id !== id)
    await saveIndex(entries)
    await fs.remove(exports.getPath(id))
}

/**
 * @param {string} id The skin id.
 * @returns {Promise<Buffer>} The skin image.
 */
exports.read = function(id){
    return fs.readFile(exports.getPath(id))
}

/**
 * @param {string} id The skin id.
 * @returns {string} Absolute path to the skin image.
 */
exports.getPath = function(id){
    return path.join(libraryDir(), `${id}.png`)
}
