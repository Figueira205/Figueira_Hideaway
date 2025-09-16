# 🏗️ Arquitectura del Sistema - Figueira Hideaway

## 📋 Resumen Ejecutivo

Figueira Hideaway es un sistema de gestión de restaurante basado en microservicios que permite la gestión de pedidos, cocina e inventario en tiempo real. El sistema utiliza una arquitectura distribuida con comunicación asíncrona y interfaces web modernas.

## 🎯 Objetivos del Sistema

- **Gestión de Pedidos**: Crear y administrar pedidos de clientes
- **Gestión de Cocina**: Procesar pedidos y actualizar estados en tiempo real
- **Gestión de Inventario**: Controlar stock de ingredientes y productos
- **Comunicación en Tiempo Real**: Sincronización entre servicios mediante eventos

## 🏛️ Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + TypeScript)            │
│                     http://localhost:3000                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP/REST + SSE
                      │
┌─────────────────────┼───────────────────────────────────────────┐
│                     │           API GATEWAY                     │
│                     │        (Nginx - Futuro)                  │
└─────────────────────┼───────────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   KITCHEN   │ │   PANTRY    │ │   ORDERS    │
│   SERVICE   │ │   SERVICE   │ │   SERVICE   │
│    :4000    │ │    :4100    │ │  (Futuro)   │
└─────────────┘ └─────────────┘ └─────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │        MESSAGE BROKER       │
        │         (RabbitMQ)          │
        │          :5672              │
        └─────────────────────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │         DATABASE            │
        │       (PostgreSQL)          │
        │          :5432              │
        └─────────────────────────────┘
```

## 🧩 Componentes del Sistema

### 🖥️ Frontend (React + TypeScript)

**Ubicación**: `/frontend`
**Puerto**: 3000
**Tecnologías**:
- React 18 con TypeScript
- Vite (Build tool)
- Tailwind CSS (Estilos)
- Server-Sent Events (SSE) para tiempo real

**Funcionalidades**:
- ✅ Interfaz de creación de pedidos
- ✅ Dashboard de cocina en tiempo real
- ✅ Gestión de inventario (pantry)
- ✅ Modo oscuro/claro
- ✅ Diseño responsive

### 🍳 Kitchen Service (Node.js + TypeScript)

**Ubicación**: `/kitchen-service`
**Puerto**: 4000
**Tecnologías**:
- Node.js con TypeScript
- Express.js
- PostgreSQL (pg)
- RabbitMQ (amqplib)
- Server-Sent Events

**Responsabilidades**:
- 📋 Gestión de pedidos de cocina
- 🔄 Actualización de estados de pedidos
- 📡 Comunicación en tiempo real con frontend
- 🐰 Publicación de eventos en RabbitMQ

**Endpoints**:
```
GET  /orders          - Obtener todos los pedidos
POST /orders          - Crear nuevo pedido
PUT  /orders/:id      - Actualizar estado de pedido
GET  /events/sse      - Stream de eventos en tiempo real
```

### 🥫 Pantry Service (Node.js + TypeScript)

**Ubicación**: `/pantry-service`
**Puerto**: 4100
**Tecnologías**:
- Node.js con TypeScript
- Express.js
- PostgreSQL (pg)
- RabbitMQ (amqplib)
- Server-Sent Events

**Responsabilidades**:
- 📦 Gestión de inventario de ingredientes
- 📊 Control de stock y disponibilidad
- 🔄 Actualización automática de inventario
- 📡 Notificaciones de stock bajo

**Endpoints**:
```
GET  /inventory           - Obtener inventario completo
POST /inventory           - Agregar nuevo item
PUT  /inventory/:id       - Actualizar item
DELETE /inventory/:id     - Eliminar item
GET  /pantry/events/sse   - Stream de eventos en tiempo real
```

### 🗄️ Base de Datos (PostgreSQL)

**Puerto**: 5432
**Esquema Principal**:

```sql
-- Tabla de Pedidos
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    items JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    total_amount DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Inventario
CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit VARCHAR(50) NOT NULL,
    minimum_stock INTEGER DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 🐰 Message Broker (RabbitMQ)

**Puerto**: 5672
**Management UI**: 15672

**Colas y Exchanges**:
- `kitchen.orders` - Eventos de pedidos
- `pantry.inventory` - Eventos de inventario
- `notifications` - Notificaciones generales

## 🔄 Flujo de Datos

### 📝 Creación de Pedido

