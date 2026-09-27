import { expect, test } from 'bun:test'

process.env.DB_FILE_NAME = ':memory:'
process.env.API_TOKEN = 'test-token'
process.env.ALLOWED_USERS = 'Stef, Harriet'
process.env.CORS_ORIGIN = 'https://web.example'
const { default: app } = await import('./index')

const req = (method: string, path: string, body?: unknown, token = 'test-token') =>
  app.request(`/api/boodschappen${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const cats: any[] = await (await req('GET', '/category')).json()
const catId = (type: string) => cats.find((c) => c.type === type).id
const addGrocery = async (name: string, type: string) =>
  (await (await req('POST', '', { name, category: catId(type) })).json()).id

test('rejects missing or wrong token', async () => {
  expect((await req('GET', '/list', undefined, 'wrong')).status).toBe(401)
})

test('CORS preflight is allowed for the webapp origin without a token', async () => {
  const res = await app.request('/api/boodschappen/list', {
    method: 'OPTIONS',
    headers: { Origin: 'https://web.example', 'Access-Control-Request-Method': 'POST' },
  })
  expect(res.status).toBe(204)
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://web.example')
})

test('default categories are seeded', () => {
  expect(cats.map((c) => c.type)).toContain('dairy')
})

test('record: add, reject duplicate names, autocomplete, no PATCH', async () => {
  const melk = await addGrocery('Melk', 'dairy')
  expect((await req('POST', '', { name: 'MELK', category: catId('dairy') })).status).toBe(409)
  expect((await req('POST', '', { name: 'Kaas', category: 'dairy' })).status).toBe(400)
  expect((await req('POST', '', { name: 'Kaas', category: 9999 })).status).toBe(409)

  const found = await (await req('GET', '?q=mel')).json()
  expect(found).toEqual([{ id: melk, name: 'Melk', category: catId('dairy') }])

  expect((await req('PATCH', `/${melk}`, { name: 'x' })).status).toBe(404)
})

test('list: add by grocery id, sorted by category then name, filterable', async () => {
  const [melk] = await (await req('GET', '?q=Melk')).json()
  const appel = await addGrocery('Appel', 'fruits')
  const banaan = await addGrocery('Banaan', 'fruits')

  expect((await req('POST', '/list', { grocery_id: melk.id, user: 'Bob' })).status).toBe(400)
  const item = await (await req('POST', '/list', { grocery_id: melk.id, user: 'Stef' })).json()
  expect(item).toEqual({ id: item.id, grocery_id: melk.id, user: 'Stef' })
  await req('POST', '/list', { grocery_id: banaan, user: 'Harriet' })
  await req('POST', '/list', { grocery_id: appel, user: 'Stef' })

  expect((await (await req('GET', '/list')).json()).map((i: any) => i.name)).toEqual(['Appel', 'Banaan', 'Melk'])
  expect(await (await req('GET', `/list?category=${catId('fruits')}`)).json()).toHaveLength(2)
  expect((await (await req('GET', '/list?user=Harriet')).json()).map((i: any) => i.name)).toEqual(['Banaan'])
})

test('delete a list item', async () => {
  const [item] = await (await req('GET', '/list')).json()
  expect((await req('DELETE', `/list/${item.id}`)).status).toBe(204)
  expect((await req('DELETE', `/list/${item.id}`)).status).toBe(404)
})

test('categories: add, edit, cannot delete when in use', async () => {
  const created = await (await req('POST', '/category', { type: 'bakery', color: '#ffcc00', sort_order: 0 })).json()
  await req('POST', '', { name: 'Brood', category: created.id })
  expect((await (await req('PATCH', `/category/${created.id}`, { type: 'bread' })).json()).type).toBe('bread')
  expect((await req('DELETE', `/category/${created.id}`)).status).toBe(409)
})

test('recipes: validate, create, list alphabetically, add checked groceries to list', async () => {
  const ids = (await (await req('GET', '')).json()).map((g: any) => g.id)
  expect((await req('POST', '/recipe', { name: 'x', type: 'dinner', ingredients: [9999] })).status).toBe(400)
  expect((await req('POST', '/recipe', { name: 'x', type: 'brunch', ingredients: [] })).status).toBe(400)
  expect((await req('POST', '/recipe', { name: 'x', type: 'dinner', ingredients: [], instructions: ['stir'] })).status).toBe(400)

  const r = await (await req('POST', '/recipe', {
    name: 'Smoothie', type: 'breakfast', country: 'NL', ingredients: ids, instructions: [{ step: 1, text: 'Blend' }],
  })).json()
  expect(r).toMatchObject({ type: 'breakfast', country: 'NL', instructions: [{ step: 1, text: 'Blend' }] })

  const pie = await (await req('POST', '/recipe', { name: 'Appeltaart', type: 'snack', ingredients: [ids[0]] })).json()
  expect(pie).toMatchObject({ country: null, instructions: null })
  expect((await (await req('PATCH', `/recipe/${pie.id}`, { country: 'NL' })).json()).country).toBe('NL')
  expect((await (await req('GET', '/recipe')).json()).map((x: any) => x.name)).toEqual(['Appeltaart', 'Smoothie'])

  const before = (await (await req('GET', '/list')).json()).length
  const res = await req('POST', `/recipe/${r.id}/add`, { grocery_ids: ids.slice(0, 2), user: 'Stef' })
  expect(res.status).toBe(201)
  expect((await (await req('GET', '/list')).json()).length).toBe(before + 2)
})

test('deleting a grocery removes it from the list and from recipes', async () => {
  const [appel] = await (await req('GET', '?q=Appel')).json()
  expect((await req('DELETE', `/${appel.id}`)).status).toBe(204)
  expect((await (await req('GET', '/list')).json()).some((i: any) => i.name === 'Appel')).toBe(false)
  const recipes = await (await req('GET', '/recipe')).json()
  expect(recipes.every((r: any) => !r.ingredients.includes(appel.id))).toBe(true)
})
