/**
 * An opaque, anonymous ID for "whoever is using this browser". There are no
 * accounts - this is what scopes saved annotations to one reader so that
 * two people opening the same paper do not see each other's notes. Generated
 * once and kept in localStorage; nothing about it identifies a person.
 */

const STORAGE_KEY = 'htgenai.readerId'

export function getReaderId() {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}
