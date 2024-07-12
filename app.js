const express = require('express');
const { google } = require('googleapis');

const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot')
const QRPortalWeb = require('@bot-whatsapp/portal')
const { database, connect } = require('./server.js');
const BaileysProvider = require('@bot-whatsapp/provider/baileys')
const JsonFileAdapter = require('@bot-whatsapp/database/json');

const app = express();
app.use(express.json());

async function getAuth(_range) {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const client = await auth.getClient();

    const googleSheets = google.sheets({ version: 'v4', auth: client });

    const spreadsheetId = '1iKYb13naSmUkV8NIX2A9TlbpyaInVsVGzZetaqrkFfA';

    const metadata = await googleSheets.spreadsheets.values.get({
        spreadsheetId,
        range: _range,
    });

    return {
        auth,
        client,
        googleSheets,
        spreadsheetId,
        metadata
    };
}

app.post('/addDeposit', async (req, res) => {
    const { googleSheets, spreadsheetId, metadata } = await getAuth('Contas!C:C');

    const { values } = req.body;
    const lastRow = metadata.data.values.length + 1;


    const response = await googleSheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Contas!B' + lastRow,
        valueInputOption: "USER_ENTERED",
        resource: {
            values: values
        }
    });

    res.send(response.data);
});

app.post('/addWithdrawl', async (req, res) => {
    const { googleSheets, spreadsheetId, metadata } = await getAuth('Contas!F:F');

    const { values } = req.body;
    const lastRow = metadata.data.values.length + 1;


    const response = await googleSheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Contas!E' + lastRow,
        valueInputOption: "USER_ENTERED",
        resource: {
            values: values
        }
    });

    res.send(response.data);
});

app.listen(8000, () => {
    console.log('Server is running on port 8000');
});

const fetchUpdate = async (type, category, value) => {
    const uri = type === "deposit" ? 'http://localhost:8000/addDeposit' : 'http://localhost:8000/addWithdrawl';

    const response = await fetch(uri, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [[category.toUpperCase(), value]] }),
    });

    const data = await response.json();
    return data;
};


const mainFlow = addKeyword(EVENTS.WELCOME).addAction(async (ctx, { flowDynamic }) => {
        const db = database();
        const findUser = await db.collection('access_users').findOne({ phoneNumber: ctx.from });

        if (!findUser) {
            await db.collection('access_users').insertOne({ phoneNumber: ctx.from });
            
            await flowDynamic("Olá, seja bem-vindo ao seu assistente financeiro!\nAgora você já pode começar enviando as suas transações. Para enviar uma transação escreva o sinal de '+' para entradas e '-' para saídas, adicione o valor sem cifrão, ponto ou vírgula. Escreva uma categoria e caso deseje coloque o dia e mês da transação. \n");
            await flowDynamic("Veja o exemplo abaixo:\n+1000 pagamento 10/10");
            await flowDynamic("Para ver o seu extrato, basta enviar 'Solicitar extrato' para mim :)");
            
            return;
        }
        
        try {
            let user_id = findUser._id;
            const message = ctx.body.trim();
            const lines = message.split("\n");
            const transactions = [];
            const valueRegex = /^([\+\-])\s*(\d+)\s*(.*?)\s*(\d{2}\/\d{2})?$/;
            const wordsList = ["saldo", "extrato", "gastos", "ganho", "balanço"];
            const containsKeyword = wordsList.some(word => ctx.body.toUpperCase().includes(word.toUpperCase()));
            let value, category, type, date;
            
            if (containsKeyword) {
                const findTransactions = await db.collection('transactions').findOne({ user_id: user_id });
                
                if (!findTransactions) {
                    await flowDynamic("Você ainda não possui transações cadastradas.");
                    return;
                }
            
                const transactions = await db.collection('transactions').find({ user_id: user_id }).toArray();

                const currentDate = new Date();
                const currentMonth = String(currentDate.getMonth() + 1).padStart(2, '0'); // Meses começam do 0
                const currentYear = currentDate.getFullYear();

                const transactionsThisMonth = transactions.filter(transaction => {
                    const [day, month, year] = transaction.date.split('/');
                    return month === currentMonth && year === String(currentYear);
                });
            
                const sumsByType = {};

                transactionsThisMonth.forEach(transaction => {
                if (sumsByType[transaction.type]) {
                    sumsByType[transaction.type] += parseInt(transaction.value, 10);
                } else {
                    sumsByType[transaction.type] = parseInt(transaction.value, 10);
                }
                });

                await flowDynamic("Aqui está o extrato do mês atual!");
                await flowDynamic(`Entrada: R$ ${sumsByType['deposit'] || 0} | Saída: R$ ${sumsByType['withdrawal'] || 0}`);
                await flowDynamic(`Total: R$ ${(sumsByType['deposit'] || 0) - (sumsByType['withdrawal'] || 0)}`);
                return;
            }

            else {
                for (const line of lines) {
                    const match = line.match(valueRegex);

                    if (match) {
                        if(match[1] === "+") {
                            type = "deposit";
                        } else if (match[1] === "-") {
                            type = "withdrawal";
                        } else {
                            await flowDynamic("Escreva uma mensagem válida \nVeja o exemplo abaixo:\n+1000 pagamento 10/10 \n-50 mercado 10/10");
                            return;
                        }

                        value = match[2];
                        category = match[3].trim() || "sem categoria";
                        date = match[4];

                        const currentYear = new Date().getFullYear();

                        if (date && /^\d{2}\/\d{2}$/.test(date)) {
                            date += `/${currentYear}`;
                        } else if (!date) {
                            date = new Date().toLocaleDateString('pt-BR');
                        }

                        transactions.push({ user_id, type, value, category, date });

                        
                    } else {
                        await flowDynamic("Escreva uma mensagem válida \nVeja o exemplo abaixo:\n+1000 pagamento 10/10 \n-50 mercado 10/10");
                        return;
                    }
                }
                
                await db.collection('transactions').insertMany(transactions);
            }
            
            for (const item of transactions) {
                await fetchUpdate(item.type, item.category, item.value);
            }
            
            await flowDynamic(`Transação cadastrada com sucesso!`);

        } catch (error) {
            console.error("Erro ao processar a mensagem:", error);
        }
});

const main = async () => {
    const adapterDB = new JsonFileAdapter()
    const adapterFlow = createFlow([mainFlow])
    const adapterProvider = createProvider(BaileysProvider)

    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    QRPortalWeb()
    connect()
}

main()
