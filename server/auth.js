/**
 * Passwords and sessions.
 *
 * Hashing uses scrypt from `node:crypto` rather than bcrypt/argon2 so there
 * is no native module to compile. Comparison is constant-time.
 *
 * The session token is random, stored server-side, and sent to the browser
 * as an httpOnly cookie - so the client never supplies its own identity and
 * cannot forge someone else's. (An earlier version of this project scoped
 * saved notes by a client-generated ID kept in localStorage, which any
 * viewer could read and any caller could spoof.)
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { createSession, deleteSession, findUserBySession } from './db.js'

const scrypt = promisify(scryptCb)

const KEY_LENGTH = 64
const SESSION_DAYS = 30
export const COOKIE_NAME = 'htgenai_session'

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(':')
  if (!salt || !expectedHex) return false
  const derived = await scrypt(password, salt, KEY_LENGTH)
  const expected = Buffer.from(expectedHex, 'hex')
  if (expected.length !== derived.length) return false
  return timingSafeEqual(derived, expected)
}

/** Creates a session row and returns the cookie value to hand the browser. */
export function startSession(userId) {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  createSession({ token, userId, expiresAt: expires.toISOString() })
  return { token, expires }
}

export function endSession(token) {
  if (token) deleteSession(token)
}

/**
 * Minimal Cookie header parsing - avoids a cookie-parser dependency for the
 * one cookie this app sets.
 */
function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

export function setSessionCookie(res, { token, expires }) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires,
    // No `secure` flag: local development is plain HTTP. A deployed version
    // must set it, or the cookie travels in the clear.
  })
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' })
}

/**
 * Attaches `req.user` when a valid session cookie is present. Never rejects -
 * the app has a working guest mode, so routes decide for themselves whether
 * they need an account.
 */
export function attachUser(req, _res, next) {
  const token = readCookie(req, COOKIE_NAME)
  req.sessionToken = token
  req.user = token ? findUserBySession(token) : null
  next()
}

export function requireUser(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }
  next()
}
