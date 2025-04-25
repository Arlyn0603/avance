const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../config/db");
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuración de Multer para guardar imágenes
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadPath = path.join(__dirname, '../public/img');
        // Crear directorio si no existe
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'evento-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // Límite de 2MB
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten imágenes (JPEG, JPG, PNG, GIF)'));
    }
});

// Obtener lugares para el combobox
router.get("/lugares", async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT id AS lugarId, nombre, imagen 
            FROM Lugares
            ORDER BY nombre
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Error al obtener lugares:", err);
        res.status(500).json({ error: "Error al obtener lugares" });
    }
});

// Obtener información detallada de un lugar específico
router.get("/lugares/:id", async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input("id", sql.Int, req.params.id)
            .query(`
                SELECT id AS lugarId, nombre, direccion, descripcion, capacidad, imagen
                FROM Lugares
                WHERE id = @id
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: "Lugar no encontrado" });
        }
        
        res.json(result.recordset[0]);
    } catch (err) {
        console.error("Error al obtener lugar:", err);
        res.status(500).json({ error: "Error al obtener lugar" });
    }
});

// Obtener bloques de un lugar específico
router.get("/bloques/:lugarId", async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input("lugarId", sql.Int, req.params.lugarId)
            .query(`
                SELECT b.id AS bloqueId, b.nombre, a.tipo, a.cantidad 
                FROM Bloques b
                JOIN Asientos a ON b.id = a.bloqueId
                WHERE b.lugarId = @lugarId
                ORDER BY b.nombre
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Error al obtener bloques:", err);
        res.status(500).json({ error: "Error al obtener bloques" });
    }
});

// Crear nuevo evento con imagen
router.post("/crear", upload.single('imagen'), async (req, res) => {
    try {
        const { nombre, tipo, lugarId, fecha, descripcion, precios } = req.body;
        
        // Validaciones básicas
        if (!nombre?.trim() || !tipo || !lugarId || !fecha) {
            // Eliminar la imagen subida si la validación falla
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: "Nombre, tipo, lugar y fecha son campos obligatorios."
            });
        }

        // Validar que el lugar exista
        try {
            const pool = await poolPromise;
            const lugarCheck = await pool.request()
                .input("lugarId", sql.Int, lugarId)
                .query("SELECT 1 FROM Lugares WHERE id = @lugarId");
            
            if (lugarCheck.recordset.length === 0) {
                if (req.file) {
                    fs.unlinkSync(req.file.path);
                }
                return res.status(404).json({
                    success: false,
                    message: "El lugar especificado no existe."
                });
            }
        } catch (err) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            console.error("Error al verificar lugar:", err);
            return res.status(500).json({
                success: false,
                message: "Error al verificar el lugar."
            });
        }

        // Validar precios
        let preciosArray;
        try {
            preciosArray = JSON.parse(precios);
            if (!Array.isArray(preciosArray)) {
                throw new Error("Los precios deben ser un arreglo");
            }

            // Validar que cada precio tenga bloqueId y valor
            const preciosValidos = preciosArray.every(precio => {
                return precio.bloqueId && !isNaN(precio.valor) && precio.valor >= 0;
            });

            if (!preciosValidos || preciosArray.length === 0) {
                throw new Error("Cada precio debe tener bloqueId y valor válidos");
            }
        } catch (err) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: `Formato de precios inválido: ${err.message}`
            });
        }

        // Crear el evento
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);

        try {
            await transaction.begin();

            // Procesar la ruta de la imagen
            const imagenPath = req.file ? '/img/' + req.file.filename : null;

            // Insertar evento
            const eventoReq = new sql.Request(transaction)
                .input("nombre", sql.NVarChar(100), nombre.trim())
                .input("tipo", sql.NVarChar(50), tipo)
                .input("lugarId", sql.Int, parseInt(lugarId))
                .input("fecha", sql.DateTime, new Date(fecha))
                .input("descripcion", sql.NVarChar(500), descripcion?.trim() || null)
                .input("imagen", sql.NVarChar(255), imagenPath);

            const eventoResult = await eventoReq.query(`
                INSERT INTO Evento (nombre, tipo, lugarId, fecha, descripcion, imagen)
                VALUES (@nombre, @tipo, @lugarId, @fecha, @descripcion, @imagen);
                SELECT SCOPE_IDENTITY() AS eventoId;
            `);
            
            const eventoId = eventoResult.recordset[0].eventoId;

            // Insertar precios de bloques
            for (const precio of preciosArray) {
                const precioReq = new sql.Request(transaction)
                    .input("eventoId", sql.Int, eventoId)
                    .input("bloqueId", sql.Int, parseInt(precio.bloqueId))
                    .input("precio", sql.Decimal(10,2), parseFloat(precio.valor));

                await precioReq.query(`
                    INSERT INTO PreciosBloques (eventoId, bloqueId, precio)
                    VALUES (@eventoId, @bloqueId, @precio);
                `);
            }

            await transaction.commit();
            
            return res.status(201).json({
                success: true,
                message: "Evento creado exitosamente",
                data: { eventoId }
            });

        } catch (err) {
            await transaction.rollback();
            // Eliminar la imagen si hubo error en la transacción
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            console.error("Error en creación de evento:", err);
            
            return res.status(500).json({
                success: false,
                message: "Error interno al crear el evento",
                systemError: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    } catch (err) {
        // Eliminar la imagen si hubo error general
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        console.error("Error inesperado:", err);
        return res.status(500).json({
            success: false,
            message: "Error inesperado al procesar la solicitud"
        });
    }
});

