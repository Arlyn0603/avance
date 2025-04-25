

const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../config/db");
const nodemailer = require("nodemailer");

// Configuración de Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'officialeasyticket1@gmail.com',
        pass: 'ajub egsz gwof nvzw'
    }
});

// Obtener todos los usuarios
// Obtener todos los usuarios (con filtro opcional)
router.get("/get-users", async (req, res) => {
    try {
        const searchTerm = req.query.search || '';
        const pool = await poolPromise;
        
        let query = "SELECT id, Nombres, Apellidos, Provincia, CorreoElectronico, tipo FROM Usuarios";
        
        if (searchTerm) {
            query += " WHERE CorreoElectronico LIKE @search";
        }
        
        const request = pool.request();
        if (searchTerm) {
            request.input('search', sql.VarChar, `%${searchTerm}%`);
        }
        
        const result = await request.query(query);
        
        const users = result.recordset.map(user => ({
            Id: user.id,
            Nombres: user.Nombres,
            Apellidos: user.Apellidos,
            Provincia: user.Provincia,
            CorreoElectronico: user.CorreoElectronico,
            tipo: user.tipo
        }));
        
        res.json({ success: true, users: users });
    } catch (err) {
        console.error("Error al obtener usuarios:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Buscar usuarios por correo electrónico
router.get("/search-by-email", async (req, res) => {
    try {
        const email = req.query.email || '';
        const pool = await poolPromise;
        
        const result = await pool.request()
            .input('email', sql.VarChar, `%${email}%`)
            .query(`
                SELECT id, Nombres, Apellidos, Provincia, CorreoElectronico, tipo 
                FROM Usuarios 
                WHERE CorreoElectronico LIKE @email
            `);
        
        const users = result.recordset.map(user => ({
            Id: user.id,
            Nombres: user.Nombres,
            Apellidos: user.Apellidos,
            Provincia: user.Provincia,
            CorreoElectronico: user.CorreoElectronico,
            tipo: user.tipo
        }));
        
        res.json({ success: true, users: users });
    } catch (err) {
        console.error("Error al buscar usuarios por correo:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Obtener un usuario específico
router.get("/get-user/:id", async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
        return res.status(400).json({ success: false, message: "ID debe ser un número" });
    }

        const pool = await poolPromise;
        const result = await pool.request()
            .input("id", sql.Int, userId)
            .query("SELECT * FROM Usuarios WHERE id = @id");
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }
        
        res.json({ success: true, user: result.recordset[0] });
    } catch (err) {
        console.error("Error al obtener usuario:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});
// Actualizar usuario
router.put("/update-user/:id", async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (isNaN(userId) || userId <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "ID de usuario debe ser un número positivo" 
            });
        }

        const { nombres, apellidos, provincia, correo, tipo } = req.body;
        const pool = await poolPromise;
        
        await pool.request()
            .input("id", sql.Int, userId)
            .input("nombres", sql.VarChar, nombres)
            .input("apellidos", sql.VarChar, apellidos)
            .input("provincia", sql.VarChar, provincia)
            .input("correo", sql.VarChar, correo)
            .input("tipo", sql.NVarChar, tipo)
            .query(`
                UPDATE Usuarios 
                SET Nombres = @nombres, 
                    Apellidos = @apellidos, 
                    Provincia = @provincia, 
                    CorreoElectronico = @correo, 
                    tipo = @tipo 
                WHERE Id = @id
            `);
        
        res.json({ success: true, message: "Usuario actualizado correctamente" });
    } catch (err) {
        console.error("Error al actualizar usuario:", err);
        res.status(500).json({ 
            success: false, 
            message: "Error del servidor",
            errorDetails: err.message 
        });
    }
});

// Eliminar usuario
router.delete("/delete-user/:id", async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        
        if (isNaN(userId) || userId <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "ID de usuario inválido"
            });
        }

        const pool = await poolPromise;
        
        // Iniciar transacción
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            // 1. Primero eliminar registros relacionados
            await transaction.request()
                .input("usuarioId", sql.Int, userId)
                .query("DELETE FROM RecuperacionContrasena WHERE UsuarioId = @usuarioId");
            
            // 2. Luego eliminar el usuario
            const result = await transaction.request()
                .input("id", sql.Int, userId)
                .query("DELETE FROM Usuarios WHERE Id = @id");
            
            if (result.rowsAffected[0] === 0) {
                await transaction.rollback();
                return res.status(404).json({ 
                    success: false, 
                    message: "Usuario no encontrado"
                });
            }
            
            await transaction.commit();
            res.json({ success: true, message: "Usuario eliminado correctamente" });
            
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
        
    } catch (err) {
        console.error("Error al eliminar usuario:", err);
        res.status(500).json({ 
            success: false, 
            message: "Error al eliminar usuario",
            errorDetails: err.message
        });
    }
});

