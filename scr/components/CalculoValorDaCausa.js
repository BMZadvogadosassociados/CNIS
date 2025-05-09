// scr/components/CalculoValorDaCausa.js

const fs = require('fs');
const dayjs = require('dayjs');
const customParse = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParse);

const correcaoMonetaria = JSON.parse(
  fs.readFileSync('./dados/correcao_monetaria_unificada_1965_2025_CORRIGIDO.json', 'utf8')
);

// Função auxiliar para arredondar valores
const formatar = (valor) => Number(valor.toFixed(2));

const calcularValorDaCausa = ({ contributions, dib }) => {
  // 1. Filtra contribuições válidas e pós-03/1994
  const contribFiltradas = contributions.filter(c => {
    const [mes, ano] = c.data.split('/');
    const dataRef = dayjs(`01/${mes}/${ano}`, 'DD/MM/YYYY');
    return (
      dataRef.isValid() &&
      dataRef.isAfter(dayjs('31/03/1994', 'DD/MM/YYYY')) &&
      typeof c.valor === 'number' &&
      c.valor > 0
    );
  });

  // 2. Calcula a RMI com base nos 80% maiores salários
  const calcularRMI = () => {
    if (!contribFiltradas.length) return 0;
    const ordenados = [...contribFiltradas].sort((a, b) => b.valor - a.valor);
    const usados = ordenados.slice(0, Math.floor(ordenados.length * 0.8));
    const media = usados.reduce((acc, cur) => acc + cur.valor, 0) / usados.length;
    return formatar(media * 0.5);
  };

  // 3. Calcula parcelas vencidas com base na prescrição quinquenal
  const calcularParcelasVencidas = (rmi, dib) => {
    if (!dib || typeof dib !== 'string') return { total: null, meses: 0 };

    const inicio = dayjs(dib, ['YYYY-MM-DD', 'DD/MM/YYYY']);
    const fim = dayjs();

    // Prescrição: máximo 60 meses + 13ºs
    const mesesPossiveis = fim.diff(inicio, 'month');
    const mesesPrescritos = Math.min(mesesPossiveis, 60);

    const vencidas = [];
    for (let i = 0; i < mesesPrescritos; i++) {
      const dataRef = inicio.add(i, 'month');
      const chave = `${dataRef.format('MM')}/${dataRef.format('YYYY')}`;
      const fator = correcaoMonetaria[chave] || 1;
      vencidas.push(rmi * fator);
    }

    // Inclui 13ºs proporcionalmente a cada 12 meses
    const anos = Math.floor(mesesPrescritos / 12);
    const decimos = Array.from({ length: anos }, (_, i) => {
      const ref = inicio.add((i + 1) * 12 - 1, 'month');
      const chave = `${ref.format('MM')}/${ref.format('YYYY')}`;
      const fator = correcaoMonetaria[chave] || 1;
      return rmi * fator;
    });

    const totalMensal = vencidas.reduce((a, b) => a + b, 0);
    const total13 = decimos.reduce((a, b) => a + b, 0);

    return {
      total: formatar(totalMensal + total13),
      meses: mesesPrescritos
    };
  };

  // 4. Calcula parcelas vincendas fixas: 13 x RMI
  const calcularParcelasVincendas = (rmi) => formatar(rmi * 13);

  const rmi = calcularRMI();
  const vencidasCalculadas = calcularParcelasVencidas(rmi, dib);
  const vincendas = calcularParcelasVincendas(rmi);
  const total = vencidasCalculadas.total !== null
    ? formatar(vencidasCalculadas.total + vincendas)
    : null;

  return {
    rmi,
    vencidas: vencidasCalculadas.total,
    vincendas,
    total,
    mesesVencidos: vencidasCalculadas.meses,
    dib
  };
};

const gerarTextoValorCausa = ({ rmi, vencidas, vincendas, total }) => {
  return `\n✅ RMI: R$ ${rmi.toFixed(2)}\n📆 Parcelas vencidas: R$ ${vencidas.toFixed(2)}\n📆 Parcelas vincendas (13 x RMI): R$ ${vincendas.toFixed(2)}\n💰 Valor total da causa: R$ ${total.toFixed(2)}\n`.trim();
};

module.exports = {
  calcularValorDaCausa,
  gerarTextoValorCausa
};