// Mostrar formulario de creación de evento
router.get("/crear", async (req, res) => {
    try {
        const pool = await poolPromise;

        // Fetch events
        const eventosResult = await pool.request().query(`
            SELECT 
                e.eventoId, e.nombre, e.tipo, e.lugarId, e.fecha, e.descripcion, e.imagen,
                STRING_AGG(CONCAT('Bloque ', pb.bloqueId, ': ₡', pb.precio), ', ') AS bloques
            FROM Evento e
            LEFT JOIN PreciosBloques pb ON e.eventoId = pb.eventoId
            GROUP BY e.eventoId, e.nombre, e.tipo, e.lugarId, e.fecha, e.descripcion, e.imagen
        `);
        const eventos = eventosResult.recordset;

        // Fetch blocks
        const bloquesResult = await pool.request().query(`
            SELECT id, nombre
            FROM Bloques
        `);
        const bloques = bloquesResult.recordset;

        // Fetch seats (asientos)
        const asientosResult = await pool.request().query(`
            SELECT id, bloqueId, cantidad, tipo
            FROM Asientos
        `);
        const asientos = asientosResult.recordset;

        res.render("evento", { eventos, bloques, asientos }); // Pass eventos, bloques, and asientos
    } catch (err) {
        console.error("Error al cargar el formulario de creación de evento:", err);
        res.status(500).send("Error al cargar el formulario de creación de evento.");
    }
});

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
        const eventoId = parseInt(req.params.id, 10);
        if (isNaN(eventoId)) {
            return res.status(400).send("ID de evento inválido");
        }

        const pool = await poolPromise;
        
        // Obtener información del evento
        const eventoResult = await pool.request()
            .input("eventoid", sql.Int, eventoId)
            .query(`
                SELECT e.*, l.nombre AS lugarNombre, l.direccion, l.capacidad, l.descripcion AS lugarDescripcion, l.imagen AS lugarImagen
                FROM Evento e
                JOIN Lugares l ON e.lugarId = l.id
                WHERE e.eventoId = @eventoid
            `);

        if (eventoResult.recordset.length === 0) {
            return res.status(404).send("Evento no encontrado");
        }

        const evento = eventoResult.recordset[0];
        
        // Obtener precios de bloques para este evento
        const preciosResult = await pool.request()
            .input("eventoId", sql.Int, eventoId)
            .query(`
                SELECT b.nombre, b.id AS bloqueId, pb.precio, a.cantidad, a.tipo
                FROM PreciosBloques pb
                JOIN Bloques b ON pb.bloqueId = b.id
                JOIN Asientos a ON b.id = a.bloqueId
                WHERE pb.eventoId = @eventoId
            `);
        
        // Renderizar la vista con los datos
        res.render("detalle-evento", { 
            evento: evento,
            bloques: preciosResult.recordset
        });
    } catch (err) {
        console.error("❌ Error al obtener evento:", err);
        res.status(500).send("Error en el servidor");
    }
});

