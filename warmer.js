import Logger from 'logplease'
import fetch from 'node-fetch'
import { parse } from 'node-html-parser'
import utils from './utilities.js'

const logger = Logger.create('warmer')

export default class Warmer {
    constructor(sitemap, settings) {
        this.settings = settings

        this.custom_headers = {}
        if (this.settings.custom_headers) {
            Object.assign(this.custom_headers, this.settings.custom_headers)
        }

        this.accept_encoding = []
        if (this.settings.warmup_brotli) {
            this.accept_encoding.br = 'gzip, deflate, br'
        }
        if (this.settings.warmup_gzip) {
            this.accept_encoding.gzip = 'gzip, deflate'
        }
        if (this.settings.warmup_deflate) {
            this.accept_encoding.deflate = 'deflate'
        }

        this.accept = []
        if (this.settings.warmup_avif) {
            this.accept.avif = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
        if (this.settings.warmup_webp) {
            this.accept.webp = 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
        this.accept.default = 'image/apng,image/svg+xml,image/*,*/*;q=0.8'

        this.sitemap = sitemap
        this.urls = this.sitemap.getURLs()
        this.images = this.sitemap.getImages()
        this.assets = new Set()
    }

    async warmup() {
        if (Object.values(this.urls).length === 0) {
            logger.info('📫 No URLs need to warm up. You might want to using parameter --range or --all. Using command `warmup -h` for more information.')
            return
        }

        if (this.settings.all) {
            logger.info('✅  Done. Prepare warming all URLs')
        }
        else {
            logger.info(`✅  Done. Prepare warming URLs newer than ${this.settings.newer_than}s (${utils.toHumans(this.settings.newer_than)})`)
        }

        for (const url of Object.keys(this.urls)) {
            await this.warmup_site(utils.applyOrigin(url, this.settings.origin))
        }

        for (let image of this.images) {
            await this.warmup_image(utils.applyOrigin(image, this.settings.origin))
        }

        logger.info(`📫 Warming up all site's assets, stay tuned!`)

        for (let url of this.assets) {
            url = utils.tryValidURL(url, `${this.settings.sitemap.protocol}//${this.settings.sitemap.hostname}`)
            if (url !== false) {
                await this.warmup_site(url)
            }
        }

        logger.info(`📫 Done! Warm up total ${Object.values(this.urls).length} URLs (included ${this.images.length} images) and ${this.assets.size} assets. Have fun!`)
    }

    async warmup_site(url) {
        logger.debug(`🚀 Warming ${url}`)
        if (this.settings.purge >= 1) {
            await this.purge(url)
            await this.sleep(100)
        }
        for (const accept_encoding of Object.keys(this.accept_encoding)) {
            await this.fetch(url, Object.assign({}, this.custom_headers, {"accept-encoding": this.accept_encoding[accept_encoding]}))
            await this.sleep(this.settings.delay)
        }
    }

    async warmup_image(image_url) {
        logger.debug(`🚀📷 Warming ${image_url}`)
        if (this.settings.purge >= 2) {
            await this.purge(image_url)
            await this.sleep(100)
        }
        for (const accept of Object.keys(this.accept)) {
            await this.fetch(image_url, Object.assign({}, this.custom_headers, {accept: this.accept[accept]}))
            await this.sleep(this.settings.delay)
        }
    }

    async purge(url) {
        logger.debug(`  ⚡️ Purging ${url}`)
        await fetch(url, {
            "headers": Object.assign(
                {
                    "cache-control": "no-cache",
                    "pragma": "no-cache",
                    "user-agent": 'datuan.dev - Cache Warmer (https://github.com/tdtgit/sitemap-warmer)'
                },
                headers
            ),
            "body": null,
            "method": "PURGE",
            "mode": "cors"
        })
    }

    async fetch(url, headers = { accept: '', accept_encoding: '' }) {
        logger.debug(`  ⚡️ Warming ${url}`, headers)
        const res = await fetch(url, {
            "headers": Object.assign(
                {
                    "cache-control": "no-cache",
                    "pragma": "no-cache",
                    "user-agent": 'datuan.dev - Cache Warmer (https://github.com/tdtgit/sitemap-warmer)'
                },
                headers
            ),
            "body": null,
            "method": "GET",
            "mode": "cors"
        })

        // No need warmup CSS/JS or compressed response
        if (this.settings.warmup_css === false && this.settings.warmup_js === false) {
            return
        }
        if (headers.accept_encoding !== 'deflate') {
            return
        }

        // Send HTML response for parsing CSS/JS
        const data = await res.text()
        this.html(data)
    }

    async sleep(millis) {
        return new Promise(resolve => setTimeout(resolve, millis))
    }

    html(html) {
        const root = parse(html)

        if (this.settings.warmup_js) {
            const scripts = root.querySelectorAll('script[src]')
            scripts.forEach(elem => {
                this.assets.add(elem.attributes.src)
            })
        }

        if (this.settings.warmup_css) {
            const styles = root.querySelectorAll('link[href][rel="stylesheet"]')
            styles.forEach(elem => {
                this.assets.add(elem.attributes.href)
            })
        }
    }
}