```
1. Frontend → Kitchen Service (POST /orders)
2. Kitchen Service → PostgreSQL (INSERT order)
3. Kitchen Service → RabbitMQ (publish order.created)
4. Kitchen Service → Frontend (SSE notification)
5. Pantry Service ← RabbitMQ (consume order.created)
6. Pantry Service → PostgreSQL (UPDATE inventory)
7. Pantry Service → Frontend (SSE inventory update)
```

### 🍳 Procesamiento en Cocina

```
1. Frontend → Kitchen Service (PUT /orders/:id)
2. Kitchen Service → PostgreSQL (UPDATE order status)
3. Kitchen Service → RabbitMQ (publish order.updated)
4. Kitchen Service → Frontend (SSE status update)
5. All connected clients ← SSE (real-time update)
```

### 📦 Gestión de Inventario

```
1. Frontend → Pantry Service (POST/PUT /inventory)
2. Pantry Service → PostgreSQL (INSERT/UPDATE inventory)
3. Pantry Service → RabbitMQ (publish inventory.updated)
4. Pantry Service → Frontend (SSE inventory update)
5. Kitchen Service ← RabbitMQ (consume inventory.updated)
```

## 🐳 Containerización (Docker)

### Servicios Containerizados:

```yaml
services:
  frontend:     # React app con Nginx
  kitchen-service:  # Node.js API
  pantry-service:   # Node.js API  
  postgres:     # Base de datos
  rabbitmq:     # Message broker
```

### Red Docker:
- **Nombre**: `restaurant_network`
- **Tipo**: Bridge network
- **Comunicación**: Interna entre servicios

## 🔒 Seguridad

### Implementado:
- ✅ CORS configurado en servicios backend
- ✅ Validación de datos de entrada
- ✅ Conexiones seguras a base de datos
- ✅ Variables de entorno para configuración

### Por Implementar:
- 🔄 Autenticación JWT
- 🔄 Rate limiting
- 🔄 HTTPS en producción
- 🔄 Encriptación de datos sensibles

## 📊 Monitoreo y Observabilidad

### Logs:
- Console logs en desarrollo
- Structured logging (JSON) en producción

### Métricas (Futuro):
- Prometheus + Grafana
- Health checks endpoints
- Performance monitoring

### Trazabilidad:
- Request IDs para seguimiento
- Event correlation IDs

## 🚀 Deployment

### Desarrollo:
```bash
# Local con Docker
docker-compose up -d

# Local sin Docker
npm run dev  # En cada servicio
```

### Producción (Recomendado):
- **Frontend**: Vercel/Netlify
- **Backend Services**: Railway/Render
- **Database**: PostgreSQL managed (Railway/Render)
- **Message Broker**: CloudAMQP

## 🔧 Configuración

### Variables de Entorno:

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/restaurant

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672

# Services
KITCHEN_SERVICE_PORT=4000
PANTRY_SERVICE_PORT=4100

# Frontend
VITE_KITCHEN_API_URL=http://localhost:4000
VITE_PANTRY_API_URL=http://localhost:4100
```

## 📈 Escalabilidad

### Horizontal Scaling:
- Múltiples instancias de cada servicio
- Load balancer (Nginx/HAProxy)
- Database read replicas

### Vertical Scaling:
- Incrementar recursos de containers
- Optimización de queries
- Connection pooling

## 🔮 Roadmap Futuro

### Próximas Funcionalidades:
- 🔄 Orders Service independiente
- 🔄 User Authentication Service
- 🔄 Notification Service
- 🔄 Analytics Service
- 🔄 Mobile App (React Native)

### Mejoras Técnicas:
- 🔄 API Gateway (Kong/Nginx)
- 🔄 Service Mesh (Istio)
- 🔄 Event Sourcing
- 🔄 CQRS Pattern
- 🔄 GraphQL Federation

## 📚 Tecnologías Utilizadas

| Componente | Tecnología | Versión | Propósito |
|------------|------------|---------|----------|
| Frontend | React | 18.x | UI Framework |
| Build Tool | Vite | 5.x | Development & Build |
| Styling | Tailwind CSS | 3.x | CSS Framework |
| Backend | Node.js | 20.x | Runtime |
| Language | TypeScript | 5.x | Type Safety |
| Database | PostgreSQL | 15.x | Data Persistence |
| Message Broker | RabbitMQ | 3.x | Async Communication |
| Containerization | Docker | 24.x | Deployment |
| Orchestration | Docker Compose | 2.x | Local Development |

---

**Autor**: Sistema Figueira Hideaway  
**Fecha**: Septiembre 2025  
**Versión**: 1.0.0  
**Estado**: En Desarrollo Activo