/**
 * Modpack builder.
 *
 * Reads modpacks/<id>/modpack.json and writes the matching server entry into
 * distribution/distribution.json, resolving the mod loader and the mods to
 * downloadable artifacts (URL, size, MD5). Files that are not on a public
 * CDN (the loader's version.json, Forge's patched client, local mod jars and
 * the pack's overrides) are copied to distribution/files/ and must be
 * uploaded together with distribution.json.
 *
 * Forge 1.13+ is installed with the official installer to generate the
 * patched client, so building those modpacks needs Java on the PATH.
 *
 * Usage:
 *   node tools/build-modpack.js <id> [<id>...]
 *   node tools/build-modpack.js --all
 */
const AdmZip = require('adm-zip')
const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { DISTRO_BASE_URL } = require('../app/assets/js/distroconfig')

const ROOT = path.join(__dirname, '..')
const MODPACKS_DIR = path.join(ROOT, 'modpacks')
const DISTRO_DIR = path.join(ROOT, 'distribution')
const DISTRO_FILE = path.join(DISTRO_DIR, 'distribution.json')

const MODRINTH_API = 'https://api.modrinth.com/v2'
const FABRIC_META = 'https://meta.fabricmc.net/v2'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/'
const FORGE_PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const MOJANG_LIBRARIES = 'https://libraries.minecraft.net/'
const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2/'
const USER_AGENT = 'Javikeee/keee-launcher-modpack-builder'

/* * *
* Helpers
* * */

async function get(url, type = 'json'){
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if(!res.ok){
        throw new Error(`GET ${url} -> ${res.status}`)
    }
    return type === 'json' ? res.json() : Buffer.from(await res.arrayBuffer())
}

function md5(buf){
    return crypto.createHash('md5').update(buf).digest('hex')
}

/** Artifact for a file hosted elsewhere, downloading it to hash it. */
async function remoteArtifact(url){
    const buf = await get(url, 'buffer')
    return { size: buf.length, MD5: md5(buf), url }
}

/** Copy a file into distribution/files/ and return its hosted artifact. */
function hostedArtifact(buf, relPath, artifactPath){
    const dest = path.join(DISTRO_DIR, 'files', relPath)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf)
    const artifact = {
        size: buf.length,
        MD5: md5(buf),
        url: `${DISTRO_BASE_URL}/files/${relPath.split(path.sep).join('/')}`
    }
    if(artifactPath != null){
        artifact.path = artifactPath
    }
    return artifact
}

