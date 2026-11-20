/**
 * PostgreSQL asset/professional hourly_cost is a signed int32 of minor currency units.
 * A UI decimal has at most two fractional digits; rejecting extra precision is
 * safer than silently rounding a contractual resource rate.
 */
export function parseHourlyRateCents(input:string):number|null{
 const text=input.trim();
 if(text==='')return null;
 if(!/^\d+(?:[.,]\d{1,2})?$/.test(text))
  throw new RangeError('Custo por hora inválido: informe valor positivo com até duas casas decimais, sem separadores de milhar.');
 const [whole,fraction='']=text.replace(',','.').split('.');
 const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(cents>2147483647n)
  throw new RangeError('Custo por hora ultrapassa o limite monetário permitido para o cadastro.');
 return Number(cents);
}
