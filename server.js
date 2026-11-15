
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = 8080;
const HOST = '127.0.0.1';

// Token secreto do ESP32
const SENSOR_TOKEN = process.env.SENSOR_TOKEN;

// Limites
const MAX_CLIENTS = 20;
const MAX_MESSAGE_SIZE = 1024;
const MIN_MESSAGE_INTERVAL = 500;

// Verifica se o token foi configurado
if (!SENSOR_TOKEN || SENSOR_TOKEN.length < 32) {
    console.error('ERRO: Configure um SENSOR_TOKEN com pelo menos 32 caracteres.');
    process.exit(1);
}

// ========================================
// SERVIDOR HTTP
// ========================================

const httpServer = http.createServer((req, res) => {

    if (req.method !== 'GET') {
        res.writeHead(405);
        res.end('Metodo nao permitido');
        return;
    }

    if (req.url === '/' || req.url === '/index.html') {

        const arquivo = path.join(__dirname, 'public', 'index.html');

        fs.readFile(arquivo, (erro, conteudo) => {

            if (erro) {
                res.writeHead(500);
                res.end('Erro ao carregar a pagina');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store'
            });

            res.end(conteudo);
        });

    } else {
        res.writeHead(404);
        res.end('Pagina nao encontrada');
    }

});

// ========================================
// SERVIDOR WEBSOCKET
// ========================================

const wsServer = new WebSocket.Server({
    server: httpServer,
    maxPayload: MAX_MESSAGE_SIZE,
    perMessageDeflate: false
});

let sensorAtual = null;

function verificarToken(token) {

    if (typeof token !== 'string')
        return false;

    const recebido = Buffer.from(token);
    const esperado = Buffer.from(SENSOR_TOKEN);

    if (recebido.length !== esperado.length)
        return false;

    return crypto.timingSafeEqual(recebido, esperado);
}

// ========================================
// CONEXOES
// ========================================

wsServer.on('connection', (cliente) => {

    if (wsServer.clients.size > MAX_CLIENTS) {
        cliente.close(1013, 'Limite de conexoes atingido');
        return;
    }

    cliente.tipo = 'visualizador';
    cliente.ultimaMensagem = 0;

    console.log('Novo cliente conectado');

    cliente.on('message', (mensagem, isBinary) => {

        // Nao aceita mensagens binarias
        if (isBinary) {
            cliente.close(1003, 'Somente mensagens de texto');
            return;
        }

        const texto = mensagem.toString();

        // ========================================
        // AUTENTICACAO DO SENSOR
        // ========================================

        if (cliente.tipo === 'visualizador') {

            let dados;

            try {
                dados = JSON.parse(texto);
            } catch {
                cliente.close(1008, 'Autenticacao necessaria para transmitir');
                return;
            }

            if (
                dados.type !== 'auth' ||
                !verificarToken(dados.token)
            ) {
                cliente.close(1008, 'Autenticacao invalida');
                return;
            }

            // Apenas um sensor pode transmitir por vez
            if (sensorAtual && sensorAtual.readyState === WebSocket.OPEN) {
                cliente.close(1008, 'Ja existe um sensor conectado');
                return;
            }

            cliente.tipo = 'sensor';
            sensorAtual = cliente;

            console.log('Sensor autenticado');

            cliente.send(JSON.stringify({
                type: 'auth',
                status: 'ok'
            }));

            return;
        }

        // ========================================
        // RECEBIMENTO DAS LEITURAS
        // ========================================

        if (cliente !== sensorAtual) {
            cliente.close(1008, 'Sem permissao para transmitir');
            return;
        }

        const agora = Date.now();

        // Limite de frequencia
        if (agora - cliente.ultimaMensagem < MIN_MESSAGE_INTERVAL) {
            return;
        }

        cliente.ultimaMensagem = agora;

        // Aceita somente numeros entre 0 e 100
        const valor = Number(texto);

        if (
            texto.trim() === '' ||
            !Number.isFinite(valor) ||
            valor < 0 ||
            valor > 100
        ) {
            console.log('Leitura invalida descartada');
            return;
        }

        console.log('Leitura recebida:', valor);

        // Distribui para os navegadores conectados
        wsServer.clients.forEach((destinatario) => {

            if (
                destinatario !== cliente &&
                destinatario.tipo === 'visualizador' &&
                destinatario.readyState === WebSocket.OPEN
            ) {
                destinatario.send(valor.toFixed(2));
            }

        });

    });

    cliente.on('close', () => {

        if (cliente === sensorAtual) {
            sensorAtual = null;
            console.log('Sensor desconectado');
        } else {
            console.log('Cliente desconectado');
        }

    });

    cliente.on('error', (erro) => {
        console.error('Erro WebSocket:', erro.message);
    });

});

// ========================================
// INICIALIZACAO
// ========================================

httpServer.listen(PORT, HOST, () => {
    console.log(`Servidor iniciado em http://${HOST}:${PORT}`);
});
