/**
 * Upload distribution/ to the public GitHub repository that hosts the
 * modpacks (served by GitHub Pages at DISTRO_BASE_URL).
 *
 * Usage:
 *   node tools/publish-modpacks.js ["commit message"]
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const { DISTRO_REPO, LARGE_FILES_TAG, LARGE_FILES_URL } = require('../app/assets/js/distroconfig')

const ROOT = path.join(__dirname, '..')
const DISTRO_DIR = path.join(ROOT, 'distribution')
const LARGE_DIR = path.join(DISTRO_DIR, 'large')
// Local clone of the hosting repository (ignored by git).
const PUBLISH_DIR = path.join(ROOT, '.publish')
// What gets published from distribution/.
const PUBLISHED = ['distribution.json', 'files']

function git(...args){
    return execFileSync('git', args, { cwd: PUBLISH_DIR, encoding: 'utf-8' }).trim()
}

function gh(...args){
    return execFileSync('gh', [...args, '-R', DISTRO_REPO], { encoding: 'utf-8' }).trim()
}

/** Names of the large files (release assets) the published modpacks use. */
function largeFilesUsed(distro){
    const raw = JSON.stringify(distro)
    return new Set([...raw.matchAll(new RegExp(`${LARGE_FILES_URL.replace(/[.]/g, '\\.')}/([^"]+)`, 'g'))].map(m => m[1]))
}

/**
 * Upload the large files that are not in the release yet. Done before
 * pushing distribution.json, so launchers never see a file that is not
 * online.
 *
 * @returns {Array<string>} Assets no published modpack uses anymore.
 */
function uploadLargeFiles(used){
    let existing = []
    try {
        existing = gh('release', 'view', LARGE_FILES_TAG, '--json', 'assets', '-q', '.assets[].name').split('\n').filter(Boolean)
    } catch {
        if(used.size === 0){
            return []
        }
        gh('release', 'create', LARGE_FILES_TAG, '--title', 'Archivos grandes de los modpacks', '--notes', 'Archivos de más de 100 MB que usan los modpacks. Los gestiona tools/publish-modpacks.js.')
    }
    for(const name of used){
        if(!existing.includes(name)){
            console.log(`Uploading ${name}...`)
            execFileSync('gh', ['release', 'upload', LARGE_FILES_TAG, path.join(LARGE_DIR, name), '-R', DISTRO_REPO], { stdio: 'inherit' })
        }
    }
    return existing.filter(name => !used.has(name))
}

function main(){
    const message = process.argv[2] || 'Update modpacks'

    if(!fs.existsSync(path.join(PUBLISH_DIR, '.git'))){
        execFileSync('git', ['clone', `https://github.com/${DISTRO_REPO}.git`, PUBLISH_DIR], { stdio: 'inherit' })
    }
    git('pull', '--ff-only')

    // Mirror distribution/ so deleted files are deleted online too, leaving
    // out draft modpacks ("draft": true in modpack.json).
    const distro = JSON.parse(fs.readFileSync(path.join(DISTRO_DIR, 'distribution.json'), 'utf-8'))
    const drafts = distro.servers.filter(s => s.draft).map(s => s.id)
    distro.servers = distro.servers.filter(s => !s.draft)
    for(const entry of PUBLISHED){
        fs.rmSync(path.join(PUBLISH_DIR, entry), { recursive: true, force: true })
    }
    fs.writeFileSync(path.join(PUBLISH_DIR, 'distribution.json'), JSON.stringify(distro, null, 4) + '\n')
    fs.cpSync(path.join(DISTRO_DIR, 'files'), path.join(PUBLISH_DIR, 'files'), {
        recursive: true,
        filter: src => !drafts.some(id => src === path.join(DISTRO_DIR, 'files', id))
    })
    if(drafts.length > 0){
        console.log(`Drafts not published: ${drafts.join(', ')}`)
    }
    // Serve files as they are, without GitHub Pages' Jekyll processing.
    fs.writeFileSync(path.join(PUBLISH_DIR, '.nojekyll'), '')
    // Never convert line endings: the launcher checks every file's MD5.
    fs.writeFileSync(path.join(PUBLISH_DIR, '.gitattributes'), '* -text\n')
    git('config', 'core.autocrlf', 'false')

    const unused = uploadLargeFiles(largeFilesUsed(distro))

    git('add', '-A')
    if(git('status', '--porcelain') === ''){
        console.log('Nothing changed, the modpacks online are up to date.')
        return
    }
    git('commit', '-m', message)
    git('push')

    // Old versions of large files, only once the new distribution.json is online.
    for(const name of unused){
        console.log(`Deleting old large file ${name}`)
        gh('release', 'delete-asset', LARGE_FILES_TAG, name, '-y')
    }
    console.log(`Published. GitHub Pages takes a minute or two to update https://${DISTRO_REPO.split('/')[0].toLowerCase()}.github.io/${DISTRO_REPO.split('/')[1]}/distribution.json`)
}

main()
