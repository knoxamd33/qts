# Banco de Questões CFAP·PMPA — servidor de teste

Backend Node/Express com banco de dados **SQLite**, login, cadastro com
aprovação manual e **painel de administrador** para aceitar ou rejeitar
pedidos de acesso.

## Estrutura

```
quiz-app/
├── server.js            servidor Express (rotas de auth + admin)
├── db.js                conexão SQLite e criação da tabela "users"
├── package.json
├── .env.example          modelo do arquivo de variáveis de ambiente
├── scripts/
│   └── make-admin.js     promove um usuário cadastrado a admin
├── data/                 banco app.db é criado aqui automaticamente
└── public/
    ├── login.html
    ├── cadastro.html
    ├── quiz.html          (seu quiz original, já ligado à sessão)
    └── admin.html          (painel de aprovação/rejeição)
```

## Requisito de versão do Node

O banco usa o módulo **`node:sqlite`**, embutido no próprio Node.js desde a
versão 22.5 — **não** depende de `better-sqlite3` nem de qualquer pacote que
precise compilar código nativo (node-gyp / Visual Studio Build Tools), que é
a causa mais comum de erro no `npm install` no Windows.

Verifique sua versão com `node -v`. Se for menor que 22.5, atualize o
Node.js em https://nodejs.org antes de continuar.

## Passo a passo

Abra o terminal na pasta do projeto e rode, na ordem:

```bat
cd "caminho\para\a\pasta\quiz-app"
npm install
copy .env.example .env
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

O último comando imprime uma string aleatória. Rode-o **duas vezes** (para
gerar dois valores diferentes) e abra o arquivo `.env` para colar um valor em
`SESSION_SECRET` e outro em `ADMIN_SECRET`. Exemplo de `.env` preenchido:

```
PORT=3000
SESSION_SECRET=8f2c...umvalorlongoaqui...
ADMIN_SECRET=4a91...outrovalorlongoaqui...
```

Guarde o `ADMIN_SECRET` — é a chave que você vai digitar no painel `/admin`
para liberar cadastros.

Depois, inicie o servidor de teste:

```bat
node server.js
```

Você verá algo como:

```
Servidor de teste rodando em http://localhost:3000
Painel do administrador em http://localhost:3000/admin
```

## Histórico de respostas (auto-save)

Toda vez que a pessoa responde uma questão, o quiz salva automaticamente no
banco (`data/app.db`, tabela `answers`) qual foi a resposta e se acertou.
Se ela responder a mesma questão de novo depois, a tentativa mais recente
substitui a anterior — só a última resposta de cada questão fica valendo.

Dentro do quiz, o botão **"Histórico"** (ao lado de "Sair") abre uma tela
com:
- Total de questões resolvidas, acertos, erros e % de aproveitamento geral;
- Filtros "Todas / Só erradas / Só corretas";
- Lista de cada questão respondida, com um botão **"Revisar"** que leva
  direto de volta para aquela questão específica, já pronta para responder
  de novo.

O progresso é por usuário e fica salvo mesmo se a pessoa sair e entrar de
novo depois (recarregar a página não perde nada).

## Fluxo de uso

1. Acesse `http://localhost:3000/cadastro.html` e crie uma conta (usuário +
   senha com no mínimo 8 caracteres). O cadastro fica com status **pendente**
   — ninguém consegue entrar ainda.
2. Acesse `http://localhost:3000/admin`, cole a chave `ADMIN_SECRET` no campo
   e clique em **Carregar cadastros**. A lista mostra os pedidos pendentes;
   use **Aprovar** ou **Rejeitar**.
3. Depois de aprovado, o usuário consegue entrar em
   `http://localhost:3000/login.html` e é redirecionado para o quiz (`/`).

### Entrar sem login (convidado)

[#entrar-sem-login-convidado](#entrar-sem-login-convidado)

Na tela `http://localhost:3000/login.html` também existe o botão **"Entrar
sem login"**. Ele cria uma conta de convidado descartável na hora (sem
usuário/senha e sem esperar aprovação do administrador) e já entra direto no
quiz. O progresso desse convidado é salvo normalmente no banco (histórico,
acertos/erros), mas fica preso àquela sessão/navegador — se o cookie for
apagado, não tem como recuperar o acesso àquela conta depois.

### Tornar um usuário administrador do próprio quiz (opcional)

O painel `/admin` já funciona só com a `ADMIN_SECRET`, sem precisar de um
usuário "admin". Mas se você quiser que o link **"Painel do administrador"**
apareça dentro do quiz para um usuário específico, promova-o depois que ele
já tiver se cadastrado:

```bat
npm run make-admin -- SEU_USUARIO
```

Isso marca o usuário como `role=admin` e `status=approved` no banco.

## Publicar no Render sem os dados resetarem

[#publicar-no-render-sem-os-dados-resetarem](#publicar-no-render-sem-os-dados-resetarem)

Por padrão, o Render apaga o disco do serviço a cada novo deploy (e alguns
planos reiniciam o processo por inatividade) — então, sem cuidado extra,
tanto o banco `app.db` (usuários, cadastros aprovados, respostas) quanto as
sessões de quem estava logado seriam perdidos toda hora. Este projeto já
guarda **sessões e banco no mesmo arquivo SQLite** (veja
`sqlite-session-store.js`), então basta apontar esse arquivo para um disco
que sobrevive aos deploys:

1. No painel do Render, no seu **Web Service**, adicione um **Disk**
   (Persistent Disk) — por exemplo, montado em `/var/data`.
2. Em **Environment**, defina as variáveis:
   - `SESSION_SECRET` e `ADMIN_SECRET` (gere com o comando mostrado acima).
   - `DATA_DIR=/var/data` (o mesmo caminho do disco que você montou).
   - `NODE_ENV=production` (opcional, mas recomendado).
3. **Build Command**: `npm install`. **Start Command**: `npm start`.
4. Depois do primeiro deploy, o `data/app.db` passa a viver dentro do disco
   persistente — novos deploys, reinícios ou o serviço "dormindo" por
   inatividade não apagam mais usuários, aprovações nem progresso.

Sem um Persistent Disk configurado (planos que não oferecem disco, por
exemplo), o Render ainda vai zerar tudo a cada deploy — isso é uma
limitação da hospedagem, não do código.

## Observações importantes (é um servidor de teste)

- As sessões ficam guardadas no próprio SQLite (`sqlite-session-store.js`),
  não mais na `MemoryStore` padrão do `express-session` — por isso
  sobrevivem a reinícios do processo, o que é essencial em hospedagens como
  o Render.
- O cookie de sessão usa `secure: 'auto'`: ativa `secure` sozinho quando o
  acesso é HTTPS (como no Render, graças ao `app.set('trust proxy', 1)`) e
  continua funcionando normalmente em `http://localhost` durante o
  desenvolvimento.
- Senhas são guardadas com hash `bcrypt` — nunca em texto puro.
- O arquivo do banco fica em `data/app.db` por padrão (criado
  automaticamente na primeira execução, via `node:sqlite`, sem dependências
  nativas), ou na pasta definida em `DATA_DIR`, se você configurar essa
  variável — veja a seção sobre o Render. Para "zerar" tudo localmente,
  feche o servidor e apague essa pasta.
- Ao iniciar, você verá um aviso `ExperimentalWarning: SQLite is an
  experimental feature...` — é esperado, o módulo `node:sqlite` ainda está
  marcado como experimental pelo próprio Node.js, mas funciona normalmente.
