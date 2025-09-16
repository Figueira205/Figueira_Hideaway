/**
 * Kitchen Service - Figueira's Hideaway Restaurant Management System
 * 
 * @author Figueira <figueira205@proton.me>
 * @description Microservicio de cocina para gestión de pedidos y preparación de platos
 */

import express from 'express';
import { Pool } from 'pg';
import amqp from 'amqplib';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

interface Recipe {
  id: number;
  name: string;
  ingredients: Record<string, number>;
}

interface Order {
  id: number;
  recipe_id: number;
  recipe_snapshot: Record<string, number>;
  status: string;
  created_at: string;
  updated_at: string;
}

interface OrderEvent {
  id: number;
  order_id: number;
  event_type: string;
  event_data: any;
  created_at: string;
}

class KitchenService {
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
    // Crear pedidos (individual o masivo)
    this.app.post('/orders', async (req, res) => {
      try {
        const { bulk = 1 } = req.body;
        const orderIds: number[] = [];

        for (let i = 0; i < bulk; i++) {
          const orderId = await this.createOrder();
          orderIds.push(orderId);
        }

        res.json({ 
          success: true, 
          message: `${bulk} pedido(s) creado(s) exitosamente`,
          orderIds 
        });
      } catch (error) {
        console.error('Error creating orders:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener todos los pedidos
    this.app.get('/orders', async (req, res) => {
      try {
        const result = await this.db.query(
          'SELECT * FROM orders ORDER BY created_at DESC'
        );
        res.json(result.rows);
      } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener pedido específico
    this.app.get('/orders/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const result = await this.db.query(
          'SELECT * FROM orders WHERE id = $1',
          [id]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        
        return res.json(result.rows[0]);
      } catch (error) {
        console.error('Error fetching order:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener recetas
    this.app.get('/recipes', async (req, res) => {
      try {
        const result = await this.db.query('SELECT * FROM recipes ORDER BY id');
        res.json(result.rows);
      } catch (error) {
        console.error('Error fetching recipes:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener receta específica
    this.app.get('/recipes/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const result = await this.db.query('SELECT * FROM recipes WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Receta no encontrada' });
        }
        
        return res.json(result.rows[0]);
      } catch (error) {
        console.error('Error fetching recipe:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Crear nueva receta
    this.app.post('/recipes', async (req, res) => {
      try {
        const { name, ingredients } = req.body;
        
        // Validaciones básicas
        if (!name || !ingredients) {
          return res.status(400).json({ error: 'Nombre e ingredientes son requeridos' });
        }
        
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'El nombre debe ser una cadena no vacía' });
        }
        
        if (typeof ingredients !== 'object' || Array.isArray(ingredients)) {
          return res.status(400).json({ error: 'Los ingredientes deben ser un objeto' });
        }
        
        // Validar que todos los ingredientes sean válidos
        const validIngredients = ['tomato', 'lemon', 'potato', 'rice', 'ketchup', 'lettuce', 'onion', 'cheese', 'meat', 'chicken'];
        const recipeIngredients = Object.keys(ingredients);
        
        for (const ingredient of recipeIngredients) {
          if (!validIngredients.includes(ingredient)) {
            return res.status(400).json({ error: `Ingrediente no válido: ${ingredient}. Ingredientes disponibles: ${validIngredients.join(', ')}` });
          }
          
          const quantity = ingredients[ingredient];
          if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ error: `La cantidad para ${ingredient} debe ser un número entero positivo` });
          }
        }
        
        if (recipeIngredients.length === 0) {
          return res.status(400).json({ error: 'La receta debe tener al menos un ingrediente' });
        }
        
        // Verificar que no exista una receta con el mismo nombre
        const existingRecipe = await this.db.query('SELECT id FROM recipes WHERE LOWER(name) = LOWER($1)', [name.trim()]);
        if (existingRecipe.rows.length > 0) {
          return res.status(409).json({ error: 'Ya existe una receta con ese nombre' });
        }
        
        // Crear la receta
        const result = await this.db.query(
          'INSERT INTO recipes (name, ingredients) VALUES ($1, $2) RETURNING *',
          [name.trim(), JSON.stringify(ingredients)]
        );
        
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error('Error creating recipe:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Actualizar receta existente
    this.app.put('/recipes/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { name, ingredients } = req.body;
        
        // Verificar que la receta existe
        const existingRecipe = await this.db.query('SELECT * FROM recipes WHERE id = $1', [id]);
        if (existingRecipe.rows.length === 0) {
          return res.status(404).json({ error: 'Receta no encontrada' });
        }
        
        // Validaciones básicas
        if (!name || !ingredients) {
          return res.status(400).json({ error: 'Nombre e ingredientes son requeridos' });
        }
        
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'El nombre debe ser una cadena no vacía' });
        }
        
        if (typeof ingredients !== 'object' || Array.isArray(ingredients)) {
          return res.status(400).json({ error: 'Los ingredientes deben ser un objeto' });
        }
        
        // Validar que todos los ingredientes sean válidos
        const validIngredients = ['tomato', 'lemon', 'potato', 'rice', 'ketchup', 'lettuce', 'onion', 'cheese', 'meat', 'chicken'];
        const recipeIngredients = Object.keys(ingredients);
        
        for (const ingredient of recipeIngredients) {
          if (!validIngredients.includes(ingredient)) {
            return res.status(400).json({ error: `Ingrediente no válido: ${ingredient}. Ingredientes disponibles: ${validIngredients.join(', ')}` });
          }
          
          const quantity = ingredients[ingredient];
          if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ error: `La cantidad para ${ingredient} debe ser un número entero positivo` });
          }
        }
        
        if (recipeIngredients.length === 0) {
          return res.status(400).json({ error: 'La receta debe tener al menos un ingrediente' });
        }
        
        // Verificar que no exista otra receta con el mismo nombre (excluyendo la actual)
        const duplicateRecipe = await this.db.query('SELECT id FROM recipes WHERE LOWER(name) = LOWER($1) AND id != $2', [name.trim(), id]);
        if (duplicateRecipe.rows.length > 0) {
          return res.status(409).json({ error: 'Ya existe otra receta con ese nombre' });
        }
        
        // Actualizar la receta
        const result = await this.db.query(
          'UPDATE recipes SET name = $1, ingredients = $2 WHERE id = $3 RETURNING *',
          [name.trim(), JSON.stringify(ingredients), id]
        );
        
        return res.json(result.rows[0]);
      } catch (error) {
        console.error('Error updating recipe:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Eliminar receta
    this.app.delete('/recipes/:id', async (req, res) => {
      try {
        const { id } = req.params;
        
        // Verificar que la receta existe
        const existingRecipe = await this.db.query('SELECT * FROM recipes WHERE id = $1', [id]);
        if (existingRecipe.rows.length === 0) {
          return res.status(404).json({ error: 'Receta no encontrada' });
        }
        
        // Verificar si hay pedidos que usan esta receta
        const ordersUsingRecipe = await this.db.query('SELECT COUNT(*) as count FROM orders WHERE recipe_id = $1', [id]);
        const orderCount = parseInt(ordersUsingRecipe.rows[0].count);
        
        if (orderCount > 0) {
          return res.status(409).json({ 
            error: `No se puede eliminar la receta porque tiene ${orderCount} pedido(s) asociado(s)`,
            orders_count: orderCount
          });
        }
        
        // Eliminar la receta
        await this.db.query('DELETE FROM recipes WHERE id = $1', [id]);
        
        return res.json({ 
          message: 'Receta eliminada exitosamente',
          deleted_recipe: existingRecipe.rows[0]
        });
      } catch (error) {
        console.error('Error deleting recipe:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener ingredientes disponibles
    this.app.get('/ingredients', async (req, res) => {
      try {
        const validIngredients = ['tomato', 'lemon', 'potato', 'rice', 'ketchup', 'lettuce', 'onion', 'cheese', 'meat', 'chicken'];
        return res.json({ ingredients: validIngredients });
      } catch (error) {
        console.error('Error fetching ingredients:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener pedidos por fecha específica
    this.app.get('/orders/by-date/:date', async (req, res) => {
      try {
        const { date } = req.params;
        
        // Validar formato de fecha (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
          return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
        }

        const result = await this.db.query(
          `SELECT o.*, r.name as recipe_name, r.ingredients 
           FROM orders o 
           JOIN recipes r ON o.recipe_id = r.id 
           WHERE DATE(o.created_at) = $1 
           ORDER BY o.id DESC`,
          [date]
        );
        
        const summary = {
          date,
          total_orders: result.rows.length,
          orders_by_status: {
            pending: result.rows.filter(o => o.status === 'pending').length,
            waiting_ingredients: result.rows.filter(o => o.status === 'waiting_ingredients').length,
            preparing: result.rows.filter(o => o.status === 'preparing').length,
            completed: result.rows.filter(o => o.status === 'completed').length,
            cancelled: result.rows.filter(o => o.status === 'cancelled').length
          },
          orders: result.rows
        };
        
        return res.json(summary);
      } catch (error) {
        console.error('Error fetching orders by date:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Obtener resumen de fechas disponibles
    this.app.get('/orders/available-dates', async (req, res) => {
      try {
        const result = await this.db.query(
          `SELECT DATE(created_at) as date, COUNT(*) as order_count 
           FROM orders 
           GROUP BY DATE(created_at) 
           ORDER BY date DESC 
           LIMIT 30`
        );
        res.json(result.rows);
      } catch (error) {
        console.error('Error fetching available dates:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Endpoint para reportes diarios
    this.app.get('/reports/daily', async (req, res) => {
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const result = await this.db.query(
          `SELECT 
            DATE(o.created_at) as date,
            COUNT(*) as orders_created,
            SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as orders_completed,
            ARRAY_AGG(o.recipe_snapshot) as all_ingredients
          FROM orders o
          WHERE o.created_at >= $1
          GROUP BY DATE(o.created_at)
          ORDER BY date DESC`,
          [thirtyDaysAgo.toISOString()]
        );
        
        // Procesar ingredientes y calcular costos
        const reports = result.rows.map((day: any) => {
          const ingredientsUsed: Record<string, number> = {};
          let totalCost = 0;
          
          if (day.all_ingredients) {
            for (const ingredientStr of day.all_ingredients) {
              if (ingredientStr) {
                try {
                  const ingredients = typeof ingredientStr === 'string' ? JSON.parse(ingredientStr) : ingredientStr;
                  for (const [ingredient, quantity] of Object.entries(ingredients)) {
                    ingredientsUsed[ingredient] = (ingredientsUsed[ingredient] || 0) + (quantity as number);
                    // Costo estimado por ingrediente (se puede integrar con pantry service)
                    totalCost += (quantity as number) * 0.5; // Costo base estimado
                  }
                } catch (parseError) {
                  console.warn('Could not parse ingredients:', ingredientStr, parseError);
                }
              }
            }
          }
          
          return {
            date: day.date,
            orders_created: parseInt(day.orders_created),
            orders_completed: parseInt(day.orders_completed),
            total_ingredients_used: ingredientsUsed,
            total_cost: Math.round(totalCost * 100) / 100
          };
        });
        
        res.json(reports);
      } catch (error) {
        console.error('Error generating daily reports:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

    // Endpoint para reportes semanales
    this.app.get('/reports/weekly', async (req, res) => {
      try {
        const eightWeeksAgo = new Date();
        eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56); // 8 semanas
        
        const result = await this.db.query(
          `SELECT 
            DATE(o.created_at) as date,
            COUNT(*) as orders_count,
            ARRAY_AGG(o.recipe_snapshot) as all_ingredients
          FROM orders o
          WHERE o.created_at >= $1
          GROUP BY DATE(o.created_at)
          ORDER BY date DESC`,
          [eightWeeksAgo.toISOString()]
        );
        
        // Agrupar por semanas
        const weeklyReports: any[] = [];
        const weekGroups: Record<string, any[]> = {};
        
        result.rows.forEach((day: any) => {
          const date = new Date(day.date);
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay()); // Domingo como inicio de semana
          const weekKey = weekStart.toISOString().split('T')[0];
          
          if (!weekGroups[weekKey]) {
            weekGroups[weekKey] = [];
          }
          weekGroups[weekKey].push(day);
        });
        
        // Procesar cada semana
        for (const [weekStart, days] of Object.entries(weekGroups)) {
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          
          let totalOrders = 0;
          let totalCost = 0;
          const ingredientCounts: Record<string, number> = {};
          
          for (const day of days) {
            totalOrders += parseInt(day.orders_count);
            
            if (day.all_ingredients) {
              for (const ingredientStr of day.all_ingredients) {
                if (ingredientStr) {
                  try {
                    const ingredients = typeof ingredientStr === 'string' ? JSON.parse(ingredientStr) : ingredientStr;
                    for (const [ingredient, quantity] of Object.entries(ingredients)) {
                      ingredientCounts[ingredient] = (ingredientCounts[ingredient] || 0) + (quantity as number);
                      totalCost += (quantity as number) * 0.5; // Costo base estimado
                    }
                  } catch (parseError) {
                    console.warn('Could not parse ingredients:', ingredientStr, parseError);
                  }
                }
              }
            }
          }
          
          // Obtener los ingredientes más usados
          const mostUsedIngredients = Object.entries(ingredientCounts)
            .map(([ingredient, quantity]) => ({ ingredient, quantity }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);
          
          weeklyReports.push({
            week_start: weekStart,
            week_end: weekEnd.toISOString().split('T')[0],
            total_orders: totalOrders,
            total_cost: Math.round(totalCost * 100) / 100,
            most_used_ingredients: mostUsedIngredients,
            avg_orders_per_day: Math.round((totalOrders / 7) * 10) / 10
          });
        }
        
        // Ordenar por fecha más reciente
        weeklyReports.sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime());
        
        res.json(weeklyReports.slice(0, 8)); // Últimas 8 semanas
      } catch (error) {
        console.error('Error generating weekly reports:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });

     // Endpoint para limpiar/reiniciar datos
     this.app.delete('/orders/reset', async (req, res) => {
       try {
         const { confirm } = req.body;
         
         if (confirm !== 'RESET_ALL_DATA') {
           return res.status(400).json({ 
             error: 'Confirmación requerida. Envía { "confirm": "RESET_ALL_DATA" } para confirmar.' 
           });
         }

         // Eliminar primero los eventos de pedidos (por la restricción de clave foránea)
         await this.db.query('DELETE FROM order_events');
         
         // Eliminar todos los pedidos
         await this.db.query('DELETE FROM orders');
         
         // Reiniciar el contador de IDs (opcional, depende del motor de BD)
         try {
           await this.db.query('ALTER SEQUENCE orders_id_seq RESTART WITH 1');
         } catch (seqError) {
           // Si no es PostgreSQL o no tiene secuencias, ignorar
           console.warn('Could not reset sequence:', seqError);
         }

         return res.json({ 
           message: 'Todos los pedidos han sido eliminados exitosamente',
           timestamp: new Date().toISOString()
         });
       } catch (error) {
         console.error('Error resetting orders:', error);
         return res.status(500).json({ error: 'Error interno del servidor' });
       }
     });

     // Endpoint para limpiar pedidos por rango de fechas
     this.app.delete('/orders/reset/date-range', async (req, res) => {
       try {
         const { start_date, end_date, confirm } = req.body;
         
         if (!start_date || !end_date) {
           return res.status(400).json({ 
             error: 'Se requieren start_date y end_date en formato YYYY-MM-DD' 
           });
         }

         if (confirm !== 'DELETE_DATE_RANGE') {
           return res.status(400).json({ 
             error: 'Confirmación requerida. Envía { "confirm": "DELETE_DATE_RANGE" } para confirmar.' 
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

         // Contar pedidos a eliminar
         const countResult = await this.db.query(
           'SELECT COUNT(*) as count FROM orders WHERE DATE(created_at) BETWEEN $1 AND $2',
           [start_date, end_date]
         );
         
         const ordersToDelete = parseInt(countResult.rows[0].count);

         // Eliminar primero los eventos de pedidos en el rango de fechas
         await this.db.query(
           'DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE DATE(created_at) BETWEEN $1 AND $2)',
           [start_date, end_date]
         );
         
         // Eliminar pedidos en el rango de fechas
         await this.db.query(
           'DELETE FROM orders WHERE DATE(created_at) BETWEEN $1 AND $2',
           [start_date, end_date]
         );

         return res.json({ 
           message: `${ordersToDelete} pedidos eliminados exitosamente`,
           date_range: { start_date, end_date },
           orders_deleted: ordersToDelete,
           timestamp: new Date().toISOString()
         });
       } catch (error) {
         console.error('Error resetting orders by date range:', error);
         return res.status(500).json({ error: 'Error interno del servidor' });
       }
     });

     // Server-Sent Events para actualizaciones en tiempo real
     this.app.get('/events/sse', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      // Enviar evento inicial
      res.write('data: {"type": "connected", "message": "Conectado al kitchen service"}\n\n');

      // Agregar cliente a la lista
      this.sseClients.push(res);

      // Limpiar cuando se desconecta
      req.on('close', () => {
        this.sseClients = this.sseClients.filter(client => client !== res);
      });
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'OK', service: 'kitchen-service' });
    });
  }

  private async createOrder(): Promise<number> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Seleccionar receta aleatoria
      const recipeResult = await client.query(
        'SELECT * FROM recipes ORDER BY RANDOM() LIMIT 1'
      );
      
      if (recipeResult.rows.length === 0) {
        throw new Error('No hay recetas disponibles');
      }
      
      const recipe: Recipe = recipeResult.rows[0];
      
      // Crear pedido
      const orderResult = await client.query(
        'INSERT INTO orders (recipe_id, recipe_snapshot, status) VALUES ($1, $2, $3) RETURNING id',
        [recipe.id, JSON.stringify(recipe.ingredients), 'pending']
      );
      
      const orderId = orderResult.rows[0].id;
      
      // Registrar evento
      await this.logOrderEvent(client, orderId, 'order_created', {
        recipe_name: recipe.name,
        ingredients: recipe.ingredients
      });
      
      await client.query('COMMIT');
      
      // Solicitar ingredientes a la bodega
      await this.requestIngredients(orderId, recipe);
      
      // Emitir evento SSE
      this.broadcastSSE({
        type: 'order_created',
        orderId,
        recipe: recipe.name,
        status: 'pending'
      });
      
      return orderId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async requestIngredients(orderId: number, recipe: Recipe): Promise<void> {
    if (!this.rabbitChannel) {
      throw new Error('RabbitMQ channel not available');
    }

    const requestId = uuidv4();
    const message = {
      requestId,
      orderId,
      recipeSnapshot: recipe.ingredients
    };

    await this.rabbitChannel.publish(
      'restaurant',
      'kitchen.ingredient_request',
      Buffer.from(JSON.stringify(message))
    );

    console.log(`Ingredientes solicitados para pedido ${orderId}:`, recipe.ingredients);
  }

  private async handleIngredientReady(message: any): Promise<void> {
    const { requestId, orderId, availableIngredients } = message;
    
    console.log(`Ingredientes listos para pedido ${orderId}`);
    
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Actualizar estado a 'preparing'
      await client.query(
        'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['preparing', orderId]
      );
      
      // Registrar evento
      await this.logOrderEvent(client, orderId, 'ingredients_ready', {
        requestId,
        availableIngredients
      });
      
      await client.query('COMMIT');
      
      // Emitir evento SSE
      this.broadcastSSE({
        type: 'order_preparing',
        orderId,
        status: 'preparing'
      });
      
      // Simular tiempo de preparación
      await this.simulateCooking(orderId, availableIngredients);
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error handling ingredient ready:', error);
    } finally {
      client.release();
    }
  }

  private async simulateCooking(orderId: number, ingredients: Record<string, number>): Promise<void> {
    // Calcular tiempo de preparación (200ms por ingrediente)
    const totalIngredients = Object.values(ingredients).reduce((sum, qty) => sum + qty, 0);
    const cookingTime = totalIngredients * 200;
    
    console.log(`Cocinando pedido ${orderId} por ${cookingTime}ms`);
    
    setTimeout(async () => {
      await this.completeOrder(orderId);
    }, cookingTime);
  }

  private async completeOrder(orderId: number): Promise<void> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Actualizar estado a 'completed'
      await client.query(
        'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['completed', orderId]
      );
      
      // Registrar evento
      await this.logOrderEvent(client, orderId, 'order_completed', {
        completed_at: new Date().toISOString()
      });
      
      await client.query('COMMIT');
      
      // Emitir evento SSE
      this.broadcastSSE({
        type: 'order_completed',
        orderId,
        status: 'completed'
      });
      
      console.log(`Pedido ${orderId} completado y entregado`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error completing order:', error);
    } finally {
      client.release();
    }
  }

  private async logOrderEvent(client: any, orderId: number, eventType: string, eventData: any): Promise<void> {
    await client.query(
      'INSERT INTO order_events (order_id, event_type, event_data) VALUES ($1, $2, $3)',
      [orderId, eventType, JSON.stringify(eventData)]
    );
  }

  private broadcastSSE(data: any): void {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    this.sseClients.forEach(client => {
      try {
        client.write(message);
      } catch (error) {
        console.error('Error sending SSE:', error);
      }
    });
  }

  private async setupRabbitMQ(): Promise<void> {
    try {
      this.rabbitConnection = await amqp.connect(process.env.RABBITMQ_URL!);
      this.rabbitChannel = await this.rabbitConnection.createChannel();
      
      // Declarar exchange
      await this.rabbitChannel.assertExchange('restaurant', 'topic', { durable: true });
      
      // Declarar cola para recibir respuestas de pantry
      const queue = await this.rabbitChannel.assertQueue('kitchen.ingredient_ready', { durable: true });
      
      // Bind cola al exchange
      await this.rabbitChannel.bindQueue(queue.queue, 'restaurant', 'pantry.ingredient_ready');
      
      // Consumir mensajes
      await this.rabbitChannel.consume(queue.queue, async (msg: any) => {
        if (msg) {
          try {
            const message = JSON.parse(msg.content.toString());
            await this.handleIngredientReady(message);
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
    const port = process.env.PORT || 4000;
    
    // Configurar RabbitMQ
    await this.setupRabbitMQ();
    
    this.app.listen(port, () => {
      console.log(`Kitchen service running on port ${port}`);
    });
  }
}

// Iniciar servicio
const kitchenService = new KitchenService();
kitchenService.start().catch(console.error);

// Manejo de señales para cierre limpio
process.on('SIGTERM', () => {
  console.log('Shutting down kitchen service...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down kitchen service...');
  process.exit(0);
});