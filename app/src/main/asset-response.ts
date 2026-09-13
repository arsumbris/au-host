import { open, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.apng': 'image/apng',
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
}

/** Resolve an HTML artifact resource within the registered entry's real directory. */
export async function artifactPath(entry: string, pathname: string): Promise<string | null> {
  // The minted document URL is stable regardless of the source HTML filename.
  if (pathname === '/' || pathname === '/index.html') return entry
  try {
    const base = await realpath(dirname(entry))
    const target = await realpath(resolve(base, '.' + decodeURIComponent(pathname)))
    const local = relative(base, target)
    return local && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local) ? target : null
  } catch {
    return null
  }
}

/** Serve only a path already authorized by the asset-token registry. */
export async function serveAssetFile(file: string, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const handle = await open(file, 'r').catch(() => null)
  if (!handle) return new Response('asset not readable', { status: 404 })
  let transferred = false
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) return new Response('asset not readable', { status: 404 })
    const size = stat.size
    const headers = new Headers({
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
      'content-length': String(size),
    })
    let start = 0, end = size - 1, status = 200
    // Ignore unsupported/malformed ranges, including multipart, and return the full representation.
    const range = request.method === 'GET' && !request.headers.has('if-range')
      ? /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '') : null
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
      }
      status = 206
      headers.set('content-range', `bytes ${start}-${end}/${size}`)
      headers.set('content-length', String(end - start + 1))
    }
    if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
    const stream = handle.createReadStream({ start, end, autoClose: true, signal: request.signal })
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    const response = new Response(body, { status, headers })
    transferred = true
    return response
  } finally {
    if (!transferred) await handle.close()
  }
}