/** Maven path for an identifier like group:artifact:version[:classifier][@ext]. */
function mavenPath(id){
    const [coords, ext = 'jar'] = id.split('@')
    const [group, artifact, version, classifier] = coords.split(':')
    return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`
}

/** Artifact from the first repository that has the file. */
async function artifactFromRepos(repos, relPath){
    for(const repo of repos){
        try {
            return await remoteArtifact(repo + relPath)
        } catch {
            // Try the next repository.
        }
    }
    throw new Error(`${relPath} not found in ${repos.join(', ')}`)
}

/** Whether version a is at least version b (dotted numbers). */
function versionAtLeast(a, b){
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for(let i = 0; i < pb.length; i++){
        if((pa[i] || 0) !== pb[i]){
            return (pa[i] || 0) > pb[i]
        }
    }
    return true
}

/* * *
* Loaders
* * */

async function resolveFabric(mcVersion, loaderVersion){
    if(loaderVersion == null || loaderVersion === 'latest'){
        const loaders = await get(`${FABRIC_META}/versions/loader/${mcVersion}`)
        loaderVersion = loaders.find(l => l.loader.stable).loader.version
    }
    const profile = await get(`${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`)
    // Fabric Meta stamps the request time on the profile. Pin it so the
    // hosted file (and its MD5) only change when the loader does.
    profile.releaseTime = profile.time = '2000-01-01T00:00:00+0000'

    const loaderId = `net.fabricmc:fabric-loader:${loaderVersion}`
    let loaderArtifact
    const libraries = []
    for(const lib of profile.libraries){
        const url = lib.url + mavenPath(lib.name)
        const artifact = lib.md5 != null && lib.size != null
            ? { size: lib.size, MD5: lib.md5, url }
            : await remoteArtifact(url)
        if(lib.name === loaderId){
            loaderArtifact = artifact
        } else {
            libraries.push({ id: lib.name, name: `Fabric (${lib.name})`, type: 'Library', artifact })
        }
    }

    const manifestBuf = Buffer.from(JSON.stringify(profile, null, 2))
    return {
        id: loaderId,
        name: `Fabric (fabric-loader ${loaderVersion})`,
        type: 'Fabric',
        artifact: loaderArtifact,
        subModules: [
            {
                id: profile.id,
                name: 'Fabric (version.json)',
                type: 'VersionManifest',
                artifact: hostedArtifact(manifestBuf, path.join('loaders', 'fabric', `${profile.id}.json`))
            },
            ...libraries
        ]
    }
}

/**
 * @returns {Promise<string>} The Forge maven version, e.g. 1.21.1-52.1.0 or 1.7.10-10.13.4.1614-1.7.10.
 */
async function resolveForgeVersion(mcVersion, loaderVersion){
    if(loaderVersion == null || loaderVersion === 'latest' || loaderVersion === 'recommended'){
        const promos = (await get(FORGE_PROMOTIONS)).promos
        loaderVersion = promos[`${mcVersion}-${loaderVersion || 'recommended'}`] || promos[`${mcVersion}-latest`]
        if(loaderVersion == null){
            throw new Error(`No Forge build for Minecraft ${mcVersion}`)
        }
    }
    // Some old versions carry the Minecraft version as a suffix too.
    const metadata = (await get(`${FORGE_MAVEN}net/minecraftforge/forge/maven-metadata.xml`, 'buffer')).toString()
    const versions = [...metadata.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1])
    const version = versions.find(v => v === `${mcVersion}-${loaderVersion}` || v === `${mcVersion}-${loaderVersion}-${mcVersion}`)
    if(version == null){
        throw new Error(`Forge ${loaderVersion} for Minecraft ${mcVersion} does not exist`)
    }
    return version
}

/** Library modules for the libraries of a launcher style version.json. */
async function forgeLibraries(libraries, skip, installDir){
    const modules = []
    const seen = new Set(skip)
    for(const lib of libraries){
        if(seen.has(lib.name)){
            continue
        }
        seen.add(lib.name)
        const relPath = lib.downloads?.artifact?.path ?? mavenPath(lib.name)
        let artifact
        if(lib.downloads?.artifact?.url){
            artifact = await remoteArtifact(lib.downloads.artifact.url)
        } else if(lib.downloads?.artifact != null){
            // Generated by the installer (the patched client), so we host it.
            const buf = fs.readFileSync(path.join(installDir, 'libraries', relPath))
            artifact = hostedArtifact(buf, path.join('loaders', 'forge', 'libraries', relPath))
        } else {
            // Legacy format: only a repository URL, often the retired files.minecraftforge.net.
            const repos = [lib.url ? FORGE_MAVEN : MOJANG_LIBRARIES, FORGE_MAVEN, MOJANG_LIBRARIES, MAVEN_CENTRAL]
            artifact = await artifactFromRepos([...new Set(repos)], relPath)
        }
        modules.push({ id: lib.name, name: `Forge (${lib.name})`, type: 'Library', artifact })
    }
    return modules
}

/** Run the official Forge installer in a temporary folder. */
function runForgeInstaller(installerBuf){
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keee-forge-'))
    fs.writeFileSync(path.join(dir, 'installer.jar'), installerBuf)
    // The installer refuses to run without a launcher profile file.
    fs.writeFileSync(path.join(dir, 'launcher_profiles.json'), '{"profiles":{}}')
    // Use the Windows certificate store; Java's own can miss CAs.
    const tls = process.platform === 'win32' ? ['-Djavax.net.ssl.trustStoreType=Windows-ROOT'] : []
    try {
        execFileSync('java', [...tls, '-jar', 'installer.jar', '--installClient', '.'], { cwd: dir, stdio: 'ignore' })
    } catch (err) {
        fs.rmSync(dir, { recursive: true, force: true })
        throw new Error(`The Forge installer failed (is Java installed and on the PATH?): ${err.message}`)
    }
    return dir
}

async function resolveForge(mcVersion, loaderVersion){
    const version = await resolveForgeVersion(mcVersion, loaderVersion)
    const base = `${FORGE_MAVEN}net/minecraftforge/forge/${version}/forge-${version}`
    const universalId = `net.minecraftforge:forge:${version}:universal`
    const module = {
        id: universalId,
        name: `Forge ${version}`,
        type: 'ForgeHosted',
        artifact: await remoteArtifact(`${base}-universal.jar`),
        subModules: []
    }

    if(!versionAtLeast(mcVersion, '1.13')){
        // Old Forge ships its version.json inside the universal jar, where
        // the launcher reads it.
        const versionJson = JSON.parse(new AdmZip(await get(`${base}-universal.jar`, 'buffer')).readAsText('version.json'))
        const forgeLib = versionJson.libraries.find(l => l.name.startsWith('net.minecraftforge:forge:'))
        module.subModules = await forgeLibraries(versionJson.libraries, [forgeLib.name])
        return module
    }

    const installDir = runForgeInstaller(await get(`${base}-installer.jar`, 'buffer'))
    try {
        const versionId = fs.readdirSync(path.join(installDir, 'versions')).find(v => v !== mcVersion)
        const versionJson = JSON.parse(fs.readFileSync(path.join(installDir, 'versions', versionId, `${versionId}.json`), 'utf-8'))
        const libraries = await forgeLibraries(versionJson.libraries, [universalId], installDir)

        // Forge 1.17 - 1.20 also reads deobfuscated client jars generated by
        // the installer, which are not listed as libraries.
        const clientDir = path.join(installDir, 'libraries', 'net', 'minecraft', 'client')
        for(const dir of fs.readdirSync(clientDir).filter(d => d.startsWith(`${mcVersion}-`))){
            for(const file of fs.readdirSync(path.join(clientDir, dir))){
                const relPath = path.join('net', 'minecraft', 'client', dir, file)
                const classifier = path.basename(file, path.extname(file)).slice(`client-${dir}-`.length)
                libraries.push({
                    id: `net.minecraft:client:${dir}:${classifier}@${path.extname(file).slice(1)}`,
                    name: `Minecraft (${file})`,
                    type: 'Library',
                    classpath: false,
                    artifact: hostedArtifact(fs.readFileSync(path.join(installDir, 'libraries', relPath)), path.join('loaders', 'forge', 'libraries', relPath))
                })
            }
        }

        module.subModules = [
            {
                id: versionId,
                name: 'Forge (version.json)',
                type: 'VersionManifest',
                artifact: hostedArtifact(Buffer.from(JSON.stringify(versionJson, null, 2)), path.join('loaders', 'forge', `${versionId}.json`))
            },
            ...libraries
        ]
        return module
    } finally {
        fs.rmSync(installDir, { recursive: true, force: true })
    }
}

const LOADERS = {
    fabric: { resolve: resolveFabric, modType: 'FabricMod', modrinthLoader: 'fabric' },
    forge: { resolve: resolveForge, modType: 'ForgeMod', modrinthLoader: 'forge' }
}

/* * *
* Mods
* * */

function sanitizeVersion(v){
    return v.replace(/[^A-Za-z0-9._+-]/g, '_')
}

async function resolveModrinthMod(mod, mcVersion, loader){
    const query = `loaders=${encodeURIComponent(JSON.stringify([loader.modrinthLoader]))}`
        + `&game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`
    const versions = await get(`${MODRINTH_API}/project/${mod.modrinth}/version?${query}`)
    let version = mod.version != null
        ? versions.find(v => v.version_number === mod.version || v.id === mod.version)
        : versions.find(v => v.version_type === 'release') || versions[0]
    // A version pinned by id may not be tagged for this exact loader or game version.
    if(version == null && mod.version != null && /^[A-Za-z0-9]{8}$/.test(mod.version)){
        version = await get(`${MODRINTH_API}/version/${mod.version}`).catch(() => null)
    }
    if(version == null){
        throw new Error(`No Modrinth version of "${mod.modrinth}" for ${loader.modrinthLoader} ${mcVersion}${mod.version ? ` (${mod.version})` : ''}`)
    }
    const project = await get(`${MODRINTH_API}/project/${mod.modrinth}`)
    const file = version.files.find(f => f.primary) || version.files[0]
    const module = {
        id: `com.modrinth.${mod.modrinth}:${mod.modrinth}:${sanitizeVersion(version.version_number)}`,
        name: project.title,
        type: loader.modType,
        artifact: await remoteArtifact(file.url)
    }
    if(mod.required === false){
        module.required = { value: false, def: mod.enabledByDefault ?? true }
    }
    console.log(`  ${project.title} ${version.version_number}`)
    return module
}

/**
 * Mods that are not on Modrinth: jars dropped in modpacks/<id>/mods/.
 */
function resolveLocalMods(packId, loader){
    const dir = path.join(MODPACKS_DIR, packId, 'mods')
    return listFiles(dir).filter(f => f.endsWith('.jar')).map(file => {
        const buf = fs.readFileSync(file)
        const name = path.basename(file, '.jar')
        const artifactId = name.toLowerCase().replace(/[^a-z0-9._-]/g, '-')
        // The version is the file hash, so a replaced jar gets a new path.
        const version = md5(buf).slice(0, 12)
        console.log(`  ${name} (local)`)
        return {
            id: `local.${packId}:${artifactId}:${version}`,
            name,
            type: loader.modType,
            artifact: hostedArtifact(buf, path.join(packId, 'mods', `${artifactId}-${version}.jar`))
        }
    })
}

/* * *
* Overrides (configs, resource packs...)
* * */

function listFiles(dir){
    if(!fs.existsSync(dir)){
        return []
    }
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name)
        return entry.isDirectory() ? listFiles(full) : [full]
    })
}

function resolveOverrides(packId){
    const dir = path.join(MODPACKS_DIR, packId, 'files')
    return listFiles(dir).map(file => {
        const rel = path.relative(dir, file)
        const relPosix = rel.split(path.sep).join('/')
        console.log(`  file ${relPosix}`)
        return {
            id: relPosix,
            name: relPosix,
            type: 'File',
            artifact: hostedArtifact(fs.readFileSync(file), path.join(packId, 'overrides', rel), relPosix)
        }
    })
}

/* * *
* Build
* * */

/**
 * The launcher accepts any Java newer than the minimum by default, but mod
 * loaders tend to break on Java versions newer than the one Minecraft ships.
 */
function defaultJavaOptions(mcVersion){
    if(versionAtLeast(mcVersion, '1.20.5')){
        return { supported: '21.x', suggestedMajor: 21 }
    }
    if(versionAtLeast(mcVersion, '1.17')){
        return { supported: '17.x', suggestedMajor: 17 }
    }
    // Older versions already default to Java 8 only.
    return null
}

async function buildModpack(packId){
    const def = JSON.parse(fs.readFileSync(path.join(MODPACKS_DIR, packId, 'modpack.json'), 'utf-8'))
    const loader = LOADERS[def.loader.type]
    if(loader == null){
        throw new Error(`Unsupported loader "${def.loader.type}" (supported: ${Object.keys(LOADERS).join(', ')})`)
    }
    console.log(`Building ${def.name} (${def.loader.type} ${def.loader.version || 'latest'}, Minecraft ${def.minecraftVersion})`)

    // Start clean so removed overrides do not linger in the upload folder.
    fs.rmSync(path.join(DISTRO_DIR, 'files', packId), { recursive: true, force: true })

    const modules = [await loader.resolve(def.minecraftVersion, def.loader.version)]
    for(const mod of def.mods || []){
        modules.push(await resolveModrinthMod(mod, def.minecraftVersion, loader))
    }
    modules.push(...resolveLocalMods(packId, loader))
    modules.push(...resolveOverrides(packId))

    // A modpacks/<id>/icon.* file is hosted, so it can change without a launcher update.
    const iconFile = fs.readdirSync(path.join(MODPACKS_DIR, packId)).find(f => /^icon\.(png|jpe?g|svg|webp|avif)$/i.test(f))
    const icon = iconFile != null
        ? hostedArtifact(fs.readFileSync(path.join(MODPACKS_DIR, packId, iconFile)), path.join(packId, iconFile)).url
        : def.icon

    const server = {
        id: packId,
        name: def.name,
        description: def.description,
        icon,
        version: def.version,
        address: def.address,
        minecraftVersion: def.minecraftVersion,
        mainServer: def.mainServer ?? false,
        autoconnect: def.autoconnect ?? false,
        modules
    }
    // Drafts work in npm start but are left out by tools/publish-modpacks.js.
    if(def.draft === true){
        server.draft = true
    }
    const javaOptions = def.javaOptions ?? defaultJavaOptions(def.minecraftVersion)
    if(javaOptions != null){
        server.javaOptions = javaOptions
    }
    return server
}

async function main(){
    const args = process.argv.slice(2)
    const ids = args.includes('--all')
        ? fs.readdirSync(MODPACKS_DIR).filter(d => fs.existsSync(path.join(MODPACKS_DIR, d, 'modpack.json')))
        : args
    if(ids.length === 0){
        console.log('Usage: node tools/build-modpack.js <id> [<id>...] | --all')
        process.exit(1)
    }

    const distro = JSON.parse(fs.readFileSync(DISTRO_FILE, 'utf-8'))
    for(const id of ids){
        const server = await buildModpack(id)
        const index = distro.servers.findIndex(s => s.id === id)
        if(index === -1){
            distro.servers.push(server)
        } else {
            distro.servers[index] = server
        }
    }
    fs.writeFileSync(DISTRO_FILE, JSON.stringify(distro, null, 4) + '\n')
    console.log(`\nUpdated ${path.relative(ROOT, DISTRO_FILE)}. Upload the distribution/ folder to ${DISTRO_BASE_URL}`)
}

main().catch(err => {
    console.error(err.message)
    process.exit(1)
})
