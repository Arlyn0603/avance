// Agrega esta línea al inicio del archivo
const express = require('express');
const router = express.Router();

const pdf = require('html-pdf');
const { sql, poolPromise } = require('../config/db');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const fs = require('fs');


// Configuración mejorada del transporter de correo
const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: 'officialeasyticket1@gmail.com',
        pass: 'ajub egsz gwof nvzw'
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Función mejorada para generar el HTML de la factura
function generarHTMLFactura(datos) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
                .container { max-width: 800px; margin: 0 auto; }
                .header { text-align: center; margin-bottom: 20px; }
                .logo { max-width: 150px; }
                .factura-info { display: flex; justify-content: space-between; margin-bottom: 20px; }
                .datos-cliente { background: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                th { background-color: #2c3e50; color: white; }
                .totales { background: #f5f5f5; padding: 15px; border-radius: 5px; }
                .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #777; }
                .asientos { margin-top: 5px; font-size: 0.9em; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>EasyTicket</h1>
                    <h2>Factura #${datos.numeroFactura}</h2>
                    <p>Fecha: ${datos.fecha}</p>
                </div>
                
                <div class="datos-cliente">
                    <h3>Datos del Cliente</h3>
                    <p><strong>Nombre:</strong> ${datos.usuario.firstName} ${datos.usuario.lastName}</p>
                    <p><strong>Email:</strong> ${datos.usuario.email}</p>
                    <p><strong>Método de pago:</strong> ${datos.metodoPago}</p>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th>Evento</th>
                            <th>Bloque/Zona</th>
                            <th>Asientos</th>
                            <th>Cantidad</th>
                            <th>Precio Unitario</th>
                            <th>Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.detalles.map(item => `
                            <tr>
                                <td>${item.nombre}</td>
                                <td>${item.bloqueNombre}</td>
                                <td>
                                    ${(item.asientos && item.asientos.length > 0) ? 
                                      item.asientos.join(', ') : 'No especificado'}
                                    <div class="asientos">(Códigos QR generados)</div>
                                </td>
                                <td>${item.cantidad}</td>
                                <td>₡${item.precioUnitario.toLocaleString()}</td>
                                <td>₡${item.subtotal.toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div class="totales">
                    <p><strong>Subtotal:</strong> ₡${datos.subtotal.toLocaleString()}</p>
                    <p><strong>Impuestos (13%):</strong> ₡${datos.impuestos.toLocaleString()}</p>
                    <p><strong>Tarifa de servicio:</strong> ₡${datos.tarifaServicio.toLocaleString()}</p>
                    <p><strong>Total:</strong> ₡${datos.total.toLocaleString()}</p>
                </div>
                
                <div class="footer">
                    <p>Gracias por su compra. Los códigos QR de sus entradas se han enviado en un archivo adjunto.</p>
                    <p>EasyTicket - Todos los derechos reservados</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

// Función mejorada para generar PDF con códigos QR
async function generarPDFQRs(entradas, facturaNumero) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument();
            const buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);
            
            // Encabezado del documento
            doc.fontSize(20).text('EasyTicket - Entradas', { align: 'center' });
            doc.fontSize(14).text(`Factura #${facturaNumero}`, { align: 'center' });
            doc.moveDown();
            
            let yPosition = 100;
            const pageWidth = doc.page.width - 100;
            
            // Procesar entradas secuencialmente
            for (let i = 0; i < entradas.length; i++) {
                const entrada = entradas[i];
                
                if (yPosition > doc.page.height - 200) {
                    doc.addPage();
                    yPosition = 100;
                }
                
                // Generar código QR con opciones mejoradas
                const qrUrl = `http://localhost:3000/validar-entrada?token=${entrada.token}`;
                const qrDataUrl = await QRCode.toDataURL(qrUrl, {
                    errorCorrectionLevel: 'H',
                    margin: 1,
                    scale: 8,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });
                
                // Convertir Data URL a Buffer
                const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
                
                // Agregar QR al PDF
                doc.image(qrBuffer, 100, yPosition, { width: 150, height: 150 });
                
                // Información de la entrada
                doc.fontSize(12)
                   .text(`Evento: ${entrada.eventoNombre}`, 270, yPosition + 20)
                   .text(`Bloque: ${entrada.bloqueNombre}`, 270, yPosition + 40)
                   .text(`Asiento: ${entrada.asiento}`, 270, yPosition + 60)
                   .text(`Fecha: ${new Date().toLocaleDateString()}`, 270, yPosition + 80);
                
                yPosition += 180;
                
                // Línea separadora
                if (i < entradas.length - 1) {
                    doc.moveTo(50, yPosition - 10).lineTo(pageWidth, yPosition - 10).stroke();
                    doc.moveDown();
                }
            }
            
            doc.end();
        } catch (error) {
            console.error('Error al generar PDF de QRs:', error);
            reject(error);
        }
    });
}

// Ruta para enviar factura con todas las correcciones implementadas
router.post('/enviar-factura', async (req, res) => {
    if (!req.body || !req.body.datosFactura) {
        return res.status(400).json({ 
            success: false, 
            message: 'Datos de factura no proporcionados' 
        });
    }

    const { datosFactura } = req.body;

    try {
        const pool = await poolPromise;
        const entradas = [];
        
        // 1. Generar tokens y guardar entradas
        for (const item of datosFactura.detalles) {
            const asientos = item.asientos && Array.isArray(item.asientos) ? 
                           item.asientos : 
                           Array(item.cantidad).fill().map((_, i) => `Asiento-${i+1}`);
            
            for (const asiento of asientos) {
                const token = crypto.randomBytes(32).toString('hex');
                
                await pool.request()
                    .input('factura_id', sql.VarChar(50), datosFactura.numeroFactura)
                    .input('evento_id', sql.Int, item.eventoId)
                    .input('evento_nombre', sql.NVarChar(100), item.nombre)
                    .input('usuario_id', sql.Int, datosFactura.usuario.id)
                    .input('bloque_id', sql.Int, item.bloqueId)
                    .input('bloque_nombre', sql.NVarChar(50), item.bloqueNombre)
                    .input('asiento', sql.VarChar(20), asiento)
                    .input('precio', sql.Decimal(10, 2), item.precioUnitario)
                    .input('token', sql.VarChar(100), token)
                    .query(`
                        INSERT INTO Entradas (
                            factura_id, evento_id, evento_nombre, usuario_id, 
                            bloque_id, bloque_nombre, asiento, precio, token
                        ) VALUES (
                            @factura_id, @evento_id, @evento_nombre, @usuario_id,
                            @bloque_id, @bloque_nombre, @asiento, @precio, @token
                        )
                    `);
                
                entradas.push({
                    id: token,
                    eventoNombre: item.nombre,
                    bloqueNombre: item.bloqueNombre,
                    asiento: asiento,
                    token: token
                });
            }
        }
        
        // 2. Generar factura PDF
        const htmlFactura = generarHTMLFactura(datosFactura);
        const pdfFactura = await new Promise((resolve, reject) => {
            pdf.create(htmlFactura, { 
                format: 'Letter',
                border: {
                    top: '0.5in',
                    right: '0.5in',
                    bottom: '0.5in',
                    left: '0.5in'
                }
            }).toBuffer((err, buffer) => {
                if (err) return reject(err);
                resolve(buffer);
            });
        });
        
        // 3. Generar PDF con códigos QR
        console.log(`Generando PDF para ${entradas.length} entradas...`);
        const pdfQRs = await generarPDFQRs(entradas, datosFactura.numeroFactura);
        
        // 4. Enviar por correo
        const mailOptions = {
            from: 'EasyTicket <officialeasyticket1@gmail.com>',
            to: datosFactura.usuario.email,
            subject: `Factura y entradas #${datosFactura.numeroFactura}`,
            text: 'Adjunto encontrará su factura y códigos QR para las entradas',
            attachments: [
                {
                    filename: `factura-${datosFactura.numeroFactura}.pdf`,
                    content: pdfFactura
                },
                {
                    filename: `entradas-${datosFactura.numeroFactura}.pdf`,
                    content: pdfQRs
                }
            ]
        };
        
        await transporter.sendMail(mailOptions);
        
        res.status(200).json({ 
            success: true, 
            message: 'Factura y entradas enviadas con éxito',
            facturaNumero: datosFactura.numeroFactura
        });
    } catch (error) {
        console.error('Error al procesar la compra:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al procesar la compra',
            error: error.message 
        });
    }
});

