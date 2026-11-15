
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = 8080;
const HOST = '0.0.0.0';

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
// ARQUIVOS PUBLICOS
// ========================================

const arquivosPublicos = {
    '/': {
        arquivo: 'index.html',
        tipo: 'text/html; charset=utf-8'
    },

    '/index.html': {
        arquivo: 'index.html',
        tipo: 'text/html; charset=utf-8'
    },

    '/css/style.css': {
        arquivo: path.join('css', 'style.css'),
        tipo: 'text/css; charset=utf-8'
    },

    '/js/script.js': {
        arquivo: path.join('js', 'script.js'),
        tipo: 'application/javascript; charset=utf-8'
    }
};

// ========================================
// SERVIDOR HTTP
// ========================================

const httpServer = http.createServer((req, res) => {

    if (req.method !== 'GET') {
        res.writeHead(405);
        res.end('Metodo nao permitido');
        return;
    }

    let rota;

    try {
        rota = decodeURIComponent(
            new URL(req.url, 'http://localhost').pathname
        );
    } catch {
        res.writeHead(400);
        res.end('Requisicao invalida');
        return;
    }

    const recurso = arquivosPublicos[rota];

    if (!recurso) {
        res.writeHead(404);
        res.end('Arquivo nao encontrado');
        return;
    }

    const arquivo = path.join(
        __dirname,
        'public',
        recurso.arquivo
    );

    fs.readFile(arquivo, (erro, conteudo) => {

        if (erro) {
            console.error('Erro ao carregar arquivo:', arquivo);
            console.error('Detalhes:', erro.message);

            res.writeHead(500, {
                'Content-Type': 'text/plain; charset=utf-8'
            });

            res.end('Erro ao carregar arquivo');
            return;
        }

        res.writeHead(200, {
            'Content-Type': recurso.tipo,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store'
        });

        res.end(conteudo);
    });

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

// ========================================
// VERIFICACAO DO TOKEN
// ========================================

function verificarToken(token) {

    if (typeof token !== 'string') {
        return false;
    }

    const recebido = Buffer.from(token);
    const esperado = Buffer.from(SENSOR_TOKEN);

    if (recebido.length !== esperado.length) {
        return false;
    }

    return crypto.timingSafeEqual(recebido, esperado);
}

// ========================================
// VALIDACAO DAS LEITURAS
// ========================================

function validarLeitura(dados) {

    if (
        typeof dados !== 'object' ||
        dados === null ||
        Array.isArray(dados)
    ) {
        return false;
    }

    if (
        typeof dados.lux !== 'number' ||
        typeof dados.percentage !== 'number' ||
        typeof dados.simulated !== 'boolean'
    ) {
        return false;
    }

    if (
        !Number.isFinite(dados.lux) ||
        !Number.isFinite(dados.percentage) ||
        dados.lux < 0 ||
        dados.percentage < 0 ||
        dados.percentage > 100
    ) {
        return false;
    }

    // Sensor simulado não possui resistência real
    if (dados.simulated) {

        if (dados.resistance !== null) {
            return false;
        }

    } else {

        if (
            typeof dados.resistance !== 'number' ||
            !Number.isFinite(dados.resistance) ||
            dados.resistance <= 0
        ) {
            return false;
        }
    }

    return true;
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

        // Não aceita mensagens binárias
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
            if (
                sensorAtual &&
                sensorAtual.readyState === WebSocket.OPEN
            ) {
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

        // Limite de frequência
        if (agora - cliente.ultimaMensagem < MIN_MESSAGE_INTERVAL) {
            return;
        }

        let leitura;

        try {
            leitura = JSON.parse(texto);
        } catch {
            console.log('Mensagem JSON invalida descartada');
            return;
        }

        if (!validarLeitura(leitura)) {
            console.log('Leitura invalida descartada');
            return;
        }

        cliente.ultimaMensagem = agora;

        console.log('Leitura recebida:', leitura);

        // ========================================
        // DISTRIBUICAO PARA OS NAVEGADORES
        // ========================================

        const mensagemJSON = JSON.stringify({
            lux: leitura.lux,
            resistance: leitura.resistance,
            percentage: leitura.percentage,
            simulated: leitura.simulated
        });

        wsServer.clients.forEach((destinatario) => {

            if (
                destinatario !== cliente &&
                destinatario.tipo === 'visualizador' &&
                destinatario.readyState === WebSocket.OPEN
            ) {
                destinatario.send(mensagemJSON);
            }

        });

    });

    // ========================================
    // ENCERRAMENTO DA CONEXAO
    // ========================================

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
    console.log(`Servidor iniciado na porta ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
});
