
 // Stored document bytes.


import { createHash } from 'node:crypto'
import { mkdirSync, existsSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './db.js'

export const MAX_BYTES = 25 * 1024 * 1024

const uploadsDir = join(dataDir, 'uploads')
mkdirSync(uploadsDir, { recursive: true })

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Rejects anything that is not a  64-char hex digest. */
export function isValidHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)
}

function pathFor(hash) {
  return join(uploadsDir, hash)
}

export function isStored(hash) {
  return isValidHash(hash) && existsSync(pathFor(hash))
}

export async function store(buffer) {
  const hash = sha256Hex(buffer)
  if (!existsSync(pathFor(hash))) {
    await writeFile(pathFor(hash), buffer)
  }
  return hash
}

export async function read(hash) {
  if (!isValidHash(hash)) throw new Error('Invalid document hash')
  return readFile(pathFor(hash))
}
