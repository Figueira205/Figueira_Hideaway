# Figueira's Hideaway Restaurant - El Sistema de Comidas Gratis Más Genial

¡Hola! Bienvenido al sistema para gestionar jornadas de almuerzo gratis. Este proyecto empezó como algo simple pero... bueno, digamos que mr emocione un poquito y termine creando algo épico.

## ¿Qué hace este sistema?

Básicamente, es como tener un restaurante automático que:
- Crea pedidos con recetas aleatorias
- Compra ingredientes automáticamente cuando se acaban
- Cocina los platos (bueno, simula que los cocina)
- Te da reportes súper detallados
- Te deja borrar datos cuando quieras hacer limpieza
- Gestiona recetas como un chef profesional

## La Arquitectura

Tenemos varios "servicios" trabajando juntos como un equipo:

- **Kitchen Service** (Puerto 4000): El chef que maneja pedidos y recetas
- **Pantry Service** (Puerto 4100): El encargado del inventario y las compras
- **Frontend** (Puerto 3000): La interfaz bonita donde ves todo en tiempo real
- **PostgreSQL**: Donde guardamos toda la info
- **RabbitMQ**: El mensajero que conecta todo

## ¿Cómo lo pongo a funcionar?

### Lo que necesitas tener instalado

- Docker (si no lo tienes, descárgalo de docker.com)
- Docker Compose (viene incluido con Docker Desktop)

### Pasos súper fáciles

1. **Descarga el proyecto** (ya sea clonando o descargando el ZIP)
2. **Abre una terminal** en la carpeta del proyecto
3. **Ejecuta este comando mágico:**
   ```bash
   docker-compose up --build
   ```
4. **Espera un ratito** (2-3 minutos mientras todo se configura)
5. **¡Listo!** Ve a http://localhost:3000 y disfruta

### URLs importantes

- **Interfaz Principal**: http://localhost:3000
- **API de Cocina**: http://localhost:4000
- **API de Despensa**: http://localhost:4100
- **Panel de RabbitMQ**: http://localhost:15672 (usuario: `restaurant_user`, contraseña: `restaurant_pass`)

## Funcionalidades

### Lo que se pidió originalmente:
- Crear pedidos aleatorios
- Gestión automática de inventario
- Compras automáticas cuando falta stock
- Interfaz web en tiempo real

### Extras agregados:

#### **Sistema de Reportes Avanzado**
- **Reportes diarios**: Ve exactamente qué pasó cada día
- **Reportes semanales**: Análisis completo de la semana
- **Gráficos bonitos**: Porque los números solos son aburridos
- **Exportación de datos**: Para los que aman Excel

#### **Limpieza de Datos Inteligente**
- **Borrar por períodos**: "Oye, borra todo lo de la semana pasada"
- **Limpieza selectiva**: Solo pedidos, solo compras, o lo que quieras
- **Confirmación de seguridad**: Para que no borres todo por accidente

#### **Gestión Completa de Recetas**
- **Crear recetas nuevas**: Sé creativo con los ingredientes
- **Modificar recetas existentes**: Cambiar cantidades o ingredientes
- **Eliminar recetas**: Adiós a esa receta que nadie pedía
- **Validación inteligente**: No te deja crear recetas imposibles

#### **Interfaz Súper Amigable**
- **Diseño responsive**: Se ve genial en móvil y desktop
- **Notificaciones en tiempo real**: Te avisa de todo al instante
- **Navegación por pestañas**: Pedidos, inventario, reportes, todo organizado
- **Modo oscuro**: Para los desarrolladores nocturnos (próximamente)

#### **Características Técnicas Geniales**
- **Actualizaciones en tiempo real**: Sin recargar la página
- **Sistema de colas robusto**: Los mensajes nunca se pierden
- **Transacciones seguras**: La base de datos siempre está consistente
- **Reintentos automáticos**: Si algo falla, lo intenta de nuevo
- **Logs detallados**: Para debuggear como un pro

## Para configuraciones de la API

### Crear Pedidos

```bash
# Un pedido normal y corriente
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -d '{}'

# ¡5 pedidos de una vez! (para probar el caos)
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -d '{"bulk": 5}'

# ¡10 pedidos! (ahora sí que se pone interesante)
curl -X POST http://localhost:4000/orders \
  -H "Content-Type: application/json" \
  -d '{"bulk": 10}'
```

### Comprobar los Pedidos

```bash
# Ver todos los pedidos (el chisme completo)
curl http://localhost:4000/orders

# Ver un pedido específico (cambia el 1 por el ID que quieras)
curl http://localhost:4000/orders/1

# Ver qué recetas tenemos disponibles
curl http://localhost:4000/recipes
```

### Revisar el Inventario

```bash
# ¿Qué tenemos en la despensa?
curl http://localhost:4100/pantry/stock

# ¿Qué hemos comprado últimamente?
curl http://localhost:4100/pantry/market_purchases
```

### Escuchar en Tiempo Real

```bash
# Escuchar lo que pasa en la cocina
curl -N http://localhost:4000/events/sse

# Escuchar lo que pasa en la despensa
curl -N http://localhost:4100/pantry/events/sse
```

### Verificar que Todo Estte Activo

```bash
# ¿Está viva la cocina?
curl http://localhost:4000/health

# ¿Está viva la despensa?
curl http://localhost:4100/health
```

## Las Recetas que Tenemos (¡Y puedes agregar más!)

El sistema viene con estas recetas súper variadas:

