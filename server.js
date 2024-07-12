const { MongoClient } = require('mongodb')
require('dotenv').config()

const uri = process.env.MONGO_URI;
const dbName = 'chatbot';

let client;
let db;

async function connect() {
    try {
        client = new MongoClient(uri);
        await client.connect();
        console.log('Conexão com o MongoDB estabelecida com sucesso');
        db = client.db(dbName);
    } catch (error) {
        console.error('Erro ao conectar ao MongoDB:', error);
        throw error;
    }
}

function database() {
    if (!db) {
        throw new Error('Conexão com o MongoDB não estabelecida');
    }
    return db;
}

module.exports = { connect, database };