// Solicitar cambio de contraseña
router.post("/request-password-change", async (req, res) => {
    try {
        const { email } = req.body;
        const pool = await poolPromise;
        
        // Verificar si el usuario existe
        const userResult = await pool.request()
            .input("email", sql.VarChar, email)
            .query("SELECT Id FROM Usuarios WHERE CorreoElectronico = @email");
        
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }
        
        // Generar código de verificación
        const verificationCode = Math.floor(100000 + Math.random() * 900000);
        
        // Guardar en sesión temporalmente
        req.session.passwordReset = {
            email,
            code: verificationCode.toString(),
            expires: Date.now() + 300000 // 5 minutos
        };
        
        // Enviar correo de verificación
        const mailOptions = {
            from: 'officialeasyticket1@gmail.com',
            to: email,
            subject: "Cambio de contraseña - EasyTicket",
            html: `
                <h2>Solicitud de cambio de contraseña</h2>
                <p>Se ha solicitado un cambio de contraseña para tu cuenta.</p>
                <p>Tu código de verificación es: <strong>${verificationCode}</strong></p>
                <p>Este código expirará en 5 minutos.</p>
                <p>Si no solicitaste este cambio, por favor ignora este correo.</p>
            `
        };
        
        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: "Código de verificación enviado al correo electrónico" 
        });
    } catch (err) {
        console.error("Error al solicitar cambio de contraseña:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Confirmar cambio de contraseña
router.post("/confirm-password-change", async (req, res) => {
    try {
        const { email, newPassword, code } = req.body;
        
        // Verificar sesión
        if (!req.session.passwordReset || 
            req.session.passwordReset.expires < Date.now()) {
            return res.status(400).json({ 
                success: false, 
                message: "Solicitud expirada o inválida" 
            });
        }
        
        // Verificar código
        if (code !== req.session.passwordReset.code || 
            email !== req.session.passwordReset.email) {
            return res.status(400).json({ 
                success: false, 
                message: "Código de verificación incorrecto o no coincide con el correo" 
            });
        }
        
        const pool = await poolPromise;
        
        // Actualizar contraseña (sin encriptación)
        await pool.request()
            .input("email", sql.VarChar, email)
            .input("password", sql.VarChar, newPassword)
            .query(`
                UPDATE Usuarios 
                SET Contrasena = @password 
                WHERE CorreoElectronico = @email
            `);
        
        // Limpiar sesión
        delete req.session.passwordReset;
        
        res.json({ 
            success: true, 
            message: "Contraseña actualizada correctamente" 
        });
    } catch (err) {
        console.error("Error al confirmar cambio de contraseña:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Solicitar cambio de correo para autenticación
router.post("/request-auth-email-change", async (req, res) => {
    try {
        const { newEmail } = req.body;
        
        // Validar formato de correo
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            return res.status(400).json({ success: false, message: "Formato de correo inválido" });
        }
        
        const pool = await poolPromise;
        
        // Verificar si el correo ya está en uso
        const emailCheck = await pool.request()
            .input("email", sql.VarChar, newEmail)
            .query(`
                SELECT Id FROM Usuarios 
                WHERE CorreoElectronico = @email OR CorreoAutenticacion = @email
            `);
            
        if (emailCheck.recordset.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "El correo electrónico ya está en uso" 
            });
        }
        
        // Generar código de verificación
        const verificationCode = Math.floor(100000 + Math.random() * 900000);
        
        // Guardar en sesión temporalmente
        req.session.authEmailChange = {
            newEmail,
            code: verificationCode.toString(),
            expires: Date.now() + 300000 // 5 minutos
        };
        
        // Enviar correo de verificación
        const mailOptions = {
            from: 'officialeasyticket1@gmail.com',
            to: newEmail,
            subject: "Verificación de cambio de correo - EasyTicket",
            html: `
                <h2>Verificación de cambio de correo</h2>
                <p>Has solicitado cambiar el correo para autenticación de dos factores.</p>
                <p>Tu código de verificación es: <strong>${verificationCode}</strong></p>
                <p>Este código expirará en 5 minutos.</p>
            `
        };
        
        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: "Código de verificación enviado al nuevo correo" 
        });
    } catch (err) {
        console.error("Error al solicitar cambio de correo:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Confirmar cambio de correo para autenticación
router.post("/confirm-auth-email-change", async (req, res) => {
    try {
        const { code } = req.body;
        
        // Verificar sesión
        if (!req.session.authEmailChange || 
            req.session.authEmailChange.expires < Date.now()) {
            return res.status(400).json({ 
                success: false, 
                message: "Solicitud expirada o inválida" 
            });
        }
        
        // Verificar código
        if (code !== req.session.authEmailChange.code) {
            return res.status(400).json({ 
                success: false, 
                message: "Código de verificación incorrecto" 
            });
        }
        
        const pool = await poolPromise;
        
        // Actualizar correo de autenticación
        await pool.request()
            .input("newEmail", sql.VarChar, req.session.authEmailChange.newEmail)
            .input("id", sql.Int, req.session.user.id)
            .query(`
                UPDATE Usuarios 
                SET CorreoAutenticacion = @newEmail 
                WHERE Id = @id
            `);
        
        // Limpiar sesión
        delete req.session.authEmailChange;
        
        res.json({ 
            success: true, 
            message: "Correo de autenticación actualizado correctamente" 
        });
    } catch (err) {
        console.error("Error al confirmar cambio de correo:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Obtener roles existentes
router.get("/get-roles", async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query("SELECT DISTINCT tipo FROM Usuarios WHERE tipo IS NOT NULL");
        
        res.json({ 
            success: true, 
            roles: result.recordset.map(r => r.tipo) 
        });
    } catch (err) {
        console.error("Error al obtener roles:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Crear nuevo rol
router.post("/create-role", async (req, res) => {
    try {
        const { roleName, roleDescription } = req.body;
        
        if (!roleName || !roleDescription) {
            return res.status(400).json({ 
                success: false, 
                message: "Nombre y descripción del rol son requeridos" 
            });
        }
        
        // En este caso, como solo tenemos el campo 'tipo' en la tabla Usuarios,
        // simplemente verificamos que el rol no exista ya en los usuarios
        const pool = await poolPromise;
        const checkResult = await pool.request()
            .input("roleName", sql.NVarChar, roleName)
            .query("SELECT TOP 1 Id FROM Usuarios WHERE tipo = @roleName");
        
        if (checkResult.recordset.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "El rol ya existe" 
            });
        }
        
        res.json({ 
            success: true, 
            message: "Rol creado correctamente" 
        });
    } catch (err) {
        console.error("Error al crear rol:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

// Eliminar rol
router.delete("/delete-role/:roleName", async (req, res) => {
    try {
        const { roleName } = req.params;
        
        if (!roleName) {
            return res.status(400).json({ 
                success: false, 
                message: "Nombre del rol es requerido" 
            });
        }
        
        // Verificar si el rol está en uso
        const pool = await poolPromise;
        const checkResult = await pool.request()
            .input("roleName", sql.NVarChar, roleName)
            .query("SELECT TOP 1 Id FROM Usuarios WHERE tipo = @roleName");
        
        if (checkResult.recordset.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "No se puede eliminar el rol porque hay usuarios asignados a él" 
            });
        }
        
        res.json({ 
            success: true, 
            message: "Rol eliminado correctamente" 
        });
    } catch (err) {
        console.error("Error al eliminar rol:", err);
        res.status(500).json({ success: false, message: "Error del servidor" });
    }
});

module.exports = router;