const API_KEY = process.env.OPENWEATHER_API_KEY;

// reduce espacios redundantes para usar la entrada de forma consistente en las consultas
const normalizarCiudad = (valor = '') => String(valor).trim().replace(/\s+/g, ' ');

// falla si falta la configuración requerida, en lugar de consultar con una clave vacía
const obtenerApiKey = () => {
    if (!API_KEY) {
        throw new Error('Falta la variable OPENWEATHER_API_KEY en el entorno.');
    }

    return API_KEY;
};

// centraliza la comprobación HTTP y los errores devueltos en el JSON de OpenWeather
const obtenerJsonOpenWeather = async (url) => {
    const respuesta = await fetch(url);

    if (!respuesta.ok) {
        throw new Error('La API de clima no respondió correctamente.');
    }

    const datos = await respuesta.json();

    if (datos.cod && Number(datos.cod) !== 200) {
        throw new Error(datos.message || 'No se pudo obtener la información solicitada.');
    }

    return datos;
};

// endpoint de autocompletado: limita la búsqueda a cinco resultados
const buscarSugerencias = async (req, res) => {
    try {
        const query = normalizarCiudad(req.query.query || req.query.ciudad || '');

        if (!query || query.length < 3) {
            return res.json([]);
        }

        const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${obtenerApiKey()}`;
        const datos = await obtenerJsonOpenWeather(url);

        return res.json(Array.isArray(datos) ? datos : []);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// endpoint usado por el formulario para comprobar que la ciudad existe antes de navegar
const validarCiudad = async (req, res) => {
    try {
        const ciudad = normalizarCiudad(req.query.ciudad || '');

        if (!ciudad) {
            return res.json({ valido: false, resultado: null });
        }

        const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(ciudad)}&limit=1&appid=${obtenerApiKey()}`;
        const datos = await obtenerJsonOpenWeather(url);

        return res.json({
            valido: Array.isArray(datos) && datos.length > 0,
            resultado: Array.isArray(datos) && datos.length > 0 ? datos[0] : null
        });
    } catch (error) {
        return res.status(500).json({ error: error.message, valido: false, resultado: null });
    }
};

