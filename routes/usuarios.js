const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../config/db");
const nodemailer = require("nodemailer");

// Configuración de Nodemailer para enviar correos
const transporter = nodemailer.createTransport({
    service: 'gmail', // Puedes usar otro servicio
    auth: {
        user: 'officialeasyticket1@gmail.com', // Cambia esto por tu correo
        pass: 'ajub egsz gwof nvzw' // Cambia esto por tu contraseña
    }
});

function enviarCorreo(destinatario, codigo) {
    return new Promise((resolve, reject) => {
        const mailOptions = {
            from: 'officialeasyticket1@gmail.com',
            to: destinatario,
            subject: 'Código de Verificación',
            text: `Tu código de verificación es: ${codigo}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Error enviando correo:", error);
                resolve(false); // Devuelve false si hay un error
            } else {
                console.log("Correo enviado:", info.response);
                resolve(true); // Devuelve true si el correo se envió correctamente
            }
        });
    });
}


// Ruta para registrar un nuevo usuario
router.post("/registrar", async (req, res) => {
    try {
        const { firstName, lastName, province, email, password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            return res.status(400).json({ success: false, message: "Las contraseñas no coinciden" });
        }

        const pool = await poolPromise;
        const checkUser = await pool.request()
            .input("email", sql.VarChar, email)
            .query("SELECT * FROM Usuarios WHERE CorreoElectronico = @email");

        if (checkUser.recordset.length > 0) {
            return res.status(400).json({ success: false, message: "El correo electrónico ya está registrado" });
        }

        await pool.request()
            .input("firstName", sql.VarChar, firstName)
            .input("lastName", sql.VarChar, lastName)
            .input("province", sql.VarChar, province)
            .input("email", sql.VarChar, email)
            .input("password", sql.VarChar, password) // En un caso real, deberías hashear la contraseña
            .query("INSERT INTO Usuarios (Nombres, Apellidos, Provincia, CorreoElectronico, Contrasena) VALUES (@firstName, @lastName, @province, @email, @password)");

        res.status(201).json({ success: true, message: "Usuario registrado exitosamente" });
    } catch (err) {
        console.error("❌ Error al registrar usuario", err);
        res.status(500).json({ success: false, message: "Error en el servidor" });
    }
});

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input("email", sql.VarChar, email)
            .query("SELECT * FROM Usuarios WHERE CorreoElectronico = @email");

        if (result.recordset.length === 0) {
            return res.status(400).json({ success: false, message: "El correo o la contraseña son incorrectos" });
        }

        const usuario = result.recordset[0];

        if (usuario.Contrasena !== password) {
            return res.status(400).json({ success: false, message: "El correo o la contraseña son incorrectos" });
        }

        // Generar el código de verificación
        const random = Math.floor(100000 + Math.random() * 900000); // Código de 6 dígitos
        const expirationTime = Date.now() + 5 * 60 * 1000; // Expira en 5 minutos

        // Guardar el código y la expiración en la sesión
        req.session.verificationCode = random;
        req.session.codeExpiration = expirationTime;

        req.session.email = email; // ← Esta línea es crucial
        req.session.verificationCode = random;
        req.session.codeExpiration = Date.now() + 5 * 60 * 1000;

        // Enviar el correo con el código de verificación
        const success = await enviarCorreo(usuario.CorreoElectronico, random.toString());
        if (!success) {
            return res.status(500).json({ success: false, message: "Error al enviar el código de verificación." });
        }

        res.status(200).json({ success: true, message: "Código enviado a tu correo para verificar." });
    } catch (err) {
        console.error("❌ Error al iniciar sesión", err);
        res.status(500).json({ success: false, message: "Error en el servidor. Inténtalo de nuevo más tarde." });
    }
});


// Ruta para verificar el código de autenticación
router.post("/verificarCodigo", async (req, res) => {
    try {
        const { code } = req.body;

        // 1. Verificar que exista el código en sesión
        if (!req.session.verificationCode || !req.session.email) {
            return res.status(400).json({ 
                success: false, 
                message: "Sesión inválida. Vuelve a iniciar sesión." 
            });
        }

        // 2. Verificar el código
        if (parseInt(code) !== req.session.verificationCode) {
            return res.status(400).json({ 
                success: false, 
                message: "Código incorrecto." 
            });
        }

        console.log("Session contents:", {
            email: req.session.email,
            verificationCode: req.session.verificationCode,
            user: req.session.user
        });
        // 3. Buscar al usuario usando el email de la sesión
        const pool = await poolPromise;
        const result = await pool.request()
            .input("email", sql.VarChar, req.session.email)  // Cambiar 'email' por 'req.session.email'
            .query("SELECT id, CorreoElectronico, Nombres, Apellidos, tipo FROM Usuarios WHERE CorreoElectronico = @email");

        if (result.recordset.length === 0) {
            // Esto NO debería ocurrir si el login fue exitoso
            return res.status(404).json({ 
                success: false, 
                message: "Usuario no encontrado en la base de datos." 
            });
        }

        // 4. Guardar usuario en sesión
        const user = result.recordset[0];
        req.session.user = {
            id: user.id,
            email: user.CorreoElectronico,
            firstName: user.Nombres,
            lastName: user.Apellidos,
            tipo: user.tipo  // Asegúrate de incluir esto
        };
        

        // 5. Limpiar datos temporales
        delete req.session.verificationCode;
        delete req.session.codeExpiration;
        delete req.session.email;

        // 6. Responder con éxito
        res.status(200).json({ 
            success: true, 
            message: "¡Autenticación exitosa!",
            user: req.session.user
        });

    } catch (err) {
        console.error("❌ Error al verificar código:", err);
        res.status(500).json({ 
            success: false, 
            message: "Error interno del servidor" 
        });
    }
});

// Ruta para solicitar recuperación de contraseña
router.post('/solicitar-recuperacion', async (req, res) => {
    console.log('Solicitud de recuperación recibida:', req.body);
    
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ 
            success: false, 
            message: "Email es requerido" 
        });
    }
    
    try {
        const pool = await poolPromise;
        
        // 1. Verificar si el usuario existe
        const userResult = await pool.request()
            .input('email', sql.VarChar, email)
            .query('SELECT id, CorreoElectronico, Nombres FROM Usuarios WHERE CorreoElectronico = @email');
        
        if (userResult.recordset.length === 0) {
            // No revelamos que el email no existe por seguridad
            return res.status(200).json({ 
                success: true, 
                message: "Si el correo existe, se enviarán instrucciones" 
            });
        }

        const usuario = userResult.recordset[0];
        
        // 2. Generar token único
        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const fechaExpiracion = new Date(Date.now() + 3600000); // 1 hora de expiración
        
        // 3. Guardar token en la base de datos
        await pool.request()
            .input('UsuarioId', sql.Int, usuario.id)
            .input('Token', sql.VarChar(64), token)
            .input('FechaExpiracion', sql.DateTime, fechaExpiracion)
            .query(`
                INSERT INTO RecuperacionContrasena 
                (UsuarioId, Token, FechaExpiracion) 
                VALUES (@UsuarioId, @Token, @FechaExpiracion)
            `);
        
        // 4. Crear enlace de recuperación
        const resetLink = `http://localhost:3003/usuarios/recuperar-contrasena?token=${token}`;
        
        // 5. Configurar y enviar el correo
        const mailOptions = {
            from: 'officialeasyticket1@gmail.com',
            to: email,
            subject: 'Recuperación de contraseña - EasyTicket',
            html: `
                <h2>Hola ${usuario.Nombres}</h2>
                <p>Hemos recibido una solicitud para restablecer tu contraseña en EasyTicket.</p>
                <p>Haz clic en el siguiente enlace para continuar:</p>
                <a href="${resetLink}" style="
                    display: inline-block;
                    padding: 10px 20px;
                    background-color: #4CAF50;
                    color: white;
                    text-decoration: none;
                    border-radius: 5px;
                    margin: 10px 0;
                ">Restablecer Contraseña</a>
                <p>Si no solicitaste este cambio, puedes ignorar este mensaje.</p>
                <p><small>El enlace expirará en 1 hora.</small></p>
                <hr>
                <p>Equipo de EasyTicket</p>
            `
        };
        
        // 6. Enviar el correo
        await transporter.sendMail(mailOptions);
        console.log('Correo de recuperación enviado a:', email);
        
        res.status(200).json({ 
            success: true, 
            message: "Si el correo existe, se enviarán instrucciones" 
        });
    } catch (err) {
        console.error("Error en recuperación de contraseña:", {
            message: err.message,
            stack: err.stack
        });
        res.status(500).json({ 
            success: false, 
            message: "Error al procesar la solicitud"
        });
    }
});
// Ruta para mostrar el formulario de nueva contraseña
router.get('/recuperar-contrasena', async (req, res) => {
    const { token } = req.query;
    
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('Token', sql.VarChar, token)
            .query(`
                SELECT UsuarioId, FechaExpiracion, Usado 
                FROM RecuperacionContrasena 
                WHERE Token = @Token
            `);
        
        if (result.recordset.length === 0) {
            return res.render('recuperacion-invalida');
        }
        
        const tokenData = result.recordset[0];
        const ahora = new Date();
        
        if (tokenData.Usado || new Date(tokenData.FechaExpiracion) < ahora) {
            return res.render('recuperacion-invalida');
        }
        
        res.render('nueva-contrasena', { token });
    } catch (err) {
        console.error("Error al verificar token:", err);
        res.render('recuperacion-invalida');
    }
});

