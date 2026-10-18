/**
 * Turn a Modrinth App profile (or any .minecraft style instance folder)
 * into modpacks/<id>/, ready for tools/build-modpack.js.
 *
 * - Mods found on Modrinth (looked up by file hash) are pinned to that exact version.
 * - Other mods are copied to modpacks/<id>/mods/ and hosted with the modpack.
 * - config/ is copied to modpacks/<id>/files/config/.
 *
 * Usage:
 *   node tools/import-modrinth-profile.js <profile folder> <id> ["Modpack name"]
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MODRINTH_API = 'https://api.modrinth.com/v2'
const USER_AGENT = 'Javikeee/keee-launcher-modpack-builder'

// Per-install files that must not be shared between players.
const IGNORED_CONFIGS = [/fingerprint/i]

async function modrinth(endpoint, body){
    const res = await fetch(MODRINTH_API + endpoint, {
        method: body ? 'POST' : 'GET',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    })
    if(!res.ok){
        throw new Error(`Modrinth ${endpoint} -> ${res.status}`)
    }
    return res.json()
}

/** Minecraft and loader versions, from the last game log. */
function detectVersions(profileDir){
    const log = fs.readFileSync(path.join(profileDir, 'logs', 'latest.log'), 'utf-8')
    const fabric = log.match(/Loading Minecraft (\S+) with Fabric Loader (\S+)/)
    if(fabric){
        return { minecraftVersion: fabric[1], loader: { type: 'fabric', version: fabric[2] } }
    }
    const forge = log.match(/Forge mod loading, version (\S+), for MC (\S+)/)
    if(forge){
        return { minecraftVersion: forge[2], loader: { type: 'forge', version: forge[1] } }
    }
    throw new Error('Could not detect the Minecraft and loader versions from logs/latest.log. Launch the profile once and try again.')
}

function copyDir(src, dest, filter = () => true){
    for(const entry of fs.readdirSync(src, { withFileTypes: true })){
        const from = path.join(src, entry.name)
        const to = path.join(dest, entry.name)
        if(entry.isDirectory()){
            copyDir(from, to, filter)
        } else if(filter(entry.name)){
            fs.mkdirSync(dest, { recursive: true })
            fs.copyFileSync(from, to)
        }
    }
}

async function main(){
    const [profileDir, id, name] = process.argv.slice(2)
    if(profileDir == null || id == null){
        console.log('Usage: node tools/import-modrinth-profile.js <profile folder> <id> ["Modpack name"]')
        process.exit(1)
    }
    const packDir = path.join(ROOT, 'modpacks', id)
    const defPath = path.join(packDir, 'modpack.json')
    // Keep what was written by hand (name, description, icon...) when re-importing.
    const previous = fs.existsSync(defPath) ? JSON.parse(fs.readFileSync(defPath, 'utf-8')) : {}

    const versions = detectVersions(profileDir)
    console.log(`Minecraft ${versions.minecraftVersion}, ${versions.loader.type} ${versions.loader.version}`)

    const modsDir = path.join(profileDir, 'mods')
    const jars = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'))
    const hashes = Object.fromEntries(jars.map(jar => [
        crypto.createHash('sha1').update(fs.readFileSync(path.join(modsDir, jar))).digest('hex'),
        jar
    ]))
    const found = await modrinth('/version_files', { hashes: Object.keys(hashes), algorithm: 'sha1' })
    const projects = Object.values(found).length > 0
        ? await modrinth(`/projects?ids=${encodeURIComponent(JSON.stringify(Object.values(found).map(v => v.project_id)))}`)
        : []

    const mods = []
    fs.rmSync(path.join(packDir, 'mods'), { recursive: true, force: true })
    for(const [hash, jar] of Object.entries(hashes)){
        const version = found[hash]
        if(version != null){
            const project = projects.find(p => p.id === version.project_id)
            console.log(`  Modrinth: ${project.title} ${version.version_number}`)
            mods.push({ modrinth: project.slug, version: version.id })
        } else {
            console.log(`  Local:    ${jar}`)
            fs.mkdirSync(path.join(packDir, 'mods'), { recursive: true })
            fs.copyFileSync(path.join(modsDir, jar), path.join(packDir, 'mods', jar))
        }
    }

    fs.rmSync(path.join(packDir, 'files', 'config'), { recursive: true, force: true })
    if(fs.existsSync(path.join(profileDir, 'config'))){
        copyDir(path.join(profileDir, 'config'), path.join(packDir, 'files', 'config'), file => !IGNORED_CONFIGS.some(r => r.test(file)))
    }

    const def = {
        name: name || previous.name || path.basename(profileDir),
        description: previous.description || '',
        icon: previous.icon || '',
        version: previous.version || '1.0.0',
        address: previous.address || 'localhost:25565',
        ...versions,
        mods
    }
    fs.mkdirSync(packDir, { recursive: true })
    fs.writeFileSync(defPath, JSON.stringify(def, null, 4) + '\n')
    console.log(`\nWrote ${path.relative(ROOT, defPath)}. Review it, then run: npm run build:modpack ${id}`)
}

main().catch(err => {
    console.error(err.message)
    process.exit(1)
})
