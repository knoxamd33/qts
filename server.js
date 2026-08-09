// server.js — servidor de teste (Node/Express) para o Banco de Questões CFAP·PMPA
require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const SqliteSessionStore = require('./sqlite-session-store');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!SESSION_SECRET || !ADMIN_SECRET) {
  console.error(
    '\n[ERRO] Defina SESSION_SECRET e ADMIN_SECRET no arquivo .env antes de iniciar.\n' +
    'Copie .env.example para .env e gere valores com:\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// Necessário para o cookie "secure" funcionar corretamente atrás do proxy
// HTTPS do Render (e de qualquer outro host que termine o TLS antes do Node).
app.set('trust proxy', 1);

app.use(session({
  name: 'quiz.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SqliteSessionStore(db), // persiste as sessões em disco — sobrevive a reinícios do servidor
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',          // usa HTTPS automaticamente quando disponível (ex.: Render), sem quebrar o localhost
    maxAge: 1000 * 60 * 60 * 8, // 8 horas
  },
}));

// ---------- helpers ----------
function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, status: u.status, created_at: u.created_at };
}

function requireAdminKey(req, res, next) {
  const key = req.header('x-admin-key') || '';
  if (!key || key !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Chave de administrador inválida.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado.' });
  next();
}

function requireCsrf(req, res, next) {
  const token = req.header('x-csrf-token');
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Token CSRF inválido. Recarregue a página e tente novamente.' });
  }
  next();
}

// ---------- API: sessão / csrf ----------
app.get('/api/csrf-token', (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.json({ csrfToken: req.session.csrfToken });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!u || u.status !== 'approved') {
    req.session.destroy(() => {});
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, username: u.username, role: u.role });
});

// ---------- API: cadastro ----------
app.post('/api/register', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Informe um nome de usuário com pelo menos 3 caracteres.' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
    }
    const uname = username.trim();
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
    if (exists) return res.status(409).json({ error: 'Esse nome de usuário já está cadastrado.' });

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)')
      .run(uname, hash, 'user', 'pending');

    res.status(201).json({ message: 'Cadastro enviado! Aguarde a aprovação do administrador para poder entrar.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno ao criar cadastro.' });
  }
});

// ---------- API: login ----------
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });

    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    if (u.status === 'pending') {
      return res.status(403).json({ error: 'Seu cadastro ainda está pendente de aprovação do administrador.' });
    }
    if (u.status === 'rejected') {
      return res.status(403).json({ error: 'Seu cadastro foi rejeitado. Entre em contato com o administrador.' });
    }
    if (u.status === 'banned') {
      return res.status(403).json({ error: 'Sua conta foi banida. Entre em contato com o administrador.' });
    }
    if (u.status !== 'approved') {
      return res.status(403).json({ error: 'Seu acesso não está liberado.' });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Erro interno ao iniciar sessão.' });
      req.session.userId = u.id;
      res.json({ message: 'ok', username: u.username, role: u.role });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno ao entrar.' });
  }
});

// ---------- API: logout ----------
app.post('/api/logout', requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('quiz.sid');
    res.json({ message: 'ok' });
  });
});

// ---------- API: progresso / histórico de respostas (auto-save) ----------
app.get('/api/progress', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT question_key, subject, chapter, selected, correct, answered_at FROM answers WHERE user_id = ?'
  ).all(req.session.userId);

  const total = rows.length;
  const correct = rows.filter((r) => r.correct === 1).length;
  const wrong = total - correct;
  const accuracy_pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  res.json({
    answers: rows,
    stats: { total, correct, wrong, accuracy_pct },
  });
});

app.post('/api/progress', requireAuth, requireCsrf, (req, res) => {
  try {
    const { qi, subject, chapter, selected, correct } = req.body || {};
    if (qi === undefined || qi === null || !subject || chapter === undefined || selected === undefined || correct === undefined) {
      return res.status(400).json({ error: 'Dados incompletos para salvar a resposta.' });
    }
    db.prepare(`
      INSERT INTO answers (user_id, question_key, subject, chapter, selected, correct, answered_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(user_id, question_key)
      DO UPDATE SET subject=excluded.subject, chapter=excluded.chapter,
                    selected=excluded.selected, correct=excluded.correct,
                    answered_at=excluded.answered_at
    `).run(req.session.userId, String(qi), String(subject), Number(chapter), Number(selected), correct ? 1 : 0);

    res.json({ message: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno ao salvar progresso.' });
  }
});

app.delete('/api/progress/:qi', requireAuth, requireCsrf, (req, res) => {
  db.prepare('DELETE FROM answers WHERE user_id = ? AND question_key = ?').run(req.session.userId, String(req.params.qi));
  res.json({ message: 'ok' });
});

app.delete('/api/progress', requireAuth, requireCsrf, (req, res) => {
  db.prepare('DELETE FROM answers WHERE user_id = ?').run(req.session.userId);
  res.json({ message: 'ok' });
});

// ---------- API: admin (protegida por chave ADMIN_SECRET no header x-admin-key) ----------
app.get('/api/admin/users', requireAdminKey, (req, res) => {
  const status = req.query.status || 'pending';
  let rows;
  if (status === 'all') {
    rows = db.prepare('SELECT * FROM users ORDER BY id DESC').all();
  } else {
    rows = db.prepare('SELECT * FROM users WHERE status = ? ORDER BY id DESC').all(status);
  }
  res.json({ users: rows.map(publicUser) });
});

app.post('/api/admin/users/:id/approve', requireAdminKey, (req, res) => {
  const info = db.prepare("UPDATE users SET status='approved' WHERE id=?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ message: 'ok' });
});

app.post('/api/admin/users/:id/reject', requireAdminKey, (req, res) => {
  const info = db.prepare("UPDATE users SET status='rejected' WHERE id=?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ message: 'ok' });
});

app.post('/api/admin/users/:id/ban', requireAdminKey, (req, res) => {
  const info = db.prepare("UPDATE users SET status='banned' WHERE id=?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ message: 'ok' });
});

app.post('/api/admin/users/:id/unban', requireAdminKey, (req, res) => {
  const info = db.prepare("UPDATE users SET status='approved' WHERE id=?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json({ message: 'ok' });
});

// ---------- páginas estáticas ----------
const PUBLIC_DIR = path.join(__dirname, 'public');

// As rotas abaixo (login/cadastro/admin/quiz) são registradas ANTES do
// express.static para garantir que a checagem de sessão do quiz sempre
// rode primeiro — senão o middleware estático serviria o arquivo .html
// direto pela URL, ignorando o redirect para /login.html.
app.get('/login.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/cadastro.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'cadastro.html')));
app.get(['/admin', '/admin.html'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

function sendQuiz(req, res) {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(PUBLIC_DIR, 'quiz.html'));
}
app.get('/', sendQuiz);
app.get('/quiz.html', sendQuiz);

function sendQuizPremium(req, res) {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(PUBLIC_DIR, 'quiz-premium.html'));
}
app.get('/quiz-premium.html', sendQuizPremium);

app.use(express.static(PUBLIC_DIR, { index: false }));

app.use((req, res) => res.status(404).send('Não encontrado.'));

app.listen(PORT, () => {
  console.log(`Servidor de teste rodando em http://localhost:${PORT}`);
  console.log(`Painel do administrador em http://localhost:${PORT}/admin`);
});
