const express = require('express');
const router = express.Router();
const { obtenerClima, buscarSugerencias, validarCiudad } = require('../controladores/climaControlador');

// pág principal con clima actual y pronóstico.
router.get('/', obtenerClima);

// APIs internas para autocompletar y validar ubicaciones desde el navegador.
router.get('/api/sugerencias', buscarSugerencias);
router.get('/api/ciudad', validarCiudad);

module.exports = router;