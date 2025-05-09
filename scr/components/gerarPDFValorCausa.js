// Rota: /api/gerar-pdf
const express = require('express');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const libre = require('libreoffice-convert');
const multer = require('multer');
const dayjs = require('dayjs');

const router = express.Router();
const upload = multer();

router.post('/api/gerar-pdf', upload.none(), async (req, res) => {
  try {
    const {
      data,
      Horario,
      nome,
      nascimento,
      idadeExtenso,
      Causa,
      total,
      vencidas,
      vicendas,
      PreOuPos,
      dib,
      RMI
    } = req.body;

    const content = fs.readFileSync(path.resolve(__dirname, './dados/Modelo Valor Causa.docx'), 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.setData({
      data,
      Horario,
      nome,
      nascimento,
      idadeExtenso,
      Causa,
      total,
      vencidas,
      vicendas,
      PreOuPos,
      dib,
      RMI
    });

    try {
      doc.render();
    } catch (error) {
      console.error('Erro ao renderizar o documento:', error);
      return res.status(500).json({ erro: 'Erro ao renderizar o documento Word.' });
    }

    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    const docxPath = path.resolve(__dirname, `./temp/saida-${Date.now()}.docx`);
    const pdfPath = docxPath.replace('.docx', '.pdf');

    fs.writeFileSync(docxPath, buf);

    const pdfBuf = await new Promise((resolve, reject) => {
      libre.convert(fs.readFileSync(docxPath), '.pdf', undefined, (err, done) => {
        if (err) reject(err);
        else resolve(done);
      });
    });

    fs.unlinkSync(docxPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="valor-causa.pdf"');
    res.send(pdfBuf);
  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    res.status(500).json({ erro: 'Erro ao gerar PDF.' });
  }
});

module.exports = router;
