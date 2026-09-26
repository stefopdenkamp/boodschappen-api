import { expect, test } from 'bun:test'

process.env.DB_FILE_NAME = ':memory:'
process.env.API_TOKEN = 'test-token'
process.env.ALLOWED_USERS = 'Stef, Harriet'
const { default: app } = await import('./index')

const req = (method: string, path: string, body?: unknown, token = 'test-token') =>
  app.request(`/api/boodschappen${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

test('rejects missing or wrong token', async () => {
  expect((await req('GET', '/list', undefined, 'wrong')).status).toBe(401)
})

test('default categories are seeded', async () => {
  const cats = await (await req('GET', '/category')).json()
  expect(cats.map((c: any) => c.type)).toContain('dairy')
})

test('adding to the list records unique groceries, autocomplete works, list is sorted and filterable', async () => {
  expect((await req('POST', '/list', { name: 'Melk', category: 'dairy', user: 'Bob' })).status).toBe(400)

  await req('POST', '/list', { name: 'Melk', category: 'dairy', user: 'Stef' })
  await req('POST', '/list', { name: 'melk', user: 'Harriet' }) // existing name, category not needed
  await req('POST', '/list', { name: 'Appel', category: 'fruits', user: 'Stef' })
  await req('POST', '/list', { name: 'Banaan', category: 'fruits', user: 'Harriet' })

  const record = await (await req('GET', '?q=mel')).json()
  expect(record).toHaveLength(1)
  expect(record[0].name).toBe('Melk')

  const list = await (await req('GET', '/list')).json()
  expect(list.map((i: any) => i.name)).toEqual(['Appel', 'Banaan', 'Melk', 'Melk'])

  expect((await (await req('GET', '/list?category=fruits')).json())).toHaveLength(2)
  expect((await (await req('GET', '/list?user=Harriet')).json()).map((i: any) => i.name)).toEqual(['Banaan', 'Melk'])
})

test('editing the record updates the shopping list', async () => {
  const [melk] = await (await req('GET', '?q=Melk')).json()
  await req('PATCH', `/${melk.id}`, { name: 'Havermelk', category: 'drinks' })
  const list = await (await req('GET', '/list?category=drinks')).json()
  expect(list.map((i: any) => i.name)).toEqual(['Havermelk', 'Havermelk'])
})

test('duplicate record names are rejected', async () => {
  expect((await req('POST', '', { name: 'APPEL', category: 'fruits' })).status).toBe(409)
})

test('delete a list item', async () => {
  const [item] = await (await req('GET', '/list')).json()
  expect((await req('DELETE', `/list/${item.id}`)).status).toBe(204)
  expect((await req('DELETE', `/list/${item.id}`)).status).toBe(404)
})

test('categories: add, edit (cascades to groceries), cannot delete when in use', async () => {
  const created = await (await req('POST', '/category', { type: 'bakery', color: '#ffcc00', sort_order: 0 })).json()
  await req('POST', '', { name: 'Brood', category: 'bakery' })
  const patched = await (await req('PATCH', `/category/${created.id}`, { type: 'bread' })).json()
  expect(patched.type).toBe('bread')
  expect((await (await req('GET', '?q=Brood')).json())[0].category).toBe('bread')
  expect((await req('DELETE', `/category/${created.id}`)).status).toBe(409)
})

test('recipes: create, list alphabetically, add checked groceries to list', async () => {
  const record = await (await req('GET', '')).json()
  const ids = record.map((g: any) => g.id)
  expect((await req('POST', '/recipe', { name: 'x', ingredients: [9999] })).status).toBe(400)

  const r = await (await req('POST', '/recipe', { name: 'Smoothie', ingredients: ids })).json()
  await req('POST', '/recipe', { name: 'Appeltaart', ingredients: [ids[0]] })
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
