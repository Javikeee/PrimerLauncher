/**
 * Skin manager (Settings > Skin).
 *
 * Shows the account's current skin in 3D, lets the player preview and apply
 * a new PNG, switch arm model, pick a cape, and reuse previously applied
 * skins from a local library. All Minecraft API calls go through the main
 * process (see skinapi.js).
 */
// Requirements
const skinview3d      = require('skinview3d')
const SkinLibrary     = require('./assets/js/skinlibrary')
const { SKIN_OPCODE } = require('./assets/js/ipcconstants')

const skinState = {
    viewer: null,
    /** Active skin on the account: { dataUrl, variant } */
    current: null,
    /** Unapplied skin being previewed: { png: Buffer, dataUrl, name, variant } */
    pending: null,
    /** Arm model selected in the UI. */
    variant: 'classic',
    capes: [],
    busy: false
}

/* * *
* API helpers
* * */

class SkinUiError extends Error {
    constructor(code){
        super(code)
        this.code = code
    }
}

async function skinApi(action, ...args){
    const res = await ipcRenderer.invoke(SKIN_OPCODE, action, ...args)
    if(!res.ok){
        throw new SkinUiError(res.code)
    }
    return res.data
}

/**
 * @returns {Promise<string>} A valid Minecraft access token for the selected account.
 */
async function getSkinAccessToken(){
    const account = ConfigManager.getSelectedAccount()
    if(account == null || account.type !== 'microsoft'){
        throw new SkinUiError('noMicrosoft')
    }
    // Refreshes the token if it has expired.
    if(!await AuthManager.validateSelected()){
        throw new SkinUiError('unauthorized')
    }
    return ConfigManager.getSelectedAccount().accessToken
}

function skinErrorMessage(err){
    if(err instanceof SkinUiError){
        if(err.code === 'noMicrosoft'){
            return Lang.queryJS('settings.skins.noMicrosoft')
        }
        return Lang.queryJS(`settings.skins.errors.${err.code}`) || Lang.queryJS('settings.skins.errors.unknown')
    }
    console.error('Skin manager error', err)
    return Lang.queryJS('settings.skins.errors.unknown')
}

function setSkinStatus(text, type = 'info'){
    const status = document.getElementById('skinStatus')
    status.textContent = text
    status.setAttribute('type', type)
    if(type !== 'error'){
        document.getElementById('skinLoginButton').hidden = true
    }
}

/**
 * Run an action with the controls locked, reporting errors in the status line.
 */
async function runSkinAction(fn){
    if(skinState.busy){
        return
    }
    skinState.busy = true
    document.getElementById('skinEditor').toggleAttribute('busy', true)
    try {
        await fn()
    } catch (err) {
        setSkinStatus(skinErrorMessage(err), 'error')
        // An expired session can only be fixed by logging in again.
        document.getElementById('skinLoginButton').hidden = !(err instanceof SkinUiError && err.code === 'unauthorized')
    } finally {
        skinState.busy = false
        document.getElementById('skinEditor').toggleAttribute('busy', false)
        refreshSkinControls()
    }
}

/* * *
* Images
* * */

function loadImage(src){
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })
}

function pngToDataUrl(png){
    return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

function dataUrlToPng(dataUrl){
    return Buffer.from(dataUrl.split(',')[1], 'base64')
}

/**
 * Draw a skin's face (with the hat layer) onto a new canvas.
 */
async function renderSkinHead(src, size = 48){
    const img = await loadImage(src)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size)
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size)
    return canvas
}

/**
 * Draw the front of a cape onto a new canvas.
 */
async function renderCapeFront(src, height = 48){
    const img = await loadImage(src)
    // Capes are 64x32 (or a multiple); the front face is 10x16 at (1,1).
    const scale = img.width / 64
    const canvas = document.createElement('canvas')
    canvas.height = height
    canvas.width = Math.round(height * 10 / 16)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 1 * scale, 1 * scale, 10 * scale, 16 * scale, 0, 0, canvas.width, canvas.height)
    return canvas
}

/* * *
* Viewer
* * */

function ensureSkinViewer(){
    if(skinState.viewer != null){
        return
    }
    const viewer = new skinview3d.SkinViewer({
        canvas: document.getElementById('skinViewerCanvas'),
        width: 240,
        height: 320
    })
    viewer.animation = new skinview3d.WalkingAnimation()
    viewer.animation.speed = 0.6
    viewer.autoRotate = true
    viewer.autoRotateSpeed = 0.6
    viewer.zoom = 0.7
    skinState.viewer = viewer

    // Only render while the canvas is on screen; settings can be left in many ways.
    new IntersectionObserver(([entry]) => {
        viewer.renderPaused = !entry.isIntersecting
    }).observe(viewer.canvas)
}

function skinviewModel(variant){
    return variant === 'slim' ? 'slim' : 'default'
}

/** Show the pending skin if there is one, otherwise the account's skin. */
function showSkinInViewer(){
    const shown = skinState.pending || skinState.current
    if(shown == null){
        return
    }
    skinState.viewer.loadSkin(shown.dataUrl, { model: skinviewModel(skinState.variant) })
}

