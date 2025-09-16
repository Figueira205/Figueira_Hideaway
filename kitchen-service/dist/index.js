"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const pg_1 = require("pg");
const amqplib_1 = __importDefault(require("amqplib"));
const uuid_1 = require("uuid");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class KitchenService {
    constructor() {
        this.rabbitConnection = null;
        this.rabbitChannel = null;
        this.sseClients = [];
        this.app = (0, express_1.default)();
        this.db = new pg_1.Pool({
            connectionString: process.env.DATABASE_URL,
        });
        this.setupMiddleware();
        this.setupRoutes();
    }
    setupMiddleware() {
        this.app.use((0, cors_1.default)());
        this.app.use(express_1.default.json());
    }
    setupRoutes() {
        this.app.post('/orders', async (req, res) => {
            try {
                const { bulk = 1 } = req.body;
                const orderIds = [];
                for (let i = 0; i < bulk; i++) {
                    const orderId = await this.createOrder();
                    orderIds.push(orderId);
                }
                res.json({
                    success: true,
                    message: `${bulk} pedido(s) creado(s) exitosamente`,
                    orderIds
                });
            }
            catch (error) {
                console.error('Error creating orders:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });
        this.app.get('/orders', async (req, res) => {
            try {
                const result = await this.db.query('SELECT * FROM orders ORDER BY created_at DESC');
                res.json(result.rows);
            }
            catch (error) {
                console.error('Error fetching orders:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });
        this.app.get('/orders/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const result = await this.db.query('SELECT * FROM orders WHERE id = $1', [id]);
                if (result.rows.length === 0) {
                    return res.status(404).json({ error: 'Pedido no encontrado' });
                }
                return res.json(result.rows[0]);
            }
            catch (error) {
                console.error('Error fetching order:', error);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
        });
        this.app.get('/recipes', async (req, res) => {
            try {
                const result = await this.db.query('SELECT * FROM recipes');
                res.json(result.rows);
            }
            catch (error) {
                console.error('Error fetching recipes:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });
        this.app.get('/events/sse', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });
            res.write('data: {"type": "connected", "message": "Conectado al kitchen service"}\n\n');
            this.sseClients.push(res);
            req.on('close', () => {
                this.sseClients = this.sseClients.filter(client => client !== res);
            });
        });
        this.app.get('/health', (req, res) => {
            res.json({ status: 'OK', service: 'kitchen-service' });
        });
    }
    async createOrder() {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const recipeResult = await client.query('SELECT * FROM recipes ORDER BY RANDOM() LIMIT 1');
            if (recipeResult.rows.length === 0) {
                throw new Error('No hay recetas disponibles');
            }
            const recipe = recipeResult.rows[0];
            const orderResult = await client.query('INSERT INTO orders (recipe_id, recipe_snapshot, status) VALUES ($1, $2, $3) RETURNING id', [recipe.id, JSON.stringify(recipe.ingredients), 'pending']);
            const orderId = orderResult.rows[0].id;
            await this.logOrderEvent(client, orderId, 'order_created', {
                recipe_name: recipe.name,
                ingredients: recipe.ingredients
            });
            await client.query('COMMIT');
            await this.requestIngredients(orderId, recipe);
            this.broadcastSSE({
                type: 'order_created',
                orderId,
                recipe: recipe.name,
                status: 'pending'
            });
            return orderId;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async requestIngredients(orderId, recipe) {
        if (!this.rabbitChannel) {
            throw new Error('RabbitMQ channel not available');
        }
        const requestId = (0, uuid_1.v4)();
        const message = {
            requestId,
            orderId,
            recipeSnapshot: recipe.ingredients
        };
        await this.rabbitChannel.publish('restaurant', 'kitchen.ingredient_request', Buffer.from(JSON.stringify(message)));
        console.log(`Ingredientes solicitados para pedido ${orderId}:`, recipe.ingredients);
    }
    async handleIngredientReady(message) {
        const { requestId, orderId, availableIngredients } = message;
        console.log(`Ingredientes listos para pedido ${orderId}`);
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['preparing', orderId]);
            await this.logOrderEvent(client, orderId, 'ingredients_ready', {
                requestId,
                availableIngredients
            });
            await client.query('COMMIT');
            this.broadcastSSE({
                type: 'order_preparing',
                orderId,
                status: 'preparing'
            });
            await this.simulateCooking(orderId, availableIngredients);
        }
        catch (error) {
            await client.query('ROLLBACK');
            console.error('Error handling ingredient ready:', error);
        }
        finally {
            client.release();
        }
    }
    async simulateCooking(orderId, ingredients) {
        const totalIngredients = Object.values(ingredients).reduce((sum, qty) => sum + qty, 0);
        const cookingTime = totalIngredients * 200;
        console.log(`Cocinando pedido ${orderId} por ${cookingTime}ms`);
        setTimeout(async () => {
            await this.completeOrder(orderId);
        }, cookingTime);
    }
    async completeOrder(orderId) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['completed', orderId]);
            await this.logOrderEvent(client, orderId, 'order_completed', {
                completed_at: new Date().toISOString()
            });
            await client.query('COMMIT');
            this.broadcastSSE({
                type: 'order_completed',
                orderId,
                status: 'completed'
            });
            console.log(`Pedido ${orderId} completado y entregado`);
        }
        catch (error) {
            await client.query('ROLLBACK');
            console.error('Error completing order:', error);
        }
        finally {
            client.release();
        }
    }
    async logOrderEvent(client, orderId, eventType, eventData) {
        await client.query('INSERT INTO order_events (order_id, event_type, event_data) VALUES ($1, $2, $3)', [orderId, eventType, JSON.stringify(eventData)]);
    }
    broadcastSSE(data) {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        this.sseClients.forEach(client => {
            try {
                client.write(message);
            }
            catch (error) {
                console.error('Error sending SSE:', error);
            }
        });
    }
    async setupRabbitMQ() {
        try {
            this.rabbitConnection = await amqplib_1.default.connect(process.env.RABBITMQ_URL);
            this.rabbitChannel = await this.rabbitConnection.createChannel();
            await this.rabbitChannel.assertExchange('restaurant', 'topic', { durable: true });
            const queue = await this.rabbitChannel.assertQueue('kitchen.ingredient_ready', { durable: true });
            await this.rabbitChannel.bindQueue(queue.queue, 'restaurant', 'pantry.ingredient_ready');
            await this.rabbitChannel.consume(queue.queue, async (msg) => {
                if (msg) {
                    try {
                        const message = JSON.parse(msg.content.toString());
                        await this.handleIngredientReady(message);
                        this.rabbitChannel?.ack(msg);
                    }
                    catch (error) {
                        console.error('Error processing message:', error);
                        this.rabbitChannel?.nack(msg, false, false);
                    }
                }
            });
            console.log('RabbitMQ conectado y configurado');
        }
        catch (error) {
            console.error('Error connecting to RabbitMQ:', error);
            setTimeout(() => this.setupRabbitMQ(), 5000);
        }
    }
    async start() {
        const port = process.env.PORT || 4000;
        await this.setupRabbitMQ();
        this.app.listen(port, () => {
            console.log(`Kitchen service running on port ${port}`);
        });
    }
}
const kitchenService = new KitchenService();
kitchenService.start().catch(console.error);
process.on('SIGTERM', () => {
    console.log('Shutting down kitchen service...');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('Shutting down kitchen service...');
    process.exit(0);
});
//# sourceMappingURL=index.js.map