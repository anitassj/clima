// estado y elementos del buscador de ubicación
const STORAGE_KEY = 'dashboard-clima-ubicacion';
const params = new URLSearchParams(window.location.search);
const modal = document.getElementById('modalUbicacion');
const contenidoModal = modal?.querySelector('.modal-contenido');
const botonAbrirModal = document.getElementById('btn-modal-ubicacion');
const botonCerrarModal = document.getElementById('cerrar-modal-ubicacion');
const botonUbicacionActual = document.getElementById('btn-ubicacion-actual');
const formModal = document.getElementById('form-clima');
const inputCiudad = document.getElementById('ciudad');
const sugerenciasLista = document.getElementById('sugerencias');
const estadoBusqueda = document.getElementById('estado-busqueda');
const botonBuscarCiudad = document.getElementById('btn-buscar-ciudad');
const errorModal = document.getElementById('errorModal');
let temporizadorSugerencias;
let solicitudSugerencias;
let indiceSugerenciaActiva = -1;
let elementoConFocoPrevio;

// recupera la última ubicación elegida; el bloque try también contempla que el navegador bloquee localStorage
const leerUbicacionGuardada = () => {
    try {
        const guardada = localStorage.getItem(STORAGE_KEY);
        return guardada ? JSON.parse(guardada) : null;
    } catch (error) {
        console.error('No se pudo leer la ubicación guardada:', error);
        return null;
    }
};

// persiste una ciudad o coordenadas para restaurarlas cuando se vuelve a abrir la página
const guardarUbicacion = (ubicacion) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ubicacion));
    } catch (error) {
        console.error('No se pudo guardar la ubicación:', error);
    }
};

// abre el diálogo, bloquea el desplazamiento del fondo y lleva el foco al buscador
const mostrarModal = (mensaje = '') => {
    if (!modal || !contenidoModal) return;

    elementoConFocoPrevio = document.activeElement;
    modal.classList.add('mostrar');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-abierto');
    errorModal.textContent = mensaje;
    inputCiudad?.focus();
};

// cierra el diálogo y devuelve el foco al control que lo abrió
const ocultarModal = () => {
    if (!modal) return;

    modal.classList.remove('mostrar');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-abierto');
    botonAbrirModal?.focus();
    if (elementoConFocoPrevio instanceof HTMLElement && elementoConFocoPrevio !== document.body) {
        elementoConFocoPrevio.focus();
    }
};

// mantiene los mensajes visibles y los estados accesibles separados
const mostrarError = (mensaje) => {
    if (errorModal) errorModal.textContent = mensaje;
};

const actualizarEstado = (mensaje) => {
    if (estadoBusqueda) estadoBusqueda.textContent = mensaje;
};

// valida la ciudad a través del servidor para no exponer la clave de OpenWeather en el navegador
const validarCiudad = async (ciudad) => {
    const respuesta = await fetch(`/api/ciudad?ciudad=${encodeURIComponent(ciudad)}`);

    if (!respuesta.ok) {
        throw new Error('No se pudo validar la ciudad.');
    }

    const datos = await respuesta.json();
    return Boolean(datos?.valido);
};

// borra resultados anteriores y reinicia el estado de navegación accesible
const limpiarSugerencias = () => {
    sugerenciasLista?.replaceChildren();
    inputCiudad?.setAttribute('aria-expanded', 'false');
    inputCiudad?.removeAttribute('aria-activedescendant');
    indiceSugerenciaActiva = -1;
};

// desplaza la selección de sugerencias con teclado y mantiene visible la opción activa
const activarSugerencia = (indice) => {
    const opciones = sugerenciasLista?.querySelectorAll('[role="option"]');
    if (!opciones?.length) return;

    indiceSugerenciaActiva = (indice + opciones.length) % opciones.length;
    opciones.forEach((opcion, posicion) => {
        const activa = posicion === indiceSugerenciaActiva;
        opcion.setAttribute('aria-selected', String(activa));
        if (activa) {
            inputCiudad.setAttribute('aria-activedescendant', opcion.id);
            opcion.scrollIntoView({ block: 'nearest' });
        }
    });
};

// seleccionar una sugerencia conserva el nombre y reutiliza el envío normal del formulario
const seleccionarCiudad = (nombre) => {
    if (!inputCiudad || !formModal) return;

    inputCiudad.value = nombre;
    limpiarSugerencias();
    guardarUbicacion({ tipo: 'ciudad', valor: nombre });
    formModal.requestSubmit();
};

