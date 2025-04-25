const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../config/db'); // Asegúrate de tener este archivo configurado

// Ruta para mostrar la billetera
router.get('/billetera', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/usuarios/login');
    }

    try {
        const pool = await poolPromise;
        const request = pool.request();
        request.input('CorreoElectronico', sql.VarChar(100), req.session.user.email);
        
        const result = await request.execute('ObtenerTarjetasPorEmail');
        
        console.log('Tarjetas obtenidas:', result.recordset); // Asegúrate de que Saldo esté presente
        
        res.render('billetera', { 
            user: req.session.user,
            tarjetas: result.recordset || []
        });
    } catch (err) {
        console.error('Error al obtener tarjetas:', err);
        res.render('billetera', { 
            user: req.session.user,
            tarjetas: [],
            error: 'Error al cargar los métodos de pago'
        });
    }
});



router.post('/billetera/agregar-tarjeta', async (req, res) => {
    console.log('Datos recibidos:', req.body);

    const { numeroTarjeta, nombreTitular, fechaExpiracion, codigoSeguridad, tipoTarjeta, saldo, userEmail } = req.body;

    if (!userEmail || !req.session.user || req.session.user.email !== userEmail) {
        return res.status(401).json({ success: false, message: "Usuario no autenticado o no coincide" });
    }

    try {
        const pool = await poolPromise;
        
        // Validar y convertir fecha
        const [month, year] = fechaExpiracion.split('/');
        if (month.length !== 2 || year.length !== 2 || 
            parseInt(month) < 1 || parseInt(month) > 12) {
            return res.status(400).json({ 
                success: false, 
                message: "Fecha de expiración no válida (MM/YY)" 
            });
        }
        
        const expDate = new Date(`20${year}-${month}-01`);
        
        // Validar saldo
        const saldoNum = parseFloat(saldo);
        if (isNaN(saldoNum) || saldoNum < 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Saldo debe ser un número positivo" 
            });
        }

        // Ejecutar procedimiento almacenado
        const request = pool.request();
        request.input('CorreoElectronico', sql.VarChar(100), userEmail);
        request.input('NumeroTarjeta', sql.VarChar(16), numeroTarjeta);
        request.input('NombreTitular', sql.NVarChar(100), nombreTitular);
        request.input('FechaExpiracion', sql.Date, expDate);
        request.input('CodigoSeguridad', sql.VarChar(3), codigoSeguridad);
        request.input('TipoTarjeta', sql.NVarChar(50), tipoTarjeta);
        request.input('Saldo', sql.Decimal(10, 2), saldoNum);

        await request.execute('GuardarTarjetaPorEmail');
        
        res.json({ success: true, message: "Tarjeta agregada correctamente" });
    } catch (err) {
        console.error('Error al guardar tarjeta:', err);
        
        let errorMessage = 'Error al guardar la tarjeta';
        if (err.message.includes('No se encontró un usuario')) {
            errorMessage = 'Usuario no encontrado. Por favor inicie sesión nuevamente.';
        } else if (err.message.includes('duplicate key')) {
            errorMessage = 'Esta tarjeta ya está registrada.';
        }
        
        res.status(500).json({ success: false, message: errorMessage });
    }
});

// Ruta para eliminar una tarjeta
router.post('/billetera/eliminar-tarjeta', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "No autorizado" });
    }

    const { numeroTarjeta } = req.body;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('NumeroTarjeta', sql.VarChar(16), numeroTarjeta)
            .input('CorreoElectronico', sql.VarChar(100), req.session.user.email)
            .query(`
                DELETE FROM Tarjetas
                WHERE NumeroTarjeta = @NumeroTarjeta
                AND UsuarioId IN (SELECT id FROM Usuarios WHERE CorreoElectronico = @CorreoElectronico)
            `);

        // Verificar si se eliminó alguna fila
        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: "Tarjeta eliminada correctamente" });
        } else {
            res.json({ success: false, message: "No se encontró la tarjeta para eliminar" });
        }
    } catch (err) {
        console.error('Error al eliminar tarjeta:', err);
        res.status(500).json({ success: false, message: "Error al eliminar tarjeta" });
    }
});
module.exports = router;