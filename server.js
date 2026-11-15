const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8080;

// Servidor HTTP: entrega a página HTML
const httpServer = http.createServer((req, res) => {

    if (req.url === '/' || req.url === '/index.html') {

        const arquivo = path.join(__dirname, 'public', 'index.html');

        fs.readFile(arquivo, (erro, conteudo) => {

            if (erro) {
                res.writeHead(500);
                res.end('Erro ao carregar a página');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8'
            });

            res.end(conteudo);
        });

    } else {
        res.writeHead(404);
        res.end('Página não encontrada');
    }

});

// Servidor WebSocket associado ao HTTP
const wsServer = new WebSocket.Server({
    server: httpServer
});

wsServer.on('connection', (cliente) => {

    console.log('Nova conexão WebSocket!');

    cliente.on('message', (mensagem) => {

        console.log('Mensagem recebida:', mensagem.toString());

        // Distribui a mensagem para todos os clientes conectados
        wsServer.clients.forEach((destinatario) => {

            if (destinatario.readyState === WebSocket.OPEN) {

                destinatario.send(mensagem.toString());

            }

        });
        
    });

    cliente.on('close', () => {
        console.log('Cliente desconectado!');
    });

});

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor iniciado na porta ${PORT}`);
});
