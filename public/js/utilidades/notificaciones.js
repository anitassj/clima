//* Configuración de las notificaciones con Toastify 
//* -----------------------------------------------------------------

function crearToast(msg, icono, clase) { 
    Toastify({ 
        text: `${icono} ${msg}`, 
        duration: 2000, 
        close: true, 
        escapeMarkup: false, 
        className: clase 
    }).showToast();
}

function msjError(msg) { 
    crearToast(msg, '<i class="fa-solid fa-circle-xmark"></i>', "toast-error");
}

function msjExito(msg) { 
    crearToast(msg, '<i class="fa-solid fa-circle-check"></i>', "toast-exito"); 
}

function msjInfo(msg) { 
    crearToast(msg, '<i class="fa-solid fa-circle-info"></i>', "toast-info");
}