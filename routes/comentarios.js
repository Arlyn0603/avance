const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../config/db');

router.post('/agregar/:eventoId', async (req, res) => {
    const { eventoId } = req.params; // Obtén el ID del evento desde la URL
    const { comentario } = req.body;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('eventoId', sql.Int, eventoId)
            .input('comentario', sql.NVarChar(1000), comentario)
            .input('fecha', sql.DateTime, new Date())
            .query(`
                INSERT INTO Comentarios (EventoId, Comentario, Fecha)
                VALUES (@eventoId, @comentario, @fecha)
            `);

        res.status(200).json({ message: 'Comentario guardado exitosamente.' });
    } catch (err) {
        console.error('Error al guardar el comentario:', err);
        res.status(500).json({ message: 'Error al guardar el comentario.' });
    }
});

module.exports = router;