/* * *
* Rendering of controls
* * */

function refreshSkinControls(){
    const pending = skinState.pending != null
    const variantChanged = skinState.current != null && skinState.variant !== skinState.current.variant
    document.getElementById('skinApplyButton').disabled = skinState.busy || !(pending || variantChanged)
    document.getElementById('skinDiscardButton').hidden = !pending
    document.getElementById('skinPreviewBadge').hidden = !(pending || variantChanged)
    for(const btn of document.getElementsByClassName('skinVariantButton')){
        btn.toggleAttribute('selected', btn.getAttribute('variant') === skinState.variant)
    }
}

async function renderCapeList(){
    const list = document.getElementById('skinCapeList')
    list.innerHTML = ''

    const active = skinState.capes.find(c => c.state === 'ACTIVE')

    const none = document.createElement('button')
    none.className = 'skinTile skinCapeTile'
    none.toggleAttribute('selected', active == null)
    none.innerHTML = '<div class="skinCapeNone"></div>'
    const noneLabel = document.createElement('span')
    noneLabel.textContent = Lang.queryJS('settings.skins.noCape')
    none.appendChild(noneLabel)
    none.onclick = () => selectCape(null)
    list.appendChild(none)

    for(const cape of skinState.capes){
        const tile = document.createElement('button')
        tile.className = 'skinTile skinCapeTile'
        tile.toggleAttribute('selected', cape.state === 'ACTIVE')
        tile.title = cape.alias
        try {
            tile.appendChild(await renderCapeFront(cape.dataUrl))
        } catch {
            // Leave the tile without an image if the texture is broken.
        }
        const label = document.createElement('span')
        label.textContent = cape.alias
        tile.appendChild(label)
        tile.onclick = () => selectCape(cape)
        list.appendChild(tile)
    }
}

async function renderSkinLibrary(){
    const list = document.getElementById('skinLibraryList')
    const entries = await SkinLibrary.list()
    list.innerHTML = ''
    document.getElementById('skinLibraryEmpty').hidden = entries.length > 0

    for(const entry of entries){
        let src
        try {
            src = pngToDataUrl(await SkinLibrary.read(entry.id))
        } catch {
            continue
        }
        const tile = document.createElement('button')
        tile.className = 'skinTile'
        tile.title = entry.name
        try {
            tile.appendChild(await renderSkinHead(src))
        } catch {
            continue
        }
        const label = document.createElement('span')
        label.textContent = entry.name
        tile.appendChild(label)

        const remove = document.createElement('div')
        remove.className = 'skinTileRemove'
        remove.title = Lang.queryJS('settings.skins.deleteSkin')
        remove.textContent = '×'
        remove.onclick = async e => {
            e.stopPropagation()
            await SkinLibrary.remove(entry.id)
            await renderSkinLibrary()
        }
        tile.appendChild(remove)

        tile.onclick = () => {
            setPendingSkin(dataUrlToPng(src), entry.name, entry.variant)
        }
        list.appendChild(tile)
    }
}

/* * *
* Actions
* * */

async function loadSkinProfile(){
    setSkinStatus(Lang.queryJS('settings.skins.loading'))
    const token = await getSkinAccessToken()
    const profile = await skinApi('getProfile', token)

    const activeSkin = profile.skins.find(s => s.state === 'ACTIVE')
    if(activeSkin != null){
        skinState.current = {
            dataUrl: await skinApi('fetchTexture', activeSkin.url),
            variant: activeSkin.variant === 'SLIM' ? 'slim' : 'classic'
        }
    }
    skinState.capes = await Promise.all(profile.capes.map(async cape => ({
        ...cape,
        dataUrl: await skinApi('fetchTexture', cape.url)
    })))

    if(skinState.pending == null && skinState.current != null){
        skinState.variant = skinState.current.variant
    }
    showSkinInViewer()
    const activeCape = skinState.capes.find(c => c.state === 'ACTIVE')
    skinState.viewer.loadCape(activeCape ? activeCape.dataUrl : null)
    await renderCapeList()
    setSkinStatus('')
}

// Mojang's default skins, shown when the account has no custom skin.
const DEFAULT_SKIN_URLS = {
    classic: 'https://textures.minecraft.net/texture/1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b',
    slim: 'https://textures.minecraft.net/texture/3b60a1f6d562f52aaebbf1434f1de147933a3affe0e764fa49ea057536623cd3'
}

/**
 * Show the account's public skin right away. It needs no access token, so the
 * viewer is not left empty while the profile loads or if the session expired.
 */
async function loadPublicSkin(){
    const account = ConfigManager.getSelectedAccount()
    if(account == null || account.uuid == null || skinState.current != null){
        return
    }
    try {
        const pub = await skinApi('getPublicSkin', account.uuid)
        const variant = pub ? pub.variant : 'classic'
        const dataUrl = await skinApi('fetchTexture', pub ? pub.skinUrl : DEFAULT_SKIN_URLS.classic)
        // The authenticated profile may have arrived in the meantime; it wins.
        if(skinState.current != null){
            return
        }
        skinState.current = { dataUrl, variant }
        if(skinState.pending == null){
            skinState.variant = variant
        }
        showSkinInViewer()
        if(pub && pub.capeUrl){
            skinState.viewer.loadCape(await skinApi('fetchTexture', pub.capeUrl))
        }
        refreshSkinControls()
    } catch (err) {
        console.warn('Unable to load public skin', err)
    }
}

