
import test, { before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startServer, client } from './helpers/server.js'

let server

before(async () => {
  server = await startServer()
})

after(async () => {
  await server.stop()
})

const bytes = (s) => Buffer.from(s, 'utf8')
const PAPER = bytes('A paper about retrieval.\n\nIt has a second paragraph.\n')

describe('accounts', () => {


  test('registering signs you in and does not reveal the password hash', async () => {
    const a = client(server.base)
    const { status, body } = await a.register('a@test.local', 'password123')

    assert.equal(status, 201)
    assert.equal(body.user.email, 'a@test.local')
    assert.ok(body.user.id)
    assert.ok(!('password_hash' in body.user), 'the hash never leaves the server')
  })


  test('a wrong password and an unknown address are indistinguishable', async () => {
    const a = client(server.base)
    await a.register('known@test.local', 'password123')

    const wrongPassword = await client(server.base).login('known@test.local', 'wrongpass1')
    const noSuchUser = await client(server.base).login('ghost@test.local', 'wrongpass1')

    assert.equal(wrongPassword.status, 401)
    assert.equal(noSuchUser.status, 401)
    assert.equal(
      wrongPassword.body.error,
      noSuchUser.body.error,
      'the response must not reveal which addresses have accounts'
    )
  })

  test('passwords are never stored in a readable form', async () => {
    const a = client(server.base)
    await a.register('hashed@test.local', 'correct horse battery')

    const raw = await readFile(join(server.dataDir, 'app.db'))
    assert.ok(
      !raw.includes(Buffer.from('correct horse battery')),
      'the password appears verbatim in the database file'
    )
  })
})

describe('a document is identified by its bytes', () => {
  test('the same file under two names is stored once, per-user entries stay separate', async () => {
    const a = client(server.base)
    const b = client(server.base)
    await a.register('dedup-a@test.local', 'password123')
    await b.register('dedup-b@test.local', 'password123')

    const first = await a.upload(PAPER, { title: 'Nelson 1965', format: 'txt' })
    const second = await b.upload(PAPER, { title: 'a-totally-different-name', format: 'txt' })

    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.equal(
      first.body.document.hash,
      second.body.document.hash,
      'identity comes from the content, not the filename'
    )

    const aShelf = (await a.request('/api/library')).body.documents
    const bShelf = (await b.request('/api/library')).body.documents
    assert.equal(aShelf[0].title, 'Nelson 1965')
    assert.equal(bShelf[0].title, 'a-totally-different-name')
  })

  test('a hash the client invented is refused', async () => {
    const a = client(server.base)
    await a.register('forge@test.local', 'password123')

    const invented = 'f'.repeat(64)
    const open = await a.request(`/api/documents/${invented}/open`, { method: 'POST' })
    const file = await a.request(`/api/documents/${invented}/file`)

    assert.equal(open.status, 404)
    assert.equal(file.status, 404)
  })

  test('a hash that is not a hash is rejected rather than used as a path', async () => {
    const a = client(server.base)
    await a.register('path@test.local', 'password123')

    const res = await a.request('/api/library/not-a-hash', { method: 'DELETE' })
    assert.equal(res.status, 400)
  })
})

describe('nothing a user saves is reachable from another account', () => {
  let hash
  let owner
  let stranger

  before(async () => {
    owner = client(server.base)
    stranger = client(server.base)
    await owner.register('owner@test.local', 'password123')
    await stranger.register('stranger@test.local', 'password123')

    const up = await owner.upload(PAPER, { title: "Owner's paper", format: 'txt' })
    hash = up.body.document.hash

    await owner.request('/api/annotations', {
      method: 'POST',
      body: {
        documentHash: hash,
        operationId: 'assumptions',
        selection: 'A paper about retrieval.',
        response: 'A private answer.',
        anchor: { kind: 'blocks', model: 2, segments: [{ block: 0, start: 0, end: 24 }] },
      },
    })
  })


  test("another account cannot read the document's bytes", async () => {
    const res = await stranger.request(`/api/documents/${hash}/file`)
    assert.equal(res.status, 404, 'knowing the hash is not an access grant')
  })

  test('another account cannot open it or see its notes', async () => {
    const res = await stranger.request(`/api/documents/${hash}/open`, { method: 'POST' })
    assert.equal(res.status, 404)

    const shelf = await stranger.request('/api/library')
    assert.deepEqual(shelf.body.documents, [])
  })

  test('another account cannot annotate it', async () => {
    const res = await stranger.request('/api/annotations', {
      method: 'POST',
      body: { documentHash: hash, operationId: 'explain', selection: 'x', response: 'y' },
    })
    assert.equal(res.status, 404)
  })

  test('the owner can still do all of it', async () => {
    const file = await owner.request(`/api/documents/${hash}/file`)
    const open = await owner.request(`/api/documents/${hash}/open`, { method: 'POST' })

    assert.equal(file.status, 200)
    assert.equal(file.text, PAPER.toString())
    assert.equal(open.body.annotations.length, 1)
    assert.equal(open.body.annotations[0].response, 'A private answer.')
  })
})

describe('the model endpoint is bounded', () => {
  test('a caller past the limit is refused, and told how long to wait', async () => {
    const limited = await startServer({ GENERATE_PER_MINUTE: '3' })
    try {
      const guest = client(limited.base)
      const ask = () =>
        guest.request('/api/generate', {
          method: 'POST',
          body: { contents: [{ parts: [{ text: 'hello' }] }] },
        })

      const within = [await ask(), await ask(), await ask()]
      const over = await ask()

      for (const res of within) assert.equal(res.status, 503, 'under the limit, only the key is missing')
      assert.equal(over.status, 429)
      assert.match(over.body.error, /more than 3 questions a minute/)
      assert.ok(over.headers.get('retry-after'), 'the client is told when to try again')
    } finally {
      await limited.stop()
    }
  })
})