router.put("/editar/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, tipo, lugarId, fecha, descripcion } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input("id", sql.Int, id)
            .input("nombre", sql.VarChar, nombre)
            .input("tipo", sql.VarChar, tipo)
            .input("lugarId", sql.Int, lugarId)
            .input("fecha", sql.DateTime, fecha)
            .input("descripcion", sql.Text, descripcion)
            .query(`
                UPDATE Evento
                SET nombre = @nombre, tipo = @tipo, lugarId = @lugarId, fecha = @fecha, descripcion = @descripcion
                WHERE eventoId = @id
            `);

        res.json({ success: true, message: "Evento actualizado exitosamente" });
    } catch (err) {
        console.error("Error al actualizar el evento:", err);
        res.status(500).json({ success: false, message: "Error al actualizar el evento" });
    }
});

// Obtener categorías de boletos (bloques) con disponibilidad para un evento
router.get("/:id/categorias", async (req, res) => {
    try {
        const eventoId = req.params.id;
        const pool = await poolPromise;
        
        const result = await pool.request()
            .input("eventoId", sql.Int, eventoId)
            .query(`
                SELECT 
                    b.id AS bloqueId, 
                    b.nombre AS categoria, 
                    pb.precio,
                    a.cantidad AS cantidadDisponible,
                    'Sin descripción' AS descripcion,
                    10 AS max_boletos_por_compra,
                    '#4CAF50' AS color
                FROM PreciosBloques pb
                JOIN Bloques b ON pb.bloqueId = b.id
                JOIN Asientos a ON b.id = a.bloqueId
                WHERE pb.eventoId = @eventoId
                ORDER BY pb.precio DESC
            `);
            
        res.json(result.recordset);
    } catch (err) {
        console.error("Error al obtener categorías de boletos:", err);
        res.status(500).json({ error: "Error al obtener categorías de boletos" });
    }
});

// Actualizar disponibilidad de boletos (admin only)
router.post("/:id/disponibilidad", async (req, res) => {
    try {
        const eventoId = req.params.id;
        const { bloqueId, cantidad } = req.body;
        
        const pool = await poolPromise;
        
        // Update the Asientos table directly
        await pool.request()
            .input("bloqueId", sql.Int, bloqueId)
            .input("cantidad", sql.Int, cantidad)
            .query(`
                UPDATE Asientos
                SET cantidad = @cantidad
                WHERE bloqueId = @bloqueId
            `);
        
        res.json({ success: true, message: "Disponibilidad actualizada" });
    } catch (err) {
        console.error("Error al actualizar disponibilidad:", err);
        res.status(500).json({ error: "Error al actualizar disponibilidad" });
    }
});

// Obtener eventos filtrados
router.get("/filtros/buscar", async (req, res) => {
    try {
        const { tipo, precioMax, fecha, lugar } = req.query;
        
        let query = `
            SELECT 
                e.eventoId, e.nombre, e.tipo, e.fecha, e.imagen,
                l.nombre AS lugar, l.direccion,
                MIN(pb.precio) AS precioMin,
                MAX(pb.precio) AS precioMax
            FROM Evento e
            JOIN Lugares l ON e.lugarId = l.id
            JOIN PreciosBloques pb ON e.eventoId = pb.eventoId
            WHERE 1=1
        `;
        
        const params = {};
        
        if (tipo) {
            query += ` AND e.tipo = @tipo`;
            params["tipo"] = tipo;
        }
        
        if (precioMax) {
            query += ` AND pb.precio <= @precioMax`;
            params["precioMax"] = parseFloat(precioMax);
        }
        
        if (fecha) {
            query += ` AND CONVERT(DATE, e.fecha) = @fecha`;
            params["fecha"] = new Date(fecha);
        }
        
        if (lugar) {
            query += ` AND l.id = @lugar`;
            params["lugar"] = parseInt(lugar);
        }
        
        query += ` GROUP BY e.eventoId, e.nombre, e.tipo, e.fecha, e.imagen, l.nombre, l.direccion`;
        
        const pool = await poolPromise;
        const request = pool.request();
        
        // Agregar parámetros dinámicamente
        for (const [key, value] of Object.entries(params)) {
            request.input(key, value);
        }
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error("Error al filtrar eventos:", err);
        res.status(500).json({ error: "Error al filtrar eventos" });
    }
});

