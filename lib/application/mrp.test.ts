import {calculateMaterialRequirement} from './mrp';
const result=calculateMaterialRequirement({available:4000,minimum:10000});
if(result.netRequirement!==6000)throw new Error('MRP net requirement invariant failed');
