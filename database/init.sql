-- Crear las tablas principales
CREATE TABLE IF NOT EXISTS recipes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ingredients JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    recipe_id INTEGER REFERENCES recipes(id),
    recipe_snapshot JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'waiting_ingredients', 'preparing', 'completed', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_events (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pantry_stock (
    id SERIAL PRIMARY KEY,
    ingredient VARCHAR(100) UNIQUE NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS market_purchases (
    id SERIAL PRIMARY KEY,
    ingredient VARCHAR(100) NOT NULL,
    quantity_requested INTEGER NOT NULL,
    quantity_sold INTEGER NOT NULL,
    price_per_unit DECIMAL(10,2),
    total_cost DECIMAL(10,2),
    purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_events_order_id ON order_events(order_id);
CREATE INDEX idx_pantry_stock_ingredient ON pantry_stock(ingredient);
CREATE INDEX idx_market_purchases_ingredient ON market_purchases(ingredient);

-- Función para actualizar timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para actualizar timestamps
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pantry_stock_updated_at BEFORE UPDATE ON pantry_stock
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insertar stock inicial (5 unidades de cada ingrediente)
INSERT INTO pantry_stock (ingredient, quantity) VALUES
    ('tomato', 5),
    ('lemon', 5),
    ('potato', 5),
    ('rice', 5),
    ('ketchup', 5),
    ('lettuce', 5),
    ('onion', 5),
    ('cheese', 5),
    ('meat', 5),
    ('chicken', 5)
ON CONFLICT (ingredient) DO NOTHING;

-- Insertar las 6 recetas
INSERT INTO recipes (name, ingredients) VALUES
    ('Ensalada Mediterránea', '{"tomato": 2, "lettuce": 1, "onion": 1, "cheese": 1}'),
    ('Pollo al Limón', '{"chicken": 2, "lemon": 1, "rice": 1}'),
    ('Papas con Carne', '{"potato": 3, "meat": 2, "onion": 1}'),
    ('Arroz con Pollo y Tomate', '{"rice": 2, "chicken": 1, "tomato": 1}'),
    ('Tapa de Queso y Ketchup', '{"cheese": 2, "ketchup": 1, "potato": 1}'),
    ('Plato Criollo', '{"meat": 1, "rice": 1, "lemon": 1, "onion": 1}')
ON CONFLICT DO NOTHING;

-- Base de datos inicializada correctamente
-- Los eventos se crearán automáticamente cuando se procesen pedidos