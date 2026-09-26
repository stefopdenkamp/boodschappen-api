CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`color` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_type_unique` ON `categories` (`type`);--> statement-breakpoint
CREATE TABLE `groceries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	FOREIGN KEY (`category`) REFERENCES `categories`(`type`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groceries_name_unique` ON `groceries` (lower("name"));--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`ingredients` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shopping_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`grocery_id` integer NOT NULL,
	`user` text NOT NULL,
	FOREIGN KEY (`grocery_id`) REFERENCES `groceries`(`id`) ON UPDATE no action ON DELETE cascade
);
