// File: routes/chatbot.js
// routes/chatbot.js
const express = require('express');
const router = express.Router();
const { detectIntent } = require('../public/js/dialogflow');

router.post('/chatbot', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Message and sessionId are required' 
            });
        }

        const result = await detectIntent(sessionId, message);
        
        res.json({
            success: true,
            response: result.text,
            intent: result.intent,
            parameters: result.parameters
        });
    } catch (error) {
        console.error('Error en el chatbot:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al procesar el mensaje' 
        });
    }
});

module.exports = router;