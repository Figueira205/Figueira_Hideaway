/**
 * Frontend Application - Figueira's Hideaway Restaurant Management System
 * 
 * @author Figueira <figueira205@proton.me>
 * @description Interfaz web para gestión de restaurante con React y TypeScript
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
  ChefHat, 
  Package, 
  ShoppingCart, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Plus,
  Minus,
  RefreshCw,
  TrendingUp,
  BarChart3,
  Calendar,
  Utensils,
  Moon,
  Sun
} from 'lucide-react';

// Configuración de APIs
const KITCHEN_API = import.meta.env.VITE_KITCHEN_API_URL || 'http://localhost:4000';
const PANTRY_API = import.meta.env.VITE_PANTRY_API_URL || 'http://localhost:4100';

// Interfaces
interface Recipe {
  id: number;
  name: string;
  ingredients: Record<string, number>;
}

// interface Order {
//   id: number;
//   recipe_id: number;
//   recipe_snapshot: Record<string, number>;
//   status: string;
//   created_at: string;
//   updated_at: string;
// }

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

interface DailyReport {
  date: string;
  orders_created: number;
  orders_completed: number;
  total_ingredients_used: Record<string, number>;
  total_cost: number;
}

interface WeeklyReport {
  week_start: string;
  week_end: string;
  total_orders: number;
  total_cost: number;
  most_used_ingredients: Array<{ ingredient: string; quantity: number }>;
  avg_orders_per_day: number;
}

function App() {
  // const [orders, setOrders] = useState<Order[]>([]); // Ya no se usa, reemplazado por todayOrders
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pantryStock, setPantryStock] = useState<PantryStock[]>([]);
  const [marketPurchases, setMarketPurchases] = useState<MarketPurchase[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dailyOrders, setDailyOrders] = useState<any[]>([]);
  const [dailyPurchases, setDailyPurchases] = useState<any[]>([]);
  const [todayOrders, setTodayOrders] = useState<any[]>([]);
  const [availableIngredients, setAvailableIngredients] = useState<string[]>([]);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [recipeFormData, setRecipeFormData] = useState({ name: '', ingredients: {} as Record<string, number> });

  const [bulkQuantity, setBulkQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('orders');
  const [notifiedCompletedOrders, setNotifiedCompletedOrders] = useState<Set<number>>(new Set());
  const [darkMode, setDarkMode] = useState(() => {
    // Verificar si hay preferencia guardada en localStorage
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
      return JSON.parse(saved);
    }
    // Si no hay preferencia guardada, usar la preferencia del sistema
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Manejar modo oscuro
  useEffect(() => {
    // Aplicar la clase dark al documento
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Guardar preferencia en localStorage
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  // Función para alternar modo oscuro
  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  // Cargar datos iniciales
  useEffect(() => {
    loadInitialData();
  }, []);

  // Configurar conexiones SSE una sola vez
  useEffect(() => {
    const cleanup = setupSSEConnections();
    return cleanup;
  }, []);

  // Verificar cada minuto si cambió el día
  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().split('T')[0];
      const currentSelectedDate = selectedDate;
      
      // Si estamos en la pestaña de reportes y la fecha seleccionada no es hoy
      if (activeTab === 'reportes' && currentSelectedDate !== today) {
        // Actualizar a la fecha de hoy automáticamente
        setSelectedDate(today);
        loadDailyData(today);
      }
      
      // Siempre actualizar los pedidos de hoy
      loadTodayOrders();
    }, 60000); // Cada minuto
    
    return () => clearInterval(interval);
  }, [selectedDate, activeTab]);

  // Actualizar datos cuando se cambie de pestaña
  useEffect(() => {
    if (activeTab === 'purchases') {
      refreshMarketPurchases();
    } else if (activeTab === 'reportes') {
      loadReports();
      // Cargar datos del día actual automáticamente
      const today = new Date().toISOString().split('T')[0];
      setSelectedDate(today);
      loadDailyData(today);
    }
  }, [activeTab]);

  // Verificar si cambió el día y resetear datos si es necesario
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (selectedDate !== today && activeTab === 'reportes') {
      // Si la fecha seleccionada no es hoy, limpiar los datos diarios
      if (selectedDate < today || selectedDate > today) {
        setDailyOrders([]);
        setDailyPurchases([]);
      }
    }
    // Actualizar pedidos de hoy siempre
    loadTodayOrders();
  }, []);

  useEffect(() => {
    // Cargar datos cuando cambie la fecha seleccionada
    if (selectedDate && activeTab === 'reportes') {
      loadDailyData(selectedDate);
    }
  }, [selectedDate, activeTab]);

  const loadTodayOrders = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const ordersRes = await axios.get(`${KITCHEN_API}/orders/by-date/${today}`);
      setTodayOrders(ordersRes.data.orders || []);
    } catch (error) {
      console.error('Error loading today orders:', error);
      setTodayOrders([]);
    }
  };

  const loadInitialData = async () => {
    try {
      const [recipesRes, stockRes, purchasesRes, ingredientsRes] = await Promise.all([
        axios.get(`${KITCHEN_API}/recipes`),
        axios.get(`${PANTRY_API}/pantry/stock`),
        axios.get(`${PANTRY_API}/pantry/market_purchases`),
        axios.get(`${KITCHEN_API}/ingredients`)
      ]);

      setRecipes(recipesRes.data);
      setPantryStock(stockRes.data);
      setMarketPurchases(purchasesRes.data);
      setAvailableIngredients(ingredientsRes.data.ingredients);
      
      // Cargar pedidos del día actual
      await loadTodayOrders();
    } catch (error) {
      console.error('Error loading initial data:', error);
      toast.error('Error cargando datos iniciales');
    }
  };

  const setupSSEConnections = () => {
    // Conexión SSE para kitchen events
    const kitchenEventSource = new EventSource(`${KITCHEN_API}/events/sse`);
    
    kitchenEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleKitchenEvent(data);
      } catch (error) {
        console.error('Error parsing kitchen SSE data:', error);
      }
    };

    kitchenEventSource.onerror = (error) => {
      console.error('Kitchen SSE error:', error);
    };

    // Conexión SSE para pantry events
    const pantryEventSource = new EventSource(`${PANTRY_API}/pantry/events/sse`);
    
    pantryEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handlePantryEvent(data);
      } catch (error) {
        console.error('Error parsing pantry SSE data:', error);
      }
    };

    pantryEventSource.onerror = (error) => {
      console.error('Pantry SSE error:', error);
    };

    // Cleanup al desmontar
    return () => {
      kitchenEventSource.close();
      pantryEventSource.close();
    };
  };

  const handleKitchenEvent = (data: any) => {
    switch (data.type) {
      case 'order_created':
        toast.success(`Nuevo pedido creado: ${data.recipe}`);
        loadTodayOrders(); // Actualizar pedidos de hoy
        break;
      case 'order_preparing':
        // Solo actualizar datos, sin notificación
        loadTodayOrders(); // Actualizar pedidos de hoy
        break;
      case 'order_completed':
        // Evitar notificaciones duplicadas
        if (!notifiedCompletedOrders.has(data.orderId)) {
          toast.success(`¡Pedido #${data.orderId} completado!`);
          setNotifiedCompletedOrders(prev => new Set(prev).add(data.orderId));
        }
        loadTodayOrders(); // Actualizar pedidos de hoy
        break;
    }
  };

  const handlePantryEvent = (data: any) => {
    console.log('Pantry SSE event received:', data);
    switch (data.type) {
      case 'stock_updated':
        setPantryStock(data.stock);
        break;
      case 'market_purchase_updated':
        if (data.purchases && Array.isArray(data.purchases)) {
          setMarketPurchases(data.purchases);
          
          // Mostrar mensaje específico con nombre del ingrediente y cantidad
          let message = 'Nueva compra registrada en el mercado';
          if (data.lastPurchase && data.lastPurchase.ingredient_name && data.lastPurchase.quantity) {
            const { ingredient_name, quantity } = data.lastPurchase;
            message = `Nueva compra registrada en mercado: ${quantity} unidades de ${ingredient_name}`;
          }
          toast.success(message);
        } else {
          console.warn('Invalid purchases data received:', data);
          // Fallback: refresh manually
          refreshMarketPurchases();
        }
        break;
    }
  };

  // refreshOrders ya no se usa, reemplazado por loadTodayOrders

  const refreshMarketPurchases = async () => {
    try {
      const response = await axios.get(`${PANTRY_API}/pantry/market_purchases`);
      setMarketPurchases(response.data);
    } catch (error) {
      console.error('Error refreshing market purchases:', error);
    }
  };

  const refreshPantryStock = async () => {
    try {
      const response = await axios.get(`${PANTRY_API}/pantry/stock`);
      setPantryStock(response.data);
    } catch (error) {
      console.error('Error refreshing pantry stock:', error);
    }
  };

  const loadReports = async () => {
    try {
      const [dailyRes, weeklyRes] = await Promise.all([
        axios.get(`${KITCHEN_API}/reports/daily`),
        axios.get(`${KITCHEN_API}/reports/weekly`)
      ]);
      setDailyReports(dailyRes.data);
      setWeeklyReports(weeklyRes.data);
    } catch (error) {
      console.error('Error loading reports:', error);
      toast.error('Error cargando reportes');
    }
  };

  const loadDailyData = async (date: string) => {
    if (!date) return;
    
    try {
      setLoading(true);
      const [ordersRes, purchasesRes] = await Promise.all([
        axios.get(`${KITCHEN_API}/orders/by-date/${date}`),
        axios.get(`${PANTRY_API}/pantry/market_purchases/by-date/${date}`)
      ]);
      setDailyOrders(ordersRes.data.orders || []);
      setDailyPurchases(purchasesRes.data.all_purchases || []);
    } catch (error) {
      console.error('Error loading daily data:', error);
      toast.error('Error cargando datos del día seleccionado');
      setDailyOrders([]);
      setDailyPurchases([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    if (date) {
      loadDailyData(date);
    } else {
      setDailyOrders([]);
      setDailyPurchases([]);
    }
  };

  const resetAllData = async () => {
    const confirmed = window.confirm(
      '⚠️ ADVERTENCIA: Esta acción eliminará TODOS los pedidos y compras del sistema.\n\n' +
      'Esta acción NO se puede deshacer.\n\n' +
      '¿Estás seguro de que quieres continuar?'
    );
    
    if (!confirmed) return;
    
    const doubleConfirm = window.prompt(
      'Para confirmar, escribe "ELIMINAR TODO" (sin comillas):'
    );
    
    if (doubleConfirm !== 'ELIMINAR TODO') {
      toast.error('Confirmación incorrecta. Operación cancelada.');
      return;
    }
    
    try {
      setLoading(true);
      
      // Eliminar pedidos
      await axios.delete(`${KITCHEN_API}/orders/reset`, {
        data: { confirm: 'RESET_ALL_DATA' }
      });
      
      // Eliminar compras
      await axios.delete(`${PANTRY_API}/pantry/market_purchases/reset`, {
        data: { confirm: 'RESET_ALL_PURCHASES' }
      });
      
      // Eliminar inventario
      await axios.delete(`${PANTRY_API}/pantry/stock/reset`, {
        data: { confirm: 'RESET_ALL_STOCK' }
      });
      
      toast.success('Todos los datos han sido eliminados exitosamente');
      
      // Recargar datos
      await Promise.all([
        loadTodayOrders(),
        refreshPantryStock(),
        refreshMarketPurchases(),
        loadReports()
      ]);
      
      // Limpiar estados locales
      setSelectedDate('');
      setDailyOrders([]);
      setDailyPurchases([]);
      
    } catch (error) {
      console.error('Error resetting data:', error);
      toast.error('Error al eliminar los datos');
    } finally {
      setLoading(false);
    }
  };

  const resetDateRange = async () => {
    const startDate = window.prompt('Fecha de inicio (YYYY-MM-DD):');
    if (!startDate) return;
    
    const endDate = window.prompt('Fecha de fin (YYYY-MM-DD):');
    if (!endDate) return;
    
    const confirmed = window.confirm(
      `⚠️ ADVERTENCIA: Esta acción eliminará todos los pedidos y compras entre ${startDate} y ${endDate}.\n\n` +
      'Esta acción NO se puede deshacer.\n\n' +
      '¿Estás seguro de que quieres continuar?'
    );
    
    if (!confirmed) return;
    
    try {
      setLoading(true);
      
      // Eliminar pedidos por rango de fechas
      const ordersResponse = await axios.delete(`${KITCHEN_API}/orders/reset/date-range`, {
        data: { 
          start_date: startDate, 
          end_date: endDate, 
          confirm: 'DELETE_DATE_RANGE' 
        }
      });
      
      // Eliminar compras por rango de fechas
      const purchasesResponse = await axios.delete(`${PANTRY_API}/pantry/market_purchases/reset/date-range`, {
        data: { 
          start_date: startDate, 
          end_date: endDate, 
          confirm: 'DELETE_PURCHASES_DATE_RANGE' 
        }
      });
      
      const ordersDeleted = ordersResponse.data.orders_deleted || 0;
      const purchasesDeleted = purchasesResponse.data.purchases_deleted || 0;
      
      toast.success(`Eliminados: ${ordersDeleted} pedidos y ${purchasesDeleted} compras`);
      
      // Recargar datos
      await Promise.all([
        loadTodayOrders(),
        refreshMarketPurchases(),
        loadReports()
      ]);
      
      // Limpiar estados si la fecha seleccionada está en el rango eliminado
      if (selectedDate && selectedDate >= startDate && selectedDate <= endDate) {
        setSelectedDate('');
        setDailyOrders([]);
        setDailyPurchases([]);
      }
      
    } catch (error) {
      console.error('Error resetting date range:', error);
      toast.error('Error al eliminar los datos del rango de fechas');
    } finally {
      setLoading(false);
    }
  };

  const createOrders = async () => {
    if (bulkQuantity < 1 || bulkQuantity > 50) {
      toast.error('La cantidad debe estar entre 1 y 50');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${KITCHEN_API}/orders`, {
        bulk: bulkQuantity
      });
      
      // No mostrar notificación aquí, se mostrará via SSE
      await loadTodayOrders();
    } catch (error) {
      console.error('Error creating orders:', error);
      toast.error('Error creando pedidos');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { class: 'badge-pending', icon: Clock, text: 'Pendiente' },
      waiting_ingredients: { class: 'badge-waiting', icon: AlertCircle, text: 'Esperando Ingredientes' },
      preparing: { class: 'badge-preparing', icon: ChefHat, text: 'Preparando' },
      completed: { class: 'badge-completed', icon: CheckCircle, text: 'Completado' },
      cancelled: { class: 'badge-error', icon: AlertCircle, text: 'Cancelado' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || {
      class: 'badge-error',
      icon: AlertCircle,
      text: status
    };

    const Icon = config.icon;

    return (
      <span className={`badge ${config.class}`}>
        <Icon className="w-3 h-3 mr-1" />
        {config.text}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  };

  const getRecipeName = (recipeId: number) => {
    const recipe = recipes.find(r => r.id === recipeId);
    return recipe?.name || 'Receta desconocida';
  };

  // Funciones para gestión de recetas
  const refreshRecipes = async () => {
    try {
      const response = await axios.get(`${KITCHEN_API}/recipes`);
      setRecipes(response.data);
    } catch (error) {
      console.error('Error refreshing recipes:', error);
      toast.error('Error cargando recetas');
    }
  };

  const openRecipeForm = (recipe?: Recipe) => {
    if (recipe) {
      setEditingRecipe(recipe);
      setRecipeFormData({ name: recipe.name, ingredients: recipe.ingredients });
    } else {
      setEditingRecipe(null);
      setRecipeFormData({ name: '', ingredients: {} });
    }
    setShowRecipeForm(true);
  };

  const closeRecipeForm = () => {
    setShowRecipeForm(false);
    setEditingRecipe(null);
    setRecipeFormData({ name: '', ingredients: {} });
  };

  const handleIngredientChange = (ingredient: string, quantity: number) => {
    setRecipeFormData(prev => ({
      ...prev,
      ingredients: {
        ...prev.ingredients,
        [ingredient]: quantity
      }
    }));
  };

  const removeIngredient = (ingredient: string) => {
    setRecipeFormData(prev => {
      const newIngredients = { ...prev.ingredients };
      delete newIngredients[ingredient];
      return {
        ...prev,
        ingredients: newIngredients
      };
    });
  };

  const saveRecipe = async () => {
    if (!recipeFormData.name.trim()) {
      toast.error('El nombre de la receta es requerido');
      return;
    }

    if (Object.keys(recipeFormData.ingredients).length === 0) {
      toast.error('La receta debe tener al menos un ingrediente');
      return;
    }

    // Validar que todas las cantidades sean positivas
    for (const [ingredient, quantity] of Object.entries(recipeFormData.ingredients)) {
      if (quantity <= 0) {
        toast.error(`La cantidad de ${ingredient} debe ser mayor a 0`);
        return;
      }
    }

    setLoading(true);
    try {
      if (editingRecipe) {
        // Actualizar receta existente
        await axios.put(`${KITCHEN_API}/recipes/${editingRecipe.id}`, recipeFormData);
        toast.success('Receta actualizada exitosamente');
      } else {
        // Crear nueva receta
        await axios.post(`${KITCHEN_API}/recipes`, recipeFormData);
        toast.success('Receta creada exitosamente');
      }
      
      await refreshRecipes();
      closeRecipeForm();
    } catch (error: any) {
      console.error('Error saving recipe:', error);
      const errorMessage = error.response?.data?.error || 'Error guardando la receta';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const deleteRecipe = async (recipe: Recipe) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar la receta "${recipe.name}"?`)) {
      return;
    }

    setLoading(true);
    try {
      await axios.delete(`${KITCHEN_API}/recipes/${recipe.id}`);
      toast.success('Receta eliminada exitosamente');
      await refreshRecipes();
    } catch (error: any) {
      console.error('Error deleting recipe:', error);
      const errorMessage = error.response?.data?.error || 'Error eliminando la receta';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <ChefHat className="h-8 w-8 text-primary-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Figueira's Hideaway</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">Sistema de Jornada de Comidas Gratis</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Versión 1.0.0</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={toggleDarkMode}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              >
                {darkMode ? (
                  <Sun className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                ) : (
                  <Moon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                )}
              </button>
              <div className="text-right">
                <p className="text-sm text-gray-500 dark:text-gray-400">Pedidos de hoy</p>
                <p className="text-2xl font-bold text-primary-600">{todayOrders.length}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {[
              { id: 'orders', name: 'Pedidos', icon: ShoppingCart },
              { id: 'recipes', name: 'Recetas', icon: ChefHat },
              { id: 'stock', name: 'Inventario', icon: Package },
              { id: 'purchases', name: 'Compras', icon: TrendingUp },
              { id: 'reports', name: 'Reportes', icon: BarChart3 }
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {tab.name}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            {/* Create Orders Section */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Crear Pedidos</h2>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setBulkQuantity(Math.max(1, bulkQuantity - 1))}
                    className="btn btn-outline btn-sm"
                    disabled={bulkQuantity <= 1}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={bulkQuantity}
                    onChange={(e) => setBulkQuantity(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                    className="input w-20 text-center"
                  />
                  <button
                    onClick={() => setBulkQuantity(Math.min(50, bulkQuantity + 1))}
                    className="btn btn-outline btn-sm"
                    disabled={bulkQuantity >= 50}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={createOrders}
                  disabled={loading}
                  className="btn btn-primary btn-md"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ChefHat className="w-4 h-4 mr-2" />
                  )}
                  {loading ? 'Creando...' : `Crear ${bulkQuantity} Pedido${bulkQuantity > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>

            {/* Orders List */}
            <div className="card">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Lista de Pedidos</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Receta
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Estado
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Creado
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Actualizado
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                    {todayOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          #{order.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {getRecipeName(order.recipe_id)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(order.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(order.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {todayOrders.length === 0 && (
                  <div className="text-center py-12">
                    <ShoppingCart className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No hay pedidos hoy</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Crea tu primer pedido del día usando el botón de arriba.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recipes Tab */}
        {activeTab === 'recipes' && (
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Gestión de Recetas</h2>
              <button
                onClick={() => openRecipeForm()}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <span>+</span>
                Nueva Receta
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
              {recipes.map((recipe) => (
                <div key={recipe.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{recipe.name}</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openRecipeForm(recipe)}
                        className="text-blue-500 hover:text-blue-700 text-sm p-1"
                        title="Editar receta"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteRecipe(recipe)}
                        className="text-red-500 hover:text-red-700 text-sm p-1"
                        title="Eliminar receta"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Ingredientes:</h4>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      {Object.entries(recipe.ingredients).map(([ingredient, quantity]) => (
                        <li key={ingredient} className="flex justify-between">
                          <span className="capitalize">{ingredient}</span>
                          <span className="font-medium">{quantity}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stock Tab */}
        {activeTab === 'stock' && (
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Inventario de Bodega</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Ingrediente
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Cantidad
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Última Actualización
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {pantryStock.map((stock) => (
                    <tr key={stock.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
                        {stock.ingredient}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          stock.quantity > 5 ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                          stock.quantity > 2 ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                          'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                        }`}>
                          {stock.quantity} unidades
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(stock.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Purchases Tab */}
        {activeTab === 'purchases' && (
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Historial de Compras</h2>
              <button
                onClick={refreshMarketPurchases}
                className="btn btn-outline btn-sm"
                title="Actualizar compras"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Actualizar
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Ingrediente
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Solicitado
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Vendido
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Precio Unitario
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Fecha
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {marketPurchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">
                        {purchase.ingredient}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {purchase.quantity_requested}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {purchase.quantity_sold}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {formatCurrency(purchase.price_per_unit)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {formatCurrency(purchase.total_cost)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(purchase.purchase_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {marketPurchases.length === 0 && (
                <div className="text-center py-12">
                  <TrendingUp className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No hay compras registradas</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Las compras aparecerán aquí cuando se necesiten ingredientes.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reports Tab */}
         {activeTab === 'reports' && (
           <div className="space-y-6">
             {/* Date Selector */}
             <div className="card">
               <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                 <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Consulta por Fecha Específica</h2>
               </div>
               <div className="p-6">
                 <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                   <div className="flex-1">
                     <label htmlFor="date-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                       Seleccionar Fecha
                     </label>
                     <input
                       type="date"
                       id="date-select"
                       value={selectedDate}
                       onChange={(e) => handleDateChange(e.target.value)}
                       className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                       max={new Date().toISOString().split('T')[0]}
                     />
                   </div>
                   <button
                     onClick={() => selectedDate && loadDailyData(selectedDate)}
                     disabled={!selectedDate || loading}
                     className="btn btn-primary px-6 py-3 text-base font-semibold rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
                   >
                     {loading ? (
                       <>
                         <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                         Cargando...
                       </>
                     ) : (
                       <>
                         <Calendar className="w-4 h-4 mr-2" />
                         Consultar
                       </>
                     )}
                   </button>
                 </div>
               </div>
             </div>

             {/* Daily Data Display */}
             {selectedDate && (
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 {/* Orders for Selected Date */}
                 <div className="card">
                   <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                       Pedidos del {new Date(selectedDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                     </h3>
                     <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                       Total: {dailyOrders.length} pedidos
                     </p>
                   </div>
                   <div className="max-h-96 overflow-y-auto">
                     {dailyOrders.length > 0 ? (
                       <div className="divide-y divide-gray-200 dark:divide-gray-700">
                         {dailyOrders.map((order, index) => (
                           <div key={index} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800">
                             <div className="flex justify-between items-start mb-2">
                               <h4 className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                                 {order.recipe_name}
                               </h4>
                               <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                 order.status === 'completed' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                                 order.status === 'preparing' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                                 order.status === 'waiting_ingredients' ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' :
                                 order.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                                 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                               }`}>
                                 {order.status === 'completed' ? 'Completado' :
                                  order.status === 'preparing' ? 'Preparando' :
                                  order.status === 'waiting_ingredients' ? 'Esperando Ingredientes' :
                                  order.status === 'cancelled' ? 'Cancelado' : 'Pendiente'}
                               </span>
                             </div>
                             <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                               Creado: {new Date(order.created_at).toLocaleTimeString('es-ES')}
                             </p>
                             {order.recipe_snapshot && (
                               <div className="flex flex-wrap gap-1">
                                 {Object.entries(order.recipe_snapshot).map(([ingredient, quantity]) => (
                                   <span key={ingredient} className="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs px-2 py-1 rounded capitalize">
                                     {ingredient}: {quantity as number}
                                   </span>
                                 ))}
                               </div>
                             )}
                           </div>
                         ))}
                       </div>
                     ) : (
                       <div className="text-center py-8">
                         <Utensils className="mx-auto h-12 w-12 text-gray-400" />
                         <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No hay pedidos</h3>
                         <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No se encontraron pedidos para esta fecha.</p>
                       </div>
                     )}
                   </div>
                 </div>

                 {/* Purchases for Selected Date */}
                 <div className="card">
                   <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                     <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                       Compras del {new Date(selectedDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                     </h3>
                     <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                       Total gastado: {dailyPurchases.reduce((sum, p) => sum + (parseFloat(p.total_cost) || 0), 0).toFixed(2)} €
                     </p>
                   </div>
                   <div className="max-h-96 overflow-y-auto">
                     {dailyPurchases.length > 0 ? (
                       <div className="divide-y divide-gray-200 dark:divide-gray-700">
                         {dailyPurchases.map((purchase, index) => (
                           <div key={index} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800">
                             <div className="flex justify-between items-start mb-2">
                               <h4 className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                                 {purchase.ingredient}
                               </h4>
                               <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                                 {parseFloat(purchase.total_cost).toFixed(2)} €
                               </span>
                             </div>
                             <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                               <div>
                                 <span className="font-medium">Cantidad:</span> {purchase.quantity_sold}
                               </div>
                               <div>
                                 <span className="font-medium">Precio/unidad:</span> {parseFloat(purchase.price_per_unit).toFixed(2)} €
                               </div>
                             </div>
                             <p className="text-xs text-gray-500 mt-2">
                               Comprado: {new Date(purchase.purchase_date).toLocaleTimeString('es-ES')}
                             </p>
                           </div>
                         ))}
                       </div>
                     ) : (
                       <div className="text-center py-8">
                         <ShoppingCart className="mx-auto h-12 w-12 text-gray-400" />
                         <h3 className="mt-2 text-sm font-medium text-gray-900">No hay compras</h3>
                         <p className="mt-1 text-sm text-gray-500">No se encontraron compras para esta fecha.</p>
                       </div>
                     )}
                   </div>
                 </div>
               </div>
             )}

             {/* Daily Reports */}
             <div className="card">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Reportes Diarios</h2>
                <button
                  onClick={loadReports}
                  className="btn btn-outline btn-sm"
                  title="Actualizar reportes"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Actualizar
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Fecha
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Pedidos Creados
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Pedidos Completados
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Costo Total
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Ingredientes Usados
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                    {dailyReports.map((report, index) => (
                      <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center">
                            <Calendar className="w-4 h-4 mr-2 text-gray-400" />
                            {new Date(report.date).toLocaleDateString('es-ES')}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {report.orders_created}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {report.orders_completed}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {formatCurrency(report.total_cost)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                          <div className="max-w-xs">
                            {Object.entries(report.total_ingredients_used).map(([ingredient, quantity]) => (
                              <span key={ingredient} className="inline-block bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-1 text-xs font-medium text-gray-800 dark:text-gray-200 mr-1 mb-1 capitalize">
                                {ingredient}: {quantity}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dailyReports.length === 0 && (
                  <div className="text-center py-12">
                    <BarChart3 className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No hay reportes diarios</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Los reportes aparecerán cuando haya actividad en el sistema.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Weekly Reports */}
            <div className="card">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Reportes Semanales</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                {weeklyReports.map((report, index) => (
                  <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow bg-white dark:bg-gray-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-gray-900 dark:text-white">Semana</h3>
                      <Calendar className="w-5 h-5 text-gray-400" />
                    </div>
                    <div className="space-y-3">
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Período:</span><br />
                        {new Date(report.week_start).toLocaleDateString('es-ES')} - {new Date(report.week_end).toLocaleDateString('es-ES')}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900 rounded-lg">
                          <div className="text-2xl font-bold text-blue-600 dark:text-blue-300">{report.total_orders}</div>
                          <div className="text-xs text-blue-600 dark:text-blue-400">Pedidos Totales</div>
                        </div>
                        <div className="text-center p-3 bg-green-50 dark:bg-green-900 rounded-lg">
                          <div className="text-2xl font-bold text-green-600 dark:text-green-300">{report.avg_orders_per_day.toFixed(1)}</div>
                          <div className="text-xs text-green-600 dark:text-green-400">Promedio/Día</div>
                        </div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 dark:bg-purple-900 rounded-lg">
                        <div className="text-xl font-bold text-purple-600 dark:text-purple-300">{formatCurrency(report.total_cost)}</div>
                        <div className="text-xs text-purple-600 dark:text-purple-400">Costo Total</div>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ingredientes Más Usados:</h4>
                        <div className="space-y-1">
                          {report.most_used_ingredients.slice(0, 3).map((item, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                              <span className="capitalize text-gray-600 dark:text-gray-400">{item.ingredient}</span>
                              <span className="font-medium text-gray-900 dark:text-gray-100">{item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {weeklyReports.length === 0 && (
                <div className="text-center py-12">
                  <BarChart3 className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No hay reportes semanales</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Los reportes semanales aparecerán después de una semana de actividad.</p>
                </div>
              )}
             </div>

             {/* Data Management Section */}
             <div className="card border-red-200 dark:border-red-800">
               <div className="px-6 py-4 border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900">
                 <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">Administración de Datos</h2>
                 <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                   ⚠️ Estas acciones son permanentes y no se pueden deshacer
                 </p>
               </div>
               <div className="p-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="space-y-4">
                     <h3 className="font-medium text-gray-900 dark:text-gray-100">Limpiar por Rango de Fechas</h3>
                     <p className="text-sm text-gray-600 dark:text-gray-400">
                       Elimina pedidos y compras de un período específico
                     </p>
                     <button
                       onClick={resetDateRange}
                       disabled={loading}
                       className="w-full px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                     >
                       {loading ? (
                         <>
                           <RefreshCw className="w-4 h-4 mr-2 animate-spin inline" />
                           Procesando...
                         </>
                       ) : (
                         <>
                           <Calendar className="w-4 h-4 mr-2 inline" />
                           Limpiar Rango de Fechas
                         </>
                       )}
                     </button>
                   </div>
                   
                   <div className="space-y-4">
                     <h3 className="font-medium text-red-900 dark:text-red-100">Reiniciar Todo el Sistema</h3>
                     <p className="text-sm text-red-700 dark:text-red-300">
                       Elimina TODOS los pedidos, compras e inventario
                     </p>
                     <button
                       onClick={resetAllData}
                       disabled={loading}
                       className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                     >
                       {loading ? (
                         <>
                           <RefreshCw className="w-4 h-4 mr-2 animate-spin inline" />
                           Procesando...
                         </>
                       ) : (
                         <>
                           <AlertCircle className="w-4 h-4 mr-2 inline" />
                           Reiniciar Todo
                         </>
                       )}
                     </button>
                   </div>
                 </div>
                 
                 <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                   <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Información Importante:</h4>
                   <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                     <li>• Las acciones de eliminación son permanentes</li>
                     <li>• Se requiere confirmación doble para operaciones críticas</li>
                     <li>• Los reportes se actualizarán automáticamente después de la limpieza</li>
                     <li>• Recomendado hacer respaldo antes de limpiar datos importantes</li>
                   </ul>
                 </div>
               </div>
             </div>
           </div>
         )}
       </main>

       {/* Recipe Form Modal */}
       {showRecipeForm && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
           <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
             <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
               <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                 {editingRecipe ? 'Editar Receta' : 'Nueva Receta'}
               </h3>
               <button
                 onClick={closeRecipeForm}
                 className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
               >
                 ✕
               </button>
             </div>
             
             <div className="p-6 space-y-6">
               {/* Recipe Name */}
               <div>
                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                   Nombre de la Receta
                 </label>
                 <input
                   type="text"
                   value={recipeFormData.name}
                   onChange={(e) => setRecipeFormData(prev => ({ ...prev, name: e.target.value }))}
                   className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                   placeholder="Ej: Pasta Carbonara"
                 />
               </div>

               {/* Ingredients */}
               <div>
                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                   Ingredientes
                 </label>
                 
                 {/* Current Ingredients */}
                 <div className="space-y-2 mb-4">
                   {Object.entries(recipeFormData.ingredients).map(([ingredient, quantity]) => (
                     <div key={ingredient} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded">
                       <span className="flex-1 capitalize text-gray-900 dark:text-gray-100">{ingredient}</span>
                       <input
                         type="number"
                         min="1"
                         value={quantity}
                         onChange={(e) => handleIngredientChange(ingredient, parseInt(e.target.value) || 1)}
                         className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                       />
                       <button
                         onClick={() => removeIngredient(ingredient)}
                         className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1"
                         title="Eliminar ingrediente"
                       >
                         🗑️
                       </button>
                     </div>
                   ))}
                 </div>

                 {/* Add New Ingredient */}
                 <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4">
                   <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Agregar Ingrediente</h4>
                   <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                     {availableIngredients
                       .filter(ingredient => !recipeFormData.ingredients[ingredient])
                       .map(ingredient => (
                         <button
                           key={ingredient}
                           onClick={() => handleIngredientChange(ingredient, 1)}
                           className="text-left p-2 text-sm bg-blue-50 dark:bg-blue-900 hover:bg-blue-100 dark:hover:bg-blue-800 rounded border border-blue-200 dark:border-blue-700 capitalize text-blue-800 dark:text-blue-200"
                         >
                           {ingredient}
                         </button>
                       ))
                     }
                   </div>
                   {availableIngredients.filter(ingredient => !recipeFormData.ingredients[ingredient]).length === 0 && (
                     <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                       Todos los ingredientes disponibles han sido agregados
                     </p>
                   )}
                 </div>
               </div>
             </div>

             {/* Modal Footer */}
             <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
               <button
                 onClick={closeRecipeForm}
                 className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
               >
                 Cancelar
               </button>
               <button
                 onClick={saveRecipe}
                 disabled={loading || !recipeFormData.name.trim() || Object.keys(recipeFormData.ingredients).length === 0}
                 className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
               >
                 {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                 {editingRecipe ? 'Actualizar' : 'Crear'} Receta
               </button>
             </div>
           </div>
         </div>
       )}
     </div>
  );
}

export default App;