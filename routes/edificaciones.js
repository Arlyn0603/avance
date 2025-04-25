const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../config/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configuración de multer para guardar imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Asegúrate de que la carpeta exista
        const uploadPath = path.join(__dirname, "../public/img/lugares");
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true }); // Crear la carpeta si no existe
        }
        cb(null, uploadPath); // Guardar en img/lugares
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "lugar-" + uniqueSuffix + path.extname(file.originalname)); // Nombre único para evitar conflictos
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        // Verificar si el archivo es una imagen válida
        if (file.mimetype.startsWith("image/")) {
            cb(null, true); // Aceptar el archivo
        } else {
            cb(new Error("Solo se permiten imágenes"), false); // Rechazar el archivo
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

router.post("/crear", upload.single("imagen"), async (req, res) => {
    const { nombre, direccion, descripcion, capacidad, bloques } = req.body;
    
    // 1) Validaciones básicas mejoradas
    if (!nombre?.trim() || !capacidad || !bloques?.trim()) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({
            success: false,
            message: "Nombre, capacidad y bloques son campos obligatorios.",
            fields: {
                nombre: !nombre?.trim(),
                capacidad: !capacidad,
                bloques: !bloques?.trim()
            }
        });
    }

    // 2) Validación de capacidad
    if (isNaN(capacidad) || capacidad <= 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({
            success: false,
            message: "La capacidad debe ser un número mayor a cero."
        });
    }

    // 3) Parseo y validación de bloques
    let bloquesArray;
    try {
        bloquesArray = JSON.parse(bloques);
        if (!Array.isArray(bloquesArray)) {
            throw new Error("Los bloques deben ser un arreglo");
        }

        // Validación profunda de cada bloque
        const bloquesValidos = bloquesArray.every(bloque => {
            return bloque.nombre?.trim() && 
                   !isNaN(bloque.asientos) && 
                   bloque.asientos > 0;
        });

        if (!bloquesValidos || bloquesArray.length === 0) {
            throw new Error("Cada bloque debe tener nombre y asientos válidos");
        }

    } catch (err) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({
            success: false,
            message: "Formato de bloques inválido: ${err.message}",
            expectedFormat: [
                {
                    nombre: "Nombre del bloque",
                    asientos: "Número entero positivo",
                    tipo: "Opcional (general, vip, preferencial)"
                }
            ]
        });
    }

    // 4) Validación de capacidad total vs asientos
    const totalAsientos = bloquesArray.reduce((sum, bloque) => sum + parseInt(bloque.asientos), 0);
    if (totalAsientos > parseInt(capacidad)) {
        if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({
                success: false,
                message: "La suma de asientos (${totalAsientos}) excede la capacidad (${capacidad}"
            })
            
    }


    // 5) Manejo de la imagen
    const imagenPath = req.file ? '/img/lugares/${req.file.filename}' : null;
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // ---- Insert en Lugares con validación adicional ----
        const lugarReq = new sql.Request(transaction)
            .input("nombre", sql.NVarChar(100), nombre.trim())
            .input("direccion", sql.NVarChar(200), direccion?.trim() || null)
            .input("descripcion", sql.NVarChar(500), descripcion?.trim() || null)
            .input("capacidad", sql.Int, parseInt(capacidad))
            .input("imagen", sql.NVarChar(255), imagenPath);

        const lugarResult = await lugarReq.query(`
            INSERT INTO Lugares (nombre, direccion, descripcion, capacidad, imagen)
            VALUES (@nombre, @direccion, @descripcion, @capacidad, @imagen);
            SELECT SCOPE_IDENTITY() AS lugarId;
        `);
        
        const lugarId = lugarResult.recordset[0].lugarId;

        // ---- Insert en Bloques y Asientos con transacción ----
        for (const [index, bloque] of bloquesArray.entries()) {
            // Validar nombre único en este conjunto de bloques
            const nombreDuplicado = bloquesArray
                .slice(0, index)
                .some(b => b.nombre.trim().toLowerCase() === bloque.nombre.trim().toLowerCase());
            
            if (nombreDuplicado) {
                throw new Error("Nombre de bloque duplicado: ${bloque.nombre}");
            }

            // Insertar bloque
            const bloqueReq = new sql.Request(transaction)
                .input("lugarId", sql.Int, lugarId)
                .input("nombreBloque", sql.NVarChar(50), bloque.nombre.trim());

            const bloqueResult = await bloqueReq.query(`
                INSERT INTO Bloques (lugarId, nombre)
                VALUES (@lugarId, @nombreBloque);
                SELECT SCOPE_IDENTITY() AS bloqueId;
            `);
            
            const bloqueId = bloqueResult.recordset[0].bloqueId;

            // Insertar asientos
            const asientoReq = new sql.Request(transaction)
                .input("bloqueId", sql.Int, bloqueId)
                .input("cantidad", sql.Int, parseInt(bloque.asientos))
                .input("tipo", sql.NVarChar(20), bloque.tipo || 'general');

            await asientoReq.query(`
                INSERT INTO Asientos (bloqueId, cantidad, tipo)
                VALUES (@bloqueId, @cantidad, @tipo);
            `);
        }

        await transaction.commit();
        
        return res.status(201).json({
            success: true,
            message: "Edificación creada exitosamente",
            data: {
                lugarId,
                totalBloques: bloquesArray.length,
                totalAsientos
            }
        });

    } catch (err) {
        await transaction.rollback();
        
        // Limpieza de archivos en caso de error
        if (req.file) {
            try { 
                fs.unlinkSync(req.file.path); 
            } catch (unlinkErr) {
                console.error("Error al eliminar imagen:", unlinkErr);
            }
        }

        console.error("Error en creación de edificación:", err);
        
        const statusCode = err.message.includes('duplicado') ? 409 : 500;
        const errorMessage = statusCode === 409 
            ? err.message 
            : "Error interno al procesar la solicitud";

        return res.status(statusCode).json({
            success: false,
            message: errorMessage,
            systemError: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }

});

