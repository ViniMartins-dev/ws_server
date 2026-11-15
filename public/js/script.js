// Elementos HTML
const luxElement = document.getElementById("lux");
const averageElement = document.getElementById("average");
const resistanceElement = document.getElementById("resistance");
const sensorTypeElement = document.getElementById("sensorType");
const percentageElement = document.getElementById("percentage");

const progressElement = document.getElementById("progress");

const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");

const readingCountElement = document.getElementById("readingCount");
const lastUpdateElement = document.getElementById("lastUpdate");

// Variáveis da média
let somaLux = 0;
let quantidadeLeituras = 0;

// Configuração do gráfico
const grafico = new Chart(
    document.getElementById("graficoLux"),
    {
        type: "line",

        data: {
            labels: [],

            datasets: [{
                label: "Luminosidade (lux)",
                data: [],
                borderColor: "#0b6b3a",
                backgroundColor: "rgba(11, 107, 58, 0.10)",
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                pointBackgroundColor: "#0b6b3a"
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,

            plugins: {
                legend: {
                    labels: {
                        color: "#292f33",
                        font: {
                            family: "Inter"
                        }
                    }
                }
            },

            scales: {
                x: {
                    ticks: {
                        color: "#64716a",
                        maxTicksLimit: 6
                    },

                    grid: {
                        color: "#e1e9e3"
                    }
                },

                y: {
                    beginAtZero: true,

                    ticks: {
                        color: "#64716a"
                    },

                    grid: {
                        color: "#e1e9e3"
                    },

                    title: {
                        display: true,
                        text: "Lux",
                        color: "#292f33"
                    }
                }
            }
        }
    }
);

// Atualiza o status da conexão
function atualizarStatus(conectado) {
    if (conectado) {
        statusIndicator.classList.add("connected");
        statusText.textContent = "Conectado";
    } else {
        statusIndicator.classList.remove("connected");
        statusText.textContent = "Desconectado";
    }
}

// Conexão WebSocket
function conectar() {
    const protocolo =
        location.protocol === "https:" ? "wss:" : "ws:";

    const socket = new WebSocket(
        `${protocolo}//${location.host}`
    );

    socket.onopen = () => {
        atualizarStatus(true);
    };

    socket.onclose = () => {
        atualizarStatus(false);
        setTimeout(conectar, 3000);
    };

    socket.onerror = () => {
        atualizarStatus(false);
    };

    socket.onmessage = (event) => {
        try {
            const dados = JSON.parse(event.data);

            if (
                typeof dados.lux !== "number" ||
                typeof dados.percentage !== "number"
            ) {
                return;
            }

            atualizarDashboard(dados);

        } catch (erro) {
            console.error("Erro ao interpretar dados:", erro);
        }
    };
}

// Atualização dos indicadores
function atualizarDashboard(dados) {

    const lux = dados.lux;
    const percentage = dados.percentage;

    // Luminosidade atual
    luxElement.textContent = lux.toFixed(2);

    // Média de luminosidade
    somaLux += lux;
    quantidadeLeituras++;

    const media = somaLux / quantidadeLeituras;

    averageElement.textContent = media.toFixed(2);

    // Resistência do LDR
    if (
        typeof dados.resistance === "number" &&
        Number.isFinite(dados.resistance)
    ) {
        resistanceElement.textContent =
            dados.resistance.toFixed(2);
    } else {
        resistanceElement.textContent = "--";
    }

    // Tipo de leitura
    sensorTypeElement.textContent =
        dados.simulated ? "Simulada" : "Sensor físico";

    // Porcentagem
    percentageElement.textContent =
        percentage.toFixed(1) + "%";

    const porcentagemLimitada = Math.max(
        0,
        Math.min(100, percentage)
    );

    progressElement.style.width =
        porcentagemLimitada + "%";

    // Atualização do gráfico
    grafico.data.labels.push(
        new Date().toLocaleTimeString("pt-BR")
    );

    grafico.data.datasets[0].data.push(lux);

    // Mantém somente as últimas 30 leituras
    if (grafico.data.labels.length > 30) {
        grafico.data.labels.shift();
        grafico.data.datasets[0].data.shift();
    }

    grafico.update();

    // Informações adicionais
    readingCountElement.textContent =
        `Leituras recebidas: ${quantidadeLeituras}`;

    lastUpdateElement.textContent =
        "Última atualização: " +
        new Date().toLocaleTimeString("pt-BR");
}

// Inicia a conexão
conectar();