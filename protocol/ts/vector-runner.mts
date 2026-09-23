import { createCodec, domain, encode } from './encoding.mts';
import { delta, isReduction, custodyDraw, minimumReduction, notional, withinLeverage } from './model.mts';
export async function vectorRunner() {
  const c = await createCodec();
  const marked = (p: string[]) => ({qty:BigInt(p[0]),price:BigInt(p[1]),quoteNumerator:BigInt(p[2]),quoteDenominator:BigInt(p[3])});
  return function run(v: any) {
    try {
      let result: unknown;
      switch(v.op) {
        case 'encode': result=encode(v.type,v.value); break;
        case 'domain': result=domain(v.name); break;
        case 'hash': result=c.hash(v.name,v.values); break;
        case 'intent': result=c.intent(v.header,v.targets,v.salt); break;
        case 'note': result=c.note(v.header,v.slots,v.anchor,v.secret); break;
        case 'delta': result=delta(BigInt(v.target),BigInt(v.position),BigInt(v.open)); break;
        case 'reduction': result=isReduction(BigInt(v.position),BigInt(v.delta)); break;
        case 'minimumReduction': result=minimumReduction(BigInt(v.position),BigInt(v.bps)); break;
        case 'custodyDraw': result=custodyDraw(BigInt(v.margin),BigInt(v.credit),BigInt(v.available)); break;
        case 'notional': result=notional(marked(v.position)); break;
        case 'leverage': result=withinLeverage(v.positions.map(marked),BigInt(v.equity),BigInt(v.haircut),BigInt(v.limit)); break;
        default: throw new Error('unknown vector op');
      }
      return JSON.parse(JSON.stringify({ok:result},(_,x)=>typeof x==='bigint'?x.toString():x));
    } catch { return {error:true}; }
  };
}