// Ruta para actualizar la contraseña
router.post('/actualizar-contrasena', async (req, res) => {
    const { token, nuevaContrasena, confirmarContrasena } = req.body;
    
    if (nuevaContrasena !== confirmarContrasena) {
        return res.status(400).json({ 
            success: false, 
            message: "Las contraseñas no coinciden" 
        });
    }
    
    try {
        const pool = await poolPromise;
        // Verificar token
        const tokenResult = await pool.request()
            .input('Token', sql.VarChar, token)
            .query(`
                SELECT UsuarioId, FechaExpiracion, Usado 
                FROM RecuperacionContrasena 
                WHERE Token = @Token
            `);
        
        if (tokenResult.recordset.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Token inválido" 
            });
        }
        
        const tokenData = tokenResult.recordset[0];
        const ahora = new Date();
        
        if (tokenData.Usado || new Date(tokenData.FechaExpiracion) < ahora) {
            return res.status(400).json({ 
                success: false, 
                message: "Token expirado o ya usado" 
            });
        }
        
        // Actualizar contraseña
        await pool.request()
            .input('UsuarioId', sql.Int, tokenData.UsuarioId)
            .input('Contrasena', sql.VarChar, nuevaContrasena)
            .query('UPDATE Usuarios SET Contrasena = @Contrasena WHERE id = @UsuarioId');
        
        // Marcar token como usado
        await pool.request()
            .input('Token', sql.VarChar, token)
            .query('UPDATE RecuperacionContrasena SET Usado = 1 WHERE Token = @Token');
        
        res.status(200).json({ 
            success: true, 
            message: "Contraseña actualizada correctamente" 
        });
    } catch (err) {
        console.error("Error al actualizar contraseña:", err);
        res.status(500).json({ 
            success: false, 
            message: "Error al actualizar la contraseña" 
        });
    }
});
//Cambiar la contraseña del usuario logueado
router.post("/usuario/enviar-codigo", async (req, res) => {
    try {
        const { firstName, lastName, provincia, password } = req.body;
        const email = req.session.user.email; // El correo es la PK y no se puede cambiar

        // Generar un código de verificación de 6 dígitos
        const verificationCode = Math.floor(100000 + Math.random() * 900000);
        req.session.verificationCode = verificationCode;

        // Enviar el correo con el código de verificación
        const success = await enviarCorreo(email, verificationCode.toString());
        if (!success) {
            return res.status(500).json({ success: false, message: "Error al enviar el código de verificación." });
        }

        // Guardar los datos en la sesión temporalmente
        req.session.updateData = { firstName, lastName, provincia, password };

        res.status(200).json({ success: true, message: "Código enviado a tu correo para verificar." });
    } catch (err) {
        console.error("Error al enviar el código de verificación:", err);
        res.status(500).json({ success: false, message: "Error interno del servidor." });
    }
});

