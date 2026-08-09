// db.js — conexão e schema do SQLite
//
// Usa o módulo SQLite embutido no próprio Node.js (node:sqlite), disponível
// a partir do Node 22.5+. Isso evita completamente o "better-sqlite3" e o
// node-gyp/Visual Studio Build Tools, que costumam falhar no Windows.
const path = require('path');
const fs = require('fs');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error(
    '\n[ERRO] Este projeto usa o módulo nativo "node:sqlite", disponível a partir do Node.js 22.5+.\n' +
    `Sua versão atual é ${process.version}.\n` +
    'Atualize o Node.js (recomendado: versão LTS mais recente, 22 ou superior) e tente novamente.\n' +
    'Se estiver usando Node 22 ou 23 e ainda ver este erro, rode com a flag:\n' +
    '  node --experimental-sqlite server.js\n'
  );
  process.exit(1);
}

// DATA_DIR permite apontar o banco para um disco persistente (ex.: o Persistent
// Disk do Render, montado por exemplo em "/var/data"). Sem isso, no Render o
// sistema de arquivos é apagado a cada novo deploy/reinício e o app "reseta".
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',      -- 'user' | 'admin'
    status        TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'approved' | 'rejected' | 'banned'
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// Guarda a última resposta de cada usuário para cada questão (auto-save).
// question_key é o índice global da questão no array QUESTIONS do quiz.html —
// estável enquanto a lista de questões não for reordenada.
db.exec(`
  CREATE TABLE IF NOT EXISTS answers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_key  TEXT NOT NULL,
    subject       TEXT NOT NULL,
    chapter       INTEGER NOT NULL,
    selected      INTEGER NOT NULL,
    correct       INTEGER NOT NULL,  -- 0 ou 1
    answered_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, question_key)
  );
`);

// Guarda as sessões de login (substitui a MemoryStore padrão do
// express-session, que perde todo mundo logado sempre que o processo
// reinicia — o que acontece com frequência em serviços como o Render).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    sess       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

module.exports = db;
