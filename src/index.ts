import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { HTTPException } from 'hono/http-exception'
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm'
import { db } from './db'
import { categories, groceries, recipes, shoppingList } from './db/schema'

const USERS = process.env.ALLOWED_USERS!.split(',').map((u) => u.trim())

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.every(Number.isInteger)
const allGroceriesExist = (ids: number[]) =>
  ids.length === 0 ||
  db.select().from(groceries).where(inArray(groceries.id, ids)).all().length === new Set(ids).size

const app = new Hono()

app.use('/api/*', bearerAuth({ token: process.env.API_TOKEN! }))

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  const code = (err.cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code
  if (code?.startsWith('SQLITE_CONSTRAINT')) return c.json({ error: code }, 409)
  if (err instanceof SyntaxError) return c.json({ error: 'invalid JSON' }, 400)
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})

const api = new Hono()

// --- grocery record (autocomplete + settings) ---

api.get('/', (c) => {
  const q = c.req.query('q') ?? ''
  return c.json(
    db.select().from(groceries)
      .where(like(groceries.name, `%${q}%`))
      .orderBy(sql`${groceries.name} collate nocase`)
      .all(),
  )
})

api.post('/', async (c) => {
  const { name, category } = await c.req.json()
  if (!isText(name) || !isText(category)) return c.json({ error: 'name and category required' }, 400)
  return c.json(db.insert(groceries).values({ name: name.trim(), category }).returning().get(), 201)
})

api.patch('/:id', async (c) => {
  const { name, category } = await c.req.json()
  if ((name !== undefined && !isText(name)) || (category !== undefined && !isText(category)))
    return c.json({ error: 'invalid name or category' }, 400)
  const row = db.update(groceries)
    .set({ name: name?.trim(), category })
    .where(eq(groceries.id, Number(c.req.param('id'))))
    .returning().get()
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})

api.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const row = db.transaction((tx) => {
    for (const r of tx.select().from(recipes).all()) {
      if (r.ingredients.includes(id))
        tx.update(recipes).set({ ingredients: r.ingredients.filter((i) => i !== id) }).where(eq(recipes.id, r.id)).run()
    }
    return tx.delete(groceries).where(eq(groceries.id, id)).returning().get()
  })
  return row ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
})

// --- shopping list ---

const listItem = {
  id: shoppingList.id,
  grocery_id: groceries.id,
  name: groceries.name,
  category: groceries.category,
  user: shoppingList.user,
}

api.get('/list', (c) => {
  const { category, user } = c.req.query()
  return c.json(
    db.select(listItem).from(shoppingList)
      .innerJoin(groceries, eq(shoppingList.grocery_id, groceries.id))
      .innerJoin(categories, eq(groceries.category, categories.type))
      .where(and(
        category ? eq(groceries.category, category) : undefined,
        user ? eq(shoppingList.user, user) : undefined,
      ))
      .orderBy(asc(categories.sort_order), sql`${groceries.name} collate nocase`)
      .all(),
  )
})

// Adds to the list; creates the grocery in the record first if the name is new.
api.post('/list', async (c) => {
  const { name, category, user } = await c.req.json()
  if (!isText(name) || !USERS.includes(user)) return c.json({ error: 'name and valid user required' }, 400)
  let grocery = db.select().from(groceries).where(sql`lower(${groceries.name}) = lower(${name.trim()})`).get()
  if (!grocery) {
    if (!isText(category)) return c.json({ error: 'category required for a new grocery' }, 400)
    grocery = db.insert(groceries).values({ name: name.trim(), category }).returning().get()
  }
  const item = db.insert(shoppingList).values({ grocery_id: grocery.id, user }).returning().get()
  return c.json({ id: item.id, grocery_id: grocery.id, name: grocery.name, category: grocery.category, user }, 201)
})

api.delete('/list/:id', (c) => {
  const row = db.delete(shoppingList).where(eq(shoppingList.id, Number(c.req.param('id')))).returning().get()
  return row ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
})

// --- categories ---

api.get('/category', (c) => c.json(db.select().from(categories).orderBy(asc(categories.sort_order)).all()))

api.post('/category', async (c) => {
  const { type, color, sort_order } = await c.req.json()
  if (!isText(type) || !isText(color) || !Number.isInteger(sort_order))
    return c.json({ error: 'type, color and integer sort_order required' }, 400)
  return c.json(db.insert(categories).values({ type, color, sort_order }).returning().get(), 201)
})

api.patch('/category/:id', async (c) => {
  const { type, color, sort_order } = await c.req.json()
  if ((type !== undefined && !isText(type)) || (color !== undefined && !isText(color)) ||
      (sort_order !== undefined && !Number.isInteger(sort_order)))
    return c.json({ error: 'invalid type, color or sort_order' }, 400)
  const row = db.update(categories)
    .set({ type, color, sort_order })
    .where(eq(categories.id, Number(c.req.param('id'))))
    .returning().get()
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})

api.delete('/category/:id', (c) => {
  const row = db.delete(categories).where(eq(categories.id, Number(c.req.param('id')))).returning().get()
  return row ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
})

// --- recipes ---

api.get('/recipe', (c) => c.json(db.select().from(recipes).orderBy(sql`${recipes.name} collate nocase`).all()))

api.post('/recipe', async (c) => {
  const { name, ingredients } = await c.req.json()
  if (!isText(name) || !isIdList(ingredients) || !allGroceriesExist(ingredients))
    return c.json({ error: 'name and existing grocery ids required' }, 400)
  return c.json(db.insert(recipes).values({ name, ingredients }).returning().get(), 201)
})

api.patch('/recipe/:id', async (c) => {
  const { name, ingredients } = await c.req.json()
  if ((name !== undefined && !isText(name)) ||
      (ingredients !== undefined && (!isIdList(ingredients) || !allGroceriesExist(ingredients))))
    return c.json({ error: 'invalid name or ingredients' }, 400)
  const row = db.update(recipes)
    .set({ name, ingredients })
    .where(eq(recipes.id, Number(c.req.param('id'))))
    .returning().get()
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})

api.delete('/recipe/:id', (c) => {
  const row = db.delete(recipes).where(eq(recipes.id, Number(c.req.param('id')))).returning().get()
  return row ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
})

// Adds the checked ingredients of a recipe to the shopping list.
api.post('/recipe/:id/add', async (c) => {
  const { grocery_ids, user } = await c.req.json()
  if (!isIdList(grocery_ids) || !USERS.includes(user)) return c.json({ error: 'grocery_ids and valid user required' }, 400)
  const recipe = db.select().from(recipes).where(eq(recipes.id, Number(c.req.param('id')))).get()
  if (!recipe) return c.json({ error: 'not found' }, 404)
  if (!grocery_ids.every((id) => recipe.ingredients.includes(id)))
    return c.json({ error: 'grocery_ids must be ingredients of this recipe' }, 400)
  if (grocery_ids.length === 0) return c.json([], 201)
  const items = db.insert(shoppingList).values(grocery_ids.map((grocery_id) => ({ grocery_id, user }))).returning().all()
  return c.json(items, 201)
})

app.route('/api/boodschappen', api)

export default app
