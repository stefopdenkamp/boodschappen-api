import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull().unique(),
  color: text('color').notNull(),
  sort_order: integer('sort_order').notNull(),
})

// Record of all submitted groceries; the source of truth for name and category.
export const groceries = sqliteTable(
  'groceries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    category: text('category')
      .notNull()
      .references(() => categories.type, { onUpdate: 'cascade', onDelete: 'restrict' }),
  },
  (t) => [uniqueIndex('groceries_name_unique').on(sql`lower(${t.name})`)],
)

export const shoppingList = sqliteTable('shopping_list', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  grocery_id: integer('grocery_id')
    .notNull()
    .references(() => groceries.id, { onDelete: 'cascade' }),
  user: text('user').notNull(),
})

export const recipes = sqliteTable('recipes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ingredients: text('ingredients', { mode: 'json' }).$type<number[]>().notNull(),
})
