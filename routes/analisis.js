const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../config/db');

router.get('/analisis', async (req, res) => {
    try {
        const pool = await poolPromise;

        // Páginas más visitadas
        const paginasResult = await pool.request().query(`
            SELECT ruta, COUNT(*) AS visitas
            FROM RegistroEventos
            GROUP BY ruta
            ORDER BY visitas DESC
        `);

        // Usuarios más activos
        const usuariosResult = await pool.request().query(`
            SELECT usuario, COUNT(*) AS eventos
            FROM RegistroEventos
            GROUP BY usuario
            ORDER BY eventos DESC
        `);

        // Actividad por fecha
        const actividadResult = await pool.request().query(`
            SELECT CAST(fecha AS DATE) AS fecha, COUNT(*) AS eventos
            FROM RegistroEventos
            GROUP BY CAST(fecha AS DATE)
            ORDER BY fecha DESC
        `);

        // Reporte financiero: ingresos por evento
        const ingresosPorEvento = await pool.request().query(`
            SELECT 
                nombreEvento AS Evento,
                ubicacion AS Ubicacion,
                SUM(Total) AS IngresosTotales,
                SUM(Cantidad) AS EntradasVendidas
            FROM Compras
            WHERE estado = 'Completado'
            GROUP BY nombreEvento, ubicacion
            ORDER BY IngresosTotales DESC
        `);

        // Reporte financiero: total general
        const totalGeneral = await pool.request().query(`
            SELECT 
                SUM(Total) AS TotalIngresos,
                SUM(Cantidad) AS TotalEntradas
            FROM Compras
            WHERE estado = 'Completado'
        `);

         // Obtener comentarios con el respectivo evento
         const comentariosResult = await pool.request().query(`
            SELECT 
                c.Comentario,
                c.Fecha,
                e.nombreEvento AS NombreEvento
            FROM Comentarios c
            INNER JOIN Compras e ON c.EventoId = e.Id
            ORDER BY c.Fecha DESC
        `);

        // Renderizar la vista con todos los datos
        res.render('analisis', {
            paginas: paginasResult.recordset,
            usuarios: usuariosResult.recordset,
            actividad: actividadResult.recordset,
            ingresos: ingresosPorEvento.recordset,
            total: totalGeneral.recordset[0],
            comentarios: comentariosResult.recordset // Asegúrate de incluir esta línea
        });
    } catch (err) {
        console.error('Error al obtener métricas:', err);
        res.status(500).send('Error al obtener métricas');
    }
});

module.exports = router;