/**
 * Preview a skin without applying it.
 */
async function setPendingSkin(png, name, variant){
    const dataUrl = pngToDataUrl(png)
    let img
    try {
        img = await loadImage(dataUrl)
    } catch {
        setSkinStatus(Lang.queryJS('settings.skins.invalidFile'), 'error')
        return
    }
    if(img.width !== 64 || (img.height !== 64 && img.height !== 32)){
        setSkinStatus(Lang.queryJS('settings.skins.invalidFile'), 'error')
        return
    }
    skinState.pending = { png, dataUrl, name }
    if(variant != null){
        skinState.variant = variant
    }
    showSkinInViewer()
    refreshSkinControls()
    setSkinStatus(Lang.queryJS('settings.skins.previewReady'))
}

async function loadSkinFile(file){
    if(file == null){
        return
    }
    const png = Buffer.from(await file.arrayBuffer())
    await setPendingSkin(png, file.name.replace(/\.png$/i, ''))
}

function discardPendingSkin(){
    skinState.pending = null
    if(skinState.current != null){
        skinState.variant = skinState.current.variant
    }
    showSkinInViewer()
    refreshSkinControls()
    setSkinStatus('')
}

function applySkin(){
    return runSkinAction(async () => {
        setSkinStatus(Lang.queryJS('settings.skins.applying'))
        const token = await getSkinAccessToken()
        // With nothing pending, re-upload the current skin to change the arm model.
        const png = skinState.pending ? skinState.pending.png : dataUrlToPng(skinState.current.dataUrl)
        const name = skinState.pending ? skinState.pending.name : ConfigManager.getSelectedAccount().displayName
        await skinApi('uploadSkin', token, png, skinState.variant)
        await SkinLibrary.add(png, name, skinState.variant)
        skinState.pending = null
        await loadSkinProfile()
        await renderSkinLibrary()
        setSkinStatus(Lang.queryJS('settings.skins.applied'), 'success')
    })
}

function resetSkin(){
    return runSkinAction(async () => {
        setSkinStatus(Lang.queryJS('settings.skins.applying'))
        const token = await getSkinAccessToken()
        await skinApi('resetSkin', token)
        skinState.pending = null
        await loadSkinProfile()
        setSkinStatus(Lang.queryJS('settings.skins.resetDone'), 'success')
    })
}

function selectCape(cape){
    const active = skinState.capes.find(c => c.state === 'ACTIVE')
    if((cape == null && active == null) || (cape != null && cape.state === 'ACTIVE')){
        return
    }
    return runSkinAction(async () => {
        const token = await getSkinAccessToken()
        await skinApi('setCape', token, cape ? cape.id : null)
        for(const c of skinState.capes){
            c.state = cape != null && c.id === cape.id ? 'ACTIVE' : 'INACTIVE'
        }
        skinState.viewer.loadCape(cape ? cape.dataUrl : null)
        await renderCapeList()
        setSkinStatus(Lang.queryJS('settings.skins.capeChanged'), 'success')
    })
}

/* * *
* Tab lifecycle (called from settings.js)
* * */

/**
 * Called when the Skin tab is shown.
 */
function prepareSkinTab(){
    ensureSkinViewer()
    refreshSkinControls()
    renderSkinLibrary()
    loadPublicSkin()
    runSkinAction(loadSkinProfile)
}

/* * *
* Bindings
* * */

for(const btn of document.getElementsByClassName('skinVariantButton')){
    btn.onclick = () => {
        skinState.variant = btn.getAttribute('variant')
        showSkinInViewer()
        refreshSkinControls()
    }
}

document.getElementById('skinUploadButton').onclick = () => {
    document.getElementById('skinFileInput').click()
}
document.getElementById('skinFileInput').onchange = async e => {
    await loadSkinFile(e.target.files[0])
    // Allow picking the same file again.
    e.target.value = ''
}
document.getElementById('skinApplyButton').onclick = applySkin
document.getElementById('skinDiscardButton').onclick = discardPendingSkin
document.getElementById('skinResetButton').onclick = resetSkin
document.getElementById('skinLoginButton').onclick = () => {
    settingsNavItemListener(document.getElementById('settingsNavAccount'))
}

const skinViewerPanel = document.getElementById('skinViewerPanel')
skinViewerPanel.ondragover = e => {
    e.preventDefault()
    skinViewerPanel.setAttribute('dragging', '')
}
skinViewerPanel.ondragleave = () => {
    skinViewerPanel.removeAttribute('dragging')
}
skinViewerPanel.ondrop = async e => {
    e.preventDefault()
    skinViewerPanel.removeAttribute('dragging')
    await loadSkinFile(e.dataTransfer.files[0])
}