// Ruta para validar entrada (corregida)
router.get('/validar-entrada', async (req, res) => {
    const { token } = req.query;
    
    if (!req.session.user) {
        req.session.returnTo = `/validar-entrada?token=${token}`;
        return res.redirect('/usuarios/login');
    }
    
    try {
        const pool = await poolPromise;
        
        if (req.session.user.tipo === 'Lector') {
            const result = await pool.request()
                .input('token', sql.VarChar(100), token)
                .input('lectorId', sql.Int, req.session.user.id)
                .query(`
                    UPDATE Entradas 
                    SET estado = 'Canjeado', 
                        fecha_canje = GETDATE(),
                        lector_id = @lectorId
                    WHERE token = @token 
                    AND estado = 'No canjeado';
                    
                    SELECT * FROM Entradas WHERE token = @token;
                `);
            
            if (result.recordset.length === 0) {
                return res.status(404).send('Entrada no encontrada o ya fue canjeada');
            }
            
            const entrada = result.recordset[0];
            return res.render('validacion-entrada', {
                valido: true,
                entrada: entrada,
                mensaje: 'Entrada validada correctamente'
            });
        } else {
            const result = await pool.request()
                .input('token', sql.VarChar(100), token)
                .query('SELECT * FROM Entradas WHERE token = @token');
            
            if (result.recordset.length === 0) {
                return res.status(404).send('Entrada no encontrada');
            }
            
            const entrada = result.recordset[0];
            return res.render('info-entrada', {
                entrada: entrada
            });
        }
    } catch (error) {
        console.error('Error al validar entrada:', error);
        return res.status(500).send('Error al procesar la validación');
    }
});

module.exports = router;