// obtiene clima actual y pronóstico, valida la ubicación y prepara los datos para la vista
const obtenerClima = async (req, res) => {
    try {
        const { ciudadBuscada, lat, lon } = req.query;
        const ciudad = normalizarCiudad(ciudadBuscada || 'Suipacha');
        const latitud = Number(lat);
        const longitud = Number(lon);
        const recibioCoordenadas = lat !== undefined || lon !== undefined;
        // si se envió un parámetro de coordenadas, ambos valores deben ser números dentro de rango
        const coordenadasValidas = lat !== undefined
            && lon !== undefined
            && String(lat).trim() !== ''
            && String(lon).trim() !== ''
            && Number.isFinite(latitud)
            && Number.isFinite(longitud)
            && latitud >= -90
            && latitud <= 90
            && longitud >= -180
            && longitud <= 180;

        if (recibioCoordenadas && !coordenadasValidas) {
            return res.status(400).render('inicio/error');
        }

        const usaCoordenadas = recibioCoordenadas && coordenadasValidas;

        const url = usaCoordenadas
            ? `https://api.openweathermap.org/data/2.5/weather?lat=${latitud}&lon=${longitud}&appid=${obtenerApiKey()}&units=metric&lang=es`
            : `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ciudad)}&appid=${obtenerApiKey()}&units=metric&lang=es`;

        const urlPronostico = usaCoordenadas
            ? `https://api.openweathermap.org/data/2.5/forecast?lat=${latitud}&lon=${longitud}&appid=${obtenerApiKey()}&units=metric&lang=es`
            : `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(ciudad)}&appid=${obtenerApiKey()}&units=metric&lang=es`;

        // las dos consultas son independientes y se ejecutan en paralelo
        const [datos, datosPronostico] = await Promise.all([
            obtenerJsonOpenWeather(url),
            obtenerJsonOpenWeather(urlPronostico)
        ]);

        const esDeDia = datos.sys ? (datos.dt >= datos.sys.sunrise && datos.dt < datos.sys.sunset) : true;
        // openWeather devuelve Unix UTC más un desplazamiento horario en segundos
        const zonaHoraria = datos.timezone || 0;
        const fechaLocalActual = new Date((datos.dt + zonaHoraria) * 1000).toISOString().slice(0, 10);
        const formatearHoraLocal = (timestamp) => new Date((timestamp + zonaHoraria) * 1000)
            .toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
        const formatearDiaLocal = (fecha) => new Date(`${fecha}T12:00:00Z`)
            .toLocaleDateString('es-AR', { weekday: 'long', timeZone: 'UTC' });
        const amanecer = datos.sys?.sunrise
            ? formatearHoraLocal(datos.sys.sunrise)
            : 'N/A';
        const atardecer = datos.sys?.sunset
            ? formatearHoraLocal(datos.sys.sunset)
            : 'N/A';

        // acota el pronóstico horario a las próximas 24 horas desde la observación actual
        const listaPronostico = Array.isArray(datosPronostico.list) ? datosPronostico.list : [];
        const pronosticoHoras = listaPronostico
            .filter(item => item.dt >= datos.dt && item.dt < datos.dt + 24 * 60 * 60)
            .map(item => ({
                hora: formatearHoraLocal(item.dt),
                temperatura: Math.round(item.main.temp),
                descripcion: item.weather?.[0]?.description || 'Sin descripción',
                icono: obtenerIconoClima(item.weather?.[0]?.main, item.weather?.[0]?.icon)
            }));

        // agrupa intervalos de tres horas por fecha local para calcular mínimas y máximas diarias
        const diasAgrupados = new Map();
        listaPronostico.forEach(item => {
            const fecha = new Date((item.dt + zonaHoraria) * 1000).toISOString().slice(0, 10);

            if (fecha <= fechaLocalActual) return;

            if (!diasAgrupados.has(fecha)) {
                diasAgrupados.set(fecha, {
                    fecha,
                    minima: item.main.temp_min,
                    maxima: item.main.temp_max,
                    representativo: item
                });
            }

            const dia = diasAgrupados.get(fecha);
            dia.minima = Math.min(dia.minima, item.main.temp_min);
            dia.maxima = Math.max(dia.maxima, item.main.temp_max);

            if (new Date((item.dt + zonaHoraria) * 1000).getUTCHours() === 15) {
                dia.representativo = item;
            }
        });

        const pronosticoDias = Array.from(diasAgrupados.values()).map(dia => ({
            nombre: formatearDiaLocal(dia.fecha),
            minima: Math.round(dia.minima),
            maxima: Math.round(dia.maxima),
            descripcion: dia.representativo.weather?.[0]?.description || 'Sin descripción',
            icono: obtenerIconoClima(dia.representativo.weather?.[0]?.main)
        }));

        // entrega a EJS valores ya procesados
        return res.render('inicio/index', {
            ciudad: datos.name || ciudad,
            descripcionClima: datos.weather?.[0]?.description || 'Sin descripción',
            temperatura: datos.main?.temp ?? 0,
            tempMax: datos.main?.temp_max ?? 0,
            tempMin: datos.main?.temp_min ?? 0,
            humedad: datos.main?.humidity ?? 0,
            viento: datos.wind?.speed ?? 0,
            sensacionTermica: datos.main?.feels_like ?? 0,
            presion: datos.main?.pressure ?? 0,
            visibilidad: datos.visibility ? datos.visibility / 1000 : 0,
            nubosidad: datos.clouds?.all ?? 0,
            amanecer,
            atardecer,
            rafagas: datos.wind?.gust ? Math.round(datos.wind.gust * 3.6) : 0,
            direccionViento: datos.wind?.deg ?? 0,
            esDeDia,
            pronosticoHoras,
            pronosticoDias
        });
    } catch (error) {
        console.error('Error al obtener clima:', error.message);
        return res.status(502).render('inicio/error');
    }
};

// convierte las condiciones de OpenWeather en los nombres de icono de Font Awesome usados por la vista
const obtenerIconoClima = (condicion, icono) => {
    if (condicion === 'Clear') return icono?.includes('n') ? 'fa-moon' : 'fa-sun';
    if (condicion === 'Rain' || condicion === 'Drizzle') return 'fa-cloud-rain';
    if (condicion === 'Thunderstorm') return 'fa-cloud-bolt';
    if (condicion === 'Snow') return 'fa-snowflake';
    if (condicion === 'Mist' || condicion === 'Fog' || condicion === 'Haze') return 'fa-smog';
    return icono?.includes('n') ? 'fa-cloud-moon' : 'fa-cloud';
};

module.exports = { obtenerClima, buscarSugerencias, validarCiudad };