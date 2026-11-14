export function scaledSigned(value:string,allowZero=false){
 if(!/^-?\d{1,10}(,\d{1,4})?$/.test(value))return null;
 const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split(',');
 const scaled=BigInt(whole)*BigInt(10000)+BigInt(fraction.padEnd(4,'0'));
 const signed=negative?-scaled:scaled;
 return (allowZero||signed!==BigInt(0))&&Number.isSafeInteger(Number(signed))?Number(signed):null;
}