router.post("/usuario/verificar-codigo", async (req, res) => {
    try {
        const { code } = req.body;

        // Verificar si el código coincide
        if (parseInt(code) !== req.session.verificationCode) {
            return res.status(400).json({ success: false, message: "El código de verificación es incorrecto." });
        }

        const { firstName, lastName, provincia, password } = req.session.updateData;
        const email = req.session.user.email; // El correo es la PK

        // Actualizar los datos en la base de datos
        const pool = await poolPromise;
        const request = pool.request();
        request.input("Email", sql.VarChar, email);
        request.input("FirstName", sql.VarChar, firstName);
        request.input("LastName", sql.VarChar, lastName);
        request.input("Provincia", sql.VarChar, provincia);
        request.input("Password", sql.VarChar, password || null);
        await request.execute("ActualizarUsuario");

        // Actualizar los datos en la sesión
        req.session.user.firstName = firstName;
        req.session.user.lastName = lastName;
        req.session.user.provincia = provincia;

        // Limpiar los datos temporales de la sesión
        delete req.session.verificationCode;
        delete req.session.updateData;

        res.status(200).json({ success: true, message: "Información actualizada exitosamente." });
    } catch (err) {
        console.error("Error al verificar el código y guardar los cambios:", err);
        res.status(500).json({ success: false, message: "Error interno del servidor." });
    }
});

// Ruta para mostrar formulario de login específico para lectores
router.get('/login-lector', (req, res) => {
    const redirectUrl = req.query.redirect || '/';
    res.render('login-lector', { 
        redirectUrl: redirectUrl,
        errorMessage: null 
    });
});

// Ruta para procesar login de lectores
router.post('/login-lector', async (req, res) => {
    const { email, password, redirectUrl } = req.body;
    
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('email', sql.VarChar, email)
            .query('SELECT * FROM Usuarios WHERE CorreoElectronico = @email');
        
        if (result.recordset.length === 0) {
            return res.render('login-lector', { 
                redirectUrl: redirectUrl,
                errorMessage: 'Usuario no encontrado' 
            });
        }
        
        const user = result.recordset[0];
        
       
        
        // Verificar que el usuario sea de tipo "Lector"
        if (user.tipo !== "Lector") {
            return res.render('login-lector', { 
                redirectUrl: redirectUrl,
                errorMessage: 'Solo usuarios de tipo "Lector" pueden validar entradas' 
            });
        }
        
        // Establecer sesión
        req.session.user = {
            id: user.id,
            email: user.email,
            nombre: user.nombre,
            tipo: user.tipo
        };
        
        // Redirigir a la URL original (que incluye el token QR)
        res.redirect(redirectUrl || '/');
        
    } catch (error) {
        console.error('Error en login:', error);
        res.render('login-lector', { 
            redirectUrl: redirectUrl,
            errorMessage: 'Error al iniciar sesión' 
        });
    }
});

module.exports = router;