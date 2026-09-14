-- ============================================================
-- Esquema "api" expuesto por PostgREST
-- ============================================================
create schema if not exists api;

-- Rol anónimo: es con el que PostgREST atiende cada request por defecto.
-- En este proyecto lo dejamos con permisos amplios porque es un panel
-- interno; si esto va a producción con acceso público, después hay que
-- meter JWT + roles separados (lectura vs. escritura).
create role web_anon nologin;
grant usage on schema api to web_anon;

-- Rol autenticador: es el usuario con el que PostgREST se conecta a la DB
-- y que luego "cambia" al rol web_anon para ejecutar la consulta.
create role authenticator noinherit login password 'mysecretpassword';
grant web_anon to authenticator;

-- ============================================================
-- Tabla de platos
-- ============================================================
create table api.products (
  id       text primary key,
  category text not null check (category in ('pizza','noodles','drinks','desserts')),
  name     text not null,
  price    numeric(10,2) not null check (price > 0),
  sold     integer not null default 0,
  note     text,
  image    text,
  custom   boolean not null default false
);

grant select, insert, update, delete on api.products to web_anon;

-- ============================================================
-- Pedidos (opcional, para cuando quieras persistir también el carrito)
-- ============================================================
create table api.orders (
  id           bigserial primary key,
  table_number text,
  created_at   timestamptz not null default now(),
  status       text not null default 'open' check (status in ('open','paid','cancelled'))
);

create table api.order_items (
  id         bigserial primary key,
  order_id   bigint not null references api.orders(id) on delete cascade,
  product_id text not null references api.products(id),
  qty        integer not null check (qty > 0),
  unit_price numeric(10,2) not null
);

grant select, insert, update, delete on api.orders to web_anon;
grant select, insert, update, delete on api.order_items to web_anon;
grant usage, select on all sequences in schema api to web_anon;

-- ============================================================
-- Datos iniciales (los mismos que ya tenías en initialProducts)
-- ============================================================
insert into api.products (id, category, name, price, sold, note, custom) values
('p1',  'pizza',   'Pizza Margarita',        8.99,  14, null,          false),
('p2',  'pizza',   'Pizza Pepperoni',        10.49, 16, null,          false),
('p3',  'pizza',   'Pizza Cuatro Quesos',    11.99, 12, null,          false),
('p4',  'pizza',   'Pizza Hawaiana',         10.99, 10, null,          false),
('p5',  'pizza',   'Pizza Vegetariana',      9.99,  9,  'Sin carne',   false),
('p6',  'pizza',   'Pizza BBQ con Pollo',    12.49, 11, 'Salsa BBQ',   false),
('p7',  'pizza',   'Pizza Napolitana',       9.49,  8,  null,          false),
('p8',  'pizza',   'Pizza Suprema',          13.99, 13, null,          false),
('p9',  'noodles', 'Fideos con Pollo',       6.49,  8,  null,          false),
('p10', 'noodles', 'Ramen Picante',          7.20,  6,  null,          false),
('p11', 'noodles', 'Fideos con Vegetales',   5.80,  5,  null,          false),
('p12', 'drinks',  'Té Helado de Limón',     2.50,  14, null,          false),
('p13', 'drinks',  'Gaseosa de Naranja',     2.20,  12, null,          false),
('p14', 'drinks',  'Batido de Leche',        3.80,  10, null,          false),
('p15', 'desserts','Copa de Chocolate',      4.10,  7,  null,          false),
('p16', 'desserts','Tarta de Manzana',       4.60,  6,  null,          false);