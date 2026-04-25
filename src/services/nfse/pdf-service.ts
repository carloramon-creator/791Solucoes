import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { notoSansBase64 } from './noto-sans-base64';
import path from 'path';
import fs from 'fs';
// @ts-ignore
import QRCode from 'qrcode';

export class PdfService {
    /**
     * Deduplica palavras repetidas em uma string (ex: "Plano Plano" -> "Plano")
     */
    private deduplicateText(text: string): string {
        if (!text) return '';
        const words = text.split(/\s+/);
        const result: string[] = [];
        for (let i = 0; i < words.length; i++) {
            if (i === 0 || words[i].toLowerCase() !== words[i - 1].toLowerCase()) {
                result.push(words[i]);
            }
        }
        return result.join(' ');
    }

    /**
     * Converte valor string (ex: "98,91") ou número para float.
     */
    private parseValue(v: any): number {
        if (v === null || v === undefined) return 0;
        if (typeof v === 'number') return v;
        const s = String(v).replace('R$', '').replace(/\s/g, '').replace('.', '').replace(',', '.');
        return parseFloat(s) || 0;
    }

    /**
     * Gera um PDF (DANFSE) oficial seguindo o padrão nacional/Florianópolis.
     */
    public async generateDanfseBuffer(data: any): Promise<Buffer> {
        return new Promise(async (resolve, reject) => {
            try {
                const fontBuffer = Buffer.from(notoSansBase64, 'base64');
                const doc = new PDFDocument({
                    margin: 30,
                    size: 'A4',
                    font: fontBuffer as any,
                    info: {
                        Title: 'DANFSE - Documento Auxiliar da NFS-e',
                        Author: '791 Barber System'
                    }
                });

                const chunks: Buffer[] = [];
                const stream = new PassThrough();
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', (err) => reject(err));
                doc.pipe(stream);

                // Configurações Globais de Layout
                const pageWidth = 535; // Largura útil
                const startX = 30;
                let y = 30;

                // --- HELPER PARA DESENHAR BOXES ---
                const drawTableBox = (yStart: number, height: number, title: string) => {
                    doc.rect(startX, yStart, pageWidth, height).strokeColor('#000000').lineWidth(0.5).stroke();
                    if (title) {
                        doc.fillColor('#F1F5F9').rect(startX + 0.5, yStart + 0.5, pageWidth - 1, 11).fill(); // Fundo leve para o título
                        doc.fillColor('#000000').fontSize(6).text(title.toUpperCase(), startX + 5, yStart + 3, { bold: true } as any);
                        doc.moveTo(startX, yStart + 12).lineTo(startX + pageWidth, yStart + 12).stroke();
                    }
                };

                const drawLabelValue = (x: number, y: number, width: number, label: string, value: string, fontSizeVal = 8) => {
                    doc.fillColor('#444444').fontSize(5.5).text(label.toUpperCase(), x, y, { width, align: 'left' });
                    doc.fillColor('#000000').fontSize(fontSizeVal).text(value || '-', x, y + 7, { width: width - 2, align: 'left' });
                };

                // --- CABEÇALHO (LOGOS E ÓRGÃO) ---
                doc.rect(startX, y, pageWidth, 55).stroke();

                // Logo 791 (Esquerda)
                try {
                    const logoPath = path.join(process.cwd(), 'public', 'logo-791.jpg');
                    if (fs.existsSync(logoPath)) {
                        doc.image(logoPath, startX + 10, y + 10, { height: 35 });
                    } else {
                        doc.fontSize(14).fillColor('#2563EB').text('791', startX + 10, y + 15, { bold: true } as any);
                    }
                } catch (e) {
                    doc.fontSize(12).text('791 SOLUÇÕES', startX + 10, y + 15);
                }

                // Centro: Informações da Nota
                doc.fillColor('#000000').fontSize(12).text('DANFSE', startX, y + 10, { align: 'center', width: 330, bold: true } as any);
                doc.fontSize(7).text('Documento Auxiliar da Nota Fiscal de Serviço eletrônica', startX, y + 25, { align: 'center', width: 330 });

                // QR Code (Esquerda do DPS block)
                const qrUrl = data.qrCodeUrl || 'https://sj.atende.net';
                try {
                    const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 45 });
                    doc.image(qrDataUrl, startX + 325, y + 5, { width: 45 });
                } catch (e) {
                    doc.rect(startX + 325, y + 5, 45, 45).stroke();
                }

                // DPS Block (Direita)
                const dps = data.dpsInfo || {};
                doc.rect(startX + 375, y + 5, 155, 45).stroke();
                drawLabelValue(startX + 380, y + 10, 50, 'Número DPS', dps.numero || '1');
                drawLabelValue(startX + 435, y + 10, 30, 'Série', dps.serie || '70000');
                drawLabelValue(startX + 470, y + 10, 60, 'Data Emissão', dps.dataEmissao?.slice(0, 10) || '09/02/2026');
                doc.fontSize(5).fillColor('#666666').text('DPS enviado em substituição à NFS-e', startX + 380, y + 35, { width: 145, align: 'center' });

                y += 60;

                // --- IDENTIFICAÇÃO DA NFS-E (NÚMERO / CHAVE) ---
                doc.rect(startX, y, pageWidth, 50).stroke();
                drawLabelValue(startX + 5, y + 5, 100, 'Número da NFS-e', data.numero || data.nfe_id || '1', 11);
                drawLabelValue(startX + 120, y + 5, 100, 'Data/Hora de Emissão', data.dataEmissao || '09/02/2026 14:01:16', 8);
                drawLabelValue(startX + 230, y + 5, 100, 'Competência', data.dataEmissao?.slice(0, 10) || '09/02/2026', 8);
                drawLabelValue(startX + 340, y + 5, 100, 'Código de Verificação', data.codigoVerificacao || 'A1B2-C3D4', 9);

                drawLabelValue(startX + 5, y + 30, 310, 'Chave de Acesso da NFS-e', data.chaveAcesso || '420540722623220400018700000000000000926021489032325', 8.5);

                // Indicadores Reforma Tributária (NT 122/2025)
                const reforma = data.reformaTributaria || {};
                drawLabelValue(startX + 320, y + 30, 40, 'Finalidade', reforma.finNFSe || '0');
                drawLabelValue(startX + 370, y + 30, 60, 'Cons. Final', reforma.indFinal === '1' ? 'SIM' : 'NÃO');
                drawLabelValue(startX + 440, y + 30, 60, 'Ind. Operação', reforma.cIndOp || '010101');

                y += 55;

                // --- PRESTADOR DO SERVIÇO ---
                drawTableBox(y, 65, 'Prestador do Serviço');
                const prestador = data.prestador || {};
                drawLabelValue(startX + 5, y + 15, 300, 'Razão Social / Nome', prestador.razaoSocial || prestador.name || '791 SOLUÇÕES TECNOLÓGICAS LTDA');
                drawLabelValue(startX + 320, y + 15, 100, 'CNPJ / CPF', prestador.cnpj || '61.887.941/0001-83');
                drawLabelValue(startX + 430, y + 15, 100, 'Inscrição Municipal', prestador.im || '-');

                drawLabelValue(startX + 5, y + 35, 350, 'Endereço', prestador.endereco || 'RUA ADHEMAR DA SILVA, 1118 - SÃO JOSÉ/SC');
                drawLabelValue(startX + 370, y + 35, 100, 'Município / UF', prestador.municipioUf || 'SÃO JOSÉ - SC');
                drawLabelValue(startX + 480, y + 35, 50, 'CEP', '88000-000');

                y += 70;

                // --- TOMADOR DO SERVIÇO ---
                drawTableBox(y, 65, 'Tomador do Serviço');
                const tomador = data.tomador || {};
                drawLabelValue(startX + 5, y + 15, 300, 'Razão Social / Nome', tomador.razaoSocial || tomador.nome || 'Consumidor Final');
                drawLabelValue(startX + 320, y + 15, 100, 'CNPJ / CPF', tomador.cnpj || tomador.cpf || 'Não informado');
                drawLabelValue(startX + 430, y + 15, 100, 'Inscrição Municipal', tomador.im || '-');

                drawLabelValue(startX + 5, y + 35, 350, 'Endereço', tomador.endereco || 'Não informado');
                drawLabelValue(startX + 370, y + 35, 100, 'Município / UF', '-');
                drawLabelValue(startX + 480, y + 35, 50, 'CEP', '-');

                y += 70;

                // --- DISCRIMINAÇÃO DOS SERVIÇOS ---
                drawTableBox(y, 160, 'Discriminação dos Serviços');
                const servico = data.servico || {};
                const discriminacao = this.deduplicateText(servico.discriminacao || data.discriminacao || 'Serviços Prestados.');

                doc.fillColor('#000000').fontSize(8.5).text(discriminacao, startX + 5, y + 15, { width: 520, lineGap: 2 });

                y += 165;

                // --- TRIBUTAÇÃO NACIONAL E MUNICIPAL ---
                drawTableBox(y, 60, 'Dados do Serviço e Tributação');
                drawLabelValue(startX + 5, y + 15, 200, 'Código de Tributação Nacional', data.taxCode || '01.01.01');
                drawLabelValue(startX + 220, y + 15, 100, 'CNAE', data.cnae || '6202300');
                drawLabelValue(startX + 330, y + 15, 100, 'Incentivador Cultural', 'Não');
                drawLabelValue(startX + 440, y + 15, 90, 'Regime Tributário', 'Simples Nacional');

                drawLabelValue(startX + 5, y + 35, 100, 'Município Incidência', prestador.municipioUf || 'SÃO JOSÉ - SC');
                drawLabelValue(startX + 110, y + 35, 100, 'Local da Prestação', prestador.municipioUf || 'SÃO JOSÉ - SC');
                drawLabelValue(startX + 220, y + 35, 100, 'Exigibilidade ISS', 'Exigível');
                drawLabelValue(startX + 330, y + 35, 100, 'Processo Administrativo', '-');

                y += 65;

                // --- VALORES E IMPOSTOS (LADO A LADO) ---
                const valor = this.parseValue(data.valorTotal || data.value || data.servico?.valorServicos || 0);

                // Caixa 1: Tributação Municipal Tradicional
                drawTableBox(y, 45, 'Tributação Municipal (Transição ISS)');
                drawLabelValue(startX + 5, y + 15, 100, 'Valor do Serviço', `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 10);
                drawLabelValue(startX + 110, y + 15, 80, 'BC ISSQN', `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
                drawLabelValue(startX + 180, y + 15, 60, 'Alíquota', '2,01 %');
                drawLabelValue(startX + 245, y + 15, 80, 'ISSQN Apurado', `R$ ${(valor * 0.0201).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
                drawLabelValue(startX + 335, y + 15, 80, 'ISSQN Retido', 'Não');

                y += 50;

                // Caixa 2: Reforma Tributária (IBS e CBS)
                drawTableBox(y, 45, 'Reforma Tributária (IBS / CBS) - NT 122/2025');
                const iEst = reforma.ibsEstadual || { aliquota: 0.1, valor: valor * 0.001 };
                const iMun = reforma.ibsMunicipal || { aliquota: 0, valor: 0 };
                const cFed = reforma.cbsFederal || { aliquota: 0.9, valor: valor * 0.009 };

                drawLabelValue(startX + 5, y + 15, 85, 'IBS Estadual', `${iEst.aliquota}% | R$ ${iEst.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
                drawLabelValue(startX + 100, y + 15, 85, 'IBS Municipal', `${iMun.aliquota}% | R$ ${iMun.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
                drawLabelValue(startX + 195, y + 15, 85, 'CBS Federal', `${cFed.aliquota}% | R$ ${cFed.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
                drawLabelValue(startX + 290, y + 15, 120, 'BC Consolidada', `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
                drawLabelValue(startX + 420, y + 15, 100, 'Total IBS/CBS', `R$ ${(iEst.valor + iMun.valor + cFed.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);

                y += 50;

                // --- TRIBUTOS FEDERAIS RETIDOS (ANTIGOS) ---
                drawTableBox(y, 35, 'Retenções Federais (PIS/COFINS/INSS/CSLL/IRRF)');
                drawLabelValue(startX + 5, y + 13, 80, 'PIS', 'R$ 0,00');
                drawLabelValue(startX + 90, y + 13, 80, 'COFINS', 'R$ 0,00');
                drawLabelValue(startX + 180, y + 13, 80, 'INSS', 'R$ 0,00');
                drawLabelValue(startX + 270, y + 13, 80, 'IRRF', 'R$ 0,00');
                drawLabelValue(startX + 360, y + 13, 80, 'CSLL', 'R$ 0,00');
                drawLabelValue(startX + 450, y + 13, 80, 'OUTRAS RET.', 'R$ 0,00');

                y += 40;

                // --- TOTAL LÍQUIDO ---
                drawTableBox(y, 30, '');
                doc.fillColor('#F1F5F9').rect(startX + 350, y + 0.5, 184.5, 29).fill();
                doc.fillColor('#000000').fontSize(8).text('VALOR LÍQUIDO DA NFS-e', startX + 355, y + 10, { bold: true } as any);
                doc.fontSize(12).text(`R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, startX + 350, y + 8, { width: 180, align: 'right', bold: true } as any);

                y += 35;

                // --- INFORMAÇÕES COMPLEMENTARES ---
                drawTableBox(y, 60, 'Informações Complementares');
                doc.fontSize(7).fillColor('#444444').text(data.infoComplementar || 'Documento emitido por Microempreendedor Individual ou Optante pelo Simples Nacional. Tributos aproximados: R$ 0,00 (Federal), R$ 0,00 (Estadual), R$ 0,00 (Municipal). Fonte: IBPT.', startX + 5, y + 15, { width: 520 });

                doc.fontSize(6).fillColor('#999999').text('Gerado via 791 Barber System em ' + new Date().toLocaleString(), startX, 780, { width: pageWidth, align: 'center' });

                doc.end();
            } catch (err) {
                console.error('[PDF-SERVICE] Error:', err);
                reject(err);
            }
        });
    }
}

export default new PdfService();