// consulta y construye sugerencias como nodos de texto para evitar interpretar datos externos como HTML
const cargarSugerencias = async (query, controlador) => {
    if (!sugerenciasLista) return;

    try {
        const respuesta = await fetch(`/api/sugerencias?query=${encodeURIComponent(query)}`, {
            signal: controlador.signal
        });

        if (!respuesta.ok) {
            throw new Error('No se pudieron cargar las sugerencias.');
        }

        const ciudades = await respuesta.json();
        if (inputCiudad.value.trim() !== query) return;
        limpiarSugerencias();

        if (!Array.isArray(ciudades) || ciudades.length === 0) {
            actualizarEstado('No encontramos coincidencias. Probá con otra ciudad.');
            return;
        }

        ciudades.forEach((ciudad, indice) => {
            const nombre = ciudad.name || 'Ciudad';
            const estado = ciudad.state ? `${ciudad.state}, ` : '';
            const pais = ciudad.country || '';
            const opcion = document.createElement('li');
            const icono = document.createElement('i');
            const texto = document.createElement('span');

            opcion.id = `sugerencia-${indice}`;
            opcion.className = 'sugerencia-item';
            opcion.setAttribute('role', 'option');
            opcion.setAttribute('aria-selected', 'false');
            opcion.dataset.ciudad = `${nombre}, ${estado}${pais}`;
            icono.className = 'fa-solid fa-location-dot';
            icono.setAttribute('aria-hidden', 'true');
            texto.textContent = `${nombre} — ${estado}${pais}`;
            opcion.append(icono, texto);
            sugerenciasLista.append(opcion);
        });

        inputCiudad.setAttribute('aria-expanded', 'true');
        actualizarEstado(`${ciudades.length} sugerencia${ciudades.length === 1 ? '' : 's'}. Usá las flechas y Enter para elegir.`);
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error(error);
        limpiarSugerencias();
        actualizarEstado('No se pudieron cargar sugerencias. Podés intentar buscar la ciudad igualmente.');
    }
};

// solicita geolocalización, muestra progreso y comunica claramente los casos de error o permiso denegado
const solicitarUbicacionActual = (automatico = false) => {
    if (!navigator.geolocation) {
        const mensaje = 'Este navegador no permite obtener la ubicación. Buscá una ciudad manualmente.';
        if (automatico) mostrarModal(mensaje);
        else mostrarError(mensaje);
        return;
    }

    if (botonUbicacionActual) {
        botonUbicacionActual.disabled = true;
        botonUbicacionActual.setAttribute('aria-busy', 'true');
    }
    actualizarEstado('Solicitando permiso de ubicación…');

    navigator.geolocation.getCurrentPosition(
        (posicion) => {
            const ubicacion = {
                tipo: 'coordenadas',
                lat: posicion.coords.latitude,
                lon: posicion.coords.longitude
            };
            guardarUbicacion(ubicacion);
            window.location.href = `/?lat=${ubicacion.lat}&lon=${ubicacion.lon}`;
        },
        (error) => {
            console.warn('No se pudo obtener la ubicación:', error.message);
            const mensaje = error.code === error.PERMISSION_DENIED
                ? 'No diste permiso de ubicación. Podés buscar una ciudad manualmente.'
                : 'No se pudo determinar tu ubicación. Probá buscando una ciudad.';
            if (botonUbicacionActual) {
                botonUbicacionActual.disabled = false;
                botonUbicacionActual.removeAttribute('aria-busy');
            }
            if (automatico) mostrarModal(mensaje);
            else mostrarError(mensaje);
            actualizarEstado('');
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
};

// en la primera visita restaura la ubicación guardada o intenta detectar la ubicación del dispositivo
if (!params.has('lat') && !params.has('ciudadBuscada')) {
    const ubicacionGuardada = leerUbicacionGuardada();
    if (ubicacionGuardada?.tipo === 'coordenadas' && Number.isFinite(ubicacionGuardada.lat) && Number.isFinite(ubicacionGuardada.lon)) {
        window.location.replace(`/?lat=${ubicacionGuardada.lat}&lon=${ubicacionGuardada.lon}`);
    } else if (ubicacionGuardada?.tipo === 'ciudad' && ubicacionGuardada.valor) {
        window.location.replace(`/?ciudadBuscada=${encodeURIComponent(ubicacionGuardada.valor)}`);
    } else {
        solicitarUbicacionActual(true);
    }
}

// controles del diálogo: apertura, cierre con botón y cierre al pulsar fuera
botonAbrirModal?.addEventListener('click', () => mostrarModal());
botonCerrarModal?.addEventListener('click', ocultarModal);
modal?.addEventListener('click', (evento) => {
    if (evento.target === modal) ocultarModal();
});

// cierra con Escape y mantiene el foco dentro del diálogo mientras está abierto
document.addEventListener('keydown', (evento) => {
    if (!modal?.classList.contains('mostrar')) return;

    if (evento.key === 'Escape') {
        ocultarModal();
        return;
    }

    if (evento.key === 'Tab' && contenidoModal) {
        const elementos = contenidoModal.querySelectorAll('button:not(:disabled), input:not(:disabled)');
        const primero = elementos[0];
        const ultimo = elementos[elementos.length - 1];
        if (evento.shiftKey && document.activeElement === primero) {
            evento.preventDefault();
            ultimo.focus();
        } else if (!evento.shiftKey && document.activeElement === ultimo) {
            evento.preventDefault();
            primero.focus();
        }
    }
});

// valida el formulario, informa el progreso y evita envíos repetidos durante la consulta
formModal?.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!inputCiudad || !botonBuscarCiudad) return;

    const ciudad = inputCiudad.value.trim();
    if (!ciudad) {
        mostrarError('Ingresá una ciudad para continuar.');
        inputCiudad.focus();
        return;
    }

    botonBuscarCiudad.disabled = true;
    botonBuscarCiudad.setAttribute('aria-busy', 'true');
    botonBuscarCiudad.textContent = 'Validando…';
    mostrarError('');
    actualizarEstado('Validando la ciudad…');

    try {
        if (!await validarCiudad(ciudad)) {
            mostrarError('No encontramos esa ciudad. Revisá el nombre o elegí una sugerencia.');
            actualizarEstado('');
            return;
        }

        guardarUbicacion({ tipo: 'ciudad', valor: ciudad });
        formModal.submit();
    } catch (error) {
        console.error(error);
        mostrarError('No se pudo validar la ciudad por un problema de conexión. Intentá nuevamente.');
        actualizarEstado('');
    } finally {
        botonBuscarCiudad.disabled = false;
        botonBuscarCiudad.removeAttribute('aria-busy');
        botonBuscarCiudad.textContent = 'Ver clima';
    }
});