// Obtener todos los lugares
router.get("/", async (req, res) => {
    try {
        const pool = await poolPromise;

        // Obtener lugares
        const lugaresResult = await pool.request().query("SELECT * FROM Lugares");
        const lugares = lugaresResult.recordset;

        // Obtener bloques
        const bloquesResult = await pool.request().query("SELECT * FROM Bloques");
        const bloques = bloquesResult.recordset;

        // Obtener asientos
        const asientosResult = await pool.request().query("SELECT * FROM Asientos");
        const asientos = asientosResult.recordset;

        // Obtener edificaciones (si es necesario, ajusta la consulta según tu base de datos)
        const edificacionesResult = await pool.request().query("SELECT * FROM Lugares"); // Cambia la consulta si es diferente
        const edificaciones = edificacionesResult.recordset;

        // Renderizar la vista con los datos
        res.render("edificaciones", { lugares, bloques, asientos, edificaciones });
    } catch (err) {
        console.error("Error al obtener los datos de edificaciones:", err);
        res.status(500).send("Error al obtener los datos de edificaciones.");
    }
});

router.put("/lugares/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, direccion, descripcion, capacidad } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input("id", sql.Int, id)
            .input("nombre", sql.VarChar, nombre)
            .input("direccion", sql.VarChar, direccion)
            .input("descripcion", sql.Text, descripcion)
            .input("capacidad", sql.Int, capacidad)
            .query(`
                UPDATE Lugares
                SET nombre = @nombre, direccion = @direccion, descripcion = @descripcion, capacidad = @capacidad
                WHERE id = @id
            `);

        res.json({ success: true, message: "Lugar actualizado exitosamente" });
    } catch (err) {
        console.error("Error al actualizar el lugar:", err);
        res.status(500).json({ success: false, message: "Error al actualizar el lugar" });
    }
});

module.exports = router;