// Minecraft Services skin/cape API. Runs in the main process so requests are
// not subject to the renderer's CORS restrictions.
// Reference: https://wiki.vg/Mojang_API#Profile_Information

const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

class SkinApiError extends Error {
    /**
     * @param {string} code Machine readable error code (see errorCode()).
     * @param {string} message Human readable message, for logs.
     */
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

function errorCode(status) {
    switch(status) {
        case 400: return 'invalidSkin'
        case 401: return 'unauthorized'
        case 403: return 'forbidden'
        case 404: return 'notFound'
        case 429: return 'rateLimited'
        default: return 'unknown'
    }
}

async function request(url, accessToken, options = {}) {
    let res
    try {
        res = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...options.headers
            }
        })
    } catch (err) {
        throw new SkinApiError('network', err.message)
    }
    if(!res.ok) {
        const body = await res.text().catch(() => '')
        throw new SkinApiError(errorCode(res.status), `${res.status} ${body}`)
    }
    return res.status === 204 ? null : res.json()
}

/**
 * @param {string} accessToken Minecraft access token.
 * @returns {Promise<{id: string, name: string, skins: Object[], capes: Object[]}>}
 */
exports.getProfile = function(accessToken) {
    return request(PROFILE_URL, accessToken)
}

/**
 * @param {string} accessToken Minecraft access token.
 * @param {Uint8Array} png The skin PNG.
 * @param {'classic' | 'slim'} variant Arm model.
 */
exports.uploadSkin = function(accessToken, png, variant) {
    const form = new FormData()
    form.append('variant', variant)
    form.append('file', new Blob([png], { type: 'image/png' }), 'skin.png')
    return request(`${PROFILE_URL}/skins`, accessToken, { method: 'POST', body: form })
}

/** Reset the skin to the default (Steve/Alex). */
exports.resetSkin = function(accessToken) {
    return request(`${PROFILE_URL}/skins/active`, accessToken, { method: 'DELETE' })
}

/**
 * @param {string} accessToken Minecraft access token.
 * @param {string | null} capeId The cape to show, or null to hide the cape.
 */
exports.setCape = function(accessToken, capeId) {
    if(capeId == null) {
        return request(`${PROFILE_URL}/capes/active`, accessToken, { method: 'DELETE' })
    }
    return request(`${PROFILE_URL}/capes/active`, accessToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capeId })
    })
}

/**
 * Download a texture from textures.minecraft.net as a data URL, so the
 * renderer can draw it on a canvas without tainting it.
 *
 * @param {string} url Texture URL.
 * @returns {Promise<string>} The texture as a PNG data URL.
 */
exports.fetchTexture = async function(url) {
    const parsed = new URL(url)
    if(parsed.hostname !== 'textures.minecraft.net') {
        throw new SkinApiError('forbidden', `Refusing to fetch texture from ${parsed.hostname}`)
    }
    parsed.protocol = 'https:'
    let res
    try {
        res = await fetch(parsed)
    } catch (err) {
        throw new SkinApiError('network', err.message)
    }
    if(!res.ok) {
        throw new SkinApiError(errorCode(res.status), `${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:image/png;base64,${buf.toString('base64')}`
}

/**
 * Look up a player's public skin by UUID. Needs no access token, so the
 * preview works even when the Microsoft session has expired.
 *
 * @param {string} uuid Player UUID (with or without dashes).
 * @returns {Promise<{skinUrl: string, variant: 'classic' | 'slim', capeUrl: string | null} | null>}
 * Null if the player has no custom skin.
 */
exports.getPublicSkin = async function(uuid) {
    let res
    try {
        res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`)
    } catch (err) {
        throw new SkinApiError('network', err.message)
    }
    if(!res.ok) {
        throw new SkinApiError(errorCode(res.status), `${res.status}`)
    }
    const profile = await res.json()
    const prop = profile.properties.find(p => p.name === 'textures')
    const textures = JSON.parse(Buffer.from(prop.value, 'base64').toString()).textures
    if(textures.SKIN == null) {
        return null
    }
    return {
        skinUrl: textures.SKIN.url,
        variant: textures.SKIN.metadata?.model === 'slim' ? 'slim' : 'classic',
        capeUrl: textures.CAPE ? textures.CAPE.url : null
    }
}