// Rutas para gestión de preventa
router.get("/preventa/:eventoId", async (req, res) => {
    try {
        const eventoId = req.params.eventoId;
        const pool = await poolPromise;
        
        // Obtener información de preventa si existe
        const preventaResult = await pool.request()
            .input("eventoId", sql.Int, eventoId)
            .query(`
                SELECT p.*, 
                       STRING_AGG(pm.tipoTarjeta, ', ') AS metodosPago
                FROM Preventas p
                LEFT JOIN PreventaMetodosPago pm ON p.preventaId = pm.preventaId
                WHERE p.eventoId = @eventoId
                GROUP BY p.preventaId, p.eventoId, p.fechaInicio, p.fechaFin, p.habilitada, p.tarjetasPermitidas

            `);
        
        const preventa = preventaResult.recordset[0] || null;
        
        // Obtener métodos de pago disponibles
        const metodosPagoResult = await pool.request()
            .query(`
                SELECT DISTINCT TipoTarjeta 
                FROM Tarjetas
                WHERE TipoTarjeta IN ('Visa', 'Mastercard', 'American Express')
            `);
        
        res.json({
            preventa,
            metodosPagoDisponibles: metodosPagoResult.recordset
        });
    } catch (err) {
        console.error("Error al obtener datos de preventa:", err);
        res.status(500).json({ error: "Error al obtener datos de preventa" });
    }
});

