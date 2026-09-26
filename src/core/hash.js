/**
 * Content-based document identity: a hex SHA-256 of the raw file bytes.
 * Hashing content rather than trusting filename+size means the same file
 * reopened under a different name still matches, and two different files
 * never collide.
 */
export async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
