// scripts/make-admin.js
// Uso: node scripts/make-admin.js <nome_de_usuario>
// Promove um usuário já cadastrado a admin e aprova o cadastro.
const db = require('../db');

const username = process.argv[2];
if (!username) {
  console.error('Uso: node scripts/make-admin.js <nome_de_usuario>');
  process.exit(1);
}

const info = db.prepare("UPDATE users SET role='admin', status='approved' WHERE username=?").run(username.trim());
if (info.changes === 0) {
  console.error(`Usuário "${username}" não encontrado. Cadastre-se primeiro em /cadastro.html.`);
  process.exit(1);
}
console.log(`Pronto: "${username}" agora é admin e está aprovado.`);
