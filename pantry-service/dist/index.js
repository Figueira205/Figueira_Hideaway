"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const pg_1 = require("pg");
const amqplib_1 = __importDefault(require("amqplib"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class PantryService {
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
        this.app.get('/pantry/stock', async (req, res) => {
            try {
                const result = await this.db.query('SELECT * FROM pantry_stock ORDER BY ingredient');
                res.json(result.rows);
            }
            catch (error) {
                console.error('Error fetching stock:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });
        this.app.get('/pantry/market_purchases', async (req, res) => {
            try {
                const result = await this.db.query('SELECT * FROM market_purchases ORDER BY purchase_date DESC');
                res.json(result.rows);
            }
            catch (error) {
                console.error('Error fetching purchases:', error);
                res.status(500).json({ error: 'Error interno del servidor' });
            }
        });
        this.app.get('/pantry/events/sse', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });
            res.write('data: {"type": "connected", "message": "Conectado al pantry service"}\n\n');
            this.sseClients.push(res);
            req.on('close', () => {
                this.sseClients = this.sseClients.filter(client => client !== res);
            });
        });
        this.app.get('/health', (req, res) => {
            res.json({ status: 'OK', service: 'pantry-service' });
        });
    }
    async handleIngredientRequest(message) {
        const { requestId, orderId, recipeSnapshot } = message;
        console.log(`Procesando solicitud de ingredientes para pedido ${orderId}:`, recipeSnapshot);
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const availableIngredients = {};
            let allIngredientsAvailable = true;
            for (const [ingredient, requiredQuantity] of Object.entries(recipeSnapshot)) {
                const stockResult = await client.query('SELECT * FROM pantry_stock WHERE ingredient = $1 FOR UPDATE', [ingredient]);
                let currentStock = 0;
                if (stockResult.rows.length > 0) {
                    currentStock = stockResult.rows[0].quantity;
                }
                if (currentStock < requiredQuantity) {
                    const neededQuantity = requiredQuantity - currentStock;
                    console.log(`Necesitamos comprar ${neededQuantity} unidades de ${ingredient}`);
                    const purchasedQuantity = await this.buyFromMarket(client, ingredient, neededQuantity);
                    currentStock += purchasedQuantity;
                    if (stockResult.rows.length > 0) {
                        await client.query('UPDATE pantry_stock SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE ingredient = $2', [currentStock, ingredient]);
                    }
                    else {
                        await client.query('INSERT INTO pantry_stock (ingredient, quantity) VALUES ($1, $2)', [ingredient, currentStock]);
                    }
                }
                if (currentStock >= requiredQuantity) {
                    availableIngredients[ingredient] = requiredQuantity;
                    await client.query('UPDATE pantry_stock SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE ingredient = $2', [requiredQuantity, ingredient]);
                }
                else {
                    allIngredientsAvailable = false;
                    console.log(`No se pudo obtener suficiente ${ingredient}. Requerido: ${requiredQuantity}, Disponible: ${currentStock}`);
                }
            }
            await client.query('COMMIT');
            this.broadcastStockUpdate();
            if (allIngredientsAvailable) {
                await this.notifyIngredientsReady(requestId, orderId, availableIngredients);
            }
            else {
                console.log(`No se pudieron obtener todos los ingredientes para el pedido ${orderId}`);
            }
        }
        catch (error) {
            await client.query('ROLLBACK');
            console.error('Error processing ingredient request:', error);
        }
        finally {
            client.release();
        }
    }
    async buyFromMarket(client, ingredient, quantity) {
        let totalPurchased = 0;
        let attempts = 0;
        const maxAttempts = 10;
        let backoffDelay = 1000;
        while (totalPurchased < quantity && attempts < maxAttempts) {
            try {
                console.log(`Intento ${attempts + 1} de compra: ${ingredient}, cantidad: ${quantity - totalPurchased}`);
                const response = await axios_1.default.get(`https://recruitment.alegra.com/api/farmers-market/buy?ingredient=${ingredient}`, { timeout: 10000 });
                const marketData = response.data;
                if (marketData.quantitySold > 0) {
                    const pricePerUnit = this.getIngredientPrice(ingredient);
                    const totalCost = marketData.quantitySold * pricePerUnit;
                    await client.query('INSERT INTO market_purchases (ingredient, quantity_requested, quantity_sold, price_per_unit, total_cost) VALUES ($1, $2, $3, $4, $5)', [
                        ingredient,
                        quantity - totalPurchased,
                        marketData.quantitySold,
                        pricePerUnit,
                        totalCost
                    ]);
                    totalPurchased += marketData.quantitySold;
                    console.log(`Compra exitosa: ${marketData.quantitySold} unidades de ${ingredient} a $${pricePerUnit} c/u`);
                    backoffDelay = 1000;
                }
                else {
                    console.log(`No hay stock disponible de ${ingredient} en el mercado`);
                }
            }
            catch (error) {
                console.error(`Error comprando ${ingredient}:`, error);
            }
            attempts++;
            if (totalPurchased < quantity && attempts < maxAttempts) {
                console.log(`Esperando ${backoffDelay}ms antes del siguiente intento...`);
                await this.sleep(backoffDelay);
                backoffDelay = Math.min(backoffDelay * 2, 60000);
            }
        }
        if (totalPurchased < quantity) {
            console.log(`Solo se pudieron comprar ${totalPurchased} de ${quantity} unidades de ${ingredient}`);
        }
        return totalPurchased;
    }
    async notifyIngredientsReady(requestId, orderId, availableIngredients) {
        if (!this.rabbitChannel) {
            throw new Error('RabbitMQ channel not available');
        }
        const message = {
            requestId,
            orderId,
            availableIngredients
        };
        await this.rabbitChannel.publish('restaurant', 'pantry.ingredient_ready', Buffer.from(JSON.stringify(message)));
        console.log(`Ingredientes listos notificados para pedido ${orderId}`);
    }
    async broadcastStockUpdate() {
        try {
            const result = await this.db.query('SELECT * FROM pantry_stock ORDER BY ingredient');
            const message = `data: ${JSON.stringify({
                type: 'stock_updated',
                stock: result.rows
            })}\n\n`;
            this.sseClients.forEach(client => {
                try {
                    client.write(message);
                }
                catch (error) {
                    console.error('Error sending SSE:', error);
                }
            });
        }
        catch (error) {
            console.error('Error broadcasting stock update:', error);
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    getIngredientPrice(ingredient) {
        const prices = {
            'potato': 1.50,
            'tomato': 2.00,
            'cheese': 4.50,
            'meat': 8.00,
            'rice': 1.20,
            'lemon': 0.80,
            'onion': 1.00,
            'garlic': 3.00,
            'pepper': 2.50,
            'salt': 0.50,
            'oil': 3.50,
            'bread': 2.20
        };
        return prices[ingredient.toLowerCase()] || 2.00;
    }
    async setupRabbitMQ() {
        try {
            this.rabbitConnection = await amqplib_1.default.connect(process.env.RABBITMQ_URL);
            this.rabbitChannel = await this.rabbitConnection.createChannel();
            await this.rabbitChannel.assertExchange('restaurant', 'topic', { durable: true });
            const queue = await this.rabbitChannel.assertQueue('pantry.ingredient_request', { durable: true });
            await this.rabbitChannel.bindQueue(queue.queue, 'restaurant', 'kitchen.ingredient_request');
            await this.rabbitChannel.consume(queue.queue, async (msg) => {
                if (msg) {
                    try {
                        const message = JSON.parse(msg.content.toString());
                        await this.handleIngredientRequest(message);
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
        const port = process.env.PORT || 4100;
        await this.setupRabbitMQ();
        this.app.listen(port, () => {
            console.log(`Pantry service running on port ${port}`);
        });
    }
}
const pantryService = new PantryService();
pantryService.start().catch(console.error);
process.on('SIGTERM', () => {
    console.log('Shutting down pantry service...');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('Shutting down pantry service...');
    process.exit(0);
});
//# sourceMappingURL=index.js.map