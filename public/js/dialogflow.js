// config/dialogflow.js
const dialogflow = require('@google-cloud/dialogflow');
const path = require('path');
const fs = require('fs');

// Ruta al archivo de credenciales
const CREDENTIALS_PATH = path.join(__dirname, '../../config/easyticketbot-ulko-bfd3458dbbf1.json');

if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('🚨 Archivo de credenciales no encontrado en:', CREDENTIALS_PATH);
}
// Configuración del cliente de Dialogflow
const sessionClient = new dialogflow.SessionsClient({
    keyFilename: CREDENTIALS_PATH
});

const PROJECT_ID = 'easyticketbot-ulko'; // Tu project ID de Dialogflow

async function detectIntent(sessionId, query, languageCode = 'es') {
    const sessionPath = sessionClient.projectAgentSessionPath(PROJECT_ID, sessionId);
    
    const request = {
        session: sessionPath,
        queryInput: {
            text: {
                text: query,
                languageCode: languageCode,
            },
        },
    };

    try {
        const responses = await sessionClient.detectIntent(request);
        const result = responses[0].queryResult;
        return {
            text: result.fulfillmentText,
            intent: result.intent.displayName,
            parameters: result.parameters.fields
        };
    } catch (error) {
        console.error('Error al detectar intent:', error);
        throw error;
    }
}

module.exports = { detectIntent };