1. **Ensalada Mediterránea**: 2 tomates, 1 lechuga, 1 cebolla, 1 queso
2. **Pollo al Limón**: 2 pollos, 1 limón, 1 arroz
3. **Papas con Carne**: 3 papas, 2 carnes, 1 cebolla
4. **Arroz con Pollo y Tomate**: 2 arroces, 1 pollo, 1 tomate
5. **Tapa de Queso y Ketchup**: 2 quesos, 1 ketchup, 1 papa
6. **Plato Criollo**: 1 carne, 1 arroz, 1 limón, 1 cebolla

### Stock Inicial

Cada ingrediente empieza con 5 unidades (suficiente para empezar la fiesta):
- tomate, limón, papa, arroz, ketchup
- lechuga, cebolla, queso, carne, pollo

## ¿Cómo Funciona?

Es súper simple pero elegante:

1. **Alguien pide comida**: Haces clic en "Crear Pedido" (o varios de una vez)
2. **El sistema elige**: Selecciona una receta al azar (porque la vida es una sorpresa)
3. **La cocina llama a la despensa**: "Oye, necesito 2 tomates y 1 queso"
4. **Revisión de inventario**: La despensa revisa si tiene todo
5. **Compra automática**: Si falta algo, va al mercado y lo compra (con API real)
6. **A cocinar**: Cuando tiene todo, empieza a preparar el plato
7. **¡Listo!**: El plato se marca como completado y todos se enteran al instante

## Tecnologías que Use

### Backend 
- **Node.js + TypeScript**: Porque JavaScript sin tipos es como cocinar sin receta
- **Express.js**: Para las APIs REST súper rápidas
- **PostgreSQL**: Base de datos robusta (no se cae ni con terremotos)
- **RabbitMQ**: El mensajero que nunca pierde un mensaje
- **Docker**: Para que funcione igual en tu máquina y en la mía

### Frontend 
- **React 18 + TypeScript**: La combinación perfecta
- **Vite**: Bundler súper rápido (adiós webpack lento)
- **Tailwind CSS**: Estilos bonitos sin escribir CSS
- **Axios**: Para hablar con las APIs
- **Server-Sent Events**: Actualizaciones en tiempo real (como magia)
- **React Hot Toast**: Notificaciones que no molestan

## Configuración 

### Variables de Entorno

Todo ya está configurado, pero si eres curioso:

```env
# Base de datos
DATABASE_URL=postgresql://restaurant_user:restaurant_pass@postgres:5432/restaurant_db

# RabbitMQ
RABBITMQ_URL=amqp://restaurant_user:restaurant_pass@rabbitmq:5672

# Puertos
KITCHEN_PORT=4000    # La cocina
PANTRY_PORT=4100     # La despensa
FRONTEND_PORT=3000   # La interfaz
```

### ¿Quieres Personalizar Algo?

- **Cambiar recetas**: Toca `database/init.sql` y agrega las tuyas
- **Stock inicial**: También en `database/init.sql`
- **Tiempo de cocina**: En `kitchen-service/src/index.ts` (200ms por ingrediente)
- **Reintentos**: En `pantry-service/src/index.ts` si quieres que sea más o menos insistente

###  El Sistema No Quiere Arrancar

```bash
# Paso 1: Parar todo
docker-compose down

# Paso 2: Limpiar todo (CUIDADO: Borra la base de datos)
docker-compose down -v

# Paso 3: Empezar de nuevo
docker-compose up --build
```

###  Problemas de Conexión

```bash
# Ver si todos están vivos
docker-compose ps

# Espiar los logs (para ver qué está pasando)
docker-compose logs kitchen-service
docker-compose logs pantry-service
docker-compose logs frontend
```

### La API del Mercado No Responde

¡Tranquilo! El sistema es persistente y sigue intentando hasta conseguir los ingredientes. Es como ese amigo insistente que no se rinde.

##  Monitoreo

###  Ver Todo en Tiempo Real

```bash
# Ver todos los logs juntos (puede ser caótico)
docker-compose logs -f

# Ver logs específicos (más civilizado)
docker-compose logs -f kitchen-service
docker-compose logs -f pantry-service
```

###  Paneles de Control

- ** RabbitMQ**: http://localhost:15672 (para ver los mensajes volando)
- ** Base de datos**: Puerto `5432` (para los que saben SQL)

##  Estados de los Pedidos

- ** pending**: "Acabo de nacer, esperando ingredientes"
- ** preparing**: "¡Tengo todo! Ahora a cocinar"
- ** completed**: "¡Listo para servir!"

##  Seguridad

-  Transacciones de base de datos (nada se pierde)
-  Validación en todas las APIs (no aceptamos cualquier cosa)
-  Manejo de errores elegante (no crashes feos)
-  Headers de seguridad (porque somos profesionales)

##  Cosas Geniales que Debes Saber

-  **Multitarea**: Puede manejar muchos pedidos al mismo tiempo
-  **Precios reales**: Las compras usan la API real con precios de verdad
-  **Tiempo real**: Todo se actualiza al instante (sin recargar)
-  **Mobile friendly**: Se ve genial en el móvil también
-  **Versión 1.0.0**: ¡Completa y operativa!

---

##  Resumen Final

**Lo que se pidió**:  Sistema de pedidos aleatorios con gestión de inventario  
**Lo que entregamos**: Todo eso + reportes + limpieza de datos + gestión de recetas + interfaz súper bonita

**Para empezar**: `docker-compose up --build` → http://localhost:3000  
**Para disfrutar**: ¡Solo haz clic y mira la magia!

---

** Creado con ❤️ por Figueira205**  
Dudas o comentarios: figueira205@proton.me

*PD: Me emocione un poco y agregue más funciones de las pedidas... ¡pero valió la pena!* 