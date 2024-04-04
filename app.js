const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot')
const QRPortalWeb = require('@bot-whatsapp/portal')
const BaileysProvider = require('@bot-whatsapp/provider/baileys')
const { database, connect } = require('./server.js');
const JsonFileAdapter = require('@bot-whatsapp/database/json');
const chat = require('./config.js')

const mainFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { flowDynamic }) => {
        const db = database()
        try {
            const user = await db.collection('conversation').findOne({ number: ctx.from });

            if (!user) {
                await db.collection('conversation').insertOne({ number: ctx.from, history: [], debt: 0, installments: 0});
            }

            await db.collection('conversation').updateOne(
                { number: ctx.from },
                { $push: { history: "user: " + ctx.body } }
            ); 

            const message = await chat(ctx.body, user.history, user.debt, user.installments)

            await flowDynamic(message)

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