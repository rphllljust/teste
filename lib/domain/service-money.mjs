/**
 * Exact rendering of service-needs commercial cents (1/100 BRL).
 * The native ledger stores ten-thousandths (1/10_000); do not pass raw
 * finance units here. String or bigint values preserve precision.
 */
export function formatServiceCentsBRL(value) {
 if(typeof value==='number'&&!Number.isSafeInteger(value))
  throw new RangeError('AMOUNT_NOT_SAFE_INTEGER');
 if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='bigint')
  throw new TypeError('AMOUNT_MUST_BE_INTEGER_CENTS');
 const source=String(value);
 if(!/^-?\d+$/.test(source))throw new TypeError('AMOUNT_MUST_BE_INTEGER_CENTS');
 const cents=BigInt(source);
 const abs=cents<0n?-cents:cents;
 const reais=abs/100n,frac=(abs%100n).toString().padStart(2,'0');
 return (cents<0n?'−':'')+'R$\u00a0'+new Intl.NumberFormat('pt-BR',{useGrouping:true,maximumFractionDigits:0}).format(reais)+','+frac;
}
