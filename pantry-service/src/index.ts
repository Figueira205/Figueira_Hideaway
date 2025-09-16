/**
 * Pantry Service - Figueira's Hideaway Restaurant Management System
 * 
 * @author Figueira <figueira205@proton.me>
 * @description Microservicio de despensa para gestión de inventario y compras automáticas
 */

import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import amqp from 'amqplib';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface PantryStock {
  id: number;
  ingredient: string;
  quantity: number;
  updated_at: string;
}

interface MarketPurchase {
  id: number;
  ingredient: string;
  quantity_requested: number;
  quantity_sold: number;
  price_per_unit: number;
  total_cost: number;
  purchase_date: string;
}

interface IngredientRequest {
  requestId: string;
  orderId: number;
  recipeSnapshot: Record<string, number>;
}

interface MarketResponse {
  quantitySold: number;
}

class PantryService {
  private app: express.Application;
  private db: Pool;
  private rabbitConnection: any = null;
  private rabbitChannel: any = null;
  private sseClients: express.Response[] = [];

  constructor() {
    this.app = express();
    this.db = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Obtener stock actual
    this.app.get('/pantry/stock', async (req, res) => {
      try {
        const result = await this.db.query(
          'SELECT * FROM pantry_stock ORDER BY ingredient'
        );
        return res.json(result.rows);
      } catch (error) {
        console.error('Error fetching stock:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener historial de compras
    this.app.get('/pantry/market_purchases', async (req, res) => {
      try {
        const result = await this.db.query(
          'SELECT * FROM market_purchases ORDER BY purchase_date DESC'
        );
        res.json(result.rows);
      } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener compras por fecha específica
    this.app.get('/pantry/market_purchases/by-date/:date', async (req, res) => {
      try {
        const { date } = req.params;
        
        // Validar formato de fecha (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
          return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
        }

        const result = await this.db.query(
          `SELECT * FROM market_purchases 
           WHERE DATE(purchase_date) = $1 
           ORDER BY purchase_date DESC`,
          [date]
        );
        
        // Calcular totales
        const totalSpent = result.rows.reduce((sum, purchase) => {
          return sum + parseFloat(purchase.total_cost);
        }, 0);
        
        const purchasesByIngredient = result.rows.reduce((acc, purchase) => {
          if (!acc[purchase.ingredient]) {
            acc[purchase.ingredient] = {
              ingredient: purchase.ingredient,
              total_quantity: 0,
              total_cost: 0,
              purchases: []
            };
          }
          acc[purchase.ingredient].total_quantity += parseInt(purchase.quantity_sold);
          acc[purchase.ingredient].total_cost += parseFloat(purchase.total_cost);
          acc[purchase.ingredient].purchases.push(purchase);
          return acc;
        }, {});
        
        const summary = {
          date,
          total_purchases: result.rows.length,
          total_spent: parseFloat(totalSpent.toFixed(2)),
          purchases_by_ingredient: Object.values(purchasesByIngredient),
          all_purchases: result.rows
        };
        
        return res.json(summary);
      } catch (error) {
        console.error('Error fetching purchases by date:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener resumen de fechas con compras
    this.app.get('/pantry/market_purchases/available-dates', async (req, res) => {
      try {
        const result = await this.db.query(
          `SELECT DATE(purchase_date) as date, 
                  COUNT(*) as purchase_count,
                  SUM(price_per_unit::numeric * quantity_sold::numeric) as total_spent
           FROM market_purchases 
           GROUP BY DATE(purchase_date) 
           ORDER BY date DESC 
           LIMIT 30`
        );
        
        // Formatear los resultados
        const formattedResults = result.rows.map(row => ({
          date: row.date,
          purchase_count: parseInt(row.purchase_count),
          total_spent: parseFloat(parseFloat(row.total_spent).toFixed(2))
        }));
        
        res.json(formattedResults);
      } catch (error) {
        console.error('Error fetching available purchase dates:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Endpoint para limpiar/reiniciar datos de compras
    this.app.delete('/pantry/market_purchases/reset', async (req, res) => {
      try {
        const { confirm } = req.body;
        
        if (confirm !== 'RESET_ALL_PURCHASES') {
          return res.status(400).json({ 
            error: 'Confirmación requerida. Envía { "confirm": "RESET_ALL_PURCHASES" } para confirmar.' 
          });
        }

        // Eliminar todas las compras
        const result = await this.db.query('DELETE FROM market_purchases');
        
        return res.json({ 
          message: 'Todas las compras han sido eliminadas exitosamente',
          purchases_deleted: result.rowCount || 0,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error resetting market purchases:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Endpoint para limpiar compras por rango de fechas
    this.app.delete('/pantry/market_purchases/reset/date-range', async (req, res) => {
      try {
        const { start_date, end_date, confirm } = req.body;
        
        if (!start_date || !end_date) {
          return res.status(400).json({ 
            error: 'Se requieren start_date y end_date en formato YYYY-MM-DD' 
          });
        }

        if (confirm !== 'DELETE_PURCHASES_DATE_RANGE') {
          return res.status(400).json({ 
            error: 'Confirmación requerida. Envía { "confirm": "DELETE_PURCHASES_DATE_RANGE" } para confirmar.' 
          });
        }

        // Validar fechas
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({ error: 'Formato de fecha inválido' });
        }

        if (startDate > endDate) {
          return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' });
        }

        // Contar compras a eliminar
        const countQuery = `
          SELECT COUNT(*) as count 
          FROM market_purchases 
          WHERE DATE(purchase_date) BETWEEN $1 AND $2
        `;
        
        const countResult = await this.db.query(countQuery, [start_date, end_date]);
        const purchasesToDelete = countResult.rows[0]?.count || 0;

        // Eliminar compras en el rango de fechas
        const deleteQuery = `
          DELETE FROM market_purchases 
          WHERE DATE(purchase_date) BETWEEN $1 AND $2
        `;
        
        await this.db.query(deleteQuery, [start_date, end_date]);

        return res.json({ 
          message: `${purchasesToDelete} compras eliminadas exitosamente`,
          date_range: { start_date, end_date },
          purchases_deleted: parseInt(purchasesToDelete),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error resetting purchases by date range:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Endpoint para reiniciar inventario (limpiar stock)
    this.app.delete('/pantry/stock/reset', async (req, res) => {
      try {
        const { confirm } = req.body;
        
        if (confirm !== 'RESET_ALL_STOCK') {
          return res.status(400).json({ 
            error: 'Confirmación requerida. Envía { "confirm": "RESET_ALL_STOCK" } para confirmar.' 
          });
        }

        // Eliminar todo el inventario
        const result = await this.db.query('DELETE FROM pantry_stock');
        
        return res.json({ 
          message: 'Todo el inventario ha sido eliminado exitosamente',
          items_deleted: result.rowCount || 0,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error resetting pantry stock:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Server-Sent Events para actualizaciones de stock
    this.app.get('/pantry/events/sse', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      // Enviar evento inicial
      res.write('data: {"type": "connected", "message": "Conectado al pantry service"}\n\n');

      // Agregar cliente a la lista
      this.sseClients.push(res);

      // Limpiar cuando se desconecta
      req.on('close', () => {
        this.sseClients = this.sseClients.filter(client => client !== res);
      });
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'OK', service: 'pantry-service' });
    });
  }

  private async handleIngredientRequest(message: IngredientRequest): Promise<void> {
    const { requestId, orderId, recipeSnapshot } = message;
    
    console.log(`Procesando solicitud de ingredientes para pedido ${orderId}:`, recipeSnapshot);
    
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // FASE 1: Verificar y obtener TODOS los ingredientes necesarios
      const ingredientStocks: Record<string, { current: number, required: number, stockId?: number }> = {};
      let allIngredientsObtainable = true;
      
      // Primero verificamos y compramos lo necesario SIN consumir nada
      for (const [ingredient, requiredQuantity] of Object.entries(recipeSnapshot)) {
        // Verificar stock actual con SELECT FOR UPDATE
        const stockResult = await client.query(
          'SELECT * FROM pantry_stock WHERE ingredient = $1 FOR UPDATE',
          [ingredient]
        );
        
        let currentStock = 0;
        let stockId = null;
        if (stockResult.rows.length > 0) {
          currentStock = stockResult.rows[0].quantity;
          stockId = stockResult.rows[0].id;
        }
        
        // Si no hay suficiente stock, intentar comprar en el mercado
        if (currentStock < requiredQuantity) {
          const neededQuantity = requiredQuantity - currentStock;
          console.log(`Necesitamos comprar ${neededQuantity} unidades de ${ingredient}`);
          
          const purchasedQuantity = await this.buyFromMarket(client, ingredient, neededQuantity);
          currentStock += purchasedQuantity;
          
          // Actualizar stock en base de datos
          if (stockResult.rows.length > 0) {
            await client.query(
              'UPDATE pantry_stock SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE ingredient = $2',
              [currentStock, ingredient]
            );
          } else {
            const insertResult = await client.query(
              'INSERT INTO pantry_stock (ingredient, quantity) VALUES ($1, $2) RETURNING id',
              [ingredient, currentStock]
            );
            stockId = insertResult.rows[0].id;
          }
        }
        
        // Registrar el estado de este ingrediente
        ingredientStocks[ingredient] = {
          current: currentStock,
          required: requiredQuantity as number,
          stockId
        };
        
        // Verificar si tenemos suficiente DESPUÉS de las compras
        if (currentStock < requiredQuantity) {
          allIngredientsObtainable = false;
          console.log(`FALTA INGREDIENTE: ${ingredient}. Requerido: ${requiredQuantity}, Disponible: ${currentStock}`);
        }
      }
      
      // FASE 2: Solo si TODOS los ingredientes están disponibles, consumirlos
      if (allIngredientsObtainable) {
        const availableIngredients: Record<string, number> = {};
        
        // Ahora sí decrementamos el stock de TODOS los ingredientes
        for (const [ingredient, stockInfo] of Object.entries(ingredientStocks)) {
          await client.query(
            'UPDATE pantry_stock SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE ingredient = $2',
            [stockInfo.required, ingredient]
          );
          
          availableIngredients[ingredient] = stockInfo.required;
          console.log(`✅ Consumido: ${stockInfo.required} unidades de ${ingredient}`);
        }
        
        await client.query('COMMIT');
        
        // Emitir evento SSE de actualización de stock
        this.broadcastStockUpdate();
        
        // Notificar a kitchen que todos los ingredientes están listos
        await this.notifyIngredientsReady(requestId, orderId, availableIngredients);
        
        // Limpiar reintentos ya que el pedido se completó exitosamente
        this.retryAttempts.delete(orderId);
        
        console.log(`✅ PEDIDO ${orderId}: Todos los ingredientes disponibles y consumidos`);
        
      } else {
        // Si no tenemos todos los ingredientes, hacer ROLLBACK
        await client.query('ROLLBACK');
        
        console.log(`❌ PEDIDO ${orderId}: No se pudieron obtener TODOS los ingredientes necesarios`);
        
        // Actualizar estado del pedido a 'waiting_ingredients'
        await this.updateOrderStatus(orderId, 'waiting_ingredients');
        
        // Programar reintento del pedido
        await this.scheduleIngredientRetry(requestId, orderId, recipeSnapshot);
      }
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error processing ingredient request:', error);
      
      // En caso de error, también programar reintento
      await this.scheduleIngredientRetry(requestId, orderId, recipeSnapshot);
    } finally {
      client.release();
    }
  }

  private async updateOrderStatus(orderId: number, status: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query(
        'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [status, orderId]
      );
      console.log(`📝 Pedido ${orderId} actualizado a estado: ${status}`);
    } catch (error) {
      console.error('Error updating order status:', error);
    } finally {
      client.release();
    }
  }

  private retryAttempts: Map<number, number> = new Map();
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly RETRY_DELAYS = [30000, 60000, 120000, 300000, 600000]; // 30s, 1m, 2m, 5m, 10m

  private async scheduleIngredientRetry(requestId: string, orderId: number, recipeSnapshot: Record<string, number>): Promise<void> {
    const currentAttempts = this.retryAttempts.get(orderId) || 0;
    
    if (currentAttempts >= this.MAX_RETRY_ATTEMPTS) {
      console.log(`❌ PEDIDO ${orderId}: Máximo de reintentos alcanzado. Cancelando pedido.`);
      await this.updateOrderStatus(orderId, 'cancelled');
      this.retryAttempts.delete(orderId);
      return;
    }
    
    const nextAttempt = currentAttempts + 1;
    const delay = this.RETRY_DELAYS[currentAttempts] || 600000; // Default 10 minutos
    
    this.retryAttempts.set(orderId, nextAttempt);
    
    console.log(`⏰ PEDIDO ${orderId}: Programando reintento ${nextAttempt}/${this.MAX_RETRY_ATTEMPTS} en ${delay/1000} segundos`);
    
    setTimeout(async () => {
      console.log(`🔄 PEDIDO ${orderId}: Ejecutando reintento ${nextAttempt}/${this.MAX_RETRY_ATTEMPTS}`);
      await this.handleIngredientRequest({ requestId, orderId, recipeSnapshot });
    }, delay);
  }

  private async buyFromMarket(client: any, ingredient: string, quantity: number): Promise<number> {
    let totalPurchased = 0;
    let attempts = 0;
    let backoffDelay = 1000; // Empezar con 1 segundo
    
    while (totalPurchased < quantity) {
      try {
        console.log(`Intento ${attempts + 1} de compra: ${ingredient}, cantidad: ${quantity - totalPurchased}`);
        
        const response = await axios.get(
          `https://recruitment.alegra.com/api/farmers-market/buy?ingredient=${ingredient}`,
          { timeout: 10000 }
        );
        
        const marketData: MarketResponse = response.data;
        
        if (marketData.quantitySold > 0) {
          // La API no devuelve precio, usar precio simulado basado en ingrediente
          const pricePerUnit = this.getIngredientPrice(ingredient);
          const totalCost = marketData.quantitySold * pricePerUnit;
          
          // Registrar compra exitosa
          await client.query(
            'INSERT INTO market_purchases (ingredient, quantity_requested, quantity_sold, price_per_unit, total_cost) VALUES ($1, $2, $3, $4, $5)',
            [
              ingredient,
              quantity - totalPurchased,
              marketData.quantitySold,
              pricePerUnit,
              totalCost
            ]
          );
          
          // Notificar nueva compra via SSE
          console.log('Enviando notificación SSE de nueva compra...');
          await this.broadcastMarketPurchaseUpdate(ingredient, marketData.quantitySold, pricePerUnit);
          
          totalPurchased += marketData.quantitySold;
          console.log(`Compra exitosa: ${marketData.quantitySold} unidades de ${ingredient} a $${pricePerUnit} c/u`);
          
          // Resetear backoff en compra exitosa
          backoffDelay = 1000;
        } else {
          console.log(`No hay stock disponible de ${ingredient} en el mercado`);
        }
        
      } catch (error) {
        console.error(`Error comprando ${ingredient}:`, error);
      }
      
      attempts++;
      
      // Si no hemos conseguido todo, esperar antes del siguiente intento
      if (totalPurchased < quantity) {
        console.log(`Esperando ${backoffDelay}ms antes del siguiente intento...`);
        await this.sleep(backoffDelay);
        
        // Backoff exponencial hasta 60 segundos, luego mantener 60s
        backoffDelay = Math.min(backoffDelay * 2, 60000);
      }
    }
    
    if (totalPurchased < quantity) {
      console.log(`Solo se pudieron comprar ${totalPurchased} de ${quantity} unidades de ${ingredient}`);
    }
    
    return totalPurchased;
  }

  private async notifyIngredientsReady(requestId: string, orderId: number, availableIngredients: Record<string, number>): Promise<void> {
    if (!this.rabbitChannel) {
      throw new Error('RabbitMQ channel not available');
    }

    const message = {
      requestId,
      orderId,
      availableIngredients
    };

    await this.rabbitChannel.publish(
      'restaurant',
      'pantry.ingredient_ready',
      Buffer.from(JSON.stringify(message))
    );

    console.log(`Ingredientes listos notificados para pedido ${orderId}`);
  }

  private async broadcastStockUpdate(): Promise<void> {
    try {
      const result = await this.db.query('SELECT * FROM pantry_stock ORDER BY ingredient');
      
      const message = `data: ${JSON.stringify({
        type: 'stock_updated',
        stock: result.rows
      })}\n\n`;
      
      this.sseClients.forEach(client => {
        try {
          client.write(message);
        } catch (error) {
          console.error('Error sending SSE:', error);
        }
      });
    } catch (error) {
      console.error('Error broadcasting stock update:', error);
    }
  }

  private async broadcastMarketPurchaseUpdate(ingredient?: string, quantitySold?: number, pricePerUnit?: number): Promise<void> {
    try {
      console.log(`Enviando actualización de compras a ${this.sseClients.length} clientes SSE`);
      const result = await this.db.query('SELECT * FROM market_purchases ORDER BY purchase_date DESC');
      
      // Crear mensaje con información específica de la compra si está disponible
      let purchaseMessage = 'Nueva compra registrada en el mercado';
      if (ingredient && quantitySold && pricePerUnit) {
        purchaseMessage = `Nueva compra registrada en mercado: ${quantitySold} unidades de ${ingredient}`;
      }
      
      const message = `data: ${JSON.stringify({
        type: 'market_purchase_updated',
        purchases: result.rows,
        lastPurchase: ingredient && quantitySold ? {
          ingredient_name: ingredient,
          quantity: quantitySold,
          pricePerUnit: pricePerUnit || 0
        } : null
      })}\n\n`;
      
      this.sseClients.forEach(client => {
        try {
          client.write(message);
        } catch (error) {
          console.error('Error sending market purchase SSE:', error);
        }
      });
      console.log('Actualización de compras enviada exitosamente');
    } catch (error) {
      console.error('Error broadcasting market purchase update:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getIngredientPrice(ingredient: string): number {
    // Precios simulados por ingrediente (en unidades monetarias)
    const prices: Record<string, number> = {
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
    
    return prices[ingredient.toLowerCase()] || 2.00; // Precio por defecto
  }

  private async setupRabbitMQ(): Promise<void> {
    try {
      this.rabbitConnection = await amqp.connect(process.env.RABBITMQ_URL!);
      this.rabbitChannel = await this.rabbitConnection.createChannel();
      
      // Declarar exchange
      await this.rabbitChannel.assertExchange('restaurant', 'topic', { durable: true });
      
      // Declarar cola para recibir solicitudes de kitchen
      const queue = await this.rabbitChannel.assertQueue('pantry.ingredient_request', { durable: true });
      
      // Bind cola al exchange
      await this.rabbitChannel.bindQueue(queue.queue, 'restaurant', 'kitchen.ingredient_request');
      
      // Consumir mensajes
      await this.rabbitChannel.consume(queue.queue, async (msg: any) => {
        if (msg) {
          try {
            const message: IngredientRequest = JSON.parse(msg.content.toString());
            await this.handleIngredientRequest(message);
            this.rabbitChannel?.ack(msg);
          } catch (error) {
            console.error('Error processing message:', error);
            this.rabbitChannel?.nack(msg, false, false);
          }
        }
      });
      
      console.log('RabbitMQ conectado y configurado');
    } catch (error) {
      console.error('Error connecting to RabbitMQ:', error);
      setTimeout(() => this.setupRabbitMQ(), 5000);
    }
  }

  public async start(): Promise<void> {
    const port = process.env.PORT || 4100;
    
    // Configurar RabbitMQ
    await this.setupRabbitMQ();
    
    this.app.listen(port, () => {
      console.log(`Pantry service running on port ${port}`);
    });
  }
}

// Iniciar servicio
const pantryService = new PantryService();
pantryService.start().catch(console.error);

// Manejo de señales para cierre limpio
process.on('SIGTERM', () => {
  console.log('Shutting down pantry service...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down pantry service...');
  process.exit(0);
});