const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { calcularValorDaCausa, gerarTextoValorCausa } = require("./scr/components/CalculoValorDaCausa");

const app = express();
const port = process.env.PORT || 3001;

// Listar arquivos recebidos do Make
app.get("/api/listar-pdfs", (req, res) => {
  const dir = path.join(__dirname, "uploads");
  if (!fs.existsSync(dir)) return res.json([]);
  const arquivos = fs.readdirSync(dir);
  const pdfs = arquivos.filter(nome => nome.toLowerCase().endsWith(".pdf"));
  res.json(pdfs);
});

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// Página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Webhook do Make
const MAKE_WEBHOOK_URL = "https://hook.us2.make.com/oychrybshfgj5s9ey908pnwoct9cth0v";

// 🔁 Botão "Gerar Valor da Causa PDF"
app.post("/api/gerar-pdf-valor-causa", async (req, res) => {
  try {
    const payload = req.body;
    console.log("🔁 Enviando dados ao Make:", payload);

    const resposta = await axios.post(MAKE_WEBHOOK_URL, payload);
    res.json({ message: "✅ Dados enviados ao Make com sucesso.", resposta: resposta.data });
  } catch (err) {
    console.error("❌ Erro ao enviar para o Make:", err.message);
    res.status(500).json({ error: "Erro ao enviar os dados para o Make" });
  }
});

// PDF vindo do Make
app.post("/api/receber-pdf", upload.single("file"), (req, res) => {
  try {
    const filePath = path.join(__dirname, "uploads", req.file.filename);
    const destino = path.join(__dirname, "uploads", req.body.filename || req.file.originalname);
    fs.renameSync(filePath, destino);
    res.json({ message: "📄 PDF recebido com sucesso", nome: req.body.filename });
  } catch (error) {
    console.error("Erro ao salvar o PDF:", error.message);
    res.status(500).json({ error: "Erro ao processar o arquivo" });
  }
});

// Extração do CNIS
const extractCNISData = async (buffer) => {
  const data = await pdfParse(buffer);
  const text = data.text;
  const lines = text.split("\n");

  const regexContrib = /(\d{2}\/\d{4})\D+(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  const regexData = /(\d{2}\/\d{2}\/\d{4})/;

  const contributions = [];
  let match;

  // 👇 Extrair contribuições
  while ((match = regexContrib.exec(text)) !== null) {
    const date = match[1];
    const value = parseFloat(match[2].replace(/\./g, '').replace(',', '.'));
    contributions.push({ data: date, valor: value });
  }

  // 👇 Extrair DIB
  let dib = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/NB\s+\d+/.test(line) || /Data In[ií]cio/.test(line)) {
      for (let j = 0; j <= 3; j++) {
        const targetLine = lines[i + j];
        const dateMatch = targetLine && targetLine.match(regexData);
        if (dateMatch) {
          dib = dateMatch[1];
          break;
        }
      }
      if (dib) break;
    }
  }

  // 👇 Extrair nome
  let nome = null;
  const nomeLinha = lines.find(l => l.includes("Nome:"));
  if (nomeLinha) {
    nome = nomeLinha.split("Nome:")[1].trim();
  }

  // 👇 Extrair data de nascimento
  let nascimento = null;
  const nascLinha = lines.find(l => /Nascimento|Data de Nascimento/i.test(l));
  if (nascLinha) {
    const nascMatch = nascLinha.match(regexData);
    if (nascMatch) nascimento = nascMatch[1];
  }

  // 👇 Extrair sexo
  let sexo = null;
  const sexoLinha = lines.find(l => /Sexo/i.test(l));
  if (sexoLinha) {
    if (sexoLinha.includes("Masculino")) sexo = "Masculino";
    if (sexoLinha.includes("Feminino")) sexo = "Feminino";
  }

  // 👇 Calcular idade por extenso (opcional)
  let idadeExtenso = null;
  if (nascimento) {
    const [dia, mes, ano] = nascimento.split("/");
    const idade = new Date().getFullYear() - parseInt(ano);
    idadeExtenso = `${idade} anos`;
  }

  return {
    contributions,
    dib,
    nome,
    nascimento,
    sexo,
    idadeExtenso
  };
};

// Verificar dados CNIS
app.post("/api/verificar-dados-cnis", upload.single("arquivo"), async (req, res) => {
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const resultado = await extractCNISData(fileBuffer);
    fs.unlinkSync(req.file.path);
    res.json({ sucesso: true, dadosExtraidos: resultado });
  } catch (error) {
    console.error('Erro ao extrair dados do CNIS:', error);
    res.status(500).json({ erro: 'Erro ao extrair dados do CNIS.' });
  }
});

// Calcular valor da causa + gerar texto
app.post("/api/valor-da-causa", upload.single("arquivo"), async (req, res) => {
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const textoExtraido = await extractCNISData(fileBuffer);
    fs.unlinkSync(req.file.path);

    const dibFinal = req.body.DIB || textoExtraido.dib;
    const { contributions } = textoExtraido;

    const resultado = calcularValorDaCausa({ contributions, dib: dibFinal });
    const texto = gerarTextoValorCausa(resultado);

    res.json({ texto });
  } catch (error) {
    console.error('Erro ao calcular valor da causa:', error);
    res.status(500).json({ erro: 'Erro ao calcular valor da causa.' });
  }
});

// API de uso do Make
app.post("/api/calculo-make", upload.single("arquivo"), async (req, res) => {
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const extraido = await extractCNISData(fileBuffer);
    fs.unlinkSync(req.file.path);

    const dib = req.body.dib || extraido.dib;
    const contributions = extraido.contributions;

    const resultado = calcularValorDaCausa({ contributions, dib });

    res.json({
      sucesso: true,
      rmi: resultado.rmi,
      vencidas: resultado.vencidas,
      vincendas: resultado.vincendas,
      total: resultado.total,
      mesesVencidos: resultado.mesesVencidos,
      dib
    });
  } catch (error) {
    console.error('Erro na rota /api/calculo-make:', error);
    res.status(500).json({ erro: 'Erro no cálculo via Make.' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});
