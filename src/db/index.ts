import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { categories } from './schema'

const sqlite = new Database(process.env.DB_FILE_NAME!)
sqlite.run('PRAGMA foreign_keys = ON')

export const db = drizzle(sqlite)

migrate(db, { migrationsFolder: `${import.meta.dir}/../../drizzle` })

const defaultCategories = [
  'fruits', 'vegetable', 'beans_and_seeds', 'grains', 'condiments',
  'dairy', 'snacks', 'drinks', 'frozen', 'herbs_and_spices',
]

if (db.select().from(categories).all().length === 0) {
  db.insert(categories)
    .values(defaultCategories.map((type, i) => ({ type, color: '#9e9e9e', sort_order: i + 1 })))
    .run()
}
