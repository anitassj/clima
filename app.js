const express = require('express');
const dotenv = require('dotenv');

// carga las variables de .env antes de importar controladores que las consultan
dotenv.config();

const app = express();

// configuración de vistas y archivos estáticos públicos
app.set('view engine', 'ejs');
app.use(express.static('public'));

// registra las rutas del dashboard y de las consultas de ubicación
const climaRutas = require('./rutas/climaRutas');
app.use('/', climaRutas);

// inicia el servidor web local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));