router.post("/preventa/crear", async (req, res) => {
    try {
        const { eventoId, fechaInicio, fechaFin, metodosPago } = req.body;
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        
        await transaction.begin();
        
        try {
            // Crear la preventa
            const preventaResult = await new sql.Request(transaction)
                .input("eventoId", sql.Int, eventoId)
                .input("fechaInicio", sql.DateTime, new Date(fechaInicio))
                .input("fechaFin", sql.DateTime, new Date(fechaFin))
                .input("tarjetasPermitidas", sql.NVarChar(255), metodosPago.join(', '))

                .query(`
                    INSERT INTO Preventas (eventoId, fechaInicio, fechaFin, tarjetasPermitidas)
                    VALUES (@eventoId, @fechaInicio, @fechaFin, @tarjetasPermitidas);
                    SELECT SCOPE_IDENTITY() AS preventaId;
                `);
            
            const preventaId = preventaResult.recordset[0].preventaId;
            
            // Agregar métodos de pago aceptados
            for (const metodo of metodosPago) {
                await new sql.Request(transaction)
                    .input("preventaId", sql.Int, preventaId)
                    .input("tipoTarjeta", sql.VarChar(50), metodo)
                    .query(`
                        INSERT INTO PreventaMetodosPago (preventaId, tipoTarjeta)
                        VALUES (@preventaId, @tipoTarjeta)
                    `);
            }
            
            // Configurar disponibilidad inicial (opcional)
            const bloquesResult = await new sql.Request(transaction)
                .input("eventoId", sql.Int, eventoId)
                .query(`
                    SELECT b.id AS bloqueId, a.cantidad
                    FROM PreciosBloques pb
                    JOIN Bloques b ON pb.bloqueId = b.id
                    JOIN Asientos a ON b.id = a.bloqueId
                    WHERE pb.eventoId = @eventoId
                `);
            
            for (const bloque of bloquesResult.recordset) {
                await new sql.Request(transaction)
                    .input("preventaId", sql.Int, preventaId)
                    .input("bloqueId", sql.Int, bloque.bloqueId)
                    .input("cantidad", sql.Int, bloque.cantidad)
                    .query(`
                        INSERT INTO PreventaDisponibilidad (preventaId, bloqueId, cantidad)
                        VALUES (@preventaId, @bloqueId, @cantidad)
                    `);
            }
            
            await transaction.commit();
            
            res.json({ 
                success: true, 
                message: "Preventa configurada correctamente",
                preventaId 
            });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error("Error al crear preventa:", err);
        res.status(500).json({ error: "Error al crear preventa" });
    }
});

router.post("/preventa/:id/actualizar-disponibilidad", async (req, res) => {
    try {
        const preventaId = req.params.id;
        const { bloqueId, cantidad } = req.body;
        
        const pool = await poolPromise;
        
        await pool.request()
            .input("preventaId", sql.Int, preventaId)
            .input("bloqueId", sql.Int, bloqueId)
            .input("cantidad", sql.Int, cantidad)
            .query(`
                UPDATE PreventaDisponibilidad
                SET cantidad = @cantidad
                WHERE preventaId = @preventaId AND bloqueId = @bloqueId
            `);
        
        res.json({ success: true, message: "Disponibilidad actualizada" });
    } catch (err) {
        console.error("Error al actualizar disponibilidad:", err);
        res.status(500).json({ error: "Error al actualizar disponibilidad" });
    }
});

router.post("/con-preventa", async (req, res) => {
    try {
        const email = req.body.email;

        if (!email) {
            return res.status(400).json({ error: "Email no proporcionado" });
        }

        const pool = await poolPromise;

        // 1️⃣ Obtener ID del usuario
        const usuarioResult = await pool.request()
            .input("email", sql.VarChar, email)
            .query(`SELECT id AS UsuarioId FROM Usuarios WHERE CorreoElectronico = @email`);

        if (usuarioResult.recordset.length === 0) {
            console.log("❌ Usuario no encontrado con email:", email);
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const usuarioId = usuarioResult.recordset[0].UsuarioId;

        // 2️⃣ Obtener tipos de tarjeta del usuario
        const tarjetasUsuario = await pool.request()
            .input("usuarioId", sql.Int, usuarioId)
            .query(`SELECT DISTINCT TipoTarjeta FROM Tarjetas WHERE UsuarioId = @usuarioId`);

        const tiposUsuario = tarjetasUsuario.recordset.map(t => t.TipoTarjeta.trim().toLowerCase());
        console.log("✅ Tipos de tarjeta del usuario:", tiposUsuario);

        if (tiposUsuario.length === 0) {
            return res.json([]);
        }

        // 3️⃣ Obtener eventos con preventa habilitada (sin filtro por fecha)
        const eventosResult = await pool.request().query(`
            SELECT 
                e.eventoId, e.nombre, e.tipo, e.fecha, e.imagen,
                l.nombre AS lugarNombre,
                p.fechaInicio, p.fechaFin,
                p.tarjetasPermitidas AS metodosPago
            FROM Evento e
            JOIN Lugares l ON e.lugarId = l.id
            JOIN Preventas p ON e.eventoId = p.eventoId
            WHERE p.habilitada = 1
        `);

        console.log("🟡 Total eventos encontrados con preventa:", eventosResult.recordset.length);

        // 4️⃣ Filtrar eventos por coincidencia de tarjeta
        const eventosFiltrados = eventosResult.recordset.filter(evento => {
            console.log(`➡️ Evento: ${evento.nombre} - tarjetasPermitidas: ${evento.metodosPago}`);
            const metodosPermitidos = evento.metodosPago.split(',').map(m => m.trim().toLowerCase());
            return tiposUsuario.some(tipo => metodosPermitidos.includes(tipo));
        });

        console.log("✅ Eventos filtrados:", eventosFiltrados.map(e => e.nombre));

        return res.json(eventosFiltrados);

    } catch (err) {
        console.error("❌ Error en /con-preventa:", err);
        return res.status(500).json({ error: "Error interno al cargar preventas" });
    }
});




module.exports = router;