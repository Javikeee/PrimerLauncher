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

const { DISTRO_REPO } = require('../app/assets/js/distroconfig')

const ROOT = path.join(__dirname, '..')
const DISTRO_DIR = path.join(ROOT, 'distribution')
// Local clone of the hosting repository (ignored by git).
const PUBLISH_DIR = path.join(ROOT, '.publish')
// What gets published from distribution/.
const PUBLISHED = ['distribution.json', 'files']

function git(...args){
    return execFileSync('git', args, { cwd: PUBLISH_DIR, encoding: 'utf-8' }).trim()
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

    git('add', '-A')
    if(git('status', '--porcelain') === ''){
        console.log('Nothing changed, the modpacks online are up to date.')
        return
    }
    git('commit', '-m', message)
    git('push')
    console.log(`Published. GitHub Pages takes a minute or two to update https://${DISTRO_REPO.split('/')[0].toLowerCase()}.github.io/${DISTRO_REPO.split('/')[1]}/distribution.json`)
}

main()
