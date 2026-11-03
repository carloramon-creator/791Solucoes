import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';

const TITLE = 'Comprovante de Registro de Ponto do Trabalhador';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Snapshot do ponto inválido.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 300): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Campo do comprovante inválido.');
  }
  return value;
}
export function validarSnapshot(value: unknown, registroId: string) {
  const row = object(value);
  const employer = object(row.empregador);
  if (row.operacao_oficial !== false || row.id !== registroId || !UUID.test(registroId)
    || !UUID.test(text(row.vidracaria_id)) || !UUID.test(text(row.estabelecimento_id))
    || !Number.isInteger(row.nsr) || Number(row.nsr) < 1 || Number(row.nsr) > 999999998
    || !/^\d{11}$/.test(text(row.cpf)) || !/^(?:\d{11}|\d{14})$/.test(text(employer.documento))
    || !HASH.test(text(row.hash)) || (row.hash_anterior !== '' && !HASH.test(text(row.hash_anterior)))) {
    throw new Error('Identificação ou integridade do comprovante inválida.');
  }
  const date = (value: unknown) => {
    const raw = text(value);
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) {
      throw new Error('Horário do comprovante inválido.');
    }
    return raw;
  };
  const fuso = text(row.fuso);
  new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }).format();
  const marcada = date(row.marcada_em);
  const gravada = date(row.gravada_em);
  const afdTime = (instant: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' })
      .formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
    const offset = get('timeZoneName');
    if (!offset) throw new Error('Fuso do comprovante inválido.');
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00${
      offset === 'GMT' ? '+0000' : offset.replace('GMT', '').replace(':', '')}`;
  };
  const base = text(row.linha_base_afd);
  const hashAnterior = typeof row.hash_anterior === 'string' ? row.hash_anterior : '';
  const hash = text(row.hash);
  if (base.length !== 73 || base.slice(0, 10) !== `${String(row.nsr).padStart(9, '0')}7`
    || base.slice(34, 46) !== String(row.cpf).padStart(12, '0')
    || base.slice(10, 34) !== afdTime(marcada) || base.slice(46, 70) !== afdTime(gravada)
    || !/^(?:01|02|03)0$/.test(base.slice(70))
    || createHash('sha256').update(base + hashAnterior, 'utf8').digest('hex') !== hash) {
    throw new Error('Hash do original não confere.');
  }
  const cadastro = employer.cadastro_obras === undefined || employer.cadastro_obras === '' ? '' : text(employer.cadastro_obras, 14);
  if (!/^(?:\d{12}|\d{14})?$/.test(cadastro)) throw new Error('Cadastro de obras do comprovante inválido.');
  return {
    id: registroId, tenant: text(row.vidracaria_id), nsr: Number(row.nsr),
    nome: text(row.nome), cpf: text(row.cpf), marcada, gravada, fuso, hash,
    empregador: { nome: text(employer.nome), documento: text(employer.documento), endereco: text(employer.endereco),
      cadastro_obras: cadastro },
  };
}
export type SnapshotPonto = ReturnType<typeof validarSnapshot>;

const asn = forge.asn1;
const der = (value: forge.asn1.Asn1) => asn.toDer(value).getBytes();
const seq = (...values: forge.asn1.Asn1[]) => asn.create(asn.Class.UNIVERSAL, asn.Type.SEQUENCE, true, values);
const set = (...values: forge.asn1.Asn1[]) => asn.create(asn.Class.UNIVERSAL, asn.Type.SET, true, values);
const oid = (value: string) => asn.create(asn.Class.UNIVERSAL, asn.Type.OID, false, asn.oidToDer(value).getBytes());
const octets = (value: string) => asn.create(asn.Class.UNIVERSAL, asn.Type.OCTETSTRING, false, value);
const alg = (value: string) => seq(oid(value), asn.create(asn.Class.UNIVERSAL, asn.Type.NULL, false, ''));
const integer = (value: string) => asn.create(asn.Class.UNIVERSAL, asn.Type.INTEGER, false, value);
const ctx = (tag: number, values: forge.asn1.Asn1[]) => asn.create(asn.Class.CONTEXT_SPECIFIC, tag, true, values);

class ReceiptSigner extends Signer {
  constructor(private readonly key: forge.pki.rsa.PrivateKey, private readonly certificate: forge.pki.Certificate,
    private readonly chain: forge.pki.Certificate[]) { super(); }
  async sign(content: Buffer, signingTime = new Date()): Promise<Buffer> {
    const sha256 = '2.16.840.1.101.3.4.2.1';
    const attr = (id: string, value: forge.asn1.Asn1) => seq(oid(id), set(value));
    const certDer = der(forge.pki.certificateToAsn1(this.certificate));
    const attributes = [
      attr('1.2.840.113549.1.9.3', oid('1.2.840.113549.1.7.1')),
      attr('1.2.840.113549.1.9.5', asn.create(asn.Class.UNIVERSAL,
        signingTime.getUTCFullYear() >= 2050 ? asn.Type.GENERALIZEDTIME : asn.Type.UTCTIME, false,
        signingTime.getUTCFullYear() >= 2050 ? asn.dateToGeneralizedTime(signingTime) : asn.dateToUtcTime(signingTime))),
      attr('1.2.840.113549.1.9.4', octets(createHash('sha256').update(content).digest().toString('latin1'))),
      attr('1.2.840.113549.1.9.16.2.47', seq(seq(seq(octets(createHash('sha256').update(certDer, 'latin1').digest().toString('latin1')))))),
    ].sort((a, b) => Buffer.compare(Buffer.from(der(a), 'latin1'), Buffer.from(der(b), 'latin1')));
    const digest = forge.md.sha256.create();
    digest.update(der(set(...attributes)));
    const signature = this.key.sign(digest);
    const serial = this.certificate.serialNumber;
    const serialBytes = forge.util.hexToBytes(`${parseInt(serial.slice(0, 2), 16) >= 128 ? '00' : ''}${serial}`);
    const signerInfo = seq(integer('\x01'),
      seq(forge.pki.distinguishedNameToAsn1(this.certificate.issuer), integer(serialBytes)),
      alg(sha256), ctx(0, attributes), alg('1.2.840.113549.1.1.1'), octets(signature));
    const signed = seq(integer('\x01'), set(alg(sha256)), seq(oid('1.2.840.113549.1.7.1')),
      ctx(0, this.chain.map(cert => forge.pki.certificateToAsn1(cert))), set(signerInfo));
    return Buffer.from(der(seq(oid('1.2.840.113549.1.7.2'), ctx(0, [signed]))), 'latin1');
  }
}

export function carregarAssinante(config: unknown, now = new Date()) {
  const value = object(config);
  const base64 = text(value.pfxBase64, 3 * 1024 * 1024).replace(/^data:[^,]+;base64,/, '');
  const senha = text(value.passphrase, 256);
  const cnpj = text(value.prestador_cnpj).replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpj) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('A1 da holding não configurado corretamente.');
  const pfx = Buffer.from(base64, 'base64');
  if (pfx.length === 0 || pfx.length > 2 * 1024 * 1024) throw new Error('A1 da holding excede o limite.');
  let bundle: forge.pkcs12.Pkcs12Pfx;
  try { bundle = forge.pkcs12.pkcs12FromAsn1(asn.fromDer(pfx.toString('latin1')), senha); }
  catch { throw new Error('Não foi possível abrir o A1 da holding. Confira arquivo e senha no cadastro fiscal.'); }
  const keys = bundle.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const certs = (bundle.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])
    .flatMap(bag => bag.cert ? [bag.cert] : []);
  if (keys.length !== 1 || !keys[0].key) throw new Error('A1 deve conter exatamente uma chave privada.');
  const key = keys[0].key;
  const publicKey = createPublicKey(createPrivateKey(forge.pki.privateKeyToPem(key))).export({ type: 'spki', format: 'der' });
  const candidates = certs.filter(cert => new X509Certificate(forge.pki.certificateToPem(cert))
    .publicKey.export({ type: 'spki', format: 'der' }).equals(publicKey));
  if (candidates.length !== 1) throw new Error('Certificado e chave privada do A1 não correspondem univocamente.');
  const cert = candidates[0];
  const x509 = new X509Certificate(forge.pki.certificateToPem(cert));
  if (now.getTime() < cert.validity.notBefore.getTime() || now.getTime() >= cert.validity.notAfter.getTime()) {
    throw new Error('Certificado da holding vencido ou ainda não válido.');
  }
  const icpOid = Buffer.from([0x06, 0x05, 0x60, 0x4c, 0x01, 0x03, 0x03]);
  const documents = new Set<string>();
  for (let pos = x509.raw.indexOf(icpOid); pos >= 0; pos = x509.raw.indexOf(icpOid, pos + 1)) {
    const document = x509.raw.subarray(pos + icpOid.length, pos + icpOid.length + 24).toString('latin1').match(/\d{14}/)?.[0];
    if (document) documents.add(document);
  }
  const cn = cert.subject.getField('CN')?.value;
  if (typeof cn === 'string') {
    const document = cn.match(/:(\d{14})$/)?.[1];
    if (document) documents.add(document);
  }
  if (!documents.has(cnpj)) throw new Error('A1 não pertence ao CNPJ da holding configurado.');
  const usage = cert.getExtension('keyUsage') as { digitalSignature?: boolean } | null;
  if (usage && usage.digitalSignature !== true) throw new Error('Certificado não permite assinatura digital.');
  return { signer: new ReceiptSigner(key, cert, certs), titular: cnpj, fingerprint: x509.fingerprint256,
    validade: cert.validity.notAfter.toISOString() };
}

export async function gerarComprovanteHomologacao(snapshot: SnapshotPonto, inpi: string, config: unknown) {
  if (!/^\d{17}$/.test(inpi)) throw new Error('Configure o número INPI do REP-P (17 dígitos).');
  const now = new Date();
  const certificate = carregarAssinante(config, now);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${TITLE} - HOMOLOGAÇÃO`);
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 790;
  const line = (label: string, value: string) => {
    const words = `${label}${value}`.split(' ');
    let current = '';
    for (const word of words) {
      if (font.widthOfTextAtSize(`${current} ${word}`, 10) > 490 && current) {
        page.drawText(current, { x: 45, y, size: 10, font }); y -= 16; current = word;
      } else current += `${current ? ' ' : ''}${word}`;
    }
    page.drawText(current, { x: 45, y, size: 10, font }); y -= 22;
    if (y < 70) throw new Error('Conteúdo excede a página do comprovante.');
  };
  page.drawText('HOMOLOGAÇÃO - SEM VALIDADE COMO PONTO OFICIAL', { x: 45, y, size: 12, font, color: rgb(0.7, 0, 0) });
  y -= 30;
  line('', TITLE);
  line('NSR: ', String(snapshot.nsr).padStart(9, '0'));
  line('Empregador: ', snapshot.empregador.nome);
  line('CNPJ/CPF: ', snapshot.empregador.documento);
  if (snapshot.empregador.cadastro_obras) line('CEI/CAEPF/CNO: ', snapshot.empregador.cadastro_obras);
  line('Local de prestação / estabelecimento: ', snapshot.empregador.endereco);
  line('Trabalhador: ', snapshot.nome);
  line('CPF: ', snapshot.cpf);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: snapshot.fuso, dateStyle: 'short', timeStyle: 'medium' });
  line('Marcação: ', `${time.format(new Date(snapshot.marcada))} (${snapshot.fuso})`);
  line('Gravação: ', `${time.format(new Date(snapshot.gravada))} (${snapshot.fuso})`);
  line('Registro INPI REP-P: ', inpi);
  line('SHA-256 da marcação: ', snapshot.hash);
  line('Assinante (desenvolvedor): ', certificate.titular);
  line('', 'Assinatura em homologação. Cadeia ICP-Brasil, revogação e política PAdES ainda dependem de validação independente.');
  pdflibAddPlaceholder({ pdfDoc: pdf, reason: 'Homologação de comprovante REP-P; operação oficial bloqueada',
    contactInfo: '', name: certificate.titular, location: 'Brasil', signingTime: now,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED, signatureLength: 32768 });
  const bytes = await pdf.save({ useObjectStreams: false });
  const signed = await new SignPdf().sign(Buffer.from(bytes), certificate.signer, now);
  return { pdf: signed, fingerprint: certificate.fingerprint, validade: certificate.validade, operacao_oficial: false as const };
}