// espera a que el usuario termine de escribir y cancela las consultas de sugerencias obsoletas.
inputCiudad?.addEventListener('input', () => {
    const query = inputCiudad.value.trim();
    if (solicitudSugerencias) solicitudSugerencias.abort();
    window.clearTimeout(temporizadorSugerencias);
    limpiarSugerencias();
    mostrarError('');

    if (query.length < 3) {
        actualizarEstado('Escribí al menos 3 letras para ver sugerencias.');
        return;
    }

    actualizarEstado('Buscando ciudades…');
    temporizadorSugerencias = window.setTimeout(() => {
        solicitudSugerencias = new AbortController();
        cargarSugerencias(query, solicitudSugerencias);
    }, 300);
});

// permite recorrer las sugerencias con flechas, confirmar con Enter y cerrarlas con Escape
inputCiudad?.addEventListener('keydown', (evento) => {
    const opciones = sugerenciasLista?.querySelectorAll('[role="option"]');
    if (!opciones?.length) return;

    if (evento.key === 'ArrowDown') {
        evento.preventDefault();
        activarSugerencia(indiceSugerenciaActiva + 1);
    } else if (evento.key === 'ArrowUp') {
        evento.preventDefault();
        activarSugerencia(indiceSugerenciaActiva < 0 ? opciones.length - 1 : indiceSugerenciaActiva - 1);
    } else if (evento.key === 'Enter' && indiceSugerenciaActiva >= 0) {
        evento.preventDefault();
        seleccionarCiudad(opciones[indiceSugerenciaActiva].dataset.ciudad);
    } else if (evento.key === 'Escape') {
        limpiarSugerencias();
    }
});

// la delegación permite seleccionar cualquier opción creada dinámicamente
sugerenciasLista?.addEventListener('click', (evento) => {
    const opcion = evento.target.closest('[role="option"]');
    if (opcion) seleccionarCiudad(opcion.dataset.ciudad);
});

// el botón secundario permite volver a solicitar las coordenadas en cualquier momento
botonUbicacionActual?.addEventListener('click', () => {
    mostrarError('');
    solicitarUbicacionActual();
});
