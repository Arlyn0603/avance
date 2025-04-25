/*const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../config/db");

// Obtener todos los eventos
router.get("/", async (req, res) => {
    try {
        const user = req.session.user || null; // Obtén el usuario de la sesión
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT * FROM Evento");
        const eventos = result.recordset;
        res.render("index", { user, eventos }); // Pasa `user` y `eventos` a la vista
    } catch (err) {
        console.error("❌ Error al obtener eventos", err);
        res.status(500).send("Error en el servidor");
    }
});

// Obtener detalles de un evento por ID
router.get("/:id", async (req, res) => {
    try {
      // 1) Leer y parsear el parámetro
      const eventoId = parseInt(req.params.id, 10);
      if (isNaN(eventoId)) {
        return res.status(400).send("ID de evento inválido");
      }
  
      const pool = await poolPromise;
      const result = await pool.request()
        // 2) El nombre aquí debe coincidir con @eventoid
        .input("eventoid", sql.Int, eventoId)
        // 3) La columna PK es eventoId
        .query("SELECT * FROM Evento WHERE eventoId = @eventoid");
  
      if (result.recordset.length === 0) {
        return res.status(404).send("Evento no encontrado");
      }
  
      // 4) Renderizar la vista con los datos del evento
      res.render("evento", { evento: result.recordset[0] });
    } catch (err) {
      console.error("❌ Error al obtener evento:", err);
      res.status(500).send("Error en el servidor");
    }
  });
  
  module.exports = router;
  */